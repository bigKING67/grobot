import {
  type KeypressInputStream,
  type KeypressPayload,
  type MenuInputStream,
} from "../../../cli/tui/components/prompt-input/contract";
import { readPromptInputTurn } from "../../../cli/tui/components/prompt-input/turn-controller";
import type { ContractPayload } from "./helpers";

type MockPromptInputStream =
  & MockEventEmitter
  & MenuInputStream
  & KeypressInputStream;

class MockEventEmitter {
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: string, listener: (...args: unknown[]) => void): this {
    const listeners = this.listeners.get(event) ?? new Set<(...args: unknown[]) => void>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: string, listener: (...args: unknown[]) => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const listeners = this.listeners.get(event);
    if (!listeners || listeners.size === 0) {
      return false;
    }
    for (const listener of Array.from(listeners)) {
      listener(...args);
    }
    return true;
  }
}

function createMockPromptInputStream(): MockPromptInputStream {
  const stream = new MockEventEmitter() as MockPromptInputStream;
  stream.isTTY = true;
  stream.setRawMode = () => {};
  stream.resume = () => {};
  stream.pause = () => {};
  stream.setEncoding = () => {};
  return stream;
}

async function withSuppressedStdout<T>(operation: () => Promise<T>): Promise<T> {
  const stdout = process.stdout as unknown as {
    write: (chunk: unknown, ...args: unknown[]) => boolean;
  };
  const originalWrite = stdout.write;
  stdout.write = (_chunk: unknown, ...args: unknown[]): boolean => {
    const callback = args.find((arg): arg is () => void => typeof arg === "function");
    callback?.();
    return true;
  };
  try {
    return await operation();
  } finally {
    stdout.write = originalWrite;
  }
}

function emitKeypress(
  stream: MockEventEmitter,
  chunk: string | undefined,
  key: KeypressPayload,
): void {
  stream.emit("keypress", chunk, key);
}

export async function runPromptTurnRuntimeChecks(): Promise<ContractPayload> {
  const stream = createMockPromptInputStream();
  const result = await withSuppressedStdout(async () => {
    const turn = readPromptInputTurn({
      resolvedPrompt: {
        prefix: "",
        inlinePrompt: "> ",
        suffix: "",
      },
      menuInput: stream,
      keypressInput: stream,
      controls: {
        withInputPaused: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
      },
      options: {},
      initialInput: "ad",
      getPauseDepth: () => 0,
      getEscArmedAt: () => 0,
      setEscArmedAt: () => {},
      triggerEscInterrupt: () => {},
    });
    queueMicrotask(() => {
      emitKeypress(stream, "", { name: "left", sequence: "\u001B[D" });
      emitKeypress(stream, undefined, { name: "paste-start", sequence: "\u001B[200~" });
      emitKeypress(stream, "X", { name: "x", sequence: "X" });
      emitKeypress(stream, "\n", { name: "enter", sequence: "\n" });
      emitKeypress(stream, "Y", { name: "y", sequence: "Y" });
      emitKeypress(stream, "\t", { name: "tab", sequence: "\t" });
      emitKeypress(stream, undefined, { name: "paste-end", sequence: "\u001B[201~" });
      stream.emit("data", "\u001B[200~X\nY\t\u001B[201~");
      setTimeout(() => {
        emitKeypress(stream, "\r", { name: "return", sequence: "\r" });
      }, 0);
    });
    return await turn;
  });
  const value = result.kind === "submit" ? result.value : "";
  return {
    prompt_runtime_bracketed_paste_inserts_at_cursor:
      value === "aX\nY    d",
    prompt_runtime_bracketed_paste_suppresses_payload_keypresses:
      value !== "ad" && value !== "aXYd",
  };
}
