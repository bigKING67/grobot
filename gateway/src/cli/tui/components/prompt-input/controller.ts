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
    if (raw !== "\u001b") {
      return;
    }
    const now = Date.now();
    if (now - escArmedAt < 150) {
      return;
    }
    escArmedAt = now;
    process.stdout.write("\n");
    triggerEscInterrupt("running");
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
    while (true) {
      const inputResult = await readPromptInputTurn({
        resolvedPrompt: resolvePromptLayoutValue(),
        menuInput,
        keypressInput,
        controls,
        options,
        getPauseDepth: () => pauseDepth,
        getEscArmedAt: () => escArmedAt,
        setEscArmedAt: (value) => {
          escArmedAt = value;
        },
        triggerEscInterrupt,
      });
      if (inputResult.kind === "sigint") {
        process.stdout.write("已中断\n");
        break;
      }
      handlerRunning = true;
      menuInput.on?.("data", onEscDataWhileHandler);
      let action: "continue" | "break";
      try {
        setRawMode(true);
        action = await handler(inputResult.value, controls);
      } finally {
        menuInput.off?.("data", onEscDataWhileHandler);
        handlerRunning = false;
      }
      if (action === "break") {
        break;
      }
    }
  } finally {
    menuInput.off?.("data", onEscDataWhileHandler);
    setRawMode(false);
    menuInput.pause?.();
  }
}
