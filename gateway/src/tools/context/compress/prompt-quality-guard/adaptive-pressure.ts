import type {
  PromptQualityGuardAdaptiveInput,
  PromptQualityGuardState,
} from "./contract";
import {
  DEFAULT_PRESSURE_AUTO_LIMIT_RATE_THRESHOLD,
  DEFAULT_PRESSURE_JOINT_RATE_THRESHOLD,
  DEFAULT_PRESSURE_SEMANTIC_RATE_THRESHOLD,
  DEFAULT_PRESSURE_UTILIZATION_THRESHOLD,
  PRESSURE_JITTER_DEADBAND,
  PRESSURE_JITTER_DEADBAND_UTILIZATION,
  PRESSURE_LEARN_ALPHA_BASE,
  PRESSURE_MAX_STEP_RATE,
  PRESSURE_MAX_STEP_UTILIZATION,
  clampLearnAlpha,
  clampPressureRateThreshold,
  clampPressureUtilizationThreshold,
  clampSignedUnit,
  roundThreshold,
  smoothThresholdWithGuard,
} from "./core";

function deriveAdaptiveLearnAlpha(args: {
  window: PromptQualityGuardAdaptiveInput["window"];
  guardTriggered: boolean;
  baseUtilization: number;
  baseSemantic: number;
  baseAutoLimit: number;
  trendRising: boolean;
  trendFalling: boolean;
  trendFlipSuppressed: boolean;
}): number {
  const deltas: number[] = [];
  if (typeof args.window.averageUtilizationRatio === "number") {
    deltas.push(Math.abs(args.window.averageUtilizationRatio - args.baseUtilization));
  }
  if (typeof args.window.snapshotSemanticCompressRate === "number") {
    deltas.push(Math.abs(args.window.snapshotSemanticCompressRate - args.baseSemantic));
  }
  if (typeof args.window.autoLimitTriggeredRate === "number") {
    deltas.push(Math.abs(args.window.autoLimitTriggeredRate - args.baseAutoLimit));
  }
  if (deltas.length === 0) {
    return PRESSURE_LEARN_ALPHA_BASE;
  }
  const meanDelta = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  let alpha = PRESSURE_LEARN_ALPHA_BASE + meanDelta * 0.9;
  if (args.window.degraded || args.guardTriggered) {
    alpha += 0.08;
  } else {
    alpha -= 0.05;
  }
  if (args.trendRising) {
    alpha += 0.06;
  } else if (args.trendFalling) {
    alpha -= 0.04;
  }
  if (args.trendFlipSuppressed) {
    alpha -= 0.09;
  }
  return clampLearnAlpha(alpha);
}

