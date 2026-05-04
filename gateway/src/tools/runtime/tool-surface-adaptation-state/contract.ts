import type { ToolSurfaceProfile, ToolSurfaceSource } from "../../../models/types";
import type { RuntimeToolSurfaceAdaptationResult } from "../default-enabled-tools";

export type RuntimeToolSurfaceAdaptationOutcome = "recovered" | "failed" | "unknown";
export type RuntimeToolRecoveryConsumptionReason =
  | "recovered_signal_consumed"
  | "successful_tool_call_consumed"
  | "repeated_profile_failure"
  | "profile_oscillation"
  | "nonrecoverable_intervention_prompted";

export interface RuntimeToolSurfaceAdaptationRecord {
  id: string;
  fromProfile: ToolSurfaceProfile;
  appliedProfile: ToolSurfaceProfile;
  source: ToolSurfaceSource | null;
  reason: string;
  recoveryStage: string | null;
  recoveryToolName: string | null;
  recoveryErrorClass: string | null;
  recoveryObservedAt: string | null;
  startedAt: string;
  completedAt: string;
  traceId: string | null;
  callsTotal: number;
  failedTotal: number;
  deferredTotal: number;
  outcome: RuntimeToolSurfaceAdaptationOutcome;
  outcomeReason: string;
  nextFailureClass: string | null;
}

export interface RuntimeToolSurfaceAdaptationProfileOutcome {
  adaptedTotal: number;
  recoveredTotal: number;
  failedTotal: number;
  unknownTotal: number;
  recoveryRate: number | null;
}

export interface RuntimeToolRecoveryConsumptionRecord {
  id: string;
  reason: RuntimeToolRecoveryConsumptionReason;
  recoveryStage: string | null;
  recoveryToolName: string | null;
  recoveryErrorClass: string | null;
  recoveryObservedAt: string | null;
  consumedAt: string;
  traceId: string | null;
}

export interface RuntimeToolSurfaceAdaptationGuard {
  active: boolean;
  reason: string;
  blockedProfile: ToolSurfaceProfile | null;
  matchingFailureCount: number;
  recentProfileSequence: ToolSurfaceProfile[];
}

export interface RuntimeToolSurfaceAdaptationSnapshot {
  version: 1;
  updatedAt: string | null;
  path: string;
  recentAdaptations: RuntimeToolSurfaceAdaptationRecord[];
  latestAdaptation: RuntimeToolSurfaceAdaptationRecord | null;
  profileOutcomes: Record<string, RuntimeToolSurfaceAdaptationProfileOutcome>;
  recentRecoveryConsumptions: RuntimeToolRecoveryConsumptionRecord[];
  latestRecoveryConsumption: RuntimeToolRecoveryConsumptionRecord | null;
}

export interface RuntimeToolSurfaceAdaptationState {
  version: 1;
  updatedAt: string;
  recentAdaptations: RuntimeToolSurfaceAdaptationRecord[];
  profileOutcomes: Record<string, RuntimeToolSurfaceAdaptationProfileOutcome>;
  recentRecoveryConsumptions: RuntimeToolRecoveryConsumptionRecord[];
}

export interface RuntimeToolSurfaceAdaptationOutcomeWrite {
  recorded: boolean;
  record: RuntimeToolSurfaceAdaptationRecord | null;
  snapshot: RuntimeToolSurfaceAdaptationSnapshot;
}

export interface RuntimeToolRecoveryConsumptionWrite {
  recorded: boolean;
  record: RuntimeToolRecoveryConsumptionRecord | null;
  snapshot: RuntimeToolSurfaceAdaptationSnapshot;
}

export interface RuntimeToolRecoveryConsumptionStatus {
  consumed: boolean;
  consumedReason: RuntimeToolRecoveryConsumptionReason | null;
  consumedAt: string | null;
  matchedRecord: RuntimeToolRecoveryConsumptionRecord | null;
}

export interface RuntimeToolSurfaceAdaptationGuardedResult extends RuntimeToolSurfaceAdaptationResult {
  guard: RuntimeToolSurfaceAdaptationGuard;
}
