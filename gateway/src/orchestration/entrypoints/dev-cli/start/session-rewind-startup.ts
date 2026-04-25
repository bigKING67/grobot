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
      `- ${checkpoint.checkpointId} | ${checkpoint.createdAt} | files=${String(
        checkpoint.changedFilesCount,
      )} | user=${formatStartupRewindPreview(checkpoint.userText)} | assistant=${
        formatStartupRewindPreview(checkpoint.assistantText)
      }`
    );
  if (matches.length > STARTUP_REWIND_HINT_LIMIT) {
    rows.push(`- ... and ${String(matches.length - STARTUP_REWIND_HINT_LIMIT)} more`);
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
          `[rewind] startup checkpoint "${queryRaw}" not found; skipping rewind.\n`
          + "[rewind] Tip: use --rewind <query> for fuzzy checkpoint selection.\n\n",
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
          `[rewind] --rewind query "${queryRaw}" matched ${String(matches.length)} checkpoints.\n`
          + `${hints}\n`
          + "[rewind] Tip: use --rewind <checkpoint-id> for deterministic startup rewind.\n",
      };
    }
    if (fallbackTargetCheckpointId) {
      return {
        targetCheckpointId: fallbackTargetCheckpointId,
        notice:
          `[rewind] --rewind query "${queryRaw}" has no match; fallback to latest checkpoint "${fallbackTargetCheckpointId}".\n\n`,
      };
    }
    return {
      notice:
        `[rewind] --rewind query "${queryRaw}" has no match and no checkpoints found.\n\n`,
    };
  }

  if (fallbackTargetCheckpointId) {
    return {
      targetCheckpointId: fallbackTargetCheckpointId,
    };
  }
  return {
    notice: "[rewind] startup rewind requested but no checkpoints found.\n\n",
  };
}
