import {
  normalizeResumeSearchQuery,
  resolveResumeQueryMatches,
} from "../session/resume-search";
import { type RunStartSessionSummary } from "../session/ops";
import { renderInfoPanel } from "../../tui/components/info-panel/render";
import { measureDisplayWidth } from "../../tui/terminal/display-width";

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
    .flatMap((session) => [
      session.id,
      `${session.updatedAt} · title ${formatStartupResumePreview(session.title)}`,
      `summary ${formatStartupResumePreview(session.summary)}`,
    ]);
  if (matches.length > STARTUP_RESUME_HINT_LIMIT) {
    rows.push(`... ${String(matches.length - STARTUP_RESUME_HINT_LIMIT)} more`);
  }
  return rows.join("\n");
}

function renderStartupResumeNotice(input: {
  title: string;
  primary: string;
  detailLines?: readonly string[];
  footerLines?: readonly string[];
}): string {
  const widest = Math.max(
    measureDisplayWidth(input.title),
    measureDisplayWidth(input.primary) + 2,
    ...(input.detailLines ?? []).map((line) => measureDisplayWidth(line) + 8),
    ...(input.footerLines ?? []).map((line) => measureDisplayWidth(line)),
  );
  return renderInfoPanel({
    title: input.title,
    sections: [
      {
        rows: [
          {
            title: input.primary,
            detailLines: input.detailLines,
          },
        ],
      },
    ],
    footerLines: input.footerLines,
    terminalColumns: Math.max(96, widest + 10),
  });
}

function buildStartupResumeNotice(
  title: string,
  details: readonly string[],
): string {
  return renderStartupResumeNotice({
    title,
    primary: details[0] ?? title,
    detailLines: details.slice(1),
  });
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
        notice: renderStartupResumeNotice({
          title: "Multiple resumable sessions found",
          primary: `query ${queryRaw}`,
          detailLines: [
            `${String(matches.length)} sessions matched`,
            ...hints.split("\n"),
          ],
          footerLines: [
            "Hint: use --resume <session-id> to choose a target.",
          ],
        }),
      };
    }
    if (fallbackTargetSessionId) {
      return {
        targetSessionId: fallbackTargetSessionId,
        notice: buildStartupResumeNotice(
          "No resumable session matched",
          [
            `query ${queryRaw}`,
            `Fell back to latest resumable session ${fallbackTargetSessionId}`,
          ],
        ),
      };
    }
    return {
      notice: buildStartupResumeNotice(
        "No resumable session matched",
        [
          `query ${queryRaw}`,
          "No resumable sessions.",
        ],
      ),
    };
  }

  if (fallbackTargetSessionId) {
    return {
      targetSessionId: fallbackTargetSessionId,
    };
  }
  return {
    notice: buildStartupResumeNotice(
      "Startup resume unavailable",
      ["Startup resume was requested, but no resumable sessions exist."],
    ),
  };
}
