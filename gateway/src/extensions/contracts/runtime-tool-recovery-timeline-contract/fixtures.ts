import type { RuntimeToolRecoveryFeedback, RuntimeToolSurfaceMetricsSnapshot } from "../../../tools/runtime/tool-events";
import type { RuntimeToolRecoveryPolicySnapshot } from "../../../tools/runtime/tool-recovery-policy";
import type { RuntimeToolSurfaceAdaptationSnapshot } from "../../../tools/runtime/tool-surface-adaptation-state";

export const olderObservedAt = "2026-04-26T00:00:00.000Z";
export const latestObservedAt = "2026-04-26T00:05:00.000Z";
export const consumedAt = "2026-04-26T00:06:00.000Z";
export const contractPathPrefix = [
  process.env.TMPDIR ?? "/tmp",
  `grobot-runtime-tool-recovery-timeline-contract-${String(process.pid)}-${String(Date.now())}`,
].join("/");

export const expectedEscalation = {
  sameToolErrorCount: 3,
  escalated: true,
  escalationReason: "same_tool_error_exhausted",
  escalationPolicyVersion: "v1",
  baseStage: "strategy_switch" as const,
  baseRecommendedNextAction: "switch_tool_strategy",
};

export const customPolicy: RuntimeToolRecoveryPolicySnapshot = {
  version: "v-test-health",
  promptMaxAgeMs: 1_000,
  timelineMaxEntries: 5,
  adaptationHistoryMaxEntries: 5,
  recoveryConsumptionHistoryMaxEntries: 5,
  guard: {
    repeatedProfileFailureThreshold: 2,
    recentProfileSequenceSize: 4,
    oscillationProfileWindowSize: 4,
  },
  escalation: {
    sameToolErrorStrategySwitchThreshold: 2,
    sameToolErrorAskUserThreshold: 3,
    environmentAskUserThreshold: 2,
    browserEnvironmentAskUserThreshold: 2,
  },
  health: {
    riskScoreThreshold: 40,
    watchScoreThreshold: 90,
    penalties: {
      activeRecovery: 5,
      activeNonrecoverable: 7,
      stuckNonrecoverable: 11,
      historicalUnconsumed: 13,
    },
  },
};

export const metrics: RuntimeToolSurfaceMetricsSnapshot = {
  version: 1,
  updatedAt: latestObservedAt,
  callsTotal: 3,
  failedTotal: 2,
  deferredTotal: 0,
  callsByTool: {
    read: 1,
    web_scan: 2,
  },
  failuresByErrorClass: {
    path_not_found: 1,
    config_missing: 1,
  },
  recoveryStages: {
    local_fix: 1,
    ask_user: 1,
  },
  recoveryCountsByKey: {
    "tool_error:read:path_not_found": 1,
    "tool_error:web_scan:config_missing": 1,
  },
  latestRecoveryRepeatKey: "tool_error:web_scan:config_missing",
  latestRecoveryRepeatCount: 1,
  avgDurationMsByTool: {
    read: 8,
    web_scan: 12,
  },
  recentRecoveries: [
    {
      stage: "local_fix",
      reason: "path_not_found",
      recommendedNextAction: "locate_path_with_glob_before_retry",
      toolName: "read",
      errorClass: "path_not_found",
      recoverable: true,
      observedAt: olderObservedAt,
    },
    {
      stage: "ask_user",
      reason: "same_tool_error_exhausted",
      recommendedNextAction: "ask_user_for_config_or_switch_provider",
      toolName: "web_scan",
      errorClass: "config_missing",
      recoverable: false,
      requiresUserIntervention: true,
      ...expectedEscalation,
      observedAt: latestObservedAt,
    },
  ],
  latestRecovery: {
    stage: "ask_user",
    reason: "same_tool_error_exhausted",
    recommendedNextAction: "ask_user_for_config_or_switch_provider",
    toolName: "web_scan",
    errorClass: "config_missing",
    recoverable: false,
    requiresUserIntervention: true,
    ...expectedEscalation,
    observedAt: latestObservedAt,
  },
  path: `${contractPathPrefix}/metrics`,
};

