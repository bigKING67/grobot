import { mkdirSync, writeFileSync } from "node:fs";

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function writeNonRecoverableToolRecoveryMetrics(workDir) {
  const runtimeDir = `${workDir}/.grobot/runtime`;
  mkdirSync(runtimeDir, { recursive: true });
  const observedAt = new Date().toISOString();
  const previousObservedAt = new Date(Date.parse(observedAt) - 5 * 60_000).toISOString();
  writeFileSync(
    `${runtimeDir}/tool-surface-metrics.json`,
    `${JSON.stringify({
      version: 1,
      updatedAt: observedAt,
      callsTotal: 1,
      failedTotal: 1,
      deferredTotal: 0,
      callsByTool: { web_scan: 1 },
      failuresByErrorClass: { config_missing: 1 },
      recoveryStages: { ask_user: 1 },
      durationTotalMsByTool: { web_scan: 12 },
      durationCountByTool: { web_scan: 1 },
      recentRecoveries: [
        {
          stage: "local_fix",
          reason: "path_not_found",
          recommendedNextAction: "locate_path_with_glob_before_retry",
          toolName: "read",
          errorClass: "path_not_found",
          recoverable: true,
          observedAt: previousObservedAt,
        },
        {
          stage: "ask_user",
          reason: "same_tool_error_exhausted",
          recommendedNextAction: "ask_user_for_config_or_switch_provider",
          toolName: "web_scan",
          errorClass: "config_missing",
          recoverable: false,
          requiresUserIntervention: true,
          sameToolErrorCount: 3,
          escalated: true,
          escalationReason: "same_tool_error_exhausted",
          escalationPolicyVersion: "v1",
          baseStage: "strategy_switch",
          baseRecommendedNextAction: "switch_tool_strategy",
          observedAt,
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  return observedAt;
}

export function writeBrowserEnvironmentToolRecoveryMetrics(workDir) {
  const runtimeDir = `${workDir}/.grobot/runtime`;
  mkdirSync(runtimeDir, { recursive: true });
  const observedAt = new Date().toISOString();
  writeFileSync(
    `${runtimeDir}/tool-surface-metrics.json`,
    `${JSON.stringify({
      version: 1,
      updatedAt: observedAt,
      callsTotal: 1,
      failedTotal: 1,
      deferredTotal: 0,
      callsByTool: { web_scan: 1 },
      failuresByErrorClass: { browser_backend_result_error: 1 },
      recoveryStages: { ask_user: 1 },
      recoveryCountsByKey: { "tool_error:web_scan:browser_backend_result_error": 2 },
      latestRecoveryRepeatKey: "tool_error:web_scan:browser_backend_result_error",
      latestRecoveryRepeatCount: 2,
      durationTotalMsByTool: { web_scan: 8 },
      durationCountByTool: { web_scan: 1 },
      recentRecoveries: [
        {
          stage: "ask_user",
          reason: "browser_backend_result_error",
          recommendedNextAction: "request_environment_fix",
          toolName: "web_scan",
          errorClass: "browser_backend_result_error",
          errorMessage: "web_scan backend returned error_code=NO_EXTENSION: Browser extension is not connected.",
          errorData: {
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
          recoverable: false,
          requiresUserIntervention: true,
          sameToolErrorCount: 2,
          escalated: true,
          escalationReason: "browser_environment_error_repeated",
          escalationPolicyVersion: "v1",
          baseStage: "strategy_switch",
          baseRecommendedNextAction: "inspect_error_and_switch_strategy",
          observedAt,
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
}

export function writeMcpEnvironmentToolRecoveryMetrics(workDir) {
  const runtimeDir = `${workDir}/.grobot/runtime`;
  mkdirSync(runtimeDir, { recursive: true });
  const observedAt = new Date().toISOString();
  writeFileSync(
    `${runtimeDir}/tool-surface-metrics.json`,
    `${JSON.stringify({
      version: 1,
      updatedAt: observedAt,
      callsTotal: 1,
      failedTotal: 1,
      deferredTotal: 0,
      callsByTool: { mcp_call: 1 },
      failuresByErrorClass: { mcp_server_unready: 1 },
      recoveryStages: { ask_user: 1 },
      recoveryCountsByKey: { "tool_error:mcp_call:mcp_server_unready": 1 },
      latestRecoveryRepeatKey: "tool_error:mcp_call:mcp_server_unready",
      latestRecoveryRepeatCount: 1,
      durationTotalMsByTool: { mcp_call: 12 },
      durationCountByTool: { mcp_call: 1 },
      recentRecoveries: [
        {
          stage: "ask_user",
          reason: "mcp_server_unready",
          recommendedNextAction: "request_environment_fix",
          toolName: "mcp_call",
          errorClass: "mcp_server_unready",
          errorMessage: "MCP server `grok-search` is unready: command_not_found",
          errorData: {
            diagnostic_kind: "mcp_server_unready",
            server: "grok-search",
            server_key: "grok-search",
            tool_name: "web_search",
            operation: "resolve_server",
            enabled: true,
            ready: false,
            ready_reason: "command_not_found",
            source: ".grobot/mcp.toml",
            recovery_hint: "fix MCP server command/readiness before retrying",
          },
          recoverable: false,
          requiresUserIntervention: true,
          sameToolErrorCount: 1,
          escalated: false,
          escalationReason: null,
          escalationPolicyVersion: "v1",
          baseStage: null,
          baseRecommendedNextAction: null,
          observedAt,
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
}

export function writeGateBlockedRecoverableToolRecoveryMetrics(workDir) {
  const runtimeDir = `${workDir}/.grobot/runtime`;
  mkdirSync(runtimeDir, { recursive: true });
  const observedAt = new Date().toISOString();
  const previousObservedAt = new Date(Date.parse(observedAt) - 5 * 60_000).toISOString();
  writeFileSync(
    `${runtimeDir}/tool-surface-metrics.json`,
    `${JSON.stringify({
      version: 1,
      updatedAt: observedAt,
      callsTotal: 2,
      failedTotal: 2,
      deferredTotal: 0,
      callsByTool: { read: 1, web_scan: 1 },
      failuresByErrorClass: { config_missing: 1, tool_not_visible: 1 },
      recoveryStages: { ask_user: 1, strategy_switch: 1 },
      durationTotalMsByTool: { read: 8, web_scan: 12 },
      durationCountByTool: { read: 1, web_scan: 1 },
      recentRecoveries: [
        {
          stage: "ask_user",
          reason: "config_missing",
          recommendedNextAction: "ask_user_for_config_or_switch_provider",
          toolName: "read",
          errorClass: "config_missing",
          recoverable: false,
          observedAt: previousObservedAt,
        },
        {
          stage: "strategy_switch",
          reason: "tool_not_visible",
          recommendedNextAction: "switch_to_web_scan_surface",
          toolName: "web_scan",
          errorClass: "tool_not_visible",
          recoverable: true,
          observedAt,
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
}

export function writeNonRecoverableToolRecoveryConsumption(workDir, observedAt) {
  const runtimeDir = `${workDir}/.grobot/runtime`;
  mkdirSync(runtimeDir, { recursive: true });
  const consumedAt = new Date(Date.parse(observedAt) + 60_000).toISOString();
  writeFileSync(
    `${runtimeDir}/tool-surface-adaptation-state.json`,
    `${JSON.stringify({
      version: 1,
      updatedAt: consumedAt,
      recentAdaptations: [],
      profileOutcomes: {},
      recentRecoveryConsumptions: [
        {
          id: "tsc_nonrecoverable_intervention_prompted_contract",
          reason: "nonrecoverable_intervention_prompted",
          recoveryStage: "ask_user",
          recoveryToolName: "web_scan",
          recoveryErrorClass: "config_missing",
          recoveryObservedAt: observedAt,
          consumedAt,
          traceId: "trace_status_nonrecoverable_consumed_contract",
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
}

export function runtimeEnvironmentRecoveryPlanSummary(plan) {
  return isObject(plan)
    ? {
        error_code: plan.error_code ?? null,
        action: plan.action ?? null,
        retry_allowed: plan.retry_allowed ?? null,
        commands: Array.isArray(plan.commands) ? plan.commands.join("|") : null,
        error_class: plan.error_class ?? null,
        detail: plan.detail ?? null,
        required_config: plan.required_config ?? null,
        source_path: plan.source_path ?? null,
        work_dir: plan.work_dir ?? null,
      }
    : {
        error_code: null,
        action: null,
        retry_allowed: null,
        commands: null,
        error_class: null,
        detail: null,
        required_config: null,
        source_path: null,
        work_dir: null,
      };
}

export function browserEnvironmentRecoveryPlanSummary(plan) {
  return isObject(plan)
    ? {
        error_code: plan.error_code ?? null,
        action: plan.action ?? null,
        retry_allowed: plan.retry_allowed ?? null,
        commands: Array.isArray(plan.commands) ? plan.commands.join("|") : null,
      }
    : {
        error_code: null,
        action: null,
        retry_allowed: null,
        commands: null,
      };
}

export function mcpEnvironmentRecoveryPlanSummary(plan) {
  return isObject(plan)
    ? {
        error_code: plan.error_code ?? null,
        action: plan.action ?? null,
        retry_allowed: plan.retry_allowed ?? null,
        commands: Array.isArray(plan.commands) ? plan.commands.join("|") : null,
        server: plan.server ?? null,
        tool_name: plan.tool_name ?? null,
        source_path: plan.source_path ?? null,
        ready_reason: plan.ready_reason ?? null,
        command: plan.command ?? null,
        available_servers:
          Array.isArray(plan.available_servers) && plan.available_servers.length > 0
            ? plan.available_servers.join("|")
            : null,
        registry_paths: Array.isArray(plan.registry_paths) ? plan.registry_paths.join("|") : null,
      }
    : {
        error_code: null,
        action: null,
        retry_allowed: null,
        commands: null,
        server: null,
        tool_name: null,
        source_path: null,
        ready_reason: null,
        command: null,
        available_servers: null,
        registry_paths: null,
      };
}
