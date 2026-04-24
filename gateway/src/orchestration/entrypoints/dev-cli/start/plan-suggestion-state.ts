import { statSync } from "node:fs";
import {
  loadActivePlanArtifact,
  loadLatestPlanVerificationDiagnostic,
  loadPlanArtifactIndex,
  resolvePlanQualityGuardMode,
  resolvePlanQualityGuardPolicy,
  type PlanArtifactEntry,
  type PlanArtifactStatus,
  type PlanQualityGuardSummary,
} from "./plan-artifact";
import { evaluateLivePlanDecisionSnapshot } from "./plan-live-status";
import {
  derivePlanPhaseFromStatus,
  resolvePlanStatusRecommendation,
  resolvePlanStatusRecommendationCommand,
  type SessionPlanPhase,
} from "./plan-state";

export interface RunStartPlanSuggestionState {
  activePlanStatus?: PlanArtifactStatus;
  activePlanPhase?: SessionPlanPhase;
  activePlanStatusSource?: "stored" | "live_snapshot";
  activePlanDecisionReady?: boolean;
  activePlanApprovalStale?: boolean;
  activePlanQualityScore?: number;
  activePlanQualityGuardLevel?: PlanQualityGuardSummary["level"];
  activePlanRecommendationCommand?: string;
  activePlanRecommendationReason?: string;
  latestPlanStatus?: PlanArtifactStatus;
  latestVerificationStatus?: "pending" | "passed" | "failed";
}

function resolveLatestPlanEntry(entries: readonly PlanArtifactEntry[]): PlanArtifactEntry | undefined {
  const sorted = [...entries].sort((left, right) => {
    if (left.seq !== right.seq) {
      return right.seq - left.seq;
    }
    return right.updated_at.localeCompare(left.updated_at);
  });
  return sorted[0];
}

