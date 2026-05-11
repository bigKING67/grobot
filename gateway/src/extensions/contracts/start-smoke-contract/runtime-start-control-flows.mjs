export function runStartInvalidRuntimeControlsRejectFlow(context) {
  const runtimeOptionControls = runStartInvalidRuntimeOptionControlsRejectFlow(context);
  const providerEnvControls = runStartInvalidProviderEnvControlsRejectFlow(context);
  const maintenanceEnvControls = runStartInvalidMaintenanceEnvControlsRejectFlow(context);
  return {
    ...runtimeOptionControls,
    ...providerEnvControls,
    ...maintenanceEnvControls,
    hides_top_level_fatal:
      runtimeOptionControls.hides_top_level_fatal
      && providerEnvControls.hides_top_level_fatal
      && maintenanceEnvControls.hides_top_level_fatal,
    has_start_banner:
      runtimeOptionControls.has_start_banner
      || providerEnvControls.has_start_banner
      || maintenanceEnvControls.has_start_banner,
  };
}

function createRuntimeControlArgs(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
    hasStartBannerMarker,
  } = context;
  const workDir = createTempDir("grobot-start-invalid-runtime-controls-work");
  const config = writeConfig(buildSmokeConfig(workDir));
  const commonArgs = [
    "./grobot",
    "start",
    "--project",
    "grobot",
    "--work-dir",
    workDir,
    "--config",
    config.configPath,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
    "--session-subject",
    "start-invalid-runtime-controls-user",
    "--message",
    "invalid runtime controls should not reach runtime",
  ];
  return {
    commonArgs,
    hasStartBannerMarker,
    repoRoot,
    runCommand,
  };
}

function outputText(...results) {
  return results.flatMap((result) => [result.stdout, result.stderr]).join("\n");
}

function runtimeControlsFooter(combinedOutput, hasStartBannerMarker) {
  return {
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    has_start_banner: hasStartBannerMarker(combinedOutput),
  };
}

export function runStartInvalidRuntimeOptionControlsRejectFlow(context) {
  const {
    commonArgs,
    hasStartBannerMarker,
    repoRoot,
    runCommand,
  } = createRuntimeControlArgs(context);
  const invalidTimeoutResult = runCommand(repoRoot, [
    ...commonArgs,
    "--runtime-http-timeout-ms",
    "0",
  ]);
  const missingTimeoutResult = runCommand(repoRoot, [
    ...commonArgs,
    "--runtime-http-timeout-ms",
  ]);
  const invalidCircuitFailuresResult = runCommand(repoRoot, [
    ...commonArgs,
    "--circuit-failures",
    "nan",
  ]);
  const invalidProviderLimitResult = runCommand(repoRoot, [
    ...commonArgs,
    "--provider-max-inflight",
    "-1",
  ]);
  const combinedOutput = outputText(
    invalidTimeoutResult,
    missingTimeoutResult,
    invalidCircuitFailuresResult,
    invalidProviderLimitResult,
  );
  return {
    invalid_timeout_exit_code: invalidTimeoutResult.exit_code,
    invalid_timeout_has_stable_error:
      invalidTimeoutResult.stderr.includes("error: invalid_runtime_http_timeout_ms:")
      && invalidTimeoutResult.stderr.includes("runtime-http-timeout-ms must be a positive integer"),
    missing_timeout_exit_code: missingTimeoutResult.exit_code,
    missing_timeout_has_stable_error:
      missingTimeoutResult.stderr.includes("error: invalid_runtime_http_timeout_ms:")
      && missingTimeoutResult.stderr.includes("runtime-http-timeout-ms must be a positive integer"),
    invalid_circuit_failures_exit_code: invalidCircuitFailuresResult.exit_code,
    invalid_circuit_failures_has_stable_error:
      invalidCircuitFailuresResult.stderr.includes("error: invalid_circuit_failures:")
      && invalidCircuitFailuresResult.stderr.includes("circuit-failures must be a positive integer"),
    invalid_provider_limit_exit_code: invalidProviderLimitResult.exit_code,
    invalid_provider_limit_has_stable_error:
      invalidProviderLimitResult.stderr.includes("error: invalid_provider_max_inflight:")
      && invalidProviderLimitResult.stderr.includes("provider-max-inflight must be a positive integer"),
    ...runtimeControlsFooter(combinedOutput, hasStartBannerMarker),
  };
}

export function runStartInvalidProviderEnvControlsRejectFlow(context) {
  const {
    commonArgs,
    hasStartBannerMarker,
    repoRoot,
    runCommand,
  } = createRuntimeControlArgs(context);
  const invalidEnvProviderBurstResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_PROVIDER_BURST: "NaN",
    },
  );
  const combinedOutput = outputText(invalidEnvProviderBurstResult);
  return {
    invalid_env_provider_burst_exit_code: invalidEnvProviderBurstResult.exit_code,
    invalid_env_provider_burst_has_stable_error:
      invalidEnvProviderBurstResult.stderr.includes("error: invalid_provider_burst:")
      && invalidEnvProviderBurstResult.stderr.includes("provider-burst must be a positive integer"),
    ...runtimeControlsFooter(combinedOutput, hasStartBannerMarker),
  };
}

