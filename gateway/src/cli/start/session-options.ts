import { Platform, SessionScope } from "../../models/types";
import { hasFlag, OptionValue, readOptionString, readOptionStringAny } from "../cli-args";

const DEFAULT_HISTORY_TURNS = 12;
const MAX_HISTORY_TURNS = 64;
const DEFAULT_HANDOFF_RECENT_TURNS = 6;
const MAX_HANDOFF_RECENT_TURNS = 20;
export type StartupRewindMode = "both" | "conversation" | "code" | "summarize";

function parseBoolValue(raw: string | undefined, defaultValue: boolean): boolean {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return defaultValue;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return defaultValue;
}

function parsePositiveIntOption(
  raw: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }
  return Math.max(minimum, Math.min(maximum, parsed));
}

export function parsePlatform(raw: string | undefined): Platform {
  if (raw === "telegram") {
    return "telegram";
  }
  return "feishu";
}

export function parseScope(raw: string | undefined): SessionScope {
  if (raw === "group") {
    return "group";
  }
  return "dm";
}

export function resolveSessionScopeOption(options: Record<string, OptionValue>): string | undefined {
  return readOptionStringAny(options, ["session-scope", "scope"]);
}

export function resolveSessionSubjectOption(options: Record<string, OptionValue>): string | undefined {
  return readOptionStringAny(options, ["session-subject", "subject"]);
}

export function resolveSessionPlatformOption(options: Record<string, OptionValue>): string | undefined {
  return readOptionString(options, "platform");
}

export function resolveHistoryTurns(options: Record<string, OptionValue>): number {
  return parsePositiveIntOption(
    readOptionString(options, "history-turns"),
    DEFAULT_HISTORY_TURNS,
    1,
    MAX_HISTORY_TURNS,
  );
}

export function resolveHandoffRecentTurns(options: Record<string, OptionValue>): number {
  return parsePositiveIntOption(
    readOptionString(options, "handoff-recent-turns"),
    DEFAULT_HANDOFF_RECENT_TURNS,
    1,
    MAX_HANDOFF_RECENT_TURNS,
  );
}

export function resolveHandoffAutoOnExit(options: Record<string, OptionValue>): boolean {
  if (hasFlag(options, "handoff-auto-on-exit")) {
    return true;
  }
  if (hasFlag(options, "no-handoff-auto-on-exit")) {
    return false;
  }
  const raw = process.env.GROBOT_HANDOFF_AUTO_ON_EXIT;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return parseBoolValue(raw, true);
  }
  return true;
}

export function resolveResumeRequested(options: Record<string, OptionValue>): boolean {
  return Object.prototype.hasOwnProperty.call(options, "resume")
    || hasFlag(options, "resume-last")
    || hasFlag(options, "resume-all");
}

export function resolveResumeSelector(options: Record<string, OptionValue>): string | undefined {
  return readOptionString(options, "resume");
}

export function resolveResumeLastRequested(options: Record<string, OptionValue>): boolean {
  return hasFlag(options, "resume-last");
}

export function resolveResumeAllRequested(options: Record<string, OptionValue>): boolean {
  return hasFlag(options, "resume-all");
}

export function resolveForkSession(options: Record<string, OptionValue>): boolean {
  return hasFlag(options, "fork-session");
}

export function resolveResumeSessionAt(options: Record<string, OptionValue>): string | undefined {
  return readOptionString(options, "resume-session-at");
}

function normalizeRewindMode(raw: string | undefined): StartupRewindMode | undefined {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (normalized === "both") {
    return "both";
  }
  if (normalized === "conversation") {
    return "conversation";
  }
  if (normalized === "code") {
    return "code";
  }
  if (normalized === "summarize" || normalized === "summary") {
    return "summarize";
  }
  return undefined;
}

export function resolveRewindRequested(options: Record<string, OptionValue>): boolean {
  return Object.prototype.hasOwnProperty.call(options, "rewind");
}

export function resolveRewindSelector(options: Record<string, OptionValue>): string | undefined {
  return readOptionString(options, "rewind");
}

export function resolveRewindMode(options: Record<string, OptionValue>): StartupRewindMode {
  const explicit = normalizeRewindMode(readOptionString(options, "rewind-mode"));
  if (explicit) {
    return explicit;
  }
  return readOptionString(options, "rewind-files") ? "code" : "both";
}

export function resolveRewindFiles(options: Record<string, OptionValue>): string[] | undefined {
  const raw = readOptionString(options, "rewind-files");
  if (!raw) {
    return undefined;
  }
  const values = raw
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (values.length === 0) {
    return undefined;
  }
  return values;
}
