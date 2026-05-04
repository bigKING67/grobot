import type {
  ContextEngineConfig,
  ContextStorageDomain,
} from "../../tools/context";
import type {
  PromptQualityGuardAdaptiveDecision,
  PromptQualityGuardRuntimeAssessment,
  PromptQualityGuardState,
} from "../../tools/context/compress/prompt-quality-guard";
import type {
  PromptQualityWindowDegradation,
  PromptQualityWindowSummary,
} from "../../tools/context/compress/prompt-quality-window";
import type {
  MemoryDecayAutotuneState,
  MemoryOrchestratorPolicySnapshot,
  MemoryStrategyAutotuneState,
} from "../../tools/memory";

export interface ContextEngineTokenBudgetStatus {
  autoCompactTokenLimit: number;
  targetTokenLimit: number;
  effectiveWindowTokens: number;
}

export function serializeContextEngineStatus(input: {
  contextEngineConfig: ContextEngineConfig;
  contextEngineTokenBudget: ContextEngineTokenBudgetStatus;
  promptQualityGuardState: PromptQualityGuardState;
  promptQualityGuardStatePersistenceDomain: ContextStorageDomain;
  promptQualityGuardRuntimeAssessment: PromptQualityGuardRuntimeAssessment;
  promptQualityGuardAdaptivePolicy: PromptQualityGuardAdaptiveDecision;
  promptQualityWindowSummary: PromptQualityWindowSummary;
  promptQualityWindowDegradation: PromptQualityWindowDegradation;
  promptQualityWindowPersistenceDomain: ContextStorageDomain;
  lineageDiffCachePersistenceDomain: ContextStorageDomain;
  memoryOrchestratorPolicy: MemoryOrchestratorPolicySnapshot;
  memoryDecayAutotuneState: MemoryDecayAutotuneState;
  memoryDecayAutotuneStatePersistenceDomain: ContextStorageDomain;
  memoryStrategyAutotuneState: MemoryStrategyAutotuneState;
  memoryStrategyAutotuneStatePersistenceDomain: ContextStorageDomain;
  graphQualitySignals: Record<string, unknown>;
}): Record<string, unknown> {
  const config = input.contextEngineConfig;
  const guardState = input.promptQualityGuardState;
  const guardRuntime = input.promptQualityGuardRuntimeAssessment;
  const adaptivePolicy = input.promptQualityGuardAdaptivePolicy;
  const promptWindow = input.promptQualityWindowSummary;
  const promptDegradation = input.promptQualityWindowDegradation;
  const memoryPolicy = input.memoryOrchestratorPolicy;
  const memoryDecayState = input.memoryDecayAutotuneState;
  const memoryStrategyState = input.memoryStrategyAutotuneState;
  return {
    enabled: config.enabled,
    profile: config.profile,
    context_window_tokens: config.contextWindowTokens,
    reserved_output_tokens: config.reservedOutputTokens,
    safety_margin_tokens: config.safetyMarginTokens,
    auto_compact_token_limit: input.contextEngineTokenBudget.autoCompactTokenLimit,
    target_token_limit: input.contextEngineTokenBudget.targetTokenLimit,
    effective_window_tokens: input.contextEngineTokenBudget.effectiveWindowTokens,
    thresholds: {
      proactive_ratio: config.thresholds.proactiveRatio,
      forced_ratio: config.thresholds.forcedRatio,
      hard_ratio: config.thresholds.hardRatio,
    },
    prompt_quality: {
      low_quality_threshold: config.promptQuality?.lowQualityThreshold ?? null,
      degrade_overall_threshold: config.promptQuality?.degradeOverallThreshold ?? null,
      degrade_low_quality_rate_threshold: config.promptQuality?.degradeLowQualityRateThreshold ?? null,
      degrade_min_entries: config.promptQuality?.degradeMinEntries ?? null,
      guard_enabled: config.promptQuality?.guardEnabled ?? null,
      guard_adaptive_enabled: config.promptQuality?.guardAdaptiveEnabled ?? null,
      guard_adaptive_mode_allowlist: config.promptQuality?.guardAdaptiveModeAllowlist ?? null,
      guard_promote_streak: config.promptQuality?.guardPromoteStreak ?? null,
      guard_severe_promote_streak: config.promptQuality?.guardSeverePromoteStreak ?? null,
      guard_release_streak: config.promptQuality?.guardReleaseStreak ?? null,
      guard_hold_turns: config.promptQuality?.guardHoldTurns ?? null,
      guard_max_floor_stage: config.promptQuality?.guardMaxFloorStage ?? null,
      guard_severe_overall_threshold: config.promptQuality?.guardSevereOverallThreshold ?? null,
      guard_severe_low_quality_rate_threshold: config.promptQuality?.guardSevereLowQualityRateThreshold ?? null,
    },
    prompt_quality_guard_state: {
      floor_stage: guardState.floorStage,
      degraded_streak: guardState.degradedStreak,
      severe_streak: guardState.severeStreak,
      healthy_streak: guardState.healthyStreak,
      hold_turns_remaining: guardState.holdTurnsRemaining,
      last_reason: guardState.lastReason,
      updated_at: guardState.updatedAt,
      pressure_utilization_threshold: guardState.pressureUtilizationThreshold,
      pressure_semantic_rate_threshold: guardState.pressureSemanticRateThreshold,
      pressure_auto_limit_rate_threshold: guardState.pressureAutoLimitRateThreshold,
      pressure_joint_rate_threshold: guardState.pressureJointRateThreshold,
      pressure_trend_utilization_delta: guardState.pressureTrendUtilizationDelta,
      pressure_trend_semantic_delta: guardState.pressureTrendSemanticDelta,
      pressure_trend_auto_limit_delta: guardState.pressureTrendAutoLimitDelta,
      pressure_trend_momentum: guardState.pressureTrendMomentum,
      outcome_required_transitions: guardState.outcomeRequiredTransitions,
      outcome_combined_evidence_score: guardState.outcomeCombinedEvidenceScore,
      outcome_high_evidence_turns: guardState.outcomeHighEvidenceTurns,
      outcome_high_evidence_harden_turns: guardState.outcomeHighEvidenceHardenTurns,
      outcome_drift_recent_auto_action_levels: guardState.outcomeDriftRecentAutoActionLevels,
      persistence_domain: input.promptQualityGuardStatePersistenceDomain,
    },
    prompt_quality_guard_runtime_assessment: {
      enabled: guardRuntime.enabled,
      phase: guardRuntime.phase,
      transition: guardRuntime.transition,
      degraded: guardRuntime.degraded,
      severe: guardRuntime.severe,
      reason: guardRuntime.reason,
      triggered: guardRuntime.triggered,
      floor_stage: guardRuntime.floorStage,
      proposed_floor_stage: guardRuntime.proposedFloorStage,
      promote_remaining: guardRuntime.promoteRemaining,
      severe_promote_remaining: guardRuntime.severePromoteRemaining,
      release_remaining: guardRuntime.releaseRemaining,
      hold_turns_remaining: guardRuntime.holdTurnsRemaining,
      observed_overall: guardRuntime.observedOverall,
      observed_low_quality_rate: guardRuntime.observedLowQualityRate,
    },
    prompt_quality_guard_adaptive_policy: serializePromptQualityGuardAdaptivePolicy(
      adaptivePolicy,
      promptWindow,
    ),
    recovery: {
      reactive_max_retries: config.recovery.reactiveMaxRetries,
      ptl_max_retries: config.recovery.ptlMaxRetries,
      circuit_breaker_failures: config.recovery.circuitBreakerFailures,
      reactive_on_prompt_too_long: config.reactiveOnPromptTooLong,
    },
    lineage: {
      ...config.lineage,
      persistence_domain: input.lineageDiffCachePersistenceDomain,
    },
    workspace_signals: config.workspaceSignals,
    dependency_graph: config.dependencyGraph,
    symbol_graph: config.symbolGraph,
    semantic_prefetch: config.semanticPrefetch,
    memory_orchestrator: serializeMemoryOrchestratorStatus({
      memoryPolicy,
      memoryDecayState,
      memoryDecayAutotuneStatePersistenceDomain: input.memoryDecayAutotuneStatePersistenceDomain,
      memoryStrategyState,
      memoryStrategyAutotuneStatePersistenceDomain: input.memoryStrategyAutotuneStatePersistenceDomain,
    }),
    graph_quality_signals: input.graphQualitySignals,
    prompt_quality_window: serializePromptQualityWindowStatus({
      promptWindow,
      promptDegradation,
      promptQualityWindowPersistenceDomain: input.promptQualityWindowPersistenceDomain,
    }),
  };
}

