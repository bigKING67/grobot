import { resolveCliRenderMode, type CliEnv } from "../kernel/render-mode";
import { createCliTheme } from "../theme/ansi-theme";

export interface TerminalSelectMenuItem {
  id: string;
  label: string;
  description?: string;
  current?: boolean;
}

export interface TerminalSelectMenuInput {
  title: string;
  subtitle?: string;
  hint?: string;
  items: TerminalSelectMenuItem[];
  initialIndex?: number;
}

export type TerminalSelectMenuResult =
  | { kind: "selected"; item: TerminalSelectMenuItem; index: number }
  | { kind: "cancelled" };

interface RenderTerminalSelectMenuInput {
  menu: TerminalSelectMenuInput;
  activeIndex: number;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  env?: CliEnv;
}

export function renderTerminalSelectMenu(input: RenderTerminalSelectMenuInput): string {
  const mode = resolveCliRenderMode({
    stdinIsTTY: input.stdinIsTTY,
    stdoutIsTTY: input.stdoutIsTTY,
    env: input.env,
  });
  const theme = createCliTheme(mode);
  const lines: string[] = [];
  lines.push(theme.bold(input.menu.title));
  if (input.menu.subtitle && input.menu.subtitle.trim().length > 0) {
    lines.push(input.menu.subtitle.trim());
  }
  lines.push("");
  for (let index = 0; index < input.menu.items.length; index += 1) {
    const item = input.menu.items[index];
    const isActive = index === input.activeIndex;
    const pointer = isActive ? theme.pointer("›") : " ";
    const number = `${String(index + 1)}.`;
    const label = isActive ? theme.color("accent", item.label) : item.label;
    const currentTag = item.current ? ` ${theme.currentTag("(current)")}` : "";
    const description = item.description && item.description.trim().length > 0
      ? item.description.trim()
      : "";
    const firstLine = `${pointer} ${number.padEnd(3)} ${label}${currentTag}`;
    if (description.length > 0) {
      lines.push(`${firstLine}  ${description}`);
    } else {
      lines.push(firstLine);
    }
  }
  lines.push("");
  lines.push(
    input.menu.hint
    ?? "Use ↑/↓ (or j/k, Ctrl+n/p), number to select directly, Enter/Space to confirm highlight, Esc to cancel.",
  );
  return lines.join("\n");
}
