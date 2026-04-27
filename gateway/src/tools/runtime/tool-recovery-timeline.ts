import type {
  RuntimeToolRecoveryFeedback,
  RuntimeToolRecoveryHint,
  RuntimeToolRecoveryStage,
  RuntimeToolSurfaceMetricsSnapshot,
} from "./tool-events";
import {
  resolveRuntimeToolRecoveryConsumption,
  type RuntimeToolSurfaceAdaptationSnapshot,
} from "./tool-surface-adaptation-state";
import {
  buildBrowserEnvironmentRecoveryPlan,
  type BrowserEnvironmentRecoveryPlan,
} from "./browser-environment-recovery";
import {
  buildMcpEnvironmentRecoveryPlan,
  type McpEnvironmentRecoveryPlan,
} from "./mcp-environment-recovery";
import {
  buildRuntimeEnvironmentRecoveryPlan,
  type RuntimeEnvironmentRecoveryPlan,
} from "./runtime-environment-recovery";
import { RUNTIME_TOOL_RECOVERY_POLICY, type RuntimeToolRecoveryPolicySnapshot } from "./tool-recovery-policy";

export interface RuntimeToolRecoveryIdentityInput {
  observedAt: string | null;
  toolName: string | null;
  errorClass: string | null;
  stage: RuntimeToolRecoveryStage | null;
}

export interface RuntimeToolRecoveryTimelineEntry {
  recoveryKey: string;
  observedAt: string | null;
  toolName: string | null;
  errorClass: string | null;
  stage: RuntimeToolRecoveryStage | null;
  reason: string;
  recommendedNextAction: string | null;
  recoverable: boolean | null;
  requiresUserIntervention: boolean;
  sameToolErrorCount: number | null;
  escalated: boolean;
  escalationReason: string | null;
  escalationPolicyVersion: string | null;
  baseStage: RuntimeToolRecoveryStage | null;
  baseRecommendedNextAction: string | null;
  runtimeEnvironmentRecovery: RuntimeEnvironmentRecoveryPlan | null;
  browserEnvironmentRecovery: BrowserEnvironmentRecoveryPlan | null;
  mcpEnvironmentRecovery: McpEnvironmentRecoveryPlan | null;
  active: boolean;
  consumed: boolean;
  consumedReason: string | null;
  consumedAt: string | null;
}

export type RuntimeToolRecoveryAttentionSource =
  | "none"
  | "latest"
  | "historical_unconsumed";

export interface RuntimeToolRecoveryHealthSummary {
  score: number;
  level: "good" | "watch" | "risk";
  reason: string;
  recommendedNextAction: string | null;
  attentionSource: RuntimeToolRecoveryAttentionSource;
  attentionRecoveryKey: string | null;
  attentionStage: RuntimeToolRecoveryStage | null;
  attentionToolName: string | null;
  attentionErrorClass: string | null;
  attentionRequiresUserIntervention: boolean;
  attentionRuntimeEnvironmentRecovery: RuntimeEnvironmentRecoveryPlan | null;
  attentionBrowserEnvironmentRecovery: BrowserEnvironmentRecoveryPlan | null;
  attentionMcpEnvironmentRecovery: McpEnvironmentRecoveryPlan | null;
  attentionAgeMs: number | null;
  latestRecommendedNextAction: string | null;
  timelineEntryCount: number;
  activeRecoveryCount: number;
  activeNonrecoverableCount: number;
  unconsumedCount: number;
  consumedCount: number;
  nonrecoverableCount: number;
  stuckNonrecoverableCount: number;
  hasStuckNonrecoverable: boolean;
  latestRecoveryKey: string | null;
  latestStage: RuntimeToolRecoveryStage | null;
  latestToolName: string | null;
  latestErrorClass: string | null;
  latestRequiresUserIntervention: boolean;
  latestRuntimeEnvironmentRecovery: RuntimeEnvironmentRecoveryPlan | null;
  latestBrowserEnvironmentRecovery: BrowserEnvironmentRecoveryPlan | null;
  latestMcpEnvironmentRecovery: McpEnvironmentRecoveryPlan | null;
  latestAgeMs: number | null;
  components: {
    activeRecoveryPenalty: number;
    activeNonrecoverablePenalty: number;
    stuckNonrecoverablePenalty: number;
    historicalUnconsumedPenalty: number;
  };
  errorClassCounts: Record<string, number>;
  toolNameCounts: Record<string, number>;
}