function serializePromptQualityGuardAdaptivePolicy(
  adaptivePolicy: PromptQualityGuardAdaptiveDecision,
  promptWindow: PromptQualityWindowSummary,
): Record<string, unknown> {
  return {
    enabled: adaptivePolicy.enabled,
    mode: adaptivePolicy.mode,
    reason: adaptivePolicy.reason,
    allowlist: adaptivePolicy.allowlist,
    mode_blocked: adaptivePolicy.modeBlocked,
    blocked_mode: adaptivePolicy.blockedMode,
    base_policy: {
      enabled: adaptivePolicy.basePolicy.enabled,
      promote_streak: adaptivePolicy.basePolicy.promoteStreak,
      severe_promote_streak: adaptivePolicy.basePolicy.severePromoteStreak,
      release_streak: adaptivePolicy.basePolicy.releaseStreak,
      hold_turns: adaptivePolicy.basePolicy.holdTurns,
      max_floor_stage: adaptivePolicy.basePolicy.maxFloorStage,
      severe_overall_threshold: adaptivePolicy.basePolicy.severeOverallThreshold,
      severe_low_quality_rate_threshold: adaptivePolicy.basePolicy.severeLowQualityRateThreshold,
    },
    effective_policy: {
      enabled: adaptivePolicy.effectivePolicy.enabled,
      promote_streak: adaptivePolicy.effectivePolicy.promoteStreak,
      severe_promote_streak: adaptivePolicy.effectivePolicy.severePromoteStreak,
      release_streak: adaptivePolicy.effectivePolicy.releaseStreak,
      hold_turns: adaptivePolicy.effectivePolicy.holdTurns,
      max_floor_stage: adaptivePolicy.effectivePolicy.maxFloorStage,
      severe_overall_threshold: adaptivePolicy.effectivePolicy.severeOverallThreshold,
      severe_low_quality_rate_threshold: adaptivePolicy.effectivePolicy.severeLowQualityRateThreshold,
    },
    adjustment: {
      promote_streak_delta: adaptivePolicy.adjustment.promoteStreakDelta,
      severe_promote_streak_delta: adaptivePolicy.adjustment.severePromoteStreakDelta,
      release_streak_delta: adaptivePolicy.adjustment.releaseStreakDelta,
      hold_turns_delta: adaptivePolicy.adjustment.holdTurnsDelta,
    },
    pressure_policy: {
      source: adaptivePolicy.pressurePolicy.source,
      updated: adaptivePolicy.pressurePolicy.updated,
      learn_alpha: adaptivePolicy.pressurePolicy.learnAlpha,
      utilization_threshold: adaptivePolicy.pressurePolicy.utilizationThreshold,
      semantic_rate_threshold: adaptivePolicy.pressurePolicy.semanticRateThreshold,
      auto_limit_rate_threshold: adaptivePolicy.pressurePolicy.autoLimitRateThreshold,
      joint_rate_threshold: adaptivePolicy.pressurePolicy.jointRateThreshold,
      trend_utilization_delta: adaptivePolicy.pressurePolicy.trendUtilizationDelta,
      trend_semantic_delta: adaptivePolicy.pressurePolicy.trendSemanticDelta,
      trend_auto_limit_delta: adaptivePolicy.pressurePolicy.trendAutoLimitDelta,
      trend_momentum: adaptivePolicy.pressurePolicy.trendMomentum,
      trend_flip_suppressed: adaptivePolicy.pressurePolicy.trendFlipSuppressed,
    },
    outcome_reliability: {
      required_transitions: adaptivePolicy.outcomeReliability.requiredTransitions,
      next_required_transitions: adaptivePolicy.outcomeReliability.nextRequiredTransitions,
      hard_budget_transitions: adaptivePolicy.outcomeReliability.hardBudgetTransitions,
      quality_first_transitions: adaptivePolicy.outcomeReliability.qualityFirstTransitions,
      hard_budget_evidence_score: adaptivePolicy.outcomeReliability.hardBudgetEvidenceScore,
      quality_first_evidence_score: adaptivePolicy.outcomeReliability.qualityFirstEvidenceScore,
      combined_evidence_score: adaptivePolicy.outcomeReliability.combinedEvidenceScore,
      hard_budget_reliable: adaptivePolicy.outcomeReliability.hardBudgetReliable,
      quality_first_reliable: adaptivePolicy.outcomeReliability.qualityFirstReliable,
    },
    outcome_drift_guard: {
      high_evidence_harden_bias: adaptivePolicy.outcomeDriftGuard.highEvidenceHardenBias,
      high_evidence_turn: adaptivePolicy.outcomeDriftGuard.highEvidenceTurn,
      high_evidence_turns: adaptivePolicy.outcomeDriftGuard.highEvidenceTurns,
      high_evidence_harden_turns: adaptivePolicy.outcomeDriftGuard.highEvidenceHardenTurns,
      high_evidence_harden_rate: adaptivePolicy.outcomeDriftGuard.highEvidenceHardenRate,
      threshold_harden_rate: adaptivePolicy.outcomeDriftGuard.thresholdHardenRate,
      min_high_evidence_turns: adaptivePolicy.outcomeDriftGuard.minHighEvidenceTurns,
      reason: adaptivePolicy.outcomeDriftGuard.reason,
      auto_action_level: adaptivePolicy.outcomeDriftGuard.autoActionLevel,
      recent_auto_action_levels: adaptivePolicy.outcomeDriftGuard.recentAutoActionLevels,
      window_summary: {
        window_size: adaptivePolicy.outcomeDriftGuard.windowSummary.windowSize,
        entries: adaptivePolicy.outcomeDriftGuard.windowSummary.entries,
        latest: adaptivePolicy.outcomeDriftGuard.windowSummary.latest,
        dominant: adaptivePolicy.outcomeDriftGuard.windowSummary.dominant,
        alert_level: adaptivePolicy.outcomeDriftGuard.windowSummary.alertLevel,
        transition_count: adaptivePolicy.outcomeDriftGuard.windowSummary.transitionCount,
        active_rate: adaptivePolicy.outcomeDriftGuard.windowSummary.activeRate,
        medium_or_hard_rate: adaptivePolicy.outcomeDriftGuard.windowSummary.mediumOrHardRate,
        hard_rate: adaptivePolicy.outcomeDriftGuard.windowSummary.hardRate,
        level_counts: adaptivePolicy.outcomeDriftGuard.windowSummary.levelCounts,
      },
      recommendation: adaptivePolicy.outcomeDriftGuard.recommendation,
    },
    window: {
      snapshot_semantic_compress_rate: promptWindow.compressionActivity.snapshotSemanticCompressRate,
      auto_limit_triggered_rate: promptWindow.compressionActivity.autoLimitTriggeredRate,
      average_utilization_ratio: promptWindow.tokenBudget.averageUtilizationRatio,
      short_snapshot_semantic_compress_rate: promptWindow.pressureTrends.short.snapshotSemanticCompressRate,
      medium_snapshot_semantic_compress_rate: promptWindow.pressureTrends.medium.snapshotSemanticCompressRate,
      short_auto_limit_triggered_rate: promptWindow.pressureTrends.short.autoLimitTriggeredRate,
      medium_auto_limit_triggered_rate: promptWindow.pressureTrends.medium.autoLimitTriggeredRate,
      short_average_utilization_ratio: promptWindow.pressureTrends.short.averageUtilizationRatio,
      medium_average_utilization_ratio: promptWindow.pressureTrends.medium.averageUtilizationRatio,
      hard_budget_strategy_rate: promptWindow.strategyActivity.hardBudgetRate,
      quality_first_strategy_rate: promptWindow.strategyActivity.qualityFirstRate,
      average_pre_send_overflow_ratio: promptWindow.signalAverages?.preSendOverflowRatio ?? null,
      average_pre_send_pressure_score: promptWindow.signalAverages?.preSendPressureScore ?? null,
      short_hard_budget_strategy_rate: promptWindow.strategyTrends.short.hardBudgetRate,
      medium_hard_budget_strategy_rate: promptWindow.strategyTrends.medium.hardBudgetRate,
      short_average_pre_send_overflow_ratio: promptWindow.strategyTrends.short.averageOverflowRatio,
      medium_average_pre_send_overflow_ratio: promptWindow.strategyTrends.medium.averageOverflowRatio,
      short_average_pre_send_pressure_score: promptWindow.strategyTrends.short.averagePressureScore,
      medium_average_pre_send_pressure_score: promptWindow.strategyTrends.medium.averagePressureScore,
      hard_budget_followup_overall_delta: promptWindow.strategyOutcomes.hardBudgetFollowupOverallDelta,
      quality_first_followup_overall_delta: promptWindow.strategyOutcomes.qualityFirstFollowupOverallDelta,
      hard_budget_recovery_rate: promptWindow.strategyOutcomes.hardBudgetRecoveryRate,
      quality_first_improved_rate: promptWindow.strategyOutcomes.qualityFirstImprovedRate,
      hard_budget_transition_count: promptWindow.strategyOutcomes.hardBudgetTransitions,
      quality_first_transition_count: promptWindow.strategyOutcomes.qualityFirstTransitions,
    },
  };
}

