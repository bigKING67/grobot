import { type TurnExecutionReport } from "../../../models/types";
import { formatAskUserIssuedEvent } from "../../../tools/ask-user";
import { buildRuntimeToolTraceMemory } from "./diagnostics";
import {
  type CreateRunStartTurnRunnerInput,
  type RunStartTurnExecuteOptions,
} from "./contract";
import { buildTurnTerminalOutputSegments } from "./output";
import { resolveTerminalMarkdownMode } from "../../tui/interactive/terminal-markdown";
import { toAskUserEnvelopes } from "./ask-user";

export interface SuccessfulTurnReportPresentation {
  assistantTextForHistory: string;
  activityFeedStdout: string;
  turnStdout: string;
  askUserEvent: string;
}

export function prepareSuccessfulTurnReportPresentation(input: {
  runnerInput: CreateRunStartTurnRunnerInput;
  report: TurnExecutionReport;
  sessionKey: string;
  turnUserText: string;
  providerName: string;
  interactiveMode: boolean;
  options?: Pick<RunStartTurnExecuteOptions, "autoOpenAskUserPanel">;
  writeTurnDiagnostic(message: string): void;
  writeTurnDiagnosticEvents(events: readonly string[]): void;
}): SuccessfulTurnReportPresentation {
  const runtimeAskUser =
    input.report.runtimeInterrupt?.kind === "ask_user"
      ? input.report.runtimeInterrupt.askUser
      : undefined;
  let assistantTextForHistory = input.report.assistantMessage;
  const terminalOutputSegments = buildTurnTerminalOutputSegments({
    assistantMessage: input.report.assistantMessage,
    interactiveMode: input.interactiveMode,
    runtimeAskUser: Boolean(runtimeAskUser),
    events: input.report.events,
    terminalMarkdownMode: resolveTerminalMarkdownMode(
      process.env.GROBOT_TERMINAL_MARKDOWN,
    ),
    activityFeedDetailValue: process.env.GROBOT_ACTIVITY_FEED_DETAIL,
    activityFeedTranscriptValue:
      process.env.GROBOT_ACTIVITY_FEED_TRANSCRIPT,
  });
  const activityFeedStdout = terminalOutputSegments.activityFeed;
  let turnStdout = terminalOutputSegments.assistantOutput;
  let askUserEvent = "";

  if (runtimeAskUser) {
    const askUserEnvelopes = toAskUserEnvelopes(runtimeAskUser);
    for (const askUserEnvelope of askUserEnvelopes) {
      input.runnerInput.gaMechanismRuntime.registerPendingAsk(
        input.sessionKey,
        askUserEnvelope,
      );
    }
    const queueDepth =
      input.runnerInput.gaMechanismRuntime.getPendingAskQueueSize(input.sessionKey);
    const activeAskEnvelope =
      input.runnerInput.gaMechanismRuntime.getPendingAsk(input.sessionKey) ??
      askUserEnvelopes[0];
    if (!activeAskEnvelope) {
      throw new Error("ask_user interrupt emitted empty question set");
    }
    assistantTextForHistory = `Confirmation needed: ${activeAskEnvelope.question}`;
    turnStdout = input.interactiveMode
      ? input.options?.autoOpenAskUserPanel
        ? ""
        : "Input needed · Enter to choose\n\n"
      : input.runnerInput.gaMechanismRuntime.buildAskUserDisplay(activeAskEnvelope);
    askUserEvent = askUserEnvelopes
      .map((envelope) => formatAskUserIssuedEvent(envelope))
      .join("");
    const latestAskEnvelope =
      askUserEnvelopes[askUserEnvelopes.length - 1] ?? activeAskEnvelope;
    input.writeTurnDiagnostic(
      `[ask-user] event=interrupt_received ask_id=${activeAskEnvelope.askId} blocking_node_id=${activeAskEnvelope.blockingNodeId} ask_total=${String(askUserEnvelopes.length)}\n`,
    );
    if (queueDepth > 1) {
      input.writeTurnDiagnostic(
        `[ask-user] event=queued depth=${String(queueDepth)} active_ask_id=${activeAskEnvelope.askId} latest_ask_id=${latestAskEnvelope.askId}\n`,
      );
    }
    input.writeTurnDiagnostic(
      "[experience] event=publish_skipped reason=ask_user_interrupt\n",
    );
  } else {
    const toolTraceMemory = buildRuntimeToolTraceMemory({
      events: input.report.events,
      userText: input.turnUserText,
    });
    if (toolTraceMemory) {
      const ingestResult = input.runnerInput.memoryOrchestrator.ingest({
        eventType: "tool_success",
        sessionKey: input.sessionKey,
        text: toolTraceMemory.text,
        executionVerified:
          input.report.verification.pass && toolTraceMemory.failedCount === 0,
        evidenceRef: {
          traceId: input.report.traceId,
          turnId: toolTraceMemory.turnId,
          source: "runtime_tool_trace",
        },
        tags: [
          "runtime_tool_trace",
          toolTraceMemory.deferredCount > 0
            ? "tool_deferred"
            : "tool_observed",
        ],
        confidence: toolTraceMemory.deferredCount > 0 ? 0.68 : 0.76,
      });
      input.writeTurnDiagnosticEvents(ingestResult.stderrEvents);
    }
    const feedback = input.runnerInput.memoryOrchestrator.feedback({
      type: "turn_success",
      sessionKey: input.sessionKey,
      userText: input.turnUserText,
      assistantText: input.report.assistantMessage,
      traceId: input.report.traceId,
      requestId: input.report.requestId,
      providerName: input.providerName,
      verificationPass: input.report.verification.pass,
    });
    input.writeTurnDiagnosticEvents(feedback.stderrEvents);
  }

  return {
    assistantTextForHistory,
    activityFeedStdout,
    turnStdout,
    askUserEvent,
  };
}

