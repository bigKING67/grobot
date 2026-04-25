import {
  normalizeResumeSearchQuery,
  resolveResumeQueryMatches,
} from "./session-resume-search";
import { type RunStartSessionSummary } from "./run-start-session-ops";

export type StartupResumeSessionSummary = RunStartSessionSummary;

export interface ResolveStartupResumeTargetInput {
  resumeRequested: boolean;
  resumeLastRequested: boolean;
  resumeAllRequested: boolean;
  resumeQuery?: string;
  sessions: ReadonlyArray<StartupResumeSessionSummary>;
}

export interface ResolveStartupResumeTargetResult {
  targetSessionId?: string;
  notice?: string;
  requiresDisambiguation?: boolean;
  disambiguationCandidates?: ReadonlyArray<StartupResumeSessionSummary>;
}

const STARTUP_RESUME_HINT_LIMIT = 3;

function formatStartupResumePreview(value: string, maxLength = 52): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "-";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function formatStartupResumeHints(matches: readonly StartupResumeSessionSummary[]): string {
  const rows = matches
    .slice(0, STARTUP_RESUME_HINT_LIMIT)
    .map((session) => `- ${session.id} | ${session.updatedAt} | ${formatStartupResumePreview(session.title)} | ${formatStartupResumePreview(session.summary)}`);
  if (matches.length > STARTUP_RESUME_HINT_LIMIT) {
    rows.push(`- ... and ${String(matches.length - STARTUP_RESUME_HINT_LIMIT)} more`);
  }
  return rows.join("\n");
}

export function resolveStartupResumeTarget(
  input: ResolveStartupResumeTargetInput,
): ResolveStartupResumeTargetResult {
  const hasResumeIntent =
    input.resumeRequested
    || input.resumeLastRequested
    || input.resumeAllRequested;
  if (!hasResumeIntent) {
    return {};
  }
  const nonActiveSessions = input.sessions.filter((session) => !session.active);
  const fallbackTargetSessionId = nonActiveSessions[0]?.id;
  const queryRaw = input.resumeQuery?.trim() ?? "";
  const queryNormalized = queryRaw.length > 0
    ? normalizeResumeSearchQuery(queryRaw)
    : "";

  if (queryNormalized.length > 0) {
    const exactIdMatch = input.sessions.find((session) =>
      normalizeResumeSearchQuery(session.id) === queryNormalized);
    if (exactIdMatch) {
      return {
        targetSessionId: exactIdMatch.id,
      };
    }
    const queryScope = input.resumeAllRequested ? input.sessions : nonActiveSessions;
    const matches = resolveResumeQueryMatches(queryRaw, queryScope);
    if (matches.length === 1) {
      return {
        targetSessionId: matches[0]?.id,
      };
    }
    if (matches.length > 1) {
      const picked = matches[0];
      const hints = formatStartupResumeHints(matches);
      return {
        targetSessionId: picked?.id,
        requiresDisambiguation: true,
        disambiguationCandidates: matches,
        notice:
          `[session] --resume query "${queryRaw}" matched ${String(matches.length)} sessions.\n`
          + `${hints}\n`
          + "[session] Tip: use --resume <session-id> for deterministic startup resume.\n",
      };
    }
    if (fallbackTargetSessionId) {
      return {
        targetSessionId: fallbackTargetSessionId,
        notice:
          `[session] --resume query "${queryRaw}" has no match; fallback to latest resumable session "${fallbackTargetSessionId}".\n\n`,
      };
    }
    return {
      notice:
        `[session] --resume query "${queryRaw}" has no match and no resumable session found.\n\n`,
    };
  }

  if (fallbackTargetSessionId) {
    return {
      targetSessionId: fallbackTargetSessionId,
    };
  }
  return {
    notice: "[session] --resume requested but no resumable session found.\n\n",
  };
}
