import {
  compressPromptSnapshotSectionsSemanticallyForBudget,
  derivePromptPreSendCompressionPlan,
  escalatePromptVariant,
  estimateTokensFromText,
  trimPromptRecentTurnsForBudget,
  trimPromptSnapshotSectionsForBudget,
  truncatePromptHeadForPtlRetry,
  type PromptCompactionStage,
  type PromptPreparationResult,
  type PromptVariant,
} from "../../../tools/context";
import { compactSingleLine } from "../session-history";

type SelectionReason = "threshold" | "budget_guard";
type PreSendStrategy = "quality_first" | "hard_budget";

export interface PreSendPromptPreparationResult {
  preparedPromptVariants: PromptVariant[];
  selectedPrepared: PromptVariant;
  selectedStage: PromptCompactionStage;
  selectionReason: SelectionReason;
  historyCompacted: boolean;
  diagnostics: string[];
  preSendHeadTrimRetries: number;
  preSendRecentTrimRows: number;
  preSendSnapshotTrimSections: number;
  preSendSnapshotSemanticCompressSections: number;
  preSendCompressionStrategy: PreSendStrategy;
  preSendCompressionOverflowRatio: number;
  preSendCompressionPressureScore: number;
  preSendCompressionOrder: string;
}

function composeTurnPrompt(
  promptParts: readonly string[],
  conversationPrompt: string,
): string {
  return [...promptParts, conversationPrompt].join("\n\n");
}

function buildPreparedPromptVariants(input: {
  promptParts: readonly string[];
  promptPreparation: PromptPreparationResult;
}): PromptVariant[] {
  return input.promptPreparation.variants.map((variant) => {
    const prompt = composeTurnPrompt(input.promptParts, variant.prompt);
    return {
      stage: variant.stage,
      prompt,
      estimatedTokens: estimateTokensFromText(prompt),
    };
  });
}

function findPreparedVariantByStage(
  variants: readonly PromptVariant[],
  stage: PromptCompactionStage,
): PromptVariant {
  const matched = variants.find((item) => item.stage === stage);
  return matched ?? variants[0] as PromptVariant;
}

export function buildKimiBuiltinFallbackPreparedPrompt(input: {
  promptParts: readonly string[];
  conversationPrompt: string;
}): string {
  return composeTurnPrompt(input.promptParts, input.conversationPrompt);
}

