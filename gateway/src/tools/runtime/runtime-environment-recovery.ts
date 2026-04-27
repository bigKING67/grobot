import {
  buildEnvironmentRecoveryCore,
  formatEnvironmentCommands,
  formatEnvironmentRecoveryCoreFields,
  serializeEnvironmentRecoveryCorePlan,
  stringField,
  type EnvironmentRecoveryPlanCore,
} from "./environment-recovery";

export type RuntimeEnvironmentRecoveryErrorCode =
  | "CONFIG_MISSING"
  | "TOOL_CONTEXT_MISSING"
  | "TOOL_CONTEXT_INVALID"
  | "RUNTIME_STATE_UNAVAILABLE";

export type RuntimeEnvironmentRecoveryAction =
  | "fix_config_or_switch_provider_and_check_status"
  | "fix_tool_context_and_check_status"
  | "restart_or_clear_runtime_state_and_check_status";

export interface RuntimeEnvironmentRecoveryPlan
  extends EnvironmentRecoveryPlanCore<RuntimeEnvironmentRecoveryErrorCode, RuntimeEnvironmentRecoveryAction> {
  errorClass: string;
  detail: string | null;
  sourcePath: string | null;
  requiredConfig: string | null;
  workDir: string | null;
}

function compactRuntimeRecoveryDetail(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\s+/g, "_").slice(0, 180);
}

function inferRequiredConfig(errorMessage: string | null): string | null {
  if (!errorMessage) {
    return null;
  }
  const candidates = [
    "provider_options.kimi.files_enabled=true",
    "model_config.base_url",
    "model_config.api_key",
    "model_config",
    "kimi-k2.5",
  ];
  return candidates.find((candidate) => errorMessage.includes(candidate)) ?? null;
}

function runtimeEnvironmentErrorCode(errorClass: string | undefined): RuntimeEnvironmentRecoveryErrorCode | null {
  if (errorClass === "config_missing") {
    return "CONFIG_MISSING";
  }
  if (errorClass === "tool_context_missing") {
    return "TOOL_CONTEXT_MISSING";
  }
  if (errorClass === "tool_context_invalid") {
    return "TOOL_CONTEXT_INVALID";
  }
  if (errorClass === "runtime_state_unavailable") {
    return "RUNTIME_STATE_UNAVAILABLE";
  }
  return null;
}

function runtimeEnvironmentRecoveryAction(
  errorCode: RuntimeEnvironmentRecoveryErrorCode,
): RuntimeEnvironmentRecoveryAction {
  if (errorCode === "CONFIG_MISSING") {
    return "fix_config_or_switch_provider_and_check_status";
  }
  if (errorCode === "RUNTIME_STATE_UNAVAILABLE") {
    return "restart_or_clear_runtime_state_and_check_status";
  }
  return "fix_tool_context_and_check_status";
}

function runtimeEnvironmentRecoveryCommands(errorCode: RuntimeEnvironmentRecoveryErrorCode): string[] {
  if (errorCode === "CONFIG_MISSING") {
    return ["grobot status --json", "grobot status --probe --json"];
  }
  return ["grobot status --json"];
}

export function buildRuntimeEnvironmentRecoveryPlan(input: {
  errorClass: string | undefined;
  errorMessage?: string | null;
  errorData?: Record<string, unknown>;
}): RuntimeEnvironmentRecoveryPlan | null {
  const errorCode = runtimeEnvironmentErrorCode(input.errorClass);
  if (!errorCode || !input.errorClass) {
    return null;
  }
  return {
    ...buildEnvironmentRecoveryCore({
      errorCode,
      action: runtimeEnvironmentRecoveryAction(errorCode),
      commands: runtimeEnvironmentRecoveryCommands(errorCode),
    }),
    errorClass: input.errorClass,
    detail: compactRuntimeRecoveryDetail(
      stringField(input.errorData, "recovery_hint")
        ?? stringField(input.errorData, "diagnostic_kind")
        ?? input.errorMessage
        ?? null,
    ),
    sourcePath: stringField(input.errorData, "source"),
    requiredConfig: compactRuntimeRecoveryDetail(
      stringField(input.errorData, "required_config") ?? inferRequiredConfig(input.errorMessage ?? null),
    ),
    workDir: stringField(input.errorData, "work_dir"),
  };
}

export function formatRuntimeEnvironmentRecoveryPlan(
  plan: RuntimeEnvironmentRecoveryPlan | null | undefined,
): string {
  if (!plan) {
    return "<none>";
  }
  return formatEnvironmentRecoveryCoreFields(plan, [
    `error_class=${plan.errorClass}`,
    `detail=${plan.detail ?? "<none>"}`,
    `source=${plan.sourcePath ?? "<none>"}`,
    `required_config=${plan.requiredConfig ?? "<none>"}`,
    `work_dir=${plan.workDir ?? "<none>"}`,
  ]);
}

export function serializeRuntimeEnvironmentRecoveryPlan(
  plan: RuntimeEnvironmentRecoveryPlan | null | undefined,
): Record<string, unknown> | null {
  const core = serializeEnvironmentRecoveryCorePlan(plan);
  if (!plan || !core) {
    return null;
  }
  return {
    ...core,
    error_class: plan.errorClass,
    detail: plan.detail,
    source_path: plan.sourcePath,
    required_config: plan.requiredConfig,
    work_dir: plan.workDir,
  };
}

export function runtimeEnvironmentRecoveryActionInstruction(
  plan: RuntimeEnvironmentRecoveryPlan | null | undefined,
): string | undefined {
  if (!plan) {
    return undefined;
  }
  const commands = formatEnvironmentCommands(plan);
  if (plan.errorCode === "CONFIG_MISSING") {
    return [
      `Ask the user to provide the missing runtime configuration or switch to a configured provider/tool path; inspect readiness with ${commands};`,
      "do not retry the failing tool until status/probe confirms the configuration is usable.",
    ].join(" ");
  }
  if (plan.errorCode === "RUNTIME_STATE_UNAVAILABLE") {
    return [
      `Ask the user to inspect runtime state with ${commands};`,
      "if state remains unavailable, restart the current grobot session before retrying the failing tool.",
    ].join(" ");
  }
  return [
    `Ask the user to fix the runtime tool context and inspect readiness with ${commands};`,
    "retry only after the tool context has a valid workspace and tool surface.",
  ].join(" ");
}

export function runtimeEnvironmentRecoveryFixInstruction(input: {
  plan: RuntimeEnvironmentRecoveryPlan | null | undefined;
  toolName: string;
}): string | undefined {
  const plan = input.plan;
  if (!plan) {
    return undefined;
  }
  const toolName = input.toolName.trim().length > 0 ? input.toolName.trim() : "the failing tool";
  const commands = formatEnvironmentCommands(plan);
  if (plan.errorCode === "CONFIG_MISSING") {
    const required = plan.requiredConfig ? ` Missing config: ${plan.requiredConfig}.` : "";
    return `Runtime environment fix: Do not retry ${toolName} automatically. Ask the user to provide missing config or switch provider/tool path, run ${commands}, and retry only after status/probe passes.${required}`;
  }
  if (plan.errorCode === "RUNTIME_STATE_UNAVAILABLE") {
    return `Runtime environment fix: Do not retry ${toolName} automatically. Ask the user to run ${commands}; if runtime state remains unavailable, restart the current grobot session before retrying.`;
  }
  return `Runtime environment fix: Do not retry ${toolName} automatically. Ask the user to fix the tool context/work_dir, run ${commands}, and retry only after the runtime tool context is valid.`;
}