function serializeMemoryOrchestratorStatus(input: {
  memoryPolicy: MemoryOrchestratorPolicySnapshot;
  memoryDecayState: MemoryDecayAutotuneState;
  memoryDecayAutotuneStatePersistenceDomain: ContextStorageDomain;
  memoryStrategyState: MemoryStrategyAutotuneState;
  memoryStrategyAutotuneStatePersistenceDomain: ContextStorageDomain;
}): Record<string, unknown> {
  const policy = input.memoryPolicy;
  const decay = input.memoryDecayState;
  const strategy = input.memoryStrategyState;
  return {
    enabled: policy.enabled,
    version: policy.version,
    inject_budget_ratio: policy.injectBudgetRatio,
    inject_budget_min_tokens: policy.injectBudgetMinTokens,
    inject_budget_max_tokens: policy.injectBudgetMaxTokens,
    max_section_tokens: policy.maxSectionTokens,
    max_ga_memory_rows: policy.maxGaMemoryRows,
    max_team_experience_rows: policy.maxTeamExperienceRows,
    min_team_experience_score: policy.minTeamExperienceScore,
    decay_enabled: policy.decayEnabled,
    decay_max_rows_per_session: policy.decayMaxRowsPerSession,
    decay_min_rows_to_keep: policy.decayMinRowsToKeep,
    decay_max_age_hours_l1: policy.decayMaxAgeHoursL1,
    decay_max_age_hours_l2: policy.decayMaxAgeHoursL2,
    decay_max_age_hours_l3: policy.decayMaxAgeHoursL3,
    decay_max_age_hours_l4: policy.decayMaxAgeHoursL4,
    decay_unverified_max_age_hours: policy.decayUnverifiedMaxAgeHours,
    decay_min_confidence_verified: policy.decayMinConfidenceVerified,
    decay_min_confidence_unverified: policy.decayMinConfidenceUnverified,
    autotune: {
      adaptive_updates: decay.adaptiveUpdates,
      adaptive_learn_alpha: decay.adaptiveLearnAlpha,
      drop_ratio_ema: decay.dropRatioEma,
      capacity_trim_ratio_ema: decay.capacityTrimRatioEma,
      low_confidence_ratio_ema: decay.lowConfidenceRatioEma,
      age_drop_ratio_ema: decay.ageDropRatioEma,
      quality_low_rate_ema: decay.qualityLowRateEma,
      quality_pressure_ema: decay.qualityPressureEma,
      hard_budget_followup_delta_ema: decay.hardBudgetFollowupDeltaEma,
      quality_first_followup_delta_ema: decay.qualityFirstFollowupDeltaEma,
      last_reason: decay.lastReason,
      updated_at: decay.updatedAt,
      persistence_domain: input.memoryDecayAutotuneStatePersistenceDomain,
    },
    strategy_autotune: {
      schema_version: strategy.schemaVersion,
      profile: strategy.profile,
      inject_budget_ratio: strategy.injectBudgetRatio,
      max_section_tokens: strategy.maxSectionTokens,
      max_ga_memory_rows: strategy.maxGaMemoryRows,
      max_team_experience_rows: strategy.maxTeamExperienceRows,
      min_team_experience_score: strategy.minTeamExperienceScore,
      adaptive_updates: strategy.adaptiveUpdates,
      adaptive_learn_alpha: strategy.adaptiveLearnAlpha,
      quality_low_rate_ema: strategy.qualityLowRateEma,
      quality_pressure_ema: strategy.qualityPressureEma,
      average_utilization_ratio_ema: strategy.averageUtilizationRatioEma,
      auto_limit_triggered_rate_ema: strategy.autoLimitTriggeredRateEma,
      snapshot_semantic_compress_rate_ema: strategy.snapshotSemanticCompressRateEma,
      hard_budget_rate_ema: strategy.hardBudgetRateEma,
      quality_first_improved_rate_ema: strategy.qualityFirstImprovedRateEma,
      hard_budget_followup_delta_ema: strategy.hardBudgetFollowupDeltaEma,
      quality_first_followup_delta_ema: strategy.qualityFirstFollowupDeltaEma,
      last_action_direction: strategy.lastActionDirection,
      cooldown_turns_remaining: strategy.cooldownTurnsRemaining,
      tighten_signal_streak: strategy.tightenSignalStreak,
      relax_signal_streak: strategy.relaxSignalStreak,
      adaptive_action_scale: strategy.adaptiveActionScale,
      pending_evaluation_direction: strategy.pendingEvaluationDirection,
      pending_evaluation_warmup_turns: strategy.pendingEvaluationWarmupTurns,
      pending_baseline_budget_ratio: strategy.pendingBaselineInjectBudgetRatio,
      pending_baseline_section_tokens: strategy.pendingBaselineMaxSectionTokens,
      pending_baseline_ga_rows: strategy.pendingBaselineMaxGaMemoryRows,
      pending_baseline_team_rows: strategy.pendingBaselineMaxTeamExperienceRows,
      pending_baseline_team_score: strategy.pendingBaselineMinTeamExperienceScore,
      outcome_confidence_ema: strategy.outcomeConfidenceEma,
      last_outcome_gain: strategy.lastOutcomeGain,
      outcome_rollback_count: strategy.outcomeRollbackCount,
      outcome_negative_streak: strategy.outcomeNegativeStreak,
      last_reason: strategy.lastReason,
      updated_at: strategy.updatedAt,
      persistence_domain: input.memoryStrategyAutotuneStatePersistenceDomain,
    },
  };
}

