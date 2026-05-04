import {
  buildRuntimeToolRecoveryHealthSummary,
  buildRuntimeToolRecoveryTimeline,
} from "../../../tools/runtime/tool-recovery-timeline";
import type { RuntimeToolSurfaceMetricsSnapshot } from "../../../tools/runtime/tool-events";
import { expectEqual } from "./assertions";
import {
  activeFeedback,
  emptyAdaptationSnapshot,
  latestObservedAt,
  metrics,
} from "./fixtures";

export function runLegacyActionCase() {
  const legacyActionMetrics: RuntimeToolSurfaceMetricsSnapshot = {
    ...metrics,
    updatedAt: latestObservedAt,
    callsByTool: { read: 1 },
    failuresByErrorClass: { legacy_runtime_error: 1 },
    recoveryStages: { strategy_switch: 1 },
    recoveryCountsByKey: {
      "tool_error:read:legacy_runtime_error": 1,
    },
    latestRecoveryRepeatKey: "tool_error:read:legacy_runtime_error",
    latestRecoveryRepeatCount: 1,
    recentRecoveries: [
      {
        stage: "strategy_switch",
        reason: "legacy_runtime_error",
        recommendedNextAction: "observe_and_continue",
        toolName: "read",
        errorClass: "legacy_runtime_error",
        recoverable: true,
        observedAt: latestObservedAt,
      },
    ],
    latestRecovery: {
      stage: "strategy_switch",
      reason: "legacy_runtime_error",
      recommendedNextAction: "observe_and_continue",
      toolName: "read",
      errorClass: "legacy_runtime_error",
      recoverable: true,
      observedAt: latestObservedAt,
    },
  };
  const legacyActionTimeline = buildRuntimeToolRecoveryTimeline({
    metrics: legacyActionMetrics,
    adaptationSnapshot: emptyAdaptationSnapshot,
    recoveryFeedback: activeFeedback,
  });
  expectEqual(
    legacyActionTimeline[0].rawRecommendedNextAction,
    "observe_and_continue",
    "legacy timeline preserves raw action for evidence",
  );
  expectEqual(
    legacyActionTimeline[0].effectiveRecommendedNextAction,
    "inspect_error_and_switch_strategy",
    "legacy timeline normalizes effective action",
  );
  expectEqual(
    legacyActionTimeline[0].recommendedNextAction,
    "inspect_error_and_switch_strategy",
    "legacy timeline public action uses cataloged effective action",
  );
  expectEqual(
    legacyActionTimeline[0].recommendedActionFamily,
    "strategy_switch",
    "legacy timeline classifies effective action",
  );
  const legacyActionHealth = buildRuntimeToolRecoveryHealthSummary({
    timeline: legacyActionTimeline,
    nowMs: Date.parse(latestObservedAt) + 1_000,
  });
  expectEqual(
    legacyActionHealth.rawRecommendedNextAction,
    "observe_and_continue",
    "legacy health preserves raw attention action",
  );
  expectEqual(
    legacyActionHealth.effectiveRecommendedNextAction,
    "inspect_error_and_switch_strategy",
    "legacy health exposes effective attention action",
  );
  expectEqual(
    legacyActionHealth.recommendedNextAction,
    "inspect_error_and_switch_strategy",
    "legacy health recommended action stays cataloged",
  );
  expectEqual(
    legacyActionHealth.latestRawRecommendedNextAction,
    "observe_and_continue",
    "legacy health preserves raw latest action",
  );
  expectEqual(
    legacyActionHealth.latestEffectiveRecommendedNextAction,
    "inspect_error_and_switch_strategy",
    "legacy health exposes effective latest action",
  );

  return {
    legacyActionTimeline,
    legacyActionHealth,
  };
}
