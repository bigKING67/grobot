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

function resolveMenuPrimaryAction(hintRaw: string): "select" | "apply" | "continue" {
  const hint = hintRaw.toLowerCase();
  if (hint.includes("apply")) {
    return "apply";
  }
  if (hint.includes("continue")) {
    return "continue";
  }
  return "select";
}

function buildCompactMenuHint(hintRaw?: string): string {
  const fallback = "↑/↓ or j/k · Enter/Space select · Esc back";
  if (!hintRaw || hintRaw.trim().length === 0) {
    return fallback;
  }
  const lower = hintRaw.toLowerCase();
  const action = resolveMenuPrimaryAction(hintRaw);
  const segments: string[] = [
    "↑/↓ or j/k",
    ...(lower.includes("ctrl+n/p") ? ["Ctrl+n/p"] : []),
    ...(lower.includes("number to select directly") || lower.includes("number")
      ? ["1-9 jump"]
      : []),
    `Enter/Space ${action}`,
    "Esc back",
  ];
  return Array.from(new Set(segments)).join(" · ");
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
    lines.push(theme.color("muted", input.menu.subtitle.trim()));
  }
  lines.push("");
  for (let index = 0; index < input.menu.items.length; index += 1) {
    const item = input.menu.items[index];
    const isActive = index === input.activeIndex;
    const pointer = isActive ? theme.pointer("❯") : " ";
    const number = isActive
      ? theme.color("accent", `${String(index + 1)}.`)
      : theme.color("muted", `${String(index + 1)}.`);
    const label = isActive ? theme.color("accent", item.label) : item.label;
    const currentTag = item.current ? ` ${theme.currentTag("✓")}` : "";
    const description = item.description && item.description.trim().length > 0
      ? item.description.trim()
      : "";
    lines.push(`${pointer} ${number} ${label}${currentTag}`);
    if (description.length > 0) {
      lines.push(`  ${theme.color("muted", description)}`);
    }
  }
  lines.push("");
  lines.push(theme.color("muted", `  ${buildCompactMenuHint(input.menu.hint)}`));
  return lines.join("\n");
}
