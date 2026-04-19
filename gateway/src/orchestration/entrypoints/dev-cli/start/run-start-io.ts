import { mkdirSync, writeFileSync } from "node:fs";
import { createInterface, Interface } from "node:readline";
import * as readlineModule from "node:readline";
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
  getSlashSuggestions?: (input: string) => readonly SessionSlashSuggestion[];
}

export type SessionInputPrompt = string | (() => string);

export interface SessionSlashSuggestion {
  command: string;
  description?: string;
  source?: string;
}

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

interface ReadlineState extends Interface {
  line: string;
}

interface KeypressPayload {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

interface KeypressInputStream {
  on?: (event: "keypress", listener: (chunk: string, key: KeypressPayload) => void) => void;
  off?: (event: "keypress", listener: (chunk: string, key: KeypressPayload) => void) => void;
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

function splitPromptForReadline(promptText: string): {
  prefix: string;
  inlinePrompt: string;
} {
  if (!promptText.includes("\n")) {
    return {
      prefix: "",
      inlinePrompt: promptText.length > 0 ? promptText : DEFAULT_SESSION_PROMPT,
    };
  }
  const lines = promptText.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  if (lines.length === 0) {
    return {
      prefix: "",
      inlinePrompt: DEFAULT_SESSION_PROMPT,
    };
  }
  const inlinePrompt = lines.pop() ?? DEFAULT_SESSION_PROMPT;
  return {
    prefix: lines.join("\n"),
    inlinePrompt: inlinePrompt.length > 0 ? inlinePrompt : DEFAULT_SESSION_PROMPT,
  };
}

function truncateInlineText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 1) {
    return value.slice(0, Math.max(0, maxLength));
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function resolveSlashOverlayColumns(): number {
  const stdoutState = process.stdout as unknown as {
    isTTY?: boolean;
    columns?: number;
  };
  if (
    stdoutState.isTTY
    && typeof stdoutState.columns === "number"
    && Number.isFinite(stdoutState.columns)
    && stdoutState.columns > 0
  ) {
    return Math.floor(stdoutState.columns);
  }
  return 96;
}

function commandHasArgumentPlaceholder(command: string): boolean {
  return /<[^>]+>|\[[^\]]+\]/.test(command);
}

function toOverlayBoxLine(content: string, innerWidth: number): string {
  const normalized = truncateInlineText(content, innerWidth);
  return `| ${normalized.padEnd(innerWidth, " ")} |`;
}

function normalizeSuggestionIndex(itemsLength: number, index: number): number {
  if (itemsLength <= 0) {
    return 0;
  }
  const normalized = index % itemsLength;
  if (normalized < 0) {
    return normalized + itemsLength;
  }
  return normalized;
}

function replaceReadlineInputLine(rl: Interface, value: string): void {
  const writer = rl as unknown as {
    write(data: string | null, key?: { ctrl?: boolean; name?: string }): void;
  };
  writer.write(null, {
    ctrl: true,
    name: "u",
  });
  if (value.length > 0) {
    writer.write(value);
  }
}

function formatSlashSuggestionPanel(
  suggestions: readonly SessionSlashSuggestion[],
  lineInput: string,
  selectedIndex: number,
  terminalColumns: number,
): string {
  const trimmed = lineInput.trimStart();
  if (!trimmed.startsWith("/")) {
    return "";
  }
  if (suggestions.length === 0) {
    return "";
  }
  const limited = suggestions.slice(0, 8);
  const normalizedSelectedIndex = normalizeSuggestionIndex(limited.length, selectedIndex);
  const selected = limited[normalizedSelectedIndex];
  const rows = limited.map((item, index) => {
    const isSelected = index === normalizedSelectedIndex;
    const source = item.source ? ` (${item.source})` : "";
    const detail = item.description?.trim().length ? ` - ${item.description.trim()}` : "";
    const pointer = isSelected ? ">" : " ";
    return `${pointer} ${item.command}${source}${detail}`;
  });
  const selectedHint = selected
    ? commandHasArgumentPlaceholder(selected.command)
      ? `hint: fill args for ${selected.command}`
      : `hint: ready to run ${selected.command}`
    : "hint: select a command";
  const keyHint = "keys: Up/Down select | Tab complete | Enter run selected";
  const title = `commands ${suggestions.length > limited.length
    ? `(${String(limited.length)}/${String(suggestions.length)})`
    : `(${String(limited.length)})`}`;

  const allLines = [title, ...rows, selectedHint, keyHint];
  const desiredInnerWidth = allLines.reduce((max, line) => Math.max(max, line.length), 0);
  const maxInnerWidth = Math.max(16, terminalColumns - 4);
  const innerWidth = Math.min(Math.max(16, desiredInnerWidth), maxInnerWidth);
  const divider = `+${"-".repeat(innerWidth + 2)}+`;
  const lines: string[] = [];
  lines.push(divider);
  lines.push(toOverlayBoxLine(title, innerWidth));
  lines.push(divider);
  for (const row of rows) {
    lines.push(toOverlayBoxLine(row, innerWidth));
  }
  lines.push(divider);
  lines.push(toOverlayBoxLine(selectedHint, innerWidth));
  lines.push(toOverlayBoxLine(keyHint, innerWidth));
  lines.push(divider);
  return `${lines.join("\n")}\n`;
}

function buildSlashSuggestionCompleter(
  getSlashSuggestions: (input: string) => readonly SessionSlashSuggestion[],
): (line: string) => [string[], string] {
  return (line: string): [string[], string] => {
    const leadingSpaces = line.length - line.trimStart().length;
    const candidate = line.slice(leadingSpaces);
    if (!candidate.startsWith("/")) {
      return [[], candidate];
    }
    const suggestions = getSlashSuggestions(candidate);
    if (suggestions.length === 0) {
      return [[], candidate];
    }
    const completions = suggestions.map((item) => `${item.command} `);
    return [completions, candidate];
  };
}

function emitKeypressEventsCompat(input: unknown, rl: Interface): void {
  const maybeEmit = (readlineModule as unknown as {
    emitKeypressEvents?: (stream: unknown, iface?: Interface) => void;
  }).emitKeypressEvents;
  if (typeof maybeEmit === "function") {
    maybeEmit(input, rl);
  }
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

  const completer = typeof options.getSlashSuggestions === "function"
    ? buildSlashSuggestionCompleter(options.getSlashSuggestions)
    : undefined;
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    completer,
  } as unknown as {
    input: unknown;
    output?: unknown;
  });
  const readlineState = rl as ReadlineState;
  let sawSigint = false;
  rl.on("SIGINT", () => {
    sawSigint = true;
    rl.close();
  });
  const pauseableInput = process.stdin as unknown as PauseableInput;
  const menuInput = process.stdin as unknown as MenuInputStream;
  const keypressInput = process.stdin as unknown as KeypressInputStream;
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
  let slashOverlayVisible = false;
  let activeSlashSuggestions: readonly SessionSlashSuggestion[] = [];
  let activeSlashSuggestionIndex = 0;
  let lastSlashLineInput = "";
  let lastSlashOverlaySignature = "";
  const escInputSupported = Boolean(
    options.onEscapeInterrupt
    && typeof menuInput.setRawMode === "function"
    && typeof menuInput.on === "function"
    && typeof menuInput.off === "function",
  );

  const clearSlashSuggestionOverlay = (): void => {
    if (!slashOverlayVisible) {
      return;
    }
    process.stdout.write("\x1b[s");
    process.stdout.write("\x1b[E");
    process.stdout.write("\x1b[J");
    process.stdout.write("\x1b[u");
    slashOverlayVisible = false;
    activeSlashSuggestions = [];
    activeSlashSuggestionIndex = 0;
    lastSlashLineInput = "";
    lastSlashOverlaySignature = "";
  };

  const refreshSlashSuggestionOverlay = (): void => {
    if (handlerRunning || typeof options.getSlashSuggestions !== "function") {
      clearSlashSuggestionOverlay();
      return;
    }
    const lineInput = readlineState.line ?? "";
    if (lineInput !== lastSlashLineInput) {
      activeSlashSuggestionIndex = 0;
      lastSlashLineInput = lineInput;
    }
    const suggestions = options.getSlashSuggestions(lineInput);
    activeSlashSuggestions = suggestions;
    if (activeSlashSuggestions.length === 0) {
      activeSlashSuggestionIndex = 0;
    } else {
      activeSlashSuggestionIndex = normalizeSuggestionIndex(
        activeSlashSuggestions.length,
        activeSlashSuggestionIndex,
      );
    }
    const panel = formatSlashSuggestionPanel(
      activeSlashSuggestions,
      lineInput,
      activeSlashSuggestionIndex,
      resolveSlashOverlayColumns(),
    );
    const signature = panel.length > 0 ? panel : "<empty>";
    if (signature === lastSlashOverlaySignature) {
      return;
    }
    process.stdout.write("\x1b[s");
    process.stdout.write("\x1b[E");
    process.stdout.write("\x1b[J");
    if (panel.length > 0) {
      process.stdout.write(panel);
      slashOverlayVisible = true;
    } else {
      slashOverlayVisible = false;
    }
    process.stdout.write("\x1b[u");
    lastSlashOverlaySignature = signature;
  };

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

  const onKeypress = (_chunk: string, key: KeypressPayload): void => {
    if (handlerRunning || typeof options.getSlashSuggestions !== "function") {
      return;
    }
    const lineBefore = readlineState.line ?? "";
    const hasActiveSlashSuggestions = lineBefore.trimStart().startsWith("/")
      && activeSlashSuggestions.length > 0;
    if (hasActiveSlashSuggestions && key.name === "up") {
      activeSlashSuggestionIndex = normalizeSuggestionIndex(
        activeSlashSuggestions.length,
        activeSlashSuggestionIndex - 1,
      );
      queueMicrotask(() => {
        if ((readlineState.line ?? "") !== lineBefore) {
          replaceReadlineInputLine(rl, lineBefore);
        }
        refreshSlashSuggestionOverlay();
      });
      return;
    }
    if (hasActiveSlashSuggestions && key.name === "down") {
      activeSlashSuggestionIndex = normalizeSuggestionIndex(
        activeSlashSuggestions.length,
        activeSlashSuggestionIndex + 1,
      );
      queueMicrotask(() => {
        if ((readlineState.line ?? "") !== lineBefore) {
          replaceReadlineInputLine(rl, lineBefore);
        }
        refreshSlashSuggestionOverlay();
      });
      return;
    }
    if (hasActiveSlashSuggestions && key.name === "return") {
      const selected = activeSlashSuggestions[activeSlashSuggestionIndex];
      if (selected?.command) {
        replaceReadlineInputLine(rl, selected.command);
        activeSlashSuggestionIndex = 0;
      }
      return;
    }
    if (key.ctrl && key.name === "c") {
      return;
    }
    queueMicrotask(() => {
      if (handlerRunning) {
        return;
      }
      refreshSlashSuggestionOverlay();
    });
  };

  emitKeypressEventsCompat(process.stdin, rl);
  keypressInput.on?.("keypress", onKeypress);

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
      const resolvedPrompt = splitPromptForReadline(promptText);
      clearSlashSuggestionOverlay();
      if (resolvedPrompt.prefix.length > 0) {
        process.stdout.write(`${resolvedPrompt.prefix}\n`);
      }
      rawInput = await questionAsync(rl, resolvedPrompt.inlinePrompt);
    } catch {
      break;
    }
    clearSlashSuggestionOverlay();
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

  clearSlashSuggestionOverlay();
  keypressInput.off?.("keypress", onKeypress);
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
