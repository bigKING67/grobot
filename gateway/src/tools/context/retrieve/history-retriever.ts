import { type ContextHistoryMessage } from "../types";

function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function normalizeText(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, " ").trim();
}

function containsPathLike(text: string): boolean {
  return /[A-Za-z0-9._/-]+\.[A-Za-z0-9]+/.test(text);
}

function classifyRowIntent(content: string): "architecture" | "modified" | "verification" | "todo" | "other" {
  const lowered = content.toLowerCase();
  if (
    lowered.includes("architecture")
    || lowered.includes("design")
    || lowered.includes("decision")
    || lowered.includes("tradeoff")
  ) {
    return "architecture";
  }
  if (
    lowered.includes("modified files")
    || lowered.includes("changed files")
    || lowered.includes("file:")
    || containsPathLike(content)
  ) {
    return "modified";
  }
  if (
    lowered.includes("verification")
    || lowered.includes("check:")
    || lowered.includes("test")
    || lowered.includes("pass")
    || lowered.includes("fail")
  ) {
    return "verification";
  }
  if (
    lowered.includes("todo")
    || lowered.includes("rollback")
    || lowered.includes("next step")
    || lowered.includes("risk")
  ) {
    return "todo";
  }
  return "other";
}

function inferQueryIntent(queryText: string): "architecture" | "modified" | "verification" | "todo" | "other" {
  const lowered = queryText.toLowerCase();
  if (
    lowered.includes("architecture")
    || lowered.includes("design")
    || lowered.includes("机制")
    || lowered.includes("原理")
    || lowered.includes("架构")
  ) {
    return "architecture";
  }
  if (
    lowered.includes("file")
    || lowered.includes("path")
    || lowered.includes("改动")
    || lowered.includes("源码")
    || lowered.includes("代码")
  ) {
    return "modified";
  }
  if (
    lowered.includes("test")
    || lowered.includes("verify")
    || lowered.includes("验证")
    || lowered.includes("检查")
    || lowered.includes("质量")
  ) {
    return "verification";
  }
  if (
    lowered.includes("todo")
    || lowered.includes("next")
    || lowered.includes("风险")
    || lowered.includes("回滚")
  ) {
    return "todo";
  }
  return "other";
}

function scoreRow(args: {
  queryTokens: Set<string>;
  normalizedQuery: string;
  queryIntent: "architecture" | "modified" | "verification" | "todo" | "other";
  row: ContextHistoryMessage;
  rowIndex: number;
  historySize: number;
}): number {
  const rowTokens = tokenize(args.row.content);
  const rowTokenSet = new Set(rowTokens);
  const normalizedRow = normalizeText(args.row.content);

  let lexicalScore = 0;
  for (const token of args.queryTokens) {
    if (rowTokenSet.has(token)) {
      lexicalScore += 1;
    }
  }
  const tokenCoverage = args.queryTokens.size > 0
    ? lexicalScore / args.queryTokens.size
    : 0;
  const phraseScore = args.normalizedQuery.length > 0 && normalizedRow.includes(args.normalizedQuery)
    ? 6
    : 0;
  const pathScore = containsPathLike(args.row.content) ? 1.2 : 0;
  const recencyRatio = args.historySize > 1
    ? args.rowIndex / (args.historySize - 1)
    : 1;
  const recencyScore = recencyRatio * 2;
  const rowIntent = classifyRowIntent(args.row.content);
  const intentScore = args.queryIntent !== "other" && rowIntent === args.queryIntent ? 2 : 0;

  const roleScore = args.row.role === "assistant" ? 0.8 : 0.4;
  return (
    lexicalScore * 1.7
    + tokenCoverage * 3.2
    + phraseScore
    + pathScore
    + recencyScore
    + intentScore
    + roleScore
  );
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
  const normalizedQuery = normalizeText(userText);
  if (tokens.size === 0 && normalizedQuery.length === 0) {
    return history.slice(-maxRows).map((row) => ({ ...row }));
  }
  const queryIntent = inferQueryIntent(userText);
  const ranked = history
    .map((row, index) => ({
      row,
      index,
      score: scoreRow({
        queryTokens: tokens,
        normalizedQuery,
        queryIntent,
        row,
        rowIndex: index,
        historySize: history.length,
      }),
    }))
    .filter((item) => item.score > 0.2)
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
