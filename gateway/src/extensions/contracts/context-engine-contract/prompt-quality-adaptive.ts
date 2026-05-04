import {
  applyPromptQualityGuardFloor,
  defaultPromptQualityGuardState,
  derivePromptQualityGuardAdaptivePolicy,
  derivePromptQualityGuardOutcomeDriftGuard,
  evaluatePromptQualityGuard,
  normalizePromptQualityGuardState,
  type PromptCompactionStage,
} from "../../../tools/context";
import {
  parsePromptQualityGuardAdaptiveModeAllowlist,
  parsePromptQualityGuardPolicy,
} from "./prompt-quality-guard";
import { isRecord, normalizePromptCompactionStage } from "./prompt-quality-shared";

function parsePromptQualityGuardAdaptiveWindow(payload: Record<string, unknown>) {
  return {
    degraded: payload.degraded === true,
    reason: typeof payload.reason === "string" ? payload.reason : "unknown",
    lowQualityRate:
      typeof payload.low_quality_rate === "number" && Number.isFinite(payload.low_quality_rate)
        ? payload.low_quality_rate
        : null,
    averageOverall:
      typeof payload.average_overall === "number" && Number.isFinite(payload.average_overall)
        ? payload.average_overall
        : null,
    observedOverall:
      typeof payload.observed_overall === "number" && Number.isFinite(payload.observed_overall)
        ? payload.observed_overall
        : null,
    observedLowQualityRate:
      typeof payload.observed_low_quality_rate === "number"
      && Number.isFinite(payload.observed_low_quality_rate)
        ? payload.observed_low_quality_rate
        : null,
    snapshotSemanticCompressRate:
      typeof payload.snapshot_semantic_compress_rate === "number"
      && Number.isFinite(payload.snapshot_semantic_compress_rate)
        ? payload.snapshot_semantic_compress_rate
        : null,
    autoLimitTriggeredRate:
      typeof payload.auto_limit_triggered_rate === "number"
      && Number.isFinite(payload.auto_limit_triggered_rate)
        ? payload.auto_limit_triggered_rate
        : null,
    averageUtilizationRatio:
      typeof payload.average_utilization_ratio === "number"
      && Number.isFinite(payload.average_utilization_ratio)
        ? payload.average_utilization_ratio
        : null,
    shortSnapshotSemanticCompressRate:
      typeof payload.short_snapshot_semantic_compress_rate === "number"
      && Number.isFinite(payload.short_snapshot_semantic_compress_rate)
        ? payload.short_snapshot_semantic_compress_rate
        : null,
    mediumSnapshotSemanticCompressRate:
      typeof payload.medium_snapshot_semantic_compress_rate === "number"
      && Number.isFinite(payload.medium_snapshot_semantic_compress_rate)
        ? payload.medium_snapshot_semantic_compress_rate
        : null,
    shortAutoLimitTriggeredRate:
      typeof payload.short_auto_limit_triggered_rate === "number"
      && Number.isFinite(payload.short_auto_limit_triggered_rate)
        ? payload.short_auto_limit_triggered_rate
        : null,
    mediumAutoLimitTriggeredRate:
      typeof payload.medium_auto_limit_triggered_rate === "number"
      && Number.isFinite(payload.medium_auto_limit_triggered_rate)
        ? payload.medium_auto_limit_triggered_rate
        : null,
    shortAverageUtilizationRatio:
      typeof payload.short_average_utilization_ratio === "number"
      && Number.isFinite(payload.short_average_utilization_ratio)
        ? payload.short_average_utilization_ratio
        : null,
    mediumAverageUtilizationRatio:
      typeof payload.medium_average_utilization_ratio === "number"
      && Number.isFinite(payload.medium_average_utilization_ratio)
        ? payload.medium_average_utilization_ratio
        : null,
    hardBudgetStrategyRate:
      typeof payload.hard_budget_strategy_rate === "number"
      && Number.isFinite(payload.hard_budget_strategy_rate)
        ? payload.hard_budget_strategy_rate
        : null,
    qualityFirstStrategyRate:
      typeof payload.quality_first_strategy_rate === "number"
      && Number.isFinite(payload.quality_first_strategy_rate)
        ? payload.quality_first_strategy_rate
        : null,
    averagePreSendOverflowRatio:
      typeof payload.average_pre_send_overflow_ratio === "number"
      && Number.isFinite(payload.average_pre_send_overflow_ratio)
        ? payload.average_pre_send_overflow_ratio
        : null,
    averagePreSendPressureScore:
      typeof payload.average_pre_send_pressure_score === "number"
      && Number.isFinite(payload.average_pre_send_pressure_score)
        ? payload.average_pre_send_pressure_score
        : null,
    shortHardBudgetStrategyRate:
      typeof payload.short_hard_budget_strategy_rate === "number"
      && Number.isFinite(payload.short_hard_budget_strategy_rate)
        ? payload.short_hard_budget_strategy_rate
        : null,
    mediumHardBudgetStrategyRate:
      typeof payload.medium_hard_budget_strategy_rate === "number"
      && Number.isFinite(payload.medium_hard_budget_strategy_rate)
        ? payload.medium_hard_budget_strategy_rate
        : null,
    shortAveragePreSendOverflowRatio:
      typeof payload.short_average_pre_send_overflow_ratio === "number"
      && Number.isFinite(payload.short_average_pre_send_overflow_ratio)
        ? payload.short_average_pre_send_overflow_ratio
        : null,
    mediumAveragePreSendOverflowRatio:
      typeof payload.medium_average_pre_send_overflow_ratio === "number"
      && Number.isFinite(payload.medium_average_pre_send_overflow_ratio)
        ? payload.medium_average_pre_send_overflow_ratio
        : null,
    shortAveragePreSendPressureScore:
      typeof payload.short_average_pre_send_pressure_score === "number"
      && Number.isFinite(payload.short_average_pre_send_pressure_score)
        ? payload.short_average_pre_send_pressure_score
        : null,
    mediumAveragePreSendPressureScore:
      typeof payload.medium_average_pre_send_pressure_score === "number"
      && Number.isFinite(payload.medium_average_pre_send_pressure_score)
        ? payload.medium_average_pre_send_pressure_score
        : null,
    hardBudgetFollowupOverallDelta:
      typeof payload.hard_budget_followup_overall_delta === "number"
      && Number.isFinite(payload.hard_budget_followup_overall_delta)
        ? payload.hard_budget_followup_overall_delta
        : null,
    qualityFirstFollowupOverallDelta:
      typeof payload.quality_first_followup_overall_delta === "number"
      && Number.isFinite(payload.quality_first_followup_overall_delta)
        ? payload.quality_first_followup_overall_delta
        : null,
    hardBudgetRecoveryRate:
      typeof payload.hard_budget_recovery_rate === "number"
      && Number.isFinite(payload.hard_budget_recovery_rate)
        ? payload.hard_budget_recovery_rate
        : null,
    qualityFirstImprovedRate:
      typeof payload.quality_first_improved_rate === "number"
      && Number.isFinite(payload.quality_first_improved_rate)
        ? payload.quality_first_improved_rate
        : null,
    hardBudgetTransitionCount:
      typeof payload.hard_budget_transition_count === "number"
      && Number.isFinite(payload.hard_budget_transition_count)
        ? Math.max(0, Math.floor(payload.hard_budget_transition_count))
        : null,
    qualityFirstTransitionCount:
      typeof payload.quality_first_transition_count === "number"
      && Number.isFinite(payload.quality_first_transition_count)
        ? Math.max(0, Math.floor(payload.quality_first_transition_count))
        : null,
  };
}

