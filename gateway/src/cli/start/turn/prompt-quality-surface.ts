import {
  appendPromptQualityWindowEntry,
  computePromptQualitySample,
  type PromptCompactionStage,
  type PromptPreparationResult,
  type PromptVariant,
} from "../../../tools/context";
import {
  type PromptQualityGuardAdaptiveDecision,
  type PromptQualityGuardDecision,
} from "../../../tools/context/compress/prompt-quality-guard";
import {
  type PromptQualityWindowDegradation,
  type PromptQualityWindowSummary,
} from "../../../tools/context/compress/prompt-quality-window";
import { nowIso } from "./time";

function formatOptionalMetric(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "<none>";
  }
  return value.toFixed(3);
}

export function buildQualityGuardPolicyAdaptiveDiagnostic(input: {
  decision: PromptQualityGuardAdaptiveDecision;
  summary: PromptQualityWindowSummary;
}): string {
  const { decision, summary } = input;
  const driftSummary = decision.outcomeDriftGuard.windowSummary;
  return [
    "[context-engine]",
    "event=quality_guard_policy_adaptive",
    `mode=${decision.mode}`,
    `reason=${decision.reason}`,
    `allowlist=${decision.allowlist.join(",")}`,
    `mode_blocked=${decision.modeBlocked ? "true" : "false"}`,
    `blocked_mode=${decision.blockedMode ?? "<none>"}`,
    `promote_streak=${String(decision.effectivePolicy.promoteStreak)}`,
    `severe_promote_streak=${String(decision.effectivePolicy.severePromoteStreak)}`,
    `release_streak=${String(decision.effectivePolicy.releaseStreak)}`,
    `hold_turns=${String(decision.effectivePolicy.holdTurns)}`,
    `pressure_source=${decision.pressurePolicy.source}`,
    `pressure_updated=${decision.pressurePolicy.updated ? "true" : "false"}`,
    `pressure_alpha=${decision.pressurePolicy.learnAlpha.toFixed(3)}`,
    `pressure_thresholds=${decision.pressurePolicy.utilizationThreshold.toFixed(3)}/${decision.pressurePolicy.semanticRateThreshold.toFixed(3)}/${decision.pressurePolicy.autoLimitRateThreshold.toFixed(3)}/${decision.pressurePolicy.jointRateThreshold.toFixed(3)}`,
    `semantic_rate=${formatOptionalMetric(summary.compressionActivity.snapshotSemanticCompressRate)}`,
    `auto_limit_rate=${formatOptionalMetric(summary.compressionActivity.autoLimitTriggeredRate)}`,
    `avg_utilization=${formatOptionalMetric(summary.tokenBudget.averageUtilizationRatio)}`,
    `hard_budget_rate=${formatOptionalMetric(summary.strategyActivity.hardBudgetRate)}`,
    `quality_first_rate=${formatOptionalMetric(summary.strategyActivity.qualityFirstRate)}`,
    `pre_send_overflow=${formatOptionalMetric(summary.signalAverages?.preSendOverflowRatio)}`,
    `pre_send_pressure=${formatOptionalMetric(summary.signalAverages?.preSendPressureScore)}`,
    `trend_delta_utilization=${formatOptionalMetric(summary.pressureTrends.delta.averageUtilizationRatio)}`,
    `trend_delta_semantic=${formatOptionalMetric(summary.pressureTrends.delta.snapshotSemanticCompressRate)}`,
    `trend_delta_auto_limit=${formatOptionalMetric(summary.pressureTrends.delta.autoLimitTriggeredRate)}`,
    `strategy_trend_delta_hard_budget=${formatOptionalMetric(summary.strategyTrends.delta.hardBudgetRate)}`,
    `strategy_trend_delta_overflow=${formatOptionalMetric(summary.strategyTrends.delta.averageOverflowRatio)}`,
    `strategy_trend_delta_pressure=${formatOptionalMetric(summary.strategyTrends.delta.averagePressureScore)}`,
    `outcome_reliability=${String(decision.outcomeReliability.requiredTransitions)}->${String(decision.outcomeReliability.nextRequiredTransitions)}/${String(decision.outcomeReliability.hardBudgetTransitions)}/${String(decision.outcomeReliability.qualityFirstTransitions)}/${decision.outcomeReliability.combinedEvidenceScore.toFixed(3)}`,
    `hard_budget_reliable=${decision.outcomeReliability.hardBudgetReliable ? "true" : "false"}`,
    `quality_first_reliable=${decision.outcomeReliability.qualityFirstReliable ? "true" : "false"}`,
    `drift_guard=${decision.outcomeDriftGuard.highEvidenceTurns}/${decision.outcomeDriftGuard.highEvidenceHardenTurns}/${decision.outcomeDriftGuard.highEvidenceHardenRate.toFixed(3)}/${decision.outcomeDriftGuard.highEvidenceHardenBias ? "bias" : "ok"}/${decision.outcomeDriftGuard.autoActionLevel}/${driftSummary.alertLevel}/${String(driftSummary.entries)}/${driftSummary.latest}/${driftSummary.dominant}/${driftSummary.activeRate.toFixed(3)}/${driftSummary.mediumOrHardRate.toFixed(3)}/${driftSummary.hardRate.toFixed(3)}/${String(driftSummary.transitionCount)}`,
  ].join(" ") + "\n";
}

