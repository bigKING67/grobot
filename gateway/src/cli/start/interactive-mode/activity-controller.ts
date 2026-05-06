import {
  createInteractiveActivityTracker,
  type InteractiveActivityTracker,
} from "../../tui/interactive/activity-state";
import type { RuntimeEvent } from "../../../models/types";
import { renderStatusIndicatorLine } from "../../tui/components/status-indicator/render";
import { TURN_INTERRUPTED_EXIT_CODE } from "../turn";
import {
  compactSummaryText,
  formatTurnElapsedCompact,
  type InteractiveDiagnosticsMode,
  type ProcessActivitySnapshot,
  renderProcessSummaryLabel,
  resolveInlineStatusIndicatorMode,
  resolveInteractiveDiagnosticsMode,
  resolveProcessFailureCategory,
  resolveProcessSummaryDetail,
} from "./process-summary";
import { type PendingInputFrameController } from "./pending-input-frame";
import { resolveTerminalColumns } from "./prompt-surface";

export interface InteractiveActivityController {
  readonly diagnosticsMode: InteractiveDiagnosticsMode;
  writeStdout(message: string): void;
  writeStderr(message: string): void;
  ensureStdoutLineBoundary(): void;
  isInlineProgressSupported(): boolean;
  isTurnActive(): boolean;
  setPendingInputFrame(controller: PendingInputFrameController): void;
  stopInlineActivityTicker(insertNewline: boolean): void;
  readPromptActivityText(): string | undefined;
  observeRuntimeEvent(event: RuntimeEvent): void;
  runActivityScope(input: {
    traceEvent: string;
    startActivity?: Parameters<InteractiveActivityTracker["markTurnStart"]>[0];
    operation: () => Promise<number>;
  }): Promise<number>;
  runInteractiveTurn(input: {
    interactiveMode: boolean;
    operation: () => Promise<number>;
  }): Promise<number>;
}

