import { renderInteractiveInputChromeLines, resolveInteractiveInputBodyWidth } from "../../tui/components/prompt-input/render";
import { measureDisplayWidth } from "../../tui/terminal/display-width";
import { type SessionPromptLayout } from "../../tui/interactive/interactive-frame";
import { resolveTerminalColumns } from "./prompt-surface";

export interface PendingInputFrameController {
  isEnabled(): boolean;
  enable(): void;
  disable(): void;
  clear(): void;
  render(): void;
  rerender(): void;
  renderAfterStdout(): void;
  renderAfterStderr(message: string): void;
}

export function createPendingInputFrameController(input: {
  inlineProgressSupported(): boolean;
  resolvePrompt(): SessionPromptLayout;
  ensureStdoutLineBoundary(): void;
}): PendingInputFrameController {
  let enabled = false;
  let lineCount = 0;
  let cursorLineIndex = 0;

  const clear = (): void => {
    if (!enabled || lineCount <= 0) {
      return;
    }
    process.stdout.write("\r");
    if (cursorLineIndex > 0) {
      process.stdout.write(`\x1b[${String(cursorLineIndex)}A`);
    }
    process.stdout.write("\x1b[J");
    lineCount = 0;
    cursorLineIndex = 0;
  };

  const render = (): void => {
    if (!enabled || !input.inlineProgressSupported() || lineCount > 0) {
      return;
    }
    const frame = buildPendingInputFrame(input.resolvePrompt());
    if (frame.lines.length <= 0) {
      return;
    }
    process.stdout.write(frame.lines.join("\n"));
    lineCount = frame.lines.length;
    cursorLineIndex = frame.cursorLineIndex;
    const linesDown = Math.max(0, frame.lines.length - 1 - frame.cursorLineIndex);
    if (linesDown > 0) {
      process.stdout.write(`\x1b[${String(linesDown)}A`);
    }
    process.stdout.write("\r");
    if (frame.cursorColumn > 0) {
      process.stdout.write(`\x1b[${String(frame.cursorColumn)}C`);
    }
  };

  const rerender = (): void => {
    if (!enabled) {
      return;
    }
    clear();
    render();
  };

  return {
    isEnabled: () => enabled,
    enable: () => {
      enabled = true;
    },
    disable: () => {
      enabled = false;
    },
    clear,
    render,
    rerender,
    renderAfterStdout: () => {
      if (enabled) {
        input.ensureStdoutLineBoundary();
      }
      render();
    },
    renderAfterStderr: (message) => {
      if (
        enabled
        && message.length > 0
        && !message.endsWith("\n")
      ) {
        process.stderr.write("\n");
      }
      render();
    },
  };
}

function buildPendingInputFrame(resolvedPrompt: SessionPromptLayout): {
  lines: string[];
  cursorLineIndex: number;
  cursorColumn: number;
} {
  const terminalColumns = Math.max(32, resolveTerminalColumns() ?? 96);
  const promptLabel = resolvedPrompt.inlinePrompt.length > 0
    ? resolvedPrompt.inlinePrompt
    : "❯ ";
  const promptLabelWidth = Math.max(1, measureDisplayWidth(promptLabel));
  const inputBodyWidth = resolveInteractiveInputBodyWidth({
    terminalColumns,
    promptLabelWidth,
  });
  const footerLines = (resolvedPrompt.suffix ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  return {
    lines: [
      ...renderInteractiveInputChromeLines({
        bodyLines: [`${promptLabel}`],
        inputBodyWidth,
      }),
      ...footerLines,
    ],
    cursorLineIndex: 1,
    cursorColumn: promptLabelWidth,
  };
}