export function buildQualityGuardPolicyDriftGuardDiagnostic(
  decision: PromptQualityGuardAdaptiveDecision,
): string {
  return [
    "[context-engine]",
    "event=quality_guard_policy_drift_guard",
    `reason=${decision.outcomeDriftGuard.reason}`,
    `recommendation=${decision.outcomeDriftGuard.recommendation}`,
    `auto_action_level=${decision.outcomeDriftGuard.autoActionLevel}`,
    `window_alert=${decision.outcomeDriftGuard.windowSummary.alertLevel}`,
    `high_evidence_turns=${String(decision.outcomeDriftGuard.highEvidenceTurns)}`,
    `high_evidence_harden_turns=${String(decision.outcomeDriftGuard.highEvidenceHardenTurns)}`,
    `high_evidence_harden_rate=${decision.outcomeDriftGuard.highEvidenceHardenRate.toFixed(3)}`,
  ].join(" ") + "\n";
}

export function buildQualityGuardPrecompactDiagnostic(input: {
  selectedStage: PromptCompactionStage;
  decision: PromptQualityGuardDecision;
  degradation: PromptQualityWindowDegradation;
}): string {
  const { selectedStage, decision, degradation } = input;
  return [
    "[context-engine]",
    "event=quality_guard_precompact",
    `stage=${selectedStage}`,
    `floor=${decision.floorStage}`,
    `reason=${degradation.reason}`,
    `severe=${decision.severe ? "true" : "false"}`,
    `promoted=${decision.promoted ? "true" : "false"}`,
    `released=${decision.released ? "true" : "false"}`,
    `degraded_streak=${String(decision.state.degradedStreak)}`,
    `healthy_streak=${String(decision.state.healthyStreak)}`,
    `hold_turns=${String(decision.state.holdTurnsRemaining)}`,
    `observed_overall=${formatOptionalMetric(degradation.observedOverall)}`,
    `observed_low_quality_rate=${formatOptionalMetric(degradation.observedLowQualityRate)}`,
  ].join(" ") + "\n";
}

export function buildPromptPreparedDiagnostic(input: {
  selectedStage: PromptCompactionStage;
  thresholdStage: PromptCompactionStage;
  selectionReason: "threshold" | "budget_guard";
  utilization: number;
  selectedUtilizationRatio: number;
  selectedPrepared: PromptVariant;
  promptPreparation: PromptPreparationResult;
  targetTokenLimit: number;
  downshiftGuardTriggered: boolean;
  qualityGuardActive: boolean;
  preSendCompressionStrategy: "quality_first" | "hard_budget";
  preSendCompressionOverflowRatio: number;
  preSendCompressionPressureScore: number;
  preSendCompressionOrder: string;
  preSendRecentTrimRows: number;
  preSendSnapshotTrimSections: number;
  preSendSnapshotSemanticCompressSections: number;
  preSendHeadTrimRetries: number;
}): string {
  return [
    "[context-engine]",
    "event=prompt_prepared",
    `stage=${input.selectedStage}`,
    `threshold_stage=${input.thresholdStage}`,
    `reason=${input.selectionReason}`,
    `utilization=${input.utilization.toFixed(3)}`,
    `selected_utilization=${input.selectedUtilizationRatio.toFixed(3)}`,
    `estimated_tokens=${String(input.selectedPrepared.estimatedTokens)}`,
    `auto_compact_limit=${String(input.promptPreparation.autoCompactTokenLimit)}`,
    `target_limit=${String(input.targetTokenLimit)}`,
    `effective_window=${String(input.promptPreparation.effectiveWindowTokens)}`,
    `auto_limit_triggered=${input.promptPreparation.autoCompactLimitTriggered ? "true" : "false"}`,
    `downshift_guard=${input.downshiftGuardTriggered ? "true" : "false"}`,
    `quality_guard=${input.qualityGuardActive ? "true" : "false"}`,
    `pre_send_strategy=${input.preSendCompressionStrategy}`,
    `pre_send_overflow_ratio=${input.preSendCompressionOverflowRatio.toFixed(3)}`,
    `pre_send_pressure_score=${input.preSendCompressionPressureScore.toFixed(3)}`,
    `pre_send_order=${input.preSendCompressionOrder}`,
    `recent_trim_rows=${String(input.preSendRecentTrimRows)}`,
    `snapshot_trim_sections=${String(input.preSendSnapshotTrimSections)}`,
    `snapshot_semantic_compress_sections=${String(input.preSendSnapshotSemanticCompressSections)}`,
    `pretrim_retries=${String(input.preSendHeadTrimRetries)}`,
  ].join(" ") + "\n";
}