export function createInteractiveActivityController(input: {
  interactiveDiagnosticsEnabled?: boolean;
  interactiveDiagnosticsMode?: InteractiveDiagnosticsMode;
  isPlanMode(): boolean;
  getPendingAskQueueSize(): number;
}): InteractiveActivityController {
  const diagnosticsMode = resolveInteractiveDiagnosticsMode({
    interactiveDiagnosticsEnabled: input.interactiveDiagnosticsEnabled,
    interactiveDiagnosticsMode: input.interactiveDiagnosticsMode,
  });
  const traceDiagnosticsEnabled = diagnosticsMode === "trace";
  const progressDiagnosticsEnabled = diagnosticsMode === "verbose";
  const processSummaryDetail = resolveProcessSummaryDetail();
  const suppressDiagnosticStderr = !traceDiagnosticsEnabled;
  const inlineProgressSupported = Boolean((process.stdout as { isTTY?: boolean }).isTTY)
    && !traceDiagnosticsEnabled;
  let inlineProgressActive = false;
  let inlineProgressText = "";
  let inlineActivityTicker: ReturnType<typeof setInterval> | undefined;
  let inlineActivityTick = 0;
  let stdoutNeedsLineBreak = false;
  let activeTurnStartedAtMs: number | undefined;
  let pendingInputFrame: PendingInputFrameController | undefined;

  const ensureStdoutLineBoundary = (): void => {
    if (!stdoutNeedsLineBreak) {
      return;
    }
    process.stdout.write("\n");
    stdoutNeedsLineBreak = false;
  };

  const clearInlineProgress = (insertNewline: boolean): void => {
    if (!inlineProgressSupported || !inlineProgressActive) {
      return;
    }
    process.stdout.write("\r\x1b[2K");
    if (insertNewline) {
      process.stdout.write("\n");
    }
    inlineProgressActive = false;
    inlineProgressText = "";
  };

  const writeProgressLine = (line: string): void => {
    if (!inlineProgressSupported) {
      process.stdout.write(line);
      return;
    }
    if (pendingInputFrame?.isEnabled()) {
      pendingInputFrame.rerender();
      return;
    }
    const rendered = line.replace(/\r?\n$/, "");
    if (!rendered || rendered === inlineProgressText) {
      return;
    }
    process.stdout.write(`\r\x1b[2K${rendered}`);
    inlineProgressActive = true;
    inlineProgressText = rendered;
  };

  const activityTracker = createInteractiveActivityTracker(
    progressDiagnosticsEnabled
      ? {
        writeProgressLine,
      }
      : {},
  );

  const writeTrace = (message: string): void => {
    if (!traceDiagnosticsEnabled) {
      return;
    }
    process.stderr.write(`[trace] ${message}\n`);
  };

  const renderInlineActivityTicker = (): void => {
    if (!inlineProgressSupported || typeof activeTurnStartedAtMs !== "number") {
      return;
    }
    if (pendingInputFrame?.isEnabled()) {
      pendingInputFrame.rerender();
      inlineActivityTick += 1;
      return;
    }
    const defaultActivityText = input.isPlanMode() ? "Planning implementation" : "Working";
    const activitySnapshot = activityTracker.readActivitySnapshot();
    const activityText = compactSummaryText(
      activitySnapshot?.title ?? activityTracker.readPromptActivity() ?? defaultActivityText,
    );
    const activityDetail = compactSummaryText(activitySnapshot?.detail ?? "");
    const statusMode = resolveInlineStatusIndicatorMode({
      planMode: input.isPlanMode(),
      activityKind: activitySnapshot?.kind,
      stageId: activitySnapshot?.stageId,
    });
    writeProgressLine(renderStatusIndicatorLine({
      message: activityText,
      startedAtMs: activeTurnStartedAtMs,
      nowMs: Date.now(),
      tick: inlineActivityTick,
      terminalColumns: resolveTerminalColumns(),
      mode: statusMode,
      thinkingText: activityDetail || undefined,
      thinkingStatus: statusMode === "thinking" && activityDetail.length === 0
        ? "thinking"
        : undefined,
    }));
    inlineActivityTick += 1;
  };

  const startInlineActivityTicker = (): void => {
    if (!inlineProgressSupported || inlineActivityTicker) {
      return;
    }
    inlineActivityTick = 0;
    renderInlineActivityTicker();
    inlineActivityTicker = setInterval(() => {
      if (typeof activeTurnStartedAtMs !== "number") {
        return;
      }
      renderInlineActivityTicker();
    }, 120);
  };

  const stopInlineActivityTicker = (insertNewline: boolean): void => {
    if (inlineActivityTicker) {
      clearInterval(inlineActivityTicker);
      inlineActivityTicker = undefined;
    }
    clearInlineProgress(insertNewline);
  };

  const writeTurnSummaryLine = (inputSummary: {
    result: "ok" | "error" | "interrupted";
    elapsedMs: number;
    exitCode?: number | "<exception>";
    pendingAskCount?: number;
    activitySnapshot?: ProcessActivitySnapshot;
  }): void => {
    if (!progressDiagnosticsEnabled || traceDiagnosticsEnabled || processSummaryDetail === "none") {
      return;
    }
    const durationText = formatTurnElapsedCompact(inputSummary.elapsedMs);
    const failureCategory = resolveProcessFailureCategory({
      result: inputSummary.result,
      activitySnapshot: inputSummary.activitySnapshot,
      pendingAskCount: inputSummary.pendingAskCount,
    });
    const parts = [
      `› ${renderProcessSummaryLabel(inputSummary.result)}`,
      `· ${durationText}`,
    ];
    if (failureCategory) {
      parts.push(`· ${failureCategory}`);
    }
    if (typeof inputSummary.exitCode === "number" || inputSummary.exitCode === "<exception>") {
      parts.push(`· exit ${String(inputSummary.exitCode)}`);
    }
    if ((inputSummary.pendingAskCount ?? 0) > 0) {
      parts.push(`· pending ${String(inputSummary.pendingAskCount)}`);
    }
    const shouldShowStage = processSummaryDetail === "full"
      || inputSummary.result !== "ok"
      || inputSummary.elapsedMs >= 5_000;
    if (inputSummary.activitySnapshot && shouldShowStage) {
      parts.push(`· ${compactSummaryText(inputSummary.activitySnapshot.text).replace(/"/g, "'")}`);
    }
    pendingInputFrame?.clear();
    ensureStdoutLineBoundary();
    stopInlineActivityTicker(false);
    process.stdout.write(`${parts.join(" ")}\n`);
    pendingInputFrame?.render();
  };

  const flushBufferedStderr = (): void => {
    if (!suppressDiagnosticStderr) {
      return;
    }
    const buffered = activityTracker.flushBufferedStderr();
    if (buffered.length <= 0) {
      return;
    }
    stopInlineActivityTicker(true);
    pendingInputFrame?.clear();
    ensureStdoutLineBoundary();
    process.stderr.write(buffered);
    pendingInputFrame?.renderAfterStderr(buffered);
  };

  const finishActiveTurn = (inputFinish: {
    result: "ok" | "error" | "interrupted";
    exitCode?: number | "<exception>";
    traceEvent?: string;
  }): void => {
    stopInlineActivityTicker(false);
    const elapsedMs = Math.max(0, Date.now() - (activeTurnStartedAtMs ?? Date.now()));
    const activitySnapshot = activityTracker.readPromptActivitySnapshot();
    activityTracker.markTurnFinished(inputFinish.result);
    ensureStdoutLineBoundary();
    writeTurnSummaryLine({
      result: inputFinish.result,
      elapsedMs,
      exitCode: inputFinish.exitCode,
      pendingAskCount: input.getPendingAskQueueSize(),
      activitySnapshot: activitySnapshot
        ? {
          stageId: activitySnapshot.stageId,
          text: activitySnapshot.text,
        }
        : undefined,
    });
    const source = inputFinish.traceEvent ? ` source=${inputFinish.traceEvent}` : "";
    writeTrace(
      `event=turn_finish mode=${diagnosticsMode}${source} result=${inputFinish.result} exit_code=${
        inputFinish.exitCode === undefined ? "0" : String(inputFinish.exitCode)
      } duration_ms=${String(elapsedMs)}`,
    );
    activeTurnStartedAtMs = undefined;
  };

  const beginTurn = (inputBegin: {
    traceEvent?: string;
    startActivity?: Parameters<InteractiveActivityTracker["markTurnStart"]>[0];
  }): void => {
    activeTurnStartedAtMs = Date.now();
    activityTracker.markTurnStart(inputBegin.startActivity);
    startInlineActivityTicker();
    const source = inputBegin.traceEvent ? ` source=${inputBegin.traceEvent}` : "";
    writeTrace(`event=turn_start mode=${diagnosticsMode}${source}`);
  };

  const resolveResult = (code: number): "ok" | "error" | "interrupted" => {
    if (code === TURN_INTERRUPTED_EXIT_CODE) {
      return "interrupted";
    }
    return code === 0 ? "ok" : "error";
  };

  return {
    diagnosticsMode,
    writeStdout: (message) => {
      stopInlineActivityTicker(true);
      pendingInputFrame?.clear();
      process.stdout.write(message);
      if (message.length > 0) {
        stdoutNeedsLineBreak = !message.endsWith("\n");
      }
      pendingInputFrame?.renderAfterStdout();
    },
    writeStderr: (message) => {
      if (!suppressDiagnosticStderr) {
        activityTracker.observeStderrChunk(message);
        stopInlineActivityTicker(true);
        pendingInputFrame?.clear();
        ensureStdoutLineBoundary();
        process.stderr.write(message);
        pendingInputFrame?.renderAfterStderr(message);
        return;
      }
      const forwarded = activityTracker.consumeStderrChunk(message);
      if (forwarded.length > 0) {
        stopInlineActivityTicker(true);
        pendingInputFrame?.clear();
        ensureStdoutLineBoundary();
        process.stderr.write(forwarded);
        if (typeof activeTurnStartedAtMs === "number" && !pendingInputFrame?.isEnabled()) {
          renderInlineActivityTicker();
        }
        pendingInputFrame?.renderAfterStderr(forwarded);
        return;
      }
      if (typeof activeTurnStartedAtMs === "number" && !pendingInputFrame?.isEnabled()) {
        startInlineActivityTicker();
      }
    },
    ensureStdoutLineBoundary,
    isInlineProgressSupported: () => inlineProgressSupported,
    isTurnActive: () => typeof activeTurnStartedAtMs === "number",
    setPendingInputFrame: (controller) => {
      pendingInputFrame = controller;
    },
    stopInlineActivityTicker,
    readPromptActivityText: () => {
      const activitySnapshot = activityTracker.readActivitySnapshot();
      if (!activitySnapshot) {
        return activityTracker.readPromptActivity();
      }
      return activitySnapshot.detail
        ? `${activitySnapshot.title} · ${activitySnapshot.detail}`
        : activitySnapshot.title;
    },
    observeRuntimeEvent: (event) => {
      activityTracker.observeRuntimeEvent(event);
      if (typeof activeTurnStartedAtMs === "number" && !pendingInputFrame?.isEnabled()) {
        startInlineActivityTicker();
      }
    },
    runActivityScope: async (inputScope) => {
      if (typeof activeTurnStartedAtMs === "number") {
        return inputScope.operation();
      }
      beginTurn({
        traceEvent: inputScope.traceEvent,
        startActivity: inputScope.startActivity,
      });
      try {
        const code = await inputScope.operation();
        flushBufferedStderr();
        finishActiveTurn({
          result: resolveResult(code),
          exitCode: code === 0 || code === TURN_INTERRUPTED_EXIT_CODE ? undefined : code,
          traceEvent: inputScope.traceEvent,
        });
        return code;
      } catch (error) {
        flushBufferedStderr();
        finishActiveTurn({
          result: "error",
          exitCode: "<exception>",
          traceEvent: inputScope.traceEvent,
        });
        throw error;
      }
    },
    runInteractiveTurn: async (inputTurn) => {
      if (inputTurn.interactiveMode) {
        beginTurn({});
      }
      try {
        const code = await inputTurn.operation();
        flushBufferedStderr();
        if (inputTurn.interactiveMode) {
          finishActiveTurn({
            result: resolveResult(code),
            exitCode: code === 0 || code === TURN_INTERRUPTED_EXIT_CODE ? undefined : code,
          });
        }
        return code;
      } catch (error) {
        flushBufferedStderr();
        if (inputTurn.interactiveMode) {
          finishActiveTurn({
            result: "error",
            exitCode: "<exception>",
          });
        }
        throw error;
      }
    },
  };
}