export function runStartInvalidMaintenanceEnvControlsRejectFlow(context) {
  const memoryMaintenanceControls = runStartInvalidMemoryMaintenanceEnvControlsRejectFlow(context);
  const contextWindowControls = runStartInvalidContextWindowEnvControlsRejectFlow(context);
  const askUserTtlControls = runStartInvalidAskUserTtlEnvControlsRejectFlow(context);
  return {
    ...memoryMaintenanceControls,
    ...contextWindowControls,
    ...askUserTtlControls,
    hides_top_level_fatal:
      memoryMaintenanceControls.hides_top_level_fatal
      && contextWindowControls.hides_top_level_fatal
      && askUserTtlControls.hides_top_level_fatal,
    has_start_banner:
      memoryMaintenanceControls.has_start_banner
      || contextWindowControls.has_start_banner
      || askUserTtlControls.has_start_banner,
  };
}

export function runStartInvalidMemoryMaintenanceEnvControlsRejectFlow(context) {
  const {
    commonArgs,
    hasStartBannerMarker,
    repoRoot,
    runCommand,
  } = createRuntimeControlArgs(context);
  const invalidEnvMemoryMaintenanceEnabledResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_MEMORY_MAINTENANCE_ENABLED: "maybe",
    },
  );
  const invalidEnvMemoryMaintenanceIntervalResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_MEMORY_MAINTENANCE_INTERVAL_MS: "14999",
    },
  );
  const combinedOutput = outputText(
    invalidEnvMemoryMaintenanceEnabledResult,
    invalidEnvMemoryMaintenanceIntervalResult,
  );
  return {
    invalid_env_memory_maintenance_enabled_exit_code: invalidEnvMemoryMaintenanceEnabledResult.exit_code,
    invalid_env_memory_maintenance_enabled_has_stable_error:
      invalidEnvMemoryMaintenanceEnabledResult.stderr.includes("error: invalid_memory_maintenance_enabled:")
      && invalidEnvMemoryMaintenanceEnabledResult.stderr.includes("memory-maintenance-enabled must be one of:"),
    invalid_env_memory_maintenance_interval_exit_code: invalidEnvMemoryMaintenanceIntervalResult.exit_code,
    invalid_env_memory_maintenance_interval_has_stable_error:
      invalidEnvMemoryMaintenanceIntervalResult.stderr.includes("error: invalid_memory_maintenance_interval_ms:")
      && invalidEnvMemoryMaintenanceIntervalResult.stderr.includes("memory-maintenance-interval-ms must be an integer between 15000 and 86400000"),
    ...runtimeControlsFooter(combinedOutput, hasStartBannerMarker),
  };
}

export function runStartInvalidContextWindowEnvControlsRejectFlow(context) {
  const {
    commonArgs,
    hasStartBannerMarker,
    repoRoot,
    runCommand,
  } = createRuntimeControlArgs(context);
  const invalidEnvContextGraphWindowResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_CONTEXT_GRAPH_CACHE_WINDOW_SIZE: "201",
    },
  );
  const combinedOutput = outputText(invalidEnvContextGraphWindowResult);
  return {
    invalid_env_context_graph_window_exit_code: invalidEnvContextGraphWindowResult.exit_code,
    invalid_env_context_graph_window_has_stable_error:
      invalidEnvContextGraphWindowResult.stderr.includes("error: invalid_context_graph_cache_window_size:")
      && invalidEnvContextGraphWindowResult.stderr.includes("context-graph-cache-window-size must be an integer between 1 and 200"),
    ...runtimeControlsFooter(combinedOutput, hasStartBannerMarker),
  };
}

export function runStartInvalidAskUserTtlEnvControlsRejectFlow(context) {
  const {
    commonArgs,
    hasStartBannerMarker,
    repoRoot,
    runCommand,
  } = createRuntimeControlArgs(context);
  const invalidEnvAskUserPendingTtlResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_ASK_USER_PENDING_TTL_MINUTES: "1abc",
    },
  );
  const combinedOutput = outputText(invalidEnvAskUserPendingTtlResult);
  return {
    invalid_env_ask_user_pending_ttl_exit_code: invalidEnvAskUserPendingTtlResult.exit_code,
    invalid_env_ask_user_pending_ttl_has_stable_error:
      invalidEnvAskUserPendingTtlResult.stderr.includes("error: invalid_ask_user_pending_ttl_minutes:")
      && invalidEnvAskUserPendingTtlResult.stderr.includes("ask-user-pending-ttl-minutes must be an integer between 1 and 10080"),
    ...runtimeControlsFooter(combinedOutput, hasStartBannerMarker),
  };
}
