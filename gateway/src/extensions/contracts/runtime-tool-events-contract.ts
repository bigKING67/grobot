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
import { getRuntimeToolRecoveryPolicySnapshot } from "../../tools/runtime/tool-recovery-policy";
import {
  browserEnvironmentRecoveryActionInstruction,
  browserEnvironmentRecoveryFixInstruction,
  buildBrowserEnvironmentRecoveryPlan,
  formatBrowserEnvironmentRecoveryPlan,
  serializeBrowserEnvironmentRecoveryPlan,
} from "../../tools/runtime/browser-environment-recovery";
import {
  buildMcpEnvironmentRecoveryPlan,
  formatMcpEnvironmentRecoveryPlan,
  serializeMcpEnvironmentRecoveryPlan,
} from "../../tools/runtime/mcp-environment-recovery";
import {
  buildRuntimeEnvironmentRecoveryPlan,
  formatRuntimeEnvironmentRecoveryPlan,
  serializeRuntimeEnvironmentRecoveryPlan,
} from "../../tools/runtime/runtime-environment-recovery";

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

const mcpObservedResultFeedback = buildRuntimeToolRecoveryFeedback({
  metrics: {
    version: 1,
    updatedAt: structuredRecoveryObservedAt,
    callsTotal: 1,
    failedTotal: 1,
    deferredTotal: 0,
    callsByTool: { mcp_call: 1 },
    failuresByErrorClass: { mcp_tool_result_error: 1 },
    recoveryStages: { strategy_switch: 1 },
    recoveryCountsByKey: {},
    latestRecoveryRepeatKey: null,
    latestRecoveryRepeatCount: 0,
    avgDurationMsByTool: {},
    recentRecoveries: [],
    latestRecovery: {
      stage: "strategy_switch",
      reason: "mcp_tool_result_error",
      recommendedNextAction: "inspect_error_and_switch_strategy",
      toolName: "mcp_call",
      errorClass: "mcp_tool_result_error",
      errorData: {
        diagnostic_kind: "mcp_tool_result_error",
        server: "mock",
        tool_name: "fail",
        operation: "tools/call",
        is_error: true,
        result_preview: "bad args",
        structured_content_preview: "{\"reason\":\"bad args\"}",
        available_tools: ["echo", "fail"],
      },
      recoverable: true,
      observedAt: structuredRecoveryObservedAt,
    },
    path: "/tmp/grobot-runtime-tool-events-mcp-result-structured",
  },
  nowMs: Date.parse(structuredRecoveryObservedAt),
});
expect(
  mcpObservedResultFeedback.promptBlock.includes("diagnostic_kind=mcp_tool_result_error"),
  "feedback summarizes MCP tool result diagnostic kind",
);
expect(
  mcpObservedResultFeedback.promptBlock.includes("result_preview=\"bad args\""),
  "feedback summarizes MCP tool result preview",
);

const mcpEnvironmentObservedAt = "2026-04-25T00:00:30.000Z";
const mcpEnvironmentFeedback = buildRuntimeToolRecoveryFeedback({
  metrics: {
    version: 1,
    updatedAt: mcpEnvironmentObservedAt,
    callsTotal: 1,
    failedTotal: 1,
    deferredTotal: 0,
    callsByTool: { mcp_call: 1 },
    failuresByErrorClass: { mcp_server_unready: 1 },
    recoveryStages: { ask_user: 1 },
    recoveryCountsByKey: {},
    latestRecoveryRepeatKey: null,
    latestRecoveryRepeatCount: 0,
    avgDurationMsByTool: {},
    recentRecoveries: [],
    latestRecovery: {
      stage: "ask_user",
      reason: "mcp_server_unready",
      recommendedNextAction: "request_environment_fix",
      toolName: "mcp_call",
      errorClass: "mcp_server_unready",
      errorData: {
        diagnostic_kind: "mcp_server_unready",
        server: "grok-search",
        server_key: "grok-search",
        tool_name: "web_search",
        operation: "resolve_server",
        enabled: true,
        ready: false,
        ready_reason: "command_not_found",
        source: "/tmp/.grobot/mcp.toml",
        recovery_hint: "fix MCP server command/readiness before retrying",
      },
      recoverable: false,
      requiresUserIntervention: true,
      observedAt: mcpEnvironmentObservedAt,
    },
    path: "/tmp/grobot-runtime-tool-events-mcp-environment",
  },
  nowMs: Date.parse(mcpEnvironmentObservedAt),
});
expectEqual(
  mcpEnvironmentFeedback.mcpEnvironmentRecovery?.errorCode,
  "SERVER_UNREADY",
  "MCP environment feedback exposes recovery error code",
);
expectEqual(
  mcpEnvironmentFeedback.mcpEnvironmentRecovery?.action,
  "fix_server_readiness_and_check_status",
  "MCP environment feedback exposes recovery action",
);
expectEqual(
  mcpEnvironmentFeedback.mcpEnvironmentRecovery?.sourcePath,
  "/tmp/.grobot/mcp.toml",
  "MCP environment feedback preserves source config path",
);
expectEqual(
  mcpEnvironmentFeedback.mcpEnvironmentRecovery?.readyReason,
  "command_not_found",
  "MCP environment feedback preserves readiness reason",
);
expectEqual(
  mcpEnvironmentFeedback.mcpEnvironmentRecovery?.retryAllowed,
  false,
  "MCP environment feedback blocks retry",
);
expect(
  mcpEnvironmentFeedback.promptBlock.includes("Execution rule: Ask the user to repair MCP server configuration"),
  "MCP environment feedback uses MCP-specific execution rule",
);
expect(
  mcpEnvironmentFeedback.promptBlock.includes("MCP environment fix: Do not retry mcp_call automatically."),
  "MCP environment feedback includes MCP fix instruction",
);
expect(
  mcpEnvironmentFeedback.promptBlock.includes("status reports ready=true"),
  "MCP environment feedback waits for ready status",
);
expect(
  mcpEnvironmentFeedback.promptBlock.includes("`~/.grobot/mcp/servers.toml` or `.grobot/mcp.toml`"),
  "MCP environment feedback points to registry paths",
);

