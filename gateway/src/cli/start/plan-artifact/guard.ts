import { DEFAULT_PLAN_QUALITY_GUARD_POLICY } from "./constants";
import { readText } from "./fs-utils";
import { planPathFromEntry } from "./paths";
import type {
  PlanArtifactIndex,
  PlanQualityGuardMode,
  PlanQualityGuardPolicy,
  PlanQualityGuardSummary,
  PlanQualitySummary,
  PlanQualityTrendSummary,
} from "./types";

type LoadPlanArtifactIndexFn = (workDir: string, sessionId: string) => PlanArtifactIndex;
type EvaluatePlanQualityFn = (planContent: string) => PlanQualitySummary;

export function evaluatePlanQualityTrend(args: {
  workDir: string;
  sessionId: string;
  currentPlanId: string;
  currentScore: number;
  loadIndex: LoadPlanArtifactIndexFn;
  evaluateQuality: EvaluatePlanQualityFn;
}): PlanQualityTrendSummary {
  const index = args.loadIndex(args.workDir, args.sessionId);
  const sorted = [...index.entries].sort((left, right) => {
    if (left.seq !== right.seq) {
      return right.seq - left.seq;
    }
    return right.updated_at.localeCompare(left.updated_at);
  });
  for (const entry of sorted) {
    if (entry.plan_id === args.currentPlanId) {
      continue;
    }
    const content = readText(planPathFromEntry(args.workDir, args.sessionId, entry));
    if (typeof content !== "string" || content.trim().length === 0) {
      continue;
    }
    const previousQuality = args.evaluateQuality(content);
    const delta = args.currentScore - previousQuality.score;
    const trend = delta >= 5
      ? "up"
      : delta <= -5
        ? "down"
        : "flat";
    return {
      trend,
      previousPlanId: entry.plan_id,
      previousScore: previousQuality.score,
      deltaFromPrevious: delta,
    };
  }
  return {
    trend: "none",
  };
}

export function evaluatePlanQualityGuard(args: {
  workDir: string;
  sessionId: string;
  currentPlanId: string;
  quality: PlanQualitySummary;
  trend: PlanQualityTrendSummary;
  loadIndex: LoadPlanArtifactIndexFn;
  evaluateQuality: EvaluatePlanQualityFn;
  policy?: PlanQualityGuardPolicy;
  historyScope?: "session_window" | "none";
}): PlanQualityGuardSummary {
  const policy = args.policy ?? DEFAULT_PLAN_QUALITY_GUARD_POLICY;
  const scoreSeries: number[] = [args.quality.score];
  if (args.historyScope !== "none") {
    const index = args.loadIndex(args.workDir, args.sessionId);
    const sorted = [...index.entries].sort((left, right) => {
      if (left.seq !== right.seq) {
        return right.seq - left.seq;
      }
      return right.updated_at.localeCompare(left.updated_at);
    });
    for (const entry of sorted) {
      if (entry.plan_id === args.currentPlanId) {
        continue;
      }
      const content = readText(planPathFromEntry(args.workDir, args.sessionId, entry));
      if (typeof content !== "string" || content.trim().length === 0) {
        continue;
      }
      scoreSeries.push(args.evaluateQuality(content).score);
      if (scoreSeries.length >= 6) {
        break;
      }
    }
  }
  let regressionStreak = 0;
  for (let indexScore = 0; indexScore < scoreSeries.length - 1; indexScore += 1) {
    const delta = scoreSeries[indexScore] - scoreSeries[indexScore + 1];
    if (delta <= -5) {
      regressionStreak += 1;
      continue;
    }
    break;
  }
  const delta = args.trend.deltaFromPrevious;
  const severeDrop = typeof delta === "number" && delta <= (-1 * policy.thresholds.severe_drop_delta);
  if (args.quality.blocked) {
    return {
      level: "critical",
      regressionStreak,
      reason: "存在阻断项，需先解除阻断再审批/执行",
    };
  }
  if (args.quality.score < policy.thresholds.critical_score) {
    return {
      level: "critical",
      regressionStreak,
      reason: `质量分仅 ${String(args.quality.score)}，低于安全阈值 ${String(policy.thresholds.critical_score)}`,
    };
  }
  if (regressionStreak >= policy.thresholds.critical_regression_streak) {
    return {
      level: "critical",
      regressionStreak,
      reason: `质量已连续 ${String(regressionStreak)} 轮明显下降（阈值 ${String(policy.thresholds.critical_regression_streak)}）`,
    };
  }
  if (severeDrop) {
    return {
      level: "critical",
      regressionStreak,
      reason: `较上轮显著下降 ${String(Math.abs(delta ?? 0))} 分（阈值 ${String(policy.thresholds.severe_drop_delta)}）`,
    };
  }
  if (args.quality.score < policy.thresholds.watch_score) {
    return {
      level: "watch",
      regressionStreak,
      reason: `质量分 ${String(args.quality.score)} 低于目标阈值 ${String(policy.thresholds.watch_score)}`,
    };
  }
  if (policy.thresholds.watch_on_trend_down && args.trend.trend === "down") {
    return {
      level: "watch",
      regressionStreak,
      reason: "较上轮出现质量下降，建议先补关键细节",
    };
  }
  return {
    level: "healthy",
    regressionStreak,
    reason: "质量稳定，可继续推进审批与执行",
  };
}

export function resolvePlanQualityGuardMode(
  raw: string | undefined,
  fallback: PlanQualityGuardMode = DEFAULT_PLAN_QUALITY_GUARD_POLICY.defaults.mode,
): PlanQualityGuardMode {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (normalized === "off" || normalized === "disabled" || normalized === "0" || normalized === "false") {
    return "off";
  }
  if (normalized === "strict" || normalized === "enforce" || normalized === "hard") {
    return "strict";
  }
  if (normalized === "warn" || normalized === "1" || normalized === "true" || normalized === "enabled") {
    return "warn";
  }
  return fallback;
}
