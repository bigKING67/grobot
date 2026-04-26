import type { RuntimeToolRecoveryReadinessSummary } from "./tool-recovery-readiness";

export type RuntimeToolRecoveryReadinessGateStatus = "pass" | "warn" | "fail";

export type RuntimeToolRecoveryReadinessGateSeverity = "none" | "warning" | "error";

export type RuntimeToolRecoveryReadinessGateReason =
  | "ready"
  | "degraded_auto_recovery_allowed"
  | "blocked_operator_action_required"
  | "blocked_auto_recovery_denied"
  | "operator_action_required"
  | "automatic_recovery_denied"
  | "readiness_state_inconsistent";

export interface RuntimeToolRecoveryReadinessGateDecision {
  status: RuntimeToolRecoveryReadinessGateStatus;
  passed: boolean;
  blocking: boolean;
  severity: RuntimeToolRecoveryReadinessGateSeverity;
  reason: RuntimeToolRecoveryReadinessGateReason;
  recommendedNextAction: string | null;
  readinessStatus: RuntimeToolRecoveryReadinessSummary["status"];
  readinessReady: boolean;
  readinessReason: string;
  automaticRecoveryAllowed: boolean;
  operatorActionRequired: boolean;
  policyVersion: string;
  healthLevel: RuntimeToolRecoveryReadinessSummary["healthLevel"];
  healthScore: number;
  riskScoreThreshold: number;
  watchScoreThreshold: number;
  attentionRecoveryKey: string | null;
  attentionSource: RuntimeToolRecoveryReadinessSummary["attentionSource"];
  attentionStage: RuntimeToolRecoveryReadinessSummary["attentionStage"];
  attentionToolName: string | null;
  attentionErrorClass: string | null;
  attentionRequiresUserIntervention: boolean;
}

function gateStatus(input: RuntimeToolRecoveryReadinessSummary): {
  status: RuntimeToolRecoveryReadinessGateStatus;
  severity: RuntimeToolRecoveryReadinessGateSeverity;
  reason: RuntimeToolRecoveryReadinessGateReason;
} {
  if (input.ready !== (input.status === "ready")) {
    return {
      status: "fail",
      severity: "error",
      reason: "readiness_state_inconsistent",
    };
  }
  if (input.operatorActionRequired) {
    return {
      status: "fail",
      severity: "error",
      reason: input.status === "blocked" ? "blocked_operator_action_required" : "operator_action_required",
    };
  }
  if (!input.automaticRecoveryAllowed) {
    return {
      status: "fail",
      severity: "error",
      reason: input.status === "blocked" ? "blocked_auto_recovery_denied" : "automatic_recovery_denied",
    };
  }
  if (input.status === "blocked") {
    return {
      status: "fail",
      severity: "error",
      reason: "blocked_auto_recovery_denied",
    };
  }
  if (input.status === "degraded") {
    return {
      status: "warn",
      severity: "warning",
      reason: "degraded_auto_recovery_allowed",
    };
  }
  return {
    status: "pass",
    severity: "none",
    reason: "ready",
  };
}

export function buildRuntimeToolRecoveryReadinessGate(input: {
  readiness: RuntimeToolRecoveryReadinessSummary;
}): RuntimeToolRecoveryReadinessGateDecision {
  const gate = gateStatus(input.readiness);
  return {
    status: gate.status,
    passed: gate.status !== "fail",
    blocking: gate.status === "fail",
    severity: gate.severity,
    reason: gate.reason,
    recommendedNextAction: input.readiness.recommendedNextAction,
    readinessStatus: input.readiness.status,
    readinessReady: input.readiness.ready,
    readinessReason: input.readiness.reason,
    automaticRecoveryAllowed: input.readiness.automaticRecoveryAllowed,
    operatorActionRequired: input.readiness.operatorActionRequired,
    policyVersion: input.readiness.policyVersion,
    healthLevel: input.readiness.healthLevel,
    healthScore: input.readiness.healthScore,
    riskScoreThreshold: input.readiness.riskScoreThreshold,
    watchScoreThreshold: input.readiness.watchScoreThreshold,
    attentionRecoveryKey: input.readiness.attentionRecoveryKey,
    attentionSource: input.readiness.attentionSource,
    attentionStage: input.readiness.attentionStage,
    attentionToolName: input.readiness.attentionToolName,
    attentionErrorClass: input.readiness.attentionErrorClass,
    attentionRequiresUserIntervention: input.readiness.attentionRequiresUserIntervention,
  };
}