const mcpEnvironmentRecoveryCases = [
  {
    errorClass: "mcp_server_not_found",
    errorCode: "SERVER_NOT_FOUND",
    action: "configure_server_and_check_status",
    errorData: {
      available_servers: ["browser-structured", "grok-search"],
      server: "missing-search",
      tool_name: "web_search",
      source: ".grobot/mcp.toml",
    },
  },
  {
    errorClass: "mcp_server_unready",
    errorCode: "SERVER_UNREADY",
    action: "fix_server_readiness_and_check_status",
    errorData: {
      ready_reason: "command_not_found",
      server: "grok-search",
      tool_name: "web_search",
      source: ".grobot/mcp.toml",
    },
  },
  {
    errorClass: "mcp_spawn_failed",
    errorCode: "SPAWN_FAILED",
    action: "fix_server_command_and_check_status",
    errorData: {
      command: "npx",
      server: "grok-search",
      tool_name: "web_search",
      source: ".grobot/mcp.toml",
    },
  },
] as const;
for (const recoveryCase of mcpEnvironmentRecoveryCases) {
  const plan = buildMcpEnvironmentRecoveryPlan({
    errorClass: recoveryCase.errorClass,
    errorData: recoveryCase.errorData,
  });
  expect(plan !== null, `MCP environment plan exists for ${recoveryCase.errorClass}`);
  expectEqual(plan?.errorCode, recoveryCase.errorCode, `MCP environment plan code ${recoveryCase.errorClass}`);
  expectEqual(plan?.action, recoveryCase.action, `MCP environment plan action ${recoveryCase.errorClass}`);
  expectEqual(plan?.retryAllowed, false, `MCP environment plan retry flag ${recoveryCase.errorClass}`);
  expectEqual(plan?.commands.join("|"), "grobot status --json", `MCP environment plan commands ${recoveryCase.errorClass}`);
  expectEqual(plan?.server, recoveryCase.errorData.server, `MCP environment plan server ${recoveryCase.errorClass}`);
  expectEqual(plan?.toolName, "web_search", `MCP environment plan tool ${recoveryCase.errorClass}`);
  expectEqual(plan?.sourcePath, ".grobot/mcp.toml", `MCP environment plan source ${recoveryCase.errorClass}`);
  if (recoveryCase.errorClass === "mcp_server_not_found") {
    expectEqual(
      plan?.availableServers.join("|"),
      "browser-structured|grok-search",
      `MCP environment plan available servers ${recoveryCase.errorClass}`,
    );
  }
  if (recoveryCase.errorClass === "mcp_server_unready") {
    expectEqual(
      plan?.readyReason,
      "command_not_found",
      `MCP environment plan ready reason ${recoveryCase.errorClass}`,
    );
  }
  if (recoveryCase.errorClass === "mcp_spawn_failed") {
    expectEqual(plan?.command, "npx", `MCP environment plan command ${recoveryCase.errorClass}`);
  }
  expectEqual(
    plan?.registryPaths.join("|"),
    "~/.grobot/mcp/servers.toml|.grobot/mcp.toml",
    `MCP environment plan registry paths ${recoveryCase.errorClass}`,
  );
  expect(
    formatMcpEnvironmentRecoveryPlan(plan).includes("commands=grobot status --json"),
    `MCP environment formatter keeps commands ${recoveryCase.errorClass}`,
  );
  const serialized = serializeMcpEnvironmentRecoveryPlan(plan);
  expectEqual(
    serialized?.error_code as string,
    recoveryCase.errorCode,
    `MCP environment serializer keeps error code ${recoveryCase.errorClass}`,
  );
  expect(
    Array.isArray(serialized?.commands),
    `MCP environment serializer commands array ${recoveryCase.errorClass}`,
  );
  expect(
    serialized?.commands !== plan?.commands,
    `MCP environment serializer snapshots commands ${recoveryCase.errorClass}`,
  );
  expectEqual(
    (serialized?.commands as string[]).join("|"),
    "grobot status --json",
    `MCP environment serializer keeps commands ${recoveryCase.errorClass}`,
  );
  expect(
    Array.isArray(serialized?.registry_paths),
    `MCP environment serializer registry paths array ${recoveryCase.errorClass}`,
  );
  expect(
    serialized?.registry_paths !== plan?.registryPaths,
    `MCP environment serializer snapshots registry paths ${recoveryCase.errorClass}`,
  );
  expect(
    serialized?.available_servers !== plan?.availableServers,
    `MCP environment serializer snapshots available servers ${recoveryCase.errorClass}`,
  );
  expectEqual(
    (serialized?.registry_paths as string[]).join("|"),
    "~/.grobot/mcp/servers.toml|.grobot/mcp.toml",
    `MCP environment serializer keeps registry paths ${recoveryCase.errorClass}`,
  );
}
expectEqual(formatMcpEnvironmentRecoveryPlan(null), "<none>", "MCP environment formatter handles null");
expectEqual(serializeMcpEnvironmentRecoveryPlan(null), null, "MCP environment serializer handles null");
expectEqual(
  buildMcpEnvironmentRecoveryPlan({
    errorClass: "mcp_timeout",
    errorData: {
      server: "grok-search",
    },
  }),
  null,
  "MCP timeout is not an environment recovery plan",
);

