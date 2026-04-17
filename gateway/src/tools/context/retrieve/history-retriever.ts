import { type ContextHistoryMessage } from "../types";

function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function scoreRow(tokens: Set<string>, row: ContextHistoryMessage): number {
  if (tokens.size === 0) {
    return 0;
  }
  const rowTokens = tokenize(row.content);
  if (rowTokens.length === 0) {
    return 0;
  }
  let hit = 0;
  for (const token of rowTokens) {
    if (tokens.has(token)) {
      hit += 1;
    }
  }
  return hit;
}

export function retrieveRelevantHistoryRows(
  userText: string,
  history: readonly ContextHistoryMessage[],
  maxRows: number,
): ContextHistoryMessage[] {
  if (maxRows <= 0 || history.length === 0) {
    return [];
  }
  const tokens = new Set(tokenize(userText));
  if (tokens.size === 0) {
    return history.slice(-maxRows).map((row) => ({ ...row }));
  }
  const ranked = history
    .map((row, index) => ({
      row,
      index,
      score: scoreRow(tokens, row),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return right.index - left.index;
    })
    .slice(0, maxRows)
    .sort((left, right) => left.index - right.index)
    .map((item) => ({ ...item.row }));
  if (ranked.length > 0) {
    return ranked;
  }
  return history.slice(-maxRows).map((row) => ({ ...row }));
}
