import type { BrowserEnvironmentRecoveryPlan } from "../browser-environment-recovery";
import type { McpEnvironmentRecoveryPlan } from "../mcp-environment-recovery";
import type { RuntimeEnvironmentRecoveryPlan } from "../runtime-environment-recovery";

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

export interface RuntimeToolSurfaceMetricsState {
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

export const RUNTIME_TOOL_RECOVERY_STAGES: readonly RuntimeToolRecoveryStage[] = [
  "none",
  "observe_first",
  "local_fix",
  "strategy_switch",
  "ask_user",
];

export const RUNTIME_TOOL_RECOVERY_PROMPT_MAX_CHARS = 1800;

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
