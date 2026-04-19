import { mkdirSync } from "node:fs";
import {
  applyMemoryStrategyAutotuneToPolicy,
  defaultMemoryOrchestratorPolicy,
  defaultMemoryStrategyAutotuneState,
  deriveMemoryStrategyAutotuneState,
  normalizeMemoryStrategyAutotuneState,
  readMemoryStrategyAutotuneState,
  writeMemoryStrategyAutotuneState,
} from "../../tools/memory";

const basePolicy = defaultMemoryOrchestratorPolicy();
const baseState = defaultMemoryStrategyAutotuneState(basePolicy);

const qualityPressureCurrentState = {
  ...baseState,
  injectBudgetRatio: 0.27,
  maxSectionTokens: 1_360,
  maxGaMemoryRows: 5,
  maxTeamExperienceRows: 4,
  minTeamExperienceScore: 34,
  qualityLowRateEma: 0.66,
  qualityPressureEma: 0.74,
  hardBudgetRateEma: 0.61,
  qualityFirstImprovedRateEma: 0.28,
  hardBudgetFollowupDeltaEma: -0.11,
  qualityFirstFollowupDeltaEma: -0.03,
};

const qualityPressureUpdate = deriveMemoryStrategyAutotuneState({
  basePolicy,
  currentState: qualityPressureCurrentState,
  quality: {
    lowQualityRate: 0.78,
    averagePreSendPressureScore: 0.85,
    hardBudgetRate: 0.69,
    qualityFirstImprovedRate: 0.24,
    hardBudgetFollowupOverallDelta: -0.2,
    qualityFirstFollowupOverallDelta: -0.04,
  },
  nowIso: "2026-04-19T11:00:00.000Z",
});

const qualityRelaxCurrentState = {
  ...baseState,
  injectBudgetRatio: 0.16,
  maxSectionTokens: 820,
  maxGaMemoryRows: 2,
  maxTeamExperienceRows: 2,
  minTeamExperienceScore: 44,
  qualityLowRateEma: 0.09,
  qualityPressureEma: 0.18,
  hardBudgetRateEma: 0.1,
  qualityFirstImprovedRateEma: 0.8,
  hardBudgetFollowupDeltaEma: -0.01,
  qualityFirstFollowupDeltaEma: 0.08,
};

const qualityRelaxUpdate = deriveMemoryStrategyAutotuneState({
  basePolicy,
  currentState: qualityRelaxCurrentState,
  quality: {
    lowQualityRate: 0.05,
    averagePreSendPressureScore: 0.17,
    hardBudgetRate: 0.08,
    qualityFirstImprovedRate: 0.9,
    hardBudgetFollowupOverallDelta: 0.01,
    qualityFirstFollowupOverallDelta: 0.12,
  },
  nowIso: "2026-04-19T11:05:00.000Z",
});

const pressureOnlyCurrentState = {
  ...baseState,
  injectBudgetRatio: 0.24,
  maxSectionTokens: 1_080,
  maxGaMemoryRows: 4,
  maxTeamExperienceRows: 3,
  minTeamExperienceScore: 36,
  qualityLowRateEma: 0.12,
  qualityPressureEma: 0.26,
  averageUtilizationRatioEma: 0.9,
  autoLimitTriggeredRateEma: 0.31,
  snapshotSemanticCompressRateEma: 0.28,
  hardBudgetRateEma: 0.21,
  qualityFirstImprovedRateEma: 0.68,
  hardBudgetFollowupDeltaEma: -0.01,
  qualityFirstFollowupDeltaEma: 0.04,
};

const pressureOnlyUpdate = deriveMemoryStrategyAutotuneState({
  basePolicy,
  currentState: pressureOnlyCurrentState,
  quality: {
    lowQualityRate: 0.14,
    averagePreSendPressureScore: 0.31,
    averageUtilizationRatio: 0.95,
    autoLimitTriggeredRate: 0.41,
    snapshotSemanticCompressRate: 0.36,
    shortAverageUtilizationRatio: 0.97,
    mediumAverageUtilizationRatio: 0.85,
    deltaAverageUtilizationRatio: 0.12,
    shortAutoLimitTriggeredRate: 0.44,
    mediumAutoLimitTriggeredRate: 0.28,
    deltaAutoLimitTriggeredRate: 0.16,
    shortSnapshotSemanticCompressRate: 0.38,
    mediumSnapshotSemanticCompressRate: 0.2,
    deltaSnapshotSemanticCompressRate: 0.18,
    hardBudgetRate: 0.33,
    qualityFirstImprovedRate: 0.63,
    hardBudgetFollowupOverallDelta: -0.02,
    qualityFirstFollowupOverallDelta: 0.05,
  },
  nowIso: "2026-04-19T11:06:00.000Z",
});

