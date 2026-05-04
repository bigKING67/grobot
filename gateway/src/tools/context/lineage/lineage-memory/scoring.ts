import {
  isPathOverlap,
  truncateSummary,
} from "./text";
import type {
  LineageCommitRow,
  LineageDiffSemantic,
  LineageIntentTag,
} from "./types";

export function scoreLineageRow(
  row: LineageCommitRow,
  queryTokens: Set<string>,
  queryIntentTags: Set<LineageIntentTag>,
  queryPathHints: readonly string[],
  normalizedQuery: string,
  recencyIndex: number,
): number {
  if (queryTokens.size === 0 && !normalizedQuery) {
    return 1;
  }
  let score = 0;
  if (normalizedQuery && row.normalizedSubject.includes(normalizedQuery)) {
    score += 8;
  }
  for (const token of queryTokens) {
    if (row.subjectTokens.has(token)) {
      score += 3;
      continue;
    }
    if (row.fileTokens.has(token)) {
      score += 1;
    }
  }
  let intentOverlap = 0;
  for (const tag of queryIntentTags) {
    if (row.intentTags.has(tag)) {
      intentOverlap += 1;
    }
  }
  score += Math.min(5.6, intentOverlap * 2.2);
  let pathOverlap = 0;
  if (queryPathHints.length > 0 && row.normalizedFiles.length > 0) {
    for (const queryPath of queryPathHints) {
      if (row.normalizedFiles.some((rowPath) => isPathOverlap(queryPath, rowPath))) {
        pathOverlap += 1;
      }
    }
  }
  score += Math.min(6, pathOverlap * 2.1);
  const recencyBonus = 2.3 * Math.exp(-recencyIndex / 72);
  const changeMagnitude = row.insertions + row.deletions;
  const changeBonus = Math.min(2.4, Math.log10(changeMagnitude + 1));
  const focusedChangeBonus = row.fileChangeCount > 0 && row.fileChangeCount <= 6 ? 0.6 : 0;
  const broadChangePenalty = row.fileChangeCount >= 24 && pathOverlap === 0 ? -1 : 0;
  return score + recencyBonus + changeBonus + focusedChangeBonus + broadChangePenalty;
}

export function scoreLineageDiffSemantic(args: {
  queryTokens: Set<string>;
  queryIntentTags: Set<LineageIntentTag>;
  queryPathHints: readonly string[];
  semantic?: LineageDiffSemantic;
}): number {
  const semantic = args.semantic;
  if (!semantic) {
    return 0;
  }
  let score = 0;
  let tokenOverlap = 0;
  for (const token of args.queryTokens) {
    if (semantic.tokens.has(token)) {
      tokenOverlap += 1;
    }
  }
  score += Math.min(4.2, tokenOverlap * 0.9);
  let intentOverlap = 0;
  for (const tag of args.queryIntentTags) {
    if (semantic.tags.has(tag)) {
      intentOverlap += 1;
    }
  }
  score += Math.min(5.5, intentOverlap * 2.1);
  let pathOverlap = 0;
  for (const path of args.queryPathHints) {
    for (const semanticPath of semantic.normalizedFiles) {
      if (isPathOverlap(path, semanticPath)) {
        pathOverlap += 1;
        break;
      }
    }
  }
  score += Math.min(6, pathOverlap * 2.2);
  return score;
}

export function buildLineageSummary(row: LineageCommitRow, semantic?: LineageDiffSemantic): string {
  const repoPrefix = row.repoLabel ? `[${row.repoLabel}] ` : "";
  const filePreview = row.files
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 3);
  const fileSuffix = row.files.length > 3
    ? ` +${String(row.files.length - 3)} files`
    : "";
  if (filePreview.length === 0) {
    return truncateSummary(row.subject);
  }
  const changeStats = row.fileChangeCount > 0
    ? ` | delta: +${String(row.insertions)}/-${String(row.deletions)} in ${String(row.fileChangeCount)} files`
    : "";
  const intentTags = Array.from(row.intentTags).slice(0, 2);
  const intentSuffix = intentTags.length > 0
    ? ` | intent: ${intentTags.join("/")}`
    : "";
  const semanticSuffix = semantic?.summary
    ? ` | diff: ${semantic.summary}`
    : "";
  return truncateSummary(`${repoPrefix}${row.subject}${changeStats} | files: ${filePreview.join(", ")}${fileSuffix}${intentSuffix}${semanticSuffix}`);
}
