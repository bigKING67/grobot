import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RuntimeEvent } from "../../../models/types";
import {
  clearRuntimeToolRecoveryRepeatPressure,
  summarizeRuntimeToolEvents,
  type RuntimeToolRecoveryFeedback,
} from "../tool-events";
import { RUNTIME_TOOL_RECOVERY_POLICY } from "../tool-recovery-policy";
import type {
  RuntimeToolRecoveryConsumptionRecord,
  RuntimeToolRecoveryConsumptionStatus,
  RuntimeToolRecoveryConsumptionWrite,
  RuntimeToolSurfaceAdaptationGuard,
  RuntimeToolSurfaceAdaptationSnapshot,
  RuntimeToolSurfaceAdaptationState,
} from "./contract";
import { recoveryConsumptionKey } from "./keys";
import { normalizeString, toConsumptionReason } from "./normalize";
import {
  adaptationStatePathForWorkDir,
  readState,
  toSnapshot,
} from "./storage";
import { parseIsoMs } from "./time";

export function appendRecoveryConsumption(
  state: RuntimeToolSurfaceAdaptationState,
  record: RuntimeToolRecoveryConsumptionRecord,
): boolean {
  const latest = state.recentRecoveryConsumptions[state.recentRecoveryConsumptions.length - 1];
  if (
    latest
    && latest.reason === record.reason
    && latest.recoveryObservedAt === record.recoveryObservedAt
    && recoveryConsumptionKey(latest) === recoveryConsumptionKey(record)
  ) {
    return false;
  }
  state.recentRecoveryConsumptions.push(record);
  state.recentRecoveryConsumptions = state.recentRecoveryConsumptions.slice(
    -1 * RUNTIME_TOOL_RECOVERY_POLICY.recoveryConsumptionHistoryMaxEntries,
  );
  return true;
}

function persistConsumptionState(input: {
  path: string;
  workDir: string;
  state: RuntimeToolSurfaceAdaptationState;
  record: RuntimeToolRecoveryConsumptionRecord;
  toolName: string | null;
  errorClass: string | null;
  nowIso: string;
}): RuntimeToolRecoveryConsumptionWrite {
  mkdirSync(dirname(input.path), { recursive: true });
  writeFileSync(input.path, `${JSON.stringify(input.state, null, 2)}\n`, "utf8");
  clearRuntimeToolRecoveryRepeatPressure({
    workDir: input.workDir,
    toolName: input.toolName,
    errorClass: input.errorClass,
    nowIso: input.nowIso,
  });
  return {
    recorded: true,
    record: input.record,
    snapshot: toSnapshot(input.path, input.state),
  };
}

export function recordRuntimeToolSurfaceRecoveryConsumption(input: {
  workDir: string;
  guard: RuntimeToolSurfaceAdaptationGuard;
  recoveryFeedback: RuntimeToolRecoveryFeedback;
  traceId?: string;
  nowIso?: string;
}): RuntimeToolRecoveryConsumptionWrite {
  const path = adaptationStatePathForWorkDir(input.workDir);
  const state = readState(path);
  const reason = toConsumptionReason(input.guard.reason);
  if (!input.guard.active || !input.recoveryFeedback.active || !reason) {
    return {
      recorded: false,
      record: null,
      snapshot: toSnapshot(path, state),
    };
  }
  const nowIso = input.nowIso ?? new Date().toISOString();
  const record: RuntimeToolRecoveryConsumptionRecord = {
    id: `tsc_${Date.now().toString(36)}_${state.recentRecoveryConsumptions.length.toString(36)}`,
    reason,
    recoveryStage: input.recoveryFeedback.stage,
    recoveryToolName: input.recoveryFeedback.toolName,
    recoveryErrorClass: input.recoveryFeedback.errorClass,
    recoveryObservedAt: input.recoveryFeedback.observedAt ?? null,
    consumedAt: nowIso,
    traceId: input.traceId ?? null,
  };
  const recorded = appendRecoveryConsumption(state, record);
  if (!recorded) {
    return {
      recorded: false,
      record: null,
      snapshot: toSnapshot(path, state),
    };
  }
  state.updatedAt = nowIso;
  return persistConsumptionState({
    path,
    workDir: input.workDir,
    state,
    record,
    toolName: input.recoveryFeedback.toolName,
    errorClass: input.recoveryFeedback.errorClass,
    nowIso,
  });
}

