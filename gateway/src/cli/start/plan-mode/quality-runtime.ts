import {
  buildPlanQualityRepairActions,
  evaluatePlanQuality,
  evaluatePlanQualityGuard,
  evaluatePlanQualityTrend,
  recordPlanReviewResult,
  reviewPlanContent,
  type ActivePlanArtifact,
  type PlanArtifactEntry,
  type PlanQualityGuardMode,
  type PlanQualityGuardPolicy,
  type PlanQualityGuardPolicySource,
  type PlanQualityRepairAction,
  type PlanReviewResult,
} from "../plan-artifact";
import { resolvePlanStatusRecommendation } from "../plan-state";
import { buildPlanMeta } from "./meta";

export interface PlanQualityGuardRuntime {
  policy: PlanQualityGuardPolicy;
  guardMode: PlanQualityGuardMode;
  source: PlanQualityGuardPolicySource;
}

export interface ReviewActivePlanDecisionStateInput {
  workDir: string;
  sessionId: string;
  active: ActivePlanArtifact;
  resolveQualityGuardRuntime(): PlanQualityGuardRuntime;
  persistPlanMeta(planMeta: ReturnType<typeof buildPlanMeta>): Promise<void>;
}

export interface ReviewActivePlanDecisionState {
  reviewedEntry: PlanArtifactEntry;
  review: PlanReviewResult;
  recommendation: ReturnType<typeof resolvePlanStatusRecommendation>;
  repairActions: PlanQualityRepairAction[];
}

export async function reviewActivePlanDecisionState(
  input: ReviewActivePlanDecisionStateInput,
): Promise<ReviewActivePlanDecisionState | undefined> {
  const review = reviewPlanContent(input.active.content);
  const reviewedEntry = recordPlanReviewResult(
    input.workDir,
    input.sessionId,
    input.active.entry.plan_id,
    review,
    "cli",
  );
  if (!reviewedEntry) {
    return undefined;
  }
  await input.persistPlanMeta(
    buildPlanMeta(reviewedEntry, input.active.planPath),
  );
  const quality = evaluatePlanQuality(input.active.content);
  const qualityTrend = evaluatePlanQualityTrend({
    workDir: input.workDir,
    sessionId: input.sessionId,
    currentPlanId: reviewedEntry.plan_id,
    currentScore: quality.score,
  });
  const qualityGuardRuntime = input.resolveQualityGuardRuntime();
  const qualityGuard = evaluatePlanQualityGuard({
    workDir: input.workDir,
    sessionId: input.sessionId,
    currentPlanId: reviewedEntry.plan_id,
    quality,
    trend: qualityTrend,
    policy: qualityGuardRuntime.policy,
  });
  const repairActions = buildPlanQualityRepairActions({
    planContent: input.active.content,
    quality,
    trend: qualityTrend,
    guard: qualityGuard,
  });
  const recommendation = resolvePlanStatusRecommendation({
    mode: "plan_only",
    status: reviewedEntry.status,
    planQualityScore: quality.score,
    planQualityTopHint: repairActions[0]?.title ?? quality.rewriteHints[0],
    planQualityGuardLevel: qualityGuard.level,
    planQualityGuardReason: qualityGuard.reason,
    interactiveMenuFirst: true,
  });
  return {
    reviewedEntry,
    review,
    recommendation,
    repairActions,
  };
}
