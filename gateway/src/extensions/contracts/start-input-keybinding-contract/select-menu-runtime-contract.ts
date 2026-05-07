import {
  runTerminalSelectMenu,
} from "../../../cli/tui/components/select-menu/controller";
import type {
  TerminalSelectMenuInput,
  TerminalSelectMenuResult,
} from "../../../cli/tui/components/select-menu/contract";
import type { ContractPayload } from "./helpers";

type DataListener = (chunk: string) => void;

class MockMenuInputStream {
  readonly rawModeEvents: boolean[] = [];
  isTTY = true;
  private readonly listeners = new Set<DataListener>();

  on(event: "data", listener: DataListener): void {
    if (event === "data") {
      this.listeners.add(listener);
    }
  }

  off(event: "data", listener: DataListener): void {
    if (event === "data") {
      this.listeners.delete(listener);
    }
  }

  emitData(chunk: string): void {
    for (const listener of Array.from(this.listeners)) {
      listener(chunk);
    }
  }

  setRawMode(enabled: boolean): void {
    this.rawModeEvents.push(enabled);
  }

  resume(): void {}

  setEncoding(_encoding: string): void {}
}

class MockMenuOutputStream {
  readonly chunks: string[] = [];
  isTTY = false;
  columns = 80;

  write(chunk: string): boolean {
    this.chunks.push(String(chunk));
    return true;
  }
}

async function withMockTerminal<T>(
  stdin: MockMenuInputStream,
  stdout: MockMenuOutputStream,
  operation: () => Promise<T>,
): Promise<T> {
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin");
  const stdoutDescriptor = Object.getOwnPropertyDescriptor(process, "stdout");
  try {
    Object.defineProperty(process, "stdin", {
      value: stdin,
      configurable: true,
    });
    Object.defineProperty(process, "stdout", {
      value: stdout,
      configurable: true,
    });
    return await operation();
  } finally {
    if (stdinDescriptor) {
      Object.defineProperty(process, "stdin", stdinDescriptor);
    }
    if (stdoutDescriptor) {
      Object.defineProperty(process, "stdout", stdoutDescriptor);
    }
  }
}

async function withTimeout<T>(label: string, operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} timed out`));
        }, 500);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function runMenuRuntimeCase(input: {
  label: string;
  menu: TerminalSelectMenuInput;
  chunks: readonly string[];
}): Promise<{
  result: TerminalSelectMenuResult;
  rawModeEvents: readonly boolean[];
  renderedText: string;
}> {
  const stdin = new MockMenuInputStream();
  const stdout = new MockMenuOutputStream();
  return await withMockTerminal(stdin, stdout, async () => {
    const resultPromise = withTimeout(input.label, runTerminalSelectMenu(input.menu));
    queueMicrotask(() => {
      for (const chunk of input.chunks) {
        stdin.emitData(chunk);
      }
    });
    const result = await resultPromise;
    return {
      result,
      rawModeEvents: stdin.rawModeEvents,
      renderedText: stdout.chunks.join(""),
    };
  });
}

function rawModeRestored(events: readonly boolean[]): boolean {
  return events[0] === true && events[events.length - 1] === false;
}

export async function runSelectMenuRuntimeChecks(): Promise<ContractPayload> {
  const disabledMenu: TerminalSelectMenuInput = {
    title: "Select action",
    items: [
      { id: "run", label: "Run" },
      { id: "deploy", label: "Deploy", disabled: true },
    ],
  };
  const disabledEnter = await runMenuRuntimeCase({
    label: "select-menu disabled enter",
    menu: {
      ...disabledMenu,
      initialIndex: 1,
    },
    chunks: ["\r", "\u001b"],
  });
  const disabledNumeric = await runMenuRuntimeCase({
    label: "select-menu disabled numeric",
    menu: disabledMenu,
    chunks: ["2", "\u001b"],
  });
  const inlineDigit = await runMenuRuntimeCase({
    label: "select-menu inline digit",
    menu: {
      title: "Ready to implement?",
      variant: "plan_approval",
      items: [
        {
          id: "feedback",
          label: "Refine plan",
          input: {
            placeholder: "Tell Grobot what to adjust",
            showLabelWithValue: true,
          },
        },
        { id: "approve", label: "Confirm, implement plan" },
      ],
    },
    chunks: ["\t", "2", "\r"],
  });
  const searchEscape = await runMenuRuntimeCase({
    label: "select-menu search escape",
    menu: {
      title: "Select command",
      items: [
        { id: "alpha", label: "Alpha command" },
        { id: "beta", label: "Beta command" },
      ],
    },
    chunks: ["/", "a", "\u001b", "\r"],
  });

  return {
    select_menu_runtime_disabled_enter_does_not_finish:
      disabledEnter.result.kind === "cancelled"
      && rawModeRestored(disabledEnter.rawModeEvents),
    select_menu_runtime_disabled_numeric_does_not_finish:
      disabledNumeric.result.kind === "cancelled"
      && rawModeRestored(disabledNumeric.rawModeEvents),
    select_menu_runtime_tab_input_digit_stays_text:
      inlineDigit.result.kind === "selected"
      && inlineDigit.result.item.id === "feedback"
      && inlineDigit.result.inputValue === "2"
      && rawModeRestored(inlineDigit.rawModeEvents),
    select_menu_runtime_search_esc_exits_search_before_cancel:
      searchEscape.result.kind === "selected"
      && searchEscape.result.item.id === "alpha"
      && searchEscape.result.index === 0
      && rawModeRestored(searchEscape.rawModeEvents),
  };
}
