import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { RuntimeEvent } from "../../models/types";
import { RUNTIME_TOOL_RECOVERY_POLICY } from "./tool-recovery-policy";

export type RuntimeToolRecoveryStage =
  | "none"
  | "observe_first"
  | "local_fix"
  | "strategy_switch"
  | "ask_user";

export interface RuntimeToolRecoveryHint {
  stage: RuntimeToolRecoveryStage;
  reason: string;
  recommendedNextAction: string;
  toolName?: string;
  errorClass?: string;
  recoverable?: boolean;
  requiresUserIntervention?: boolean;
  observedAt?: string;
  sameToolErrorCount?: number;
  escalated?: boolean;
  escalationReason?: string;
  escalationPolicyVersion?: string;
  baseStage?: RuntimeToolRecoveryStage;
  baseRecommendedNextAction?: string;
}

export interface RuntimeToolEventSummary {
  callsTotal: number;
  failedTotal: number;
  deferredTotal: number;
  callsByTool: Record<string, number>;
  failuresByErrorClass: Record<string, number>;
  recoveryStages: Record<string, number>;
  durationTotalMsByTool: Record<string, number>;
  durationCountByTool: Record<string, number>;
  latestRecovery?: RuntimeToolRecoveryHint;
}

export interface RuntimeToolSurfaceMetricsSnapshot {
  version: 1;
  updatedAt: string | null;
  callsTotal: number;
  failedTotal: number;
  deferredTotal: number;
  callsByTool: Record<string, number>;
  failuresByErrorClass: Record<string, number>;
  recoveryStages: Record<string, number>;
  recoveryCountsByKey: Record<string, number>;
  latestRecoveryRepeatKey: string | null;
  latestRecoveryRepeatCount: number;
  avgDurationMsByTool: Record<string, number>;
  recentRecoveries: RuntimeToolRecoveryHint[];
  latestRecovery: RuntimeToolRecoveryHint | null;
  path: string;
}

export type RuntimeToolRecoveryFeedbackSeverity = "none" | "info" | "warning";

export interface RuntimeToolRecoveryFeedback {
  active: boolean;
  severity: RuntimeToolRecoveryFeedbackSeverity;
  reason: string;
  stage: RuntimeToolRecoveryStage | null;
  toolName: string | null;
  errorClass: string | null;
  recommendedNextAction: string | null;
  recoverable: boolean | null;
  requiresUserIntervention: boolean;
  sameToolErrorCount?: number | null;
  escalated?: boolean;
  escalationReason?: string | null;
  escalationPolicyVersion?: string | null;
  baseStage?: RuntimeToolRecoveryStage | null;
  baseRecommendedNextAction?: string | null;
  promptBlock: string;
  observedAt?: string | null;
  consumed?: boolean;
  consumedReason?: string | null;
  consumedAt?: string | null;
}

interface RuntimeToolSurfaceMetricsState {
  version: 1;
  updatedAt: string;
  callsTotal: number;
  failedTotal: number;
  deferredTotal: number;
  callsByTool: Record<string, number>;
  failuresByErrorClass: Record<string, number>;
  recoveryStages: Record<string, number>;
  recoveryCountsByKey: Record<string, number>;
  latestRecoveryRepeatKey: string;
  latestRecoveryRepeatCount: number;
  durationTotalMsByTool: Record<string, number>;
  durationCountByTool: Record<string, number>;
  recentRecoveries: RuntimeToolRecoveryHint[];
}

const RUNTIME_TOOL_RECOVERY_STAGES: readonly RuntimeToolRecoveryStage[] = [
  "none",
  "observe_first",
  "local_fix",
  "strategy_switch",
  "ask_user",
];