export const emptyAdaptationSnapshot: RuntimeToolSurfaceAdaptationSnapshot = {
  version: 1,
  updatedAt: null,
  path: `${contractPathPrefix}/adaptation`,
  recentAdaptations: [],
  latestAdaptation: null,
  profileOutcomes: {},
  recentRecoveryConsumptions: [],
  latestRecoveryConsumption: null,
};

export const activeFeedback: RuntimeToolRecoveryFeedback = {
  active: true,
  severity: "warning",
  reason: "recent_recovery",
  stage: "ask_user",
  toolName: "web_scan",
  errorClass: "config_missing",
  recommendedNextAction: "ask_user_for_config_or_switch_provider",
  recoverable: false,
  requiresUserIntervention: true,
  promptBlock: "[Runtime Tool Recovery Hint]",
  observedAt: latestObservedAt,
  consumed: false,
  consumedReason: null,
  consumedAt: null,
};

export const browserMetrics: RuntimeToolSurfaceMetricsSnapshot = {
  ...metrics,
  callsByTool: { web_scan: 1 },
  failuresByErrorClass: { browser_backend_result_error: 1 },
  recoveryStages: { ask_user: 1 },
  recoveryCountsByKey: {
    "tool_error:web_scan:browser_backend_result_error": 2,
  },
  latestRecoveryRepeatKey: "tool_error:web_scan:browser_backend_result_error",
  latestRecoveryRepeatCount: 2,
  recentRecoveries: [
    {
      stage: "ask_user",
      reason: "browser_backend_result_error",
      recommendedNextAction: "request_environment_fix",
      toolName: "web_scan",
      errorClass: "browser_backend_result_error",
      errorData: {
        diagnostic_kind: "browser_backend_result_error",
        error_code: "NO_EXTENSION",
      },
      recoverable: false,
      requiresUserIntervention: true,
      sameToolErrorCount: 2,
      escalated: true,
      escalationReason: "browser_environment_error_repeated",
      escalationPolicyVersion: "v1",
      baseStage: "strategy_switch",
      baseRecommendedNextAction: "inspect_error_and_switch_strategy",
      observedAt: latestObservedAt,
    },
  ],
  latestRecovery: {
    stage: "ask_user",
    reason: "browser_backend_result_error",
    recommendedNextAction: "request_environment_fix",
    toolName: "web_scan",
    errorClass: "browser_backend_result_error",
    errorData: {
      diagnostic_kind: "browser_backend_result_error",
      error_code: "NO_EXTENSION",
    },
    recoverable: false,
    requiresUserIntervention: true,
    sameToolErrorCount: 2,
    escalated: true,
    escalationReason: "browser_environment_error_repeated",
    escalationPolicyVersion: "v1",
    baseStage: "strategy_switch",
    baseRecommendedNextAction: "inspect_error_and_switch_strategy",
    observedAt: latestObservedAt,
  },
};

export const browserFeedback: RuntimeToolRecoveryFeedback = {
  active: true,
  severity: "warning",
  reason: "repeated_recovery_escalated",
  stage: "ask_user",
  toolName: "web_scan",
  errorClass: "browser_backend_result_error",
  recommendedNextAction: "request_environment_fix",
  recoverable: false,
  requiresUserIntervention: true,
  sameToolErrorCount: 2,
  escalated: true,
  escalationReason: "browser_environment_error_repeated",
  escalationPolicyVersion: "v1",
  baseStage: "strategy_switch",
  baseRecommendedNextAction: "inspect_error_and_switch_strategy",
  promptBlock: "[Runtime Tool Recovery Hint]",
  observedAt: latestObservedAt,
  consumed: false,
  consumedReason: null,
  consumedAt: null,
};
