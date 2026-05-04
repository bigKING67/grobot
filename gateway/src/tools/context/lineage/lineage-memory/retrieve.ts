import { resolve } from "node:path";
import { getLineageDiffSemantic } from "./diff-cache";
import {
  getCachedLineageRows,
  resolveExtraLineageRepoRoots,
  resolveGitRoot,
} from "./git";
import {
  buildLineageSummary,
  scoreLineageDiffSemantic,
  scoreLineageRow,
} from "./scoring";
import {
  clampInteger,
  extractPathHints,
  inferIntentTags,
  normalizeText,
  tokenize,
} from "./text";
import {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_MAX_COMMITS,
  MAX_CACHE_TTL_MS,
  MAX_MAX_COMMITS,
  MIN_CACHE_TTL_MS,
  MIN_MAX_COMMITS,
  type LineageDiffSemantic,
  type LineageSummaryRow,
  type RetrieveLineageOptions,
} from "./types";

export function retrieveLineageSummaries(
  query: string,
  limit: number,
  options: RetrieveLineageOptions = {},
): LineageSummaryRow[] {
  const normalizedLimit = clampInteger(limit, 0, 0, 24);
  if (normalizedLimit <= 0) {
    return [];
  }
  const workDir = resolve(options.workDir ?? process.cwd());
  const rootPath = resolveGitRoot(workDir);
  if (!rootPath) {
    return [];
  }
  const maxCommits = clampInteger(
    options.maxCommits ?? DEFAULT_MAX_COMMITS,
    DEFAULT_MAX_COMMITS,
    MIN_MAX_COMMITS,
    MAX_MAX_COMMITS,
  );
  const cacheTtlMs = clampInteger(
    options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    DEFAULT_CACHE_TTL_MS,
    MIN_CACHE_TTL_MS,
    MAX_CACHE_TTL_MS,
  );
  const extraRoots = resolveExtraLineageRepoRoots(workDir, rootPath);
  const allRoots = [rootPath, ...extraRoots];
  const rows = allRoots.flatMap((root) => getCachedLineageRows(root, maxCommits, cacheTtlMs));
  if (rows.length === 0) {
    return [];
  }
  const sortedRows = [...rows].sort((left, right) => {
    if (left.timestamp && right.timestamp && left.timestamp !== right.timestamp) {
      return right.timestamp.localeCompare(left.timestamp);
    }
    return right.commitId.localeCompare(left.commitId);
  });
  const queryTokens = new Set(tokenize(query));
  const queryIntentTags = inferIntentTags(query);
  const queryPathHints = extractPathHints(query);
  const normalizedQuery = normalizeText(query);
  const ranked = sortedRows
    .map((row, index) => ({
      row,
      baseScore: scoreLineageRow(
        row,
        queryTokens,
        queryIntentTags,
        queryPathHints,
        normalizedQuery,
        index,
      ),
      index,
    }))
    .filter((item) => item.baseScore > 0)
    .sort((left, right) => {
      if (left.baseScore !== right.baseScore) {
        return right.baseScore - left.baseScore;
      }
      return left.index - right.index;
    });
  const semanticCandidateCount = Math.min(
    ranked.length,
    Math.max(normalizedLimit * 6, 20),
  );
  const semanticByCommit = new Map<string, LineageDiffSemantic>();
  for (let index = 0; index < semanticCandidateCount; index += 1) {
    const item = ranked[index];
    if (!item) {
      continue;
    }
    const semantic = getLineageDiffSemantic(item.row.rootPath, item.row);
    if (!semantic) {
      continue;
    }
    semanticByCommit.set(`${item.row.rootPath}::${item.row.commitId}`, semantic);
  }
  const reranked = ranked
    .map((item) => {
      const semantic = semanticByCommit.get(`${item.row.rootPath}::${item.row.commitId}`);
      const semanticScore = scoreLineageDiffSemantic({
        queryTokens,
        queryIntentTags,
        queryPathHints,
        semantic,
      });
      return {
        ...item,
        semantic,
        score: item.baseScore + semanticScore,
      };
    })
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.index - right.index;
    })
    .slice(0, normalizedLimit)
    .sort((left, right) => left.index - right.index);
  return reranked.map((item) => ({
    commitId: item.row.commitId,
    author: item.row.author,
    timestamp: item.row.timestamp,
    summary: buildLineageSummary(item.row, item.semantic),
  }));
}
