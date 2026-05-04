import { type PromptCompactionStage } from "../../types";
import {
  type PromptPreSendCompressionPlan,
  type PromptPreSendCompressionStep,
} from "./contract";
import { stageWeight } from "./stages";

function roundMetric(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1000) / 1000;
}

export function derivePromptPreSendCompressionPlan(args: {
  selectedStage: PromptCompactionStage;
  estimatedTokens: number;
  targetTokenLimit: number;
  qualityGuardActive: boolean;
  qualityGuardSevere: boolean;
  pressureTrendMomentum?: number | null;
}): PromptPreSendCompressionPlan {
  const safeTargetTokenLimit = Math.max(1, Math.floor(args.targetTokenLimit));
  const overflowTokens = Math.max(0, Math.floor(args.estimatedTokens) - safeTargetTokenLimit);
  const overflowRatio = overflowTokens / safeTargetTokenLimit;
  const stagePressure = stageWeight(args.selectedStage) / stageWeight("minimal");
  const trendMomentum = typeof args.pressureTrendMomentum === "number"
    && Number.isFinite(args.pressureTrendMomentum)
    ? Math.max(-1, Math.min(1, args.pressureTrendMomentum))
    : 0;
  const trendPressure = Math.max(0, trendMomentum) * 0.2;
  const guardPressure = args.qualityGuardActive ? 0.18 : 0;
  const severePressure = args.qualityGuardSevere ? 0.12 : 0;
  const pressureScore = Math.min(
    1,
    overflowRatio * 0.75 + stagePressure * 0.35 + trendPressure + guardPressure + severePressure,
  );
  const strategy: PromptPreSendCompressionPlan["strategy"] =
    overflowRatio >= 0.18 || pressureScore >= 0.62
      ? "hard_budget"
      : "quality_first";
  const order: PromptPreSendCompressionStep[] = strategy === "hard_budget"
    ? ["recent_trim", "snapshot_trim", "snapshot_semantic_compress", "head_trim"]
    : ["recent_trim", "snapshot_semantic_compress", "snapshot_trim", "head_trim"];
  return {
    strategy,
    overflowRatio: roundMetric(overflowRatio),
    pressureScore: roundMetric(pressureScore),
    order,
  };
}