export const RUNTIME_TOOL_RECOVERY_ACTION_INSTRUCTIONS = {
  observe_prior_tool_result:
    "Observe the previous tool result before issuing another high-risk or state-mutating tool call.",
  fix_tool_arguments:
    "Fix the tool arguments first; do not repeat the same invalid call unchanged.",
  stop_or_change_target_content:
    "Stop retrying if the requested mutation is already applied, or change the target content explicitly.",
  split_non_overlapping_edits:
    "Split overlapping edits into distinct non-overlapping operations before retrying.",
  locate_path_with_glob_before_retry:
    "Use glob to locate the path before retrying read, write, or edit on that target.",
  read_target_before_mutation:
    "Read the target file first, then write or edit against the latest observed content.",
  reread_target_then_retry:
    "Reread the target and rebuild the write/edit from the current file content before retrying.",
  inspect_visible_tool_schema_then_retry:
    "Inspect the currently visible tool schema and retry only with visible arguments, or switch tools.",
  switch_tool_strategy:
    "Switch to a currently visible alternative tool or reduce scope instead of repeating the unavailable call.",
  use_suggested_distinct_tool:
    "Use the distinct tool suggested by the runtime guard instead of repeating the overlapping call.",
  use_search_or_glob_fallback:
    "Use search or glob fallback with scoped arguments before retrying semantic tooling.",
  retry_with_smaller_scope_or_wait:
    "Retry with a smaller scope, wait for queue/cooldown pressure to clear, or choose an alternate tool.",
  use_media_read_or_external_extractor:
    "Use the media-aware read path or an external extractor instead of forcing text read on binary content.",
  request_approval_or_use_safer_tool:
    "Ask the user for approval when required, or choose a safer non-privileged tool path.",
  request_environment_fix:
    "Ask the user to fix the environment or configuration before retrying.",
  ask_user_for_config_or_switch_provider:
    "Ask the user for missing configuration, or switch to a configured provider/tool path.",
  avoid_unknown_tool:
    "Avoid unknown tools and stay within the visible tool schema.",
  inspect_error_and_switch_strategy:
    "Inspect the error and change strategy before retrying.",
} as const;

export type RuntimeToolRecoveryAction = keyof typeof RUNTIME_TOOL_RECOVERY_ACTION_INSTRUCTIONS;

export function isRuntimeToolRecoveryAction(value: string): value is RuntimeToolRecoveryAction {
  return Object.prototype.hasOwnProperty.call(RUNTIME_TOOL_RECOVERY_ACTION_INSTRUCTIONS, value);
}

export function knownRuntimeToolRecoveryActions(): RuntimeToolRecoveryAction[] {
  return Object.keys(RUNTIME_TOOL_RECOVERY_ACTION_INSTRUCTIONS) as RuntimeToolRecoveryAction[];
}

function emptySummary(): RuntimeToolEventSummary {
  return {
    callsTotal: 0,
    failedTotal: 0,
    deferredTotal: 0,
    callsByTool: {},
    failuresByErrorClass: {},
    recoveryStages: {},
    durationTotalMsByTool: {},
    durationCountByTool: {},
  };
}

function emptyState(): RuntimeToolSurfaceMetricsState {
  return {
    version: 1,
    updatedAt: "",
    callsTotal: 0,
    failedTotal: 0,
    deferredTotal: 0,
    callsByTool: {},
    failuresByErrorClass: {},
    recoveryStages: {},
    recoveryCountsByKey: {},
    latestRecoveryRepeatKey: "",
    latestRecoveryRepeatCount: 0,
    durationTotalMsByTool: {},
    durationCountByTool: {},
    recentRecoveries: [],
  };
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function payloadNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function payloadBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key];
  return typeof value === "boolean" ? value : undefined;
}

function payloadIsoString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const parsedMs = Date.parse(value);
  return Number.isFinite(parsedMs) ? value : undefined;
}

function normalizeRecoveryStage(value: unknown): RuntimeToolRecoveryStage | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return RUNTIME_TOOL_RECOVERY_STAGES.includes(value as RuntimeToolRecoveryStage)
    ? value as RuntimeToolRecoveryStage
    : undefined;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function normalizeRecoveryKeyPart(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "<none>";
}

function recoveryRepeatKey(recovery: RuntimeToolRecoveryHint): string {
  return recoveryRepeatKeyFromParts({
    toolName: recovery.toolName,
    errorClass: recovery.errorClass ?? recovery.reason,
  });
}

function recoveryRepeatKeyFromParts(input: {
  toolName: string | null | undefined;
  errorClass: string | null | undefined;
}): string {
  return [
    "tool_error",
    normalizeRecoveryKeyPart(input.toolName ?? undefined),
    normalizeRecoveryKeyPart(input.errorClass ?? undefined),
  ].join(":");
}

function recoveryStageRank(stage: RuntimeToolRecoveryStage): number {
  if (stage === "ask_user") {
    return 3;
  }
  if (stage === "strategy_switch") {
    return 2;
  }
  if (stage === "local_fix" || stage === "observe_first") {
    return 1;
  }
  return 0;
}