function normalizeRecoveryIdentityPart(value: string | null): string {
  return value && value.trim().length > 0 ? value.trim() : "<none>";
}

function normalizeObservedAt(recovery: RuntimeToolRecoveryHint, fallbackUpdatedAt: string | null): string | null {
  const candidate = recovery.observedAt ?? fallbackUpdatedAt;
  if (!candidate) {
    return null;
  }
  const parsedMs = Date.parse(candidate);
  return Number.isFinite(parsedMs) ? candidate : null;
}

function matchesFeedbackRecovery(input: {
  recovery: RuntimeToolRecoveryHint;
  observedAt: string | null;
  feedback: RuntimeToolRecoveryFeedback;
}): boolean {
  return input.feedback.stage === input.recovery.stage
    && (input.feedback.toolName ?? null) === (input.recovery.toolName ?? null)
    && (input.feedback.errorClass ?? null) === (input.recovery.errorClass ?? null)
    && (input.feedback.observedAt ?? null) === input.observedAt;
}

function increment(map: Record<string, number>, key: string | null): void {
  const normalizedKey = normalizeRecoveryIdentityPart(key);
  map[normalizedKey] = (map[normalizedKey] ?? 0) + 1;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

function classifyRecoveryHealthLevel(input: {
  activeNonrecoverableCount: number;
  stuckNonrecoverableCount: number;
  activeRecoveryCount: number;
  unconsumedCount: number;
  score: number;
  policy: RuntimeToolRecoveryPolicySnapshot;
}): "good" | "watch" | "risk" {
  if (
    input.activeNonrecoverableCount > 0
    || input.stuckNonrecoverableCount > 0
    || input.score < input.policy.health.riskScoreThreshold
  ) {
    return "risk";
  }
  if (
    input.activeRecoveryCount > 0
    || input.unconsumedCount > 0
    || input.score < input.policy.health.watchScoreThreshold
  ) {
    return "watch";
  }
  return "good";
}

function recoveryHealthReason(input: {
  activeNonrecoverableCount: number;
  stuckNonrecoverableCount: number;
  activeRecoveryCount: number;
  unconsumedCount: number;
}): string {
  if (input.activeNonrecoverableCount > 0) {
    return "active_nonrecoverable_recovery";
  }
  if (input.stuckNonrecoverableCount > 0) {
    return "unconsumed_nonrecoverable_history";
  }
  if (input.activeRecoveryCount > 0) {
    return "active_recovery_pending";
  }
  if (input.unconsumedCount > 0) {
    return "historical_unconsumed_recovery";
  }
  return "stable";
}

export function buildRuntimeToolRecoveryKey(input: RuntimeToolRecoveryIdentityInput): string {
  return [
    "recovery",
    normalizeRecoveryIdentityPart(input.stage),
    normalizeRecoveryIdentityPart(input.toolName),
    normalizeRecoveryIdentityPart(input.errorClass),
    normalizeRecoveryIdentityPart(input.observedAt),
  ].join(":");
}

export function buildRuntimeToolRecoveryTimeline(input: {
  metrics: RuntimeToolSurfaceMetricsSnapshot;
  adaptationSnapshot: RuntimeToolSurfaceAdaptationSnapshot;
  recoveryFeedback: RuntimeToolRecoveryFeedback;
}): RuntimeToolRecoveryTimelineEntry[] {
  return [...input.metrics.recentRecoveries]
    .reverse()
    .map((recovery) => {
      const observedAt = normalizeObservedAt(recovery, input.metrics.updatedAt);
      const consumption = resolveRuntimeToolRecoveryConsumption({
        snapshot: input.adaptationSnapshot,
        recoveryStage: recovery.stage,
        recoveryToolName: recovery.toolName ?? null,
        recoveryErrorClass: recovery.errorClass ?? null,
        recoveryObservedAt: observedAt,
      });
      const recoveryKey = buildRuntimeToolRecoveryKey({
        stage: recovery.stage,
        toolName: recovery.toolName ?? null,
        errorClass: recovery.errorClass ?? null,
        observedAt,
      });
      const browserEnvironmentRecovery = buildBrowserEnvironmentRecoveryPlan({
        errorClass: recovery.errorClass,
        errorData: recovery.errorData,
      });
      const mcpEnvironmentRecovery = buildMcpEnvironmentRecoveryPlan({
        errorClass: recovery.errorClass,
        errorData: recovery.errorData,
      });
      const runtimeEnvironmentRecovery = buildRuntimeEnvironmentRecoveryPlan({
        errorClass: recovery.errorClass,
        errorMessage: recovery.errorMessage,
        errorData: recovery.errorData,
      });
      return {
        recoveryKey,
        observedAt,
        toolName: recovery.toolName ?? null,
        errorClass: recovery.errorClass ?? null,
        stage: recovery.stage,
        reason: recovery.reason,
        recommendedNextAction: recovery.recommendedNextAction,
        recoverable: recovery.recoverable ?? null,
        requiresUserIntervention: recovery.requiresUserIntervention ?? (recovery.recoverable === false),
        sameToolErrorCount: recovery.sameToolErrorCount ?? null,
        escalated: recovery.escalated ?? false,
        escalationReason: recovery.escalationReason ?? null,
        escalationPolicyVersion: recovery.escalationPolicyVersion ?? null,
        baseStage: recovery.baseStage ?? null,
        baseRecommendedNextAction: recovery.baseRecommendedNextAction ?? null,
        runtimeEnvironmentRecovery,
        browserEnvironmentRecovery,
        mcpEnvironmentRecovery,
        active:
          input.recoveryFeedback.active
          && matchesFeedbackRecovery({
            recovery,
            observedAt,
            feedback: input.recoveryFeedback,
          }),
        consumed: consumption.consumed,
        consumedReason: consumption.consumedReason,
        consumedAt: consumption.consumedAt,
      };
    });
}

export function buildRuntimeToolRecoveryHealthSummary(input: {
  timeline: readonly RuntimeToolRecoveryTimelineEntry[];
  nowMs?: number;
  policy?: RuntimeToolRecoveryPolicySnapshot;
}): RuntimeToolRecoveryHealthSummary {
  const policy = input.policy ?? RUNTIME_TOOL_RECOVERY_POLICY;
  const nowMs = input.nowMs ?? Date.now();
  const latest = input.timeline[0] ?? null;
  const firstUnconsumed = input.timeline.find((entry) => !entry.consumed) ?? null;
  const errorClassCounts: Record<string, number> = {};
  const toolNameCounts: Record<string, number> = {};
  let activeRecoveryCount = 0;
  let activeNonrecoverableCount = 0;
  let unconsumedCount = 0;
  let consumedCount = 0;
  let nonrecoverableCount = 0;
  let stuckNonrecoverableCount = 0;

  for (const entry of input.timeline) {
    increment(errorClassCounts, entry.errorClass);
    increment(toolNameCounts, entry.toolName);
    if (entry.active) {
      activeRecoveryCount += 1;
    }
    if (!entry.consumed) {
      unconsumedCount += 1;
    } else {
      consumedCount += 1;
    }
    if (entry.requiresUserIntervention) {
      nonrecoverableCount += 1;
      if (entry.active) {
        activeNonrecoverableCount += 1;
      }
      if (!entry.consumed) {
        stuckNonrecoverableCount += 1;
      }
    }
  }

  const latestObservedAtMs = latest?.observedAt ? Date.parse(latest.observedAt) : Number.NaN;
  const latestAgeMs = Number.isFinite(latestObservedAtMs) ? Math.max(0, nowMs - latestObservedAtMs) : null;
  const activeRecoveryPenalty = activeRecoveryCount * policy.health.penalties.activeRecovery;
  const activeNonrecoverablePenalty =
    activeNonrecoverableCount * policy.health.penalties.activeNonrecoverable;
  const stuckNonrecoverablePenalty =
    stuckNonrecoverableCount * policy.health.penalties.stuckNonrecoverable;
  const historicalUnconsumedPenalty =
    Math.max(0, unconsumedCount - activeRecoveryCount)
    * policy.health.penalties.historicalUnconsumed;
  const score = clampScore(
    100
      - activeRecoveryPenalty
      - activeNonrecoverablePenalty
      - stuckNonrecoverablePenalty
      - historicalUnconsumedPenalty,
  );
  const level = classifyRecoveryHealthLevel({
    activeNonrecoverableCount,
    stuckNonrecoverableCount,
    activeRecoveryCount,
    unconsumedCount,
    score,
    policy,
  });
  const reason = recoveryHealthReason({
    activeNonrecoverableCount,
    stuckNonrecoverableCount,
    activeRecoveryCount,
    unconsumedCount,
  });
  let attentionSource: RuntimeToolRecoveryAttentionSource = "none";
  let attentionEntry: RuntimeToolRecoveryTimelineEntry | null = null;
  if (level !== "good") {
    if (firstUnconsumed && firstUnconsumed.recoveryKey !== latest?.recoveryKey) {
      attentionSource = "historical_unconsumed";
      attentionEntry = firstUnconsumed;
    } else if (latest) {
      attentionSource = "latest";
      attentionEntry = latest;
    } else if (firstUnconsumed) {
      attentionSource = "latest";
      attentionEntry = firstUnconsumed;
    }
  }
  const attentionObservedAtMs = attentionEntry?.observedAt ? Date.parse(attentionEntry.observedAt) : Number.NaN;
  const attentionAgeMs = Number.isFinite(attentionObservedAtMs) ? Math.max(0, nowMs - attentionObservedAtMs) : null;

  return {
    score,
    level,
    reason,
    recommendedNextAction: attentionEntry?.recommendedNextAction ?? null,
    attentionSource,
    attentionRecoveryKey: attentionEntry?.recoveryKey ?? null,
    attentionStage: attentionEntry?.stage ?? null,
    attentionToolName: attentionEntry?.toolName ?? null,
    attentionErrorClass: attentionEntry?.errorClass ?? null,
    attentionRequiresUserIntervention: attentionEntry?.requiresUserIntervention ?? false,
    attentionRuntimeEnvironmentRecovery: attentionEntry?.runtimeEnvironmentRecovery ?? null,
    attentionBrowserEnvironmentRecovery: attentionEntry?.browserEnvironmentRecovery ?? null,
    attentionMcpEnvironmentRecovery: attentionEntry?.mcpEnvironmentRecovery ?? null,
    attentionAgeMs,
    latestRecommendedNextAction: latest?.recommendedNextAction ?? null,
    timelineEntryCount: input.timeline.length,
    activeRecoveryCount,
    activeNonrecoverableCount,
    unconsumedCount,
    consumedCount,
    nonrecoverableCount,
    stuckNonrecoverableCount,
    hasStuckNonrecoverable: stuckNonrecoverableCount > 0,
    latestRecoveryKey: latest?.recoveryKey ?? null,
    latestStage: latest?.stage ?? null,
    latestToolName: latest?.toolName ?? null,
    latestErrorClass: latest?.errorClass ?? null,
    latestRequiresUserIntervention: latest?.requiresUserIntervention ?? false,
    latestRuntimeEnvironmentRecovery: latest?.runtimeEnvironmentRecovery ?? null,
    latestBrowserEnvironmentRecovery: latest?.browserEnvironmentRecovery ?? null,
    latestMcpEnvironmentRecovery: latest?.mcpEnvironmentRecovery ?? null,
    latestAgeMs,
    components: {
      activeRecoveryPenalty,
      activeNonrecoverablePenalty,
      stuckNonrecoverablePenalty,
      historicalUnconsumedPenalty,
    },
    errorClassCounts,
    toolNameCounts,
  };
}
