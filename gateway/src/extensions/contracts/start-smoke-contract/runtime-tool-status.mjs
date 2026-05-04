function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortedObjectKeys(value) {
  return isObject(value) ? Object.keys(value).sort() : null;
}

function sameStringArray(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index]);
}

export function sumStringArrayRecordLengths(value) {
  if (!isObject(value)) {
    return null;
  }
  let total = 0;
  for (const row of Object.values(value)) {
    if (!Array.isArray(row) || !row.every((item) => typeof item === "string" && item.trim().length > 0)) {
      return null;
    }
    total += row.length;
  }
  return total;
}

export function assertRuntimeToolSchemaArgVisibility(projection) {
  if (!isObject(projection)) {
    throw new Error("runtime tool schema projection missing");
  }
  const perToolPropertyCount = isObject(projection.per_tool_property_count)
    ? projection.per_tool_property_count
    : null;
  const perToolVisibleArgs = isObject(projection.per_tool_visible_args)
    ? projection.per_tool_visible_args
    : null;
  const perToolSuppressedArgs = isObject(projection.per_tool_suppressed_args)
    ? projection.per_tool_suppressed_args
    : null;
  const propertyKeys = sortedObjectKeys(perToolPropertyCount);
  const visibleArgKeys = sortedObjectKeys(perToolVisibleArgs);
  const suppressedArgKeys = sortedObjectKeys(perToolSuppressedArgs);
  if (!sameStringArray(propertyKeys, visibleArgKeys) || !sameStringArray(propertyKeys, suppressedArgKeys)) {
    throw new Error("runtime tool schema arg metadata keys do not match per-tool property keys");
  }
  const visibleArgTotal = sumStringArrayRecordLengths(perToolVisibleArgs);
  const suppressedArgTotal = sumStringArrayRecordLengths(perToolSuppressedArgs);
  if (visibleArgTotal !== projection.schema_property_count) {
    throw new Error(
      `runtime tool visible arg total mismatch: actual=${String(visibleArgTotal)} expected=${String(projection.schema_property_count)}`,
    );
  }
  if (suppressedArgTotal !== projection.suppressed_schema_property_count) {
    throw new Error(
      `runtime tool suppressed arg total mismatch: actual=${String(suppressedArgTotal)} expected=${String(projection.suppressed_schema_property_count)}`,
    );
  }
  for (const [toolName, rawCount] of Object.entries(perToolPropertyCount)) {
    const visibleArgs = perToolVisibleArgs[toolName];
    if (!Array.isArray(visibleArgs) || visibleArgs.length !== rawCount) {
      throw new Error(
        `runtime tool visible arg count mismatch for ${toolName}: actual=${String(Array.isArray(visibleArgs) ? visibleArgs.length : null)} expected=${String(rawCount)}`,
      );
    }
  }
}

const RUNTIME_TOOL_RECOVERY_ESCALATION_STATUS_KEYS = [
  "same_tool_error_count",
  "escalated",
  "escalation_reason",
  "escalation_policy_version",
  "base_recovery_stage",
  "base_recommended_next_action",
];

export const EXPECTED_REPEATED_TOOL_RECOVERY_ESCALATION_STATUS = {
  same_tool_error_count: 3,
  escalated: true,
  escalation_reason: "same_tool_error_exhausted",
  escalation_policy_version: "v1",
  base_recovery_stage: "strategy_switch",
  base_recommended_next_action: "switch_tool_strategy",
};

export const EXPECTED_RUNTIME_TOOL_RECOVERY_POLICY_STATUS = {
  version: "v1",
  prompt_max_age_ms: 86_400_000,
  timeline_max_entries: 20,
  adaptation_history_max_entries: 40,
  recovery_consumption_history_max_entries: 40,
  guard: {
    repeated_profile_failure_threshold: 2,
    recent_profile_sequence_size: 4,
    oscillation_profile_window_size: 4,
  },
  escalation: {
    same_tool_error_strategy_switch_threshold: 2,
    same_tool_error_ask_user_threshold: 3,
    environment_ask_user_threshold: 2,
    browser_environment_ask_user_threshold: 2,
  },
  health: {
    risk_score_threshold: 60,
    watch_score_threshold: 85,
    penalties: {
      active_recovery: 12,
      active_nonrecoverable: 28,
      stuck_nonrecoverable: 20,
      historical_unconsumed: 4,
    },
  },
};