export function writeSuccessfulTurnDiagnostics(input: {
  runnerInput: CreateRunStartTurnRunnerInput;
  report: TurnExecutionReport;
  providerName: string;
  attempts: number;
  stickyProvider: string | undefined;
  askUserEvent: string;
  writeTurnDiagnostic(message: string): void;
}): void {
  if (input.askUserEvent.length > 0) {
    input.writeTurnDiagnostic(input.askUserEvent);
  }
  input.writeTurnDiagnostic(
    `[execution] gateway=${input.runnerInput.executionPlane.gatewayImpl}(${input.runnerInput.executionPlane.gatewayImplSource}) runtime=${input.runnerInput.executionPlane.runtimeImpl}(${input.runnerInput.executionPlane.runtimeImplSource}) shadow=${input.runnerInput.executionPlane.shadowMode ? "on" : "off"}(${input.runnerInput.executionPlane.shadowModeSource})\n`,
  );
  input.writeTurnDiagnostic(
    `[runtime-model] base_url=${input.runnerInput.runtimeModelConfigSource.baseUrl} model=${input.runnerInput.runtimeModelConfigSource.model} provider_kind=${input.runnerInput.runtimeModelConfigSource.providerKind} api_key=${input.runnerInput.runtimeModelConfigSource.apiKey} timeout_ms=${input.runnerInput.runtimeModelConfigSource.timeoutMs}\n`,
  );
  input.writeTurnDiagnostic(
    `[runtime-route] provider=${input.providerName} attempts=${String(input.attempts)} failovers=${String(input.attempts - 1)} sticky=${input.stickyProvider ?? "<none>"} strategy=sticky+score\n`,
  );
  input.writeTurnDiagnostic(
    `[governance] plane=${input.report.governance.plane} decision=${input.report.governance.decision} score=${input.report.governance.score.toFixed(4)} gate=${input.report.governance.gatePassed ? "pass" : "fail"} action=${input.report.governance.suggestedAction}\n`,
  );
}
