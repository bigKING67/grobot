import {
  appendPromptQualityWindowEntry,
  assessPromptQualityWindowDegradation,
  computePromptQualitySample,
  estimateTokensFromText,
  readPromptQualityWindowSummary,
} from "../../../tools/context";
import { isRecord, normalizePromptCompactionStage } from "./prompt-quality-shared";

export function runPromptQualityWindow(payload: Record<string, unknown>): Record<string, unknown> {
  const workDir = typeof payload.work_dir === "string" ? payload.work_dir.trim() : "";
  if (!workDir) {
    throw new Error("payload.work_dir must be non-empty");
  }
  const sessionKey = typeof payload.session_key === "string" && payload.session_key.trim().length > 0
    ? payload.session_key.trim()
    : "contract:prompt-quality-window";
  const samples = Array.isArray(payload.samples) ? payload.samples : [];
  if (samples.length === 0) {
    throw new Error("payload.samples must be a non-empty array");
  }
  const nowMs = Date.now();
  let written = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const row = samples[index];
    if (!isRecord(row)) {
      continue;
    }
    const prompt = typeof row.prompt === "string" ? row.prompt : "";
    if (!prompt.trim()) {
      continue;
    }
    const stage = normalizePromptCompactionStage(row.stage);
    const estimatedTokens = typeof row.estimated_tokens === "number" && Number.isFinite(row.estimated_tokens)
      ? Math.max(0, Math.floor(row.estimated_tokens))
      : estimateTokensFromText(prompt);
    const targetTokenLimit = typeof row.target_token_limit === "number" && Number.isFinite(row.target_token_limit)
      ? Math.max(1, Math.floor(row.target_token_limit))
      : Math.max(1, estimatedTokens);
    const recentTrimRows = typeof row.recent_trim_rows === "number" && Number.isFinite(row.recent_trim_rows)
      ? Math.max(0, Math.floor(row.recent_trim_rows))
      : 0;
    const snapshotTrimSections = typeof row.snapshot_trim_sections === "number" && Number.isFinite(row.snapshot_trim_sections)
      ? Math.max(0, Math.floor(row.snapshot_trim_sections))
      : 0;
    const snapshotSemanticCompressSections =
      typeof row.snapshot_semantic_compress_sections === "number"
      && Number.isFinite(row.snapshot_semantic_compress_sections)
        ? Math.max(0, Math.floor(row.snapshot_semantic_compress_sections))
        : 0;
    const headTrimRetries = typeof row.head_trim_retries === "number" && Number.isFinite(row.head_trim_retries)
      ? Math.max(0, Math.floor(row.head_trim_retries))
      : 0;
    const autoLimitTriggered = row.auto_limit_triggered === true;
    const downshiftGuardTriggered = row.downshift_guard_triggered === true;
    const preSendStrategy = row.pre_send_strategy === "hard_budget"
      ? "hard_budget"
      : "quality_first";
    const preSendOverflowRatio = typeof row.pre_send_overflow_ratio === "number"
      && Number.isFinite(row.pre_send_overflow_ratio)
      ? Math.max(0, row.pre_send_overflow_ratio)
      : 0;
    const preSendPressureScore = typeof row.pre_send_pressure_score === "number"
      && Number.isFinite(row.pre_send_pressure_score)
      ? Math.max(0, row.pre_send_pressure_score)
      : 0;
    const selectionReason = typeof row.selection_reason === "string" && row.selection_reason.trim().length > 0
      ? row.selection_reason.trim()
      : "contract";
    const quality = computePromptQualitySample({
      prompt,
      stage,
      estimatedTokens,
      targetTokenLimit,
      recentTrimRows,
      snapshotTrimSections,
      snapshotSemanticCompressSections,
      headTrimRetries,
      autoLimitTriggered,
      downshiftGuardTriggered,
      preSendStrategy,
      preSendOverflowRatio,
      preSendPressureScore,
    });
    appendPromptQualityWindowEntry({
      workDir,
      entry: {
        ts: new Date(nowMs + index).toISOString(),
        sessionKey,
        stage,
        selectionReason,
        estimatedTokens,
        targetTokenLimit,
        scores: quality.scores,
        signals: quality.signals,
      },
    });
    written += 1;
  }
  const size = typeof payload.size === "number" && Number.isFinite(payload.size)
    ? Math.max(1, Math.floor(payload.size))
    : 20;
  const lowQualityThreshold = typeof payload.low_quality_threshold === "number"
    && Number.isFinite(payload.low_quality_threshold)
    ? payload.low_quality_threshold
    : undefined;
  const summary = readPromptQualityWindowSummary({
    workDir,
    size,
    lowQualityThreshold,
  });
  const thresholdOverall = typeof payload.threshold_overall === "number" && Number.isFinite(payload.threshold_overall)
    ? payload.threshold_overall
    : 0.62;
  const thresholdLowQualityRate = typeof payload.threshold_low_quality_rate === "number"
    && Number.isFinite(payload.threshold_low_quality_rate)
    ? payload.threshold_low_quality_rate
    : 0.4;
  const minEntries = typeof payload.min_entries === "number" && Number.isFinite(payload.min_entries)
    ? Math.max(1, Math.floor(payload.min_entries))
    : 8;
  const degradation = assessPromptQualityWindowDegradation({
    summary,
    thresholdOverall,
    thresholdLowQualityRate,
    minEntries,
  });
  return {
    wrote_entries: written,
    summary: {
      path: summary.path,
      configured_size: summary.configuredSize,
      entries: summary.entries,
      from_ts: summary.fromTs,
      to_ts: summary.toTs,
      average_scores: summary.averageScores,
      latest_scores: summary.latestScores,
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
          snapshot_semantic_compress_sections:
            summary.signalAverages.snapshotSemanticCompressSections,
          head_trim_retries: summary.signalAverages.headTrimRetries,
          pre_send_overflow_ratio: summary.signalAverages.preSendOverflowRatio,
          pre_send_pressure_score: summary.signalAverages.preSendPressureScore,
        },
      compression_activity: {
        recent_trim_rate: summary.compressionActivity.recentTrimRate,
        snapshot_trim_rate: summary.compressionActivity.snapshotTrimRate,
        snapshot_semantic_compress_rate:
          summary.compressionActivity.snapshotSemanticCompressRate,
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
        hard_budget_followup_overall_delta:
          summary.strategyOutcomes.hardBudgetFollowupOverallDelta,
        quality_first_followup_overall_delta:
          summary.strategyOutcomes.qualityFirstFollowupOverallDelta,
        hard_budget_recovery_rate:
          summary.strategyOutcomes.hardBudgetRecoveryRate,
        quality_first_improved_rate:
          summary.strategyOutcomes.qualityFirstImprovedRate,
        hard_budget_transition_count:
          summary.strategyOutcomes.hardBudgetTransitions,
        quality_first_transition_count:
          summary.strategyOutcomes.qualityFirstTransitions,
      },
      pressure_trends: {
        short: {
          window_size: summary.pressureTrends.short.windowSize,
          entries: summary.pressureTrends.short.entries,
          snapshot_semantic_compress_rate:
            summary.pressureTrends.short.snapshotSemanticCompressRate,
          auto_limit_triggered_rate:
            summary.pressureTrends.short.autoLimitTriggeredRate,
          average_utilization_ratio:
            summary.pressureTrends.short.averageUtilizationRatio,
        },
        medium: {
          window_size: summary.pressureTrends.medium.windowSize,
          entries: summary.pressureTrends.medium.entries,
          snapshot_semantic_compress_rate:
            summary.pressureTrends.medium.snapshotSemanticCompressRate,
          auto_limit_triggered_rate:
            summary.pressureTrends.medium.autoLimitTriggeredRate,
          average_utilization_ratio:
            summary.pressureTrends.medium.averageUtilizationRatio,
        },
        delta: {
          snapshot_semantic_compress_rate:
            summary.pressureTrends.delta.snapshotSemanticCompressRate,
          auto_limit_triggered_rate:
            summary.pressureTrends.delta.autoLimitTriggeredRate,
          average_utilization_ratio:
            summary.pressureTrends.delta.averageUtilizationRatio,
        },
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
