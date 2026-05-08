import { type OptionValue } from "../cli-args";
import {
  parseExplicitRequiredIntControl,
  parseExplicitRequiredRatioControl,
} from "./option-parsing";

export interface StatusContextControls {
  contextGraphCacheWindowSize: number;
  contextGraphCacheDegradeHitRateThreshold: number;
  contextGraphCacheDegradeMinEntries: number;
  contextPersistentGraphDegradeParsedPerScannedMax: number;
  contextPersistentGraphDegradeReusedPerScannedMin: number;
  contextPersistentGraphDegradeRemovedPerScannedMax: number;
  contextPersistentGraphDegradeMinEntries: number;
  contextPersistentGraphDegradeMinScannedFiles: number;
}

export function resolveStatusContextControls(
  options: Record<string, OptionValue>,
): StatusContextControls {
  return {
    contextGraphCacheWindowSize: parseExplicitRequiredIntControl({
      options,
      key: "context-graph-cache-window-size",
      envKey: "GROBOT_CONTEXT_GRAPH_CACHE_WINDOW_SIZE",
      fallbackValue: 20,
      min: 1,
      max: 200,
    }),
    contextGraphCacheDegradeHitRateThreshold: parseExplicitRequiredRatioControl({
      options,
      key: "context-graph-cache-degrade-hit-rate",
      envKey: "GROBOT_CONTEXT_GRAPH_CACHE_DEGRADE_HIT_RATE",
      fallbackValue: 0.3,
    }),
    contextGraphCacheDegradeMinEntries: parseExplicitRequiredIntControl({
      options,
      key: "context-graph-cache-degrade-min-entries",
      envKey: "GROBOT_CONTEXT_GRAPH_CACHE_DEGRADE_MIN_ENTRIES",
      fallbackValue: 8,
      min: 1,
      max: 200,
    }),
    contextPersistentGraphDegradeParsedPerScannedMax: parseExplicitRequiredRatioControl({
      options,
      key: "context-persistent-graph-degrade-parsed-rate",
      envKey: "GROBOT_CONTEXT_PERSISTENT_GRAPH_DEGRADE_PARSED_RATE",
      fallbackValue: 0.35,
    }),
    contextPersistentGraphDegradeReusedPerScannedMin: parseExplicitRequiredRatioControl({
      options,
      key: "context-persistent-graph-degrade-reused-rate",
      envKey: "GROBOT_CONTEXT_PERSISTENT_GRAPH_DEGRADE_REUSED_RATE",
      fallbackValue: 0.55,
    }),
    contextPersistentGraphDegradeRemovedPerScannedMax: parseExplicitRequiredRatioControl({
      options,
      key: "context-persistent-graph-degrade-removed-rate",
      envKey: "GROBOT_CONTEXT_PERSISTENT_GRAPH_DEGRADE_REMOVED_RATE",
      fallbackValue: 0.2,
    }),
    contextPersistentGraphDegradeMinEntries: parseExplicitRequiredIntControl({
      options,
      key: "context-persistent-graph-degrade-min-entries",
      envKey: "GROBOT_CONTEXT_PERSISTENT_GRAPH_DEGRADE_MIN_ENTRIES",
      fallbackValue: 8,
      min: 1,
      max: 200,
    }),
    contextPersistentGraphDegradeMinScannedFiles: parseExplicitRequiredIntControl({
      options,
      key: "context-persistent-graph-degrade-min-scanned-files",
      envKey: "GROBOT_CONTEXT_PERSISTENT_GRAPH_DEGRADE_MIN_SCANNED_FILES",
      fallbackValue: 40,
      min: 1,
      max: 200_000,
    }),
  };
}
