import * as readlineModule from "node:readline";
import {
  resolveInteractivePromptLayout,
  type SessionPromptLayout,
} from "../../interactive/interactive-frame";
import {
  DEFAULT_SESSION_PROMPT,
  type KeypressInputStream,
  type MenuInputStream,
  type SessionEscapeInterruptPhase,
  type SessionInputLoopControls,
  type SessionInputLoopOptions,
  type SessionInputPrompt,
  type SessionInputPromptValue,
} from "./contract";
import { runTerminalLinePrompt } from "./line-prompt";
import { resolveRunningInputActions } from "./reducer";
import { readPromptInputTurn } from "./turn-controller";

export { runTerminalLinePrompt } from "./line-prompt";

function emitKeypressEventsCompat(input: unknown): void {
  const maybeEmit = (readlineModule as unknown as {
    emitKeypressEvents?: (stream: unknown) => void;
  }).emitKeypressEvents;
  if (typeof maybeEmit === "function") {
    maybeEmit(input);
  }
}

function removeLastCodePoint(value: string): string {
  const codepoints = Array.from(value);
  codepoints.pop();
  return codepoints.join("");
}

async function runLineBufferedInputLoop(
  handler: (input: string, controls: SessionInputLoopControls) => Promise<"continue" | "break">,
  controls: SessionInputLoopControls,
): Promise<void> {
  let stdinContent = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    stdinContent += String(chunk);
  }
  const lines = stdinContent.split(/\r?\n/);
  for (const line of lines) {
    const action = await handler(line, controls);
    if (action === "break") {
      break;
    }
  }
}

export async function runSessionInputLoop(
  handler: (input: string, controls: SessionInputLoopControls) => Promise<"continue" | "break">,
  prompt: SessionInputPrompt = DEFAULT_SESSION_PROMPT,
  options: SessionInputLoopOptions = {},
): Promise<void> {
  const nonTtyControls: SessionInputLoopControls = {
    withInputPaused: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
  };
  if (!process.stdin.isTTY) {
    await runLineBufferedInputLoop(handler, nonTtyControls);
    return;
  }

  const menuInput = process.stdin as unknown as MenuInputStream;
  const keypressInput = process.stdin as unknown as KeypressInputStream;
  const canUseRawMode = Boolean(
    typeof menuInput.setRawMode === "function"
    && typeof menuInput.on === "function"
    && typeof menuInput.off === "function"
    && typeof keypressInput.on === "function"
    && typeof keypressInput.off === "function",
  );
  if (!canUseRawMode) {
    // Fallback for unusual TTY implementations.
    await runLineBufferedInputLoop(handler, nonTtyControls);
    return;
  }

  menuInput.setEncoding?.("utf8");
  emitKeypressEventsCompat(process.stdin);
  let rawModeEnabled = false;
  let pauseDepth = 0;
  let escArmedAt = 0;
  let handlerRunning = false;
  const queuedInputsWhileRunning: string[] = [];
  let runningInputBuffer = "";

  const setRawMode = (enabled: boolean): void => {
    if (rawModeEnabled === enabled) {
      return;
    }
    try {
      menuInput.setRawMode?.(enabled);
      rawModeEnabled = enabled;
    } catch {
      // ignore raw-mode transition failures
    }
  };

  const controls: SessionInputLoopControls = {
    withInputPaused: async <T>(operation: () => Promise<T>): Promise<T> => {
      pauseDepth += 1;
      if (pauseDepth === 1) {
        setRawMode(false);
      }
      try {
        return await operation();
      } finally {
        pauseDepth = Math.max(0, pauseDepth - 1);
        if (pauseDepth === 0) {
          setRawMode(true);
        }
      }
    },
  };

  const triggerEscInterrupt = (phase: SessionEscapeInterruptPhase): void => {
    if (typeof options.onEscapeInterrupt !== "function") {
      return;
    }
    const maybePromise = options.onEscapeInterrupt(phase);
    if (typeof (maybePromise as Promise<void> | undefined)?.then === "function") {
      void maybePromise;
    }
  };

  const onEscDataWhileHandler = (chunk: string): void => {
    if (!handlerRunning || pauseDepth > 0) {
      return;
    }
    const raw = String(chunk ?? "");
    for (const action of resolveRunningInputActions(raw)) {
      if (action.kind === "interrupt") {
        if (raw === "\u001b") {
          const now = Date.now();
          if (now - escArmedAt < 150) {
            return;
          }
          escArmedAt = now;
        }
        process.stdout.write("\n");
        triggerEscInterrupt("running");
        return;
      }
      if (action.kind === "submit_queue") {
        const queued = runningInputBuffer.trim();
        runningInputBuffer = "";
        if (!queued) {
          return;
        }
        queuedInputsWhileRunning.push(queued);
        if (typeof options.onQueueInputWhileRunning === "function") {
          options.onQueueInputWhileRunning(queued);
        } else {
          process.stdout.write("\n");
        }
        return;
      }
      if (action.kind === "backspace") {
        runningInputBuffer = removeLastCodePoint(runningInputBuffer);
        return;
      }
      if (action.kind === "append") {
        runningInputBuffer += action.value;
      }
    }
  };

  const runHandlerWithRunningCapture = async (value: string): Promise<"continue" | "break"> => {
    handlerRunning = true;
    menuInput.on?.("data", onEscDataWhileHandler);
    try {
      setRawMode(true);
      return await handler(value, controls);
    } finally {
      menuInput.off?.("data", onEscDataWhileHandler);
      handlerRunning = false;
    }
  };

  const resolvePromptLayoutValue = (): SessionPromptLayout => {
    const promptValue: SessionInputPromptValue = typeof prompt === "function"
      ? (() => {
        try {
          const dynamicPrompt = prompt();
          if (
            (typeof dynamicPrompt === "string" && dynamicPrompt.length > 0)
            || typeof dynamicPrompt === "object"
          ) {
            return dynamicPrompt;
          }
        } catch {
          // fallback to default prompt
        }
        return DEFAULT_SESSION_PROMPT;
      })()
      : prompt;
    return resolveInteractivePromptLayout({
      promptText: promptValue,
      fallbackPrompt: DEFAULT_SESSION_PROMPT,
    });
  };

  try {
    setRawMode(true);
    menuInput.resume?.();
    let shouldExit = false;
    while (true) {
      const inputResult = await readPromptInputTurn({
        resolvedPrompt: resolvePromptLayoutValue(),
        menuInput,
        keypressInput,
        controls,
        options,
        initialInput: runningInputBuffer,
        getPauseDepth: () => pauseDepth,
        getEscArmedAt: () => escArmedAt,
        setEscArmedAt: (value) => {
          escArmedAt = value;
        },
        triggerEscInterrupt,
      });
      if (inputResult.kind === "sigint") {
        process.stdout.write("Interrupted\n");
        break;
      }
      runningInputBuffer = "";
      const action = await runHandlerWithRunningCapture(inputResult.value);
      if (action === "break") {
        break;
      }
      while (queuedInputsWhileRunning.length > 0) {
        const queued = queuedInputsWhileRunning.shift();
        if (typeof queued !== "string") {
          continue;
        }
        options.onQueuedInputConsumed?.(queued);
        const queuedAction = await runHandlerWithRunningCapture(queued);
        if (queuedAction === "break") {
          shouldExit = true;
          break;
        }
      }
      runningInputBuffer = "";
      if (shouldExit) {
        break;
      }
    }
  } finally {
    menuInput.off?.("data", onEscDataWhileHandler);
    setRawMode(false);
    menuInput.pause?.();
  }
}
