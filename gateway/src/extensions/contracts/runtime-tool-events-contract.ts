import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeEvent } from "../../models/types";
import { RuntimeRpcError, extractRuntimeErrorEvents } from "../../tools/runtime/runtime-error";
import {
  buildRuntimeToolRecoveryFeedback,
  clearRuntimeToolRecoveryRepeatPressure,
  formatRuntimeToolRecoveryEscalationFields,
  isRuntimeToolRecoveryAction,
  knownRuntimeToolRecoveryActions,
  RUNTIME_TOOL_RECOVERY_ACTION_INSTRUCTIONS,
  readRuntimeToolSurfaceMetrics,
  recordRuntimeToolSurfaceMetrics,
  summarizeRuntimeToolEvents,
} from "../../tools/runtime/tool-events";

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: actual=${String(actual)} expected=${String(expected)}`);
  }
}

function event(eventType: RuntimeEvent["eventType"], payload: Record<string, unknown>): RuntimeEvent {
  return {
    traceId: "trace_runtime_tool_events_contract",
    turnId: "turn_runtime_tool_events_contract",
    sessionKey: "dev:tenant:dm:user",
    eventType,
    payload,
    timestampIso: "2026-04-25T00:00:00.000Z",
  };
}

const events: RuntimeEvent[] = [
  event("tool_end", {
    tool_name: "read",
    status: "ok",
    duration_ms: 12,
  }),
  event("tool_end", {
    tool_name: "edit",
    status: "failed",
    error_class: "edit_stale_target",
    duration_ms: 18,
  }),
  event("tool_recovery", {
    tool_name: "edit",
    error_class: "edit_stale_target",
    recovery_stage: "local_fix",
    recovery_reason: "edit_stale_target",
    recommended_next_action: "reread_target_then_retry",
    recoverable: true,
  }),
  event("tool_end", {
    tool_name: "bash",
    status: "deferred",
    error_class: "tool_execution_deferred",
  }),
  event("tool_recovery", {
    tool_name: "bash",
    error_class: "tool_execution_deferred",
    error_message: "deferred until the prior high-risk tool result is observed",
    recovery_stage: "observe_first",
    recovery_reason: "tool_execution_deferred",
    recommended_next_action: "observe_prior_tool_result",
    recoverable: true,
  }),
];

const summary = summarizeRuntimeToolEvents(events);
expectEqual(summary.callsTotal, 3, "summary calls");
expectEqual(summary.failedTotal, 1, "summary failed");
expectEqual(summary.deferredTotal, 1, "summary deferred");
expectEqual(summary.callsByTool.read, 1, "summary read count");
expectEqual(summary.callsByTool.edit, 1, "summary edit count");
expectEqual(summary.failuresByErrorClass.edit_stale_target, 1, "summary edit failure class");
expectEqual(summary.failuresByErrorClass.tool_execution_deferred, 1, "summary deferred class");
expectEqual(summary.recoveryStages.local_fix, 1, "summary local recovery");
expectEqual(summary.recoveryStages.observe_first, 1, "summary observe recovery");
expectEqual(summary.latestRecovery?.stage, "observe_first", "summary latest recovery stage");
expectEqual(summary.latestRecovery?.recommendedNextAction, "observe_prior_tool_result", "summary latest action");
expectEqual(
  summary.latestRecovery?.errorMessage,
  "deferred until the prior high-risk tool result is observed",
  "summary latest error detail",
);
expectEqual(summary.latestRecovery?.recoverable, true, "summary latest recoverable");

const knownRecoveryActions = knownRuntimeToolRecoveryActions();
expect(knownRecoveryActions.includes("ask_user_for_config_or_switch_provider"), "catalog includes config action");
expect(knownRecoveryActions.includes("inspect_error_and_switch_strategy"), "catalog includes default fallback action");
expect(!knownRecoveryActions.includes("observe_and_continue" as never), "catalog rejects legacy observe_and_continue");
for (const action of knownRecoveryActions) {
  expect(
    RUNTIME_TOOL_RECOVERY_ACTION_INSTRUCTIONS[action].trim().length > 0,
    `catalog action has instruction: ${action}`,
  );
  expect(isRuntimeToolRecoveryAction(action), `catalog action is recognized: ${action}`);
}
expect(!isRuntimeToolRecoveryAction("observe_and_continue"), "legacy observe_and_continue is not recognized");

const missingActionSummary = summarizeRuntimeToolEvents([
  event("tool_recovery", {
    tool_name: "read",
    error_class: "unknown_error",
    recovery_stage: "strategy_switch",
    recovery_reason: "unknown_error",
  }),
]);
expectEqual(
  missingActionSummary.latestRecovery?.recommendedNextAction,
  "inspect_error_and_switch_strategy",
  "missing action uses cataloged default",
);

const structuredRecoveryObservedAt = "2026-04-25T00:00:30.000Z";
const structuredRecoveryEvents: RuntimeEvent[] = [
  event("tool_recovery", {
    tool_name: "edit",
    error_class: "edit_not_found",
    error_message: "edit.edits[0] not found in sample.txt; closest_lines=line 1: \"alpha_count = 1;\"",
    error_data: {
      path: "sample.txt",
      edit_index: 0,
      diagnostics: {
        diagnostic_kind: "edit_not_found",
        closest_lines: [
          {
            line: 1,
            preview: "alpha_count = 1;",
          },
        ],
      },
    },
    recovery_stage: "local_fix",
    recovery_reason: "edit_not_found",
    recommended_next_action: "reread_target_then_retry_exact_old_text",
    recoverable: true,
    observed_at: structuredRecoveryObservedAt,
  }),
];
const structuredRecoverySummary = summarizeRuntimeToolEvents(structuredRecoveryEvents);
expectEqual(
  structuredRecoverySummary.latestRecovery?.errorData?.path,
  "sample.txt",
  "summary preserves structured error data path",
);
expectEqual(
  (structuredRecoverySummary.latestRecovery?.errorData?.diagnostics as Record<string, unknown> | undefined)
    ?.diagnostic_kind,
  "edit_not_found",
  "summary preserves structured diagnostics kind",
);
const structuredFeedback = buildRuntimeToolRecoveryFeedback({
  metrics: {
    version: 1,
    updatedAt: structuredRecoveryObservedAt,
    callsTotal: 0,
    failedTotal: 0,
    deferredTotal: 0,
    callsByTool: {},
    failuresByErrorClass: {},
    recoveryStages: { local_fix: 1 },
    recoveryCountsByKey: {},
    latestRecoveryRepeatKey: null,
    latestRecoveryRepeatCount: 0,
    avgDurationMsByTool: {},
    recentRecoveries: [],
    latestRecovery: structuredRecoverySummary.latestRecovery ?? null,
    path: "/tmp/grobot-runtime-tool-events-structured",
  },
  nowMs: Date.parse(structuredRecoveryObservedAt),
});
expectEqual(structuredFeedback.errorData?.path, "sample.txt", "feedback preserves structured error data path");
expect(
  structuredFeedback.promptBlock.includes("Structured error data: path=sample.txt edit_index=0"),
  "feedback summarizes structured error data",
);
expect(
  structuredFeedback.promptBlock.includes("closest_lines=line 1 \"alpha_count = 1;\""),
  "feedback summarizes structured closest lines",
);

const bashStructuredFeedback = buildRuntimeToolRecoveryFeedback({
  metrics: {
    version: 1,
    updatedAt: structuredRecoveryObservedAt,
    callsTotal: 0,
    failedTotal: 0,
    deferredTotal: 0,
    callsByTool: {},
    failuresByErrorClass: {},
    recoveryStages: { strategy_switch: 1 },
    recoveryCountsByKey: {},
    latestRecoveryRepeatKey: null,
    latestRecoveryRepeatCount: 0,
    avgDurationMsByTool: {},
    recentRecoveries: [],
    latestRecovery: {
      stage: "strategy_switch",
      reason: "bash_not_allowed",
      recommendedNextAction: "request_approval_or_use_safer_tool",
      toolName: "bash",
      errorClass: "bash_not_allowed",
      errorData: {
        diagnostic_kind: "bash_not_allowed",
        denied_segment: "uname",
        allowlist_rule_count: 1,
        recovery_hint: "use an allowlisted command segment or request approval/configuration",
      },
      recoverable: true,
      observedAt: structuredRecoveryObservedAt,
    },
    path: "/tmp/grobot-runtime-tool-events-bash-structured",
  },
  nowMs: Date.parse(structuredRecoveryObservedAt),
});
expect(
  bashStructuredFeedback.promptBlock.includes("diagnostic_kind=bash_not_allowed"),
  "feedback summarizes top-level diagnostic kind",
);
expect(
  bashStructuredFeedback.promptBlock.includes("denied_segment=\"uname\""),
  "feedback summarizes denied bash segment",
);

const mcpStructuredFeedback = buildRuntimeToolRecoveryFeedback({
  metrics: {
    version: 1,
    updatedAt: structuredRecoveryObservedAt,
    callsTotal: 0,
    failedTotal: 0,
    deferredTotal: 0,
    callsByTool: {},
    failuresByErrorClass: {},
    recoveryStages: { strategy_switch: 1 },
    recoveryCountsByKey: {},
    latestRecoveryRepeatKey: null,
    latestRecoveryRepeatCount: 0,
    avgDurationMsByTool: {},
    recentRecoveries: [],
    latestRecovery: {
      stage: "strategy_switch",
      reason: "mcp_tool_blocked",
      recommendedNextAction: "request_approval_or_use_safer_tool",
      toolName: "mcp_call",
      errorClass: "mcp_tool_blocked",
      errorData: {
        diagnostic_kind: "mcp_tool_blocked",
        server: "grok-search",
        server_key: "grok-search",
        tool_name: "web_search",
        operation: "policy_check",
        allow_tools: ["get_sources"],
        ready: true,
        ready_reason: "ok",
        recovery_hint: "use an allowed MCP tool or request policy change",
      },
      recoverable: true,
      observedAt: structuredRecoveryObservedAt,
    },
    path: "/tmp/grobot-runtime-tool-events-mcp-structured",
  },
  nowMs: Date.parse(structuredRecoveryObservedAt),
});
expect(
  mcpStructuredFeedback.promptBlock.includes("server=grok-search"),
  "feedback summarizes MCP server",
);
expect(
  mcpStructuredFeedback.promptBlock.includes("tool_name=web_search"),
  "feedback summarizes MCP tool name",
);
expect(
  mcpStructuredFeedback.promptBlock.includes("allow_tools=[\"get_sources\"]"),
  "feedback summarizes MCP allow_tools",
);

const nonRecoverableObservedAt = "2026-04-25T00:01:00.000Z";
const nonRecoverableFeedback = buildRuntimeToolRecoveryFeedback({
  metrics: {
    version: 1,
    updatedAt: nonRecoverableObservedAt,
    callsTotal: 0,
    failedTotal: 0,
    deferredTotal: 0,
    callsByTool: {},
    failuresByErrorClass: {},
    recoveryStages: { ask_user: 1 },
    recoveryCountsByKey: {},
    latestRecoveryRepeatKey: null,
    latestRecoveryRepeatCount: 0,
    avgDurationMsByTool: {},
    recentRecoveries: [],
    latestRecovery: {
      stage: "ask_user",
      reason: "config_missing",
      recommendedNextAction: "ask_user_for_config_or_switch_provider",
      toolName: "read",
      errorClass: "config_missing",
      recoverable: false,
      observedAt: nonRecoverableObservedAt,
    },
    path: "/tmp/grobot-runtime-tool-events-nonrecoverable",
  },
  nowMs: Date.parse(nonRecoverableObservedAt),
});
expectEqual(nonRecoverableFeedback.active, true, "nonrecoverable feedback active");
expectEqual(nonRecoverableFeedback.severity, "warning", "nonrecoverable feedback severity");
expectEqual(nonRecoverableFeedback.recoverable, false, "nonrecoverable feedback recoverable");
expectEqual(nonRecoverableFeedback.requiresUserIntervention, true, "nonrecoverable feedback requires intervention");
expect(
  nonRecoverableFeedback.promptBlock.includes("Recoverability: requires_user_intervention"),
  "nonrecoverable feedback recoverability"
);
expect(
  nonRecoverableFeedback.promptBlock.includes("Ask the user for missing configuration"),
  "nonrecoverable feedback action instruction"
);
expect(
  nonRecoverableFeedback.promptBlock.includes("Automatic recovery is blocked"),
  "nonrecoverable feedback blocks automatic recovery"
);
expect(
  nonRecoverableFeedback.promptBlock.includes("Do not retry the failing tool automatically"),
  "nonrecoverable feedback forbids automatic retry"
);

const workDir = join("/tmp", `grobot-runtime-tool-events-${String(process.pid)}-${String(Date.now())}`);
mkdirSync(workDir, { recursive: true });
try {
  const initial = readRuntimeToolSurfaceMetrics(workDir);
  expectEqual(initial.callsTotal, 0, "initial calls");
  expectEqual(initial.updatedAt, null, "initial updatedAt");

  const first = recordRuntimeToolSurfaceMetrics({ workDir, events });
  expectEqual(first.callsTotal, 3, "first calls");
  expectEqual(first.failedTotal, 1, "first failed");
  expectEqual(first.deferredTotal, 1, "first deferred");
  expectEqual(first.avgDurationMsByTool.read, 12, "first read avg");
  expectEqual(first.avgDurationMsByTool.edit, 18, "first edit avg");
  expectEqual(first.recentRecoveries.length, 1, "first recent recoveries length");
  expectEqual(first.latestRecovery?.stage, "observe_first", "first latest recovery");
  expectEqual(typeof first.latestRecovery?.observedAt, "string", "first latest recovery observedAt");

  const activeFeedback = buildRuntimeToolRecoveryFeedback({
    metrics: first,
    nowMs: Date.parse(first.latestRecovery?.observedAt ?? ""),
  });
  expectEqual(activeFeedback.active, true, "active feedback enabled");
  expectEqual(activeFeedback.severity, "info", "active feedback severity");
  expectEqual(activeFeedback.recommendedNextAction, "observe_prior_tool_result", "active feedback action");
  expectEqual(
    activeFeedback.errorMessage,
    "deferred until the prior high-risk tool result is observed",
    "active feedback error detail",
  );
  expectEqual(activeFeedback.recoverable, true, "active feedback recoverable");
  expectEqual(activeFeedback.requiresUserIntervention, false, "active feedback does not require intervention");
  expect(activeFeedback.promptBlock.includes("Error detail: deferred until"), "active feedback includes error detail");
  expect(activeFeedback.promptBlock.includes("Recoverability: auto_recoverable"), "active feedback recoverability");
  expect(activeFeedback.promptBlock.includes("do not repeat an identical failing tool call"), "active feedback prompt rule");

  const readBack = readRuntimeToolSurfaceMetrics(workDir);
  expectEqual(readBack.callsTotal, 3, "readback calls");
  expectEqual(readBack.recentRecoveries.length, 1, "readback recent recoveries length");
  expectEqual(readBack.latestRecovery?.recommendedNextAction, "observe_prior_tool_result", "readback latest action");

  const second = recordRuntimeToolSurfaceMetrics({ workDir, events: events.slice(0, 2) });
  expectEqual(second.callsTotal, 5, "second cumulative calls");
  expectEqual(second.failedTotal, 2, "second cumulative failed");
  expectEqual(second.callsByTool.read, 2, "second read count");
  expectEqual(second.callsByTool.edit, 2, "second edit count");
  expectEqual(second.recentRecoveries.length, 1, "second recent recoveries length is unchanged without recovery events");

  const staleFeedback = buildRuntimeToolRecoveryFeedback({
    metrics: second,
    nowMs: Date.parse(second.latestRecovery?.observedAt ?? "") + 2_000,
    maxAgeMs: 1,
  });
  expectEqual(staleFeedback.active, false, "stale feedback disabled");
  expectEqual(staleFeedback.reason, "stale_recovery", "stale feedback reason");
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

const repeatedWorkDir = join("/tmp", `grobot-runtime-tool-repeated-recovery-${String(process.pid)}-${String(Date.now())}`);
mkdirSync(repeatedWorkDir, { recursive: true });
try {
  const oldStateDir = join(repeatedWorkDir, ".grobot/runtime");
  mkdirSync(oldStateDir, { recursive: true });
  writeFileSync(
    join(oldStateDir, "tool-surface-metrics.json"),
    `${JSON.stringify({
      version: 1,
      updatedAt: "2026-04-25T00:00:00.000Z",
      callsTotal: 0,
      failedTotal: 0,
      deferredTotal: 0,
      callsByTool: {},
      failuresByErrorClass: {},
      recoveryStages: {},
      durationTotalMsByTool: {},
      durationCountByTool: {},
      recentRecoveries: [],
    }, null, 2)}\n`,
    "utf8",
  );
  const oldStateReadback = readRuntimeToolSurfaceMetrics(repeatedWorkDir);
  expectEqual(
    Object.keys(oldStateReadback.recoveryCountsByKey).length,
    0,
    "old state without recoveryCountsByKey is backward tolerant",
  );
  expectEqual(oldStateReadback.latestRecoveryRepeatKey, null, "old state repeat key defaults null");
  expectEqual(oldStateReadback.latestRecoveryRepeatCount, 0, "old state repeat count defaults zero");

  const repeatedRecoveryEvents: RuntimeEvent[] = [
    event("tool_end", {
      tool_name: "read",
      status: "failed",
      error_class: "path_not_found",
      duration_ms: 4,
    }),
    event("tool_recovery", {
      tool_name: "read",
      error_class: "path_not_found",
      recovery_stage: "local_fix",
      recovery_reason: "path_not_found",
      recommended_next_action: "locate_path_with_glob_before_retry",
      recoverable: true,
    }),
  ];

  const firstRepeated = recordRuntimeToolSurfaceMetrics({
    workDir: repeatedWorkDir,
    events: repeatedRecoveryEvents,
  });
  expectEqual(firstRepeated.latestRecovery?.stage, "local_fix", "first repeated recovery keeps local fix");
  expectEqual(firstRepeated.latestRecovery?.sameToolErrorCount, 1, "first repeated recovery count");
  expectEqual(firstRepeated.latestRecovery?.escalated, false, "first repeated recovery not escalated");
  expectEqual(
    firstRepeated.recoveryCountsByKey["tool_error:read:path_not_found"],
    1,
    "first repeated recovery key count",
  );
  expectEqual(firstRepeated.latestRecoveryRepeatKey, "tool_error:read:path_not_found", "first latest repeat key");
  expectEqual(firstRepeated.latestRecoveryRepeatCount, 1, "first latest repeat count");

  const secondRepeated = recordRuntimeToolSurfaceMetrics({
    workDir: repeatedWorkDir,
    events: repeatedRecoveryEvents,
  });
  const secondFeedback = buildRuntimeToolRecoveryFeedback({
    metrics: secondRepeated,
    nowMs: Date.parse(secondRepeated.latestRecovery?.observedAt ?? ""),
  });
  expectEqual(secondRepeated.latestRecovery?.stage, "strategy_switch", "second repeated recovery escalates stage");
  expectEqual(
    secondRepeated.latestRecovery?.recommendedNextAction,
    "switch_tool_strategy",
    "second repeated recovery escalates action",
  );
  expectEqual(secondRepeated.latestRecovery?.recoverable, true, "second repeated recovery remains recoverable");
  expectEqual(secondRepeated.latestRecovery?.sameToolErrorCount, 2, "second repeated recovery count");
  expectEqual(secondRepeated.latestRecovery?.escalated, true, "second repeated recovery escalated flag");
  expectEqual(
    secondRepeated.latestRecovery?.escalationReason,
    "same_tool_error_repeated",
    "second repeated recovery reason",
  );
  expectEqual(secondRepeated.latestRecovery?.baseStage, "local_fix", "second repeated recovery base stage");
  expectEqual(
    secondRepeated.latestRecovery?.baseRecommendedNextAction,
    "locate_path_with_glob_before_retry",
    "second repeated recovery base action",
  );
  expectEqual(secondRepeated.latestRecoveryRepeatCount, 2, "second latest repeat count");
  expectEqual(secondFeedback.active, true, "second repeated feedback active");
  expectEqual(secondFeedback.reason, "repeated_recovery_escalated", "second repeated feedback reason");
  expectEqual(secondFeedback.severity, "warning", "second repeated feedback severity");
  expectEqual(secondFeedback.requiresUserIntervention, false, "second repeated feedback remains automatic");
  expect(
    secondFeedback.promptBlock.includes("same_tool_error_count=2 escalated=true"),
    "second repeated feedback prompt includes repeat count",
  );
  expect(
    formatRuntimeToolRecoveryEscalationFields(secondFeedback)
      .includes("base_recovery_stage=local_fix"),
    "second repeated feedback formats base stage",
  );
  expect(
    formatRuntimeToolRecoveryEscalationFields(secondFeedback)
      .includes("escalation_policy_version=v1"),
    "second repeated feedback formats policy version",
  );

  const thirdRepeated = recordRuntimeToolSurfaceMetrics({
    workDir: repeatedWorkDir,
    events: repeatedRecoveryEvents,
  });
  const thirdFeedback = buildRuntimeToolRecoveryFeedback({
    metrics: thirdRepeated,
    nowMs: Date.parse(thirdRepeated.latestRecovery?.observedAt ?? ""),
  });
  expectEqual(thirdRepeated.latestRecovery?.stage, "ask_user", "third repeated recovery escalates to ask_user");
  expectEqual(
    thirdRepeated.latestRecovery?.recommendedNextAction,
    "ask_user_for_config_or_switch_provider",
    "third repeated recovery asks user",
  );
  expectEqual(thirdRepeated.latestRecovery?.recoverable, false, "third repeated recovery blocks automatic retry");
  expectEqual(thirdRepeated.latestRecovery?.requiresUserIntervention, true, "third repeated recovery intervention");
  expectEqual(thirdRepeated.latestRecovery?.sameToolErrorCount, 3, "third repeated recovery count");
  expectEqual(
    thirdRepeated.latestRecovery?.escalationReason,
    "same_tool_error_exhausted",
    "third repeated recovery exhausted reason",
  );
  expectEqual(
    thirdRepeated.recoveryCountsByKey["tool_error:read:path_not_found"],
    3,
    "third repeated recovery key count",
  );
  expectEqual(thirdRepeated.latestRecoveryRepeatCount, 3, "third latest repeat count");
  expectEqual(thirdFeedback.requiresUserIntervention, true, "third repeated feedback requires intervention");
  expect(
    thirdFeedback.promptBlock.includes("Automatic recovery is blocked"),
    "third repeated feedback blocks automatic retry",
  );

  const successReset = recordRuntimeToolSurfaceMetrics({
    workDir: repeatedWorkDir,
    events: [
      event("tool_end", {
        tool_name: "read",
        status: "ok",
        duration_ms: 3,
      }),
    ],
  });
  expectEqual(successReset.latestRecoveryRepeatKey, null, "successful tool batch resets repeat key");
  expectEqual(successReset.latestRecoveryRepeatCount, 0, "successful tool batch resets repeat count");

  const afterReset = recordRuntimeToolSurfaceMetrics({
    workDir: repeatedWorkDir,
    events: repeatedRecoveryEvents,
  });
  expectEqual(afterReset.latestRecovery?.stage, "local_fix", "after reset recovery does not stay escalated");
  expectEqual(afterReset.latestRecovery?.sameToolErrorCount, 1, "after reset recovery count restarts");
  const mismatchedClear = clearRuntimeToolRecoveryRepeatPressure({
    workDir: repeatedWorkDir,
    toolName: "web_scan",
    errorClass: "path_not_found",
    nowIso: "2026-04-25T00:02:00.000Z",
  });
  expectEqual(mismatchedClear.cleared, false, "mismatched repeat pressure clear is ignored");
  expectEqual(mismatchedClear.snapshot.latestRecoveryRepeatCount, 1, "mismatched clear keeps repeat count");
  const matchingClear = clearRuntimeToolRecoveryRepeatPressure({
    workDir: repeatedWorkDir,
    toolName: "read",
    errorClass: "path_not_found",
    nowIso: "2026-04-25T00:02:01.000Z",
  });
  expectEqual(matchingClear.cleared, true, "matching repeat pressure clear succeeds");
  expectEqual(matchingClear.snapshot.latestRecoveryRepeatKey, null, "matching clear resets repeat key");
  expectEqual(matchingClear.snapshot.latestRecoveryRepeatCount, 0, "matching clear resets repeat count");
} finally {
  rmSync(repeatedWorkDir, { recursive: true, force: true });
}

const runtimeError = new RuntimeRpcError({
  message: "runtime rpc error -32001: runtime turn execution failed",
  errorClass: "edit_stale_target",
  errorMessage: "stale edit target",
  traceId: "trace_runtime_tool_events_contract",
  runtimeEvents: events,
});
expectEqual(extractRuntimeErrorEvents(runtimeError).length, events.length, "runtime error events extracted");
expectEqual(extractRuntimeErrorEvents(new Error("plain")).length, 0, "plain error has no runtime events");
expect(summary.latestRecovery !== undefined, "latest recovery exists");

process.stdout.write(JSON.stringify({
  ok: true,
  summary_calls_total: summary.callsTotal,
  summary_failed_total: summary.failedTotal,
  summary_deferred_total: summary.deferredTotal,
  latest_recovery_stage: summary.latestRecovery?.stage,
  runtime_error_events: extractRuntimeErrorEvents(runtimeError).length,
  feedback_active: true,
  latest_recovery_recoverable: summary.latestRecovery?.recoverable,
  nonrecoverable_requires_user_intervention: nonRecoverableFeedback.requiresUserIntervention,
  repeated_recovery_escalation: true,
  recovery_action_catalog_size: knownRecoveryActions.length,
  missing_action_default: missingActionSummary.latestRecovery?.recommendedNextAction,
}) + "\n");
