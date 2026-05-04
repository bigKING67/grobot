import type { MemoryOrchestratorPolicySnapshot } from "../orchestrator";
import {
  clampRatio,
  clampSigned,
  clampToFloatRange,
  clampToIntRange,
} from "./clamp";
import type {
  MemoryStrategyAutotuneActionDirection,
  MemoryStrategyAutotuneProfile,
  MemoryStrategyAutotuneQualitySnapshot,
  MemoryStrategyAutotuneState,
  MemoryStrategyAutotuneUpdateResult,
} from "./contract";
import { normalizeMemoryStrategyAutotuneState } from "./normalize";
import {
  normalizeProfile,
  resolveProfileThresholdOffset,
  resolveStrategyRanges,
} from "./ranges";
import { deriveOutcomeEvidenceStrength } from "./signal";
import { mixEma, stateEquals, stepToward } from "./utils";

export function deriveMemoryStrategyAutotuneState(input: {
  basePolicy: MemoryOrchestratorPolicySnapshot;
  currentState: MemoryStrategyAutotuneState;
  quality?: MemoryStrategyAutotuneQualitySnapshot;
  profile?: MemoryStrategyAutotuneProfile;
  nowIso?: string;
}): MemoryStrategyAutotuneUpdateResult {
  const current = normalizeMemoryStrategyAutotuneState(input.currentState, input.basePolicy);
  const next = {
    ...current,
  };
  next.profile = normalizeProfile(input.profile ?? current.profile);
  const alpha = current.adaptiveLearnAlpha;
  const ranges = resolveStrategyRanges(input.basePolicy);

  const qualityLowRate = clampRatio(input.quality?.lowQualityRate, 0);
  const qualityPressure = clampRatio(input.quality?.averagePreSendPressureScore, 0);
  const averageUtilizationRatio = clampRatio(input.quality?.averageUtilizationRatio, 0);
  const autoLimitTriggeredRate = clampRatio(input.quality?.autoLimitTriggeredRate, 0);
  const snapshotSemanticCompressRate = clampRatio(input.quality?.snapshotSemanticCompressRate, 0);
  const shortAverageUtilizationRatio = clampRatio(
    input.quality?.shortAverageUtilizationRatio,
    averageUtilizationRatio,
  );
  const mediumAverageUtilizationRatio = clampRatio(
    input.quality?.mediumAverageUtilizationRatio,
    averageUtilizationRatio,
  );
  const shortAutoLimitTriggeredRate = clampRatio(
    input.quality?.shortAutoLimitTriggeredRate,
    autoLimitTriggeredRate,
  );
  const mediumAutoLimitTriggeredRate = clampRatio(
    input.quality?.mediumAutoLimitTriggeredRate,
    autoLimitTriggeredRate,
  );
  const shortSnapshotSemanticCompressRate = clampRatio(
    input.quality?.shortSnapshotSemanticCompressRate,
    snapshotSemanticCompressRate,
  );
  const mediumSnapshotSemanticCompressRate = clampRatio(
    input.quality?.mediumSnapshotSemanticCompressRate,
    snapshotSemanticCompressRate,
  );
  const deltaAverageUtilizationRatio = clampSigned(
    input.quality?.deltaAverageUtilizationRatio,
    shortAverageUtilizationRatio - mediumAverageUtilizationRatio,
    -1,
    1,
  );
  const deltaAutoLimitTriggeredRate = clampSigned(
    input.quality?.deltaAutoLimitTriggeredRate,
    shortAutoLimitTriggeredRate - mediumAutoLimitTriggeredRate,
    -1,
    1,
  );
  const deltaSnapshotSemanticCompressRate = clampSigned(
    input.quality?.deltaSnapshotSemanticCompressRate,
    shortSnapshotSemanticCompressRate - mediumSnapshotSemanticCompressRate,
    -1,
    1,
  );
  const hardBudgetRate = clampRatio(input.quality?.hardBudgetRate, 0);
  const qualityFirstImprovedRate = clampRatio(input.quality?.qualityFirstImprovedRate, 0);
  const hardBudgetFollowupDelta = clampSigned(
    input.quality?.hardBudgetFollowupOverallDelta,
    0,
    -1,
    1,
  );
  const qualityFirstFollowupDelta = clampSigned(
    input.quality?.qualityFirstFollowupOverallDelta,
    0,
    -1,
    1,
  );

  next.qualityLowRateEma = mixEma(current.qualityLowRateEma, qualityLowRate, alpha);
  next.qualityPressureEma = mixEma(current.qualityPressureEma, qualityPressure, alpha);
  next.averageUtilizationRatioEma = mixEma(
    current.averageUtilizationRatioEma,
    averageUtilizationRatio,
    alpha,
  );
  next.autoLimitTriggeredRateEma = mixEma(
    current.autoLimitTriggeredRateEma,
    autoLimitTriggeredRate,
    alpha,
  );
  next.snapshotSemanticCompressRateEma = mixEma(
    current.snapshotSemanticCompressRateEma,
    snapshotSemanticCompressRate,
    alpha,
  );
  next.hardBudgetRateEma = mixEma(current.hardBudgetRateEma, hardBudgetRate, alpha);
  next.qualityFirstImprovedRateEma = mixEma(
    current.qualityFirstImprovedRateEma,
    qualityFirstImprovedRate,
    alpha,
  );
  next.hardBudgetFollowupDeltaEma = mixEma(
    current.hardBudgetFollowupDeltaEma,
    hardBudgetFollowupDelta,
    alpha,
  );
  next.qualityFirstFollowupDeltaEma = mixEma(
    current.qualityFirstFollowupDeltaEma,
    qualityFirstFollowupDelta,
    alpha,
  );

  const reasons: string[] = [];
  if (next.profile !== current.profile) {
    reasons.push(`profile_switched_${next.profile}`);
  }
  const profileOffset = resolveProfileThresholdOffset(next.profile);
  const qualityVolatility = clampToFloatRange(
    Math.max(
      Math.abs(qualityLowRate - current.qualityLowRateEma),
      Math.abs(qualityPressure - current.qualityPressureEma),
      Math.abs(averageUtilizationRatio - current.averageUtilizationRatioEma),
      Math.abs(autoLimitTriggeredRate - current.autoLimitTriggeredRateEma),
      Math.abs(snapshotSemanticCompressRate - current.snapshotSemanticCompressRateEma),
      Math.abs(deltaAverageUtilizationRatio),
      Math.abs(deltaAutoLimitTriggeredRate),
      Math.abs(deltaSnapshotSemanticCompressRate),
      Math.abs(hardBudgetRate - current.hardBudgetRateEma),
      Math.abs(qualityFirstImprovedRate - current.qualityFirstImprovedRateEma),
    ),
    0,
    1,
  );
  const alphaTarget =
    qualityVolatility >= 0.45
      ? 0.12
      : qualityVolatility <= 0.18
      ? 0.26
      : 0.2;
  const alphaAdjusted = clampToFloatRange(
    stepToward(current.adaptiveLearnAlpha, alphaTarget, 0.02),
    0.05,
    0.5,
  );
  if (alphaAdjusted !== current.adaptiveLearnAlpha) {
    next.adaptiveLearnAlpha = alphaAdjusted;
    reasons.push("alpha_rebalanced");
  }
  const qualityTightenLowRateThreshold = clampToFloatRange(
    0.34 + profileOffset.tightenOffset,
    0.24,
    0.56,
  );
  const qualitySignalRelaxLowRateThreshold = clampToFloatRange(
    0.18 + profileOffset.relaxOffset,
    0.08,
    0.36,
  );
  const qualityPressureTighten =
    next.qualityLowRateEma >= qualityTightenLowRateThreshold
    && (
      next.qualityPressureEma >= clampToFloatRange(0.58 + profileOffset.tightenOffset, 0.42, 0.8)
      || next.hardBudgetRateEma >= clampToFloatRange(0.46 + profileOffset.tightenOffset, 0.3, 0.72)
      || next.averageUtilizationRatioEma >= clampToFloatRange(0.92 + profileOffset.tightenOffset, 0.78, 0.98)
      || next.autoLimitTriggeredRateEma >= clampToFloatRange(0.42 + profileOffset.tightenOffset, 0.22, 0.7)
      || next.hardBudgetFollowupDeltaEma <= -0.03
    );
  const qualitySignalRelax =
    next.qualityLowRateEma <= qualitySignalRelaxLowRateThreshold
    && next.qualityPressureEma <= clampToFloatRange(0.34 + profileOffset.relaxOffset, 0.2, 0.54)
    && next.averageUtilizationRatioEma <= clampToFloatRange(0.72 + profileOffset.relaxOffset, 0.52, 0.9)
    && next.autoLimitTriggeredRateEma <= clampToFloatRange(0.16 + profileOffset.relaxOffset, 0.05, 0.34)
    && next.hardBudgetRateEma <= clampToFloatRange(0.22 + profileOffset.relaxOffset, 0.08, 0.42)
    && next.qualityFirstImprovedRateEma >= 0.58
    && next.qualityFirstFollowupDeltaEma >= -0.01;

  const pressureTrendUpCount = [
    deltaAverageUtilizationRatio >= 0.05,
    deltaAutoLimitTriggeredRate >= 0.05,
    deltaSnapshotSemanticCompressRate >= 0.05,
  ].filter(Boolean).length;
  const pressureTrendMomentum = clampToFloatRange(
    Math.max(
      0,
      (deltaAverageUtilizationRatio * 1.3)
      + (deltaAutoLimitTriggeredRate * 1.4)
      + (deltaSnapshotSemanticCompressRate * 1.2),
    ),
    0,
    1,
  );
  const budgetPressureSeverity = clampToFloatRange(
    Math.max(
      next.averageUtilizationRatioEma,
      next.autoLimitTriggeredRateEma * 1.08,
      next.snapshotSemanticCompressRateEma * 0.96,
      pressureTrendMomentum,
    ),
    0,
    1,
  );
  const budgetPressureTighten =
    (
      (
        next.averageUtilizationRatioEma >= clampToFloatRange(0.88 + profileOffset.tightenOffset, 0.72, 0.98)
        && next.autoLimitTriggeredRateEma >= clampToFloatRange(0.28 + profileOffset.tightenOffset, 0.16, 0.56)
      )
      || (
        next.averageUtilizationRatioEma >= clampToFloatRange(0.87 + profileOffset.tightenOffset, 0.72, 0.98)
        && next.snapshotSemanticCompressRateEma >= clampToFloatRange(0.24 + profileOffset.tightenOffset, 0.12, 0.5)
      )
      || (
        next.autoLimitTriggeredRateEma >= clampToFloatRange(0.34 + profileOffset.tightenOffset, 0.18, 0.58)
        && next.snapshotSemanticCompressRateEma >= clampToFloatRange(0.26 + profileOffset.tightenOffset, 0.12, 0.5)
      )
      || budgetPressureSeverity >= 0.93
    )
    && (
      pressureTrendUpCount >= 1
      || pressureTrendMomentum >= 0.18
    )
    && next.qualityFirstImprovedRateEma <= 0.86;

  const pressureSeverity = clampToFloatRange(
    Math.max(
      next.qualityLowRateEma,
      next.qualityPressureEma,
      next.averageUtilizationRatioEma,
      next.autoLimitTriggeredRateEma,
      next.snapshotSemanticCompressRateEma * 0.85,
      next.hardBudgetRateEma,
      Math.max(0, -next.hardBudgetFollowupDeltaEma * 3),
      budgetPressureSeverity,
    ),
    0,
    1,
  );
  const relaxStrength = clampToFloatRange(
    Math.max(
      0,
      (0.26 - next.qualityLowRateEma)
        + (0.38 - next.qualityPressureEma)
        + (next.qualityFirstImprovedRateEma * 0.5)
        + Math.max(0, next.qualityFirstFollowupDeltaEma * 2.5),
    ),
    0,
    1,
  );
  const outcomeEvidenceStrength = deriveOutcomeEvidenceStrength({
    quality: input.quality,
    pressureTrendUpCount,
    pressureTrendMomentum,
  });
  next.outcomeConfidenceEma = mixEma(
    current.outcomeConfidenceEma,
    outcomeEvidenceStrength,
    0.18,
  );

  let rollbackApplied = false;
  const hasPendingOutcome = current.pendingEvaluationDirection !== "neutral";
  if (hasPendingOutcome) {
    if (current.pendingEvaluationWarmupTurns > 0) {
      next.pendingEvaluationWarmupTurns = current.pendingEvaluationWarmupTurns - 1;
      reasons.push("outcome_warmup");
    } else {
      const direction = current.pendingEvaluationDirection;
      const qualityGain =
        ((current.pendingBaselineQualityLowRateEma - next.qualityLowRateEma) * 0.95)
        + ((next.qualityFirstImprovedRateEma - current.pendingBaselineQualityFirstImprovedRateEma) * 0.8)
        + ((next.hardBudgetFollowupDeltaEma - current.pendingBaselineHardBudgetFollowupDeltaEma) * 1.45)
        + ((next.qualityFirstFollowupDeltaEma - current.pendingBaselineQualityFirstFollowupDeltaEma) * 1.2);
      const tightenPressureRelief =
        ((current.pendingBaselineAverageUtilizationRatioEma - next.averageUtilizationRatioEma) * 0.8)
        + ((current.pendingBaselineAutoLimitTriggeredRateEma - next.autoLimitTriggeredRateEma) * 0.8)
        + ((current.pendingBaselineSnapshotSemanticCompressRateEma - next.snapshotSemanticCompressRateEma) * 0.6);
      const relaxPressurePenalty =
        (Math.max(0, next.averageUtilizationRatioEma - current.pendingBaselineAverageUtilizationRatioEma) * 0.45)
        + (Math.max(0, next.autoLimitTriggeredRateEma - current.pendingBaselineAutoLimitTriggeredRateEma) * 0.45)
        + (Math.max(0, next.snapshotSemanticCompressRateEma - current.pendingBaselineSnapshotSemanticCompressRateEma) * 0.35);
      const outcomeGain = clampSigned(
        direction === "tighten"
          ? qualityGain + tightenPressureRelief
          : qualityGain - relaxPressurePenalty,
        0,
        -1,
        1,
      );
      next.lastOutcomeGain = outcomeGain;
      const rollbackThreshold = clampSigned(
        direction === "tighten"
          ? -0.03 - (0.03 * (1 - next.outcomeConfidenceEma))
          : -0.04 - (0.03 * (1 - next.outcomeConfidenceEma)),
        -0.06,
        -0.2,
        0,
      );

      next.pendingEvaluationDirection = "neutral";
      next.pendingEvaluationWarmupTurns = 0;
      if (outcomeGain < rollbackThreshold) {
        next.injectBudgetRatio = current.pendingBaselineInjectBudgetRatio;
        next.maxSectionTokens = current.pendingBaselineMaxSectionTokens;
        next.maxGaMemoryRows = current.pendingBaselineMaxGaMemoryRows;
        next.maxTeamExperienceRows = current.pendingBaselineMaxTeamExperienceRows;
        next.minTeamExperienceScore = current.pendingBaselineMinTeamExperienceScore;
        next.cooldownTurnsRemaining = Math.max(next.cooldownTurnsRemaining, 2);
        next.lastActionDirection = "neutral";
        next.outcomeRollbackCount = current.outcomeRollbackCount + 1;
        next.outcomeNegativeStreak = clampToIntRange(
          current.outcomeNegativeStreak + 1,
          0,
          32,
        );
        rollbackApplied = true;
        reasons.push(`outcome_rollback_${direction}`);
      } else if (outcomeGain < 0) {
        next.outcomeNegativeStreak = clampToIntRange(
          current.outcomeNegativeStreak + 1,
          0,
          32,
        );
        reasons.push(`outcome_negative_${direction}`);
      } else {
        next.outcomeNegativeStreak = Math.max(0, current.outcomeNegativeStreak - 1);
        reasons.push(`outcome_positive_${direction}`);
      }
    }
  } else {
    next.pendingEvaluationDirection = "neutral";
    next.pendingEvaluationWarmupTurns = 0;
    next.outcomeNegativeStreak = Math.max(0, current.outcomeNegativeStreak - 1);
  }

  let signalDirection: MemoryStrategyAutotuneActionDirection = "neutral";
  if (rollbackApplied) {
    signalDirection = "neutral";
  } else if (qualityPressureTighten || budgetPressureTighten) {
    signalDirection = "tighten";
  } else if (qualitySignalRelax) {
    signalDirection = "relax";
  }

  if (signalDirection === "tighten") {
    next.tightenSignalStreak = clampToIntRange(current.tightenSignalStreak + 1, 0, 32);
    next.relaxSignalStreak = 0;
  } else if (signalDirection === "relax") {
    next.relaxSignalStreak = clampToIntRange(current.relaxSignalStreak + 1, 0, 32);
    next.tightenSignalStreak = 0;
  } else {
    next.tightenSignalStreak = Math.max(0, current.tightenSignalStreak - 1);
    next.relaxSignalStreak = Math.max(0, current.relaxSignalStreak - 1);
  }

  const severeTighten = pressureSeverity >= 0.78;
  const severeRelax =
    next.qualityLowRateEma <= 0.1
    && next.qualityPressureEma <= 0.2
    && next.qualityFirstImprovedRateEma >= 0.75;
  const severeSignal =
    (signalDirection === "tighten" && severeTighten)
    || (signalDirection === "relax" && severeRelax);
  const oppositeSignal =
    signalDirection !== "neutral"
    && current.lastActionDirection !== "neutral"
    && signalDirection !== current.lastActionDirection;
  const signalStreak =
    signalDirection === "tighten"
      ? next.tightenSignalStreak
      : signalDirection === "relax"
      ? next.relaxSignalStreak
      : 0;
  if (signalDirection === "tighten") {
    next.adaptiveActionScale = clampToFloatRange(
      0.9 + (pressureSeverity * 1.1),
      0.75,
      2.2,
    );
  } else if (signalDirection === "relax") {
    next.adaptiveActionScale = clampToFloatRange(
      0.85 + (relaxStrength * 1.0),
      0.75,
      1.85,
    );
  } else {
    next.adaptiveActionScale = clampToFloatRange(
      stepToward(current.adaptiveActionScale, 1, 0.08),
      0.5,
      2.5,
    );
  }
  const holdByCooldown =
    oppositeSignal
    && current.cooldownTurnsRemaining > 0
    && !severeSignal
    && signalStreak < 2;
  if (holdByCooldown) {
    next.cooldownTurnsRemaining = Math.max(0, current.cooldownTurnsRemaining - 1);
    reasons.push("cooldown_hold");
  } else if (signalDirection === "tighten") {
    const sectionStep = Math.max(48, Math.round(120 * next.adaptiveActionScale));
    const rowStep = Math.max(1, Math.round(next.adaptiveActionScale));
    const scoreStep = Math.max(1, Math.round(2 * next.adaptiveActionScale));
    next.injectBudgetRatio = clampRatio(
      Number((next.injectBudgetRatio - (0.01 * next.adaptiveActionScale)).toFixed(4)),
      current.injectBudgetRatio,
      ranges.budgetRatioMin,
      ranges.budgetRatioMax,
    );
    next.maxSectionTokens = clampToIntRange(
      next.maxSectionTokens - sectionStep,
      ranges.sectionMin,
      ranges.sectionMax,
    );
    next.maxGaMemoryRows = clampToIntRange(
      next.maxGaMemoryRows - rowStep,
      ranges.gaRowsMin,
      ranges.gaRowsMax,
    );
    next.maxTeamExperienceRows = clampToIntRange(
      next.maxTeamExperienceRows - rowStep,
      ranges.teamRowsMin,
      ranges.teamRowsMax,
    );
    next.minTeamExperienceScore = clampToIntRange(
      next.minTeamExperienceScore + scoreStep,
      ranges.teamScoreMin,
      ranges.teamScoreMax,
    );
    next.lastActionDirection = "tighten";
    next.cooldownTurnsRemaining = severeTighten ? 3 : 2;
    next.pendingEvaluationDirection = "tighten";
    next.pendingEvaluationWarmupTurns = severeTighten ? 2 : 1;
    next.pendingBaselineInjectBudgetRatio = current.injectBudgetRatio;
    next.pendingBaselineMaxSectionTokens = current.maxSectionTokens;
    next.pendingBaselineMaxGaMemoryRows = current.maxGaMemoryRows;
    next.pendingBaselineMaxTeamExperienceRows = current.maxTeamExperienceRows;
    next.pendingBaselineMinTeamExperienceScore = current.minTeamExperienceScore;
    next.pendingBaselineQualityLowRateEma = current.qualityLowRateEma;
    next.pendingBaselineQualityPressureEma = current.qualityPressureEma;
    next.pendingBaselineAverageUtilizationRatioEma = current.averageUtilizationRatioEma;
    next.pendingBaselineAutoLimitTriggeredRateEma = current.autoLimitTriggeredRateEma;
    next.pendingBaselineSnapshotSemanticCompressRateEma = current.snapshotSemanticCompressRateEma;
    next.pendingBaselineHardBudgetFollowupDeltaEma = current.hardBudgetFollowupDeltaEma;
    next.pendingBaselineQualityFirstFollowupDeltaEma = current.qualityFirstFollowupDeltaEma;
    next.pendingBaselineQualityFirstImprovedRateEma = current.qualityFirstImprovedRateEma;
    const tightenReason =
      budgetPressureTighten && !qualityPressureTighten
        ? "budget_pressure_tighten"
        : "quality_pressure_tighten";
    reasons.push(severeTighten ? `${tightenReason}_severe` : tightenReason, "outcome_watch_started");
  } else if (signalDirection === "relax") {
    const sectionStep = Math.max(40, Math.round(96 * next.adaptiveActionScale));
    const rowStep = Math.max(1, Math.round(next.adaptiveActionScale));
    const scoreStep = Math.max(1, Math.round(1.5 * next.adaptiveActionScale));
    next.injectBudgetRatio = clampRatio(
      Number((next.injectBudgetRatio + (0.008 * next.adaptiveActionScale)).toFixed(4)),
      current.injectBudgetRatio,
      ranges.budgetRatioMin,
      ranges.budgetRatioMax,
    );
    next.maxSectionTokens = clampToIntRange(
      next.maxSectionTokens + sectionStep,
      ranges.sectionMin,
      ranges.sectionMax,
    );
    next.maxGaMemoryRows = clampToIntRange(
      next.maxGaMemoryRows + rowStep,
      ranges.gaRowsMin,
      ranges.gaRowsMax,
    );
    next.maxTeamExperienceRows = clampToIntRange(
      next.maxTeamExperienceRows + rowStep,
      ranges.teamRowsMin,
      ranges.teamRowsMax,
    );
    next.minTeamExperienceScore = clampToIntRange(
      next.minTeamExperienceScore - scoreStep,
      ranges.teamScoreMin,
      ranges.teamScoreMax,
    );
    next.lastActionDirection = "relax";
    next.cooldownTurnsRemaining = severeRelax ? 2 : 1;
    next.pendingEvaluationDirection = "relax";
    next.pendingEvaluationWarmupTurns = severeRelax ? 2 : 1;
    next.pendingBaselineInjectBudgetRatio = current.injectBudgetRatio;
    next.pendingBaselineMaxSectionTokens = current.maxSectionTokens;
    next.pendingBaselineMaxGaMemoryRows = current.maxGaMemoryRows;
    next.pendingBaselineMaxTeamExperienceRows = current.maxTeamExperienceRows;
    next.pendingBaselineMinTeamExperienceScore = current.minTeamExperienceScore;
    next.pendingBaselineQualityLowRateEma = current.qualityLowRateEma;
    next.pendingBaselineQualityPressureEma = current.qualityPressureEma;
    next.pendingBaselineAverageUtilizationRatioEma = current.averageUtilizationRatioEma;
    next.pendingBaselineAutoLimitTriggeredRateEma = current.autoLimitTriggeredRateEma;
    next.pendingBaselineSnapshotSemanticCompressRateEma = current.snapshotSemanticCompressRateEma;
    next.pendingBaselineHardBudgetFollowupDeltaEma = current.hardBudgetFollowupDeltaEma;
    next.pendingBaselineQualityFirstFollowupDeltaEma = current.qualityFirstFollowupDeltaEma;
    next.pendingBaselineQualityFirstImprovedRateEma = current.qualityFirstImprovedRateEma;
    reasons.push(
      severeRelax ? "quality_signal_relax_severe" : "quality_signal_relax",
      "outcome_watch_started",
    );
  } else {
    next.cooldownTurnsRemaining = rollbackApplied
      ? Math.max(next.cooldownTurnsRemaining, 2)
      : Math.max(0, current.cooldownTurnsRemaining - 1);
    const returnRatio = clampRatio(
      Number(stepToward(next.injectBudgetRatio, input.basePolicy.injectBudgetRatio, 0.005).toFixed(4)),
      input.basePolicy.injectBudgetRatio,
      ranges.budgetRatioMin,
      ranges.budgetRatioMax,
    );
    const returnSection = clampToIntRange(
      stepToward(next.maxSectionTokens, input.basePolicy.maxSectionTokens, 48),
      ranges.sectionMin,
      ranges.sectionMax,
    );
    const returnGaRows = clampToIntRange(
      stepToward(next.maxGaMemoryRows, input.basePolicy.maxGaMemoryRows, 1),
      ranges.gaRowsMin,
      ranges.gaRowsMax,
    );
    const returnTeamRows = clampToIntRange(
      stepToward(next.maxTeamExperienceRows, input.basePolicy.maxTeamExperienceRows, 1),
      ranges.teamRowsMin,
      ranges.teamRowsMax,
    );
    const returnTeamScore = clampToIntRange(
      stepToward(next.minTeamExperienceScore, input.basePolicy.minTeamExperienceScore, 1),
      ranges.teamScoreMin,
      ranges.teamScoreMax,
    );
    const returnChanged =
      returnRatio !== next.injectBudgetRatio
      || returnSection !== next.maxSectionTokens
      || returnGaRows !== next.maxGaMemoryRows
      || returnTeamRows !== next.maxTeamExperienceRows
      || returnTeamScore !== next.minTeamExperienceScore;
    next.injectBudgetRatio = returnRatio;
    next.maxSectionTokens = returnSection;
    next.maxGaMemoryRows = returnGaRows;
    next.maxTeamExperienceRows = returnTeamRows;
    next.minTeamExperienceScore = returnTeamScore;
    next.lastActionDirection = current.lastActionDirection;
    if (returnChanged) {
      reasons.push("return_to_base");
    }
  }

  next.adaptiveUpdates = current.adaptiveUpdates + 1;
  next.lastReason = reasons.length > 0 ? reasons.join(",") : "stable";
  next.updatedAt = input.nowIso ?? new Date().toISOString();

  return {
    state: next,
    changed: !stateEquals(current, next),
    reason: next.lastReason,
  };
}
