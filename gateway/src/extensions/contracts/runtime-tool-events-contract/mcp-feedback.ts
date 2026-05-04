import { buildRuntimeToolRecoveryFeedback } from "../../../tools/runtime/tool-events";
import { expect, expectBefore, expectEqual } from "./helpers";

export function runRuntimeToolMcpFeedbackContracts(input: {
  contractPath: (name: string) => string;
  structuredRecoveryObservedAt: string;
}): void {
  runMcpBlockedFeedbackContract(input);
  runMcpToolResultFeedbackContract(input);
  runMcpRpcArgumentFeedbackContract(input);
  runMcpNearBudgetFeedbackContract(input);
}

function runMcpBlockedFeedbackContract(input: {
  contractPath: (name: string) => string;
  structuredRecoveryObservedAt: string;
}): void {
  const { contractPath, structuredRecoveryObservedAt } = input;
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
          argument_keys: ["query"],
          argument_bytes: 20,
          max_argument_bytes: 65536,
          argument_preview: "{\"query\":\"weather\"}",
          ready: true,
          ready_reason: "ok",
          recovery_hint: "use an allowed MCP tool or request policy change",
        },
        recoverable: true,
        observedAt: structuredRecoveryObservedAt,
      },
      path: contractPath("mcp-structured"),
    },
    nowMs: Date.parse(structuredRecoveryObservedAt),
  });
  expectEqual(
    mcpStructuredFeedback.recommendedNextAction,
    "use_allowed_mcp_tool_or_request_policy_change",
    "MCP blocked tool feedback refines action",
  );
  expectEqual(
    mcpStructuredFeedback.actionFamily,
    "policy_or_permission",
    "MCP blocked tool feedback classifies action family",
  );
  expect(
    mcpStructuredFeedback.promptBlock.includes("Required next action: use_allowed_mcp_tool_or_request_policy_change"),
    "MCP blocked tool prompt uses policy-specific action",
  );
  expectBefore(
    mcpStructuredFeedback.promptBlock,
    "Required next action: use_allowed_mcp_tool_or_request_policy_change",
    "Structured error data:",
    "MCP blocked tool prompt prioritizes action before structured error prose",
  );
  expect(
    mcpStructuredFeedback.promptBlock.includes("Action family: policy_or_permission"),
    "MCP blocked tool prompt includes action family",
  );
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
  expect(
    mcpStructuredFeedback.promptBlock.includes("argument_keys=[\"query\"]"),
    "feedback summarizes blocked MCP argument keys",
  );
  expect(
    mcpStructuredFeedback.promptBlock.includes("argument_bytes=20"),
    "feedback summarizes blocked MCP argument bytes",
  );
  expect(
    mcpStructuredFeedback.promptBlock.includes("argument_preview=\"{\\\"query\\\":\\\"weather\\\"}\""),
    "feedback summarizes blocked MCP argument preview",
  );
}

function runMcpToolResultFeedbackContract(input: {
  contractPath: (name: string) => string;
  structuredRecoveryObservedAt: string;
}): void {
  const { contractPath, structuredRecoveryObservedAt } = input;
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
          argument_keys: ["query", "token"],
          argument_bytes: 48,
          max_argument_bytes: 65536,
          argument_preview: "{\"query\":\"bad args\",\"token\":\"<redacted>\"}",
          available_tools: ["echo", "fail"],
        },
        recoverable: true,
        observedAt: structuredRecoveryObservedAt,
      },
      path: contractPath("mcp-result-structured"),
    },
    nowMs: Date.parse(structuredRecoveryObservedAt),
  });
  expectEqual(
    mcpObservedResultFeedback.recommendedNextAction,
    "inspect_mcp_tool_result_and_change_arguments",
    "MCP tool result error feedback refines action",
  );
  expectEqual(
    mcpObservedResultFeedback.actionFamily,
    "argument_fix",
    "MCP tool result error feedback classifies action family",
  );
  expect(
    mcpObservedResultFeedback.promptBlock.includes("Required next action: inspect_mcp_tool_result_and_change_arguments"),
    "MCP tool result prompt uses result-specific action",
  );
  expect(
    mcpObservedResultFeedback.promptBlock.includes("diagnostic_kind=mcp_tool_result_error"),
    "feedback summarizes MCP tool result diagnostic kind",
  );
  expect(
    mcpObservedResultFeedback.promptBlock.includes("result_preview=\"bad args\""),
    "feedback summarizes MCP tool result preview",
  );
  expect(
    mcpObservedResultFeedback.promptBlock.includes("argument_keys=[\"query\",\"token\"]"),
    "feedback summarizes MCP argument keys",
  );
  expect(
    mcpObservedResultFeedback.promptBlock.includes("argument_bytes=48"),
    "feedback summarizes MCP argument bytes",
  );
  expect(
    mcpObservedResultFeedback.promptBlock.includes("max_argument_bytes=65536"),
    "feedback summarizes MCP argument byte budget",
  );
  expect(
    mcpObservedResultFeedback.promptBlock.includes("argument_preview=\"{\\\"query\\\":\\\"bad args\\\",\\\"token\\\":\\\"<redacted>\\\"}\""),
    "feedback summarizes bounded MCP argument preview",
  );
}

