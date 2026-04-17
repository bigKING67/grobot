import { buildPromptWithHistory } from "../../../orchestration/entrypoints/dev-cli/start/session-history";
import { estimateTokensFromText, computeUtilization, resolveEffectiveContextWindow } from "../budget/token-budget";
import { buildCompactSnapshot, buildPromptFromSnapshot } from "../curation/history-curation";
import {
  type ContextEngineConfig,
  type ContextHistoryMessage,
  type PromptCompactionStage,
  type PromptPreparationResult,
  type PromptVariant,
} from "../types";

function stageWeight(stage: PromptCompactionStage): number {
  switch (stage) {
    case "normal":
      return 0;
    case "proactive":
      return 1;
    case "forced":
      return 2;
    case "minimal":
      return 3;
    default:
      return 0;
  }
}

export function nextCompactionStage(stage: PromptCompactionStage): PromptCompactionStage | undefined {
  if (stage === "normal") {
    return "proactive";
  }
  if (stage === "proactive") {
    return "forced";
  }
  if (stage === "forced") {
    return "minimal";
  }
  return undefined;
}

function normalizeHistory(history: readonly ContextHistoryMessage[]): ContextHistoryMessage[] {
  return history
    .map((row): ContextHistoryMessage => ({
      role: row.role === "assistant" ? "assistant" : "user",
      content: row.content.trim(),
    }))
    .filter((row) => row.content.length > 0);
}

function buildVariants(args: {
  userText: string;
  history: readonly ContextHistoryMessage[];
  historyTurns: number;
}): PromptVariant[] {
  const history = normalizeHistory(args.history);
  const snapshot = buildCompactSnapshot(args.userText, history);
  const recentNormal = history.slice(-Math.max(1, Math.min(args.historyTurns, 6)) * 2);
  const recentProactive = history.slice(-6);
  const recentForced = history.slice(-2);
  const normalPrompt = buildPromptWithHistory(args.userText, history, Math.min(args.historyTurns, 6));
  const proactivePrompt = buildPromptFromSnapshot({
    userText: args.userText,
    snapshot,
    recentRows: recentProactive,
    includeRecentRows: true,
  });
  const forcedPrompt = buildPromptFromSnapshot({
    userText: args.userText,
    snapshot,
    recentRows: recentForced,
    includeRecentRows: true,
  });
  const minimalPrompt = buildPromptFromSnapshot({
    userText: args.userText,
    snapshot,
    recentRows: [],
    includeRecentRows: false,
  });
  const variants: PromptVariant[] = [
    { stage: "normal", prompt: normalPrompt, estimatedTokens: estimateTokensFromText(normalPrompt) },
    { stage: "proactive", prompt: proactivePrompt, estimatedTokens: estimateTokensFromText(proactivePrompt) },
    { stage: "forced", prompt: forcedPrompt, estimatedTokens: estimateTokensFromText(forcedPrompt) },
    { stage: "minimal", prompt: minimalPrompt, estimatedTokens: estimateTokensFromText(minimalPrompt) },
  ];
  // Keep deterministic order and remove accidental duplicates by stage.
  return variants
    .sort((left, right) => stageWeight(left.stage) - stageWeight(right.stage))
    .filter((row, index, rows) => rows.findIndex((item) => item.stage === row.stage) === index);
}

function selectStageByUtilization(
  utilization: number,
  config: ContextEngineConfig,
): PromptCompactionStage {
  if (utilization >= config.thresholds.hardRatio) {
    return "minimal";
  }
  if (utilization >= config.thresholds.forcedRatio) {
    return "forced";
  }
  if (utilization >= config.thresholds.proactiveRatio) {
    return "proactive";
  }
  return "normal";
}

function findVariant(
  variants: readonly PromptVariant[],
  stage: PromptCompactionStage,
): PromptVariant {
  const match = variants.find((item) => item.stage === stage);
  if (match) {
    return match;
  }
  return variants[0] as PromptVariant;
}

export function preparePromptWithBudget(args: {
  userText: string;
  history: readonly ContextHistoryMessage[];
  historyTurns: number;
  config: ContextEngineConfig;
}): PromptPreparationResult {
  const variants = buildVariants({
    userText: args.userText,
    history: args.history,
    historyTurns: args.historyTurns,
  });
  const effectiveWindowTokens = resolveEffectiveContextWindow(args.config);
  const totalEstimatedTokens = variants[0]?.estimatedTokens ?? 0;
  const utilization = computeUtilization(totalEstimatedTokens, effectiveWindowTokens);
  const targetStage = args.config.enabled
    ? selectStageByUtilization(utilization, args.config)
    : "normal";
  const selected = findVariant(variants, targetStage);
  return {
    selected,
    variants: [...variants],
    utilization,
    effectiveWindowTokens,
    totalEstimatedTokens,
  };
}

export function escalatePromptVariant(
  variants: readonly PromptVariant[],
  currentStage: PromptCompactionStage,
): PromptVariant | undefined {
  const nextStage = nextCompactionStage(currentStage);
  if (!nextStage) {
    return undefined;
  }
  return variants.find((item) => item.stage === nextStage);
}

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