const runtimeEnvironmentRecoveryCases = [
  {
    errorClass: "config_missing",
    errorMessage: "model_config.api_key is required for kimi official tools",
    errorCode: "CONFIG_MISSING",
    action: "fix_config_or_switch_provider_and_check_status",
    commands: ["grobot status --json", "grobot status --probe --json"],
    requiredConfig: "model_config.api_key",
  },
  {
    errorClass: "tool_context_missing",
    errorMessage: "runtime tool context is required",
    errorCode: "TOOL_CONTEXT_MISSING",
    action: "fix_tool_context_and_check_status",
    commands: ["grobot status --json"],
    requiredConfig: null,
  },
  {
    errorClass: "tool_context_invalid",
    errorMessage: "tool_context.work_dir is not a directory",
    errorCode: "TOOL_CONTEXT_INVALID",
    action: "fix_tool_context_and_check_status",
    commands: ["grobot status --json"],
    requiredConfig: null,
  },
  {
    errorClass: "runtime_state_unavailable",
    errorMessage: "failed to lock file mutation queue store",
    errorCode: "RUNTIME_STATE_UNAVAILABLE",
    action: "restart_or_clear_runtime_state_and_check_status",
    commands: ["grobot status --json"],
    requiredConfig: null,
  },
] as const;
for (const recoveryCase of runtimeEnvironmentRecoveryCases) {
  const plan = buildRuntimeEnvironmentRecoveryPlan({
    errorClass: recoveryCase.errorClass,
    errorMessage: recoveryCase.errorMessage,
    errorData: {
      source: ".grobot/config.toml",
      work_dir: "/tmp/grobot-runtime-env-contract",
    },
  });
  expect(plan !== null, `runtime environment plan exists for ${recoveryCase.errorClass}`);
  expectEqual(
    plan?.errorCode,
    recoveryCase.errorCode,
    `runtime environment plan code ${recoveryCase.errorClass}`,
  );
  expectEqual(
    plan?.action,
    recoveryCase.action,
    `runtime environment plan action ${recoveryCase.errorClass}`,
  );
  expectEqual(plan?.retryAllowed, false, `runtime environment plan retry flag ${recoveryCase.errorClass}`);
  expectEqual(
    plan?.commands.join("|"),
    recoveryCase.commands.join("|"),
    `runtime environment plan commands ${recoveryCase.errorClass}`,
  );
  expectEqual(
    plan?.requiredConfig,
    recoveryCase.requiredConfig,
    `runtime environment plan required config ${recoveryCase.errorClass}`,
  );
  expect(
    formatRuntimeEnvironmentRecoveryPlan(plan).includes(`commands=${recoveryCase.commands.join("|")}`),
    `runtime environment formatter keeps commands ${recoveryCase.errorClass}`,
  );
  const serialized = serializeRuntimeEnvironmentRecoveryPlan(plan);
  expectEqual(
    serialized?.error_code as string,
    recoveryCase.errorCode,
    `runtime environment serializer keeps error code ${recoveryCase.errorClass}`,
  );
  expect(Array.isArray(serialized?.commands), `runtime environment serializer commands array ${recoveryCase.errorClass}`);
  expect(
    serialized?.commands !== plan?.commands,
    `runtime environment serializer snapshots commands ${recoveryCase.errorClass}`,
  );
  expectEqual(
    (serialized?.commands as string[]).join("|"),
    recoveryCase.commands.join("|"),
    `runtime environment serializer keeps commands ${recoveryCase.errorClass}`,
  );
}
expectEqual(formatRuntimeEnvironmentRecoveryPlan(null), "<none>", "runtime environment formatter handles null");
expectEqual(serializeRuntimeEnvironmentRecoveryPlan(null), null, "runtime environment serializer handles null");
expectEqual(
  buildRuntimeEnvironmentRecoveryPlan({
    errorClass: "path_not_found",
    errorMessage: "path not found",
  }),
  null,
  "path_not_found is not a runtime environment recovery plan",
);

