import type { RuntimeToolRecoveryHealthSummary } from "./tool-recovery-timeline";
import type { RuntimeToolRecoveryActionFamily } from "./tool-events";
import {
  getRuntimeToolRecoveryPolicySnapshot,
  type RuntimeToolRecoveryPolicySnapshot,
} from "./tool-recovery-policy";
import {
  formatRuntimeToolEnvironmentRecoveryFields,
  type BrowserEnvironmentRecoveryPlan,
  type McpEnvironmentRecoveryPlan,
  type RuntimeEnvironmentRecoveryPlan,
} from "./environment-recovery-families";

export type RuntimeToolRecoveryReadinessStatus = "ready" | "degraded" | "blocked";

export interface RuntimeToolRecoveryReadinessSummary {
  status: RuntimeToolRecoveryReadinessStatus;
  ready: boolean;
  automaticRecoveryAllowed: boolean;
  operatorActionRequired: boolean;
  reason: string;
  recommendedNextAction: string | null;
  recommendedActionFamily?: RuntimeToolRecoveryActionFamily | null;
  recommendedActionReason?: string | null;
  policyVersion: string;
  healthLevel: RuntimeToolRecoveryHealthSummary["level"];
  healthScore: number;
  riskScoreThreshold: number;
  watchScoreThreshold: number;
  attentionRecoveryKey: string | null;
  attentionSource: RuntimeToolRecoveryHealthSummary["attentionSource"];
  attentionStage: RuntimeToolRecoveryHealthSummary["attentionStage"];
  attentionToolName: string | null;
  attentionErrorClass: string | null;
  attentionRequiresUserIntervention: boolean;
  attentionActionFamily?: RuntimeToolRecoveryActionFamily | null;
  attentionActionReason?: string | null;
  attentionRuntimeEnvironmentRecovery: RuntimeEnvironmentRecoveryPlan | null;
  attentionBrowserEnvironmentRecovery: BrowserEnvironmentRecoveryPlan | null;
  attentionMcpEnvironmentRecovery: McpEnvironmentRecoveryPlan | null;
}

function readinessStatusForHealth(level: RuntimeToolRecoveryHealthSummary["level"]): RuntimeToolRecoveryReadinessStatus {
  if (level === "risk") {
    return "blocked";
  }
  if (level === "watch") {
    return "degraded";
  }
  return "ready";
}

function readinessReason(input: {
  status: RuntimeToolRecoveryReadinessStatus;
  healthReason: string;
}): string {
  if (input.status === "ready") {
    return "stable";
  }
  if (input.status === "blocked") {
    return `health_risk:${input.healthReason}`;
  }
  return `health_watch:${input.healthReason}`;
}

export function buildRuntimeToolRecoveryReadinessSummary(input: {
  health: RuntimeToolRecoveryHealthSummary;
  policy?: RuntimeToolRecoveryPolicySnapshot;
}): RuntimeToolRecoveryReadinessSummary {
  const policy = input.policy ?? getRuntimeToolRecoveryPolicySnapshot();
  const status = readinessStatusForHealth(input.health.level);
  const ready = status === "ready";
  const operatorActionRequired =
    input.health.attentionRequiresUserIntervention
    || input.health.activeNonrecoverableCount > 0
    || input.health.hasStuckNonrecoverable;
  return {
    status,
    ready,
    automaticRecoveryAllowed: status !== "blocked" && !operatorActionRequired,
    operatorActionRequired,
    reason: readinessReason({
      status,
      healthReason: input.health.reason,
    }),
    recommendedNextAction: input.health.recommendedNextAction,
    recommendedActionFamily: input.health.recommendedActionFamily ?? null,
    recommendedActionReason: input.health.recommendedActionReason ?? null,
    policyVersion: policy.version,
    healthLevel: input.health.level,
    healthScore: input.health.score,
    riskScoreThreshold: policy.health.riskScoreThreshold,
    watchScoreThreshold: policy.health.watchScoreThreshold,
    attentionRecoveryKey: input.health.attentionRecoveryKey,
    attentionSource: input.health.attentionSource,
    attentionStage: input.health.attentionStage,
    attentionToolName: input.health.attentionToolName,
    attentionErrorClass: input.health.attentionErrorClass,
    attentionRequiresUserIntervention: input.health.attentionRequiresUserIntervention,
    attentionActionFamily: input.health.attentionActionFamily ?? null,
    attentionActionReason: input.health.attentionActionReason ?? null,
    attentionRuntimeEnvironmentRecovery: input.health.attentionRuntimeEnvironmentRecovery,
    attentionBrowserEnvironmentRecovery: input.health.attentionBrowserEnvironmentRecovery,
    attentionMcpEnvironmentRecovery: input.health.attentionMcpEnvironmentRecovery,
  };
}

export function formatRuntimeToolRecoveryReadinessFields(
  summary: RuntimeToolRecoveryReadinessSummary,
): string {
  return [
    `status=${summary.status}`,
    `ready=${summary.ready ? "true" : "false"}`,
    `auto_recovery_allowed=${summary.automaticRecoveryAllowed ? "true" : "false"}`,
    `operator_action_required=${summary.operatorActionRequired ? "true" : "false"}`,
    `reason=${summary.reason}`,
    `action=${summary.recommendedNextAction ?? "<none>"}`,
    `action_family=${summary.recommendedActionFamily ?? "<none>"}`,
    `attention_key=${summary.attentionRecoveryKey ?? "<none>"}`,
    `attention_stage=${summary.attentionStage ?? "<none>"}`,
    ...formatRuntimeToolEnvironmentRecoveryFields({
      runtimeEnvironmentRecovery: summary.attentionRuntimeEnvironmentRecovery,
      browserEnvironmentRecovery: summary.attentionBrowserEnvironmentRecovery,
      mcpEnvironmentRecovery: summary.attentionMcpEnvironmentRecovery,
    }),
    `policy_version=${summary.policyVersion}`,
    `health=${summary.healthLevel}/${String(summary.healthScore)}`,
    `health_thresholds=${String(summary.watchScoreThreshold)}/${String(summary.riskScoreThreshold)}`,
  ].join(" ");
}