export function recordRuntimeToolNonRecoverableInterventionPrompt(input: {
  workDir: string;
  recoveryFeedback: RuntimeToolRecoveryFeedback;
  traceId?: string;
  nowIso?: string;
}): RuntimeToolRecoveryConsumptionWrite {
  const path = adaptationStatePathForWorkDir(input.workDir);
  const state = readState(path);
  if (!input.recoveryFeedback.active || input.recoveryFeedback.recoverable !== false) {
    return {
      recorded: false,
      record: null,
      snapshot: toSnapshot(path, state),
    };
  }
  const nowIso = input.nowIso ?? new Date().toISOString();
  const record: RuntimeToolRecoveryConsumptionRecord = {
    id: `tsc_${Date.now().toString(36)}_${state.recentRecoveryConsumptions.length.toString(36)}`,
    reason: "nonrecoverable_intervention_prompted",
    recoveryStage: input.recoveryFeedback.stage,
    recoveryToolName: input.recoveryFeedback.toolName,
    recoveryErrorClass: input.recoveryFeedback.errorClass,
    recoveryObservedAt: input.recoveryFeedback.observedAt ?? null,
    consumedAt: nowIso,
    traceId: input.traceId ?? null,
  };
  const recorded = appendRecoveryConsumption(state, record);
  if (!recorded) {
    return {
      recorded: false,
      record: null,
      snapshot: toSnapshot(path, state),
    };
  }
  state.updatedAt = nowIso;
  return persistConsumptionState({
    path,
    workDir: input.workDir,
    state,
    record,
    toolName: input.recoveryFeedback.toolName,
    errorClass: input.recoveryFeedback.errorClass,
    nowIso,
  });
}

function payloadString(payload: Record<string, unknown>, key: string): string | undefined {
  return normalizeString(payload[key]);
}

function successfulToolNames(events: readonly RuntimeEvent[]): string[] {
  return events
    .filter((event) => event.eventType === "tool_end")
    .map((event) => {
      const status = payloadString(event.payload, "status");
      if (status !== "ok") {
        return "";
      }
      return payloadString(event.payload, "tool_name") ?? "";
    })
    .filter((toolName) => toolName.length > 0);
}

function shouldConsumeRecoveryAfterSuccessfulTools(input: {
  recoveryFeedback: RuntimeToolRecoveryFeedback;
  events: readonly RuntimeEvent[];
  verificationPass?: boolean;
}): boolean {
  if (
    !input.recoveryFeedback.active
    || input.recoveryFeedback.consumed
    || input.recoveryFeedback.requiresUserIntervention
    || input.recoveryFeedback.recoverable === false
  ) {
    return false;
  }
  if (typeof parseIsoMs(input.recoveryFeedback.observedAt) !== "number") {
    return false;
  }
  if (input.verificationPass === false) {
    return false;
  }
  const summary = summarizeRuntimeToolEvents(input.events);
  if (
    summary.callsTotal === 0
    || summary.failedTotal > 0
    || summary.deferredTotal > 0
    || summary.latestRecovery
  ) {
    return false;
  }
  const okTools = successfulToolNames(input.events);
  if (okTools.length === 0) {
    return false;
  }
  const recoveryToolName = input.recoveryFeedback.toolName?.trim() ?? "";
  if (!recoveryToolName || recoveryToolName === "unknown_tool") {
    return true;
  }
  if (okTools.includes(recoveryToolName)) {
    return true;
  }
  return input.recoveryFeedback.stage === "strategy_switch";
}

