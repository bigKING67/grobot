import { mkdirSync, writeFileSync } from "node:fs";
import { createInterface, Interface } from "node:readline";
import { removeTrailingSlashes } from "../services/runtime-paths";
import { createCliUiRenderer } from "../ui/kernel/renderer";
import { type TerminalSelectMenuInput, type TerminalSelectMenuResult } from "../ui/screens/select-menu-screen";

const HANDOFF_FILENAME = "HANDOFF.md";
const DEFAULT_SESSION_PROMPT = "› ";

export type {
  TerminalSelectMenuInput,
  TerminalSelectMenuItem,
  TerminalSelectMenuResult,
} from "../ui/screens/select-menu-screen";

export interface SessionInputLoopControls {
  withInputPaused<T>(operation: () => Promise<T>): Promise<T>;
}

export interface SessionInputLoopOptions {
  onEscapeInterrupt?: () => void | Promise<void>;
}

export type SessionInputPrompt = string | (() => string);

interface PauseableInput {
  pause?: () => void;
  resume?: () => void;
}

interface MenuInputStream {
  isTTY?: boolean;
  setRawMode?: (enabled: boolean) => void;
  on?: (event: "data", listener: (chunk: string) => void) => void;
  off?: (event: "data", listener: (chunk: string) => void) => void;
  resume?: () => void;
  setEncoding?: (encoding: string) => void;
}

function dirname(path: string): string {
  const normalized = removeTrailingSlashes(path);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function questionAsync(rl: Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (value) => {
      resolve(value);
    });
  });
}

export function buildHandoffPath(projectRoot: string): string {
  return `${projectRoot}/${HANDOFF_FILENAME}`;
}

export function writeHandoffFile(path: string, content: string): { ok: true } | { ok: false; error: string } {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
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
    let stdinContent = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      stdinContent += String(chunk);
    }
    const lines = stdinContent.split(/\r?\n/);
    for (const line of lines) {
      const action = await handler(line, nonTtyControls);
      if (action === "break") {
        break;
      }
    }
    return;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let sawSigint = false;
  rl.on("SIGINT", () => {
    sawSigint = true;
    rl.close();
  });
  const pauseableInput = process.stdin as unknown as PauseableInput;
  const menuInput = process.stdin as unknown as MenuInputStream;
  const controls: SessionInputLoopControls = {
    withInputPaused: async <T>(operation: () => Promise<T>): Promise<T> => {
      pauseableInput.pause?.();
      try {
        return await operation();
      } finally {
        pauseableInput.resume?.();
      }
      },
    };
    let handlerRunning = false;
    let escListenerAttached = false;
    let escArmedAt = 0;
    const escInputSupported = Boolean(
      options.onEscapeInterrupt
      && typeof menuInput.setRawMode === "function"
      && typeof menuInput.on === "function"
      && typeof menuInput.off === "function",
    );
    const triggerEscInterrupt = (): void => {
      if (typeof options.onEscapeInterrupt !== "function") {
        return;
      }
      const maybePromise = options.onEscapeInterrupt();
      if (typeof (maybePromise as Promise<void> | undefined)?.then === "function") {
        void maybePromise;
      }
    };
    const onEscData = (chunk: string): void => {
      if (!handlerRunning) {
        return;
      }
      const raw = String(chunk);
      if (raw !== "\u001b") {
        return;
      }
      const now = Date.now();
      if (now - escArmedAt < 150) {
        return;
      }
      escArmedAt = now;
      process.stdout.write("\n");
      triggerEscInterrupt();
    };
    const setEscListener = (enabled: boolean): void => {
      if (!escInputSupported) {
        return;
      }
      if (enabled) {
        if (escListenerAttached) {
          return;
        }
        menuInput.setEncoding?.("utf8");
        menuInput.on?.("data", onEscData);
        try {
          menuInput.setRawMode?.(true);
        } catch {
          menuInput.off?.("data", onEscData);
          return;
        }
        escListenerAttached = true;
        menuInput.resume?.();
        return;
      }
      if (!escListenerAttached) {
        return;
      }
      menuInput.off?.("data", onEscData);
      try {
        menuInput.setRawMode?.(false);
      } catch {
        // ignore raw mode restore errors
      }
      escListenerAttached = false;
    };
  while (true) {
    let rawInput = "";
    try {
      const promptText = typeof prompt === "function"
        ? (() => {
          try {
            const dynamicPrompt = prompt();
            if (typeof dynamicPrompt === "string" && dynamicPrompt.length > 0) {
              return dynamicPrompt;
            }
          } catch {
            // fallback to default prompt
          }
          return DEFAULT_SESSION_PROMPT;
        })()
        : prompt;
      rawInput = await questionAsync(rl, promptText);
    } catch {
      break;
    }
      if (sawSigint) {
        process.stdout.write("Interrupted\n");
        break;
      }
      handlerRunning = true;
      setEscListener(true);
      let action: "continue" | "break";
      try {
        action = await handler(rawInput, controls);
      } finally {
        setEscListener(false);
        handlerRunning = false;
      }
      if (action === "break") {
        break;
      }
    }
    setEscListener(false);
    rl.close();
  }

