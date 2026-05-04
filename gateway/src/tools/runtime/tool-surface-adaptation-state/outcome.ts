import type {
  RuntimeToolSurfaceAdaptationOutcome,
  RuntimeToolSurfaceAdaptationProfileOutcome,
  RuntimeToolSurfaceAdaptationRecord,
  RuntimeToolSurfaceAdaptationState,
} from "./contract";
import { recomputeRecoveryRate } from "./normalize";
import { emptyProfileOutcome } from "./storage";

export function firstFailureClass(input: {
  latestRecoveryErrorClass?: string;
  failuresByErrorClass: Record<string, number>;
}): string | null {
  if (input.latestRecoveryErrorClass) {
    return input.latestRecoveryErrorClass;
  }
  const [first] = Object.keys(input.failuresByErrorClass).sort();
  return first ?? null;
}

export function classifyAdaptationOutcome(input: {
  callsTotal: number;
  failedTotal: number;
  deferredTotal: number;
  recoveryCount: number;
  nextFailureClass: string | null;
  verificationPass?: boolean;
}): {
  outcome: RuntimeToolSurfaceAdaptationOutcome;
  outcomeReason: string;
} {
  if (input.failedTotal > 0 || input.deferredTotal > 0 || input.recoveryCount > 0) {
    return {
      outcome: "failed",
      outcomeReason: input.nextFailureClass ? `tool_failure:${input.nextFailureClass}` : "tool_failure",
    };
  }
  if (input.callsTotal > 0 && input.verificationPass !== false) {
    return {
      outcome: "recovered",
      outcomeReason: "tool_calls_completed",
    };
  }
  if (input.callsTotal > 0 && input.verificationPass === false) {
    return {
      outcome: "unknown",
      outcomeReason: "tool_calls_completed_but_verification_failed",
    };
  }
  return {
    outcome: "unknown",
    outcomeReason: "no_tool_calls_after_adaptation",
  };
}

export function updateProfileOutcome(
  state: RuntimeToolSurfaceAdaptationState,
  record: RuntimeToolSurfaceAdaptationRecord,
): void {
  const existing = state.profileOutcomes[record.appliedProfile] ?? emptyProfileOutcome();
  const next: RuntimeToolSurfaceAdaptationProfileOutcome = {
    ...existing,
    adaptedTotal: existing.adaptedTotal + 1,
    recoveredTotal: existing.recoveredTotal + (record.outcome === "recovered" ? 1 : 0),
    failedTotal: existing.failedTotal + (record.outcome === "failed" ? 1 : 0),
    unknownTotal: existing.unknownTotal + (record.outcome === "unknown" ? 1 : 0),
  };
  state.profileOutcomes[record.appliedProfile] = recomputeRecoveryRate(next);
}