const cooldownHoldCurrentState = {
  ...qualityRelaxCurrentState,
  lastActionDirection: "tighten" as const,
  cooldownTurnsRemaining: 2,
  tightenSignalStreak: 3,
  relaxSignalStreak: 0,
  adaptiveActionScale: 1.3,
};

const cooldownHoldUpdate = deriveMemoryStrategyAutotuneState({
  basePolicy,
  currentState: cooldownHoldCurrentState,
  quality: {
    lowQualityRate: 0.16,
    averagePreSendPressureScore: 0.31,
    hardBudgetRate: 0.14,
    qualityFirstImprovedRate: 0.66,
    hardBudgetFollowupOverallDelta: -0.01,
    qualityFirstFollowupOverallDelta: 0.03,
  },
  nowIso: "2026-04-19T11:07:00.000Z",
});

const cooldownReleaseUpdate = deriveMemoryStrategyAutotuneState({
  basePolicy,
  currentState: cooldownHoldUpdate.state,
  quality: {
    lowQualityRate: 0.15,
    averagePreSendPressureScore: 0.3,
    hardBudgetRate: 0.13,
    qualityFirstImprovedRate: 0.68,
    hardBudgetFollowupOverallDelta: 0,
    qualityFirstFollowupOverallDelta: 0.04,
  },
  nowIso: "2026-04-19T11:08:00.000Z",
});

const normalizedInvalid = normalizeMemoryStrategyAutotuneState(
  {
    injectBudgetRatio: 99,
    maxSectionTokens: -10,
    maxGaMemoryRows: -20,
    maxTeamExperienceRows: "bad",
    minTeamExperienceScore: -4,
    adaptiveLearnAlpha: 4,
    adaptiveUpdates: -5,
    qualityLowRateEma: -3,
    hardBudgetFollowupDeltaEma: 9,
    cooldownTurnsRemaining: -2,
    adaptiveActionScale: 9,
  },
  basePolicy,
);

const policyAfterAutotune = applyMemoryStrategyAutotuneToPolicy({
  basePolicy,
  state: qualityPressureUpdate.state,
});

const tempWorkDir = `${process.cwd()}/.grobot/tmp/memory-strategy-autotune-contract`;
mkdirSync(tempWorkDir, { recursive: true });
writeMemoryStrategyAutotuneState({
  workDir: tempWorkDir,
  basePolicy,
  state: qualityPressureUpdate.state,
});
const reloaded = readMemoryStrategyAutotuneState({
  workDir: tempWorkDir,
  basePolicy,
});