function applyRepeatedRecoveryEscalation(input: {
  recovery: RuntimeToolRecoveryHint;
  sameToolErrorCount: number;
}): RuntimeToolRecoveryHint {
  const base = input.recovery;
  const baseStage = base.baseStage ?? base.stage;
  const baseRecommendedNextAction = base.baseRecommendedNextAction ?? base.recommendedNextAction;
  const common: RuntimeToolRecoveryHint = {
    ...base,
    sameToolErrorCount: input.sameToolErrorCount,
    escalationPolicyVersion: RUNTIME_TOOL_RECOVERY_POLICY.version,
    requiresUserIntervention: base.requiresUserIntervention ?? (base.recoverable === false),
  };
  if (
    input.sameToolErrorCount >= RUNTIME_TOOL_RECOVERY_POLICY.escalation.sameToolErrorAskUserThreshold
    && recoveryStageRank(base.stage) < recoveryStageRank("ask_user")
  ) {
    return {
      ...common,
      stage: "ask_user",
      recommendedNextAction: "ask_user_for_config_or_switch_provider",
      recoverable: false,
      requiresUserIntervention: true,
      escalated: true,
      escalationReason: "same_tool_error_exhausted",
      baseStage,
      baseRecommendedNextAction,
    };
  }
  if (
    input.sameToolErrorCount >= RUNTIME_TOOL_RECOVERY_POLICY.escalation.sameToolErrorStrategySwitchThreshold
    && recoveryStageRank(base.stage) < recoveryStageRank("strategy_switch")
  ) {
    return {
      ...common,
      stage: "strategy_switch",
      recommendedNextAction: "switch_tool_strategy",
      recoverable: true,
      requiresUserIntervention: false,
      escalated: true,
      escalationReason: "same_tool_error_repeated",
      baseStage,
      baseRecommendedNextAction,
    };
  }
  return {
    ...common,
    escalated: false,
  };
}

function increment(map: Record<string, number>, key: string, count = 1): void {
  if (!key) {
    return;
  }
  map[key] = (map[key] ?? 0) + count;
}

function addMap(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, value] of Object.entries(source)) {
    if (Number.isFinite(value) && value !== 0) {
      increment(target, key, value);
    }
  }
}

function normalizeRecoveryHint(payload: Record<string, unknown>): RuntimeToolRecoveryHint | undefined {
  const stage = normalizeRecoveryStage(payload.recovery_stage ?? payload.stage);
  if (!stage || stage === "none") {
    return undefined;
  }
  const recommendedNextAction =
    payloadString(payload, "recommended_next_action")
    || payloadString(payload, "recommendedNextAction")
    || "inspect_error_and_switch_strategy";
  return {
    stage,
    reason: payloadString(payload, "recovery_reason") || payloadString(payload, "reason") || "unknown",
    recommendedNextAction,
    toolName: payloadString(payload, "tool_name") || payloadString(payload, "toolName") || undefined,
    errorClass: payloadString(payload, "error_class") || payloadString(payload, "errorClass") || undefined,
    recoverable:
      payloadBoolean(payload, "recoverable")
      ?? payloadBoolean(payload, "auto_recoverable")
      ?? payloadBoolean(payload, "autoRecoverable"),
    requiresUserIntervention:
      payloadBoolean(payload, "requires_user_intervention")
      ?? payloadBoolean(payload, "requiresUserIntervention"),
    observedAt: payloadIsoString(payload, "observed_at") || payloadIsoString(payload, "observedAt"),
    sameToolErrorCount:
      normalizePositiveInteger(payload.same_tool_error_count)
      ?? normalizePositiveInteger(payload.sameToolErrorCount),
    escalated: payloadBoolean(payload, "escalated"),
    escalationReason:
      payloadString(payload, "escalation_reason") || payloadString(payload, "escalationReason") || undefined,
    escalationPolicyVersion:
      payloadString(payload, "escalation_policy_version")
      || payloadString(payload, "escalationPolicyVersion")
      || undefined,
    baseStage: normalizeRecoveryStage(payload.base_recovery_stage ?? payload.baseStage),
    baseRecommendedNextAction:
      payloadString(payload, "base_recommended_next_action")
      || payloadString(payload, "baseRecommendedNextAction")
      || undefined,
  };
}

function metricsPathForWorkDir(workDir: string): string {
  return resolve(workDir, ".grobot/runtime/tool-surface-metrics.json");
}

