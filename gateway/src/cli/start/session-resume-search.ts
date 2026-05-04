import { type SessionInteractiveSessionSummary } from "./session-interactive";

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

function sortResumeQueryMatches<T extends SessionInteractiveSessionSummary>(
  matches: T[],
): T[] {
  matches.sort((left: T, right: T) => {
    if (left.active !== right.active) {
      return left.active ? 1 : -1;
    }
    const updatedDiff = parseUpdatedAtMs(right.updatedAt) - parseUpdatedAtMs(left.updatedAt);
    if (updatedDiff !== 0) {
      return updatedDiff;
    }
    return left.id.localeCompare(right.id);
  });
  return matches;
}

export function normalizeResumeSearchQuery(value: string): string {
  return normalizeQueryText(stripBalancedQuotes(value));
}

export function resolveResumeQueryMatches<T extends SessionInteractiveSessionSummary>(
  queryRaw: string,
  sessions: readonly T[],
): T[] {
  const query = normalizeResumeSearchQuery(queryRaw);
  if (!query) {
    return [];
  }
  const compactQuery = normalizeCompactText(query);
  const hasCompactQuery = compactQuery.length > 0;
  const queryDigits = normalizeDigitsOnly(query);
  const prioritizedMatches = resolvePrioritizedMatches(
    [
      () => sessions.filter((session) =>
        normalizeQueryText(session.id) === query),
      () => sessions.filter((session) =>
        normalizeQueryText(session.title) === query),
      () => sessions.filter((session) =>
        normalizeQueryText(session.summary) === query),
      () => sessions.filter((session) =>
        normalizeQueryText(session.updatedAt) === query),
      () => hasCompactQuery
        ? sessions.filter((session) =>
          normalizeCompactText(session.id) === compactQuery)
        : [],
      () => hasCompactQuery
        ? sessions.filter((session) =>
          normalizeCompactText(session.title) === compactQuery)
        : [],
      () => hasCompactQuery
        ? sessions.filter((session) =>
          normalizeCompactText(session.summary) === compactQuery)
        : [],
      () => hasCompactQuery
        ? sessions.filter((session) =>
          normalizeCompactText(session.updatedAt) === compactQuery)
        : [],
      () => hasCompactQuery
        ? sessions.filter((session) =>
          normalizeCompactText(session.id).startsWith(compactQuery))
        : [],
      () => hasCompactQuery
        ? sessions.filter((session) =>
          normalizeCompactText(session.title).startsWith(compactQuery))
        : [],
      () => hasCompactQuery
        ? sessions.filter((session) =>
          normalizeCompactText(session.summary).startsWith(compactQuery))
        : [],
      () => hasCompactQuery
        ? sessions.filter((session) =>
          normalizeCompactText(session.updatedAt).startsWith(compactQuery))
        : [],
      () => queryDigits.length > 0
        ? sessions.filter((session) =>
          normalizeDigitsOnly(session.updatedAt).startsWith(queryDigits))
        : [],
      () => sessions.filter((session) =>
        normalizeQueryText(session.id).startsWith(query)),
      () => sessions.filter((session) =>
        normalizeQueryText(session.title).startsWith(query)),
      () => sessions.filter((session) =>
        normalizeQueryText(session.summary).startsWith(query)),
      () => sessions.filter((session) =>
        normalizeQueryText(session.updatedAt).startsWith(query)),
    ],
    sortResumeQueryMatches,
  );
  if (prioritizedMatches.length > 0) {
    return prioritizedMatches;
  }
  const containsMatches = sessions.filter((session) => {
    const id = normalizeQueryText(session.id);
    const title = normalizeQueryText(session.title);
    const summary = normalizeQueryText(session.summary);
    const updatedAt = normalizeQueryText(session.updatedAt);
    const idCompact = normalizeCompactText(session.id);
    const titleCompact = normalizeCompactText(session.title);
    const summaryCompact = normalizeCompactText(session.summary);
    const updatedAtCompact = normalizeCompactText(session.updatedAt);
    const updatedAtDigits = normalizeDigitsOnly(session.updatedAt);
    return id.includes(query)
      || title.includes(query)
      || summary.includes(query)
      || updatedAt.includes(query)
      || (hasCompactQuery && idCompact.includes(compactQuery))
      || (hasCompactQuery && titleCompact.includes(compactQuery))
      || (hasCompactQuery && summaryCompact.includes(compactQuery))
      || (hasCompactQuery && updatedAtCompact.includes(compactQuery))
      || (queryDigits.length > 0 && updatedAtDigits.includes(queryDigits));
  });
  return sortResumeQueryMatches(containsMatches);
}
