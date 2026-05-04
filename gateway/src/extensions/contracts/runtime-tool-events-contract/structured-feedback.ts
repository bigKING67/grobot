import type { RuntimeEvent } from "../../../models/types";
import {
  buildRuntimeToolRecoveryFeedback,
  RUNTIME_TOOL_RECOVERY_PROMPT_MAX_CHARS,
  summarizeRuntimeToolEvents,
  type RuntimeToolRecoveryFeedback,
} from "../../../tools/runtime/tool-events";
import {
  event,
  expect,
  expectBefore,
  expectEqual,
  expectFeedbackActionInCatalog,
} from "./helpers";

export const STRUCTURED_RECOVERY_OBSERVED_AT = "2026-04-25T00:00:30.000Z";

export function runRuntimeToolStructuredFeedbackContracts(input: {
  contractPath: (name: string) => string;
}): {
  structuredRecoveryObservedAt: string;
  structuredFeedback: RuntimeToolRecoveryFeedback;
  oversizedFeedback: RuntimeToolRecoveryFeedback;
} {
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
      observed_at: STRUCTURED_RECOVERY_OBSERVED_AT,
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
      updatedAt: STRUCTURED_RECOVERY_OBSERVED_AT,
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
      path: input.contractPath("structured"),
    },
    nowMs: Date.parse(STRUCTURED_RECOVERY_OBSERVED_AT),
  });
  expectFeedbackActionInCatalog(structuredFeedback.recommendedNextAction, "structured feedback");
  expectEqual(structuredFeedback.errorData?.path, "sample.txt", "feedback preserves structured error data path");
  expect(
    structuredFeedback.promptBlock.includes("Structured error data: path=sample.txt edit_index=0"),
    "feedback summarizes structured error data",
  );
  expect(
    structuredFeedback.promptBlock.includes("Action-first contract: treat structured recommended_next_action as authoritative"),
    "feedback declares action-first recovery contract",
  );
  expect(
    structuredFeedback.promptBlock.includes("Structured recovery fields: recommended_next_action=reread_target_then_retry_exact_old_text recovery_stage=local_fix recoverable=true requires_user_intervention=false"),
    "feedback surfaces structured recovery fields before prose details",
  );
  expectBefore(
    structuredFeedback.promptBlock,
    "Structured recovery fields:",
    "Structured error data:",
    "feedback prioritizes structured action fields before error prose",
  );
  expect(
    structuredFeedback.promptBlock.includes("closest_lines=line 1 \"alpha_count = 1;\""),
    "feedback summarizes structured closest lines",
  );

  const oversizedFeedback = buildOversizedFeedback(input.contractPath);
  runBashStructuredFeedbackContract(input.contractPath);

  return {
    structuredRecoveryObservedAt: STRUCTURED_RECOVERY_OBSERVED_AT,
    structuredFeedback,
    oversizedFeedback,
  };
}

function buildOversizedFeedback(
  contractPath: (name: string) => string,
): RuntimeToolRecoveryFeedback {
  const oversizedRecoveryObservedAt = "2026-04-25T00:00:40.000Z";
  const oversizedRecoverySummary = summarizeRuntimeToolEvents([
    event("tool_recovery", {
      tool_name: "mcp_call",
      error_class: "mcp_tool_result_error",
      error_message: `oversized failure ${"detail ".repeat(300)}`,
      error_data: {
        diagnostic_kind: "mcp_tool_result_error",
        server_key: "grok-search",
        tool_name: "web_search",
        argument_keys: ["query", "token", "extra", "large", "debug", "unused"],
        argument_bytes: 65_000,
        max_argument_bytes: 65_536,
        result_preview: "bad args ".repeat(300),
        argument_preview: "{\"query\":\"" + "weather ".repeat(300) + "\",\"token\":\"secret\"}",
        raw_message: "raw ".repeat(300),
        stderr_preview: "stderr ".repeat(300),
        stdout_preview: "stdout ".repeat(300),
      },
      recovery_stage: "local_fix",
      recovery_reason: "mcp_tool_result_error",
      recommended_next_action: "inspect_mcp_tool_result_and_change_arguments",
      recoverable: true,
      same_tool_error_count: 4,
      escalated: true,
      escalation_reason: `same_tool_error_repeated_${"reason_".repeat(220)}`,
      escalation_policy_version: "v-test",
      base_recovery_stage: "local_fix",
      base_recommended_next_action: "fix_mcp_tool_arguments",
      observed_at: oversizedRecoveryObservedAt,
    }),
  ]);
  const oversizedFeedback = buildRuntimeToolRecoveryFeedback({
    metrics: {
      version: 1,
      updatedAt: oversizedRecoveryObservedAt,
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
      latestRecovery: oversizedRecoverySummary.latestRecovery ?? null,
      path: contractPath("oversized"),
    },
    nowMs: Date.parse(oversizedRecoveryObservedAt),
  });
  expect(
    oversizedFeedback.promptBlock.length <= RUNTIME_TOOL_RECOVERY_PROMPT_MAX_CHARS,
    "oversized feedback stays within prompt character budget",
  );
  expect(
    oversizedFeedback.promptBlock.includes("Structured recovery fields:"),
    "oversized feedback keeps structured recovery fields",
  );
  expect(
    oversizedFeedback.promptBlock.includes("Required next action: inspect_mcp_tool_result_and_change_arguments"),
    "oversized feedback keeps required action",
  );
  expect(
    oversizedFeedback.promptBlock.includes("Execution discipline:"),
    "oversized feedback keeps execution discipline",
  );
  expect(
    oversizedFeedback.promptBlock.includes("Details truncated: omitted"),
    "oversized feedback marks low-priority detail truncation",
  );
  return oversizedFeedback;
}

function runBashStructuredFeedbackContract(
  contractPath: (name: string) => string,
): void {
  const bashStructuredFeedback = buildRuntimeToolRecoveryFeedback({
    metrics: {
      version: 1,
      updatedAt: STRUCTURED_RECOVERY_OBSERVED_AT,
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
        observedAt: STRUCTURED_RECOVERY_OBSERVED_AT,
      },
      path: contractPath("bash-structured"),
    },
    nowMs: Date.parse(STRUCTURED_RECOVERY_OBSERVED_AT),
  });
  expect(
    bashStructuredFeedback.promptBlock.includes("diagnostic_kind=bash_not_allowed"),
    "feedback summarizes top-level diagnostic kind",
  );
  expect(
    bashStructuredFeedback.promptBlock.includes("denied_segment=\"uname\""),
    "feedback summarizes denied bash segment",
  );
}
