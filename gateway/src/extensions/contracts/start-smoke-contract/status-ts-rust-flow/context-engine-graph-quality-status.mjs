export function collectContextEngineGraphQualityStatusSurface({
  contextEngine,
  isObject,
}) {
  const contextEngineGraphQualitySignals = isObject(contextEngine?.graph_quality_signals)
    ? contextEngine.graph_quality_signals
    : null;
  const contextEngineGraphQualitySignalsCombined = isObject(contextEngineGraphQualitySignals?.combined)
    ? contextEngineGraphQualitySignals.combined
    : null;
  const contextEngineGraphQualitySignalsCombinedDegradedSources = Array.isArray(
    contextEngineGraphQualitySignalsCombined?.degraded_sources,
  )
    ? contextEngineGraphQualitySignalsCombined.degraded_sources
    : null;
  const contextEngineLineage = isObject(contextEngine?.lineage)
    ? contextEngine.lineage
    : null;
  const contextEngineWorkspaceSignals = isObject(contextEngine?.workspace_signals)
    ? contextEngine.workspace_signals
    : null;
  return {
    status_context_engine_lineage_enabled_type: typeof contextEngineLineage?.enabled,
    status_context_engine_lineage_persistence_domain_type:
      typeof contextEngineLineage?.persistence_domain,
    status_context_engine_lineage_persistence_domain_value:
      typeof contextEngineLineage?.persistence_domain === "string"
        ? contextEngineLineage.persistence_domain
        : null,
    status_context_engine_workspace_signals_enabled_type: typeof contextEngineWorkspaceSignals?.enabled,
    status_context_engine_has_graph_quality_signals: Boolean(contextEngineGraphQualitySignals),
    status_context_engine_graph_quality_combined_state_type:
      typeof contextEngineGraphQualitySignalsCombined?.state,
    status_context_engine_graph_quality_combined_reason_type:
      typeof contextEngineGraphQualitySignalsCombined?.reason,
    status_context_engine_graph_quality_combined_recommended_action_type:
      typeof contextEngineGraphQualitySignalsCombined?.recommended_action,
    status_context_engine_graph_quality_combined_degraded_sources_type:
      Array.isArray(contextEngineGraphQualitySignalsCombinedDegradedSources)
        ? "array"
        : typeof contextEngineGraphQualitySignalsCombinedDegradedSources,
  };
}
