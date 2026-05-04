import type { ToolSurfaceProfile, ToolSurfaceSource } from "../../../models/types";
import { TOOL_SURFACE_PROFILES } from "../default-enabled-tools";
import type {
  RuntimeToolRecoveryConsumptionReason,
  RuntimeToolRecoveryConsumptionRecord,
  RuntimeToolSurfaceAdaptationOutcome,
  RuntimeToolSurfaceAdaptationProfileOutcome,
  RuntimeToolSurfaceAdaptationRecord,
} from "./contract";
import { parseIsoMs } from "./time";

export function normalizeRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function normalizeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizeProfile(value: unknown, fallback: ToolSurfaceProfile): ToolSurfaceProfile {
  if (typeof value !== "string") {
    return fallback;
  }
  return TOOL_SURFACE_PROFILES.includes(value as ToolSurfaceProfile)
    ? value as ToolSurfaceProfile
    : fallback;
}

export function normalizeSource(value: unknown): ToolSurfaceSource | null {
  if (typeof value !== "string") {
    return null;
  }
  const sources: readonly ToolSurfaceSource[] = [
    "auto_intent",
    "metrics_recovery",
    "env",
    "cli",
    "config",
    "debug",
    "fallback",
  ];
  return sources.includes(value as ToolSurfaceSource) ? value as ToolSurfaceSource : null;
}

export function normalizeOutcome(value: unknown): RuntimeToolSurfaceAdaptationOutcome {
  return value === "recovered" || value === "failed" || value === "unknown"
    ? value
    : "unknown";
}

export function normalizeConsumptionReason(value: unknown): RuntimeToolRecoveryConsumptionReason | undefined {
  return value === "recovered_signal_consumed"
    || value === "successful_tool_call_consumed"
    || value === "repeated_profile_failure"
    || value === "profile_oscillation"
    || value === "nonrecoverable_intervention_prompted"
    ? value
    : undefined;
}

export function toConsumptionReason(reason: string): RuntimeToolRecoveryConsumptionReason | undefined {
  return normalizeConsumptionReason(reason);
}

export function recomputeRecoveryRate(
  outcome: RuntimeToolSurfaceAdaptationProfileOutcome,
): RuntimeToolSurfaceAdaptationProfileOutcome {
  const denominator = outcome.recoveredTotal + outcome.failedTotal;
  return {
    ...outcome,
    recoveryRate: denominator > 0 ? Number((outcome.recoveredTotal / denominator).toFixed(4)) : null,
  };
}

export function normalizeProfileOutcome(value: unknown): RuntimeToolSurfaceAdaptationProfileOutcome {
  const row = normalizeRecord(value);
  return recomputeRecoveryRate({
    adaptedTotal: normalizeNumber(row.adaptedTotal),
    recoveredTotal: normalizeNumber(row.recoveredTotal),
    failedTotal: normalizeNumber(row.failedTotal),
    unknownTotal: normalizeNumber(row.unknownTotal),
    recoveryRate: null,
  });
}

export function normalizeAdaptationRecord(value: unknown): RuntimeToolSurfaceAdaptationRecord | undefined {
  const row = normalizeRecord(value);
  const id = normalizeString(row.id);
  if (!id) {
    return undefined;
  }
  return {
    id,
    fromProfile: normalizeProfile(row.fromProfile, "coding"),
    appliedProfile: normalizeProfile(row.appliedProfile, "coding"),
    source: normalizeSource(row.source),
    reason: normalizeString(row.reason) ?? "unknown",
    recoveryStage: normalizeString(row.recoveryStage) ?? null,
    recoveryToolName: normalizeString(row.recoveryToolName) ?? null,
    recoveryErrorClass: normalizeString(row.recoveryErrorClass) ?? null,
    recoveryObservedAt: normalizeString(row.recoveryObservedAt) ?? null,
    startedAt: normalizeString(row.startedAt) ?? "",
    completedAt: normalizeString(row.completedAt) ?? "",
    traceId: normalizeString(row.traceId) ?? null,
    callsTotal: normalizeNumber(row.callsTotal),
    failedTotal: normalizeNumber(row.failedTotal),
    deferredTotal: normalizeNumber(row.deferredTotal),
    outcome: normalizeOutcome(row.outcome),
    outcomeReason: normalizeString(row.outcomeReason) ?? "unknown",
    nextFailureClass: normalizeString(row.nextFailureClass) ?? null,
  };
}

export function normalizeConsumptionRecord(value: unknown): RuntimeToolRecoveryConsumptionRecord | undefined {
  const row = normalizeRecord(value);
  const id = normalizeString(row.id);
  const reason = normalizeConsumptionReason(row.reason);
  const consumedAt = normalizeString(row.consumedAt);
  if (!id || !reason || !consumedAt || typeof parseIsoMs(consumedAt) !== "number") {
    return undefined;
  }
  return {
    id,
    reason,
    recoveryStage: normalizeString(row.recoveryStage) ?? null,
    recoveryToolName: normalizeString(row.recoveryToolName) ?? null,
    recoveryErrorClass: normalizeString(row.recoveryErrorClass) ?? null,
    recoveryObservedAt: normalizeString(row.recoveryObservedAt) ?? null,
    consumedAt,
    traceId: normalizeString(row.traceId) ?? null,
  };
}