function hasOwnKey(value, key) {
  return isObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function assertEqualValue(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: actual=${String(actual)} expected=${String(expected)}`);
  }
}

export function runtimeToolRecoveryEscalationTextSurface(textOutput) {
  const text = typeof textOutput === "string" ? textOutput : "";
  const escalationTuple =
    "same_tool_error_count=.*escalated=.*escalation_reason=.*"
    + "escalation_policy_version=.*base_recovery_stage=.*base_recommended_next_action=";
  return {
    text_has_recovery_feedback_escalation_tuple:
      new RegExp(`runtime_tool_recovery_feedback: [^\\n]*${escalationTuple}`).test(text),
    text_has_recovery_timeline_escalation_tuple:
      new RegExp(`runtime_tool_recovery_timeline: [^\\n]*${escalationTuple}`).test(text),
  };
}

export function runtimeToolRecoveryReadinessTextSurface(textOutput) {
  const text = typeof textOutput === "string" ? textOutput : "";
  const healthThresholds = [
    EXPECTED_RUNTIME_TOOL_RECOVERY_POLICY_STATUS.health.watch_score_threshold,
    EXPECTED_RUNTIME_TOOL_RECOVERY_POLICY_STATUS.health.risk_score_threshold,
  ].join("/");
  return {
    text_has_recovery_readiness_thresholds:
      new RegExp(`runtime_tool_recovery_readiness: [^\\n]*health_thresholds=${healthThresholds}`).test(text),
    text_has_recovery_gate_thresholds:
      new RegExp(`runtime_tool_recovery_gate: [^\\n]*health_thresholds=${healthThresholds}`).test(text),
  };
}

export function assertRuntimeToolRecoveryEscalationStatusSurface(input) {
  const recoveryFeedback = isObject(input?.recoveryFeedback)
    ? input.recoveryFeedback
    : null;
  if (!recoveryFeedback) {
    throw new Error("runtime tool recovery feedback missing");
  }
  for (const key of RUNTIME_TOOL_RECOVERY_ESCALATION_STATUS_KEYS) {
    if (!hasOwnKey(recoveryFeedback, key)) {
      throw new Error(`runtime tool recovery feedback missing escalation field: ${key}`);
    }
  }
  const latestRecoveryTimeline = isObject(input?.latestRecoveryTimeline)
    ? input.latestRecoveryTimeline
    : null;
  if (!latestRecoveryTimeline) {
    throw new Error("runtime tool recovery timeline latest entry missing");
  }
  for (const key of RUNTIME_TOOL_RECOVERY_ESCALATION_STATUS_KEYS) {
    if (!hasOwnKey(latestRecoveryTimeline, key)) {
      throw new Error(`runtime tool recovery timeline missing escalation field: ${key}`);
    }
  }
  const textSurface = runtimeToolRecoveryEscalationTextSurface(input?.textOutput);
  if (!textSurface.text_has_recovery_feedback_escalation_tuple) {
    throw new Error("text status missing recovery feedback escalation tuple");
  }
  if (!textSurface.text_has_recovery_timeline_escalation_tuple) {
    throw new Error("text status missing recovery timeline escalation tuple");
  }
  if (isObject(input?.expectedLatest)) {
    for (const [key, expected] of Object.entries(input.expectedLatest)) {
      if (recoveryFeedback[key] !== expected) {
        throw new Error(
          `runtime tool recovery feedback escalation field mismatch: ${key} actual=${String(recoveryFeedback[key])} expected=${String(expected)}`,
        );
      }
      if (latestRecoveryTimeline[key] !== expected) {
        throw new Error(
          `runtime tool recovery timeline escalation field mismatch: ${key} actual=${String(latestRecoveryTimeline[key])} expected=${String(expected)}`,
        );
      }
    }
  }
}

export function assertRuntimeToolRecoveryPolicyStatusSurface(input) {
  const recoveryPolicy = isObject(input?.recoveryPolicy)
    ? input.recoveryPolicy
    : null;
  if (!recoveryPolicy) {
    throw new Error("runtime tool recovery policy missing");
  }
  const expected = EXPECTED_RUNTIME_TOOL_RECOVERY_POLICY_STATUS;
  assertEqualValue(recoveryPolicy.version, expected.version, "runtime recovery policy version");
  assertEqualValue(
    recoveryPolicy.prompt_max_age_ms,
    expected.prompt_max_age_ms,
    "runtime recovery policy max age",
  );
  assertEqualValue(
    recoveryPolicy.timeline_max_entries,
    expected.timeline_max_entries,
    "runtime recovery policy timeline max entries",
  );
  assertEqualValue(
    recoveryPolicy.adaptation_history_max_entries,
    expected.adaptation_history_max_entries,
    "runtime recovery policy adaptation history max entries",
  );
  assertEqualValue(
    recoveryPolicy.recovery_consumption_history_max_entries,
    expected.recovery_consumption_history_max_entries,
    "runtime recovery policy consumption history max entries",
  );
  assertEqualValue(
    recoveryPolicy.guard?.repeated_profile_failure_threshold,
    expected.guard.repeated_profile_failure_threshold,
    "runtime recovery policy repeated profile failure threshold",
  );
  assertEqualValue(
    recoveryPolicy.guard?.recent_profile_sequence_size,
    expected.guard.recent_profile_sequence_size,
    "runtime recovery policy recent profile sequence size",
  );
  assertEqualValue(
    recoveryPolicy.guard?.oscillation_profile_window_size,
    expected.guard.oscillation_profile_window_size,
    "runtime recovery policy oscillation window size",
  );
  assertEqualValue(
    recoveryPolicy.escalation?.same_tool_error_strategy_switch_threshold,
    expected.escalation.same_tool_error_strategy_switch_threshold,
    "runtime recovery policy strategy switch threshold",
  );
  assertEqualValue(
    recoveryPolicy.escalation?.same_tool_error_ask_user_threshold,
    expected.escalation.same_tool_error_ask_user_threshold,
    "runtime recovery policy ask user threshold",
  );
  assertEqualValue(
    recoveryPolicy.escalation?.environment_ask_user_threshold,
    expected.escalation.environment_ask_user_threshold,
    "runtime recovery policy environment threshold",
  );
  assertEqualValue(
    recoveryPolicy.escalation?.browser_environment_ask_user_threshold,
    expected.escalation.browser_environment_ask_user_threshold,
    "runtime recovery policy browser environment threshold",
  );
  assertEqualValue(
    recoveryPolicy.health?.risk_score_threshold,
    expected.health.risk_score_threshold,
    "runtime recovery policy health risk threshold",
  );
  assertEqualValue(
    recoveryPolicy.health?.watch_score_threshold,
    expected.health.watch_score_threshold,
    "runtime recovery policy health watch threshold",
  );
  assertEqualValue(
    recoveryPolicy.health?.penalties?.active_recovery,
    expected.health.penalties.active_recovery,
    "runtime recovery policy active recovery penalty",
  );
  assertEqualValue(
    recoveryPolicy.health?.penalties?.active_nonrecoverable,
    expected.health.penalties.active_nonrecoverable,
    "runtime recovery policy active nonrecoverable penalty",
  );
  assertEqualValue(
    recoveryPolicy.health?.penalties?.stuck_nonrecoverable,
    expected.health.penalties.stuck_nonrecoverable,
    "runtime recovery policy stuck nonrecoverable penalty",
  );
  assertEqualValue(
    recoveryPolicy.health?.penalties?.historical_unconsumed,
    expected.health.penalties.historical_unconsumed,
    "runtime recovery policy historical unconsumed penalty",
  );
  const text = typeof input?.textOutput === "string" ? input.textOutput : "";
  if (!text) {
    return;
  }
  const requiredTextSnippets = [
    "runtime_tool_recovery_policy:",
    `version=${expected.version}`,
    `prompt_max_age_ms=${String(expected.prompt_max_age_ms)}`,
    `timeline_max_entries=${String(expected.timeline_max_entries)}`,
    `adaptation_history_max_entries=${String(expected.adaptation_history_max_entries)}`,
    `recovery_consumption_history_max_entries=${String(expected.recovery_consumption_history_max_entries)}`,
    `guard_repeat_failures=${String(expected.guard.repeated_profile_failure_threshold)}`,
    `guard_recent_profile_sequence=${String(expected.guard.recent_profile_sequence_size)}`,
    `guard_oscillation_window=${String(expected.guard.oscillation_profile_window_size)}`,
    `escalation_thresholds=${String(expected.escalation.same_tool_error_strategy_switch_threshold)}/${String(expected.escalation.same_tool_error_ask_user_threshold)}`,
    `environment_ask_user_threshold=${String(expected.escalation.environment_ask_user_threshold)}`,
    `browser_environment_ask_user_threshold=${String(expected.escalation.browser_environment_ask_user_threshold)}`,
    `health_thresholds=${String(expected.health.watch_score_threshold)}/${String(expected.health.risk_score_threshold)}`,
    `health_penalties=${String(expected.health.penalties.active_recovery)}/${String(expected.health.penalties.active_nonrecoverable)}/${String(expected.health.penalties.stuck_nonrecoverable)}/${String(expected.health.penalties.historical_unconsumed)}`,
  ];
  for (const snippet of requiredTextSnippets) {
    if (!text.includes(snippet)) {
      throw new Error(`text status missing runtime recovery policy snippet: ${snippet}`);
    }
  }
}
