import { estimateTokensFromText } from "../../budget/token-budget";

export function truncatePromptHeadForPtlRetry(prompt: string, attempt: number): string {
  const normalizedAttempt = Math.max(1, attempt);
  const lines = prompt.split(/\r?\n/);
  const contextHeaderIndex = lines.findIndex((line) => line.trim() === "[Conversation Context]");
  const userHeaderIndex = lines.findIndex((line) => line.trim() === "[Current User Message]");
  if (contextHeaderIndex < 0 || userHeaderIndex <= contextHeaderIndex + 1) {
    return prompt;
  }
  const contextLines = lines.slice(contextHeaderIndex + 1, userHeaderIndex);
  if (contextLines.length <= 2) {
    return prompt;
  }
  const dropCount = Math.min(
    contextLines.length - 1,
    Math.max(1, Math.floor(contextLines.length * Math.min(0.5, normalizedAttempt * 0.2))),
  );
  const trimmedContext = contextLines.slice(dropCount);
  const rebuilt = [
    ...lines.slice(0, contextHeaderIndex + 1),
    "[earlier conversation truncated for compaction retry]",
    ...trimmedContext,
    ...lines.slice(userHeaderIndex),
  ];
  return rebuilt.join("\n");
}

export function trimPromptRecentTurnsForBudget(args: {
  prompt: string;
  targetTokenLimit: number;
  minRecentRows?: number;
}): {
  prompt: string;
  removedRows: number;
  estimatedTokens: number;
} {
  const targetTokenLimit = Math.max(1, Math.floor(args.targetTokenLimit));
  const minRecentRows = Math.max(0, Math.floor(args.minRecentRows ?? 1));
  const originalPrompt = args.prompt;
  let estimatedTokens = estimateTokensFromText(originalPrompt);
  if (estimatedTokens <= targetTokenLimit) {
    return {
      prompt: originalPrompt,
      removedRows: 0,
      estimatedTokens,
    };
  }

  const lines = originalPrompt.split(/\r?\n/);
  const recentHeaderIndex = lines.findIndex((line) => line.trim() === "[Recent Turns]");
  const userHeaderIndex = lines.findIndex((line) => line.trim() === "[Current User Message]");
  if (recentHeaderIndex < 0 || userHeaderIndex <= recentHeaderIndex + 1) {
    return {
      prompt: originalPrompt,
      removedRows: 0,
      estimatedTokens,
    };
  }

  const recentRows = lines.slice(recentHeaderIndex + 1, userHeaderIndex);
  const nonEmptyRows = recentRows.filter((line) => line.trim().length > 0);
  if (nonEmptyRows.length <= minRecentRows) {
    return {
      prompt: originalPrompt,
      removedRows: 0,
      estimatedTokens,
    };
  }

  const prefix = lines.slice(0, recentHeaderIndex + 1);
  const suffix = lines.slice(userHeaderIndex);
  const maxRemovableRows = Math.max(0, nonEmptyRows.length - minRecentRows);
  let removedRows = 0;
  let currentRows = [...nonEmptyRows];
  let currentPrompt = originalPrompt;

  while (removedRows < maxRemovableRows) {
    currentRows = currentRows.slice(1);
    removedRows += 1;
    const marker = removedRows > 0
      ? ["[earlier recent turns truncated for budget]"]
      : [];
    currentPrompt = [
      ...prefix,
      ...marker,
      ...currentRows,
      ...suffix,
    ].join("\n");
    estimatedTokens = estimateTokensFromText(currentPrompt);
    if (estimatedTokens <= targetTokenLimit) {
      return {
        prompt: currentPrompt,
        removedRows,
        estimatedTokens,
      };
    }
  }

  return {
    prompt: currentPrompt,
    removedRows,
    estimatedTokens,
  };
}