export function runPromptQualityGuardAdaptivePolicy(payload: Record<string, unknown>): Record<string, unknown> {
  const basePolicy = parsePromptQualityGuardPolicy(payload);
  const state = isRecord(payload.state)
    ? normalizePromptQualityGuardState(payload.state)
    : defaultPromptQualityGuardState();
  const window = parsePromptQualityGuardAdaptiveWindow(payload);
  const decision = derivePromptQualityGuardAdaptivePolicy({
    basePolicy,
    adaptiveEnabled: payload.adaptive_enabled !== false,
    adaptiveModeAllowlist: parsePromptQualityGuardAdaptiveModeAllowlist(payload),
    currentState: state,
    window,
  });
  return {
    decision: {
      enabled: decision.enabled,
      mode: decision.mode,
      reason: decision.reason,
      allowlist: decision.allowlist,
      mode_blocked: decision.modeBlocked,
      blocked_mode: decision.blockedMode,
      adjustment: {
        promote_streak_delta: decision.adjustment.promoteStreakDelta,
        severe_promote_streak_delta: decision.adjustment.severePromoteStreakDelta,
        release_streak_delta: decision.adjustment.releaseStreakDelta,
        hold_turns_delta: decision.adjustment.holdTurnsDelta,
      },
      base_policy: {
        enabled: decision.basePolicy.enabled,
        promote_streak: decision.basePolicy.promoteStreak,
        severe_promote_streak: decision.basePolicy.severePromoteStreak,
        release_streak: decision.basePolicy.releaseStreak,
        hold_turns: decision.basePolicy.holdTurns,
        max_floor_stage: decision.basePolicy.maxFloorStage,
      },
      effective_policy: {
        enabled: decision.effectivePolicy.enabled,
        promote_streak: decision.effectivePolicy.promoteStreak,
        severe_promote_streak: decision.effectivePolicy.severePromoteStreak,
        release_streak: decision.effectivePolicy.releaseStreak,
        hold_turns: decision.effectivePolicy.holdTurns,
        max_floor_stage: decision.effectivePolicy.maxFloorStage,
      },
      pressure_policy: {
        source: decision.pressurePolicy.source,
        updated: decision.pressurePolicy.updated,
        learn_alpha: decision.pressurePolicy.learnAlpha,
        utilization_threshold: decision.pressurePolicy.utilizationThreshold,
        semantic_rate_threshold: decision.pressurePolicy.semanticRateThreshold,
        auto_limit_rate_threshold: decision.pressurePolicy.autoLimitRateThreshold,
        joint_rate_threshold: decision.pressurePolicy.jointRateThreshold,
        trend_utilization_delta: decision.pressurePolicy.trendUtilizationDelta,
        trend_semantic_delta: decision.pressurePolicy.trendSemanticDelta,
        trend_auto_limit_delta: decision.pressurePolicy.trendAutoLimitDelta,
        trend_momentum: decision.pressurePolicy.trendMomentum,
        trend_flip_suppressed: decision.pressurePolicy.trendFlipSuppressed,
      },
      outcome_reliability: {
        required_transitions: decision.outcomeReliability.requiredTransitions,
        next_required_transitions: decision.outcomeReliability.nextRequiredTransitions,
        hard_budget_transitions: decision.outcomeReliability.hardBudgetTransitions,
        quality_first_transitions: decision.outcomeReliability.qualityFirstTransitions,
        hard_budget_evidence_score: decision.outcomeReliability.hardBudgetEvidenceScore,
        quality_first_evidence_score: decision.outcomeReliability.qualityFirstEvidenceScore,
        combined_evidence_score: decision.outcomeReliability.combinedEvidenceScore,
        hard_budget_reliable: decision.outcomeReliability.hardBudgetReliable,
        quality_first_reliable: decision.outcomeReliability.qualityFirstReliable,
      },
      outcome_drift_guard: {
        high_evidence_harden_bias: decision.outcomeDriftGuard.highEvidenceHardenBias,
        high_evidence_turn: decision.outcomeDriftGuard.highEvidenceTurn,
        high_evidence_turns: decision.outcomeDriftGuard.highEvidenceTurns,
        high_evidence_harden_turns: decision.outcomeDriftGuard.highEvidenceHardenTurns,
        high_evidence_harden_rate: decision.outcomeDriftGuard.highEvidenceHardenRate,
        threshold_harden_rate: decision.outcomeDriftGuard.thresholdHardenRate,
        min_high_evidence_turns: decision.outcomeDriftGuard.minHighEvidenceTurns,
        reason: decision.outcomeDriftGuard.reason,
        auto_action_level: decision.outcomeDriftGuard.autoActionLevel,
        recent_auto_action_levels: decision.outcomeDriftGuard.recentAutoActionLevels,
        window_summary: {
          window_size: decision.outcomeDriftGuard.windowSummary.windowSize,
          entries: decision.outcomeDriftGuard.windowSummary.entries,
          latest: decision.outcomeDriftGuard.windowSummary.latest,
          dominant: decision.outcomeDriftGuard.windowSummary.dominant,
          alert_level: decision.outcomeDriftGuard.windowSummary.alertLevel,
          transition_count: decision.outcomeDriftGuard.windowSummary.transitionCount,
          active_rate: decision.outcomeDriftGuard.windowSummary.activeRate,
          medium_or_hard_rate: decision.outcomeDriftGuard.windowSummary.mediumOrHardRate,
          hard_rate: decision.outcomeDriftGuard.windowSummary.hardRate,
          level_counts: decision.outcomeDriftGuard.windowSummary.levelCounts,
        },
        recommendation: decision.outcomeDriftGuard.recommendation,
      },
      window: {
        degraded: window.degraded,
        reason: window.reason,
        low_quality_rate: window.lowQualityRate,
        average_overall: window.averageOverall,
        observed_overall: window.observedOverall,
        observed_low_quality_rate: window.observedLowQualityRate,
        snapshot_semantic_compress_rate: window.snapshotSemanticCompressRate,
        auto_limit_triggered_rate: window.autoLimitTriggeredRate,
        average_utilization_ratio: window.averageUtilizationRatio,
        short_snapshot_semantic_compress_rate: window.shortSnapshotSemanticCompressRate,
        medium_snapshot_semantic_compress_rate: window.mediumSnapshotSemanticCompressRate,
        short_auto_limit_triggered_rate: window.shortAutoLimitTriggeredRate,
        medium_auto_limit_triggered_rate: window.mediumAutoLimitTriggeredRate,
        short_average_utilization_ratio: window.shortAverageUtilizationRatio,
        medium_average_utilization_ratio: window.mediumAverageUtilizationRatio,
        hard_budget_strategy_rate: window.hardBudgetStrategyRate,
        quality_first_strategy_rate: window.qualityFirstStrategyRate,
        average_pre_send_overflow_ratio: window.averagePreSendOverflowRatio,
        average_pre_send_pressure_score: window.averagePreSendPressureScore,
        short_hard_budget_strategy_rate: window.shortHardBudgetStrategyRate,
        medium_hard_budget_strategy_rate: window.mediumHardBudgetStrategyRate,
        short_average_pre_send_overflow_ratio: window.shortAveragePreSendOverflowRatio,
        medium_average_pre_send_overflow_ratio: window.mediumAveragePreSendOverflowRatio,
        short_average_pre_send_pressure_score: window.shortAveragePreSendPressureScore,
        medium_average_pre_send_pressure_score: window.mediumAveragePreSendPressureScore,
        hard_budget_followup_overall_delta: window.hardBudgetFollowupOverallDelta,
        quality_first_followup_overall_delta: window.qualityFirstFollowupOverallDelta,
        hard_budget_recovery_rate: window.hardBudgetRecoveryRate,
        quality_first_improved_rate: window.qualityFirstImprovedRate,
        hard_budget_transition_count: window.hardBudgetTransitionCount,
        quality_first_transition_count: window.qualityFirstTransitionCount,
      },
    },
  };
}

