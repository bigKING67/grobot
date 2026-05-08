import { RUNTIME_TOOL_RECOVERY_POLICY } from "../tool-recovery-policy";
import type {
  RuntimeToolRecoveryEscalationFields,
  RuntimeToolRecoveryHint,
  RuntimeToolRecoveryStage,
} from "./contract";
import {
  browserEnvironmentRecoveryPlan,
  mcpEnvironmentRecoveryPlan,
  runtimeEnvironmentRecoveryPlan,
} from "./environment-plans";

function normalizeRecoveryKeyPart(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "<none>";
}

export function recoveryRepeatKey(recovery: RuntimeToolRecoveryHint): string {
  return recoveryRepeatKeyFromParts({
    toolName: recovery.toolName,
    errorClass: recovery.errorClass ?? recovery.reason,
  });
}

export function recoveryRepeatKeyFromParts(input: {
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

export function applyRepeatedRecoveryEscalation(input: {
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
    runtimeEnvironmentRecoveryPlan(base)
    && input.sameToolErrorCount >= RUNTIME_TOOL_RECOVERY_POLICY.escalation.environmentAskUserThreshold
    && recoveryStageRank(base.stage) < recoveryStageRank("ask_user")
  ) {
    return {
      ...common,
      stage: "ask_user",
      recommendedNextAction: "ask_user_for_config_or_switch_provider",
      recoverable: false,
      requiresUserIntervention: true,
      escalated: true,
      escalationReason: "runtime_environment_error_repeated",
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