export function deriveAdaptivePressurePolicy(args: {
  state: PromptQualityGuardState;
  window: PromptQualityGuardAdaptiveInput["window"];
  guardTriggered: boolean;
}): {
  source: "state" | "learned";
  updated: boolean;
  learnAlpha: number;
  utilizationThreshold: number;
  semanticRateThreshold: number;
  autoLimitRateThreshold: number;
  jointRateThreshold: number;
  trendUtilizationDelta: number;
  trendSemanticDelta: number;
  trendAutoLimitDelta: number;
  trendMomentum: number;
  trendFlipSuppressed: boolean;
} {
  const baseUtilization = clampPressureUtilizationThreshold(
    args.state.pressureUtilizationThreshold,
    DEFAULT_PRESSURE_UTILIZATION_THRESHOLD,
  );
  const baseSemantic = clampPressureRateThreshold(
    args.state.pressureSemanticRateThreshold,
    DEFAULT_PRESSURE_SEMANTIC_RATE_THRESHOLD,
  );
  const baseAutoLimit = clampPressureRateThreshold(
    args.state.pressureAutoLimitRateThreshold,
    DEFAULT_PRESSURE_AUTO_LIMIT_RATE_THRESHOLD,
  );
  const baseJoint = clampPressureRateThreshold(
    args.state.pressureJointRateThreshold,
    DEFAULT_PRESSURE_JOINT_RATE_THRESHOLD,
  );
  const hasWindowPressureSignal =
    typeof args.window.snapshotSemanticCompressRate === "number"
    || typeof args.window.autoLimitTriggeredRate === "number"
    || typeof args.window.averageUtilizationRatio === "number"
    || typeof args.window.averagePreSendPressureScore === "number"
    || typeof args.window.averagePreSendOverflowRatio === "number"
    || typeof args.window.hardBudgetStrategyRate === "number";
  if (!hasWindowPressureSignal) {
    return {
      source: "state",
      updated: false,
      learnAlpha: PRESSURE_LEARN_ALPHA_BASE,
      utilizationThreshold: baseUtilization,
      semanticRateThreshold: baseSemantic,
      autoLimitRateThreshold: baseAutoLimit,
      jointRateThreshold: baseJoint,
      trendUtilizationDelta: roundThreshold(
        clampSignedUnit(args.state.pressureTrendUtilizationDelta, 0),
      ),
      trendSemanticDelta: roundThreshold(
        clampSignedUnit(args.state.pressureTrendSemanticDelta, 0),
      ),
      trendAutoLimitDelta: roundThreshold(
        clampSignedUnit(args.state.pressureTrendAutoLimitDelta, 0),
      ),
      trendMomentum: roundThreshold(
        clampSignedUnit(args.state.pressureTrendMomentum, 0),
      ),
      trendFlipSuppressed: false,
    };
  }
  const observedUtilization = typeof args.window.averageUtilizationRatio === "number"
    ? args.window.averageUtilizationRatio
    : baseUtilization;
  const observedSemanticRate = typeof args.window.snapshotSemanticCompressRate === "number"
    ? args.window.snapshotSemanticCompressRate
    : baseSemantic;
  const observedAutoLimitRate = typeof args.window.autoLimitTriggeredRate === "number"
    ? args.window.autoLimitTriggeredRate
    : baseAutoLimit;
  const trendUtilizationDelta = roundThreshold(
    clampSignedUnit(
      (
        typeof args.window.shortAverageUtilizationRatio === "number"
        && typeof args.window.mediumAverageUtilizationRatio === "number"
      )
        ? args.window.shortAverageUtilizationRatio - args.window.mediumAverageUtilizationRatio
        : args.state.pressureTrendUtilizationDelta,
      0,
    ),
  );
  const trendSemanticDelta = roundThreshold(
    clampSignedUnit(
      (
        typeof args.window.shortSnapshotSemanticCompressRate === "number"
        && typeof args.window.mediumSnapshotSemanticCompressRate === "number"
      )
        ? args.window.shortSnapshotSemanticCompressRate - args.window.mediumSnapshotSemanticCompressRate
        : args.state.pressureTrendSemanticDelta,
      0,
    ),
  );
  const trendAutoLimitDelta = roundThreshold(
    clampSignedUnit(
      (
        typeof args.window.shortAutoLimitTriggeredRate === "number"
        && typeof args.window.mediumAutoLimitTriggeredRate === "number"
      )
        ? args.window.shortAutoLimitTriggeredRate - args.window.mediumAutoLimitTriggeredRate
        : args.state.pressureTrendAutoLimitDelta,
      0,
    ),
  );
  const trendSignal = roundThreshold(
    clampSignedUnit(
      trendUtilizationDelta * 0.45
      + trendSemanticDelta * 0.30
      + trendAutoLimitDelta * 0.25,
      0,
    ),
  );
  const previousTrendMomentum = roundThreshold(
    clampSignedUnit(args.state.pressureTrendMomentum, 0),
  );
  const trendMomentum = roundThreshold(
    clampSignedUnit(previousTrendMomentum * 0.65 + trendSignal * 0.35, 0),
  );
  const trendRising = trendMomentum >= 0.04 || trendSignal >= 0.06;
  const trendFalling = trendMomentum <= -0.04 || trendSignal <= -0.06;
  const trendFlipSuppressed =
    Math.sign(previousTrendMomentum) !== 0
    && Math.sign(trendMomentum) !== 0
    && Math.sign(previousTrendMomentum) !== Math.sign(trendMomentum)
    && Math.abs(trendMomentum) < 0.16;
  const learnAlpha = deriveAdaptiveLearnAlpha({
    window: args.window,
    guardTriggered: args.guardTriggered,
    baseUtilization,
    baseSemantic,
    baseAutoLimit,
    trendRising,
    trendFalling,
    trendFlipSuppressed,
  });
  let utilizationTarget = clampPressureUtilizationThreshold(
    observedUtilization + 0.03,
    baseUtilization,
  );
  let semanticRateTarget = clampPressureRateThreshold(
    observedSemanticRate + 0.06,
    baseSemantic,
  );
  let autoLimitRateTarget = clampPressureRateThreshold(
    observedAutoLimitRate + 0.08,
    baseAutoLimit,
  );
  const strategyStress = Math.min(
    1,
    Math.max(
      0,
      (typeof args.window.averagePreSendPressureScore === "number"
        ? args.window.averagePreSendPressureScore
        : 0)
      + (typeof args.window.averagePreSendOverflowRatio === "number"
        ? args.window.averagePreSendOverflowRatio * 1.8
        : 0)
      + (typeof args.window.hardBudgetStrategyRate === "number"
        ? args.window.hardBudgetStrategyRate * 0.6
        : 0),
    ),
  );
  const strategyRecovered =
    (typeof args.window.qualityFirstStrategyRate !== "number"
      || args.window.qualityFirstStrategyRate >= 0.62)
    && (typeof args.window.hardBudgetStrategyRate !== "number"
      || args.window.hardBudgetStrategyRate <= 0.24)
    && (typeof args.window.averagePreSendPressureScore !== "number"
      || args.window.averagePreSendPressureScore <= 0.42)
    && (typeof args.window.averagePreSendOverflowRatio !== "number"
      || args.window.averagePreSendOverflowRatio <= 0.08);
  if (args.window.degraded) {
    utilizationTarget = clampPressureUtilizationThreshold(
      utilizationTarget - 0.03,
      utilizationTarget,
    );
    semanticRateTarget = clampPressureRateThreshold(
      semanticRateTarget - 0.03,
      semanticRateTarget,
    );
    autoLimitRateTarget = clampPressureRateThreshold(
      autoLimitRateTarget - 0.03,
      autoLimitRateTarget,
    );
  } else if (strategyStress >= 0.56) {
    utilizationTarget = clampPressureUtilizationThreshold(
      utilizationTarget - 0.015,
      utilizationTarget,
    );
    semanticRateTarget = clampPressureRateThreshold(
      semanticRateTarget - 0.015,
      semanticRateTarget,
    );
    autoLimitRateTarget = clampPressureRateThreshold(
      autoLimitRateTarget - 0.015,
      autoLimitRateTarget,
    );
  } else if (!args.guardTriggered && strategyRecovered) {
    utilizationTarget = clampPressureUtilizationThreshold(
      utilizationTarget + 0.008,
      utilizationTarget,
    );
    semanticRateTarget = clampPressureRateThreshold(
      semanticRateTarget + 0.008,
      semanticRateTarget,
    );
    autoLimitRateTarget = clampPressureRateThreshold(
      autoLimitRateTarget + 0.008,
      autoLimitRateTarget,
    );
  } else if (!args.guardTriggered) {
    utilizationTarget = clampPressureUtilizationThreshold(
      utilizationTarget + 0.01,
      utilizationTarget,
    );
    semanticRateTarget = clampPressureRateThreshold(
      semanticRateTarget + 0.01,
      semanticRateTarget,
    );
    autoLimitRateTarget = clampPressureRateThreshold(
      autoLimitRateTarget + 0.01,
      autoLimitRateTarget,
    );
  }
  const utilizationThreshold = smoothThresholdWithGuard({
    current: baseUtilization,
    target: utilizationTarget,
    alpha: learnAlpha,
    deadband: PRESSURE_JITTER_DEADBAND_UTILIZATION,
    maxStep: PRESSURE_MAX_STEP_UTILIZATION,
  });
  const semanticRateThreshold = smoothThresholdWithGuard({
    current: baseSemantic,
    target: semanticRateTarget,
    alpha: learnAlpha,
    deadband: PRESSURE_JITTER_DEADBAND,
    maxStep: PRESSURE_MAX_STEP_RATE,
  });
  const autoLimitRateThreshold = smoothThresholdWithGuard({
    current: baseAutoLimit,
    target: autoLimitRateTarget,
    alpha: learnAlpha,
    deadband: PRESSURE_JITTER_DEADBAND,
    maxStep: PRESSURE_MAX_STEP_RATE,
  });
  const jointRateTarget = clampPressureRateThreshold(
    Math.max(0.05, Math.min(semanticRateThreshold, autoLimitRateThreshold) - 0.05),
    baseJoint,
  );
  const jointRateThreshold = smoothThresholdWithGuard({
    current: baseJoint,
    target: jointRateTarget,
    alpha: learnAlpha,
    deadband: PRESSURE_JITTER_DEADBAND,
    maxStep: PRESSURE_MAX_STEP_RATE,
  });
  const updated = Math.abs(utilizationThreshold - baseUtilization) >= 0.001
    || Math.abs(semanticRateThreshold - baseSemantic) >= 0.001
    || Math.abs(autoLimitRateThreshold - baseAutoLimit) >= 0.001
    || Math.abs(jointRateThreshold - baseJoint) >= 0.001;
  return {
    source: "learned",
    updated,
    learnAlpha,
    utilizationThreshold,
    semanticRateThreshold,
    autoLimitRateThreshold,
    jointRateThreshold,
    trendUtilizationDelta,
    trendSemanticDelta,
    trendAutoLimitDelta,
    trendMomentum,
    trendFlipSuppressed,
  };
}
