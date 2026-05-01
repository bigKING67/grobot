import {
  normalizeResumeSearchQuery,
  resolveResumeQueryMatches,
} from "./session-resume-search";
import { type RunStartSessionSummary } from "./run-start-session-ops";
import { terminalStyle } from "../ui/theme/terminal-style";

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
    rows.push(`- ... 还有 ${String(matches.length - STARTUP_RESUME_HINT_LIMIT)} 项`);
  }
  return rows.join("\n");
}

function buildStartupResumeNotice(
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
        notice: [
          `${terminalStyle.accent("●")} 找到多个可恢复会话`,
          `  ${terminalStyle.muted(`查询: ${queryRaw}`)}`,
          `  ${terminalStyle.muted(`匹配: ${String(matches.length)} 个会话`)}`,
          hints,
          `  ${terminalStyle.muted("提示：使用 --resume <session-id> 可确定恢复目标。")}`,
          "",
        ].join("\n"),
      };
    }
    if (fallbackTargetSessionId) {
      return {
        targetSessionId: fallbackTargetSessionId,
        notice: buildStartupResumeNotice(
          "未匹配到可恢复会话",
          [
            `查询: ${queryRaw}`,
            `已回退到最近可恢复会话: ${fallbackTargetSessionId}`,
          ],
        ),
      };
    }
    return {
      notice: buildStartupResumeNotice(
        "未匹配到可恢复会话",
        [
          `查询: ${queryRaw}`,
          "没有可恢复会话。",
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
      "启动恢复不可用",
      ["已请求启动恢复，但没有可恢复会话。"],
    ),
  };
}
