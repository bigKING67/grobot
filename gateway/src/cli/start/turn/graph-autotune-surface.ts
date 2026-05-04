import { type GraphQualityAutotuneDecision } from "./graph-autotune";
import { formatOptionalMetric } from "./graph-autotune-utils";

export function buildGraphQualityAutotuneDiagnostic(
  decision: GraphQualityAutotuneDecision,
): string {
  const metrics = decision.metrics;
  return [
    "[context-engine]",
    "event=graph_quality_autotune",
    `action=${decision.action}`,
    `reason=${decision.reason}`,
    `suppressed=${decision.suppressedBy}`,
    `dep_rows=${String(decision.dependencyRowsFrom)}->${String(decision.dependencyRowsTo)}`,
    `symbol_rows=${String(decision.symbolRowsFrom)}->${String(decision.symbolRowsTo)}`,
    `entries=${String(decision.evidenceEntries)}`,
    `quality_entries=${String(decision.evidenceQualityEntries)}`,
    `persistent_entries=${String(decision.evidencePersistentEntries)}`,
    `hold=${String(decision.stateBefore.holdTurnsRemaining)}->${String(decision.stateAfter.holdTurnsRemaining)}`,
    `direction=${decision.stateBefore.lastDirection}->${decision.stateAfter.lastDirection}`,
    `downshift_warmup=${String(decision.stateBefore.downshiftWarmupStreak)}->${String(decision.stateAfter.downshiftWarmupStreak)}`,
    `dep_depth=${formatOptionalMetric(metrics.dependencyDepth)}`,
    `dep_multi_hop=${formatOptionalMetric(metrics.dependencyMultiHopRate)}`,
    `symbol_bridge=${formatOptionalMetric(metrics.symbolBridgeCoverageRate)}`,
    `symbol_breadth=${formatOptionalMetric(metrics.symbolBreadthCoverageRate)}`,
    `pressure_utilization=${formatOptionalMetric(metrics.pressureUtilization)}`,
    `pressure_auto_limit=${formatOptionalMetric(metrics.pressureAutoLimitRate)}`,
    `pressure_semantic=${formatOptionalMetric(metrics.pressureSemanticRate)}`,
    `cache_guard=${metrics.graphCacheDegraded ? "degraded" : "ok"}:${metrics.graphCacheReason}`,
    `cache_query_hit_rate=${formatOptionalMetric(metrics.graphCacheQueryHitRate)}`,
    `persistent_guard=${metrics.persistentDegraded ? "degraded" : "ok"}:${metrics.persistentReason}`,
    `persistent_rates=${formatOptionalMetric(metrics.persistentParsedPerScanned)}/${formatOptionalMetric(metrics.persistentReusedPerScanned)}/${formatOptionalMetric(metrics.persistentRemovedPerScanned)}`,
    `graph_signal_state=${decision.graphQualitySignals.state}`,
    `graph_signal_reason=${decision.graphQualitySignals.reason}`,
    `adaptive_threshold_source=${metrics.adaptiveSource}`,
    `adaptive_updated=${metrics.adaptiveUpdated ? "true" : "false"}`,
    `adaptive_alpha=${metrics.adaptiveAlpha.toFixed(3)}`,
    `adaptive_updates=${String(metrics.adaptiveUpdates)}`,
    `adaptive_thresholds=${metrics.adaptiveCacheThreshold.toFixed(3)}/${metrics.adaptiveParsedMaxThreshold.toFixed(3)}/${metrics.adaptiveReusedMinThreshold.toFixed(3)}/${metrics.adaptiveRemovedMaxThreshold.toFixed(3)}`,
    `adaptive_action_source=${metrics.adaptiveActionSource}`,
    `adaptive_action_updated=${metrics.adaptiveActionUpdated ? "true" : "false"}`,
    `adaptive_action_scale=${metrics.adaptiveActionScale.toFixed(3)}`,
    `adaptive_action_updates=${String(metrics.adaptiveActionUpdates)}`,
  ].join(" ") + "\n";
}