export function resolveRunStartPlanSuggestionState(args: {
  workDir: string;
  sessionId: string;
  mode: "normal" | "plan_only";
  persistedActivePlanStatus?: PlanArtifactStatus;
  persistedActivePlanPhase?: SessionPlanPhase;
  persistedActivePlanPath?: string;
}): RunStartPlanSuggestionState | undefined {
  const index = loadPlanArtifactIndex(args.workDir, args.sessionId);
  const latestEntry = resolveLatestPlanEntry(index.entries);
  const latestVerification = latestEntry
    ? loadLatestPlanVerificationDiagnostic(args.workDir, args.sessionId, {
      planId: latestEntry.plan_id,
    })
    : undefined;
  const activePlanPath = typeof args.persistedActivePlanPath === "string"
    && args.persistedActivePlanPath.trim().length > 0
    ? args.persistedActivePlanPath.trim()
    : undefined;
  const activePlanFileFingerprint = (() => {
    if (!activePlanPath) {
      return "<none>";
    }
    try {
      const stats = statSync(activePlanPath) as unknown as {
        mtimeMs?: unknown;
        size?: unknown;
      };
      const mtimeMs = typeof stats.mtimeMs === "number" && Number.isFinite(stats.mtimeMs)
        ? Math.floor(stats.mtimeMs)
        : 0;
      const size = typeof stats.size === "number" && Number.isFinite(stats.size)
        ? Math.floor(stats.size)
        : 0;
      return `${activePlanPath}:${String(mtimeMs)}:${String(size)}`;
    } catch {
      return `${activePlanPath}:<missing>`;
    }
  })();
  const cacheKey = `${args.sessionId}:${args.mode}`;
  const cacheFingerprint = [
    args.persistedActivePlanStatus ?? "<none>",
    args.persistedActivePlanPhase ?? "<none>",
    activePlanFileFingerprint,
    index.active_plan_id ?? "<none>",
    index.updated_at,
    latestEntry?.plan_id ?? "<none>",
    latestEntry?.status ?? "<none>",
    latestEntry?.updated_at ?? "<none>",
    latestVerification?.status ?? "<none>",
    latestVerification?.at ?? "<none>",
    process.env.GROBOT_PLAN_QUALITY_GUARD_MODE ?? "",
  ].join("|");
  const cached = PLAN_SUGGESTION_STATE_CACHE.get(cacheKey);
  if (cached?.fingerprint === cacheFingerprint) {
    return cached.value;
  }

  let nextValue: RunStartPlanSuggestionState | undefined;
  const active = loadActivePlanArtifact(args.workDir, args.sessionId);
  if (active) {
    const activeVerification = loadLatestPlanVerificationDiagnostic(args.workDir, args.sessionId, {
      planId: active.entry.plan_id,
    });
    const qualityGuardRuntime = resolvePlanQualityGuardPolicy({
      workDir: args.workDir,
    });
    const guardMode = resolvePlanQualityGuardMode(
      process.env.GROBOT_PLAN_QUALITY_GUARD_MODE,
      qualityGuardRuntime.policy.defaults.mode,
    );
    const liveSnapshot = evaluateLivePlanDecisionSnapshot({
      workDir: args.workDir,
      sessionId: args.sessionId,
      mode: args.mode,
      entry: active.entry,
      planContent: active.content,
      latestVerificationStatus: activeVerification?.status,
      guardPolicy: qualityGuardRuntime.policy,
      guardMode,
    });
    nextValue = {
      activePlanStatus: liveSnapshot.liveStatus,
      activePlanPhase: liveSnapshot.livePhase,
      activePlanStatusSource: liveSnapshot.statusSource,
      activePlanDecisionReady: liveSnapshot.decisionReady,
      activePlanApprovalStale: liveSnapshot.approvalStale,
      activePlanQualityScore: liveSnapshot.quality.score,
      activePlanQualityGuardLevel: liveSnapshot.qualityGuard.level,
      activePlanRecommendationCommand: resolvePlanStatusRecommendationCommand(
        liveSnapshot.recommendation.action,
      ),
      activePlanRecommendationReason: liveSnapshot.recommendation.reason,
      latestPlanStatus: latestEntry?.status,
      latestVerificationStatus: latestVerification?.status,
    };
  } else {
    const fallbackStatus = args.persistedActivePlanStatus;
    const fallbackPhase = args.persistedActivePlanPhase ?? derivePlanPhaseFromStatus(fallbackStatus);
    const fallbackRecommendation = fallbackStatus
      ? resolvePlanStatusRecommendation({
        mode: args.mode,
        status: fallbackStatus,
        latestVerificationStatus: latestVerification?.status,
        interactiveMenuFirst: false,
      })
      : undefined;
    const fallbackState: RunStartPlanSuggestionState = {
      activePlanStatus: fallbackStatus,
      activePlanPhase: fallbackPhase,
      activePlanStatusSource: fallbackStatus ? "stored" : undefined,
      activePlanDecisionReady: fallbackPhase === "awaiting_decision" ? true : undefined,
      activePlanRecommendationCommand: fallbackRecommendation
        ? resolvePlanStatusRecommendationCommand(fallbackRecommendation.action)
        : undefined,
      activePlanRecommendationReason: fallbackRecommendation?.reason,
      latestPlanStatus: latestEntry?.status,
      latestVerificationStatus: latestVerification?.status,
    };
    const hasSignal = Boolean(
      fallbackState.activePlanStatus
      || fallbackState.latestPlanStatus
      || fallbackState.latestVerificationStatus
      || fallbackState.activePlanRecommendationCommand,
    );
    nextValue = hasSignal ? fallbackState : undefined;
  }

  PLAN_SUGGESTION_STATE_CACHE.set(cacheKey, {
    fingerprint: cacheFingerprint,
    value: nextValue,
  });
  if (PLAN_SUGGESTION_STATE_CACHE.size > PLAN_SUGGESTION_STATE_CACHE_MAX_ENTRIES) {
    const oldestKey = PLAN_SUGGESTION_STATE_CACHE.keys().next().value;
    if (typeof oldestKey === "string") {
      PLAN_SUGGESTION_STATE_CACHE.delete(oldestKey);
    }
  }
  return nextValue;
}

const PLAN_SUGGESTION_STATE_CACHE_MAX_ENTRIES = 24;
const PLAN_SUGGESTION_STATE_CACHE = new Map<string, {
  fingerprint: string;
  value: RunStartPlanSuggestionState | undefined;
}>();
