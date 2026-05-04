import { classifyRuntimeToolRecoveryAction } from "./actions";
import type {
  RuntimeToolRecoveryFeedback,
  RuntimeToolRecoveryFeedbackSeverity,
  RuntimeToolRecoveryHint,
  RuntimeToolRecoveryStage,
  RuntimeToolSurfaceMetricsSnapshot,
} from "./contract";
import {
  actionInstruction,
  browserEnvironmentRecoveryPlan,
  environmentFixInstruction,
  mcpEnvironmentRecoveryPlan,
  runtimeEnvironmentRecoveryPlan,
} from "./environment-plans";
import { resolveRuntimeToolRecoveryRecommendedNextAction } from "./mcp-recovery";
import { compactRecoveryErrorData, compactRuntimeToolRecoveryPrompt } from "./prompt";
import { RUNTIME_TOOL_RECOVERY_POLICY } from "../tool-recovery-policy";

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
  const environmentFix = environmentFixInstruction({
    browserRecoveryPlan,
    mcpRecoveryPlan,
    runtimeRecoveryPlan,
    toolName,
  });
  const promptBlock = compactRuntimeToolRecoveryPrompt({
    requiredLines: [
      "[Runtime Tool Recovery Hint]",
      "Action-first contract: treat structured recommended_next_action as authoritative; use recovery_stage and recoverable to choose execution discipline; use recovery_hint/error prose only as supporting evidence.",
      `Structured recovery fields: recommended_next_action=${effectiveRecommendedNextAction} recovery_stage=${recovery.stage} recoverable=${recoverableValue} requires_user_intervention=${requiresUserIntervention ? "true" : "false"}`,
      `Required next action: ${effectiveRecommendedNextAction}`,
      `Action family: ${actionClassification.family} reason=${actionClassification.reason}`,
      `Execution rule: ${instruction}`,
      `Recoverability: ${recoverability}`,
      `Recent tool issue: stage=${recovery.stage} tool=${toolName} error_class=${errorClass}`,
      `Execution discipline: ${executionDiscipline}`,
    ],
    detailLines: [
      environmentFix,
      recovery.sameToolErrorCount
        ? `Repeated failure pressure: same_tool_error_count=${String(recovery.sameToolErrorCount)} escalated=${recovery.escalated ? "true" : "false"} reason=${recovery.escalationReason ?? "<none>"}`
        : null,
      recovery.escalated && recovery.baseStage
        ? `Base recovery was stage=${recovery.baseStage} action=${recovery.baseRecommendedNextAction ?? "<none>"} before gateway escalation.`
        : null,
      errorMessage ? `Error detail: ${errorMessage}` : null,
      errorDataSummary ? `Structured error data: ${errorDataSummary}` : null,
    ],
  });
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