function serializePromptQualityWindowStatus(input: {
  promptWindow: PromptQualityWindowSummary;
  promptDegradation: PromptQualityWindowDegradation;
  promptQualityWindowPersistenceDomain: ContextStorageDomain;
}): Record<string, unknown> {
  const summary = input.promptWindow;
  const degradation = input.promptDegradation;
  return {
    path: summary.path,
    configured_size: summary.configuredSize,
    entries: summary.entries,
    from_ts: summary.fromTs,
    to_ts: summary.toTs,
    persistence_domain: input.promptQualityWindowPersistenceDomain,
    average_scores: summary.averageScores == null
      ? null
      : {
        coverage: summary.averageScores.coverage,
        recency: summary.averageScores.recency,
        size: summary.averageScores.size,
        overall: summary.averageScores.overall,
      },
    latest_scores: summary.latestScores == null
      ? null
      : {
        coverage: summary.latestScores.coverage,
        recency: summary.latestScores.recency,
        size: summary.latestScores.size,
        overall: summary.latestScores.overall,
      },
    low_quality: {
      count: summary.lowQualityCount,
      rate: summary.lowQualityRate,
      threshold_overall: summary.lowQualityThreshold,
    },
    stage_counts: summary.stageCounts,
    signal_averages: summary.signalAverages == null
      ? null
      : {
        recent_rows: summary.signalAverages.recentRows,
        snapshot_sections: summary.signalAverages.snapshotSections,
        recent_trim_rows: summary.signalAverages.recentTrimRows,
        snapshot_trim_sections: summary.signalAverages.snapshotTrimSections,
        snapshot_semantic_compress_sections: summary.signalAverages.snapshotSemanticCompressSections,
        head_trim_retries: summary.signalAverages.headTrimRetries,
        pre_send_overflow_ratio: summary.signalAverages.preSendOverflowRatio,
        pre_send_pressure_score: summary.signalAverages.preSendPressureScore,
      },
    compression_activity: {
      recent_trim_rate: summary.compressionActivity.recentTrimRate,
      snapshot_trim_rate: summary.compressionActivity.snapshotTrimRate,
      snapshot_semantic_compress_rate: summary.compressionActivity.snapshotSemanticCompressRate,
      head_trim_rate: summary.compressionActivity.headTrimRate,
      auto_limit_triggered_rate: summary.compressionActivity.autoLimitTriggeredRate,
      downshift_guard_triggered_rate: summary.compressionActivity.downshiftGuardTriggeredRate,
    },
    strategy_activity: {
      quality_first_rate: summary.strategyActivity.qualityFirstRate,
      hard_budget_rate: summary.strategyActivity.hardBudgetRate,
    },
    token_budget: {
      average_estimated_tokens: summary.tokenBudget.averageEstimatedTokens,
      average_target_token_limit: summary.tokenBudget.averageTargetTokenLimit,
      average_utilization_ratio: summary.tokenBudget.averageUtilizationRatio,
    },
    strategy_trends: {
      short: {
        window_size: summary.strategyTrends.short.windowSize,
        entries: summary.strategyTrends.short.entries,
        hard_budget_rate: summary.strategyTrends.short.hardBudgetRate,
        average_overflow_ratio: summary.strategyTrends.short.averageOverflowRatio,
        average_pressure_score: summary.strategyTrends.short.averagePressureScore,
      },
      medium: {
        window_size: summary.strategyTrends.medium.windowSize,
        entries: summary.strategyTrends.medium.entries,
        hard_budget_rate: summary.strategyTrends.medium.hardBudgetRate,
        average_overflow_ratio: summary.strategyTrends.medium.averageOverflowRatio,
        average_pressure_score: summary.strategyTrends.medium.averagePressureScore,
      },
      delta: {
        hard_budget_rate: summary.strategyTrends.delta.hardBudgetRate,
        average_overflow_ratio: summary.strategyTrends.delta.averageOverflowRatio,
        average_pressure_score: summary.strategyTrends.delta.averagePressureScore,
      },
    },
    strategy_outcomes: {
      hard_budget_followup_overall_delta: summary.strategyOutcomes.hardBudgetFollowupOverallDelta,
      quality_first_followup_overall_delta: summary.strategyOutcomes.qualityFirstFollowupOverallDelta,
      hard_budget_recovery_rate: summary.strategyOutcomes.hardBudgetRecoveryRate,
      quality_first_improved_rate: summary.strategyOutcomes.qualityFirstImprovedRate,
      hard_budget_transition_count: summary.strategyOutcomes.hardBudgetTransitions,
      quality_first_transition_count: summary.strategyOutcomes.qualityFirstTransitions,
    },
    pressure_trends: {
      short: {
        window_size: summary.pressureTrends.short.windowSize,
        entries: summary.pressureTrends.short.entries,
        snapshot_semantic_compress_rate: summary.pressureTrends.short.snapshotSemanticCompressRate,
        auto_limit_triggered_rate: summary.pressureTrends.short.autoLimitTriggeredRate,
        average_utilization_ratio: summary.pressureTrends.short.averageUtilizationRatio,
      },
      medium: {
        window_size: summary.pressureTrends.medium.windowSize,
        entries: summary.pressureTrends.medium.entries,
        snapshot_semantic_compress_rate: summary.pressureTrends.medium.snapshotSemanticCompressRate,
        auto_limit_triggered_rate: summary.pressureTrends.medium.autoLimitTriggeredRate,
        average_utilization_ratio: summary.pressureTrends.medium.averageUtilizationRatio,
      },
      delta: {
        snapshot_semantic_compress_rate: summary.pressureTrends.delta.snapshotSemanticCompressRate,
        auto_limit_triggered_rate: summary.pressureTrends.delta.autoLimitTriggeredRate,
        average_utilization_ratio: summary.pressureTrends.delta.averageUtilizationRatio,
      },
    },
    degradation: {
      degraded: degradation.degraded,
      reason: degradation.reason,
      threshold_overall: degradation.thresholdOverall,
      threshold_low_quality_rate: degradation.thresholdLowQualityRate,
      min_entries: degradation.minEntries,
      observed_entries: degradation.observedEntries,
      observed_overall: degradation.observedOverall,
      observed_low_quality_rate: degradation.observedLowQualityRate,
    },
  };
}
