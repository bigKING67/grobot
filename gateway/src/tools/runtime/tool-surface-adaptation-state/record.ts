import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RuntimeEvent } from "../../../models/types";
import type { RuntimeToolSurfaceAdaptation } from "../default-enabled-tools";
import {
  clearRuntimeToolRecoveryRepeatPressure,
  summarizeRuntimeToolEvents,
} from "../tool-events";
import { RUNTIME_TOOL_RECOVERY_POLICY } from "../tool-recovery-policy";
import { appendRecoveryConsumption } from "./consumption";
import type {
  RuntimeToolRecoveryConsumptionRecord,
  RuntimeToolSurfaceAdaptationOutcomeWrite,
  RuntimeToolSurfaceAdaptationRecord,
} from "./contract";
import { firstFailureClass, classifyAdaptationOutcome, updateProfileOutcome } from "./outcome";
import {
  adaptationStatePathForWorkDir,
  readState,
  toSnapshot,
} from "./storage";

export function recordRuntimeToolSurfaceAdaptationOutcome(input: {
  workDir: string;
  adaptation: RuntimeToolSurfaceAdaptation;
  events: readonly RuntimeEvent[];
  verificationPass?: boolean;
  traceId?: string;
  startedAtIso?: string;
  recoveryObservedAt?: string | null;
  nowIso?: string;
}): RuntimeToolSurfaceAdaptationOutcomeWrite {
  const path = adaptationStatePathForWorkDir(input.workDir);
  const state = readState(path);
  if (!input.adaptation.active) {
    return {
      recorded: false,
      record: null,
      snapshot: toSnapshot(path, state),
    };
  }
  const nowIso = input.nowIso ?? new Date().toISOString();
  const summary = summarizeRuntimeToolEvents(input.events);
  const recoveryCount = Object.values(summary.recoveryStages)
    .reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
  const nextFailureClass = firstFailureClass({
    latestRecoveryErrorClass: summary.latestRecovery?.errorClass,
    failuresByErrorClass: summary.failuresByErrorClass,
  });
  const outcome = classifyAdaptationOutcome({
    callsTotal: summary.callsTotal,
    failedTotal: summary.failedTotal,
    deferredTotal: summary.deferredTotal,
    recoveryCount,
    nextFailureClass,
    verificationPass: input.verificationPass,
  });
  const traceId = input.traceId
    ?? input.events.find((event) => typeof event.traceId === "string" && event.traceId.trim().length > 0)?.traceId
    ?? null;
  const record: RuntimeToolSurfaceAdaptationRecord = {
    id: `tsa_${Date.now().toString(36)}_${state.recentAdaptations.length.toString(36)}`,
    fromProfile: input.adaptation.fromProfile,
    appliedProfile: input.adaptation.appliedProfile,
    source: input.adaptation.source,
    reason: input.adaptation.reason,
    recoveryStage: input.adaptation.recoveryStage,
    recoveryToolName: input.adaptation.recoveryToolName,
    recoveryErrorClass: input.adaptation.recoveryErrorClass,
    recoveryObservedAt: input.recoveryObservedAt ?? input.adaptation.recoveryObservedAt ?? null,
    startedAt: input.startedAtIso ?? input.events[0]?.timestampIso ?? nowIso,
    completedAt: nowIso,
    traceId,
    callsTotal: summary.callsTotal,
    failedTotal: summary.failedTotal,
    deferredTotal: summary.deferredTotal,
    outcome: outcome.outcome,
    outcomeReason: outcome.outcomeReason,
    nextFailureClass,
  };
  state.updatedAt = nowIso;
  state.recentAdaptations.push(record);
  state.recentAdaptations = state.recentAdaptations.slice(
    -1 * RUNTIME_TOOL_RECOVERY_POLICY.adaptationHistoryMaxEntries,
  );
  updateProfileOutcome(state, record);
  if (record.outcome === "recovered") {
    appendRecoveryConsumption(state, {
      id: `tsc_${Date.now().toString(36)}_${state.recentRecoveryConsumptions.length.toString(36)}`,
      reason: "recovered_signal_consumed",
      recoveryStage: record.recoveryStage,
      recoveryToolName: record.recoveryToolName,
      recoveryErrorClass: record.recoveryErrorClass,
      recoveryObservedAt: record.recoveryObservedAt ?? record.startedAt,
      consumedAt: nowIso,
      traceId,
    } satisfies RuntimeToolRecoveryConsumptionRecord);
    clearRuntimeToolRecoveryRepeatPressure({
      workDir: input.workDir,
      toolName: record.recoveryToolName,
      errorClass: record.recoveryErrorClass,
      nowIso,
    });
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return {
    recorded: true,
    record,
    snapshot: toSnapshot(path, state),
  };
}
