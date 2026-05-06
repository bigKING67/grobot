import { type createCliUiRenderer } from "../../../cli/tui/kernel/renderer";
import { measureDisplayWidth } from "../../../cli/tui/terminal/display-width";
import { type StartScreenViewModel } from "../../../cli/tui/components/startup/contract";
import { type TerminalSelectMenuInput } from "../../../cli/tui/components/select-menu/contract";

export function hasAnsi(text: string): boolean {
  return /\x1b\[[0-9;?]+[A-Za-z]/.test(text);
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]+[A-Za-z]/g, "");
}

export function renderStartupAtColumns(
  renderer: ReturnType<typeof createCliUiRenderer>,
  viewModel: StartScreenViewModel,
  columns: number,
): string {
  return renderer.renderStartupScreen(viewModel, {
    terminalColumns: columns,
  });
}

export function renderSelectAtColumns(
  renderer: ReturnType<typeof createCliUiRenderer>,
  menu: TerminalSelectMenuInput,
  activeIndex: number,
  columns: number,
): string {
  return renderer.renderSelectMenu(menu, activeIndex, {
    terminalColumns: columns,
  });
}

export function renderedLinesWithinColumns(rendered: string, columns: number): boolean {
  return stripAnsi(rendered)
    .split("\n")
    .every((line) => measureDisplayWidth(line) <= columns);
}

export function renderedMenuRows(rendered: string): string[] {
  return stripAnsi(rendered)
    .split("\n")
    .filter((line) => /^(?:[›❯↑↓]\s*)?\d+\./.test(line.trimStart()));
}

export function extractStartupBodyLines(rendered: string): string[] {
  return stripAnsi(rendered)
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .filter((line) => !/^Grobot\b/.test(line.trimStart()));
}

export function extractRightPanelSegment(line: string): string | undefined {
  const parts = line.split("│");
  if (parts.length === 2) {
    return parts[1]?.trim();
  }
  if (parts.length < 4) {
    return undefined;
  }
  return parts[2]?.trim();
}
