import type { RuntimeToolRecoveryDecision } from "../../tools/runtime/tool-recovery-decision";
import { buildRuntimeToolRecoveryDecision } from "../../tools/runtime/tool-recovery-decision";
import type {
  RuntimeToolRecoveryActionFamily,
  RuntimeToolRecoveryHint,
  RuntimeToolRecoveryStage,
  RuntimeToolSurfaceMetricsSnapshot,
} from "../../tools/runtime/tool-events";
import type { RuntimeToolSurfaceAdaptationSnapshot } from "../../tools/runtime/tool-surface-adaptation-state";

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

function expectIncludes(value: string, expected: string, message: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${message}: missing=${expected} actual=${value}`);
  }
}

const observedAt = "2026-04-28T00:00:00.000Z";
const matrixPath = [
  process.env.TMPDIR ?? "/tmp",
  `grobot-runtime-tool-mcp-recovery-eval-${String(process.pid)}-${String(Date.now())}`,
].join("/");

function metricsForRecovery(input: {
  id: string;
  recovery: RuntimeToolRecoveryHint;
}): RuntimeToolSurfaceMetricsSnapshot {
  const recovery = {
    ...input.recovery,
    observedAt: input.recovery.observedAt ?? observedAt,
  };
  const errorClass = recovery.errorClass ?? recovery.reason;
  return {
    version: 1,
    updatedAt: recovery.observedAt ?? observedAt,
    callsTotal: 1,
    failedTotal: 1,
    deferredTotal: 0,
    callsByTool: {
      [recovery.toolName ?? "mcp_call"]: 1,
    },
    failuresByErrorClass: {
      [errorClass]: 1,
    },
    recoveryStages: {
      [recovery.stage]: 1,
    },
    recoveryCountsByKey: {
      [`tool_error:${recovery.toolName ?? "<none>"}:${errorClass}`]: 1,
    },
    latestRecoveryRepeatKey: `tool_error:${recovery.toolName ?? "<none>"}:${errorClass}`,
    latestRecoveryRepeatCount: 1,
    avgDurationMsByTool: {},
    recentRecoveries: [recovery],
    latestRecovery: recovery,
    path: `${matrixPath}-${input.id}`,
  };
}

const emptyAdaptationSnapshot: RuntimeToolSurfaceAdaptationSnapshot = {
  version: 1,
  updatedAt: null,
  path: `${matrixPath}-adaptation`,
  recentAdaptations: [],
  latestAdaptation: null,
  profileOutcomes: {},
  recentRecoveryConsumptions: [],
  latestRecoveryConsumption: null,
};

type ExpectedGateStatus = "pass" | "warn" | "fail";
type ExpectedGateReason =
  | "ready"
  | "degraded_auto_recovery_allowed"
  | "blocked_operator_action_required"
  | "blocked_auto_recovery_denied"
  | "operator_action_required"
  | "automatic_recovery_denied"
  | "readiness_state_inconsistent";
type ExpectedReadinessStatus = "ready" | "degraded" | "blocked";
type ExpectedBlockerKind =
  | "none"
  | "runtime_environment"
  | "browser_environment"
  | "mcp_environment"
  | "operator_action"
  | "automatic_recovery_policy"
  | "readiness_state";

interface McpRecoveryEvalRow {
  id: string;
  recovery: RuntimeToolRecoveryHint;
  expected: {
    action: string;
    family: RuntimeToolRecoveryActionFamily;
    recoverable: boolean | null;
    requiresUserIntervention: boolean;
    readinessStatus: ExpectedReadinessStatus;
    gateStatus: ExpectedGateStatus;
    gateReason: ExpectedGateReason;
    gateBlockerKind: ExpectedBlockerKind;
    gateBlockerCode: string | null;
    gateBlockerAction: string | null;
    promptIncludes: string[];
    mcpEnvironmentErrorCode?: string | null;
  };
}

function mcpRecovery(input: {
  stage?: RuntimeToolRecoveryStage;
  reason: string;
  recommendedNextAction: string;
  errorClass: string;
  errorData: Record<string, unknown>;
  recoverable?: boolean;
  requiresUserIntervention?: boolean;
  escalated?: boolean;
}): RuntimeToolRecoveryHint {
  return {
    stage: input.stage ?? "strategy_switch",
    reason: input.reason,
    recommendedNextAction: input.recommendedNextAction,
    toolName: "mcp_call",
    errorClass: input.errorClass,
    errorData: input.errorData,
    recoverable: input.recoverable ?? true,
    requiresUserIntervention: input.requiresUserIntervention,
    escalated: input.escalated,
    observedAt,
  };
}

const rows: McpRecoveryEvalRow[] = [
  {
    id: "mcp_tool_blocked_policy",
    recovery: mcpRecovery({
      reason: "mcp_tool_blocked",
      recommendedNextAction: "request_approval_or_use_safer_tool",
      errorClass: "mcp_tool_blocked",
      errorData: {
        diagnostic_kind: "mcp_tool_blocked",
        server: "grok-search",
        server_key: "grok-search",
        tool_name: "web_search",
        operation: "policy_check",
        allow_tools: ["get_sources"],
        argument_keys: ["query"],
        argument_bytes: 20,
        max_argument_bytes: 65536,
        argument_preview: "{\"query\":\"weather\"}",
      },
    }),
    expected: {
      action: "use_allowed_mcp_tool_or_request_policy_change",
      family: "policy_or_permission",
      recoverable: true,
      requiresUserIntervention: false,
      readinessStatus: "degraded",
      gateStatus: "warn",
      gateReason: "degraded_auto_recovery_allowed",
      gateBlockerKind: "none",
      gateBlockerCode: null,
      gateBlockerAction: null,
      promptIncludes: [
        "Required next action: use_allowed_mcp_tool_or_request_policy_change",
        "Action family: policy_or_permission",
        "allow_tools=[\"get_sources\"]",
        "argument_keys=[\"query\"]",
        "argument_preview=\"{\\\"query\\\":\\\"weather\\\"}\"",
      ],
    },
  },
  {
    id: "mcp_rpc_invalid_params",
    recovery: mcpRecovery({
      reason: "mcp_rpc_error",
      recommendedNextAction: "inspect_error_and_switch_strategy",
      errorClass: "mcp_rpc_error",
      errorData: {
        diagnostic_kind: "mcp_rpc_error",
        server: "browser-structured",
        server_key: "browser-structured",
        tool_name: "browser_execute_js",
        operation: "tools/call",
        rpc_error_code: -32602,
        rpc_error_message: "Invalid params",
        argument_keys: ["script"],
        argument_bytes: 36,
        max_argument_bytes: 65536,
        argument_preview: "{\"script\":\"return location.href\"}",
      },
    }),
    expected: {
      action: "fix_mcp_tool_arguments",
      family: "argument_fix",
      recoverable: true,
      requiresUserIntervention: false,
      readinessStatus: "degraded",
      gateStatus: "warn",
      gateReason: "degraded_auto_recovery_allowed",
      gateBlockerKind: "none",
      gateBlockerCode: null,
      gateBlockerAction: null,
      promptIncludes: [
        "Required next action: fix_mcp_tool_arguments",
        "Action family: argument_fix",
        "rpc_error_code=-32602",
        "argument_keys=[\"script\"]",
      ],
    },
  },
  {
    id: "mcp_rpc_generic_error",
    recovery: mcpRecovery({
      reason: "mcp_rpc_error",
      recommendedNextAction: "inspect_error_and_switch_strategy",
      errorClass: "mcp_rpc_error",
      errorData: {
        diagnostic_kind: "mcp_rpc_error",
        server: "browser-structured",
        server_key: "browser-structured",
        tool_name: "browser_execute_js",
        operation: "tools/call",
        rpc_error_code: -32001,
        rpc_error_message: "server failed",
        argument_keys: ["script"],
        argument_bytes: 40,
        max_argument_bytes: 65536,
        argument_preview: "{\"script\":\"return document.title\"}",
      },
    }),
    expected: {
      action: "inspect_mcp_rpc_error_and_switch_strategy",
      family: "strategy_switch",
      recoverable: true,
      requiresUserIntervention: false,
      readinessStatus: "degraded",
      gateStatus: "warn",
      gateReason: "degraded_auto_recovery_allowed",
      gateBlockerKind: "none",
      gateBlockerCode: null,
      gateBlockerAction: null,
      promptIncludes: [
        "Required next action: inspect_mcp_rpc_error_and_switch_strategy",
        "Action family: strategy_switch",
        "rpc_error_code=-32001",
      ],
    },
  },
  {
    id: "mcp_tool_result_error",
    recovery: mcpRecovery({
      reason: "mcp_tool_result_error",
      recommendedNextAction: "inspect_error_and_switch_strategy",
      errorClass: "mcp_tool_result_error",
      errorData: {
        diagnostic_kind: "mcp_tool_result_error",
        server: "mock",
        server_key: "mock",
        tool_name: "fail",
        operation: "tools/call",
        is_error: true,
        result_preview: "bad args",
        structured_content_preview: "{\"reason\":\"bad args\"}",
        argument_keys: ["query", "token"],
        argument_bytes: 48,
        max_argument_bytes: 65536,
        argument_preview: "{\"query\":\"bad args\",\"token\":\"<redacted>\"}",
      },
    }),
    expected: {
      action: "inspect_mcp_tool_result_and_change_arguments",
      family: "argument_fix",
      recoverable: true,
      requiresUserIntervention: false,
      readinessStatus: "degraded",
      gateStatus: "warn",
      gateReason: "degraded_auto_recovery_allowed",
      gateBlockerKind: "none",
      gateBlockerCode: null,
      gateBlockerAction: null,
      promptIncludes: [
        "Required next action: inspect_mcp_tool_result_and_change_arguments",
        "Action family: argument_fix",
        "result_preview=\"bad args\"",
        "argument_keys=[\"query\",\"token\"]",
      ],
    },
  },
  {
    id: "mcp_arguments_too_large",
    recovery: mcpRecovery({
      reason: "mcp_arguments_too_large",
      recommendedNextAction: "inspect_error_and_switch_strategy",
      errorClass: "mcp_arguments_too_large",
      errorData: {
        diagnostic_kind: "mcp_arguments_too_large",
        server: "mock",
        server_key: "mock",
        tool_name: "large_payload_tool",
        operation: "parse_arguments",
        reason: "arguments_exceed_byte_budget",
        argument_keys: ["document"],
        argument_bytes: 70000,
        max_argument_bytes: 65536,
        argument_preview: "{\"document\":\"<large>\"}",
      },
    }),
    expected: {
      action: "reduce_mcp_argument_payload",
      family: "payload_reduce",
      recoverable: true,
      requiresUserIntervention: false,
      readinessStatus: "degraded",
      gateStatus: "warn",
      gateReason: "degraded_auto_recovery_allowed",
      gateBlockerKind: "none",
      gateBlockerCode: null,
      gateBlockerAction: null,
      promptIncludes: [
        "Required next action: reduce_mcp_argument_payload",
        "Action family: payload_reduce",
        "reason=arguments_exceed_byte_budget",
        "max_argument_bytes=65536",
      ],
    },
  },
  {
    id: "mcp_near_budget_payload",
    recovery: mcpRecovery({
      reason: "mcp_tool_result_error",
      recommendedNextAction: "inspect_error_and_switch_strategy",
      errorClass: "mcp_tool_result_error",
      errorData: {
        diagnostic_kind: "mcp_tool_result_error",
        server: "mock",
        server_key: "mock",
        tool_name: "large_payload_tool",
        operation: "tools/call",
        is_error: true,
        result_preview: "payload too large for downstream service",
        argument_keys: ["document"],
        argument_bytes: 62000,
        max_argument_bytes: 65536,
        argument_preview: "{\"document\":\"<large>\"}",
      },
    }),
    expected: {
      action: "reduce_mcp_argument_payload",
      family: "payload_reduce",
      recoverable: true,
      requiresUserIntervention: false,
      readinessStatus: "degraded",
      gateStatus: "warn",
      gateReason: "degraded_auto_recovery_allowed",
      gateBlockerKind: "none",
      gateBlockerCode: null,
      gateBlockerAction: null,
      promptIncludes: [
        "Required next action: reduce_mcp_argument_payload",
        "Action family: payload_reduce",
        "argument_bytes=62000",
      ],
    },
  },
  {
    id: "mcp_invalid_argument_shape",
    recovery: mcpRecovery({
      reason: "invalid_tool_arguments",
      recommendedNextAction: "fix_tool_arguments",
      errorClass: "invalid_tool_arguments",
      errorData: {
        diagnostic_kind: "invalid_tool_arguments",
        server: "mock",
        server_key: "mock",
        tool_name: "echo",
        operation: "parse_arguments",
        reason: "arguments_not_object",
        argument_type: "array",
      },
    }),
    expected: {
      action: "fix_mcp_tool_arguments",
      family: "argument_fix",
      recoverable: true,
      requiresUserIntervention: false,
      readinessStatus: "degraded",
      gateStatus: "warn",
      gateReason: "degraded_auto_recovery_allowed",
      gateBlockerKind: "none",
      gateBlockerCode: null,
      gateBlockerAction: null,
      promptIncludes: [
        "Required next action: fix_mcp_tool_arguments",
        "Action family: argument_fix",
        "diagnostic_kind=invalid_tool_arguments",
        "reason=arguments_not_object",
      ],
    },
  },
  {
    id: "mcp_server_unready_environment",
    recovery: mcpRecovery({
      stage: "ask_user",
      reason: "mcp_server_unready",
      recommendedNextAction: "request_environment_fix",
      errorClass: "mcp_server_unready",
      recoverable: false,
      requiresUserIntervention: true,
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
      },
    }),
    expected: {
      action: "request_environment_fix",
      family: "environment_fix",
      recoverable: false,
      requiresUserIntervention: true,
      readinessStatus: "blocked",
      gateStatus: "fail",
      gateReason: "blocked_operator_action_required",
      gateBlockerKind: "mcp_environment",
      gateBlockerCode: "SERVER_UNREADY",
      gateBlockerAction: "fix_server_readiness_and_check_status",
      mcpEnvironmentErrorCode: "SERVER_UNREADY",
      promptIncludes: [
        "Required next action: request_environment_fix",
        "Action family: environment_fix",
        "Execution rule: Ask the user to repair MCP server configuration",
        "MCP environment fix: Do not retry mcp_call automatically.",
        "ready_reason=command_not_found",
      ],
    },
  },
  {
    id: "mcp_server_busy",
    recovery: mcpRecovery({
      reason: "mcp_server_busy",
      recommendedNextAction: "retry_with_smaller_scope_or_wait",
      errorClass: "mcp_server_busy",
      errorData: {
        diagnostic_kind: "mcp_server_busy",
        server: "browser-structured",
        server_key: "browser-structured",
        tool_name: "browser_scan",
        operation: "queue",
        in_flight: 2,
        max_concurrency_per_server: 2,
        queue_waiting: 0,
      },
    }),
    expected: {
      action: "retry_with_smaller_scope_or_wait",
      family: "wait_or_retry",
      recoverable: true,
      requiresUserIntervention: false,
      readinessStatus: "degraded",
      gateStatus: "warn",
      gateReason: "degraded_auto_recovery_allowed",
      gateBlockerKind: "none",
      gateBlockerCode: null,
      gateBlockerAction: null,
      promptIncludes: [
        "Required next action: retry_with_smaller_scope_or_wait",
        "Action family: wait_or_retry",
        "in_flight=2",
        "max_concurrency_per_server=2",
      ],
    },
  },
  {
    id: "mcp_queue_timeout",
    recovery: mcpRecovery({
      reason: "mcp_queue_timeout",
      recommendedNextAction: "retry_with_smaller_scope_or_wait",
      errorClass: "mcp_queue_timeout",
      errorData: {
        diagnostic_kind: "mcp_queue_timeout",
        server: "browser-structured",
        server_key: "browser-structured",
        tool_name: "browser_scan",
        operation: "queue_wait",
        queue_waiting: 4,
        max_queue_per_server: 4,
        timeout_ms: 1000,
      },
    }),
    expected: {
      action: "retry_with_smaller_scope_or_wait",
      family: "wait_or_retry",
      recoverable: true,
      requiresUserIntervention: false,
      readinessStatus: "degraded",
      gateStatus: "warn",
      gateReason: "degraded_auto_recovery_allowed",
      gateBlockerKind: "none",
      gateBlockerCode: null,
      gateBlockerAction: null,
      promptIncludes: [
        "Required next action: retry_with_smaller_scope_or_wait",
        "Action family: wait_or_retry",
        "queue_waiting=4",
        "timeout_ms=1000",
      ],
    },
  },
  {
    id: "mcp_circuit_open",
    recovery: mcpRecovery({
      reason: "mcp_circuit_open",
      recommendedNextAction: "retry_with_smaller_scope_or_wait",
      errorClass: "mcp_circuit_open",
      errorData: {
        diagnostic_kind: "mcp_circuit_open",
        server: "grok-search",
        server_key: "grok-search",
        tool_name: "web_search",
        operation: "circuit_guard",
        circuit_open_until_epoch_secs: 1780000000,
      },
    }),
    expected: {
      action: "retry_with_smaller_scope_or_wait",
      family: "wait_or_retry",
      recoverable: true,
      requiresUserIntervention: false,
      readinessStatus: "degraded",
      gateStatus: "warn",
      gateReason: "degraded_auto_recovery_allowed",
      gateBlockerKind: "none",
      gateBlockerCode: null,
      gateBlockerAction: null,
      promptIncludes: [
        "Required next action: retry_with_smaller_scope_or_wait",
        "Action family: wait_or_retry",
        "circuit_open_until_epoch_secs=1780000000",
      ],
    },
  },
];

function assertDecision(row: McpRecoveryEvalRow, decision: RuntimeToolRecoveryDecision): void {
  const timelineHead = decision.timeline[0];
  expect(timelineHead !== undefined, `${row.id} timeline has latest entry`);

  expectEqual(decision.feedback.recommendedNextAction, row.expected.action, `${row.id} feedback action`);
  expectEqual(decision.feedback.actionFamily, row.expected.family, `${row.id} feedback action family`);
  expectEqual(decision.feedback.recoverable, row.expected.recoverable, `${row.id} feedback recoverable`);
  expectEqual(
    decision.feedback.requiresUserIntervention,
    row.expected.requiresUserIntervention,
    `${row.id} feedback user intervention`,
  );
  for (const fragment of row.expected.promptIncludes) {
    expectIncludes(decision.feedback.promptBlock, fragment, `${row.id} prompt fragment`);
  }

  expectEqual(timelineHead.recommendedNextAction, row.expected.action, `${row.id} timeline action`);
  expectEqual(timelineHead.recommendedActionFamily, row.expected.family, `${row.id} timeline action family`);
  expectEqual(timelineHead.active, true, `${row.id} timeline active`);
  expectEqual(timelineHead.consumed, false, `${row.id} timeline not consumed`);

  expectEqual(decision.health.recommendedNextAction, row.expected.action, `${row.id} health action`);
  expectEqual(decision.health.recommendedActionFamily, row.expected.family, `${row.id} health action family`);
  expectEqual(decision.health.attentionActionFamily, row.expected.family, `${row.id} health attention family`);

  expectEqual(decision.readiness.status, row.expected.readinessStatus, `${row.id} readiness status`);
  expectEqual(decision.readiness.recommendedNextAction, row.expected.action, `${row.id} readiness action`);
  expectEqual(decision.readiness.recommendedActionFamily, row.expected.family, `${row.id} readiness family`);
  expectEqual(
    decision.readiness.attentionRequiresUserIntervention,
    row.expected.requiresUserIntervention,
    `${row.id} readiness user intervention`,
  );

  expectEqual(decision.gate.status, row.expected.gateStatus, `${row.id} gate status`);
  expectEqual(decision.gate.reason, row.expected.gateReason, `${row.id} gate reason`);
  expectEqual(decision.gate.blockerKind, row.expected.gateBlockerKind, `${row.id} gate blocker kind`);
  expectEqual(decision.gate.blockerCode, row.expected.gateBlockerCode, `${row.id} gate blocker code`);
  expectEqual(decision.gate.blockerAction, row.expected.gateBlockerAction, `${row.id} gate blocker action`);
  expectEqual(decision.gate.recommendedNextAction, row.expected.action, `${row.id} gate action`);
  expectEqual(decision.gate.recommendedActionFamily, row.expected.family, `${row.id} gate family`);

  if (row.expected.mcpEnvironmentErrorCode !== undefined) {
    expectEqual(
      decision.feedback.mcpEnvironmentRecovery?.errorCode ?? null,
      row.expected.mcpEnvironmentErrorCode,
      `${row.id} feedback MCP environment plan`,
    );
    expectEqual(
      decision.readiness.attentionMcpEnvironmentRecovery?.errorCode ?? null,
      row.expected.mcpEnvironmentErrorCode,
      `${row.id} readiness MCP environment plan`,
    );
    expectEqual(
      decision.gate.attentionMcpEnvironmentRecovery?.errorCode ?? null,
      row.expected.mcpEnvironmentErrorCode,
      `${row.id} gate MCP environment plan`,
    );
  }
}

const familyCounts: Record<string, number> = {};
const actionCounts: Record<string, number> = {};
const gateCounts: Record<string, number> = {};

for (const row of rows) {
  const decision = buildRuntimeToolRecoveryDecision({
    metrics: metricsForRecovery({
      id: row.id,
      recovery: row.recovery,
    }),
    adaptationSnapshot: emptyAdaptationSnapshot,
    nowMs: Date.parse(observedAt),
  });
  assertDecision(row, decision);
  familyCounts[row.expected.family] = (familyCounts[row.expected.family] ?? 0) + 1;
  actionCounts[row.expected.action] = (actionCounts[row.expected.action] ?? 0) + 1;
  gateCounts[row.expected.gateStatus] = (gateCounts[row.expected.gateStatus] ?? 0) + 1;
}

process.stdout.write(JSON.stringify({
  ok: true,
  eval_count: rows.length,
  action_families: familyCounts,
  actions: actionCounts,
  gate_statuses: gateCounts,
}) + "\n");
