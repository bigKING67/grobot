import {
  type ContextEngineConfig,
  type PromptCompactionStage,
} from "../../types";

export function stageWeight(stage: PromptCompactionStage): number {
  switch (stage) {
    case "normal":
      return 0;
    case "proactive":
      return 1;
    case "forced":
      return 2;
    case "minimal":
      return 3;
    default:
      return 0;
  }
}

export function nextCompactionStage(stage: PromptCompactionStage): PromptCompactionStage | undefined {
  if (stage === "normal") {
    return "proactive";
  }
  if (stage === "proactive") {
    return "forced";
  }
  if (stage === "forced") {
    return "minimal";
  }
  return undefined;
}

export function selectStageByUtilization(
  utilization: number,
  config: ContextEngineConfig,
): PromptCompactionStage {
  if (utilization >= config.thresholds.hardRatio) {
    return "minimal";
  }
  if (utilization >= config.thresholds.forcedRatio) {
    return "forced";
  }
  if (utilization >= config.thresholds.proactiveRatio) {
    return "proactive";
  }
  return "normal";
}

export function applyAutoCompactGuardToStage(args: {
  baseStage: PromptCompactionStage;
  totalEstimatedTokens: number;
  autoCompactTokenLimit: number;
}): {
  stage: PromptCompactionStage;
  autoCompactLimitTriggered: boolean;
} {
  const autoCompactLimitTriggered = args.totalEstimatedTokens >= args.autoCompactTokenLimit;
  if (!autoCompactLimitTriggered) {
    return {
      stage: args.baseStage,
      autoCompactLimitTriggered: false,
    };
  }
  if (stageWeight(args.baseStage) >= stageWeight("proactive")) {
    return {
      stage: args.baseStage,
      autoCompactLimitTriggered: true,
    };
  }
  return {
    stage: "proactive",
    autoCompactLimitTriggered: true,
  };
}

export function shouldTriggerDownshiftPrecompact(args: {
  allowProactiveCompaction: boolean;
  previousTargetTokenLimit?: number;
  currentTargetTokenLimit: number;
  totalEstimatedTokens: number;
}): boolean {
  if (!args.allowProactiveCompaction) {
    return false;
  }
  if (typeof args.previousTargetTokenLimit !== "number") {
    return false;
  }
  if (args.currentTargetTokenLimit >= args.previousTargetTokenLimit) {
    return false;
  }
  return args.totalEstimatedTokens > args.currentTargetTokenLimit;
}