export function runPromptQualityGuardAdaptiveSequence(payload: Record<string, unknown>): Record<string, unknown> {
  const basePolicy = parsePromptQualityGuardPolicy(payload);
  const adaptiveEnabled = payload.adaptive_enabled !== false;
  const adaptiveModeAllowlist = parsePromptQualityGuardAdaptiveModeAllowlist(payload);
  const selectedStage = normalizePromptCompactionStage(payload.selected_stage);
  const windowsRaw = Array.isArray(payload.windows) ? payload.windows : [];
  if (windowsRaw.length === 0) {
    throw new Error("payload.windows must be a non-empty array");
  }
  let state = isRecord(payload.state)
    ? normalizePromptQualityGuardState(payload.state)
    : defaultPromptQualityGuardState();
  let previousMode: string | null = null;
  let modeTransitionCount = 0;
  let trendFlipSuppressedCount = 0;
  let previousUtilizationThreshold: number | null = null;
  let previousNextRequiredTransitions: number | null = null;
  let maxUtilizationThresholdStep = 0;
  let totalUtilizationThresholdStep = 0;
  let utilizationThresholdStepSamples = 0;
  let nextRequiredTransitionStepCount = 0;
  let hardBudgetReliableCount = 0;
  let qualityFirstReliableCount = 0;
  let highEvidenceTurns = 0;
  let highEvidenceHardenTurns = 0;
  const learnAlphaValues: number[] = [];
  const requiredTransitionsValues: number[] = [];
  const nextRequiredTransitionsValues: number[] = [];
  const combinedEvidenceScoreValues: number[] = [];
  const floorStages: PromptCompactionStage[] = [];
  const modes: string[] = [];

  for (let index = 0; index < windowsRaw.length; index += 1) {
    const row = windowsRaw[index];
    if (!isRecord(row)) {
      continue;
    }
    const window = parsePromptQualityGuardAdaptiveWindow(row);
    const adaptiveDecision = derivePromptQualityGuardAdaptivePolicy({
      basePolicy,
      adaptiveEnabled,
      adaptiveModeAllowlist,
      currentState: state,
      window,
    });
    const observation = {
      degraded: window.degraded,
      reason: window.reason,
      observedOverall: window.observedOverall,
      observedLowQualityRate: window.observedLowQualityRate,
    };
    const guardDecision = evaluatePromptQualityGuard({
      policy: adaptiveDecision.effectivePolicy,
      currentState: state,
      observation,
    });
    state = {
      ...guardDecision.state,
      pressureUtilizationThreshold: adaptiveDecision.pressurePolicy.utilizationThreshold,
      pressureSemanticRateThreshold: adaptiveDecision.pressurePolicy.semanticRateThreshold,
      pressureAutoLimitRateThreshold: adaptiveDecision.pressurePolicy.autoLimitRateThreshold,
      pressureJointRateThreshold: adaptiveDecision.pressurePolicy.jointRateThreshold,
      pressureTrendUtilizationDelta: adaptiveDecision.pressurePolicy.trendUtilizationDelta,
      pressureTrendSemanticDelta: adaptiveDecision.pressurePolicy.trendSemanticDelta,
      pressureTrendAutoLimitDelta: adaptiveDecision.pressurePolicy.trendAutoLimitDelta,
      pressureTrendMomentum: adaptiveDecision.pressurePolicy.trendMomentum,
      outcomeRequiredTransitions: adaptiveDecision.outcomeReliability.nextRequiredTransitions,
      outcomeCombinedEvidenceScore: adaptiveDecision.outcomeReliability.combinedEvidenceScore,
    };
    requiredTransitionsValues.push(adaptiveDecision.outcomeReliability.requiredTransitions);
    nextRequiredTransitionsValues.push(adaptiveDecision.outcomeReliability.nextRequiredTransitions);
    combinedEvidenceScoreValues.push(adaptiveDecision.outcomeReliability.combinedEvidenceScore);
    if (
      previousNextRequiredTransitions !== null
      && previousNextRequiredTransitions !== adaptiveDecision.outcomeReliability.nextRequiredTransitions
    ) {
      nextRequiredTransitionStepCount += 1;
    }
    previousNextRequiredTransitions = adaptiveDecision.outcomeReliability.nextRequiredTransitions;
    if (adaptiveDecision.outcomeReliability.hardBudgetReliable) {
      hardBudgetReliableCount += 1;
    }
    if (adaptiveDecision.outcomeReliability.qualityFirstReliable) {
      qualityFirstReliableCount += 1;
    }
    const highEvidenceTurn =
      adaptiveDecision.outcomeReliability.combinedEvidenceScore >= 0.72
      && (
        adaptiveDecision.outcomeReliability.hardBudgetReliable
        || adaptiveDecision.outcomeReliability.qualityFirstReliable
      );
    if (highEvidenceTurn) {
      highEvidenceTurns += 1;
      if (adaptiveDecision.mode === "harden") {
        highEvidenceHardenTurns += 1;
      }
    }
    const appliedStage = applyPromptQualityGuardFloor({
      selectedStage,
      floorStage: guardDecision.floorStage,
    });
    floorStages.push(appliedStage);
    modes.push(adaptiveDecision.mode);
    if (previousMode !== null && previousMode !== adaptiveDecision.mode) {
      modeTransitionCount += 1;
    }
    previousMode = adaptiveDecision.mode;
    if (adaptiveDecision.pressurePolicy.trendFlipSuppressed) {
      trendFlipSuppressedCount += 1;
    }
    learnAlphaValues.push(adaptiveDecision.pressurePolicy.learnAlpha);
    if (previousUtilizationThreshold !== null) {
      const step = Math.abs(
        adaptiveDecision.pressurePolicy.utilizationThreshold - previousUtilizationThreshold,
      );
      maxUtilizationThresholdStep = Math.max(maxUtilizationThresholdStep, step);
      totalUtilizationThresholdStep += step;
      utilizationThresholdStepSamples += 1;
    }
    previousUtilizationThreshold = adaptiveDecision.pressurePolicy.utilizationThreshold;
  }

  const totalTurns = learnAlphaValues.length;
  const uniqueModes = Array.from(new Set(modes));
  const uniqueStages = Array.from(new Set(floorStages));
  const learnAlphaMin = totalTurns > 0 ? Math.min(...learnAlphaValues) : null;
  const learnAlphaMax = totalTurns > 0 ? Math.max(...learnAlphaValues) : null;
  const learnAlphaAvg = totalTurns > 0
    ? Math.round((learnAlphaValues.reduce((sum, value) => sum + value, 0) / totalTurns) * 1000) / 1000
    : null;
  const modeTransitionRate = totalTurns > 1
    ? Math.round((modeTransitionCount / (totalTurns - 1)) * 1000) / 1000
    : 0;
  const trendFlipSuppressedRate = totalTurns > 0
    ? Math.round((trendFlipSuppressedCount / totalTurns) * 1000) / 1000
    : 0;
  const requiredTransitionsMin = totalTurns > 0 ? Math.min(...requiredTransitionsValues) : null;
  const requiredTransitionsMax = totalTurns > 0 ? Math.max(...requiredTransitionsValues) : null;
  const requiredTransitionsAvg = totalTurns > 0
    ? Math.round((requiredTransitionsValues.reduce((sum, value) => sum + value, 0) / totalTurns) * 1000) / 1000
    : null;
  const nextRequiredTransitionsMin = totalTurns > 0 ? Math.min(...nextRequiredTransitionsValues) : null;
  const nextRequiredTransitionsMax = totalTurns > 0 ? Math.max(...nextRequiredTransitionsValues) : null;
  const nextRequiredTransitionsAvg = totalTurns > 0
    ? Math.round((nextRequiredTransitionsValues.reduce((sum, value) => sum + value, 0) / totalTurns) * 1000) / 1000
    : null;
  const combinedEvidenceScoreMin = totalTurns > 0 ? Math.min(...combinedEvidenceScoreValues) : null;
  const combinedEvidenceScoreMax = totalTurns > 0 ? Math.max(...combinedEvidenceScoreValues) : null;
  const combinedEvidenceScoreAvg = totalTurns > 0
    ? Math.round((combinedEvidenceScoreValues.reduce((sum, value) => sum + value, 0) / totalTurns) * 1000) / 1000
    : null;
  const hardBudgetReliableRate = totalTurns > 0
    ? Math.round((hardBudgetReliableCount / totalTurns) * 1000) / 1000
    : 0;
  const qualityFirstReliableRate = totalTurns > 0
    ? Math.round((qualityFirstReliableCount / totalTurns) * 1000) / 1000
    : 0;
  const driftGuardBase = derivePromptQualityGuardOutcomeDriftGuard({
    highEvidenceTurn: false,
    highEvidenceTurns,
    highEvidenceHardenTurns,
  });
  const driftWindowSeedEntries = Math.min(
    highEvidenceTurns,
    driftGuardBase.windowSummary.windowSize,
  );
  const driftWindowSeed = Array.from(
    { length: driftWindowSeedEntries },
    () => driftGuardBase.autoActionLevel,
  );
  const driftGuard = derivePromptQualityGuardOutcomeDriftGuard({
    highEvidenceTurn: false,
    highEvidenceTurns,
    highEvidenceHardenTurns,
    recentAutoActionLevels: driftWindowSeed,
  });

  return {
    turns: totalTurns,
    selected_stage: selectedStage,
    adaptive_enabled: adaptiveEnabled,
    adaptive_mode_allowlist: adaptiveModeAllowlist,
    mode_transitions: {
      count: modeTransitionCount,
      rate: modeTransitionRate,
      unique_modes: uniqueModes,
    },
    floor_stages: {
      unique_stages: uniqueStages,
      final_stage: floorStages[floorStages.length - 1] ?? selectedStage,
    },
    pressure_alpha: {
      min: learnAlphaMin,
      max: learnAlphaMax,
      avg: learnAlphaAvg,
    },
    pressure_threshold_steps: {
      max_utilization_step:
        Math.round(maxUtilizationThresholdStep * 1000) / 1000,
      avg_utilization_step:
        utilizationThresholdStepSamples > 0
          ? Math.round((totalUtilizationThresholdStep / utilizationThresholdStepSamples) * 1000) / 1000
          : 0,
      samples: utilizationThresholdStepSamples,
    },
    trend_flip_suppressed: {
      count: trendFlipSuppressedCount,
      rate: trendFlipSuppressedRate,
    },
    outcome_reliability: {
      required_transitions: {
        min: requiredTransitionsMin,
        max: requiredTransitionsMax,
        avg: requiredTransitionsAvg,
        final: requiredTransitionsValues[requiredTransitionsValues.length - 1] ?? null,
      },
      next_required_transitions: {
        min: nextRequiredTransitionsMin,
        max: nextRequiredTransitionsMax,
        avg: nextRequiredTransitionsAvg,
        final: nextRequiredTransitionsValues[nextRequiredTransitionsValues.length - 1] ?? null,
        transitions: nextRequiredTransitionStepCount,
      },
      combined_evidence_score: {
        min: combinedEvidenceScoreMin,
        max: combinedEvidenceScoreMax,
        avg: combinedEvidenceScoreAvg,
        final: combinedEvidenceScoreValues[combinedEvidenceScoreValues.length - 1] ?? null,
      },
      reliable_rate: {
        hard_budget: hardBudgetReliableRate,
        quality_first: qualityFirstReliableRate,
      },
    },
    drift_guard: {
      high_evidence_harden_bias: driftGuard.highEvidenceHardenBias,
      high_evidence_turns: driftGuard.highEvidenceTurns,
      high_evidence_harden_turns: driftGuard.highEvidenceHardenTurns,
      high_evidence_harden_rate: driftGuard.highEvidenceHardenRate,
      threshold_harden_rate: driftGuard.thresholdHardenRate,
      min_high_evidence_turns: driftGuard.minHighEvidenceTurns,
      reason: driftGuard.reason,
      auto_action_level: driftGuard.autoActionLevel,
      recent_auto_action_levels: driftGuard.recentAutoActionLevels,
      window_summary: {
        window_size: driftGuard.windowSummary.windowSize,
        entries: driftGuard.windowSummary.entries,
        latest: driftGuard.windowSummary.latest,
        dominant: driftGuard.windowSummary.dominant,
        alert_level: driftGuard.windowSummary.alertLevel,
        transition_count: driftGuard.windowSummary.transitionCount,
        active_rate: driftGuard.windowSummary.activeRate,
        medium_or_hard_rate: driftGuard.windowSummary.mediumOrHardRate,
        hard_rate: driftGuard.windowSummary.hardRate,
        level_counts: driftGuard.windowSummary.levelCounts,
      },
      recommendation: driftGuard.recommendation,
    },
    final_state: state,
  };
}