export function recordRuntimeToolSuccessfulRecoveryConsumption(input: {
  workDir: string;
  recoveryFeedback: RuntimeToolRecoveryFeedback;
  events: readonly RuntimeEvent[];
  verificationPass?: boolean;
  traceId?: string;
  nowIso?: string;
}): RuntimeToolRecoveryConsumptionWrite {
  const path = adaptationStatePathForWorkDir(input.workDir);
  const state = readState(path);
  if (!shouldConsumeRecoveryAfterSuccessfulTools(input)) {
    return {
      recorded: false,
      record: null,
      snapshot: toSnapshot(path, state),
    };
  }
  const nowIso = input.nowIso ?? new Date().toISOString();
  const record: RuntimeToolRecoveryConsumptionRecord = {
    id: `tsc_${Date.now().toString(36)}_${state.recentRecoveryConsumptions.length.toString(36)}`,
    reason: "successful_tool_call_consumed",
    recoveryStage: input.recoveryFeedback.stage,
    recoveryToolName: input.recoveryFeedback.toolName,
    recoveryErrorClass: input.recoveryFeedback.errorClass,
    recoveryObservedAt: input.recoveryFeedback.observedAt ?? null,
    consumedAt: nowIso,
    traceId: input.traceId ?? null,
  };
  const recorded = appendRecoveryConsumption(state, record);
  if (!recorded) {
    return {
      recorded: false,
      record: null,
      snapshot: toSnapshot(path, state),
    };
  }
  state.updatedAt = nowIso;
  return persistConsumptionState({
    path,
    workDir: input.workDir,
    state,
    record,
    toolName: input.recoveryFeedback.toolName,
    errorClass: input.recoveryFeedback.errorClass,
    nowIso,
  });
}

export function applyRuntimeToolRecoveryConsumption(input: {
  feedback: RuntimeToolRecoveryFeedback;
  snapshot: RuntimeToolSurfaceAdaptationSnapshot;
}): RuntimeToolRecoveryFeedback {
  if (!input.feedback.active) {
    return input.feedback;
  }
  const consumption = resolveRuntimeToolRecoveryConsumption({
    snapshot: input.snapshot,
    recoveryStage: input.feedback.stage,
    recoveryToolName: input.feedback.toolName,
    recoveryErrorClass: input.feedback.errorClass,
    recoveryObservedAt: input.feedback.observedAt ?? null,
  });
  if (!consumption.consumed) {
    return {
      ...input.feedback,
      consumed: false,
      consumedReason: null,
      consumedAt: null,
      browserEnvironmentRecovery: input.feedback.browserEnvironmentRecovery ?? null,
      mcpEnvironmentRecovery: input.feedback.mcpEnvironmentRecovery ?? null,
    };
  }
  return {
    ...input.feedback,
    active: false,
    severity: "none",
    reason: `consumed_${consumption.consumedReason}`,
    promptBlock: "",
    consumed: true,
    consumedReason: consumption.consumedReason,
    consumedAt: consumption.consumedAt,
    browserEnvironmentRecovery: input.feedback.browserEnvironmentRecovery ?? null,
    mcpEnvironmentRecovery: input.feedback.mcpEnvironmentRecovery ?? null,
  };
}

export function resolveRuntimeToolRecoveryConsumption(input: {
  snapshot: RuntimeToolSurfaceAdaptationSnapshot;
  recoveryStage: string | null;
  recoveryToolName: string | null;
  recoveryErrorClass: string | null;
  recoveryObservedAt: string | null;
}): RuntimeToolRecoveryConsumptionStatus {
  const observedAtMs = parseIsoMs(input.recoveryObservedAt);
  if (typeof observedAtMs !== "number") {
    return {
      consumed: false,
      consumedReason: null,
      consumedAt: null,
      matchedRecord: null,
    };
  }
  const candidateKey = recoveryConsumptionKey({
    recoveryStage: input.recoveryStage,
    recoveryToolName: input.recoveryToolName,
    recoveryErrorClass: input.recoveryErrorClass,
  });
  const matchedRecord = [...input.snapshot.recentRecoveryConsumptions]
    .reverse()
    .find((record) => {
      if (recoveryConsumptionKey(record) !== candidateKey) {
        return false;
      }
      const consumedAtMs = parseIsoMs(record.consumedAt);
      return typeof consumedAtMs === "number" && consumedAtMs >= observedAtMs;
    }) ?? null;
  return {
    consumed: matchedRecord !== null,
    consumedReason: matchedRecord?.reason ?? null,
    consumedAt: matchedRecord?.consumedAt ?? null,
    matchedRecord,
  };
}
