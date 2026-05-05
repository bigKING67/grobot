import { buildPromptWithHistory } from "../../../../cli/start/session/history";
import {
  computeUtilization,
  estimateTokensFromText,
  resolvePromptTargetTokenLimit,
} from "../../budget/token-budget";
import { buildCompactSnapshot, buildPromptFromSnapshot } from "../../curation/history-curation";
import { getChangedCodeSnapshot } from "../../graph/changed-code-snapshot";
import {
  type ContextEngineConfig,
  type ContextHistoryMessage,
  type PromptCompactionStage,
  type PromptPreparationResult,
  type PromptVariant,
} from "../../types";
import {
  applyAutoCompactGuardToStage,
  nextCompactionStage,
  selectStageByUtilization,
  stageWeight,
} from "./stages";

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
  workDir?: string;
  config: ContextEngineConfig;
}): PromptVariant[] {
  const history = normalizeHistory(args.history);
  const changedCodeSnapshot =
    args.config.dependencyGraph.enabled || args.config.symbolGraph.enabled
      ? getChangedCodeSnapshot({
        workDir: args.workDir,
        maxFiles: 40,
        maxFileBytes: 250_000,
        includeUntracked: true,
        cacheTtlMs: 1_500,
      })
      : undefined;
  const snapshotBaseOptions = {
    workDir: args.workDir,
    lineageEnabled: args.config.lineage.enabled,
    lineageMaxRows: args.config.lineage.maxRows,
    lineageMaxCommits: args.config.lineage.maxCommits,
    lineageCacheTtlMs: args.config.lineage.cacheTtlMs,
    workspaceSignalsEnabled: args.config.workspaceSignals.enabled,
    workspaceSignalsMaxRows: args.config.workspaceSignals.maxRows,
    workspaceSignalsIncludeUntracked: args.config.workspaceSignals.includeUntracked,
    workspaceSignalsCacheTtlMs: args.config.workspaceSignals.cacheTtlMs,
    dependencyGraphEnabled: args.config.dependencyGraph.enabled,
    dependencyGraphMaxRows: args.config.dependencyGraph.maxRows,
    symbolGraphEnabled: args.config.symbolGraph.enabled,
    symbolGraphMaxRows: args.config.symbolGraph.maxRows,
    changedCodeSnapshot,
  };
  const snapshotProactive = buildCompactSnapshot(
    args.userText,
    history,
    4,
    240,
    snapshotBaseOptions,
  );
  const snapshotForced = buildCompactSnapshot(
    args.userText,
    history,
    2,
    160,
    {
      ...snapshotBaseOptions,
      lineageMaxRows: Math.max(1, Math.min(2, args.config.lineage.maxRows)),
      workspaceSignalsMaxRows: Math.max(1, Math.min(2, args.config.workspaceSignals.maxRows)),
      dependencyGraphMaxRows: Math.max(1, Math.min(2, args.config.dependencyGraph.maxRows)),
      symbolGraphMaxRows: Math.max(1, Math.min(2, args.config.symbolGraph.maxRows)),
    },
  );
  const snapshotMinimal = buildCompactSnapshot(
    args.userText,
    history,
    1,
    120,
    {
      ...snapshotBaseOptions,
      lineageEnabled: false,
      dependencyGraphEnabled: false,
      symbolGraphEnabled: false,
      workspaceSignalsMaxRows: 1,
    },
  );
  const recentProactive = history.slice(-6);
  const recentForced = history.slice(-2);
  const normalPrompt = buildPromptWithHistory(args.userText, history, Math.min(args.historyTurns, 6));
  const proactivePrompt = buildPromptFromSnapshot({
    userText: args.userText,
    snapshot: snapshotProactive,
    recentRows: recentProactive,
    includeRecentRows: true,
  });
  const forcedPrompt = buildPromptFromSnapshot({
    userText: args.userText,
    snapshot: snapshotForced,
    recentRows: recentForced,
    includeRecentRows: true,
  });
  const minimalPrompt = buildPromptFromSnapshot({
    userText: args.userText,
    snapshot: snapshotMinimal,
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

function selectVariantWithBudgetGuard(args: {
  variants: readonly PromptVariant[];
  thresholdStage: PromptCompactionStage;
  targetTokenLimit: number;
}): {
  selected: PromptVariant;
  selectionReason: "threshold" | "budget_guard";
} {
  const thresholdVariant = findVariant(args.variants, args.thresholdStage);
  if (thresholdVariant.estimatedTokens <= args.targetTokenLimit) {
    return {
      selected: thresholdVariant,
      selectionReason: "threshold",
    };
  }
  let fallback = thresholdVariant;
  let stageCursor: PromptCompactionStage | undefined = thresholdVariant.stage;
  while (stageCursor) {
    const nextStage = nextCompactionStage(stageCursor);
    if (!nextStage) {
      break;
    }
    const candidate = findVariant(args.variants, nextStage);
    if (candidate.estimatedTokens < fallback.estimatedTokens) {
      fallback = candidate;
    }
    if (candidate.estimatedTokens <= args.targetTokenLimit) {
      return {
        selected: candidate,
        selectionReason: "budget_guard",
      };
    }
    stageCursor = nextStage;
  }
  return {
    selected: fallback,
    selectionReason: "budget_guard",
  };
}

export function preparePromptWithBudget(args: {
  userText: string;
  history: readonly ContextHistoryMessage[];
  historyTurns: number;
  workDir?: string;
  config: ContextEngineConfig;
}): PromptPreparationResult {
  const variants = buildVariants({
    userText: args.userText,
    history: args.history,
    historyTurns: args.historyTurns,
    workDir: args.workDir,
    config: args.config,
  });
  const { effectiveWindowTokens, autoCompactTokenLimit, targetTokenLimit } =
    resolvePromptTargetTokenLimit(args.config);
  const totalEstimatedTokens = variants[0]?.estimatedTokens ?? 0;
  const utilization = computeUtilization(totalEstimatedTokens, effectiveWindowTokens);
  const utilizationStage = args.config.enabled
    ? selectStageByUtilization(utilization, args.config)
    : "normal";
  const stageGuard = args.config.enabled
    ? applyAutoCompactGuardToStage({
      baseStage: utilizationStage,
      totalEstimatedTokens,
      autoCompactTokenLimit,
    })
    : {
      stage: utilizationStage,
      autoCompactLimitTriggered: false,
    };
  const thresholdStage = stageGuard.stage;
  const selection = args.config.enabled
    ? selectVariantWithBudgetGuard({
      variants,
      thresholdStage,
      targetTokenLimit,
    })
    : {
      selected: findVariant(variants, thresholdStage),
      selectionReason: "threshold" as const,
    };
  return {
    selected: selection.selected,
    variants: [...variants],
    thresholdStage,
    selectionReason: selection.selectionReason,
    autoCompactTokenLimit,
    targetTokenLimit,
    autoCompactLimitTriggered: stageGuard.autoCompactLimitTriggered,
    utilization,
    selectedUtilization: computeUtilization(selection.selected.estimatedTokens, effectiveWindowTokens),
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
