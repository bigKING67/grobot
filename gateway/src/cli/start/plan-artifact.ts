import {
  evaluatePlanQualityBenchmark as evaluatePlanQualityBenchmarkCore,
} from "./plan-artifact/benchmark";
import {
  evaluatePlanQualityGuard as evaluatePlanQualityGuardCore,
  evaluatePlanQualityTrend as evaluatePlanQualityTrendCore,
} from "./plan-artifact/guard";
import { evaluatePlanQuality } from "./plan-artifact/quality";
import { loadPlanArtifactIndex } from "./plan-artifact/store";
import type {
  PlanQualityBenchmarkCandidate,
  PlanQualityBenchmarkResult,
  PlanQualityGuardPolicy,
  PlanQualityGuardSummary,
  PlanQualitySummary,
  PlanQualityTrendSummary,
} from "./plan-artifact/types";

export { buildPlanApplyPrompt } from "./plan-artifact/apply-prompt";
export {
  buildPlanQualityBenchmarkEventDetail,
  evaluatePlanQualityBenchmarkHealth,
  evaluatePlanQualityBenchmarkSemanticCorrelation,
  loadPlanQualityBenchmarkHistory,
  resolvePlanQualityBenchmarkRecommendation,
} from "./plan-artifact/benchmark-history";
export { resolvePlanQualityBenchmarkPreset } from "./plan-artifact/benchmark-preset";
export {
  isPlanQualityGuardModeInputError,
  planQualityGuardModeInputErrorPayload,
  PlanQualityGuardModeInputError,
  resolvePlanQualityGuardMode,
} from "./plan-artifact/guard";
export { resolvePlanQualityGuardPolicy } from "./plan-artifact/policy";
export {
  buildPlanQualityRepairActions,
  evaluatePlanQuality,
} from "./plan-artifact/quality";
export {
  extractLatestProposedPlanBlock,
  reviewPlanContent,
} from "./plan-artifact/review";
export {
  appendPlanEvent,
  loadLatestPlanFailureDiagnostic,
  loadLatestPlanVerificationDiagnostic,
} from "./plan-artifact/events";
export {
  appendPlanProgressNote,
  approvePlanArtifact,
  createPlanArtifact,
  loadActivePlanArtifact,
  loadPlanArtifactIndex,
  recordPlanReviewResult,
  recoverStaleApprovedPlan,
  replacePlanArtifactContent,
  updatePlanArtifactStatus,
} from "./plan-artifact/store";

export type {
  ActivePlanArtifact,
  CreatedPlanArtifact,
  PlanApprovalResult,
  PlanArtifactEntry,
  PlanArtifactEvent,
  PlanArtifactIndex,
  PlanArtifactStatus,
  PlanLatestFailureDiagnostic,
  PlanLatestVerificationDiagnostic,
  PlanQualityBenchmarkCandidate,
  PlanQualityBenchmarkEventDetailInput,
  PlanQualityBenchmarkHealthSummary,
  PlanQualityBenchmarkHistoryRun,
  PlanQualityBenchmarkHistorySummary,
  PlanQualityBenchmarkPresetCandidate,
  PlanQualityBenchmarkPresetResolution,
  PlanQualityBenchmarkRecommendation,
  PlanQualityBenchmarkResult,
  PlanQualityBenchmarkSemanticCorrelation,
  PlanQualityBenchmarkRow,
  PlanQualityGuardMode,
  PlanQualityGuardPolicy,
  PlanQualityGuardPolicySource,
  PlanQualityGuardSummary,
  PlanQualityRepairAction,
  PlanQualitySummary,
  PlanQualityTrendSummary,
  PlanReviewFinding,
  PlanReviewResult,
  ResolvedPlanQualityGuardPolicy,
} from "./plan-artifact/types";

export function evaluatePlanQualityBenchmark(args: {
  workDir: string;
  sessionId: string;
  candidates: readonly PlanQualityBenchmarkCandidate[];
  policy?: PlanQualityGuardPolicy;
}): PlanQualityBenchmarkResult {
  return evaluatePlanQualityBenchmarkCore({
    ...args,
    loadIndex: loadPlanArtifactIndex,
  });
}

export function evaluatePlanQualityTrend(args: {
  workDir: string;
  sessionId: string;
  currentPlanId: string;
  currentScore: number;
}): PlanQualityTrendSummary {
  return evaluatePlanQualityTrendCore({
    ...args,
    loadIndex: loadPlanArtifactIndex,
    evaluateQuality: (content) => evaluatePlanQuality(content),
  });
}

export function evaluatePlanQualityGuard(args: {
  workDir: string;
  sessionId: string;
  currentPlanId: string;
  quality: PlanQualitySummary;
  trend: PlanQualityTrendSummary;
  policy?: PlanQualityGuardPolicy;
  historyScope?: "session_window" | "none";
}): PlanQualityGuardSummary {
  return evaluatePlanQualityGuardCore({
    ...args,
    loadIndex: loadPlanArtifactIndex,
    evaluateQuality: (content) => evaluatePlanQuality(content),
  });
}