function readState(path: string): RuntimeToolSurfaceMetricsState {
  if (!existsSync(path)) {
    return emptyState();
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const row = normalizeRecord(parsed);
    return {
      version: 1,
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
      callsTotal: typeof row.callsTotal === "number" ? row.callsTotal : 0,
      failedTotal: typeof row.failedTotal === "number" ? row.failedTotal : 0,
      deferredTotal: typeof row.deferredTotal === "number" ? row.deferredTotal : 0,
      callsByTool: normalizeNumberMap(row.callsByTool),
      failuresByErrorClass: normalizeNumberMap(row.failuresByErrorClass),
      recoveryStages: normalizeNumberMap(row.recoveryStages),
      recoveryCountsByKey: normalizeNumberMap(row.recoveryCountsByKey),
      latestRecoveryRepeatKey: typeof row.latestRecoveryRepeatKey === "string" ? row.latestRecoveryRepeatKey : "",
      latestRecoveryRepeatCount: normalizePositiveInteger(row.latestRecoveryRepeatCount) ?? 0,
      durationTotalMsByTool: normalizeNumberMap(row.durationTotalMsByTool),
      durationCountByTool: normalizeNumberMap(row.durationCountByTool),
      recentRecoveries: Array.isArray(row.recentRecoveries)
        ? row.recentRecoveries
            .map((item) => normalizeRecoveryHint(normalizeRecord(item)))
            .filter((item): item is RuntimeToolRecoveryHint => Boolean(item))
            .slice(-1 * RUNTIME_TOOL_RECOVERY_POLICY.timelineMaxEntries)
        : [],
    };
  } catch {
    return emptyState();
  }
}

function normalizeNumberMap(value: unknown): Record<string, number> {
  const row = normalizeRecord(value);
  const output: Record<string, number> = {};
  for (const [key, raw] of Object.entries(row)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      output[key] = raw;
    }
  }
  return output;
}

function toSnapshot(path: string, state: RuntimeToolSurfaceMetricsState): RuntimeToolSurfaceMetricsSnapshot {
  const avgDurationMsByTool: Record<string, number> = {};
  for (const [tool, total] of Object.entries(state.durationTotalMsByTool)) {
    const count = state.durationCountByTool[tool] ?? 0;
    if (count > 0) {
      avgDurationMsByTool[tool] = Math.round(total / count);
    }
  }
  return {
    version: 1,
    updatedAt: state.updatedAt || null,
    callsTotal: state.callsTotal,
    failedTotal: state.failedTotal,
    deferredTotal: state.deferredTotal,
    callsByTool: state.callsByTool,
    failuresByErrorClass: state.failuresByErrorClass,
    recoveryStages: state.recoveryStages,
    recoveryCountsByKey: state.recoveryCountsByKey,
    latestRecoveryRepeatKey: state.latestRecoveryRepeatKey || null,
    latestRecoveryRepeatCount: state.latestRecoveryRepeatCount,
    avgDurationMsByTool,
    recentRecoveries: state.recentRecoveries,
    latestRecovery: state.recentRecoveries[state.recentRecoveries.length - 1] ?? null,
    path,
  };
}

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
    }
  }
  return summary;
}

