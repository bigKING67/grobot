import {
  browserEnvironmentRecoveryActionInstruction,
  browserEnvironmentRecoveryFixInstruction,
  buildBrowserEnvironmentRecoveryPlan,
  formatBrowserEnvironmentRecoveryPlan,
  serializeBrowserEnvironmentRecoveryPlan,
} from "../../../tools/runtime/browser-environment-recovery";
import {
  buildMcpEnvironmentRecoveryPlan,
  formatMcpEnvironmentRecoveryPlan,
  serializeMcpEnvironmentRecoveryPlan,
} from "../../../tools/runtime/mcp-environment-recovery";
import {
  buildRuntimeEnvironmentRecoveryPlan,
  formatRuntimeEnvironmentRecoveryPlan,
  serializeRuntimeEnvironmentRecoveryPlan,
} from "../../../tools/runtime/runtime-environment-recovery";
import {
  buildRuntimeToolRecoveryFeedback,
} from "../../../tools/runtime/tool-events";
import { expect, expectEqual } from "./helpers";
import { runRuntimeToolProviderRecoveryContracts } from "./provider-recovery";

export function runRuntimeToolEnvironmentRecoveryContracts(input: {
  contractPath: (name: string) => string;
  structuredRecoveryObservedAt: string;
}): void {
  const { contractPath, structuredRecoveryObservedAt } = input;

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
      path: contractPath("mcp-environment"),
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
      errorMessage: "model_config.base_url is required for kimi official tools",
      errorData: {
        required_config: "model_config.api_key",
        source: "provider_options.kimi.official_tools",
        recovery_hint: "provide model_config.api_key",
      },
      errorCode: "CONFIG_MISSING",
      action: "fix_config_or_switch_provider_and_check_status",
      commands: ["grobot status --json", "grobot status --probe --json"],
      requiredConfig: "model_config.api_key",
    },
    {
      errorClass: "config_invalid",
      errorMessage: "model=auto returned no available models",
      errorData: {
        source: "model.catalog",
        stage: "auto_model_select",
        recovery_hint: "set an explicit model or fix provider catalog access",
      },
      errorCode: "CONFIG_INVALID",
      action: "fix_config_or_switch_provider_and_check_status",
      commands: ["grobot status --json", "grobot status --probe --json"],
      requiredConfig: null,
    },
    {
      errorClass: "tool_context_missing",
      errorMessage: "runtime tool context is required",
      errorData: {},
      errorCode: "TOOL_CONTEXT_MISSING",
      action: "fix_tool_context_and_check_status",
      commands: ["grobot status --json"],
      requiredConfig: null,
    },
    {
      errorClass: "tool_context_invalid",
      errorMessage: "tool_context.work_dir is not a directory",
      errorData: {},
      errorCode: "TOOL_CONTEXT_INVALID",
      action: "fix_tool_context_and_check_status",
      commands: ["grobot status --json"],
      requiredConfig: null,
    },
    {
      errorClass: "runtime_state_unavailable",
      errorMessage: "failed to lock file mutation queue store",
      errorData: {},
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
        work_dir: contractPath("runtime-env-contract"),
        ...recoveryCase.errorData,
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
  const legacyRuntimeConfigPlan = buildRuntimeEnvironmentRecoveryPlan({
    errorClass: "config_missing",
    errorMessage: "provider_options.kimi.files_enabled=true is required",
  });
  expectEqual(
    legacyRuntimeConfigPlan?.requiredConfig,
    "provider_options.kimi.files_enabled=true",
    "runtime environment recovery keeps legacy message inference as fallback",
  );
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
        errorMessage: "legacy fallback message without structured required_config",
        errorData: {
          required_config: "provider_options.kimi.files_enabled=true",
          source: "read.media",
        },
        recoverable: false,
        requiresUserIntervention: true,
        observedAt: structuredRecoveryObservedAt,
      },
      path: contractPath("runtime-environment"),
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

  runRuntimeToolProviderRecoveryContracts({
    contractPath,
    structuredRecoveryObservedAt,
  });

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
      path: contractPath("semantic-structured"),
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
      path: contractPath("browser-structured"),
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
}
