import {
  applyPromptQualityGuardFloor,
  assessPromptQualityWindowDegradation,
  derivePromptQualityGuardAdaptivePolicy,
  evaluatePromptQualityGuard,
  escalatePromptVariant,
  prepareTurnPrompt,
  readPromptQualityGuardState,
  readPromptQualityWindowSummary,
  shouldTriggerDownshiftPrecompact,
  writePromptQualityGuardState,
  type PromptCompactionStage,
} from "../../../../tools/context";
import {
  buildQualityGuardPolicyAdaptiveDiagnostic,
  buildQualityGuardPolicyDriftGuardDiagnostic,
  buildQualityGuardPrecompactDiagnostic,
} from "../prompt-quality-surface";
import type { CreateRunStartTurnRunnerInput } from "../contract";

type PromptPreparation = ReturnType<typeof prepareTurnPrompt>;
type PromptQualityConfig = CreateRunStartTurnRunnerInput["contextEngineConfig"]["promptQuality"];
type PromptQualityWindowSummary = ReturnType<typeof readPromptQualityWindowSummary>;

export function applyPromptContextQualityGuard(input: {
  runnerInput: CreateRunStartTurnRunnerInput;
  allowProactiveCompaction: boolean;
  previousTargetTokenLimit?: number;
  promptQualityConfig: PromptQualityConfig;
  promptQualityWindowSummary: PromptQualityWindowSummary;
  promptPreparation: PromptPreparation;
  selectedStage: PromptCompactionStage;
  basePrompt: string;
  selectionReason: "threshold" | "budget_guard";
  targetTokenLimit: number;
  writeTurnDiagnostic(message: string): void;
}): {
  selectedStage: PromptCompactionStage;
  basePrompt: string;
  selectionReason: "threshold" | "budget_guard";
  qualityGuardDecision: ReturnType<typeof evaluatePromptQualityGuard>;
  adaptiveGuardPolicyDecision: ReturnType<typeof derivePromptQualityGuardAdaptivePolicy>;
  qualityGuardActive: boolean;
  downshiftGuardTriggered: boolean;
} {
  const { runnerInput, promptQualityConfig, promptQualityWindowSummary } = input;
  let selectedStage = input.selectedStage;
  let basePrompt = input.basePrompt;
  let selectionReason = input.selectionReason;
  const promptQualityWindowDegradation = assessPromptQualityWindowDegradation({
    summary: promptQualityWindowSummary,
    thresholdOverall: promptQualityConfig?.degradeOverallThreshold ?? 0.62,
    thresholdLowQualityRate:
      promptQualityConfig?.degradeLowQualityRateThreshold ?? 0.4,
    minEntries: promptQualityConfig?.degradeMinEntries ?? 8,
  });
  const qualityGuardState = readPromptQualityGuardState({
    workDir: runnerInput.workDir,
  });
  const baseGuardPolicy = {
    enabled:
      input.allowProactiveCompaction && (promptQualityConfig?.guardEnabled ?? true),
    promoteStreak: promptQualityConfig?.guardPromoteStreak ?? 2,
    severePromoteStreak: promptQualityConfig?.guardSeverePromoteStreak ?? 2,
    releaseStreak: promptQualityConfig?.guardReleaseStreak ?? 3,
    holdTurns: promptQualityConfig?.guardHoldTurns ?? 2,
    maxFloorStage: promptQualityConfig?.guardMaxFloorStage ?? "minimal",
    severeOverallThreshold:
      promptQualityConfig?.guardSevereOverallThreshold ?? 0.45,
    severeLowQualityRateThreshold:
      promptQualityConfig?.guardSevereLowQualityRateThreshold ?? 0.7,
  };
  const adaptiveGuardPolicyDecision = derivePromptQualityGuardAdaptivePolicy({
    basePolicy: baseGuardPolicy,
    adaptiveEnabled: promptQualityConfig?.guardAdaptiveEnabled ?? true,
    adaptiveModeAllowlist: promptQualityConfig?.guardAdaptiveModeAllowlist,
    currentState: qualityGuardState,
    window: {
      degraded: promptQualityWindowDegradation.degraded,
      reason: promptQualityWindowDegradation.reason,
      lowQualityRate: promptQualityWindowSummary.lowQualityRate,
      averageOverall: promptQualityWindowSummary.averageScores?.overall ?? null,
      observedOverall: promptQualityWindowDegradation.observedOverall,
      observedLowQualityRate:
        promptQualityWindowDegradation.observedLowQualityRate,
      snapshotSemanticCompressRate:
        promptQualityWindowSummary.compressionActivity
          .snapshotSemanticCompressRate,
      autoLimitTriggeredRate:
        promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate,
      averageUtilizationRatio:
        promptQualityWindowSummary.tokenBudget.averageUtilizationRatio,
      shortSnapshotSemanticCompressRate:
        promptQualityWindowSummary.pressureTrends.short
          .snapshotSemanticCompressRate,
      mediumSnapshotSemanticCompressRate:
        promptQualityWindowSummary.pressureTrends.medium
          .snapshotSemanticCompressRate,
      shortAutoLimitTriggeredRate:
        promptQualityWindowSummary.pressureTrends.short.autoLimitTriggeredRate,
      mediumAutoLimitTriggeredRate:
        promptQualityWindowSummary.pressureTrends.medium.autoLimitTriggeredRate,
      shortAverageUtilizationRatio:
        promptQualityWindowSummary.pressureTrends.short.averageUtilizationRatio,
      mediumAverageUtilizationRatio:
        promptQualityWindowSummary.pressureTrends.medium
          .averageUtilizationRatio,
      hardBudgetStrategyRate:
        promptQualityWindowSummary.strategyActivity.hardBudgetRate,
      qualityFirstStrategyRate:
        promptQualityWindowSummary.strategyActivity.qualityFirstRate,
      averagePreSendOverflowRatio:
        promptQualityWindowSummary.signalAverages?.preSendOverflowRatio ?? null,
      averagePreSendPressureScore:
        promptQualityWindowSummary.signalAverages?.preSendPressureScore ?? null,
      shortHardBudgetStrategyRate:
        promptQualityWindowSummary.strategyTrends.short.hardBudgetRate,
      mediumHardBudgetStrategyRate:
        promptQualityWindowSummary.strategyTrends.medium.hardBudgetRate,
      shortAveragePreSendOverflowRatio:
        promptQualityWindowSummary.strategyTrends.short.averageOverflowRatio,
      mediumAveragePreSendOverflowRatio:
        promptQualityWindowSummary.strategyTrends.medium.averageOverflowRatio,
      shortAveragePreSendPressureScore:
        promptQualityWindowSummary.strategyTrends.short.averagePressureScore,
      mediumAveragePreSendPressureScore:
        promptQualityWindowSummary.strategyTrends.medium.averagePressureScore,
      hardBudgetFollowupOverallDelta:
        promptQualityWindowSummary.strategyOutcomes
          .hardBudgetFollowupOverallDelta,
      qualityFirstFollowupOverallDelta:
        promptQualityWindowSummary.strategyOutcomes
          .qualityFirstFollowupOverallDelta,
      hardBudgetRecoveryRate:
        promptQualityWindowSummary.strategyOutcomes.hardBudgetRecoveryRate,
      qualityFirstImprovedRate:
        promptQualityWindowSummary.strategyOutcomes.qualityFirstImprovedRate,
      hardBudgetTransitionCount:
        promptQualityWindowSummary.strategyOutcomes.hardBudgetTransitions,
      qualityFirstTransitionCount:
        promptQualityWindowSummary.strategyOutcomes.qualityFirstTransitions,
    },
  });
  if (
    adaptiveGuardPolicyDecision.mode !== "stable" &&
    adaptiveGuardPolicyDecision.mode !== "disabled"
  ) {
    input.writeTurnDiagnostic(
      buildQualityGuardPolicyAdaptiveDiagnostic({
        decision: adaptiveGuardPolicyDecision,
        summary: promptQualityWindowSummary,
      }),
    );
  }
  if (adaptiveGuardPolicyDecision.outcomeDriftGuard.highEvidenceHardenBias) {
    input.writeTurnDiagnostic(
      buildQualityGuardPolicyDriftGuardDiagnostic(adaptiveGuardPolicyDecision),
    );
  }
  const qualityGuardDecision = evaluatePromptQualityGuard({
    policy: adaptiveGuardPolicyDecision.effectivePolicy,
    currentState: qualityGuardState,
    observation: {
      degraded: promptQualityWindowDegradation.degraded,
      reason: promptQualityWindowDegradation.reason,
      observedOverall: promptQualityWindowDegradation.observedOverall,
      observedLowQualityRate:
        promptQualityWindowDegradation.observedLowQualityRate,
    },
  });
  writePromptQualityGuardState({
    workDir: runnerInput.workDir,
    state: {
      ...qualityGuardDecision.state,
      pressureUtilizationThreshold:
        adaptiveGuardPolicyDecision.pressurePolicy.utilizationThreshold,
      pressureSemanticRateThreshold:
        adaptiveGuardPolicyDecision.pressurePolicy.semanticRateThreshold,
      pressureAutoLimitRateThreshold:
        adaptiveGuardPolicyDecision.pressurePolicy.autoLimitRateThreshold,
      pressureJointRateThreshold:
        adaptiveGuardPolicyDecision.pressurePolicy.jointRateThreshold,
      pressureTrendUtilizationDelta:
        adaptiveGuardPolicyDecision.pressurePolicy.trendUtilizationDelta,
      pressureTrendSemanticDelta:
        adaptiveGuardPolicyDecision.pressurePolicy.trendSemanticDelta,
      pressureTrendAutoLimitDelta:
        adaptiveGuardPolicyDecision.pressurePolicy.trendAutoLimitDelta,
      pressureTrendMomentum:
        adaptiveGuardPolicyDecision.pressurePolicy.trendMomentum,
      outcomeRequiredTransitions:
        adaptiveGuardPolicyDecision.outcomeReliability.nextRequiredTransitions,
      outcomeCombinedEvidenceScore:
        adaptiveGuardPolicyDecision.outcomeReliability.combinedEvidenceScore,
      outcomeHighEvidenceTurns:
        adaptiveGuardPolicyDecision.outcomeDriftGuard.highEvidenceTurns,
      outcomeHighEvidenceHardenTurns:
        adaptiveGuardPolicyDecision.outcomeDriftGuard.highEvidenceHardenTurns,
      outcomeDriftRecentAutoActionLevels:
        adaptiveGuardPolicyDecision.outcomeDriftGuard.recentAutoActionLevels,
    },
  });
  const guardedStage = applyPromptQualityGuardFloor({
    selectedStage,
    floorStage: qualityGuardDecision.floorStage,
  });
  const qualityGuardActive = qualityGuardDecision.triggered;
  let qualityGuardEscalated = false;
  if (guardedStage !== selectedStage) {
    const guardedVariant = input.promptPreparation.variants.find(
      (variant) => variant.stage === guardedStage,
    );
    if (guardedVariant) {
      selectedStage = guardedVariant.stage;
      basePrompt = guardedVariant.prompt;
      selectionReason = "budget_guard";
      qualityGuardEscalated = true;
    }
  }
  if (
    qualityGuardEscalated ||
    qualityGuardDecision.promoted ||
    qualityGuardDecision.released
  ) {
    input.writeTurnDiagnostic(
      buildQualityGuardPrecompactDiagnostic({
        selectedStage,
        decision: qualityGuardDecision,
        degradation: promptQualityWindowDegradation,
      }),
    );
  }
  const downshiftGuardTriggered = shouldTriggerDownshiftPrecompact({
    allowProactiveCompaction: input.allowProactiveCompaction,
    previousTargetTokenLimit: input.previousTargetTokenLimit,
    currentTargetTokenLimit: input.targetTokenLimit,
    totalEstimatedTokens: input.promptPreparation.totalEstimatedTokens,
  });
  if (downshiftGuardTriggered) {
    const escalated = escalatePromptVariant(
      input.promptPreparation.variants,
      selectedStage,
    );
    if (escalated) {
      selectedStage = escalated.stage;
      basePrompt = escalated.prompt;
      selectionReason = "budget_guard";
      input.writeTurnDiagnostic(
        `[context-engine] event=downshift_precompact stage=${selectedStage} previous_limit=${String(input.previousTargetTokenLimit)} current_limit=${String(input.targetTokenLimit)}\n`,
      );
    }
  }

  return {
    selectedStage,
    basePrompt,
    selectionReason,
    qualityGuardDecision,
    adaptiveGuardPolicyDecision,
    qualityGuardActive,
    downshiftGuardTriggered,
  };
}