function runMcpRpcArgumentFeedbackContract(input: {
  contractPath: (name: string) => string;
  structuredRecoveryObservedAt: string;
}): void {
  const { contractPath, structuredRecoveryObservedAt } = input;
  const mcpRpcArgumentFeedback = buildRuntimeToolRecoveryFeedback({
    metrics: {
      version: 1,
      updatedAt: structuredRecoveryObservedAt,
      callsTotal: 1,
      failedTotal: 1,
      deferredTotal: 0,
      callsByTool: { mcp_call: 1 },
      failuresByErrorClass: { mcp_rpc_error: 1 },
      recoveryStages: { strategy_switch: 1 },
      recoveryCountsByKey: {},
      latestRecoveryRepeatKey: null,
      latestRecoveryRepeatCount: 0,
      avgDurationMsByTool: {},
      recentRecoveries: [],
      latestRecovery: {
        stage: "strategy_switch",
        reason: "mcp_rpc_error",
        recommendedNextAction: "inspect_error_and_switch_strategy",
        toolName: "mcp_call",
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
        recoverable: true,
        observedAt: structuredRecoveryObservedAt,
      },
      path: contractPath("mcp-rpc-arguments"),
    },
    nowMs: Date.parse(structuredRecoveryObservedAt),
  });
  expectEqual(
    mcpRpcArgumentFeedback.recommendedNextAction,
    "fix_mcp_tool_arguments",
    "MCP invalid params RPC feedback refines action",
  );
  expectEqual(
    mcpRpcArgumentFeedback.actionFamily,
    "argument_fix",
    "MCP invalid params RPC feedback classifies action family",
  );
  expect(
    mcpRpcArgumentFeedback.promptBlock.includes("Required next action: fix_mcp_tool_arguments"),
    "MCP invalid params prompt uses argument-specific action",
  );
  expect(
    mcpRpcArgumentFeedback.promptBlock.includes("rpc_error_code=-32602"),
    "MCP invalid params prompt includes RPC code",
  );
}

function runMcpNearBudgetFeedbackContract(input: {
  contractPath: (name: string) => string;
  structuredRecoveryObservedAt: string;
}): void {
  const { contractPath, structuredRecoveryObservedAt } = input;
  const mcpNearBudgetFeedback = buildRuntimeToolRecoveryFeedback({
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
          tool_name: "large_payload_tool",
          operation: "tools/call",
          is_error: true,
          result_preview: "payload too large for downstream service",
          argument_keys: ["document"],
          argument_bytes: 62000,
          max_argument_bytes: 65536,
          argument_preview: "{\"document\":\"<large>\"}",
        },
        recoverable: true,
        observedAt: structuredRecoveryObservedAt,
      },
      path: contractPath("mcp-near-budget"),
    },
    nowMs: Date.parse(structuredRecoveryObservedAt),
  });
  expectEqual(
    mcpNearBudgetFeedback.recommendedNextAction,
    "reduce_mcp_argument_payload",
    "MCP near-budget feedback refines action",
  );
  expectEqual(
    mcpNearBudgetFeedback.actionFamily,
    "payload_reduce",
    "MCP near-budget feedback classifies action family",
  );
  expect(
    mcpNearBudgetFeedback.promptBlock.includes("Required next action: reduce_mcp_argument_payload"),
    "MCP near-budget prompt uses payload reduction action",
  );
}
