import type { RuntimeEvent } from "../../../models/types";
import type { RuntimeToolEventSummary } from "./contract";
import { emptySummary, increment } from "./counters";
import {
  normalizeRecoveryHint,
  normalizeTurnFailedRuntimeEnvironmentRecovery,
} from "./normalize";
import { payloadNumber, payloadString } from "./payload";

export function summarizeRuntimeToolEvents(events: readonly RuntimeEvent[]): RuntimeToolEventSummary {
  const summary = emptySummary();
  for (const event of events) {
    const payload = event.payload;
    if (event.eventType === "tool_end") {
      const toolName = payloadString(payload, "tool_name") || "unknown_tool";
      const status = payloadString(payload, "status");
      const durationMs = payloadNumber(payload, "duration_ms");
      summary.callsTotal += 1;
      increment(summary.callsByTool, toolName);
      if (status === "failed") {
        summary.failedTotal += 1;
      }
      if (status === "deferred") {
        summary.deferredTotal += 1;
      }
      const errorClass = payloadString(payload, "error_class");
      if (errorClass) {
        increment(summary.failuresByErrorClass, errorClass);
      }
      if (typeof durationMs === "number") {
        increment(summary.durationTotalMsByTool, toolName, durationMs);
        increment(summary.durationCountByTool, toolName);
      }
    } else if (event.eventType === "tool_recovery") {
      const recovery = normalizeRecoveryHint(payload);
      if (recovery) {
        increment(summary.recoveryStages, recovery.stage);
        summary.latestRecovery = recovery;
      }
    } else if (event.eventType === "turn_failed" && !summary.latestRecovery) {
      const recovery = normalizeTurnFailedRuntimeEnvironmentRecovery(payload);
      if (recovery) {
        increment(summary.failuresByErrorClass, recovery.errorClass ?? recovery.reason);
        increment(summary.recoveryStages, recovery.stage);
        summary.latestRecovery = recovery;
      }
    }
  }
  return summary;
}
