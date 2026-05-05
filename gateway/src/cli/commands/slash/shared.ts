import { type SessionInteractiveAction } from "../../start/session-interactive";
import { renderInfoPanel } from "../../tui/components/info-panel/render";
import { type SlashCommandExecutionInput } from "./types";

export interface SlashUsageEntry {
  command: string;
  description?: string;
}

export function formatUsageLine(value: string): string {
  return `Usage ${value}`;
}

export function buildSlashNotice(
  title: string,
  details: readonly string[],
): string {
  const normalized = details
    .map((detail) => detail.trim())
    .filter((detail) => detail.length > 0);
  const [primary, ...detailLines] = normalized;
  return renderInfoPanel({
    title,
    sections: [{
      rows: [{
        title: primary ?? "No details",
        detailLines,
      }],
    }],
  });
}

export function buildSlashUsageNotice(
  title: string,
  entries: readonly SlashUsageEntry[],
  footerLines?: readonly string[],
): string {
  return renderInfoPanel({
    title,
    sections: [{
      title: "Available entries",
      rows: entries.map((entry) => ({
        title: entry.command,
        detailLines: entry.description ? [entry.description] : [],
      })),
    }],
    footerLines,
  });
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
