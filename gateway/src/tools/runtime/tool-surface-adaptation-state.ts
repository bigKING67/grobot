import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { RuntimeEvent, ToolSurfaceProfile, ToolSurfaceSource } from "../../models/types";
import {
  TOOL_SURFACE_PROFILES,
  type RuntimeToolSurfaceAdaptation,
  type RuntimeToolSurfaceAdaptationResult,
} from "./default-enabled-tools";
import { RUNTIME_TOOL_RECOVERY_POLICY } from "./tool-recovery-policy";
import {
  clearRuntimeToolRecoveryRepeatPressure,
  summarizeRuntimeToolEvents,
  type RuntimeToolRecoveryFeedback,
} from "./tool-events";

export type RuntimeToolSurfaceAdaptationOutcome = "recovered" | "failed" | "unknown";
export type RuntimeToolRecoveryConsumptionReason =
  | "recovered_signal_consumed"
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

interface RuntimeToolSurfaceAdaptationState {
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

function emptyProfileOutcome(): RuntimeToolSurfaceAdaptationProfileOutcome {
  return {
    adaptedTotal: 0,
    recoveredTotal: 0,
    failedTotal: 0,
    unknownTotal: 0,
    recoveryRate: null,
  };
}

function emptyState(): RuntimeToolSurfaceAdaptationState {
  return {
    version: 1,
    updatedAt: "",
    recentAdaptations: [],
    profileOutcomes: {},
    recentRecoveryConsumptions: [],
  };
}

function adaptationStatePathForWorkDir(workDir: string): string {
  return resolve(workDir, ".grobot/runtime/tool-surface-adaptation-state.json");
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeProfile(value: unknown, fallback: ToolSurfaceProfile): ToolSurfaceProfile {
  if (typeof value !== "string") {
    return fallback;
  }
  return TOOL_SURFACE_PROFILES.includes(value as ToolSurfaceProfile)
    ? value as ToolSurfaceProfile
    : fallback;
}

function normalizeSource(value: unknown): ToolSurfaceSource | null {
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

function normalizeOutcome(value: unknown): RuntimeToolSurfaceAdaptationOutcome {
  return value === "recovered" || value === "failed" || value === "unknown"
    ? value
    : "unknown";
}

function normalizeConsumptionReason(value: unknown): RuntimeToolRecoveryConsumptionReason | undefined {
  return value === "recovered_signal_consumed"
    || value === "repeated_profile_failure"
    || value === "profile_oscillation"
    || value === "nonrecoverable_intervention_prompted"
    ? value
    : undefined;
}

function recomputeRecoveryRate(outcome: RuntimeToolSurfaceAdaptationProfileOutcome): RuntimeToolSurfaceAdaptationProfileOutcome {
  const denominator = outcome.recoveredTotal + outcome.failedTotal;
  return {
    ...outcome,
    recoveryRate: denominator > 0 ? Number((outcome.recoveredTotal / denominator).toFixed(4)) : null,
  };
}

function normalizeProfileOutcome(value: unknown): RuntimeToolSurfaceAdaptationProfileOutcome {
  const row = normalizeRecord(value);
  return recomputeRecoveryRate({
    adaptedTotal: normalizeNumber(row.adaptedTotal),
    recoveredTotal: normalizeNumber(row.recoveredTotal),
    failedTotal: normalizeNumber(row.failedTotal),
    unknownTotal: normalizeNumber(row.unknownTotal),
    recoveryRate: null,
  });
}

function normalizeAdaptationRecord(value: unknown): RuntimeToolSurfaceAdaptationRecord | undefined {
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

function normalizeConsumptionRecord(value: unknown): RuntimeToolRecoveryConsumptionRecord | undefined {
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

function readState(path: string): RuntimeToolSurfaceAdaptationState {
  if (!existsSync(path)) {
    return emptyState();
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const row = normalizeRecord(parsed);
    const profileOutcomes: Record<string, RuntimeToolSurfaceAdaptationProfileOutcome> = {};
    for (const [profile, value] of Object.entries(normalizeRecord(row.profileOutcomes))) {
      profileOutcomes[profile] = normalizeProfileOutcome(value);
    }
    return {
      version: 1,
      updatedAt: normalizeString(row.updatedAt) ?? "",
      recentAdaptations: Array.isArray(row.recentAdaptations)
        ? row.recentAdaptations
            .map((item) => normalizeAdaptationRecord(item))
            .filter((item): item is RuntimeToolSurfaceAdaptationRecord => Boolean(item))
            .slice(-1 * RUNTIME_TOOL_RECOVERY_POLICY.adaptationHistoryMaxEntries)
        : [],
      profileOutcomes,
      recentRecoveryConsumptions: Array.isArray(row.recentRecoveryConsumptions)
        ? row.recentRecoveryConsumptions
            .map((item) => normalizeConsumptionRecord(item))
            .filter((item): item is RuntimeToolRecoveryConsumptionRecord => Boolean(item))
            .slice(-1 * RUNTIME_TOOL_RECOVERY_POLICY.recoveryConsumptionHistoryMaxEntries)
        : [],
    };
  } catch {
    return emptyState();
  }
}

function toSnapshot(path: string, state: RuntimeToolSurfaceAdaptationState): RuntimeToolSurfaceAdaptationSnapshot {
  return {
    version: 1,
    updatedAt: state.updatedAt || null,
    path,
    recentAdaptations: state.recentAdaptations,
    latestAdaptation: state.recentAdaptations[state.recentAdaptations.length - 1] ?? null,
    profileOutcomes: state.profileOutcomes,
    recentRecoveryConsumptions: state.recentRecoveryConsumptions,
    latestRecoveryConsumption: state.recentRecoveryConsumptions[state.recentRecoveryConsumptions.length - 1] ?? null,
  };
}

export function readRuntimeToolSurfaceAdaptationState(workDir: string): RuntimeToolSurfaceAdaptationSnapshot {
  const path = adaptationStatePathForWorkDir(workDir);
  return toSnapshot(path, readState(path));
}

function firstFailureClass(input: {
  latestRecoveryErrorClass?: string;
  failuresByErrorClass: Record<string, number>;
}): string | null {
  if (input.latestRecoveryErrorClass) {
    return input.latestRecoveryErrorClass;
  }
  const [first] = Object.keys(input.failuresByErrorClass).sort();
  return first ?? null;
}

function classifyAdaptationOutcome(input: {
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

function updateProfileOutcome(
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

function recoveryConsumptionKey(input: {
  recoveryStage: string | null;
  recoveryToolName: string | null;
  recoveryErrorClass: string | null;
}): string {
  return [
    input.recoveryStage ?? "<none>",
    input.recoveryToolName ?? "<none>",
    input.recoveryErrorClass ?? "<none>",
  ].join("|");
}

function parseIsoMs(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toConsumptionReason(reason: string): RuntimeToolRecoveryConsumptionReason | undefined {
  return reason === "recovered_signal_consumed"
    || reason === "repeated_profile_failure"
    || reason === "profile_oscillation"
    || reason === "nonrecoverable_intervention_prompted"
    ? reason
    : undefined;
}

function appendRecoveryConsumption(
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
    });
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
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  clearRuntimeToolRecoveryRepeatPressure({
    workDir: input.workDir,
    toolName: input.recoveryFeedback.toolName,
    errorClass: input.recoveryFeedback.errorClass,
    nowIso,
  });
  return {
    recorded: true,
    record,
    snapshot: toSnapshot(path, state),
  };
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
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  clearRuntimeToolRecoveryRepeatPressure({
    workDir: input.workDir,
    toolName: input.recoveryFeedback.toolName,
    errorClass: input.recoveryFeedback.errorClass,
    nowIso,
  });
  return {
    recorded: true,
    record,
    snapshot: toSnapshot(path, state),
  };
}

function adaptationGuardKey(input: {
  appliedProfile?: ToolSurfaceProfile | null;
  recoveryToolName: string | null;
  recoveryErrorClass: string | null;
}): string {
  return [
    input.appliedProfile ?? "<none>",
    input.recoveryToolName ?? "<none>",
    input.recoveryErrorClass ?? "<none>",
  ].join("|");
}

function recoveryKey(input: {
  recoveryStage: string | null;
  recoveryToolName: string | null;
  recoveryErrorClass: string | null;
}): string {
  return recoveryConsumptionKey(input);
}

function inactiveGuard(reason = "ok"): RuntimeToolSurfaceAdaptationGuard {
  return {
    active: false,
    reason,
    blockedProfile: null,
    matchingFailureCount: 0,
    recentProfileSequence: [],
  };
}

function isUnsuccessfulAdaptationOutcome(record: RuntimeToolSurfaceAdaptationRecord): boolean {
  return record.outcome === "failed" || record.outcome === "unknown";
}

function recoveredSignalStillApplies(input: {
  snapshot: RuntimeToolSurfaceAdaptationSnapshot;
  adaptation: RuntimeToolSurfaceAdaptation;
  latestAdaptation: RuntimeToolSurfaceAdaptationRecord;
}): boolean {
  const observedAtMs = parseIsoMs(input.adaptation.recoveryObservedAt);
  if (typeof observedAtMs !== "number") {
    return false;
  }
  const candidateRecoveryKey = recoveryKey(input.adaptation);
  const consumedRecord = [...input.snapshot.recentRecoveryConsumptions]
    .reverse()
    .find((record) => record.reason === "recovered_signal_consumed" && recoveryKey(record) === candidateRecoveryKey);
  const consumedAtMs = parseIsoMs(consumedRecord?.consumedAt);
  if (typeof consumedAtMs === "number") {
    return consumedAtMs >= observedAtMs;
  }
  const completedAtMs = parseIsoMs(input.latestAdaptation.completedAt);
  return typeof completedAtMs === "number" && completedAtMs >= observedAtMs;
}

export function assessRuntimeToolSurfaceAdaptationGuard(input: {
  snapshot: RuntimeToolSurfaceAdaptationSnapshot;
  adaptation: RuntimeToolSurfaceAdaptation;
}): RuntimeToolSurfaceAdaptationGuard {
  if (!input.adaptation.active) {
    return inactiveGuard("adaptation_inactive");
  }
  const candidateKey = adaptationGuardKey({
    appliedProfile: input.adaptation.appliedProfile,
    recoveryToolName: input.adaptation.recoveryToolName,
    recoveryErrorClass: input.adaptation.recoveryErrorClass,
  });
  const latestAdaptation = input.snapshot.latestAdaptation;
  if (
    latestAdaptation
    && latestAdaptation.outcome === "recovered"
    && adaptationGuardKey(latestAdaptation) === candidateKey
    && recoveredSignalStillApplies({
      snapshot: input.snapshot,
      adaptation: input.adaptation,
      latestAdaptation,
    })
  ) {
    return {
      active: true,
      reason: "recovered_signal_consumed",
      blockedProfile: input.adaptation.appliedProfile,
      matchingFailureCount: 0,
      recentProfileSequence: input.snapshot.recentAdaptations
        .slice(-1 * RUNTIME_TOOL_RECOVERY_POLICY.guard.recentProfileSequenceSize)
        .map((record) => record.appliedProfile),
    };
  }
  let matchingFailureCount = 0;
  for (const record of [...input.snapshot.recentAdaptations].reverse()) {
    const recordKey = adaptationGuardKey(record);
    if (recordKey !== candidateKey) {
      break;
    }
    if (record.outcome !== "failed") {
      break;
    }
    matchingFailureCount += 1;
  }
  if (matchingFailureCount >= RUNTIME_TOOL_RECOVERY_POLICY.guard.repeatedProfileFailureThreshold) {
    return {
      active: true,
      reason: "repeated_profile_failure",
      blockedProfile: input.adaptation.appliedProfile,
      matchingFailureCount,
      recentProfileSequence: input.snapshot.recentAdaptations
        .slice(-1 * RUNTIME_TOOL_RECOVERY_POLICY.guard.recentProfileSequenceSize)
        .map((record) => record.appliedProfile),
    };
  }

  const recentRecords = input.snapshot.recentAdaptations.slice(
    -1 * Math.max(0, RUNTIME_TOOL_RECOVERY_POLICY.guard.oscillationProfileWindowSize - 1),
  );
  const recentProfileSequence = [
    ...recentRecords.map((record) => record.appliedProfile),
    input.adaptation.appliedProfile,
  ];
  if (
    recentProfileSequence.length >= RUNTIME_TOOL_RECOVERY_POLICY.guard.oscillationProfileWindowSize
    && recentRecords.every(isUnsuccessfulAdaptationOutcome)
    && recentProfileSequence[0] === recentProfileSequence[2]
    && recentProfileSequence[1] === recentProfileSequence[3]
    && recentProfileSequence[0] !== recentProfileSequence[1]
  ) {
    return {
      active: true,
      reason: "profile_oscillation",
      blockedProfile: input.adaptation.appliedProfile,
      matchingFailureCount,
      recentProfileSequence,
    };
  }

  return {
    ...inactiveGuard("ok"),
    matchingFailureCount,
    recentProfileSequence,
  };
}

export function applyRuntimeToolSurfaceAdaptationGuard(input: {
  baseContext: RuntimeToolSurfaceAdaptationResult["context"];
  result: RuntimeToolSurfaceAdaptationResult;
  snapshot: RuntimeToolSurfaceAdaptationSnapshot;
}): RuntimeToolSurfaceAdaptationGuardedResult {
  const guard = assessRuntimeToolSurfaceAdaptationGuard({
    snapshot: input.snapshot,
    adaptation: input.result.adaptation,
  });
  if (!guard.active) {
    return {
      ...input.result,
      guard,
    };
  }
  return {
    context: input.baseContext,
    adaptation: {
      ...input.result.adaptation,
      active: false,
      reason: `guard_${guard.reason}`,
      appliedProfile: input.result.adaptation.fromProfile,
      recommendedProfile: input.result.adaptation.appliedProfile,
      source: null,
    },
    guard,
  };
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

export function buildRuntimeToolSurfaceAdaptationGuardPrompt(input: {
  guard: RuntimeToolSurfaceAdaptationGuard;
  recoveryFeedback: RuntimeToolRecoveryFeedback;
}): string {
  if (!input.guard.active || !input.recoveryFeedback.active) {
    return "";
  }
  const blockedProfile = input.guard.blockedProfile ?? "<none>";
  const recentProfiles = input.guard.recentProfileSequence.length > 0
    ? input.guard.recentProfileSequence.join(" -> ")
    : "<none>";
  const recoveryStage = input.recoveryFeedback.stage ?? "<none>";
  const recoveryTool = input.recoveryFeedback.toolName ?? "<none>";
  const recoveryErrorClass = input.recoveryFeedback.errorClass ?? "<none>";
  const recoveryAction = input.recoveryFeedback.recommendedNextAction ?? "<none>";
  const rule = (() => {
    switch (input.guard.reason) {
      case "recovered_signal_consumed":
        return "The previous recovery signal already produced a recovered adaptation. Treat that signal as consumed; do not switch tool profiles solely because of it.";
      case "repeated_profile_failure":
        return "The same tool-surface adaptation has failed repeatedly. Do not retry the same surface switch unchanged; use the currently visible tools, reduce scope, or ask the user.";
      case "profile_oscillation":
        return "Recent tool-surface adaptations oscillated without recovery. Stop alternating profiles; pick one grounded strategy from the currently visible tools.";
      default:
        return "The tool-surface adaptation was blocked by guard policy. Do not repeat the guarded recovery path unchanged.";
    }
  })();
  return [
    "[Runtime Tool Surface Guard]",
    `Guard: reason=${input.guard.reason} blocked_profile=${blockedProfile} matching_failures=${String(input.guard.matchingFailureCount)}`,
    `Suppressed recovery hint: stage=${recoveryStage} tool=${recoveryTool} error_class=${recoveryErrorClass} action=${recoveryAction}`,
    `Recent profiles: ${recentProfiles}`,
    `Execution rule: ${rule}`,
  ].join("\n");
}