const payload = {
  quality_pressure_update_changed: qualityPressureUpdate.changed,
  quality_pressure_update_has_reason:
    qualityPressureUpdate.reason.includes("quality_pressure_tighten"),
  quality_pressure_budget_tightened:
    qualityPressureUpdate.state.injectBudgetRatio < qualityPressureCurrentState.injectBudgetRatio,
  quality_pressure_section_tightened:
    qualityPressureUpdate.state.maxSectionTokens < qualityPressureCurrentState.maxSectionTokens,
  quality_pressure_score_tightened:
    qualityPressureUpdate.state.minTeamExperienceScore > qualityPressureCurrentState.minTeamExperienceScore,
  quality_pressure_alpha_rebalanced:
    qualityPressureUpdate.state.adaptiveLearnAlpha !== qualityPressureCurrentState.adaptiveLearnAlpha,
  quality_relax_update_changed: qualityRelaxUpdate.changed,
  quality_relax_update_has_reason:
    qualityRelaxUpdate.reason.includes("quality_signal_relax"),
  quality_relax_budget_relaxed:
    qualityRelaxUpdate.state.injectBudgetRatio > qualityRelaxCurrentState.injectBudgetRatio,
  quality_relax_section_relaxed:
    qualityRelaxUpdate.state.maxSectionTokens > qualityRelaxCurrentState.maxSectionTokens,
  quality_relax_score_relaxed:
    qualityRelaxUpdate.state.minTeamExperienceScore < qualityRelaxCurrentState.minTeamExperienceScore,
  quality_relax_alpha_rebalanced:
    qualityRelaxUpdate.state.adaptiveLearnAlpha !== qualityRelaxCurrentState.adaptiveLearnAlpha,
  pressure_only_update_changed: pressureOnlyUpdate.changed,
  pressure_only_update_has_reason:
    pressureOnlyUpdate.reason.includes("budget_pressure_tighten"),
  pressure_only_update_budget_tightened:
    pressureOnlyUpdate.state.injectBudgetRatio < pressureOnlyCurrentState.injectBudgetRatio,
  pressure_only_update_section_tightened:
    pressureOnlyUpdate.state.maxSectionTokens < pressureOnlyCurrentState.maxSectionTokens,
  pressure_only_update_quality_still_healthy:
    pressureOnlyUpdate.state.qualityLowRateEma < 0.34,
  cooldown_hold_has_reason:
    cooldownHoldUpdate.reason.includes("cooldown_hold"),
  cooldown_hold_keeps_ratio:
    cooldownHoldUpdate.state.injectBudgetRatio === cooldownHoldCurrentState.injectBudgetRatio,
  cooldown_hold_decrements_window:
    cooldownHoldUpdate.state.cooldownTurnsRemaining < cooldownHoldCurrentState.cooldownTurnsRemaining,
  cooldown_release_has_relax_reason:
    cooldownReleaseUpdate.reason.includes("quality_signal_relax"),
  cooldown_release_ratio_increases:
    cooldownReleaseUpdate.state.injectBudgetRatio > cooldownHoldUpdate.state.injectBudgetRatio,
  cooldown_release_direction_relax:
    cooldownReleaseUpdate.state.lastActionDirection === "relax",
  normalized_invalid_budget_clamped:
    normalizedInvalid.injectBudgetRatio <= 0.55 && normalizedInvalid.injectBudgetRatio >= 0.08,
  normalized_invalid_section_clamped: normalizedInvalid.maxSectionTokens >= 320,
  normalized_invalid_rows_clamped:
    normalizedInvalid.maxGaMemoryRows >= 1 && normalizedInvalid.maxTeamExperienceRows >= 1,
  normalized_invalid_score_clamped: normalizedInvalid.minTeamExperienceScore >= 12,
  normalized_invalid_alpha_clamped:
    normalizedInvalid.adaptiveLearnAlpha <= 0.5 && normalizedInvalid.adaptiveLearnAlpha >= 0.05,
  normalized_invalid_followup_clamped:
    normalizedInvalid.hardBudgetFollowupDeltaEma <= 1 && normalizedInvalid.hardBudgetFollowupDeltaEma >= -1,
  normalized_invalid_cooldown_clamped: normalizedInvalid.cooldownTurnsRemaining === 0,
  normalized_invalid_action_scale_clamped:
    normalizedInvalid.adaptiveActionScale <= 2.5 && normalizedInvalid.adaptiveActionScale >= 0.5,
  policy_applied_matches_state:
    policyAfterAutotune.injectBudgetRatio === qualityPressureUpdate.state.injectBudgetRatio
    && policyAfterAutotune.maxSectionTokens === qualityPressureUpdate.state.maxSectionTokens
    && policyAfterAutotune.maxGaMemoryRows === qualityPressureUpdate.state.maxGaMemoryRows
    && policyAfterAutotune.maxTeamExperienceRows === qualityPressureUpdate.state.maxTeamExperienceRows
    && policyAfterAutotune.minTeamExperienceScore === qualityPressureUpdate.state.minTeamExperienceScore,
  state_roundtrip_updates_kept: reloaded.adaptiveUpdates === qualityPressureUpdate.state.adaptiveUpdates,
  state_roundtrip_reason_kept: reloaded.lastReason === qualityPressureUpdate.state.lastReason,
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
