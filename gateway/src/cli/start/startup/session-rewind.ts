import {
  normalizeRewindSearchQuery,
  resolveRewindQueryMatches,
} from "../session/rewind-search";
import { type SessionInteractiveRewindCheckpointSummary } from "../session-interactive";
import { renderInfoPanel } from "../../tui/components/info-panel/render";
import { measureDisplayWidth } from "../../tui/terminal/display-width";

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

function formatStartupRewindFileCount(count: number): string {
  return `${String(count)} ${count === 1 ? "file" : "files"}`;
}

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
    .flatMap((checkpoint) => [
      checkpoint.checkpointId,
      `${checkpoint.createdAt} · ${formatStartupRewindFileCount(checkpoint.changedFilesCount)}`,
      `user ${formatStartupRewindPreview(checkpoint.userText)}`,
      `assistant ${formatStartupRewindPreview(checkpoint.assistantText)}`,
    ]);
  if (matches.length > STARTUP_REWIND_HINT_LIMIT) {
    rows.push(`... ${String(matches.length - STARTUP_REWIND_HINT_LIMIT)} more`);
  }
  return rows.join("\n");
}

function renderStartupRewindNotice(input: {
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

function buildStartupRewindNotice(
  title: string,
  details: readonly string[],
): string {
  return renderStartupRewindNotice({
    title,
    primary: details[0] ?? title,
    detailLines: details.slice(1),
  });
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
        notice: buildStartupRewindNotice(
          "Startup checkpoint not found",
          [
            `query ${queryRaw}`,
            "Rewind skipped.",
            "Hint: use --rewind <query> to fuzzy-pick a checkpoint.",
          ],
        ),
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
        notice: renderStartupRewindNotice({
          title: "Multiple startup checkpoints found",
          primary: `query ${queryRaw}`,
          detailLines: [
            `${String(matches.length)} checkpoints matched`,
            ...hints.split("\n"),
          ],
          footerLines: [
            "Hint: use --rewind <checkpoint-id> to choose a rewind target.",
          ],
        }),
      };
    }
    if (fallbackTargetCheckpointId) {
      return {
        targetCheckpointId: fallbackTargetCheckpointId,
        notice: buildStartupRewindNotice(
          "No startup checkpoint matched",
          [
            `query ${queryRaw}`,
            `Fell back to latest checkpoint ${fallbackTargetCheckpointId}`,
          ],
        ),
      };
    }
    return {
      notice: buildStartupRewindNotice(
        "No startup checkpoint matched",
        [
          `query ${queryRaw}`,
          "No checkpoints available.",
        ],
      ),
    };
  }

  if (fallbackTargetCheckpointId) {
    return {
      targetCheckpointId: fallbackTargetCheckpointId,
    };
  }
  return {
    notice: buildStartupRewindNotice(
      "Startup rewind unavailable",
      ["Startup rewind was requested, but no checkpoints are available."],
    ),
  };
}