const runtimeEnvironmentFeedback = buildRuntimeToolRecoveryFeedback({
  metrics: {
    version: 1,
    updatedAt: structuredRecoveryObservedAt,
    callsTotal: 1,
    failedTotal: 1,
    deferredTotal: 0,
    callsByTool: { read: 1 },
    failuresByErrorClass: { config_missing: 1 },
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
      errorMessage: "provider_options.kimi.files_enabled=true is required",
      recoverable: false,
      requiresUserIntervention: true,
      observedAt: structuredRecoveryObservedAt,
    },
    path: "/tmp/grobot-runtime-tool-events-runtime-environment",
  },
  nowMs: Date.parse(structuredRecoveryObservedAt),
});
expectEqual(
  runtimeEnvironmentFeedback.runtimeEnvironmentRecovery?.errorCode,
  "CONFIG_MISSING",
  "runtime environment feedback exposes recovery error code",
);
expectEqual(
  runtimeEnvironmentFeedback.runtimeEnvironmentRecovery?.requiredConfig,
  "provider_options.kimi.files_enabled=true",
  "runtime environment feedback infers required config",
);
expect(
  runtimeEnvironmentFeedback.promptBlock.includes("Runtime environment fix: Do not retry read automatically."),
  "runtime environment feedback blocks automatic retry",
);
expect(
  runtimeEnvironmentFeedback.promptBlock.includes("status/probe confirms the configuration is usable"),
  "runtime environment feedback uses config-specific execution rule",
);

const semanticStructuredFeedback = buildRuntimeToolRecoveryFeedback({
  metrics: {
    version: 1,
    updatedAt: structuredRecoveryObservedAt,
    callsTotal: 1,
    failedTotal: 1,
    deferredTotal: 0,
    callsByTool: { semantic_search: 1 },
    failuresByErrorClass: { semantic_index_config_invalid: 1 },
    recoveryStages: { strategy_switch: 1 },
    recoveryCountsByKey: {},
    latestRecoveryRepeatKey: null,
    latestRecoveryRepeatCount: 0,
    avgDurationMsByTool: {},
    recentRecoveries: [],
    latestRecovery: {
      stage: "strategy_switch",
      reason: "semantic_index_config_invalid",
      recommendedNextAction: "use_search_or_glob_fallback",
      toolName: "semantic_search",
      errorClass: "semantic_index_config_invalid",
      errorData: {
        diagnostic_kind: "semantic_index_config_invalid",
        tool: "semantic_search",
        bridge_command: "semantic-search",
        operation: "bridge_exit",
        requested_sources: ["code"],
        source_roots_count: 1,
        bridge_exit_status: 1,
        matched_files: 0,
        index_config_path: "/tmp/cwconfig.json",
        bridge_error_class: "semantic_index_config_invalid",
        bridge_error_message: "ContextWeaver index config matches no files",
        stderr_preview: "{\"error_class\":\"semantic_index_config_invalid\"}",
      },
      recoverable: true,
      observedAt: structuredRecoveryObservedAt,
    },
    path: "/tmp/grobot-runtime-tool-events-semantic-structured",
  },
  nowMs: Date.parse(structuredRecoveryObservedAt),
});
expect(
  semanticStructuredFeedback.promptBlock.includes("diagnostic_kind=semantic_index_config_invalid"),
  "feedback summarizes semantic diagnostic kind",
);
expect(
  semanticStructuredFeedback.promptBlock.includes("bridge_command=semantic-search"),
  "feedback summarizes semantic bridge command",
);
expect(
  semanticStructuredFeedback.promptBlock.includes("matched_files=0"),
  "feedback summarizes semantic matched files",
);
expect(
  semanticStructuredFeedback.promptBlock.includes("index_config_path=\"/tmp/cwconfig.json\""),
  "feedback summarizes semantic index config path",
);

