import { type SessionInteractiveRewindCheckpointSummary } from "./session-interactive";

function parseUpdatedAtMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeQueryText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeDigitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

function normalizeCompactText(value: string): string {
  return normalizeQueryText(value).replace(/[\s_-]+/g, "");
}

function stripBalancedQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  const isQuote = first === "\"" || first === "'" || first === "`";
  if (!isQuote || first !== last) {
    return trimmed;
  }
  const inner = trimmed.slice(1, -1).trim();
  return inner.length > 0 ? inner : trimmed;
}

function resolvePrioritizedMatches<T>(
  resolvers: ReadonlyArray<() => T[]>,
  sortMatches: (matches: T[]) => T[],
): T[] {
  for (const resolve of resolvers) {
    const matches = resolve();
    if (matches.length > 0) {
      return sortMatches(matches);
    }
  }
  return [];
}

function sortRewindQueryMatches<T extends SessionInteractiveRewindCheckpointSummary>(
  matches: T[],
): T[] {
  matches.sort((left: T, right: T) => {
    const createdDiff = parseUpdatedAtMs(right.createdAt) - parseUpdatedAtMs(left.createdAt);
    if (createdDiff !== 0) {
      return createdDiff;
    }
    return right.checkpointId.localeCompare(left.checkpointId);
  });
  return matches;
}

export function normalizeRewindSearchQuery(value: string): string {
  return normalizeQueryText(stripBalancedQuotes(value));
}

export function resolveRewindQueryMatches<T extends SessionInteractiveRewindCheckpointSummary>(
  queryRaw: string,
  checkpoints: readonly T[],
): T[] {
  const query = normalizeRewindSearchQuery(queryRaw);
  if (!query) {
    return [];
  }
  const compactQuery = normalizeCompactText(query);
  const hasCompactQuery = compactQuery.length > 0;
  const queryDigits = normalizeDigitsOnly(query);
  const prioritizedMatches = resolvePrioritizedMatches(
    [
      () => checkpoints.filter((checkpoint) => normalizeQueryText(checkpoint.checkpointId) === query),
      () => checkpoints.filter((checkpoint) => normalizeQueryText(checkpoint.createdAt) === query),
      () => checkpoints.filter((checkpoint) => normalizeQueryText(checkpoint.userText) === query),
      () => checkpoints.filter((checkpoint) => normalizeQueryText(checkpoint.assistantText) === query),
      () => hasCompactQuery
        ? checkpoints.filter((checkpoint) => normalizeCompactText(checkpoint.checkpointId) === compactQuery)
        : [],
      () => hasCompactQuery
        ? checkpoints.filter((checkpoint) => normalizeCompactText(checkpoint.createdAt) === compactQuery)
        : [],
      () => hasCompactQuery
        ? checkpoints.filter((checkpoint) => normalizeCompactText(checkpoint.userText) === compactQuery)
        : [],
      () => hasCompactQuery
        ? checkpoints.filter((checkpoint) => normalizeCompactText(checkpoint.assistantText) === compactQuery)
        : [],
      () => hasCompactQuery
        ? checkpoints.filter((checkpoint) =>
          normalizeCompactText(checkpoint.checkpointId).startsWith(compactQuery))
        : [],
      () => hasCompactQuery
        ? checkpoints.filter((checkpoint) => normalizeCompactText(checkpoint.createdAt).startsWith(compactQuery))
        : [],
      () => queryDigits.length > 0
        ? checkpoints.filter((checkpoint) => normalizeDigitsOnly(checkpoint.createdAt).startsWith(queryDigits))
        : [],
      () => checkpoints.filter((checkpoint) => normalizeQueryText(checkpoint.checkpointId).startsWith(query)),
      () => checkpoints.filter((checkpoint) => normalizeQueryText(checkpoint.createdAt).startsWith(query)),
      () => checkpoints.filter((checkpoint) => normalizeQueryText(checkpoint.userText).startsWith(query)),
      () => checkpoints.filter((checkpoint) => normalizeQueryText(checkpoint.assistantText).startsWith(query)),
      () => hasCompactQuery
        ? checkpoints.filter((checkpoint) => normalizeCompactText(checkpoint.userText).startsWith(compactQuery))
        : [],
      () => hasCompactQuery
        ? checkpoints.filter((checkpoint) =>
          normalizeCompactText(checkpoint.assistantText).startsWith(compactQuery))
        : [],
    ],
    sortRewindQueryMatches,
  );
  if (prioritizedMatches.length > 0) {
    return prioritizedMatches;
  }
  const containsMatches = checkpoints.filter((checkpoint) => {
    const checkpointId = normalizeQueryText(checkpoint.checkpointId);
    const createdAt = normalizeQueryText(checkpoint.createdAt);
    const userText = normalizeQueryText(checkpoint.userText);
    const assistantText = normalizeQueryText(checkpoint.assistantText);
    const createdAtDigits = normalizeDigitsOnly(checkpoint.createdAt);
    const checkpointIdCompact = normalizeCompactText(checkpoint.checkpointId);
    const createdAtCompact = normalizeCompactText(checkpoint.createdAt);
    const userTextCompact = normalizeCompactText(checkpoint.userText);
    const assistantTextCompact = normalizeCompactText(checkpoint.assistantText);
    return checkpointId.includes(query)
      || createdAt.includes(query)
      || userText.includes(query)
      || assistantText.includes(query)
      || (hasCompactQuery && checkpointIdCompact.includes(compactQuery))
      || (hasCompactQuery && createdAtCompact.includes(compactQuery))
      || (hasCompactQuery && userTextCompact.includes(compactQuery))
      || (hasCompactQuery && assistantTextCompact.includes(compactQuery))
      || (queryDigits.length > 0 && createdAtDigits.includes(queryDigits));
  });
  return sortRewindQueryMatches(containsMatches);
}
