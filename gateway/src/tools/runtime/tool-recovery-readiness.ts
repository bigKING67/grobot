import type { RuntimeToolRecoveryHealthSummary } from "./tool-recovery-timeline";
import {
  getRuntimeToolRecoveryPolicySnapshot,
  type RuntimeToolRecoveryPolicySnapshot,
} from "./tool-recovery-policy";

export type RuntimeToolRecoveryReadinessStatus = "ready" | "degraded" | "blocked";

export interface RuntimeToolRecoveryReadinessSummary {
  status: RuntimeToolRecoveryReadinessStatus;
  ready: boolean;
  automaticRecoveryAllowed: boolean;
  operatorActionRequired: boolean;
  reason: string;
  recommendedNextAction: string | null;
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
  };
}
