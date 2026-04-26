export interface RuntimeToolRecoveryPolicySnapshot {
  version: string;
  promptMaxAgeMs: number;
  timelineMaxEntries: number;
  adaptationHistoryMaxEntries: number;
  recoveryConsumptionHistoryMaxEntries: number;
  guard: {
    repeatedProfileFailureThreshold: number;
    recentProfileSequenceSize: number;
    oscillationProfileWindowSize: number;
  };
  health: {
    riskScoreThreshold: number;
    watchScoreThreshold: number;
    penalties: {
      activeRecovery: number;
      activeNonrecoverable: number;
      stuckNonrecoverable: number;
      historicalUnconsumed: number;
    };
  };
}

export const RUNTIME_TOOL_RECOVERY_POLICY_VERSION = "v1";

export const RUNTIME_TOOL_RECOVERY_POLICY: RuntimeToolRecoveryPolicySnapshot = {
  version: RUNTIME_TOOL_RECOVERY_POLICY_VERSION,
  promptMaxAgeMs: 24 * 60 * 60 * 1000,
  timelineMaxEntries: 20,
  adaptationHistoryMaxEntries: 40,
  recoveryConsumptionHistoryMaxEntries: 40,
  guard: {
    repeatedProfileFailureThreshold: 2,
    recentProfileSequenceSize: 4,
    oscillationProfileWindowSize: 4,
  },
  health: {
    riskScoreThreshold: 60,
    watchScoreThreshold: 85,
    penalties: {
      activeRecovery: 12,
      activeNonrecoverable: 28,
      stuckNonrecoverable: 20,
      historicalUnconsumed: 4,
    },
  },
};

export function getRuntimeToolRecoveryPolicySnapshot(): RuntimeToolRecoveryPolicySnapshot {
  return {
    version: RUNTIME_TOOL_RECOVERY_POLICY.version,
    promptMaxAgeMs: RUNTIME_TOOL_RECOVERY_POLICY.promptMaxAgeMs,
    timelineMaxEntries: RUNTIME_TOOL_RECOVERY_POLICY.timelineMaxEntries,
    adaptationHistoryMaxEntries: RUNTIME_TOOL_RECOVERY_POLICY.adaptationHistoryMaxEntries,
    recoveryConsumptionHistoryMaxEntries: RUNTIME_TOOL_RECOVERY_POLICY.recoveryConsumptionHistoryMaxEntries,
    guard: {
      repeatedProfileFailureThreshold: RUNTIME_TOOL_RECOVERY_POLICY.guard.repeatedProfileFailureThreshold,
      recentProfileSequenceSize: RUNTIME_TOOL_RECOVERY_POLICY.guard.recentProfileSequenceSize,
      oscillationProfileWindowSize: RUNTIME_TOOL_RECOVERY_POLICY.guard.oscillationProfileWindowSize,
    },
    health: {
      riskScoreThreshold: RUNTIME_TOOL_RECOVERY_POLICY.health.riskScoreThreshold,
      watchScoreThreshold: RUNTIME_TOOL_RECOVERY_POLICY.health.watchScoreThreshold,
      penalties: {
        activeRecovery: RUNTIME_TOOL_RECOVERY_POLICY.health.penalties.activeRecovery,
        activeNonrecoverable: RUNTIME_TOOL_RECOVERY_POLICY.health.penalties.activeNonrecoverable,
        stuckNonrecoverable: RUNTIME_TOOL_RECOVERY_POLICY.health.penalties.stuckNonrecoverable,
        historicalUnconsumed: RUNTIME_TOOL_RECOVERY_POLICY.health.penalties.historicalUnconsumed,
      },
    },
  };
}
