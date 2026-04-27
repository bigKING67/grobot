import type { RuntimeToolRecoveryReadinessSummary } from "./tool-recovery-readiness";
import {
  formatBrowserEnvironmentRecoveryPlan,
  type BrowserEnvironmentRecoveryPlan,
} from "./browser-environment-recovery";
import {
  formatMcpEnvironmentRecoveryPlan,
  type McpEnvironmentRecoveryPlan,
} from "./mcp-environment-recovery";
import {
  formatRuntimeEnvironmentRecoveryPlan,
  type RuntimeEnvironmentRecoveryPlan,
} from "./runtime-environment-recovery";

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

export type RuntimeToolRecoveryReadinessGateBlockerKind =
  | "none"
  | "runtime_environment"
  | "browser_environment"
  | "mcp_environment"
  | "operator_action"
  | "automatic_recovery_policy"
  | "readiness_state";

export interface RuntimeToolRecoveryReadinessGateDecision {
  status: RuntimeToolRecoveryReadinessGateStatus;
  passed: boolean;
  blocking: boolean;
  severity: RuntimeToolRecoveryReadinessGateSeverity;
  reason: RuntimeToolRecoveryReadinessGateReason;
  blockerKind: RuntimeToolRecoveryReadinessGateBlockerKind;
  blockerCode: string | null;
  blockerAction: string | null;
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
  attentionRuntimeEnvironmentRecovery: RuntimeEnvironmentRecoveryPlan | null;
  attentionBrowserEnvironmentRecovery: BrowserEnvironmentRecoveryPlan | null;
  attentionMcpEnvironmentRecovery: McpEnvironmentRecoveryPlan | null;
}

interface RuntimeToolRecoveryGateStatusResolution {
  status: RuntimeToolRecoveryReadinessGateStatus;
  severity: RuntimeToolRecoveryReadinessGateSeverity;
  reason: RuntimeToolRecoveryReadinessGateReason;
}

interface RuntimeToolRecoveryGateBlockerResolution {
  kind: RuntimeToolRecoveryReadinessGateBlockerKind;
  code: string | null;
  action: string | null;
}

function gateStatus(input: RuntimeToolRecoveryReadinessSummary): RuntimeToolRecoveryGateStatusResolution {
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

function environmentRecoveryBlocker(input: RuntimeToolRecoveryReadinessSummary): RuntimeToolRecoveryGateBlockerResolution | null {
  if (input.attentionRuntimeEnvironmentRecovery) {
    return {
      kind: "runtime_environment",
      code: input.attentionRuntimeEnvironmentRecovery.errorCode,
      action: input.attentionRuntimeEnvironmentRecovery.action,
    };
  }
  if (input.attentionBrowserEnvironmentRecovery) {
    return {
      kind: "browser_environment",
      code: input.attentionBrowserEnvironmentRecovery.errorCode,
      action: input.attentionBrowserEnvironmentRecovery.action,
    };
  }
  if (input.attentionMcpEnvironmentRecovery) {
    return {
      kind: "mcp_environment",
      code: input.attentionMcpEnvironmentRecovery.errorCode,
      action: input.attentionMcpEnvironmentRecovery.action,
    };
  }
  return null;
}

function normalizeGateReasonPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function gateBlocker(input: {
  readiness: RuntimeToolRecoveryReadinessSummary;
  gate: RuntimeToolRecoveryGateStatusResolution;
}): RuntimeToolRecoveryGateBlockerResolution {
  if (input.gate.status !== "fail") {
    return {
      kind: "none",
      code: null,
      action: null,
    };
  }
  const environmentBlocker = environmentRecoveryBlocker(input.readiness);
  if (environmentBlocker) {
    return environmentBlocker;
  }
  if (input.gate.reason === "readiness_state_inconsistent") {
    return {
      kind: "readiness_state",
      code: input.gate.reason,
      action: null,
    };
  }
  if (input.readiness.operatorActionRequired) {
    return {
      kind: "operator_action",
      code: input.readiness.attentionErrorClass ?? input.gate.reason,
      action: input.readiness.recommendedNextAction,
    };
  }
  return {
    kind: "automatic_recovery_policy",
    code: input.gate.reason,
    action: input.readiness.recommendedNextAction,
  };
}

export function runtimeToolRecoveryGateAdaptationReason(
  gate: RuntimeToolRecoveryReadinessGateDecision,
): string {
  const environmentBlocker =
    gate.blockerKind === "runtime_environment"
    || gate.blockerKind === "browser_environment"
    || gate.blockerKind === "mcp_environment";
  if (environmentBlocker && gate.blockerCode) {
    return `recovery_gate_${gate.blockerKind}_${normalizeGateReasonPart(gate.blockerCode)}`;
  }
  return `recovery_gate_${gate.reason}`;
}

export function buildRuntimeToolRecoveryReadinessGate(input: {
  readiness: RuntimeToolRecoveryReadinessSummary;
}): RuntimeToolRecoveryReadinessGateDecision {
  const gate = gateStatus(input.readiness);
  const blocker = gateBlocker({
    readiness: input.readiness,
    gate,
  });
  return {
    status: gate.status,
    passed: gate.status !== "fail",
    blocking: gate.status === "fail",
    severity: gate.severity,
    reason: gate.reason,
    blockerKind: blocker.kind,
    blockerCode: blocker.code,
    blockerAction: blocker.action,
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
    attentionRuntimeEnvironmentRecovery: input.readiness.attentionRuntimeEnvironmentRecovery,
    attentionBrowserEnvironmentRecovery: input.readiness.attentionBrowserEnvironmentRecovery,
    attentionMcpEnvironmentRecovery: input.readiness.attentionMcpEnvironmentRecovery,
  };
}

export function formatRuntimeToolRecoveryGateFields(
  gate: RuntimeToolRecoveryReadinessGateDecision,
): string {
  return [
    `status=${gate.status}`,
    `passed=${gate.passed ? "true" : "false"}`,
    `blocking=${gate.blocking ? "true" : "false"}`,
    `severity=${gate.severity}`,
    `reason=${gate.reason}`,
    `blocker=${gate.blockerKind}`,
    `blocker_code=${gate.blockerCode ?? "<none>"}`,
    `blocker_action=${gate.blockerAction ?? "<none>"}`,
    `action=${gate.recommendedNextAction ?? "<none>"}`,
    `readiness=${gate.readinessStatus}`,
    `auto_recovery_allowed=${gate.automaticRecoveryAllowed ? "true" : "false"}`,
    `operator_action_required=${gate.operatorActionRequired ? "true" : "false"}`,
    `attention_key=${gate.attentionRecoveryKey ?? "<none>"}`,
    `attention_stage=${gate.attentionStage ?? "<none>"}`,
    `runtime_environment_recovery=${formatRuntimeEnvironmentRecoveryPlan(gate.attentionRuntimeEnvironmentRecovery)}`,
    `browser_environment_recovery=${formatBrowserEnvironmentRecoveryPlan(gate.attentionBrowserEnvironmentRecovery)}`,
    `mcp_environment_recovery=${formatMcpEnvironmentRecoveryPlan(gate.attentionMcpEnvironmentRecovery)}`,
    `policy_version=${gate.policyVersion}`,
    `health=${gate.healthLevel}/${String(gate.healthScore)}`,
    `health_thresholds=${String(gate.watchScoreThreshold)}/${String(gate.riskScoreThreshold)}`,
  ].join(" ");
}
