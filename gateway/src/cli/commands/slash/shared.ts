import { terminalStyle } from "../../tui/theme/terminal-style";
import { type SessionInteractiveAction } from "../../start/session-interactive";
import { type SlashCommandExecutionInput } from "./types";

export function buildSlashNotice(
  title: string,
  details: readonly string[],
): string {
  const lines = [`${terminalStyle.accent("●")} ${title}`];
  for (const detail of details) {
    lines.push(`  ${terminalStyle.muted(detail)}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function matchesInteractiveCommand(
  input: string,
  command: string,
): boolean {
  return input === command || input.startsWith(`${command} `);
}

export function matchesUserCommandsManagementCommand(inputRaw: string): boolean {
  const input = inputRaw.trim();
  return /^\/commands(?:\s|$)/i.test(input);
}

export function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY);
}

export function formatSingleLinePreview(
  value: string,
  maxLength = 56,
): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "-";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  const head = Math.max(1, maxLength - 1);
  return `${normalized.slice(0, head).trimEnd()}…`;
}

export async function writeMenuHintAndMaybeOpen(
  input: SlashCommandExecutionInput,
  menu: "resume" | "rewind",
  message: string,
): Promise<SessionInteractiveAction> {
  input.handlers.writeStdout(message);
  if (isInteractiveTerminal()) {
    await input.handlers.openSessionMenu(menu, input.controls.withInputPaused);
  }
  return "continue";
}