function normalizeMenuIndex(itemsLength: number, initialIndex: number | undefined): number {
  if (itemsLength <= 0) {
    return 0;
  }
  if (typeof initialIndex !== "number" || !Number.isFinite(initialIndex)) {
    return 0;
  }
  const rounded = Math.floor(initialIndex);
  if (rounded < 0) {
    return 0;
  }
  if (rounded >= itemsLength) {
    return itemsLength - 1;
  }
  return rounded;
}

function decodeMenuInput(rawInput: string): "up" | "down" | "enter" | "cancel" | "ignore" {
  if (rawInput.length === 0) {
    return "ignore";
  }
  if (rawInput.length === 1) {
    const firstChar = rawInput[0];
    if (firstChar === "\u0003" || firstChar === "\u001b") {
      return "cancel";
    }
    if (firstChar === "\r" || firstChar === "\n") {
      return "enter";
    }
    if (firstChar === "k") {
      return "up";
    }
    if (firstChar === "j") {
      return "down";
    }
    return "ignore";
  }
  if (rawInput.startsWith("\u001b[A") || rawInput.startsWith("\u001bOA")) {
    return "up";
  }
  if (rawInput.startsWith("\u001b[B") || rawInput.startsWith("\u001bOB")) {
    return "down";
  }
  return "ignore";
}

export async function runTerminalSelectMenu(input: TerminalSelectMenuInput): Promise<TerminalSelectMenuResult> {
  if (!process.stdin.isTTY || input.items.length === 0) {
    return { kind: "cancelled" };
  }
  const stdin = process.stdin as unknown as MenuInputStream;
  const setRawMode = stdin.setRawMode;
  const onInput = stdin.on;
  const offInput = stdin.off;
  const resumeInput = stdin.resume;
  if (
    typeof setRawMode !== "function" ||
    typeof onInput !== "function" ||
    typeof offInput !== "function" ||
    typeof resumeInput !== "function"
  ) {
    return { kind: "cancelled" };
  }

  const stdout = process.stdout;
  const uiRenderer = createCliUiRenderer({
    stdinIsTTY: process.stdin.isTTY,
  });
  let activeIndex = normalizeMenuIndex(input.items.length, input.initialIndex);
  let resolved = false;

  const render = (): void => {
    stdout.write("\x1b[2J\x1b[H");
    stdout.write(`${uiRenderer.renderSelectMenu(input, activeIndex)}\n`);
  };

  return await new Promise<TerminalSelectMenuResult>((resolve) => {
    const cleanup = (): void => {
      if (!resolved) {
        return;
      }
      offInput.call(stdin, "data", onData);
      try {
        setRawMode.call(stdin, false);
      } catch {
        // ignore raw mode teardown errors
      }
      stdout.write("\x1b[?25h");
      stdout.write("\x1b[?1049l");
    };

    const finish = (result: TerminalSelectMenuResult): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      cleanup();
      resolve(result);
    };

    const onData = (chunk: string): void => {
      const action = decodeMenuInput(chunk);
      if (action === "up") {
        activeIndex = (activeIndex - 1 + input.items.length) % input.items.length;
        render();
        return;
      }
      if (action === "down") {
        activeIndex = (activeIndex + 1) % input.items.length;
        render();
        return;
      }
      if (action === "enter") {
        finish({
          kind: "selected",
          item: input.items[activeIndex],
          index: activeIndex,
        });
        return;
      }
      if (action === "cancel") {
        finish({ kind: "cancelled" });
      }
    };

    stdout.write("\x1b[?1049h");
    stdout.write("\x1b[?25l");
    stdin.setEncoding?.("utf8");
    onInput.call(stdin, "data", onData);
    try {
      setRawMode.call(stdin, true);
    } catch {
      finish({ kind: "cancelled" });
      return;
    }
    resumeInput.call(stdin);
    render();
  });
}
