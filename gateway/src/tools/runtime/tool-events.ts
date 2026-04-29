import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { RuntimeEvent } from "../../models/types";
import {
  buildBrowserEnvironmentRecoveryPlan,
  browserEnvironmentRecoveryActionInstruction,
  browserEnvironmentRecoveryFixInstruction,
  type BrowserEnvironmentRecoveryPlan,
} from "./browser-environment-recovery";
import {
  buildMcpEnvironmentRecoveryPlan,
  mcpEnvironmentRecoveryActionInstruction,
  mcpEnvironmentRecoveryFixInstruction,
  type McpEnvironmentRecoveryPlan,
} from "./mcp-environment-recovery";
import {
  buildRuntimeEnvironmentRecoveryPlan,
  runtimeEnvironmentRecoveryActionInstruction,
  runtimeEnvironmentRecoveryFixInstruction,
  type RuntimeEnvironmentRecoveryPlan,
} from "./runtime-environment-recovery";
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

export type RuntimeToolRecoveryActionFamily =
  | "none"
  | "observe"
  | "argument_fix"
  | "payload_reduce"
  | "content_fix"
  | "path_fix"
  | "schema_fix"
  | "strategy_switch"
  | "fallback_tool"
  | "wait_or_retry"
  | "media_extract"
  | "policy_or_permission"
  | "environment_fix"
  | "user_intervention"
  | "unknown_tool"
  | "unknown";

export interface RuntimeToolRecoveryActionClassification {
  action: string | null;
  family: RuntimeToolRecoveryActionFamily;
  reason: string;
}

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
  recommendedNextAction: RuntimeToolRecoveryAction | null;
  actionFamily?: RuntimeToolRecoveryActionFamily | null;
  actionReason?: string | null;
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
  runtimeEnvironmentRecovery?: RuntimeEnvironmentRecoveryPlan | null;
  browserEnvironmentRecovery?: BrowserEnvironmentRecoveryPlan | null;
  mcpEnvironmentRecovery?: McpEnvironmentRecoveryPlan | null;
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
  fix_mcp_tool_arguments:
    "Fix the MCP tool arguments using the server/tool name, argument keys, RPC code, and bounded preview; remove unknown fields and do not resend the same payload unchanged.",
  reduce_mcp_argument_payload:
    "Reduce the MCP argument payload before retrying: split the call, pass references instead of large inline data, or narrow query/scope below the reported byte budget.",
  use_allowed_mcp_tool_or_request_policy_change:
    "Use one of the allowed MCP tools reported by policy, or ask for a policy/config change before retrying the blocked MCP tool.",
  inspect_mcp_tool_result_and_change_arguments:
    "Inspect the MCP tool result preview and structured content, then change arguments, scope, or tool choice before retrying.",
  inspect_mcp_rpc_error_and_switch_strategy:
    "Inspect the MCP JSON-RPC code/message and switch strategy, server, tool, or transport assumptions before retrying.",
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

export function normalizeRuntimeToolRecoveryAction(
  value: string | null | undefined,
): RuntimeToolRecoveryAction {
  const normalized = typeof value === "string" ? value.trim() : "";
  return isRuntimeToolRecoveryAction(normalized)
    ? normalized
    : "inspect_error_and_switch_strategy";
}

export function knownRuntimeToolRecoveryActions(): RuntimeToolRecoveryAction[] {
  return Object.keys(RUNTIME_TOOL_RECOVERY_ACTION_INSTRUCTIONS) as RuntimeToolRecoveryAction[];
}

