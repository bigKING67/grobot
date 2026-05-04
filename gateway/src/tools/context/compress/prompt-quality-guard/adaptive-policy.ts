import type {
  PromptQualityGuardAdaptiveDecision,
  PromptQualityGuardAdaptiveInput,
  PromptQualityGuardAdaptiveMode,
  PromptQualityGuardAdaptiveMutableMode,
  PromptQualityGuardPolicy,
} from "./contract";
import { deriveAdaptivePressurePolicy } from "./adaptive-pressure";
import {
  DEFAULT_OUTCOME_REQUIRED_TRANSITIONS,
  OUTCOME_REQUIRED_TRANSITIONS_EWMA_ALPHA_BASE,
  advancePromptQualityGuardOutcomeDriftGuard,
  clamp01,
  clampEwmaAlpha,
  clampRequiredTransitions,
  deriveOutcomeRequiredTransitionsEwma,
  roundThreshold,
  stageWeight,
} from "./core";
import { normalizeAdaptiveModeAllowlist } from "./core";
import { normalizePromptQualityGuardPolicy, normalizePromptQualityGuardState } from "./normalize";

export function derivePromptQualityGuardAdaptivePolicy(
  input: PromptQualityGuardAdaptiveInput,
): PromptQualityGuardAdaptiveDecision {
  const basePolicy = normalizePromptQualityGuardPolicy(input.basePolicy);
  const allowlist = normalizeAdaptiveModeAllowlist(input.adaptiveModeAllowlist);
  const state = normalizePromptQualityGuardState(input.currentState);
  const window = {
    degraded: input.window.degraded === true,
    reason: input.window.reason?.trim() || "unknown",
    lowQualityRate: typeof input.window.lowQualityRate === "number" ? input.window.lowQualityRate : null,
    averageOverall: typeof input.window.averageOverall === "number" ? input.window.averageOverall : null,
    observedOverall: typeof input.window.observedOverall === "number" ? input.window.observedOverall : null,
    observedLowQualityRate: typeof input.window.observedLowQualityRate === "number"
      ? input.window.observedLowQualityRate
      : null,
    snapshotSemanticCompressRate:
      typeof input.window.snapshotSemanticCompressRate === "number"
        ? input.window.snapshotSemanticCompressRate
        : null,
    autoLimitTriggeredRate:
      typeof input.window.autoLimitTriggeredRate === "number"
        ? input.window.autoLimitTriggeredRate
        : null,
    averageUtilizationRatio:
      typeof input.window.averageUtilizationRatio === "number"
        ? input.window.averageUtilizationRatio
        : null,
    shortSnapshotSemanticCompressRate:
      typeof input.window.shortSnapshotSemanticCompressRate === "number"
        ? input.window.shortSnapshotSemanticCompressRate
        : null,
    mediumSnapshotSemanticCompressRate:
      typeof input.window.mediumSnapshotSemanticCompressRate === "number"
        ? input.window.mediumSnapshotSemanticCompressRate
        : null,
    shortAutoLimitTriggeredRate:
      typeof input.window.shortAutoLimitTriggeredRate === "number"
        ? input.window.shortAutoLimitTriggeredRate
        : null,
    mediumAutoLimitTriggeredRate:
      typeof input.window.mediumAutoLimitTriggeredRate === "number"
        ? input.window.mediumAutoLimitTriggeredRate
        : null,
    shortAverageUtilizationRatio:
      typeof input.window.shortAverageUtilizationRatio === "number"
        ? input.window.shortAverageUtilizationRatio
        : null,
    mediumAverageUtilizationRatio:
      typeof input.window.mediumAverageUtilizationRatio === "number"
        ? input.window.mediumAverageUtilizationRatio
        : null,
    hardBudgetStrategyRate:
      typeof input.window.hardBudgetStrategyRate === "number"
        ? input.window.hardBudgetStrategyRate
        : null,
    qualityFirstStrategyRate:
      typeof input.window.qualityFirstStrategyRate === "number"
        ? input.window.qualityFirstStrategyRate
        : null,
    averagePreSendOverflowRatio:
      typeof input.window.averagePreSendOverflowRatio === "number"
        ? input.window.averagePreSendOverflowRatio
        : null,
    averagePreSendPressureScore:
      typeof input.window.averagePreSendPressureScore === "number"
        ? input.window.averagePreSendPressureScore
        : null,
    shortHardBudgetStrategyRate:
      typeof input.window.shortHardBudgetStrategyRate === "number"
        ? input.window.shortHardBudgetStrategyRate
        : null,
    mediumHardBudgetStrategyRate:
      typeof input.window.mediumHardBudgetStrategyRate === "number"
        ? input.window.mediumHardBudgetStrategyRate
        : null,
    shortAveragePreSendOverflowRatio:
      typeof input.window.shortAveragePreSendOverflowRatio === "number"
        ? input.window.shortAveragePreSendOverflowRatio
        : null,
    mediumAveragePreSendOverflowRatio:
      typeof input.window.mediumAveragePreSendOverflowRatio === "number"
        ? input.window.mediumAveragePreSendOverflowRatio
        : null,
    shortAveragePreSendPressureScore:
      typeof input.window.shortAveragePreSendPressureScore === "number"
        ? input.window.shortAveragePreSendPressureScore
        : null,
    mediumAveragePreSendPressureScore:
      typeof input.window.mediumAveragePreSendPressureScore === "number"
        ? input.window.mediumAveragePreSendPressureScore
        : null,
    hardBudgetFollowupOverallDelta:
      typeof input.window.hardBudgetFollowupOverallDelta === "number"
        ? input.window.hardBudgetFollowupOverallDelta
        : null,
    qualityFirstFollowupOverallDelta:
      typeof input.window.qualityFirstFollowupOverallDelta === "number"
        ? input.window.qualityFirstFollowupOverallDelta
        : null,
    hardBudgetRecoveryRate:
      typeof input.window.hardBudgetRecoveryRate === "number"
        ? input.window.hardBudgetRecoveryRate
        : null,
    qualityFirstImprovedRate:
      typeof input.window.qualityFirstImprovedRate === "number"
        ? input.window.qualityFirstImprovedRate
        : null,
    hardBudgetTransitionCount:
      typeof input.window.hardBudgetTransitionCount === "number"
      && Number.isFinite(input.window.hardBudgetTransitionCount)
        ? Math.max(0, Math.floor(input.window.hardBudgetTransitionCount))
        : null,
    qualityFirstTransitionCount:
      typeof input.window.qualityFirstTransitionCount === "number"
      && Number.isFinite(input.window.qualityFirstTransitionCount)
        ? Math.max(0, Math.floor(input.window.qualityFirstTransitionCount))
        : null,
  };
  if (!basePolicy.enabled || input.adaptiveEnabled !== true) {
    const pressurePolicy = deriveAdaptivePressurePolicy({
      state,
      window,
      guardTriggered: stageWeight(state.floorStage) > stageWeight("normal"),
    });
    const hardBudgetTransitions = window.hardBudgetTransitionCount ?? 0;
    const qualityFirstTransitions = window.qualityFirstTransitionCount ?? 0;
    const requiredTransitions = clampRequiredTransitions(
      state.outcomeRequiredTransitions,
      DEFAULT_OUTCOME_REQUIRED_TRANSITIONS,
    );
    const hardBudgetReliable = hardBudgetTransitions >= requiredTransitions;
    const qualityFirstReliable = qualityFirstTransitions >= requiredTransitions;
    const outcomeDrift = advancePromptQualityGuardOutcomeDriftGuard({
      currentState: state,
      mode: "disabled",
      combinedEvidenceScore: roundThreshold(
        clamp01((hardBudgetTransitions + qualityFirstTransitions) / (requiredTransitions * 2)),
      ),
      hardBudgetReliable,
      qualityFirstReliable,
    });
    return {
      enabled: false,
      mode: "disabled",
      reason: basePolicy.enabled ? "adaptive_disabled" : "guard_disabled",
      allowlist,
      modeBlocked: false,
      blockedMode: null,
      basePolicy,
      effectivePolicy: basePolicy,
      adjustment: {
        promoteStreakDelta: 0,
        severePromoteStreakDelta: 0,
        releaseStreakDelta: 0,
        holdTurnsDelta: 0,
      },
      pressurePolicy,
      outcomeReliability: {
        requiredTransitions,
        nextRequiredTransitions: requiredTransitions,
        hardBudgetTransitions,
        qualityFirstTransitions,
        hardBudgetEvidenceScore: roundThreshold(
          clamp01(hardBudgetTransitions / requiredTransitions),
        ),
        qualityFirstEvidenceScore: roundThreshold(
          clamp01(qualityFirstTransitions / requiredTransitions),
        ),
        combinedEvidenceScore: roundThreshold(
          clamp01((hardBudgetTransitions + qualityFirstTransitions) / (requiredTransitions * 2)),
        ),
        hardBudgetReliable,
        qualityFirstReliable,
      },
      outcomeDriftGuard: outcomeDrift.driftGuard,
    };
  }

  const severePressure =
    (typeof window.observedOverall === "number" && window.observedOverall <= basePolicy.severeOverallThreshold + 0.03)
    || (
      typeof window.observedLowQualityRate === "number"
      && window.observedLowQualityRate >= Math.max(0, basePolicy.severeLowQualityRateThreshold - 0.05)
    );
  const healthyWindow =
    window.degraded === false
    && typeof window.lowQualityRate === "number"
    && typeof window.averageOverall === "number"
    && window.lowQualityRate <= 0.18
    && window.averageOverall >= 0.84;
  const guardTriggered = stageWeight(state.floorStage) > stageWeight("normal");
  const pressurePolicy = deriveAdaptivePressurePolicy({
    state,
    window,
    guardTriggered,
  });
  const compressionPressure =
    typeof window.averageUtilizationRatio === "number"
    && (
      (
        window.averageUtilizationRatio >= pressurePolicy.utilizationThreshold
        && (
          (typeof window.snapshotSemanticCompressRate === "number"
            && window.snapshotSemanticCompressRate >= pressurePolicy.semanticRateThreshold)
          || (
            typeof window.autoLimitTriggeredRate === "number"
            && window.autoLimitTriggeredRate >= pressurePolicy.autoLimitRateThreshold
          )
        )
      )
      || (
        typeof window.snapshotSemanticCompressRate === "number"
        && typeof window.autoLimitTriggeredRate === "number"
        && window.snapshotSemanticCompressRate >= pressurePolicy.jointRateThreshold
        && window.autoLimitTriggeredRate >= pressurePolicy.jointRateThreshold
      )
    );
  const hardBudgetTrendDelta =
    typeof window.shortHardBudgetStrategyRate === "number"
    && typeof window.mediumHardBudgetStrategyRate === "number"
      ? window.shortHardBudgetStrategyRate - window.mediumHardBudgetStrategyRate
      : null;
  const preSendPressureTrendDelta =
    typeof window.shortAveragePreSendPressureScore === "number"
    && typeof window.mediumAveragePreSendPressureScore === "number"
      ? window.shortAveragePreSendPressureScore - window.mediumAveragePreSendPressureScore
      : null;
  const preSendOverflowTrendDelta =
    typeof window.shortAveragePreSendOverflowRatio === "number"
    && typeof window.mediumAveragePreSendOverflowRatio === "number"
      ? window.shortAveragePreSendOverflowRatio - window.mediumAveragePreSendOverflowRatio
      : null;
  const baselineRequiredTransitions = clampRequiredTransitions(
    state.outcomeRequiredTransitions,
    DEFAULT_OUTCOME_REQUIRED_TRANSITIONS,
  );
  let requiredTransitions = baselineRequiredTransitions;
  if (window.degraded) {
    requiredTransitions += 1;
  }
  if (typeof hardBudgetTrendDelta === "number" && Math.abs(hardBudgetTrendDelta) >= 0.10) {
    requiredTransitions += 1;
  }
  if (typeof preSendPressureTrendDelta === "number" && Math.abs(preSendPressureTrendDelta) >= 0.08) {
    requiredTransitions += 1;
  }
  if (typeof preSendOverflowTrendDelta === "number" && Math.abs(preSendOverflowTrendDelta) >= 0.05) {
    requiredTransitions += 1;
  }
  requiredTransitions = clampRequiredTransitions(requiredTransitions, baselineRequiredTransitions);
  const hardBudgetTransitions = window.hardBudgetTransitionCount ?? 0;
  const qualityFirstTransitions = window.qualityFirstTransitionCount ?? 0;
  const hardBudgetEvidenceScore = roundThreshold(
    clamp01(hardBudgetTransitions / requiredTransitions),
  );
  const qualityFirstEvidenceScore = roundThreshold(
    clamp01(qualityFirstTransitions / requiredTransitions),
  );
  const combinedEvidenceScore = roundThreshold(
    clamp01((hardBudgetTransitions + qualityFirstTransitions) / (requiredTransitions * 2)),
  );
  const strategyPressureBase =
    (
      (typeof window.hardBudgetStrategyRate === "number" && window.hardBudgetStrategyRate >= 0.48)
      || (typeof hardBudgetTrendDelta === "number" && hardBudgetTrendDelta >= 0.10)
    )
    && (
      (typeof window.averagePreSendPressureScore === "number" && window.averagePreSendPressureScore >= 0.58)
      || (typeof window.averagePreSendOverflowRatio === "number" && window.averagePreSendOverflowRatio >= 0.14)
      || (typeof preSendPressureTrendDelta === "number" && preSendPressureTrendDelta >= 0.10)
      || (typeof preSendOverflowTrendDelta === "number" && preSendOverflowTrendDelta >= 0.06)
    );
  const hardBudgetOutcomeStrong =
    (
      typeof window.hardBudgetFollowupOverallDelta === "number"
      && window.hardBudgetFollowupOverallDelta >= 0.03
      && typeof window.hardBudgetRecoveryRate === "number"
      && window.hardBudgetRecoveryRate >= 0.55
    )
    || (
      typeof window.hardBudgetRecoveryRate === "number"
      && window.hardBudgetRecoveryRate >= 0.70
    );
  const hardBudgetOutcomeReliable = hardBudgetEvidenceScore >= 1;
  const hardBudgetOutcomeWeak =
    (typeof window.hardBudgetFollowupOverallDelta === "number"
      && window.hardBudgetFollowupOverallDelta <= -0.02)
    || (
      typeof window.hardBudgetRecoveryRate === "number"
      && window.hardBudgetRecoveryRate <= 0.40
    );
  const qualityFirstOutcomeStrong =
    (typeof window.qualityFirstFollowupOverallDelta === "number"
      && window.qualityFirstFollowupOverallDelta >= 0.01)
    || (
      typeof window.qualityFirstImprovedRate === "number"
      && window.qualityFirstImprovedRate >= 0.58
    );
  const qualityFirstOutcomeReliable = qualityFirstEvidenceScore >= 1;
  const qualityFirstOutcomeWeak =
    (typeof window.qualityFirstFollowupOverallDelta === "number"
      && window.qualityFirstFollowupOverallDelta <= -0.03)
    && (
      typeof window.qualityFirstImprovedRate === "number"
      && window.qualityFirstImprovedRate < 0.45
    );
  const strategyPressure =
    strategyPressureBase
    && (
      (hardBudgetOutcomeReliable && hardBudgetOutcomeWeak)
      || (
        !hardBudgetOutcomeReliable
        || !hardBudgetOutcomeStrong
      )
    );
  const strategyRecovered =
    (typeof window.qualityFirstStrategyRate !== "number" || window.qualityFirstStrategyRate >= 0.58)
    && (typeof window.hardBudgetStrategyRate !== "number" || window.hardBudgetStrategyRate <= 0.26)
    && (typeof window.averagePreSendPressureScore !== "number" || window.averagePreSendPressureScore <= 0.48)
    && (typeof window.averagePreSendOverflowRatio !== "number" || window.averagePreSendOverflowRatio <= 0.10)
    && (typeof hardBudgetTrendDelta !== "number" || hardBudgetTrendDelta <= 0.03)
    && (!qualityFirstOutcomeReliable || !qualityFirstOutcomeWeak)
    && (
      (hardBudgetOutcomeReliable && hardBudgetOutcomeStrong)
      || (qualityFirstOutcomeReliable && qualityFirstOutcomeStrong)
    );
  let nextRequiredTransitionsTarget = baselineRequiredTransitions;
  const baselineCombinedEvidenceScore = clamp01(state.outcomeCombinedEvidenceScore);
  const combinedEvidenceScoreDelta = roundThreshold(
    combinedEvidenceScore - baselineCombinedEvidenceScore,
  );
  if (window.degraded || strategyPressure || compressionPressure) {
    nextRequiredTransitionsTarget += 1;
  } else if (strategyRecovered && combinedEvidenceScore >= 0.85) {
    nextRequiredTransitionsTarget -= 1;
  } else if (!hardBudgetOutcomeReliable && !qualityFirstOutcomeReliable) {
    nextRequiredTransitionsTarget += 1;
  }
  if (combinedEvidenceScoreDelta <= -0.18) {
    nextRequiredTransitionsTarget += 1;
  } else if (combinedEvidenceScoreDelta >= 0.20 && strategyRecovered) {
    nextRequiredTransitionsTarget -= 1;
  }
  nextRequiredTransitionsTarget = clampRequiredTransitions(
    nextRequiredTransitionsTarget,
    baselineRequiredTransitions,
  );
  const trendVolatility = clamp01(
    (Math.abs(hardBudgetTrendDelta ?? 0)
      + Math.abs(preSendPressureTrendDelta ?? 0)
      + Math.abs(preSendOverflowTrendDelta ?? 0)) / 0.45,
  );
  const requiredTransitionsAlpha = clampEwmaAlpha(
    OUTCOME_REQUIRED_TRANSITIONS_EWMA_ALPHA_BASE
    + trendVolatility * 0.24
    + (window.degraded ? 0.08 : 0)
    + (strategyPressure ? 0.05 : 0),
  );
  const nextRequiredTransitions = deriveOutcomeRequiredTransitionsEwma({
    baseline: baselineRequiredTransitions,
    target: nextRequiredTransitionsTarget,
    alpha: requiredTransitionsAlpha,
  });

  let mode: PromptQualityGuardAdaptiveMode = "stable";
  let reason = "window_stable";
  const effectivePolicy: PromptQualityGuardPolicy = { ...basePolicy };
  const applyHardenPolicy = (): void => {
    effectivePolicy.promoteStreak = Math.max(1, basePolicy.promoteStreak - 1);
    effectivePolicy.severePromoteStreak = Math.max(1, basePolicy.severePromoteStreak - 1);
    effectivePolicy.releaseStreak = Math.min(64, basePolicy.releaseStreak + 1);
    effectivePolicy.holdTurns = Math.min(64, basePolicy.holdTurns + 1);
  };
  const applyRelaxPolicy = (): void => {
    effectivePolicy.promoteStreak = Math.min(32, basePolicy.promoteStreak + 1);
    effectivePolicy.severePromoteStreak = Math.min(32, basePolicy.severePromoteStreak + 1);
    effectivePolicy.releaseStreak = Math.max(1, basePolicy.releaseStreak - 1);
    effectivePolicy.holdTurns = Math.max(0, basePolicy.holdTurns - 1);
  };
  const applyStablePolicy = (): void => {
    effectivePolicy.promoteStreak = basePolicy.promoteStreak;
    effectivePolicy.severePromoteStreak = basePolicy.severePromoteStreak;
    effectivePolicy.releaseStreak = basePolicy.releaseStreak;
    effectivePolicy.holdTurns = basePolicy.holdTurns;
  };

  if (window.degraded && severePressure) {
    mode = "harden";
    reason = "severe_window_pressure";
    applyHardenPolicy();
  } else if (compressionPressure || strategyPressure) {
    mode = "harden";
    reason = strategyPressure ? "strategy_window_pressure" : "compression_window_pressure";
    applyHardenPolicy();
  } else if (healthyWindow && guardTriggered && strategyRecovered) {
    mode = "relax";
    reason = "window_recovered";
    applyRelaxPolicy();
  }

  let modeBlocked = false;
  let blockedMode: PromptQualityGuardAdaptiveMutableMode | null = null;
  if ((mode === "harden" || mode === "relax") && !allowlist.includes(mode)) {
    modeBlocked = true;
    blockedMode = mode;
    mode = "stable";
    reason = "mode_blocked_by_allowlist";
    applyStablePolicy();
  }

  let outcomeDrift = advancePromptQualityGuardOutcomeDriftGuard({
    currentState: state,
    mode,
    combinedEvidenceScore,
    hardBudgetReliable: hardBudgetOutcomeReliable,
    qualityFirstReliable: qualityFirstOutcomeReliable,
  });
  const driftActionLevel = outcomeDrift.driftGuard.autoActionLevel;
  const driftAutoCorrectionAllowed =
    mode === "harden"
    && outcomeDrift.driftGuard.highEvidenceHardenBias
    && !window.degraded
    && (
      driftActionLevel === "hard"
      || driftActionLevel === "medium"
      || (driftActionLevel === "soft" && strategyRecovered)
    );
  if (driftAutoCorrectionAllowed) {
    const forceRelax = driftActionLevel === "hard" || driftActionLevel === "medium";
    if (allowlist.includes("relax") && (forceRelax || strategyRecovered)) {
      mode = "relax";
      reason = `drift_guard_auto_${driftActionLevel}_relax`;
      applyRelaxPolicy();
    } else {
      mode = "stable";
      reason = `drift_guard_auto_${driftActionLevel}_stable`;
      applyStablePolicy();
    }
    outcomeDrift = advancePromptQualityGuardOutcomeDriftGuard({
      currentState: state,
      mode,
      combinedEvidenceScore,
      hardBudgetReliable: hardBudgetOutcomeReliable,
      qualityFirstReliable: qualityFirstOutcomeReliable,
    });
  }

  return {
    enabled: true,
    mode,
    reason,
    allowlist,
    modeBlocked,
    blockedMode,
    basePolicy,
    effectivePolicy: normalizePromptQualityGuardPolicy(effectivePolicy),
    adjustment: {
      promoteStreakDelta: effectivePolicy.promoteStreak - basePolicy.promoteStreak,
      severePromoteStreakDelta: effectivePolicy.severePromoteStreak - basePolicy.severePromoteStreak,
      releaseStreakDelta: effectivePolicy.releaseStreak - basePolicy.releaseStreak,
      holdTurnsDelta: effectivePolicy.holdTurns - basePolicy.holdTurns,
    },
    pressurePolicy,
    outcomeReliability: {
      requiredTransitions,
      nextRequiredTransitions,
      hardBudgetTransitions,
      qualityFirstTransitions,
      hardBudgetEvidenceScore,
      qualityFirstEvidenceScore,
      combinedEvidenceScore,
      hardBudgetReliable: hardBudgetOutcomeReliable,
      qualityFirstReliable: qualityFirstOutcomeReliable,
    },
    outcomeDriftGuard: outcomeDrift.driftGuard,
  };
}
