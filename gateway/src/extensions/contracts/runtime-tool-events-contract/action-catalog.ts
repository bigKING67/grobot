import type { RuntimeEvent } from "../../../models/types";
import {
  buildRuntimeToolRecoveryFeedback,
  isRuntimeToolRecoveryAction,
  knownRuntimeToolRecoveryActions,
  normalizeRuntimeToolRecoveryAction,
  RUNTIME_TOOL_RECOVERY_ACTION_INSTRUCTIONS,
  summarizeRuntimeToolEvents,
  type RuntimeToolEventSummary,
  type RuntimeToolRecoveryFeedback,
} from "../../../tools/runtime/tool-events";
import { getRuntimeToolRecoveryPolicySnapshot } from "../../../tools/runtime/tool-recovery-policy";
import {
  event,
  expect,
  expectEqual,
  expectFeedbackActionInCatalog,
} from "./helpers";

export function runRuntimeToolActionCatalogContracts(input: {
  contractPath: (name: string) => string;
}): {
  events: RuntimeEvent[];
  summary: RuntimeToolEventSummary;
  knownRecoveryActions: readonly string[];
  missingActionSummary: RuntimeToolEventSummary;
  legacyActionFeedback: RuntimeToolRecoveryFeedback;
} {
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
  expect(knownRecoveryActions.includes("fix_mcp_tool_arguments"), "catalog includes MCP argument action");
  expect(knownRecoveryActions.includes("reduce_mcp_argument_payload"), "catalog includes MCP payload action");
  expect(
    knownRecoveryActions.includes("use_allowed_mcp_tool_or_request_policy_change"),
    "catalog includes MCP policy action",
  );
  expect(!knownRecoveryActions.includes("observe_and_continue" as never), "catalog rejects legacy observe_and_continue");
  for (const action of knownRecoveryActions) {
    expect(
      RUNTIME_TOOL_RECOVERY_ACTION_INSTRUCTIONS[action].trim().length > 0,
      `catalog action has instruction: ${action}`,
    );
    expectFeedbackActionInCatalog(action, `catalog action is recognized: ${action}`);
  }
  expect(!knownRecoveryActions.includes("observe_and_continue" as never), "legacy observe_and_continue is not recognized");
  expectEqual(
    normalizeRuntimeToolRecoveryAction(" observe_prior_tool_result "),
    "observe_prior_tool_result",
    "action normalizer trims and preserves cataloged action",
  );
  expectEqual(
    normalizeRuntimeToolRecoveryAction("observe_and_continue"),
    "inspect_error_and_switch_strategy",
    "action normalizer rejects legacy free-form action",
  );
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

  const legacyActionObservedAt = "2026-04-25T00:00:15.000Z";
  const legacyActionSummary = summarizeRuntimeToolEvents([
    event("tool_recovery", {
      tool_name: "read",
      error_class: "legacy_runtime_error",
      recovery_stage: "strategy_switch",
      recovery_reason: "legacy_runtime_error",
      recommended_next_action: "observe_and_continue",
      recoverable: true,
      observed_at: legacyActionObservedAt,
    }),
  ]);
  expectEqual(
    legacyActionSummary.latestRecovery?.recommendedNextAction,
    "observe_and_continue",
    "summary preserves raw legacy action before prompt normalization",
  );
  const legacyActionFeedback = buildRuntimeToolRecoveryFeedback({
    metrics: {
      version: 1,
      updatedAt: legacyActionObservedAt,
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
      latestRecovery: legacyActionSummary.latestRecovery ?? null,
      path: input.contractPath("legacy-action"),
    },
    nowMs: Date.parse(legacyActionObservedAt),
  });
  expectEqual(
    legacyActionFeedback.recommendedNextAction,
    "inspect_error_and_switch_strategy",
    "feedback normalizes legacy action to cataloged fallback",
  );
  expectFeedbackActionInCatalog(
    legacyActionFeedback.recommendedNextAction,
    "legacy action feedback",
  );
  expect(
    !legacyActionFeedback.promptBlock.includes("observe_and_continue"),
    "feedback prompt never surfaces legacy free-form action",
  );
  expectEqual(
    getRuntimeToolRecoveryPolicySnapshot().escalation.environmentAskUserThreshold,
    2,
    "environment recovery escalation threshold is exposed by policy",
  );
  expectEqual(
    getRuntimeToolRecoveryPolicySnapshot().escalation.browserEnvironmentAskUserThreshold,
    2,
    "browser environment recovery escalation threshold is exposed by policy",
  );

  return {
    events,
    summary,
    knownRecoveryActions,
    missingActionSummary,
    legacyActionFeedback,
  };
}