const browserStructuredFeedback = buildRuntimeToolRecoveryFeedback({
  metrics: {
    version: 1,
    updatedAt: structuredRecoveryObservedAt,
    callsTotal: 1,
    failedTotal: 1,
    deferredTotal: 0,
    callsByTool: { web_scan: 1 },
    failuresByErrorClass: { browser_backend_result_error: 1 },
    recoveryStages: { strategy_switch: 1 },
    recoveryCountsByKey: {},
    latestRecoveryRepeatKey: null,
    latestRecoveryRepeatCount: 0,
    avgDurationMsByTool: {},
    recentRecoveries: [],
    latestRecovery: {
      stage: "strategy_switch",
      reason: "browser_backend_result_error",
      recommendedNextAction: "inspect_error_and_switch_strategy",
      toolName: "web_scan",
      errorClass: "browser_backend_result_error",
      errorData: {
        diagnostic_kind: "browser_backend_result_error",
        tool: "web_scan",
        backend: "browser-structured",
        backend_server: "browser-structured",
        mapped_tool: "browser_scan",
        operation: "backend_result",
        error_code: "NO_EXTENSION",
        retryable: true,
        transport_attempts_count: 1,
        browser_context_kind: "unknown",
        diagnostic_hint: "Browser extension is not connected. Run `grobot browser setup`.",
      },
      recoverable: true,
      observedAt: structuredRecoveryObservedAt,
    },
    path: "/tmp/grobot-runtime-tool-events-browser-structured",
  },
  nowMs: Date.parse(structuredRecoveryObservedAt),
});
expect(
  browserStructuredFeedback.promptBlock.includes("diagnostic_kind=browser_backend_result_error"),
  "feedback summarizes browser diagnostic kind",
);
expect(
  browserStructuredFeedback.promptBlock.includes("backend=browser-structured"),
  "feedback summarizes browser backend",
);
expect(
  browserStructuredFeedback.promptBlock.includes("mapped_tool=browser_scan"),
  "feedback summarizes browser mapped tool",
);
expect(
  browserStructuredFeedback.promptBlock.includes("error_code=NO_EXTENSION"),
  "feedback summarizes browser error code",
);
expect(
  browserStructuredFeedback.promptBlock.includes("transport_attempts_count=1"),
  "feedback summarizes browser transport attempt count",
);
expect(
  browserStructuredFeedback.promptBlock.includes("diagnostic_hint=\"Browser extension is not connected"),
  "feedback summarizes browser diagnostic hint",
);
expectEqual(
  browserStructuredFeedback.browserEnvironmentRecovery?.errorCode,
  "NO_EXTENSION",
  "browser structured feedback exposes browser recovery error code",
);
expectEqual(
  browserStructuredFeedback.browserEnvironmentRecovery?.action,
  "setup_and_doctor",
  "browser structured feedback exposes browser recovery action",
);
expectEqual(
  browserStructuredFeedback.browserEnvironmentRecovery?.retryAllowed,
  false,
  "browser structured feedback blocks retry",
);

const browserEnvironmentRecoveryCases = [
  {
    errorCode: "NO_EXTENSION",
    action: "setup_and_doctor",
    commands: ["grobot browser setup", "grobot browser doctor"],
    fixIncludes: ["browser extension is connected", "grobot browser setup"],
  },
  {
    errorCode: "NO_SESSION",
    action: "reconnect_session_and_doctor",
    commands: ["grobot browser hub start", "grobot browser doctor"],
    fixIncludes: ["open or reconnect a browser session", "grobot browser hub start"],
  },
  {
    errorCode: "TRANSPORT_UNAVAILABLE",
    action: "start_hub_and_doctor",
    commands: ["grobot browser hub start", "grobot browser doctor"],
    fixIncludes: ["browser transport is available", "grobot browser hub start"],
  },
] as const;

