import {
  browserEnvironmentRecoveryActionInstruction,
  browserEnvironmentRecoveryFixInstruction,
  buildBrowserEnvironmentRecoveryPlan,
  type BrowserEnvironmentRecoveryPlan,
} from "../browser-environment-recovery";
import {
  buildMcpEnvironmentRecoveryPlan,
  mcpEnvironmentRecoveryActionInstruction,
  mcpEnvironmentRecoveryFixInstruction,
  type McpEnvironmentRecoveryPlan,
} from "../mcp-environment-recovery";
import {
  buildRuntimeEnvironmentRecoveryPlan,
  runtimeEnvironmentRecoveryActionInstruction,
  runtimeEnvironmentRecoveryFixInstruction,
  type RuntimeEnvironmentRecoveryPlan,
} from "../runtime-environment-recovery";
import { isRuntimeToolRecoveryAction } from "./actions";
import { RUNTIME_TOOL_RECOVERY_ACTION_INSTRUCTIONS, type RuntimeToolRecoveryHint } from "./contract";

function providerRecoveryActionInstruction(input: {
  action: string;
  recovery: RuntimeToolRecoveryHint;
}): string | undefined {
  const errorData = input.recovery.errorData ?? {};
  const diagnosticKind = typeof errorData.diagnostic_kind === "string" ? errorData.diagnostic_kind.trim() : "";
  const source = typeof errorData.source === "string" ? errorData.source.trim() : "";
  const errorClass = input.recovery.errorClass ?? "";
  const providerLike =
    diagnosticKind.startsWith("upstream_")
    || errorClass.startsWith("upstream_")
    || source.startsWith("model.")
    || typeof errorData.provider === "string"
    || typeof errorData.http_status === "number";
  if (!providerLike) {
    return undefined;
  }
  const provider = typeof errorData.provider === "string" && errorData.provider.trim()
    ? ` provider=${errorData.provider.trim()}`
    : "";
  const httpStatus = typeof errorData.http_status === "number" && Number.isFinite(errorData.http_status)
    ? ` http_status=${String(Math.trunc(errorData.http_status))}`
    : "";
  if (input.action === "retry_with_smaller_scope_or_wait") {
    return `Retry provider request only after changing one variable: wait/backoff, reduce request scope, or switch configured provider/model.${provider}${httpStatus}`;
  }
  if (
    input.action === "ask_user_for_config_or_switch_provider"
    || input.recovery.recoverable === false
  ) {
    return `Ask the user to inspect provider status/body, wait for provider-side recovery, or switch to another configured provider/model; do not retry automatically when retryable=false or attempts are exhausted.${provider}${httpStatus}`;
  }
  return undefined;
}

export function browserEnvironmentRecoveryPlan(recovery: RuntimeToolRecoveryHint): BrowserEnvironmentRecoveryPlan | null {
  return buildBrowserEnvironmentRecoveryPlan({
    errorClass: recovery.errorClass,
    errorData: recovery.errorData,
  });
}

export function mcpEnvironmentRecoveryPlan(recovery: RuntimeToolRecoveryHint): McpEnvironmentRecoveryPlan | null {
  return buildMcpEnvironmentRecoveryPlan({
    errorClass: recovery.errorClass,
    errorData: recovery.errorData,
  });
}

export function runtimeEnvironmentRecoveryPlan(recovery: RuntimeToolRecoveryHint): RuntimeEnvironmentRecoveryPlan | null {
  return buildRuntimeEnvironmentRecoveryPlan({
    errorClass: recovery.errorClass,
    errorMessage: recovery.errorMessage,
    errorData: recovery.errorData,
  });
}

export function actionInstruction(input: {
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
  const providerActionInstruction = providerRecoveryActionInstruction(input);
  if (providerActionInstruction) {
    return providerActionInstruction;
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

export function environmentFixInstruction(input: {
  browserRecoveryPlan: BrowserEnvironmentRecoveryPlan | null;
  mcpRecoveryPlan: McpEnvironmentRecoveryPlan | null;
  runtimeRecoveryPlan: RuntimeEnvironmentRecoveryPlan | null;
  toolName: string;
}): string | undefined {
  return browserEnvironmentRecoveryFixInstruction({
    plan: input.browserRecoveryPlan,
    toolName: input.toolName,
  }) ?? mcpEnvironmentRecoveryFixInstruction({
    plan: input.mcpRecoveryPlan,
    toolName: input.toolName,
  }) ?? runtimeEnvironmentRecoveryFixInstruction({
    plan: input.runtimeRecoveryPlan,
    toolName: input.toolName,
  });
}
