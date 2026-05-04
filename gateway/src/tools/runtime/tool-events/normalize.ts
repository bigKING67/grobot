import { buildRuntimeEnvironmentRecoveryPlan } from "../runtime-environment-recovery";
import {
  RUNTIME_TOOL_RECOVERY_STAGES,
  type RuntimeToolRecoveryHint,
  type RuntimeToolRecoveryStage,
} from "./contract";
import {
  compactRecoveryDetail,
  payloadBoolean,
  payloadIsoString,
  payloadRecord,
  payloadString,
} from "./payload";

export function normalizeRecoveryStage(value: unknown): RuntimeToolRecoveryStage | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return RUNTIME_TOOL_RECOVERY_STAGES.includes(value as RuntimeToolRecoveryStage)
    ? value as RuntimeToolRecoveryStage
    : undefined;
}

export function normalizePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function normalizeRecoveryHint(payload: Record<string, unknown>): RuntimeToolRecoveryHint | undefined {
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

export function normalizeTurnFailedRuntimeEnvironmentRecovery(
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