export function recordPromptQualityWindowEntry(input: {
  workDir: string;
  sessionKey: string;
  selectedStage: PromptCompactionStage;
  selectionReason: "threshold" | "budget_guard";
  selectedPrepared: PromptVariant;
  targetTokenLimit: number;
  preSendRecentTrimRows: number;
  preSendSnapshotTrimSections: number;
  preSendSnapshotSemanticCompressSections: number;
  preSendHeadTrimRetries: number;
  autoLimitTriggered: boolean;
  downshiftGuardTriggered: boolean;
  preSendCompressionStrategy: "quality_first" | "hard_budget";
  preSendCompressionOverflowRatio: number;
  preSendCompressionPressureScore: number;
}): string {
  const sample = computePromptQualitySample({
    prompt: input.selectedPrepared.prompt,
    stage: input.selectedStage,
    estimatedTokens: input.selectedPrepared.estimatedTokens,
    targetTokenLimit: input.targetTokenLimit,
    recentTrimRows: input.preSendRecentTrimRows,
    snapshotTrimSections: input.preSendSnapshotTrimSections,
    snapshotSemanticCompressSections: input.preSendSnapshotSemanticCompressSections,
    headTrimRetries: input.preSendHeadTrimRetries,
    autoLimitTriggered: input.autoLimitTriggered,
    downshiftGuardTriggered: input.downshiftGuardTriggered,
    preSendStrategy: input.preSendCompressionStrategy,
    preSendOverflowRatio: input.preSendCompressionOverflowRatio,
    preSendPressureScore: input.preSendCompressionPressureScore,
  });
  appendPromptQualityWindowEntry({
    workDir: input.workDir,
    entry: {
      ts: nowIso(),
      sessionKey: input.sessionKey,
      stage: input.selectedStage,
      selectionReason: input.selectionReason,
      estimatedTokens: input.selectedPrepared.estimatedTokens,
      targetTokenLimit: input.targetTokenLimit,
      scores: sample.scores,
      signals: sample.signals,
    },
  });
  return [
    "[context-engine]",
    "event=prompt_quality",
    `coverage=${sample.scores.coverage.toFixed(3)}`,
    `recency=${sample.scores.recency.toFixed(3)}`,
    `size=${sample.scores.size.toFixed(3)}`,
    `overall=${sample.scores.overall.toFixed(3)}`,
    `recent_rows=${String(sample.signals.recentRows)}`,
    `snapshot_sections=${String(sample.signals.snapshotSections)}`,
    `recent_trim_rows=${String(sample.signals.recentTrimRows)}`,
    `snapshot_trim_sections=${String(sample.signals.snapshotTrimSections)}`,
    `snapshot_semantic_compress_sections=${String(sample.signals.snapshotSemanticCompressSections)}`,
    `head_trim_retries=${String(sample.signals.headTrimRetries)}`,
    `pre_send_strategy=${sample.signals.preSendStrategy}`,
    `pre_send_overflow_ratio=${sample.signals.preSendOverflowRatio.toFixed(3)}`,
    `pre_send_pressure_score=${sample.signals.preSendPressureScore.toFixed(3)}`,
  ].join(" ") + "\n";
}
