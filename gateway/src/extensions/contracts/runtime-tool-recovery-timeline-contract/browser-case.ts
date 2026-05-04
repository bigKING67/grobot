import {
  buildRuntimeToolRecoveryHealthSummary,
  buildRuntimeToolRecoveryTimeline,
} from "../../../tools/runtime/tool-recovery-timeline";
import { buildRuntimeToolRecoveryDecision } from "../../../tools/runtime/tool-recovery-decision";
import {
  buildRuntimeToolRecoveryReadinessSummary,
  formatRuntimeToolRecoveryReadinessFields,
} from "../../../tools/runtime/tool-recovery-readiness";
import { formatRuntimeToolRecoveryGateFields } from "../../../tools/runtime/tool-recovery-readiness-gate";
import { expect, expectEqual } from "./assertions";
import {
  browserFeedback,
  browserMetrics,
  emptyAdaptationSnapshot,
  latestObservedAt,
} from "./fixtures";

export function runBrowserRecoveryCase() {
  const browserTimeline = buildRuntimeToolRecoveryTimeline({
    metrics: browserMetrics,
    adaptationSnapshot: emptyAdaptationSnapshot,
    recoveryFeedback: browserFeedback,
  });
  const browserHealth = buildRuntimeToolRecoveryHealthSummary({
    timeline: browserTimeline,
    nowMs: Date.parse(latestObservedAt) + 2_000,
  });
  const browserReadiness = buildRuntimeToolRecoveryReadinessSummary({
    health: browserHealth,
  });
  const browserDecision = buildRuntimeToolRecoveryDecision({
    metrics: browserMetrics,
    adaptationSnapshot: emptyAdaptationSnapshot,
    nowMs: Date.parse(latestObservedAt) + 2_000,
  });
  expectEqual(
    browserTimeline[0].browserEnvironmentRecovery?.errorCode,
    "NO_EXTENSION",
    "browser timeline exposes environment error code",
  );
  expectEqual(
    browserTimeline[0].browserEnvironmentRecovery?.action,
    "setup_and_doctor",
    "browser timeline exposes environment action",
  );
  expectEqual(
    browserTimeline[0].browserEnvironmentRecovery?.retryAllowed,
    false,
    "browser timeline blocks retry",
  );
  expectEqual(
    browserHealth.attentionBrowserEnvironmentRecovery?.errorCode,
    "NO_EXTENSION",
    "browser health exposes environment error code",
  );
  expectEqual(
    browserReadiness.attentionBrowserEnvironmentRecovery?.action,
    "setup_and_doctor",
    "browser readiness exposes environment action",
  );
  expectEqual(
    browserDecision.gate.attentionBrowserEnvironmentRecovery?.commands.join("|"),
    "grobot browser setup|grobot browser doctor",
    "browser gate exposes operator commands",
  );
  expect(
    formatRuntimeToolRecoveryReadinessFields(browserReadiness)
      .includes("browser_environment_recovery=code=NO_EXTENSION action=setup_and_doctor retry_allowed=false"),
    "browser readiness formatter exposes environment recovery",
  );
  expect(
    formatRuntimeToolRecoveryGateFields(browserDecision.gate)
      .includes("commands=grobot browser setup|grobot browser doctor"),
    "browser gate formatter exposes operator commands",
  );

  return {
    browserTimeline,
    browserHealth,
    browserReadiness,
    browserDecision,
  };
}