export function classifyRuntimeToolRecoveryAction(
  action: string | null | undefined,
): RuntimeToolRecoveryActionClassification {
  const normalized = typeof action === "string" ? action.trim() : "";
  if (!normalized) {
    return {
      action: null,
      family: "none",
      reason: "no_action",
    };
  }
  switch (normalized) {
    case "observe_prior_tool_result":
      return { action: normalized, family: "observe", reason: "observe_prior_tool_result" };
    case "fix_tool_arguments":
    case "fix_mcp_tool_arguments":
    case "inspect_mcp_tool_result_and_change_arguments":
      return { action: normalized, family: "argument_fix", reason: normalized };
    case "reduce_mcp_argument_payload":
      return { action: normalized, family: "payload_reduce", reason: normalized };
    case "stop_or_change_target_content":
    case "split_non_overlapping_edits":
    case "narrow_edit_old_text_to_unique_match":
    case "reread_target_then_retry_exact_old_text":
    case "use_write_or_normalize_line_endings":
    case "read_target_before_mutation":
    case "reread_target_then_retry":
      return { action: normalized, family: "content_fix", reason: normalized };
    case "locate_path_with_glob_before_retry":
    case "choose_workspace_relative_path":
    case "choose_regular_file_path":
      return { action: normalized, family: "path_fix", reason: normalized };
    case "inspect_visible_tool_schema_then_retry":
      return { action: normalized, family: "schema_fix", reason: normalized };
    case "switch_tool_strategy":
    case "use_suggested_distinct_tool":
    case "inspect_error_and_switch_strategy":
    case "inspect_mcp_rpc_error_and_switch_strategy":
      return { action: normalized, family: "strategy_switch", reason: normalized };
    case "use_search_or_glob_fallback":
      return { action: normalized, family: "fallback_tool", reason: normalized };
    case "retry_with_smaller_scope_or_wait":
      return { action: normalized, family: "wait_or_retry", reason: normalized };
    case "use_media_read_or_external_extractor":
      return { action: normalized, family: "media_extract", reason: normalized };
    case "request_approval_or_use_safer_tool":
    case "use_allowed_mcp_tool_or_request_policy_change":
      return { action: normalized, family: "policy_or_permission", reason: normalized };
    case "request_environment_fix":
      return { action: normalized, family: "environment_fix", reason: normalized };
    case "ask_user_for_config_or_switch_provider":
      return { action: normalized, family: "user_intervention", reason: normalized };
    case "avoid_unknown_tool":
      return { action: normalized, family: "unknown_tool", reason: normalized };
    default:
      return { action: normalized, family: "unknown", reason: "uncataloged_action" };
  }
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
  const diagnostics = normalizeRecord(errorData.diagnostics);
  const diagnosticKind = typeof errorData.diagnostic_kind === "string" && errorData.diagnostic_kind.trim()
    ? errorData.diagnostic_kind.trim()
    : typeof diagnostics.diagnostic_kind === "string" && diagnostics.diagnostic_kind.trim()
      ? diagnostics.diagnostic_kind.trim()
      : undefined;
  const browserLike =
    typeof errorData.backend === "string"
    || typeof errorData.mapped_tool === "string"
    || typeof errorData.browser_context_kind === "string"
    || typeof errorData.transport_attempts_count === "number";
  if (browserLike && diagnosticKind) {
    parts.push(`diagnostic_kind=${diagnosticKind}`);
  }
  const recoveryStage = typeof errorData.recovery_stage === "string"
    ? compactRecoveryDetail(errorData.recovery_stage)
    : undefined;
  if (recoveryStage) {
    parts.push(`recovery_stage=${recoveryStage}`);
  }
  const recommendedNextAction = typeof errorData.recommended_next_action === "string"
    ? compactRecoveryDetail(errorData.recommended_next_action)
    : undefined;
  if (recommendedNextAction) {
    parts.push(`recommended_next_action=${recommendedNextAction}`);
  }
  const browserTool = typeof errorData.tool === "string" ? compactRecoveryDetail(errorData.tool) : undefined;
  if (browserLike && browserTool) {
    parts.push(`tool=${browserTool}`);
  }
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
  const backend = typeof errorData.backend === "string" ? compactRecoveryDetail(errorData.backend) : undefined;
  if (backend) {
    parts.push(`backend=${backend}`);
  }
  const backendServer =
    typeof errorData.backend_server === "string" ? compactRecoveryDetail(errorData.backend_server) : undefined;
  if (backendServer) {
    parts.push(`backend_server=${backendServer}`);
  }
  const mappedTool =
    typeof errorData.mapped_tool === "string" ? compactRecoveryDetail(errorData.mapped_tool) : undefined;
  if (mappedTool) {
    parts.push(`mapped_tool=${mappedTool}`);
  }
  const operation = typeof errorData.operation === "string" ? compactRecoveryDetail(errorData.operation) : undefined;
  if (operation) {
    parts.push(`operation=${operation}`);
  }
  const semanticLike =
    typeof errorData.bridge_command === "string"
    || typeof errorData.bridge_error_class === "string"
    || typeof errorData.source_roots_count === "number";
  if (semanticLike && diagnosticKind) {
    parts.push(`diagnostic_kind=${diagnosticKind}`);
  }
  const tool = typeof errorData.tool === "string" ? compactRecoveryDetail(errorData.tool) : undefined;
  if (tool && !browserLike) {
    parts.push(`tool=${tool}`);
  }
  const toolSurfaceProfile =
    typeof errorData.tool_surface_profile === "string"
      ? compactRecoveryDetail(errorData.tool_surface_profile)
      : undefined;
  if (toolSurfaceProfile) {
    parts.push(`tool_surface_profile=${toolSurfaceProfile}`);
  }
  const bridgeCommand =
    typeof errorData.bridge_command === "string" ? compactRecoveryDetail(errorData.bridge_command) : undefined;
  if (bridgeCommand) {
    parts.push(`bridge_command=${bridgeCommand}`);
  }
  const source = typeof errorData.source === "string" ? compactRecoveryDetail(errorData.source) : undefined;
  if (source) {
    parts.push(`source=${source}`);
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
  if (typeof errorData.source_roots_count === "number" && Number.isFinite(errorData.source_roots_count)) {
    parts.push(`source_roots_count=${String(Math.trunc(errorData.source_roots_count))}`);
  }
  if (typeof errorData.bridge_exit_status === "number" && Number.isFinite(errorData.bridge_exit_status)) {
    parts.push(`bridge_exit_status=${String(Math.trunc(errorData.bridge_exit_status))}`);
  }
  if (typeof errorData.matched_files === "number" && Number.isFinite(errorData.matched_files)) {
    parts.push(`matched_files=${String(Math.trunc(errorData.matched_files))}`);
  }
  if (typeof errorData.source_count === "number" && Number.isFinite(errorData.source_count)) {
    parts.push(`source_count=${String(Math.trunc(errorData.source_count))}`);
  }
  if (
    typeof errorData.transport_attempts_count === "number"
    && Number.isFinite(errorData.transport_attempts_count)
  ) {
    parts.push(`transport_attempts_count=${String(Math.trunc(errorData.transport_attempts_count))}`);
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
  if (typeof errorData.argument_bytes === "number" && Number.isFinite(errorData.argument_bytes)) {
    parts.push(`argument_bytes=${String(Math.trunc(errorData.argument_bytes))}`);
  }
  if (typeof errorData.max_argument_bytes === "number" && Number.isFinite(errorData.max_argument_bytes)) {
    parts.push(`max_argument_bytes=${String(Math.trunc(errorData.max_argument_bytes))}`);
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
  if (typeof errorData.retryable === "boolean") {
    parts.push(`retryable=${String(errorData.retryable)}`);
  }
  if (typeof errorData.advanced_tool_schema === "boolean") {
    parts.push(`advanced_tool_schema=${String(errorData.advanced_tool_schema)}`);
  }
  if (typeof errorData.facade_default_tmwd_mode_applied === "boolean") {
    parts.push(`facade_default_tmwd_mode_applied=${String(errorData.facade_default_tmwd_mode_applied)}`);
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
  const nodeBin = typeof errorData.node_bin === "string" ? compactRecoveryDetail(errorData.node_bin) : undefined;
  if (nodeBin) {
    parts.push(`node_bin=${nodeBin}`);
  }
  const bridgeScript =
    typeof errorData.bridge_script === "string" ? compactRecoveryDetail(errorData.bridge_script) : undefined;
  if (bridgeScript) {
    parts.push(`bridge_script=${quoteRecoveryPreview(bridgeScript)}`);
  }
  const bridgeScriptOverride = typeof errorData.bridge_script_override === "string"
    ? compactRecoveryDetail(errorData.bridge_script_override)
    : undefined;
  if (bridgeScriptOverride) {
    parts.push(`bridge_script_override=${quoteRecoveryPreview(bridgeScriptOverride)}`);
  }
  const indexConfigPath =
    typeof errorData.index_config_path === "string" ? compactRecoveryDetail(errorData.index_config_path) : undefined;
  if (indexConfigPath) {
    parts.push(`index_config_path=${quoteRecoveryPreview(indexConfigPath)}`);
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
  const backendStatus =
    typeof errorData.backend_status === "string" ? compactRecoveryDetail(errorData.backend_status) : undefined;
  if (backendStatus) {
    parts.push(`backend_status=${backendStatus}`);
  }
  const errorCode = typeof errorData.error_code === "string" ? compactRecoveryDetail(errorData.error_code) : undefined;
  if (errorCode) {
    parts.push(`error_code=${errorCode}`);
  }
  const transport = typeof errorData.transport === "string" ? compactRecoveryDetail(errorData.transport) : undefined;
  if (transport) {
    parts.push(`transport=${transport}`);
  }
  const browserContextKind =
    typeof errorData.browser_context_kind === "string"
      ? compactRecoveryDetail(errorData.browser_context_kind)
      : undefined;
  if (browserContextKind) {
    parts.push(`browser_context_kind=${browserContextKind}`);
  }
  const diagnosticHint =
    typeof errorData.diagnostic_hint === "string" ? compactRecoveryDetail(errorData.diagnostic_hint) : undefined;
  if (diagnosticHint) {
    parts.push(`diagnostic_hint=${quoteRecoveryPreview(diagnosticHint)}`);
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
  const argumentPreview =
    typeof errorData.argument_preview === "string" ? compactRecoveryDetail(errorData.argument_preview) : undefined;
  if (argumentPreview) {
    parts.push(`argument_preview=${quoteRecoveryPreview(argumentPreview)}`);
  }
  const bridgeErrorClass =
    typeof errorData.bridge_error_class === "string" ? compactRecoveryDetail(errorData.bridge_error_class) : undefined;
  if (bridgeErrorClass) {
    parts.push(`bridge_error_class=${bridgeErrorClass}`);
  }
  const bridgeErrorMessage = typeof errorData.bridge_error_message === "string"
    ? compactRecoveryDetail(errorData.bridge_error_message)
    : undefined;
  if (bridgeErrorMessage) {
    parts.push(`bridge_error_message=${quoteRecoveryPreview(bridgeErrorMessage)}`);
  }
  const causeErrorClass =
    typeof errorData.cause_error_class === "string" ? compactRecoveryDetail(errorData.cause_error_class) : undefined;
  if (causeErrorClass) {
    parts.push(`cause_error_class=${causeErrorClass}`);
  }
  const causeErrorMessage = typeof errorData.cause_error_message === "string"
    ? compactRecoveryDetail(errorData.cause_error_message)
    : undefined;
  if (causeErrorMessage) {
    parts.push(`cause_error_message=${quoteRecoveryPreview(causeErrorMessage)}`);
  }
  const rawMessage =
    typeof errorData.raw_message === "string" ? compactRecoveryDetail(errorData.raw_message) : undefined;
  if (rawMessage) {
    parts.push(`raw_message=${quoteRecoveryPreview(rawMessage)}`);
  }
  const stderrPreview =
    typeof errorData.stderr_preview === "string" ? compactRecoveryDetail(errorData.stderr_preview) : undefined;
  if (stderrPreview) {
    parts.push(`stderr_preview=${quoteRecoveryPreview(stderrPreview)}`);
  }
  const stdoutPreview =
    typeof errorData.stdout_preview === "string" ? compactRecoveryDetail(errorData.stdout_preview) : undefined;
  if (stdoutPreview) {
    parts.push(`stdout_preview=${quoteRecoveryPreview(stdoutPreview)}`);
  }

  if (diagnosticKind && !semanticLike && !browserLike) {
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
  const argumentKeys = compactRecoveryStringList("argument_keys", errorData.argument_keys);
  if (argumentKeys) {
    parts.push(argumentKeys);
  }
  const requestedSources = compactRecoveryStringList("requested_sources", errorData.requested_sources);
  if (requestedSources) {
    parts.push(requestedSources);
  }
  const hiddenArgs = compactRecoveryStringList("hidden_args", errorData.hidden_args);
  if (hiddenArgs) {
    parts.push(hiddenArgs);
  }
  const visibleArgs = compactRecoveryStringList("visible_args", errorData.visible_args);
  if (visibleArgs) {
    parts.push(visibleArgs);
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

function recoveryString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function recoveryFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function mcpDiagnosticKind(recovery: RuntimeToolRecoveryHint): string {
  const errorData = recovery.errorData ?? {};
  const diagnostics = normalizeRecord(errorData.diagnostics);
  return recoveryString(errorData.diagnostic_kind) || recoveryString(diagnostics.diagnostic_kind);
}

function mcpRpcErrorCode(recovery: RuntimeToolRecoveryHint): string {
  const value = recovery.errorData?.rpc_error_code;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return recoveryString(value);
}

function isMcpRecovery(recovery: RuntimeToolRecoveryHint): boolean {
  const errorData = recovery.errorData ?? {};
  const diagnosticKind = mcpDiagnosticKind(recovery);
  const errorClass = recovery.errorClass ?? "";
  return recovery.toolName === "mcp_call"
    || errorClass.startsWith("mcp_")
    || diagnosticKind.startsWith("mcp_")
    || (
      typeof errorData.server_key === "string"
      && typeof errorData.tool_name === "string"
    );
}

function mcpArgumentPayloadNearBudget(errorData: Record<string, unknown> | undefined): boolean {
  if (!errorData) {
    return false;
  }
  const argumentBytes = recoveryFiniteNumber(errorData.argument_bytes);
  const maxArgumentBytes = recoveryFiniteNumber(errorData.max_argument_bytes);
  if (argumentBytes === undefined || maxArgumentBytes === undefined || maxArgumentBytes <= 0) {
    return false;
  }
  return argumentBytes >= Math.floor(maxArgumentBytes * 0.8);
}

function refineMcpRecoveryNextAction(
  action: string,
  recovery: RuntimeToolRecoveryHint,
): string {
  if (
    recovery.stage === "ask_user"
    || recovery.requiresUserIntervention
    || recovery.recoverable === false
    || recovery.escalated
    || !isMcpRecovery(recovery)
  ) {
    return action;
  }
  const diagnosticKind = mcpDiagnosticKind(recovery);
  const errorClass = recovery.errorClass ?? "";
  const errorData = recovery.errorData;
  if (diagnosticKind === "mcp_tool_blocked" || errorClass === "mcp_tool_blocked") {
    return "use_allowed_mcp_tool_or_request_policy_change";
  }
  if (diagnosticKind === "mcp_arguments_too_large" || errorClass === "mcp_arguments_too_large") {
    return "reduce_mcp_argument_payload";
  }
  if (diagnosticKind === "invalid_tool_arguments" || errorClass === "invalid_tool_arguments") {
    return "fix_mcp_tool_arguments";
  }
  if (diagnosticKind === "mcp_rpc_error" || errorClass === "mcp_rpc_error") {
    return mcpRpcErrorCode(recovery) === "-32602"
      ? "fix_mcp_tool_arguments"
      : "inspect_mcp_rpc_error_and_switch_strategy";
  }
  if (mcpArgumentPayloadNearBudget(errorData)) {
    return "reduce_mcp_argument_payload";
  }
  if (diagnosticKind === "mcp_tool_result_error" || errorClass === "mcp_tool_result_error") {
    return "inspect_mcp_tool_result_and_change_arguments";
  }
  return action;
}

export function resolveRuntimeToolRecoveryRecommendedNextAction(
  recovery: RuntimeToolRecoveryHint,
): RuntimeToolRecoveryAction {
  return normalizeRuntimeToolRecoveryAction(
    refineMcpRecoveryNextAction(recovery.recommendedNextAction, recovery),
  );
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

function browserEnvironmentRecoveryPlan(recovery: RuntimeToolRecoveryHint): BrowserEnvironmentRecoveryPlan | null {
  return buildBrowserEnvironmentRecoveryPlan({
    errorClass: recovery.errorClass,
    errorData: recovery.errorData,
  });
}

function mcpEnvironmentRecoveryPlan(recovery: RuntimeToolRecoveryHint): McpEnvironmentRecoveryPlan | null {
  return buildMcpEnvironmentRecoveryPlan({
    errorClass: recovery.errorClass,
    errorData: recovery.errorData,
  });
}

function runtimeEnvironmentRecoveryPlan(recovery: RuntimeToolRecoveryHint): RuntimeEnvironmentRecoveryPlan | null {
  return buildRuntimeEnvironmentRecoveryPlan({
    errorClass: recovery.errorClass,
    errorMessage: recovery.errorMessage,
    errorData: recovery.errorData,
  });
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
    browserEnvironmentRecoveryPlan(base)
    && input.sameToolErrorCount >= RUNTIME_TOOL_RECOVERY_POLICY.escalation.browserEnvironmentAskUserThreshold
    && recoveryStageRank(base.stage) < recoveryStageRank("ask_user")
  ) {
    return {
      ...common,
      stage: "ask_user",
      recommendedNextAction: "request_environment_fix",
      recoverable: false,
      requiresUserIntervention: true,
      escalated: true,
      escalationReason: "browser_environment_error_repeated",
      baseStage,
      baseRecommendedNextAction,
    };
  }
  if (
    mcpEnvironmentRecoveryPlan(base)
    && input.sameToolErrorCount >= RUNTIME_TOOL_RECOVERY_POLICY.escalation.environmentAskUserThreshold
    && recoveryStageRank(base.stage) < recoveryStageRank("ask_user")
  ) {
    return {
      ...common,
      stage: "ask_user",
      recommendedNextAction: "request_environment_fix",
      recoverable: false,
      requiresUserIntervention: true,
      escalated: true,
      escalationReason: "mcp_environment_error_repeated",
      baseStage,
      baseRecommendedNextAction,
    };
  }
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

function normalizeTurnFailedRuntimeEnvironmentRecovery(
  payload: Record<string, unknown>,
): RuntimeToolRecoveryHint | undefined {
  const errorClass = payloadString(payload, "error_class") || payloadString(payload, "errorClass") || undefined;
  if (!errorClass) {
    return undefined;
  }
  const errorMessage = payloadString(payload, "error_message") || payloadString(payload, "errorMessage");
  const errorData = payloadRecord(payload, "error_data") ?? payloadRecord(payload, "errorData");
  const plan = buildRuntimeEnvironmentRecoveryPlan({
    errorClass,
    errorMessage,
    errorData,
  });
  if (!plan) {
    return undefined;
  }
  return {
    stage: "ask_user",
    reason: errorClass,
    recommendedNextAction:
      plan.errorCode === "CONFIG_MISSING"
        ? "ask_user_for_config_or_switch_provider"
        : "request_environment_fix",
    errorClass,
    errorMessage: compactRecoveryDetail(errorMessage),
    errorData,
    recoverable: false,
    requiresUserIntervention: true,
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

function actionInstruction(input: {
  action: string;
  recovery: RuntimeToolRecoveryHint;
}): string {
  const browserActionInstruction =
    input.action === "request_environment_fix"
      ? browserEnvironmentRecoveryActionInstruction(browserEnvironmentRecoveryPlan(input.recovery))
      : undefined;
  if (browserActionInstruction) {
    return browserActionInstruction;
  }
  const mcpActionInstruction =
    input.action === "request_environment_fix"
      ? mcpEnvironmentRecoveryActionInstruction(mcpEnvironmentRecoveryPlan(input.recovery))
      : undefined;
  if (mcpActionInstruction) {
    return mcpActionInstruction;
  }
  const runtimeActionInstruction =
    input.action === "request_environment_fix" || input.action === "ask_user_for_config_or_switch_provider"
      ? runtimeEnvironmentRecoveryActionInstruction(runtimeEnvironmentRecoveryPlan(input.recovery))
      : undefined;
  if (runtimeActionInstruction) {
    return runtimeActionInstruction;
  }
  return isRuntimeToolRecoveryAction(input.action)
    ? RUNTIME_TOOL_RECOVERY_ACTION_INSTRUCTIONS[input.action]
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
      runtimeEnvironmentRecovery: null,
      browserEnvironmentRecovery: null,
      mcpEnvironmentRecovery: null,
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
      recommendedNextAction: resolveRuntimeToolRecoveryRecommendedNextAction(recovery),
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
      runtimeEnvironmentRecovery: runtimeEnvironmentRecoveryPlan(recovery),
      browserEnvironmentRecovery: browserEnvironmentRecoveryPlan(recovery),
      mcpEnvironmentRecovery: mcpEnvironmentRecoveryPlan(recovery),
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
      recommendedNextAction: resolveRuntimeToolRecoveryRecommendedNextAction(recovery),
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
      runtimeEnvironmentRecovery: runtimeEnvironmentRecoveryPlan(recovery),
      browserEnvironmentRecovery: browserEnvironmentRecoveryPlan(recovery),
      mcpEnvironmentRecovery: mcpEnvironmentRecoveryPlan(recovery),
    };
  }
  const browserRecoveryPlan = browserEnvironmentRecoveryPlan(recovery);
  const mcpRecoveryPlan = mcpEnvironmentRecoveryPlan(recovery);
  const runtimeRecoveryPlan = runtimeEnvironmentRecoveryPlan(recovery);
  const effectiveRecommendedNextAction = resolveRuntimeToolRecoveryRecommendedNextAction(recovery);
  const actionClassification = classifyRuntimeToolRecoveryAction(effectiveRecommendedNextAction);
  const instruction = actionInstruction({
    action: effectiveRecommendedNextAction,
    recovery,
  });
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
  const recoverableValue = recovery.recoverable === undefined ? "<unknown>" : String(recovery.recoverable);
  const environmentFixInstruction = browserEnvironmentRecoveryFixInstruction({
    plan: browserRecoveryPlan,
    toolName,
  }) ?? mcpEnvironmentRecoveryFixInstruction({
    plan: mcpRecoveryPlan,
    toolName,
  }) ?? runtimeEnvironmentRecoveryFixInstruction({
    plan: runtimeRecoveryPlan,
    toolName,
  });
  const promptBlock = [
    "[Runtime Tool Recovery Hint]",
    "Action-first contract: treat structured recommended_next_action as authoritative; use recovery_stage and recoverable to choose execution discipline; use recovery_hint/error prose only as supporting evidence.",
    `Structured recovery fields: recommended_next_action=${effectiveRecommendedNextAction} recovery_stage=${recovery.stage} recoverable=${recoverableValue} requires_user_intervention=${requiresUserIntervention ? "true" : "false"}`,
    `Required next action: ${effectiveRecommendedNextAction}`,
    `Action family: ${actionClassification.family} reason=${actionClassification.reason}`,
    `Execution rule: ${instruction}`,
    `Recoverability: ${recoverability}`,
    `Recent tool issue: stage=${recovery.stage} tool=${toolName} error_class=${errorClass}`,
    errorMessage ? `Error detail: ${errorMessage}` : null,
    errorDataSummary ? `Structured error data: ${errorDataSummary}` : null,
    recovery.sameToolErrorCount
      ? `Repeated failure pressure: same_tool_error_count=${String(recovery.sameToolErrorCount)} escalated=${recovery.escalated ? "true" : "false"} reason=${recovery.escalationReason ?? "<none>"}`
      : null,
    recovery.escalated && recovery.baseStage
      ? `Base recovery was stage=${recovery.baseStage} action=${recovery.baseRecommendedNextAction ?? "<none>"} before gateway escalation.`
      : null,
    environmentFixInstruction,
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
    recommendedNextAction: effectiveRecommendedNextAction,
    actionFamily: actionClassification.family,
    actionReason: actionClassification.reason,
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
    runtimeEnvironmentRecovery: runtimeRecoveryPlan,
    browserEnvironmentRecovery: browserRecoveryPlan,
    mcpEnvironmentRecovery: mcpRecoveryPlan,
  };
}
