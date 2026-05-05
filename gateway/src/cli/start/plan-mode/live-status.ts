import { createHash } from "node:crypto";
import {
  buildPlanQualityRepairActions,
  evaluatePlanQuality,
  evaluatePlanQualityGuard,
  evaluatePlanQualityTrend,
  reviewPlanContent,
  type PlanArtifactEntry,
  type PlanArtifactStatus,
  type PlanQualityGuardMode,
  type PlanQualityGuardPolicy,
  type PlanQualityGuardSummary,
  type PlanQualityRepairAction,
  type PlanQualitySummary,
  type PlanQualityTrendSummary,
  type PlanReviewResult,
} from "../plan-artifact";
import {
  derivePlanPhaseFromStatus,
  PLAN_EXECUTION_REPLY,
  resolvePlanStatusRecommendation,
  type SessionPlanPhase,
} from "../plan-state";

export interface LivePlanDecisionSnapshot {
  storedStatus: PlanArtifactStatus;
  storedPhase: SessionPlanPhase | undefined;
  liveStatus: PlanArtifactStatus;
  livePhase: SessionPlanPhase;
  statusSource: "stored" | "live_snapshot";
  decisionReady: boolean;
  approvalStale: boolean;
  review: PlanReviewResult;
  quality: PlanQualitySummary;
  qualityTrend: PlanQualityTrendSummary;
  qualityGuardMode: PlanQualityGuardMode;
  qualityGuard: PlanQualityGuardSummary;
  repairActions: PlanQualityRepairAction[];
  recommendation: ReturnType<typeof resolvePlanStatusRecommendation>;
}

export function evaluateLivePlanDecisionSnapshot(args: {
  workDir: string;
  sessionId: string;
  mode: "normal" | "plan_only";
  entry: PlanArtifactEntry;
  planContent: string;
  latestVerificationStatus?: "pending" | "passed" | "failed";
  guardPolicy: PlanQualityGuardPolicy;
  guardMode: PlanQualityGuardMode;
}): LivePlanDecisionSnapshot {
  const review = reviewPlanContent(args.planContent);
  const quality = evaluatePlanQuality(args.planContent);
  const qualityTrend = evaluatePlanQualityTrend({
    workDir: args.workDir,
    sessionId: args.sessionId,
    currentPlanId: args.entry.plan_id,
    currentScore: quality.score,
  });
  const qualityGuard = evaluatePlanQualityGuard({
    workDir: args.workDir,
    sessionId: args.sessionId,
    currentPlanId: args.entry.plan_id,
    quality,
    trend: qualityTrend,
    policy: args.guardPolicy,
  });
  const repairActions = buildPlanQualityRepairActions({
    planContent: args.planContent,
    quality,
    trend: qualityTrend,
    guard: qualityGuard,
  });
  const reviewStatus: PlanArtifactStatus = review.ok
    ? "ready"
    : review.blocked
      ? "blocked"
      : "review_failed";
  const approvalStale = args.entry.status === "approved"
    && typeof args.entry.approved_hash === "string"
    && args.entry.approved_hash.length > 0
    ? createHash("sha256").update(args.planContent).digest("hex") !== args.entry.approved_hash
    : false;

  let liveStatus: PlanArtifactStatus;
  if (args.entry.status === "applying") {
    liveStatus = "applying";
  } else if (args.entry.status === "apply_failed") {
    liveStatus = "apply_failed";
  } else if (args.entry.status === "approved" && !approvalStale) {
    liveStatus = "approved";
  } else {
    liveStatus = reviewStatus;
  }

  const recommendation = resolvePlanStatusRecommendation({
    mode: args.mode,
    status: liveStatus,
    latestVerificationStatus: args.latestVerificationStatus,
    planQualityScore: quality.score,
    planQualityTopHint: repairActions[0]?.title ?? quality.rewriteHints[0],
    planQualityGuardLevel: qualityGuard.level,
    planQualityGuardReason: qualityGuard.reason,
    interactiveMenuFirst: false,
  });

  const livePhase = liveStatus === "applying"
    ? "applying"
    : recommendation.action === PLAN_EXECUTION_REPLY
      ? "awaiting_decision"
      : "drafting";
  const storedPhase = derivePlanPhaseFromStatus(args.entry.status);
  const statusSource = approvalStale || liveStatus !== args.entry.status || livePhase !== storedPhase
    ? "live_snapshot"
    : "stored";

  return {
    storedStatus: args.entry.status,
    storedPhase,
    liveStatus,
    livePhase,
    statusSource,
    decisionReady: livePhase === "awaiting_decision",
    approvalStale,
    review,
    quality,
    qualityTrend,
    qualityGuardMode: args.guardMode,
    qualityGuard,
    repairActions,
    recommendation,
  };
}