export function preparePreSendPrompt(input: {
  allowProactiveCompaction: boolean;
  promptParts: readonly string[];
  promptPreparation: PromptPreparationResult;
  selectedStage: PromptCompactionStage;
  selectionReason: SelectionReason;
  targetTokenLimit: number;
  qualityGuardActive: boolean;
  qualityGuardSevere: boolean;
  pressureTrendMomentum?: number | null;
  workDir: string;
  userText: string;
  semanticPrefetchTimeoutMs: number;
  semanticPrefetchMaxEvidence: number;
  ptlMaxRetries: number;
}): PreSendPromptPreparationResult {
  const diagnostics: string[] = [];
  const preparedPromptVariants = buildPreparedPromptVariants({
    promptParts: input.promptParts,
    promptPreparation: input.promptPreparation,
  });
  let selectedStage = input.selectedStage;
  let selectionReason = input.selectionReason;
  let selectedPrepared = findPreparedVariantByStage(preparedPromptVariants, selectedStage);

  if (
    input.allowProactiveCompaction &&
    selectedPrepared.estimatedTokens > input.targetTokenLimit
  ) {
    let stageCursor = selectedPrepared.stage;
    let escalated = false;
    while (selectedPrepared.estimatedTokens > input.targetTokenLimit) {
      const next = escalatePromptVariant(preparedPromptVariants, stageCursor);
      if (!next) {
        break;
      }
      selectedPrepared = next;
      stageCursor = next.stage;
      escalated = true;
    }
    if (escalated) {
      selectedStage = selectedPrepared.stage;
      selectionReason = "budget_guard";
    }
  }

  let preSendHeadTrimRetries = 0;
  let preSendRecentTrimRows = 0;
  let preSendSnapshotTrimSections = 0;
  let preSendSnapshotSemanticCompressSections = 0;
  let preSendCompressionStrategy: PreSendStrategy = "quality_first";
  let preSendCompressionOverflowRatio = 0;
  let preSendCompressionPressureScore = 0;
  let preSendCompressionOrder = "recent_trim,snapshot_semantic_compress,snapshot_trim,head_trim";

  if (
    input.allowProactiveCompaction &&
    selectedPrepared.estimatedTokens > input.targetTokenLimit
  ) {
    const preSendCompressionPlan = derivePromptPreSendCompressionPlan({
      selectedStage,
      estimatedTokens: selectedPrepared.estimatedTokens,
      targetTokenLimit: input.targetTokenLimit,
      qualityGuardActive: input.qualityGuardActive,
      qualityGuardSevere: input.qualityGuardSevere,
      pressureTrendMomentum: input.pressureTrendMomentum,
    });
    preSendCompressionStrategy = preSendCompressionPlan.strategy;
    preSendCompressionOverflowRatio = preSendCompressionPlan.overflowRatio;
    preSendCompressionPressureScore = preSendCompressionPlan.pressureScore;
    preSendCompressionOrder = preSendCompressionPlan.order.join(",");
    diagnostics.push(
      `[context-engine] event=pre_send_plan stage=${selectedStage} strategy=${preSendCompressionStrategy} overflow_ratio=${preSendCompressionOverflowRatio.toFixed(3)} pressure_score=${preSendCompressionPressureScore.toFixed(3)} order=${preSendCompressionOrder}\n`,
    );

    for (const step of preSendCompressionPlan.order) {
      if (selectedPrepared.estimatedTokens <= input.targetTokenLimit) {
        break;
      }
      if (step === "recent_trim") {
        const recentTrimmed = trimPromptRecentTurnsForBudget({
          prompt: selectedPrepared.prompt,
          targetTokenLimit: input.targetTokenLimit,
          minRecentRows: 1,
        });
        if (recentTrimmed.removedRows > 0) {
          preSendRecentTrimRows = recentTrimmed.removedRows;
          selectedPrepared = {
            ...selectedPrepared,
            prompt: recentTrimmed.prompt,
            estimatedTokens: recentTrimmed.estimatedTokens,
          };
          selectionReason = "budget_guard";
          diagnostics.push(
            `[context-engine] event=pre_send_recent_trim stage=${selectedStage} removed_rows=${String(preSendRecentTrimRows)} estimated_tokens=${String(selectedPrepared.estimatedTokens)} target_limit=${String(input.targetTokenLimit)}\n`,
          );
        }
        continue;
      }
      if (step === "snapshot_semantic_compress") {
        const snapshotSemanticCompressed = compressPromptSnapshotSectionsSemanticallyForBudget({
          prompt: selectedPrepared.prompt,
          targetTokenLimit: input.targetTokenLimit,
          workDir: input.workDir,
          userText: input.userText,
          generativeTimeoutMs: input.semanticPrefetchTimeoutMs,
          generativeMaxEvidence: input.semanticPrefetchMaxEvidence,
        });
        if (snapshotSemanticCompressed.compressedSections.length > 0) {
          preSendSnapshotSemanticCompressSections =
            snapshotSemanticCompressed.compressedSections.length;
          selectedPrepared = {
            ...selectedPrepared,
            prompt: snapshotSemanticCompressed.prompt,
            estimatedTokens: snapshotSemanticCompressed.estimatedTokens,
          };
          selectionReason = "budget_guard";
          diagnostics.push(
            `[context-engine] event=pre_send_snapshot_semantic_compress stage=${selectedStage} compressed_sections=${String(preSendSnapshotSemanticCompressSections)} estimated_tokens=${String(selectedPrepared.estimatedTokens)} target_limit=${String(input.targetTokenLimit)}\n`,
          );
        }
        if (snapshotSemanticCompressed.generativeUsed) {
          diagnostics.push(
            `[context-engine] event=pre_send_snapshot_semantic_generate stage=${selectedStage} generated_sections=${String(snapshotSemanticCompressed.generativeSections.length)} estimated_tokens=${String(selectedPrepared.estimatedTokens)} target_limit=${String(input.targetTokenLimit)}\n`,
          );
        }
        if (snapshotSemanticCompressed.warnings.length > 0) {
          diagnostics.push(
            `[context-engine] event=pre_send_snapshot_semantic_generate status=degraded message=${compactSingleLine(snapshotSemanticCompressed.warnings.join("; "), 180)}\n`,
          );
        }
        continue;
      }
      if (step === "snapshot_trim") {
        const snapshotTrimmed = trimPromptSnapshotSectionsForBudget({
          prompt: selectedPrepared.prompt,
          targetTokenLimit: input.targetTokenLimit,
        });
        if (snapshotTrimmed.removedSections.length > 0) {
          preSendSnapshotTrimSections = snapshotTrimmed.removedSections.length;
          selectedPrepared = {
            ...selectedPrepared,
            prompt: snapshotTrimmed.prompt,
            estimatedTokens: snapshotTrimmed.estimatedTokens,
          };
          selectionReason = "budget_guard";
          diagnostics.push(
            `[context-engine] event=pre_send_snapshot_trim stage=${selectedStage} removed_sections=${String(preSendSnapshotTrimSections)} estimated_tokens=${String(selectedPrepared.estimatedTokens)} target_limit=${String(input.targetTokenLimit)}\n`,
          );
        }
        continue;
      }
      while (
        selectedPrepared.estimatedTokens > input.targetTokenLimit &&
        preSendHeadTrimRetries < input.ptlMaxRetries
      ) {
        const trimmedPrompt = truncatePromptHeadForPtlRetry(
          selectedPrepared.prompt,
          preSendHeadTrimRetries + 1,
        );
        if (trimmedPrompt === selectedPrepared.prompt) {
          break;
        }
        preSendHeadTrimRetries += 1;
        selectedPrepared = {
          ...selectedPrepared,
          prompt: trimmedPrompt,
          estimatedTokens: estimateTokensFromText(trimmedPrompt),
        };
        selectionReason = "budget_guard";
      }
    }
  }

  if (preSendHeadTrimRetries > 0) {
    diagnostics.push(
      `[context-engine] event=pre_send_head_trim stage=${selectedStage} retries=${String(preSendHeadTrimRetries)} estimated_tokens=${String(selectedPrepared.estimatedTokens)} effective_window=${String(input.promptPreparation.effectiveWindowTokens)} target_limit=${String(input.targetTokenLimit)}\n`,
    );
  }

  return {
    preparedPromptVariants,
    selectedPrepared,
    selectedStage,
    selectionReason,
    historyCompacted:
      selectedStage !== "normal"
      || preSendRecentTrimRows > 0
      || preSendSnapshotTrimSections > 0
      || preSendSnapshotSemanticCompressSections > 0
      || preSendHeadTrimRetries > 0,
    diagnostics,
    preSendHeadTrimRetries,
    preSendRecentTrimRows,
    preSendSnapshotTrimSections,
    preSendSnapshotSemanticCompressSections,
    preSendCompressionStrategy,
    preSendCompressionOverflowRatio,
    preSendCompressionPressureScore,
    preSendCompressionOrder,
  };
}
