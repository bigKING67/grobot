import { normalizeRuntimeToolRecoveryAction } from "./actions";
import type { RuntimeToolRecoveryAction, RuntimeToolRecoveryHint } from "./contract";
import { normalizeRecord, recoveryFiniteNumber, recoveryString } from "./payload";

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