export function recordRuntimeToolSurfaceMetrics(input: {
  workDir: string;
  events: readonly RuntimeEvent[];
}): RuntimeToolSurfaceMetricsSnapshot {
  const path = metricsPathForWorkDir(input.workDir);
  const summary = summarizeRuntimeToolEvents(input.events);
  const state = readState(path);
  if (summary.callsTotal === 0 && Object.keys(summary.recoveryStages).length === 0) {
    return toSnapshot(path, state);
  }
  state.updatedAt = new Date().toISOString();
  state.callsTotal += summary.callsTotal;
  state.failedTotal += summary.failedTotal;
  state.deferredTotal += summary.deferredTotal;
  addMap(state.callsByTool, summary.callsByTool);
  addMap(state.failuresByErrorClass, summary.failuresByErrorClass);
  addMap(state.recoveryStages, summary.recoveryStages);
  addMap(state.durationTotalMsByTool, summary.durationTotalMsByTool);
  addMap(state.durationCountByTool, summary.durationCountByTool);
  if (summary.latestRecovery) {
    const repeatKey = recoveryRepeatKey(summary.latestRecovery);
    increment(state.recoveryCountsByKey, repeatKey);
    const sameToolErrorCount =
      state.latestRecoveryRepeatKey === repeatKey
        ? state.latestRecoveryRepeatCount + 1
        : 1;
    state.latestRecoveryRepeatKey = repeatKey;
    state.latestRecoveryRepeatCount = sameToolErrorCount;
    const escalatedRecovery = applyRepeatedRecoveryEscalation({
      recovery: summary.latestRecovery,
      sameToolErrorCount,
    });
    state.recentRecoveries.push({
      ...escalatedRecovery,
      observedAt: state.updatedAt,
    });
    state.recentRecoveries = state.recentRecoveries.slice(-1 * RUNTIME_TOOL_RECOVERY_POLICY.timelineMaxEntries);
  } else {
    state.latestRecoveryRepeatKey = "";
    state.latestRecoveryRepeatCount = 0;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return toSnapshot(path, state);
}

export function readRuntimeToolSurfaceMetrics(workDir: string): RuntimeToolSurfaceMetricsSnapshot {
  const path = metricsPathForWorkDir(workDir);
  return toSnapshot(path, readState(path));
}

export function clearRuntimeToolRecoveryRepeatPressure(input: {
  workDir: string;
  toolName?: string | null;
  errorClass?: string | null;
  nowIso?: string;
}): {
  cleared: boolean;
  snapshot: RuntimeToolSurfaceMetricsSnapshot;
} {
  const path = metricsPathForWorkDir(input.workDir);
  const state = readState(path);
  if (!state.latestRecoveryRepeatKey || state.latestRecoveryRepeatCount <= 0) {
    return {
      cleared: false,
      snapshot: toSnapshot(path, state),
    };
  }
  const expectedKey =
    input.toolName || input.errorClass
      ? recoveryRepeatKeyFromParts({
          toolName: input.toolName,
          errorClass: input.errorClass,
        })
      : "";
  if (expectedKey && expectedKey !== state.latestRecoveryRepeatKey) {
    return {
      cleared: false,
      snapshot: toSnapshot(path, state),
    };
  }
  state.latestRecoveryRepeatKey = "";
  state.latestRecoveryRepeatCount = 0;
  state.updatedAt = input.nowIso ?? new Date().toISOString();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return {
    cleared: true,
    snapshot: toSnapshot(path, state),
  };
}

function actionInstruction(action: string): string {
  return isRuntimeToolRecoveryAction(action)
    ? RUNTIME_TOOL_RECOVERY_ACTION_INSTRUCTIONS[action]
    : RUNTIME_TOOL_RECOVERY_ACTION_INSTRUCTIONS.inspect_error_and_switch_strategy;
}

function severityForRecovery(stage: RuntimeToolRecoveryStage): RuntimeToolRecoveryFeedbackSeverity {
  if (stage === "ask_user" || stage === "strategy_switch") {
    return "warning";
  }
  if (stage === "observe_first" || stage === "local_fix") {
    return "info";
  }
  return "none";
}

function parseObservedAtMs(recovery: RuntimeToolRecoveryHint, fallbackUpdatedAt: string | null): number | undefined {
  const observedAt = recovery.observedAt || fallbackUpdatedAt || "";
  const parsed = Date.parse(observedAt);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function buildRuntimeToolRecoveryFeedback(input: {
  metrics: RuntimeToolSurfaceMetricsSnapshot;
  nowMs?: number;
  maxAgeMs?: number;
}): RuntimeToolRecoveryFeedback {
  const recovery = input.metrics.latestRecovery;
  if (!recovery || recovery.stage === "none") {
    return {
      active: false,
      severity: "none",
      reason: "no_recent_recovery",
      stage: null,
      toolName: null,
      errorClass: null,
      recommendedNextAction: null,
      recoverable: null,
      requiresUserIntervention: false,
      sameToolErrorCount: null,
      escalated: false,
      escalationReason: null,
      escalationPolicyVersion: null,
      baseStage: null,
      baseRecommendedNextAction: null,
      promptBlock: "",
      observedAt: null,
    };
  }
  const nowMs = input.nowMs ?? Date.now();
  const maxAgeMs = input.maxAgeMs ?? RUNTIME_TOOL_RECOVERY_POLICY.promptMaxAgeMs;
  const observedAtMs = parseObservedAtMs(recovery, input.metrics.updatedAt);
  if (typeof observedAtMs !== "number") {
    return {
      active: false,
      severity: "none",
      reason: "missing_recovery_timestamp",
      stage: recovery.stage,
      toolName: recovery.toolName ?? null,
      errorClass: recovery.errorClass ?? null,
      recommendedNextAction: recovery.recommendedNextAction,
      recoverable: recovery.recoverable ?? null,
      requiresUserIntervention: false,
      sameToolErrorCount: recovery.sameToolErrorCount ?? null,
      escalated: recovery.escalated ?? false,
      escalationReason: recovery.escalationReason ?? null,
      escalationPolicyVersion: recovery.escalationPolicyVersion ?? null,
      baseStage: recovery.baseStage ?? null,
      baseRecommendedNextAction: recovery.baseRecommendedNextAction ?? null,
      promptBlock: "",
      observedAt: recovery.observedAt ?? input.metrics.updatedAt,
    };
  }
  const ageMs = Math.max(0, nowMs - observedAtMs);
  if (ageMs > maxAgeMs) {
    return {
      active: false,
      severity: "none",
      reason: "stale_recovery",
      stage: recovery.stage,
      toolName: recovery.toolName ?? null,
      errorClass: recovery.errorClass ?? null,
      recommendedNextAction: recovery.recommendedNextAction,
      recoverable: recovery.recoverable ?? null,
      requiresUserIntervention: false,
      sameToolErrorCount: recovery.sameToolErrorCount ?? null,
      escalated: recovery.escalated ?? false,
      escalationReason: recovery.escalationReason ?? null,
      escalationPolicyVersion: recovery.escalationPolicyVersion ?? null,
      baseStage: recovery.baseStage ?? null,
      baseRecommendedNextAction: recovery.baseRecommendedNextAction ?? null,
      promptBlock: "",
      observedAt: recovery.observedAt ?? input.metrics.updatedAt,
    };
  }
  const instruction = actionInstruction(recovery.recommendedNextAction);
  const toolName = recovery.toolName ?? "unknown_tool";
  const errorClass = recovery.errorClass ?? recovery.reason;
  const requiresUserIntervention = recovery.requiresUserIntervention ?? (recovery.recoverable === false);
  const recoverability = requiresUserIntervention ? "requires_user_intervention" : "auto_recoverable";
  const executionDiscipline = requiresUserIntervention
    ? "Automatic recovery is blocked for this issue. Do not retry the failing tool automatically; ask the user or fix the required configuration, approval, or environment first."
    : "Automatic recovery is allowed only after changing one concrete variable; do not repeat an identical failing tool call unchanged.";
  const promptBlock = [
    "[Runtime Tool Recovery Hint]",
    `Recent tool issue: stage=${recovery.stage} tool=${toolName} error_class=${errorClass}`,
    recovery.sameToolErrorCount
      ? `Repeated failure pressure: same_tool_error_count=${String(recovery.sameToolErrorCount)} escalated=${recovery.escalated ? "true" : "false"} reason=${recovery.escalationReason ?? "<none>"}`
      : null,
    recovery.escalated && recovery.baseStage
      ? `Base recovery was stage=${recovery.baseStage} action=${recovery.baseRecommendedNextAction ?? "<none>"} before gateway escalation.`
      : null,
    `Recoverability: ${recoverability}`,
    `Required next action: ${recovery.recommendedNextAction}`,
    `Execution rule: ${instruction}`,
    `Execution discipline: ${executionDiscipline}`,
  ].filter((line): line is string => typeof line === "string").join("\n");
  return {
    active: true,
    severity: severityForRecovery(recovery.stage),
    reason: recovery.escalated ? "repeated_recovery_escalated" : "recent_recovery",
    stage: recovery.stage,
    toolName,
    errorClass,
    recommendedNextAction: recovery.recommendedNextAction,
    recoverable: recovery.recoverable ?? null,
    requiresUserIntervention,
    sameToolErrorCount: recovery.sameToolErrorCount ?? null,
    escalated: recovery.escalated ?? false,
    escalationReason: recovery.escalationReason ?? null,
    escalationPolicyVersion: recovery.escalationPolicyVersion ?? null,
    baseStage: recovery.baseStage ?? null,
    baseRecommendedNextAction: recovery.baseRecommendedNextAction ?? null,
    promptBlock,
    observedAt: recovery.observedAt ?? input.metrics.updatedAt,
  };
}
