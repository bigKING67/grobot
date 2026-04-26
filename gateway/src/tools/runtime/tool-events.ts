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
  errorMessage?: string;
  errorData?: Record<string, unknown>;
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

export interface RuntimeToolRecoveryEscalationFields {
  sameToolErrorCount?: number | null;
  escalated?: boolean | null;
  escalationReason?: string | null;
  escalationPolicyVersion?: string | null;
  baseStage?: RuntimeToolRecoveryStage | null;
  baseRecommendedNextAction?: string | null;
}

export interface RuntimeToolRecoveryFeedback {
  active: boolean;
  severity: RuntimeToolRecoveryFeedbackSeverity;
  reason: string;
  stage: RuntimeToolRecoveryStage | null;
  toolName: string | null;
  errorClass: string | null;
  errorMessage?: string | null;
  errorData?: Record<string, unknown> | null;
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
  narrow_edit_old_text_to_unique_match:
    "Use the candidate lines from the edit error to make old_text uniquely identify exactly one span before retrying.",
  reread_target_then_retry_exact_old_text:
    "Reread the target around the suggested candidate lines, copy the exact current text, and retry the edit with that old_text.",
  use_write_or_normalize_line_endings:
    "Use write with the exact full file content, or first normalize the file's mixed line endings intentionally before retrying edit.",
  locate_path_with_glob_before_retry:
    "Use glob to locate the path before retrying read, write, or edit on that target.",
  choose_workspace_relative_path:
    "Replace the path with a workspace-contained relative path; do not use parent traversal or absolute paths outside the workspace.",
  choose_regular_file_path:
    "Choose an existing regular file path, or create a valid missing leaf whose parent can be safely resolved inside the workspace.",
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

function payloadRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = payload[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function payloadIsoString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const parsedMs = Date.parse(value);
  return Number.isFinite(parsedMs) ? value : undefined;
}

function compactRecoveryDetail(value: string): string | undefined {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return undefined;
  }
  const maxChars = 360;
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, maxChars)}...`;
}

function quoteRecoveryPreview(value: string): string {
  return JSON.stringify(compactRecoveryDetail(value) ?? "") ?? "\"\"";
}

function compactRecoveryCandidateList(label: string, value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const rows = value
    .map((item) => {
      const row = normalizeRecord(item);
      const line = typeof row.line === "number" && Number.isFinite(row.line) ? Math.trunc(row.line) : null;
      const preview = typeof row.preview === "string" ? row.preview : "";
      if (line === null && !preview.trim()) {
        return null;
      }
      if (line === null) {
        return quoteRecoveryPreview(preview);
      }
      if (!preview.trim()) {
        return `line ${String(line)}`;
      }
      return `line ${String(line)} ${quoteRecoveryPreview(preview)}`;
    })
    .filter((item): item is string => typeof item === "string")
    .slice(0, 4);
  if (rows.length === 0) {
    return undefined;
  }
  return `${label}=${rows.join(", ")}`;
}

function compactRecoveryStringList(label: string, value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  const rows = normalized.map((item) => quoteRecoveryPreview(item)).slice(0, 4);
  if (rows.length === 0) {
    return undefined;
  }
  const overflow = normalized.length > rows.length ? `,+${String(normalized.length - rows.length)}` : "";
  return `${label}=[${rows.join(",")}${overflow}]`;
}

function compactRecoveryErrorData(errorData: Record<string, unknown> | undefined): string | undefined {
  if (!errorData) {
    return undefined;
  }
  const parts: string[] = [];
  const server = typeof errorData.server === "string" ? compactRecoveryDetail(errorData.server) : undefined;
  if (server) {
    parts.push(`server=${server}`);
  }
  const serverKey = typeof errorData.server_key === "string" ? compactRecoveryDetail(errorData.server_key) : undefined;
  if (serverKey) {
    parts.push(`server_key=${serverKey}`);
  }
  const toolName = typeof errorData.tool_name === "string" ? compactRecoveryDetail(errorData.tool_name) : undefined;
  if (toolName) {
    parts.push(`tool_name=${toolName}`);
  }
  const operation = typeof errorData.operation === "string" ? compactRecoveryDetail(errorData.operation) : undefined;
  if (operation) {
    parts.push(`operation=${operation}`);
  }
  const path = typeof errorData.path === "string" ? compactRecoveryDetail(errorData.path) : undefined;
  if (path) {
    parts.push(`path=${path}`);
  }
  const candidatePath =
    typeof errorData.candidate_path === "string" ? compactRecoveryDetail(errorData.candidate_path) : undefined;
  if (candidatePath) {
    parts.push(`candidate_path=${candidatePath}`);
  }
  const reason = typeof errorData.reason === "string" ? compactRecoveryDetail(errorData.reason) : undefined;
  if (reason) {
    parts.push(`reason=${reason}`);
  }
  if (typeof errorData.edit_index === "number" && Number.isFinite(errorData.edit_index)) {
    parts.push(`edit_index=${String(Math.trunc(errorData.edit_index))}`);
  }
  if (typeof errorData.match_mode === "string" && errorData.match_mode.trim()) {
    parts.push(`match_mode=${errorData.match_mode.trim()}`);
  }
  if (typeof errorData.match_count === "number" && Number.isFinite(errorData.match_count)) {
    parts.push(`match_count=${String(Math.trunc(errorData.match_count))}`);
  }
  if (typeof errorData.allowlist_rule_count === "number" && Number.isFinite(errorData.allowlist_rule_count)) {
    parts.push(`allowlist_rule_count=${String(Math.trunc(errorData.allowlist_rule_count))}`);
  }
  if (typeof errorData.in_flight === "number" && Number.isFinite(errorData.in_flight)) {
    parts.push(`in_flight=${String(Math.trunc(errorData.in_flight))}`);
  }
  if (typeof errorData.queue_waiting === "number" && Number.isFinite(errorData.queue_waiting)) {
    parts.push(`queue_waiting=${String(Math.trunc(errorData.queue_waiting))}`);
  }
  if (
    typeof errorData.max_concurrency_per_server === "number"
    && Number.isFinite(errorData.max_concurrency_per_server)
  ) {
    parts.push(`max_concurrency_per_server=${String(Math.trunc(errorData.max_concurrency_per_server))}`);
  }
  if (typeof errorData.max_queue_per_server === "number" && Number.isFinite(errorData.max_queue_per_server)) {
    parts.push(`max_queue_per_server=${String(Math.trunc(errorData.max_queue_per_server))}`);
  }
  if (
    typeof errorData.circuit_open_until_epoch_secs === "number"
    && Number.isFinite(errorData.circuit_open_until_epoch_secs)
  ) {
    parts.push(`circuit_open_until_epoch_secs=${String(Math.trunc(errorData.circuit_open_until_epoch_secs))}`);
  }
  if (typeof errorData.enabled === "boolean") {
    parts.push(`enabled=${String(errorData.enabled)}`);
  }
  if (typeof errorData.ready === "boolean") {
    parts.push(`ready=${String(errorData.ready)}`);
  }
  if (typeof errorData.is_error === "boolean") {
    parts.push(`is_error=${String(errorData.is_error)}`);
  }
  const readyReason =
    typeof errorData.ready_reason === "string" ? compactRecoveryDetail(errorData.ready_reason) : undefined;
  if (readyReason) {
    parts.push(`ready_reason=${readyReason}`);
  }
  const deniedSegment =
    typeof errorData.denied_segment === "string" ? compactRecoveryDetail(errorData.denied_segment) : undefined;
  if (deniedSegment) {
    parts.push(`denied_segment=${quoteRecoveryPreview(deniedSegment)}`);
  }
  if (typeof errorData.timeout_ms === "number" && Number.isFinite(errorData.timeout_ms)) {
    parts.push(`timeout_ms=${String(Math.trunc(errorData.timeout_ms))}`);
  }
  if (typeof errorData.duration_ms === "number" && Number.isFinite(errorData.duration_ms)) {
    parts.push(`duration_ms=${String(Math.trunc(errorData.duration_ms))}`);
  }
  const rpcErrorCode = errorData.rpc_error_code;
  if (
    (typeof rpcErrorCode === "number" && Number.isFinite(rpcErrorCode))
    || (typeof rpcErrorCode === "string" && rpcErrorCode.trim())
  ) {
    parts.push(`rpc_error_code=${String(rpcErrorCode)}`);
  }
  const rpcErrorMessage =
    typeof errorData.rpc_error_message === "string" ? compactRecoveryDetail(errorData.rpc_error_message) : undefined;
  if (rpcErrorMessage) {
    parts.push(`rpc_error_message=${quoteRecoveryPreview(rpcErrorMessage)}`);
  }
  const resultPreview =
    typeof errorData.result_preview === "string" ? compactRecoveryDetail(errorData.result_preview) : undefined;
  if (resultPreview) {
    parts.push(`result_preview=${quoteRecoveryPreview(resultPreview)}`);
  }
  const structuredContentPreview = typeof errorData.structured_content_preview === "string"
    ? compactRecoveryDetail(errorData.structured_content_preview)
    : undefined;
  if (structuredContentPreview) {
    parts.push(`structured_content_preview=${quoteRecoveryPreview(structuredContentPreview)}`);
  }

  const diagnostics = normalizeRecord(errorData.diagnostics);
  const diagnosticKind = typeof errorData.diagnostic_kind === "string" && errorData.diagnostic_kind.trim()
    ? errorData.diagnostic_kind.trim()
    : typeof diagnostics.diagnostic_kind === "string" && diagnostics.diagnostic_kind.trim()
      ? diagnostics.diagnostic_kind.trim()
      : undefined;
  if (diagnosticKind) {
    parts.push(`diagnostic_kind=${diagnosticKind}`);
  }
  const candidates =
    compactRecoveryCandidateList("candidates", diagnostics.candidates)
    ?? compactRecoveryCandidateList("closest_lines", diagnostics.closest_lines);
  if (candidates) {
    parts.push(candidates);
  }
  const availableTools = compactRecoveryStringList("available_tools", errorData.available_tools);
  if (availableTools) {
    parts.push(availableTools);
  }
  const allowTools = compactRecoveryStringList("allow_tools", errorData.allow_tools);
  if (allowTools) {
    parts.push(allowTools);
  }
  const availableServers = compactRecoveryStringList("available_servers", errorData.available_servers);
  if (availableServers) {
    parts.push(availableServers);
  }
  return compactRecoveryDetail(parts.join(" "));
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
    errorMessage: compactRecoveryDetail(
      payloadString(payload, "error_message") || payloadString(payload, "errorMessage"),
    ),
    errorData: payloadRecord(payload, "error_data") ?? payloadRecord(payload, "errorData"),
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

export function formatRuntimeToolRecoveryEscalationFields(
  recovery: RuntimeToolRecoveryEscalationFields,
): string {
  return [
    `same_tool_error_count=${recovery.sameToolErrorCount ?? "<none>"}`,
    `escalated=${recovery.escalated ? "true" : "false"}`,
    `escalation_reason=${recovery.escalationReason ?? "<none>"}`,
    `escalation_policy_version=${recovery.escalationPolicyVersion ?? "<none>"}`,
    `base_recovery_stage=${recovery.baseStage ?? "<none>"}`,
    `base_recommended_next_action=${recovery.baseRecommendedNextAction ?? "<none>"}`,
  ].join(" ");
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
      errorMessage: null,
      errorData: null,
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
      errorMessage: recovery.errorMessage ?? null,
      errorData: recovery.errorData ?? null,
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
      errorMessage: recovery.errorMessage ?? null,
      errorData: recovery.errorData ?? null,
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
  const errorMessage = recovery.errorMessage ?? null;
  const errorData = recovery.errorData ?? null;
  const errorDataSummary = compactRecoveryErrorData(errorData ?? undefined);
  const requiresUserIntervention = recovery.requiresUserIntervention ?? (recovery.recoverable === false);
  const recoverability = requiresUserIntervention ? "requires_user_intervention" : "auto_recoverable";
  const executionDiscipline = requiresUserIntervention
    ? "Automatic recovery is blocked for this issue. Do not retry the failing tool automatically; ask the user or fix the required configuration, approval, or environment first."
    : "Automatic recovery is allowed only after changing one concrete variable; do not repeat an identical failing tool call unchanged.";
  const promptBlock = [
    "[Runtime Tool Recovery Hint]",
    `Recent tool issue: stage=${recovery.stage} tool=${toolName} error_class=${errorClass}`,
    errorMessage ? `Error detail: ${errorMessage}` : null,
    errorDataSummary ? `Structured error data: ${errorDataSummary}` : null,
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
    errorMessage,
    errorData,
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
