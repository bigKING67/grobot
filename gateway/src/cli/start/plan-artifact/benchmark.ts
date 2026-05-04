import { DEFAULT_PLAN_QUALITY_GUARD_POLICY } from "./constants";
import {
  buildPlanQualityRepairActions,
  evaluatePlanQuality,
} from "./quality";
import {
  evaluatePlanQualityGuard,
} from "./guard";
import type {
  PlanArtifactIndex,
  PlanQualityBenchmarkCandidate,
  PlanQualityBenchmarkResult,
  PlanQualityBenchmarkRow,
  PlanQualityGuardPolicy,
  PlanQualityTrendSummary,
} from "./types";

function benchmarkGuardLevelRank(level: "healthy" | "watch" | "critical"): number {
  if (level === "healthy") {
    return 0;
  }
  if (level === "watch") {
    return 1;
  }
  return 2;
}

export function evaluatePlanQualityBenchmark(args: {
  workDir: string;
  sessionId: string;
  candidates: readonly PlanQualityBenchmarkCandidate[];
  loadIndex: (workDir: string, sessionId: string) => PlanArtifactIndex;
  policy?: PlanQualityGuardPolicy;
}): PlanQualityBenchmarkResult {
  if (args.candidates.length === 0) {
    throw new Error("benchmark requires at least one candidate");
  }
  const policy = args.policy ?? DEFAULT_PLAN_QUALITY_GUARD_POLICY;
  const rows = args.candidates.map((candidate) => {
    const quality = evaluatePlanQuality(candidate.content);
    const trend: PlanQualityTrendSummary = {
      trend: "none",
    };
    const guard = evaluatePlanQualityGuard({
      workDir: args.workDir,
      sessionId: args.sessionId,
      currentPlanId: `benchmark:${candidate.label}`,
      quality,
      trend,
      policy,
      historyScope: "none",
      loadIndex: args.loadIndex,
      evaluateQuality: evaluatePlanQuality,
    });
    const repairActions = buildPlanQualityRepairActions({
      planContent: candidate.content,
      quality,
      trend,
      guard,
    });
    return {
      rank: 0,
      label: candidate.label,
      sourcePath: candidate.sourcePath,
      score: quality.score,
      grade: quality.grade,
      findingCount: quality.findingCount,
      blocked: quality.blocked,
      guardLevel: guard.level,
      guardReason: guard.reason,
      repairActionCount: repairActions.length,
      topHint: quality.rewriteHints[0] ?? "",
      topRepairAction: repairActions[0]?.title ?? "",
    } satisfies PlanQualityBenchmarkRow;
  });
  const sorted = [...rows].sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    const guardDelta = benchmarkGuardLevelRank(left.guardLevel) - benchmarkGuardLevelRank(right.guardLevel);
    if (guardDelta !== 0) {
      return guardDelta;
    }
    if (left.findingCount !== right.findingCount) {
      return left.findingCount - right.findingCount;
    }
    return left.label.localeCompare(right.label);
  });
  const ranked = sorted.map((row, index) => ({
    ...row,
    rank: index + 1,
  }));
  return {
    rows: ranked,
    winner: ranked[0],
  };
}