for (const recoveryCase of browserEnvironmentRecoveryCases) {
  const plan = buildBrowserEnvironmentRecoveryPlan({
    errorClass: "browser_backend_result_error",
    errorData: {
      error_code: recoveryCase.errorCode,
    },
  });
  expect(plan !== null, `browser environment plan exists for ${recoveryCase.errorCode}`);
  expectEqual(plan?.errorCode, recoveryCase.errorCode, `browser environment plan code ${recoveryCase.errorCode}`);
  expectEqual(plan?.action, recoveryCase.action, `browser environment plan action ${recoveryCase.errorCode}`);
  expectEqual(plan?.retryAllowed, false, `browser environment plan retry flag ${recoveryCase.errorCode}`);
  expectEqual(
    plan?.commands.join("|"),
    recoveryCase.commands.join("|"),
    `browser environment plan commands ${recoveryCase.errorCode}`,
  );
  const actionInstruction = browserEnvironmentRecoveryActionInstruction(plan);
  expect(
    formatBrowserEnvironmentRecoveryPlan(plan).includes(`commands=${recoveryCase.commands.join("|")}`),
    `browser environment formatter keeps commands ${recoveryCase.errorCode}`,
  );
  const serialized = serializeBrowserEnvironmentRecoveryPlan(plan);
  expectEqual(
    serialized?.error_code as string,
    recoveryCase.errorCode,
    `browser environment serializer keeps error code ${recoveryCase.errorCode}`,
  );
  expect(
    Array.isArray(serialized?.commands),
    `browser environment serializer commands array ${recoveryCase.errorCode}`,
  );
  expect(
    serialized?.commands !== plan?.commands,
    `browser environment serializer snapshots commands ${recoveryCase.errorCode}`,
  );
  expectEqual(
    (serialized?.commands as string[]).join("|"),
    recoveryCase.commands.join("|"),
    `browser environment serializer keeps commands ${recoveryCase.errorCode}`,
  );
  expect(
    actionInstruction?.includes("Ask the user to repair the browser environment") === true,
    `browser environment action instruction asks repair ${recoveryCase.errorCode}`,
  );
  expect(
    actionInstruction?.includes("`grobot browser doctor` confirms") === true,
    `browser environment action instruction waits for doctor ${recoveryCase.errorCode}`,
  );
  const fixInstruction = browserEnvironmentRecoveryFixInstruction({
    plan,
    toolName: "web_scan",
  });
  expect(
    fixInstruction?.includes("Do not retry web_scan automatically.") === true,
    `browser environment fix blocks retry ${recoveryCase.errorCode}`,
  );
  for (const expectedSnippet of recoveryCase.fixIncludes) {
    expect(
      fixInstruction?.includes(expectedSnippet) === true,
      `browser environment fix includes ${expectedSnippet} for ${recoveryCase.errorCode}`,
    );
  }
}
expectEqual(formatBrowserEnvironmentRecoveryPlan(null), "<none>", "browser environment formatter handles null");
expectEqual(serializeBrowserEnvironmentRecoveryPlan(null), null, "browser environment serializer handles null");
expectEqual(
  buildBrowserEnvironmentRecoveryPlan({
    errorClass: "browser_backend_result_error",
    errorData: {
      error_code: "TIMEOUT",
    },
  }),
  null,
  "timeout is not a browser environment recovery plan",
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
  nonRecoverableFeedback.promptBlock.includes("Ask the user to provide the missing runtime configuration"),
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

const browserRepeatedWorkDir = join(
  "/tmp",
  `grobot-runtime-tool-browser-repeated-${String(process.pid)}-${String(Date.now())}`,
);
mkdirSync(browserRepeatedWorkDir, { recursive: true });
try {
  const browserRepeatedRecoveryEvents: RuntimeEvent[] = [
    event("tool_end", {
      tool_name: "web_scan",
      status: "failed",
      error_class: "browser_backend_result_error",
      duration_ms: 8,
    }),
    event("tool_recovery", {
      tool_name: "web_scan",
      error_class: "browser_backend_result_error",
      error_message: "web_scan backend returned error_code=NO_EXTENSION: Browser extension is not connected.",
      error_data: {
        diagnostic_kind: "browser_backend_result_error",
        tool: "web_scan",
        backend: "browser-structured",
        mapped_tool: "browser_scan",
        operation: "backend_result",
        error_code: "NO_EXTENSION",
        retryable: true,
        transport_attempts_count: 1,
        browser_context_kind: "unknown",
        diagnostic_hint: "Browser extension is not connected. Run `grobot browser setup`.",
      },
      recovery_stage: "strategy_switch",
      recovery_reason: "browser_backend_result_error",
      recommended_next_action: "inspect_error_and_switch_strategy",
      recoverable: true,
    }),
  ];

  const browserFirst = recordRuntimeToolSurfaceMetrics({
    workDir: browserRepeatedWorkDir,
    events: browserRepeatedRecoveryEvents,
  });
  expectEqual(browserFirst.latestRecovery?.stage, "strategy_switch", "browser first recovery stays strategy switch");
  expectEqual(browserFirst.latestRecovery?.sameToolErrorCount, 1, "browser first recovery count");
  expectEqual(browserFirst.latestRecovery?.escalated, false, "browser first recovery not escalated");

  const browserSecond = recordRuntimeToolSurfaceMetrics({
    workDir: browserRepeatedWorkDir,
    events: browserRepeatedRecoveryEvents,
  });
  const browserSecondFeedback = buildRuntimeToolRecoveryFeedback({
    metrics: browserSecond,
    nowMs: Date.parse(browserSecond.latestRecovery?.observedAt ?? ""),
  });
  expectEqual(browserSecond.latestRecovery?.stage, "ask_user", "browser repeated environment recovery asks user");
  expectEqual(
    browserSecond.latestRecovery?.recommendedNextAction,
    "request_environment_fix",
    "browser repeated recovery asks environment fix",
  );
  expectEqual(browserSecond.latestRecovery?.recoverable, false, "browser repeated recovery blocks automatic retry");
  expectEqual(
    browserSecond.latestRecovery?.requiresUserIntervention,
    true,
    "browser repeated recovery requires intervention",
  );
  expectEqual(browserSecond.latestRecovery?.sameToolErrorCount, 2, "browser repeated recovery count");
  expectEqual(browserSecond.latestRecovery?.escalated, true, "browser repeated recovery escalated flag");
  expectEqual(
    browserSecond.latestRecovery?.escalationReason,
    "browser_environment_error_repeated",
    "browser repeated recovery reason",
  );
  expectEqual(browserSecond.latestRecovery?.baseStage, "strategy_switch", "browser repeated base stage");
  expectEqual(
    browserSecond.latestRecovery?.baseRecommendedNextAction,
    "inspect_error_and_switch_strategy",
    "browser repeated base action",
  );
  expectEqual(browserSecondFeedback.requiresUserIntervention, true, "browser repeated feedback requires intervention");
  expectEqual(
    browserSecondFeedback.browserEnvironmentRecovery?.errorCode,
    "NO_EXTENSION",
    "browser repeated feedback exposes browser recovery error code",
  );
  expectEqual(
    browserSecondFeedback.browserEnvironmentRecovery?.action,
    "setup_and_doctor",
    "browser repeated feedback exposes browser recovery action",
  );
  expect(
    browserSecondFeedback.promptBlock.includes("request_environment_fix"),
    "browser repeated feedback requests environment fix",
  );
  expect(
    browserSecondFeedback.promptBlock.includes("Execution rule: Ask the user to repair the browser environment"),
    "browser repeated feedback uses browser-specific execution rule",
  );
  expect(
    browserSecondFeedback.promptBlock.includes("until `grobot browser doctor` confirms the environment is ready"),
    "browser repeated feedback waits for doctor confirmation",
  );
  expect(
    !browserSecondFeedback.promptBlock.includes(
      "Execution rule: Ask the user to fix the environment or configuration before retrying.",
    ),
    "browser repeated feedback avoids generic environment instruction",
  );
  expect(
    browserSecondFeedback.promptBlock.includes("Browser environment fix: Do not retry web_scan automatically."),
    "browser repeated feedback blocks automatic browser retry",
  );
  expect(
    browserSecondFeedback.promptBlock.includes("`grobot browser setup`"),
    "browser repeated feedback includes setup command",
  );
  expect(
    browserSecondFeedback.promptBlock.includes("`grobot browser doctor`"),
    "browser repeated feedback includes doctor command",
  );
  expect(
    browserSecondFeedback.promptBlock.includes("browser_environment_error_repeated"),
    "browser repeated feedback includes browser escalation reason",
  );
} finally {
  rmSync(browserRepeatedWorkDir, { recursive: true, force: true });
}

const mcpRepeatedWorkDir = join(
  "/tmp",
  `grobot-runtime-tool-mcp-repeated-${String(process.pid)}-${String(Date.now())}`,
);
mkdirSync(mcpRepeatedWorkDir, { recursive: true });
try {
  const mcpRepeatedRecoveryEvents: RuntimeEvent[] = [
    event("tool_end", {
      tool_name: "mcp_call",
      status: "failed",
      error_class: "mcp_spawn_failed",
      duration_ms: 9,
    }),
    event("tool_recovery", {
      tool_name: "mcp_call",
      error_class: "mcp_spawn_failed",
      error_message: "failed to spawn MCP server `npx`: command not found",
      error_data: {
        diagnostic_kind: "mcp_spawn_failed",
        server: "grok-search",
        server_key: "grok-search",
        tool_name: "web_search",
        operation: "spawn_server",
        command: "npx",
        recovery_hint: "fix MCP server command/configuration before retrying",
      },
      recovery_stage: "strategy_switch",
      recovery_reason: "mcp_spawn_failed",
      recommended_next_action: "retry_with_smaller_scope_or_wait",
      recoverable: true,
    }),
  ];

  const mcpFirst = recordRuntimeToolSurfaceMetrics({
    workDir: mcpRepeatedWorkDir,
    events: mcpRepeatedRecoveryEvents,
  });
  expectEqual(mcpFirst.latestRecovery?.stage, "strategy_switch", "MCP first recovery stays strategy switch");
  expectEqual(mcpFirst.latestRecovery?.sameToolErrorCount, 1, "MCP first recovery count");
  expectEqual(mcpFirst.latestRecovery?.escalated, false, "MCP first recovery not escalated");

  const mcpSecond = recordRuntimeToolSurfaceMetrics({
    workDir: mcpRepeatedWorkDir,
    events: mcpRepeatedRecoveryEvents,
  });
  const mcpSecondFeedback = buildRuntimeToolRecoveryFeedback({
    metrics: mcpSecond,
    nowMs: Date.parse(mcpSecond.latestRecovery?.observedAt ?? ""),
  });
  expectEqual(mcpSecond.latestRecovery?.stage, "ask_user", "MCP repeated environment recovery asks user");
  expectEqual(
    mcpSecond.latestRecovery?.recommendedNextAction,
    "request_environment_fix",
    "MCP repeated recovery asks environment fix",
  );
  expectEqual(mcpSecond.latestRecovery?.recoverable, false, "MCP repeated recovery blocks automatic retry");
  expectEqual(mcpSecond.latestRecovery?.requiresUserIntervention, true, "MCP repeated recovery requires intervention");
  expectEqual(mcpSecond.latestRecovery?.sameToolErrorCount, 2, "MCP repeated recovery count");
  expectEqual(mcpSecond.latestRecovery?.escalated, true, "MCP repeated recovery escalated flag");
  expectEqual(
    mcpSecond.latestRecovery?.escalationReason,
    "mcp_environment_error_repeated",
    "MCP repeated recovery reason",
  );
  expectEqual(
    mcpSecondFeedback.mcpEnvironmentRecovery?.errorCode,
    "SPAWN_FAILED",
    "MCP repeated feedback exposes recovery error code",
  );
  expectEqual(
    mcpSecondFeedback.mcpEnvironmentRecovery?.action,
    "fix_server_command_and_check_status",
    "MCP repeated feedback exposes recovery action",
  );
  expect(
    mcpSecondFeedback.promptBlock.includes("Execution rule: Ask the user to repair MCP server configuration"),
    "MCP repeated feedback uses MCP-specific execution rule",
  );
  expect(
    mcpSecondFeedback.promptBlock.includes("MCP environment fix: Do not retry mcp_call automatically."),
    "MCP repeated feedback blocks automatic MCP retry",
  );
  expect(
    mcpSecondFeedback.promptBlock.includes("mcp_environment_error_repeated"),
    "MCP repeated feedback includes MCP escalation reason",
  );
} finally {
  rmSync(mcpRepeatedWorkDir, { recursive: true, force: true });
}

const browserTimeoutWorkDir = join(
  "/tmp",
  `grobot-runtime-tool-browser-timeout-${String(process.pid)}-${String(Date.now())}`,
);
mkdirSync(browserTimeoutWorkDir, { recursive: true });
try {
  const browserTimeoutRecoveryEvents: RuntimeEvent[] = [
    event("tool_end", {
      tool_name: "web_execute_js",
      status: "failed",
      error_class: "browser_backend_result_error",
      duration_ms: 20,
    }),
    event("tool_recovery", {
      tool_name: "web_execute_js",
      error_class: "browser_backend_result_error",
      error_message: "web_execute_js backend returned error_code=TIMEOUT.",
      error_data: {
        diagnostic_kind: "browser_backend_result_error",
        tool: "web_execute_js",
        backend: "browser-structured",
        mapped_tool: "browser_execute_js",
        operation: "backend_result",
        error_code: "TIMEOUT",
        retryable: true,
      },
      recovery_stage: "strategy_switch",
      recovery_reason: "browser_backend_result_error",
      recommended_next_action: "inspect_error_and_switch_strategy",
      recoverable: true,
    }),
  ];

  const timeoutFirst = recordRuntimeToolSurfaceMetrics({
    workDir: browserTimeoutWorkDir,
    events: browserTimeoutRecoveryEvents,
  });
  expectEqual(timeoutFirst.latestRecovery?.stage, "strategy_switch", "browser timeout first stays strategy switch");
  expectEqual(timeoutFirst.latestRecovery?.sameToolErrorCount, 1, "browser timeout first count");
  expectEqual(timeoutFirst.latestRecovery?.escalated, false, "browser timeout first not escalated");

  const timeoutSecond = recordRuntimeToolSurfaceMetrics({
    workDir: browserTimeoutWorkDir,
    events: browserTimeoutRecoveryEvents,
  });
  expectEqual(timeoutSecond.latestRecovery?.stage, "strategy_switch", "browser timeout second stays strategy switch");
  expectEqual(
    timeoutSecond.latestRecovery?.recommendedNextAction,
    "inspect_error_and_switch_strategy",
    "browser timeout second keeps base action",
  );
  expectEqual(timeoutSecond.latestRecovery?.recoverable, true, "browser timeout second remains recoverable");
  expectEqual(timeoutSecond.latestRecovery?.sameToolErrorCount, 2, "browser timeout second count");
  expectEqual(timeoutSecond.latestRecovery?.escalated, false, "browser timeout second not escalated early");

  const timeoutThird = recordRuntimeToolSurfaceMetrics({
    workDir: browserTimeoutWorkDir,
    events: browserTimeoutRecoveryEvents,
  });
  expectEqual(timeoutThird.latestRecovery?.stage, "ask_user", "browser timeout third follows generic ask_user");
  expectEqual(
    timeoutThird.latestRecovery?.recommendedNextAction,
    "ask_user_for_config_or_switch_provider",
    "browser timeout third uses generic user action",
  );
  expectEqual(
    timeoutThird.latestRecovery?.escalationReason,
    "same_tool_error_exhausted",
    "browser timeout third uses generic escalation reason",
  );
} finally {
  rmSync(browserTimeoutWorkDir, { recursive: true, force: true });
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
