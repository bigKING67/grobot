import {
  normalizeRewindSearchQuery,
  resolveRewindQueryMatches,
} from "./session-rewind-search";
import { type SessionInteractiveRewindCheckpointSummary } from "./session-interactive";

export type StartupRewindCheckpointSummary = SessionInteractiveRewindCheckpointSummary;

export interface ResolveStartupRewindTargetInput {
  rewindRequested: boolean;
  rewindQuery?: string;
  rewindQueryStrict?: boolean;
  checkpoints: ReadonlyArray<StartupRewindCheckpointSummary>;
}

export interface ResolveStartupRewindTargetResult {
  targetCheckpointId?: string;
  notice?: string;
  requiresDisambiguation?: boolean;
  disambiguationCandidates?: ReadonlyArray<StartupRewindCheckpointSummary>;
}

const STARTUP_REWIND_HINT_LIMIT = 3;

function formatStartupRewindPreview(value: string, maxLength = 42): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "-";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function formatStartupRewindHints(
  matches: readonly StartupRewindCheckpointSummary[],
): string {
  const rows = matches
    .slice(0, STARTUP_REWIND_HINT_LIMIT)
    .map((checkpoint) =>
      `- ${checkpoint.checkpointId} | ${checkpoint.createdAt} | 文件=${String(
        checkpoint.changedFilesCount,
      )} | 用户=${formatStartupRewindPreview(checkpoint.userText)} | 助手=${
        formatStartupRewindPreview(checkpoint.assistantText)
      }`
    );
  if (matches.length > STARTUP_REWIND_HINT_LIMIT) {
    rows.push(`- ... 还有 ${String(matches.length - STARTUP_REWIND_HINT_LIMIT)} 项`);
  }
  return rows.join("\n");
}

export function resolveStartupRewindTarget(
  input: ResolveStartupRewindTargetInput,
): ResolveStartupRewindTargetResult {
  if (!input.rewindRequested) {
    return {};
  }
  const fallbackTargetCheckpointId = input.checkpoints[0]?.checkpointId;
  const queryRaw = input.rewindQuery?.trim() ?? "";
  const queryNormalized = queryRaw.length > 0
    ? normalizeRewindSearchQuery(queryRaw)
    : "";
  const strictMode = input.rewindQueryStrict === true && queryNormalized.length > 0;

  if (queryNormalized.length > 0) {
    if (strictMode) {
      const exact = input.checkpoints.find((checkpoint) =>
        normalizeRewindSearchQuery(checkpoint.checkpointId) === queryNormalized
      );
      if (exact) {
        return {
          targetCheckpointId: exact.checkpointId,
        };
      }
      return {
        notice:
          `[rewind] 启动检查点 "${queryRaw}" 未找到；已跳过回退。\n`
          + "[rewind] 提示：使用 --rewind <query> 可模糊选择检查点。\n\n",
      };
    }
    const matches = resolveRewindQueryMatches(queryRaw, input.checkpoints);
    if (matches.length === 1) {
      return {
        targetCheckpointId: matches[0]?.checkpointId,
      };
    }
    if (matches.length > 1) {
      const picked = matches[0];
      const hints = formatStartupRewindHints(matches);
      return {
        targetCheckpointId: picked?.checkpointId,
        requiresDisambiguation: true,
        disambiguationCandidates: matches,
        notice:
          `[rewind] --rewind 查询 "${queryRaw}" 匹配到 ${String(matches.length)} 个检查点。\n`
          + `${hints}\n`
          + "[rewind] 提示：使用 --rewind <检查点 ID> 可确定回退目标。\n",
      };
    }
    if (fallbackTargetCheckpointId) {
      return {
        targetCheckpointId: fallbackTargetCheckpointId,
        notice:
          `[rewind] --rewind 查询 "${queryRaw}" 没有匹配；已回退到最近检查点 "${fallbackTargetCheckpointId}"。\n\n`,
      };
    }
    return {
      notice:
        `[rewind] --rewind 查询 "${queryRaw}" 没有匹配，也没有可用检查点。\n\n`,
    };
  }

  if (fallbackTargetCheckpointId) {
    return {
      targetCheckpointId: fallbackTargetCheckpointId,
    };
  }
  return {
    notice: "[rewind] 已请求启动回退，但没有可用检查点。\n\n",
  };
}
