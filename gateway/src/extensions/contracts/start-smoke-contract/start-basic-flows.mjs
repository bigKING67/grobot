import { mkdirSync, writeFileSync } from "node:fs";

export function runPackageLauncherRejectsPython(context) {
  const { repoRoot, runCommand } = context;
  const pythonGatewayResult = runCommand(repoRoot, [
    "./packages/cli/bin/grobot",
    "status",
    "--gateway-impl=python",
  ]);
  const emptyGatewayResult = runCommand(repoRoot, [
    "./packages/cli/bin/grobot",
    "status",
    "--gateway-impl=",
  ]);
  const missingGatewayResult = runCommand(repoRoot, [
    "./packages/cli/bin/grobot",
    "status",
    "--gateway-impl",
  ]);
  const emptyRuntimeResult = runCommand(repoRoot, [
    "./packages/cli/bin/grobot",
    "status",
    "--runtime-impl",
    "",
  ]);
  const missingRuntimeResult = runCommand(repoRoot, [
    "./packages/cli/bin/grobot",
    "status",
    "--runtime-impl",
  ]);
  const combinedOutput = [
    pythonGatewayResult.stderr,
    emptyGatewayResult.stderr,
    missingGatewayResult.stderr,
    emptyRuntimeResult.stderr,
    missingRuntimeResult.stderr,
  ].join("\n");
  return {
    ...pythonGatewayResult,
    python_gateway_exit_code: pythonGatewayResult.exit_code,
    empty_gateway_exit_code: emptyGatewayResult.exit_code,
    missing_gateway_exit_code: missingGatewayResult.exit_code,
    empty_runtime_exit_code: emptyRuntimeResult.exit_code,
    missing_runtime_exit_code: missingRuntimeResult.exit_code,
    malformed_impl_errors_are_stable:
      emptyGatewayResult.stderr.includes("invalid --gateway-impl value: <empty>")
      && missingGatewayResult.stderr.includes("invalid --gateway-impl value: <missing>")
      && emptyRuntimeResult.stderr.includes("invalid --runtime-impl value: <empty>")
      && missingRuntimeResult.stderr.includes("invalid --runtime-impl value: <missing>"),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
  };
}

export function runStartMessageSmoke(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
  } = context;
  const workDir = createTempDir("grobot-start-work");
  const config = writeConfig(buildSmokeConfig(workDir));
  return runCommand(repoRoot, [
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
    "start-message-smoke-user",
    "--no-shadow-mode",
    "--message",
    "ts rust execution smoke",
  ]);
}

export function runStartInvalidNamespaceRejectFlow(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
    hasStartBannerMarker,
  } = context;
  const workDir = createTempDir("grobot-start-invalid-namespace-work");
  const config = writeConfig(buildSmokeConfig(workDir));
  const invalidTenantResult = runCommand(repoRoot, [
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
    "--tenant",
    "bad:tenant",
    "--session-subject",
    "start-invalid-namespace-user",
    "--message",
    "invalid namespace should not reach runtime",
  ]);
  const invalidScopeResult = runCommand(repoRoot, [
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
    "--session-scope",
    "room",
    "--session-subject",
    "start-invalid-namespace-user",
    "--message",
    "invalid namespace should not reach runtime",
  ]);
  const emptySubjectResult = runCommand(repoRoot, [
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
    "",
    "--message",
    "invalid namespace should not reach runtime",
  ]);
  const emptyProjectResult = runCommand(repoRoot, [
    "./grobot",
    "start",
    "--project",
    "",
    "--work-dir",
    workDir,
    "--config",
    config.configPath,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
    "--session-subject",
    "start-invalid-project-user",
    "--message",
    "invalid project should not reach runtime",
  ]);
  const combinedOutput = [
    invalidTenantResult.stdout,
    invalidTenantResult.stderr,
    invalidScopeResult.stdout,
    invalidScopeResult.stderr,
    emptySubjectResult.stdout,
    emptySubjectResult.stderr,
    emptyProjectResult.stdout,
    emptyProjectResult.stderr,
  ].join("\n");
  return {
    invalid_tenant_exit_code: invalidTenantResult.exit_code,
    invalid_tenant_has_stable_error:
      invalidTenantResult.stderr.includes("error: invalid_session_tenant:")
      && invalidTenantResult.stderr.includes("tenant must not contain ':'"),
    invalid_scope_exit_code: invalidScopeResult.exit_code,
    invalid_scope_has_stable_error:
      invalidScopeResult.stderr.includes("error: invalid_session_scope:")
      && invalidScopeResult.stderr.includes("session-scope must be one of: dm, group"),
    empty_subject_exit_code: emptySubjectResult.exit_code,
    empty_subject_has_stable_error:
      emptySubjectResult.stderr.includes("error: invalid_session_subject:")
      && emptySubjectResult.stderr.includes("session-subject must be non-empty"),
    empty_project_exit_code: emptyProjectResult.exit_code,
    empty_project_has_stable_error:
      emptyProjectResult.stderr.includes("error: invalid_project:")
      && emptyProjectResult.stderr.includes("project must be a non-empty string"),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    has_start_banner: hasStartBannerMarker(combinedOutput),
  };
}

export function runStartInvalidRuntimeControlsRejectFlow(context) {
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
  const invalidEnvProviderBurstResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_PROVIDER_BURST: "NaN",
    },
  );
  const combinedOutput = [
    invalidTimeoutResult.stdout,
    invalidTimeoutResult.stderr,
    missingTimeoutResult.stdout,
    missingTimeoutResult.stderr,
    invalidCircuitFailuresResult.stdout,
    invalidCircuitFailuresResult.stderr,
    invalidProviderLimitResult.stdout,
    invalidProviderLimitResult.stderr,
    invalidEnvProviderBurstResult.stdout,
    invalidEnvProviderBurstResult.stderr,
  ].join("\n");
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
    invalid_env_provider_burst_exit_code: invalidEnvProviderBurstResult.exit_code,
    invalid_env_provider_burst_has_stable_error:
      invalidEnvProviderBurstResult.stderr.includes("error: invalid_provider_burst:")
      && invalidEnvProviderBurstResult.stderr.includes("provider-burst must be a positive integer"),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    has_start_banner: hasStartBannerMarker(combinedOutput),
  };
}

export function runStartInvalidStorageControlsRejectFlow(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
    hasStartBannerMarker,
  } = context;
  const workDir = createTempDir("grobot-start-invalid-storage-controls-work");
  const config = writeConfig(buildSmokeConfig(workDir));
  const makeProjectTomlCase = (suffix, projectTomlLines) => {
    const caseWorkDir = createTempDir(`grobot-start-invalid-storage-controls-${suffix}`);
    const grobotDir = `${caseWorkDir}/.grobot`;
    mkdirSync(grobotDir, { recursive: true });
    writeFileSync(
      `${grobotDir}/project.toml`,
      [
        "schema_version = 1",
        'mode = "mvp"',
        "",
        "[runtime.storage]",
        ...projectTomlLines,
        "",
      ].join("\n"),
      "utf8",
    );
    const caseConfig = writeConfig(buildSmokeConfig(caseWorkDir));
    return runCommand(repoRoot, [
      "./grobot",
      "start",
      "--project",
      "grobot",
      "--work-dir",
      caseWorkDir,
      "--config",
      caseConfig.configPath,
      "--gateway-impl",
      "ts",
      "--runtime-impl",
      "rust",
      "--session-subject",
      `start-invalid-storage-controls-${suffix}-user`,
      "--message",
      "invalid storage project config should not reach runtime",
    ]);
  };
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
    "start-invalid-storage-controls-user",
    "--message",
    "invalid storage controls should not reach runtime",
  ];
  const invalidBackendResult = runCommand(repoRoot, [
    ...commonArgs,
    "--session-store",
    "postgres",
  ]);
  const missingBackendResult = runCommand(repoRoot, [
    ...commonArgs,
    "--session-store",
  ]);
  const invalidRedisFallbackResult = runCommand(repoRoot, [
    ...commonArgs,
    "--session-store",
    "redis",
    "--allow-redis-fallback",
    "maybe",
  ]);
  const invalidRedisUrlResult = runCommand(repoRoot, [
    ...commonArgs,
    "--session-store",
    "redis",
    "--redis-url",
    "http://127.0.0.1:6379",
  ]);
  const invalidEnvBackendResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_SESSION_STORE: "sqlite",
    },
  );
  const invalidProjectHotCacheTrailingResult = makeProjectTomlCase(
    "hot-cache-trailing",
    ['hot_cache = "redis" trailing'],
  );
  const invalidProjectRequireRedisTrailingResult = makeProjectTomlCase(
    "require-redis-trailing",
    ["require_redis = true trailing"],
  );
  const combinedOutput = [
    invalidBackendResult.stdout,
    invalidBackendResult.stderr,
    missingBackendResult.stdout,
    missingBackendResult.stderr,
    invalidRedisFallbackResult.stdout,
    invalidRedisFallbackResult.stderr,
    invalidRedisUrlResult.stdout,
    invalidRedisUrlResult.stderr,
    invalidEnvBackendResult.stdout,
    invalidEnvBackendResult.stderr,
    invalidProjectHotCacheTrailingResult.stdout,
    invalidProjectHotCacheTrailingResult.stderr,
    invalidProjectRequireRedisTrailingResult.stdout,
    invalidProjectRequireRedisTrailingResult.stderr,
  ].join("\n");
  return {
    invalid_backend_exit_code: invalidBackendResult.exit_code,
    invalid_backend_has_stable_error:
      invalidBackendResult.stderr.includes("error: invalid_session_store:")
      && invalidBackendResult.stderr.includes("session-store must be file, redis, or auto"),
    missing_backend_exit_code: missingBackendResult.exit_code,
    missing_backend_has_stable_error:
      missingBackendResult.stderr.includes("error: invalid_session_store:")
      && missingBackendResult.stderr.includes("session-store must not be empty"),
    invalid_redis_fallback_exit_code: invalidRedisFallbackResult.exit_code,
    invalid_redis_fallback_has_stable_error:
      invalidRedisFallbackResult.stderr.includes("error: invalid_allow_redis_fallback:")
      && invalidRedisFallbackResult.stderr.includes("allow-redis-fallback must be boolean"),
    invalid_redis_url_exit_code: invalidRedisUrlResult.exit_code,
    invalid_redis_url_has_stable_error:
      invalidRedisUrlResult.stderr.includes("error: invalid_redis_url:")
      && invalidRedisUrlResult.stderr.includes("redis-url must be a redis:// or rediss:// URL"),
    invalid_env_backend_exit_code: invalidEnvBackendResult.exit_code,
    invalid_env_backend_has_stable_error:
      invalidEnvBackendResult.stderr.includes("error: invalid_session_store:")
      && invalidEnvBackendResult.stderr.includes("session-store must be file, redis, or auto"),
    invalid_project_hot_cache_trailing_exit_code: invalidProjectHotCacheTrailingResult.exit_code,
    invalid_project_hot_cache_trailing_has_stable_error:
      invalidProjectHotCacheTrailingResult.stderr.includes("error: invalid_memory_store_backend:")
      && invalidProjectHotCacheTrailingResult.stderr.includes("memory-store-backend must be file, redis, or auto"),
    invalid_project_require_redis_trailing_exit_code: invalidProjectRequireRedisTrailingResult.exit_code,
    invalid_project_require_redis_trailing_has_stable_error:
      invalidProjectRequireRedisTrailingResult.stderr.includes("error: invalid_require_redis:")
      && invalidProjectRequireRedisTrailingResult.stderr.includes("require-redis must be boolean"),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    has_start_banner: hasStartBannerMarker(combinedOutput),
  };
}

export function runStartInvalidSessionControlsRejectFlow(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
    hasStartBannerMarker,
  } = context;
  const workDir = createTempDir("grobot-start-invalid-session-controls-work");
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
    "start-invalid-session-controls-user",
    "--message",
    "invalid session controls should not reach runtime",
  ];
  const invalidHistoryResult = runCommand(repoRoot, [
    ...commonArgs,
    "--history-turns",
    "bad",
  ]);
  const overHistoryResult = runCommand(repoRoot, [
    ...commonArgs,
    "--history-turns",
    "65",
  ]);
  const missingHandoffRecentResult = runCommand(repoRoot, [
    ...commonArgs,
    "--handoff-recent-turns",
  ]);
  const zeroHandoffRecentResult = runCommand(repoRoot, [
    ...commonArgs,
    "--handoff-recent-turns",
    "0",
  ]);
  const invalidRewindModeResult = runCommand(repoRoot, [
    ...commonArgs,
    "--rewind-mode",
    "history",
  ]);
  const missingRewindModeResult = runCommand(repoRoot, [
    ...commonArgs,
    "--rewind-mode",
  ]);
  const invalidEnvHandoffResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_HANDOFF_AUTO_ON_EXIT: "maybe",
    },
  );
  const combinedOutput = [
    invalidHistoryResult.stdout,
    invalidHistoryResult.stderr,
    overHistoryResult.stdout,
    overHistoryResult.stderr,
    missingHandoffRecentResult.stdout,
    missingHandoffRecentResult.stderr,
    zeroHandoffRecentResult.stdout,
    zeroHandoffRecentResult.stderr,
    invalidRewindModeResult.stdout,
    invalidRewindModeResult.stderr,
    missingRewindModeResult.stdout,
    missingRewindModeResult.stderr,
    invalidEnvHandoffResult.stdout,
    invalidEnvHandoffResult.stderr,
  ].join("\n");
  return {
    invalid_history_exit_code: invalidHistoryResult.exit_code,
    invalid_history_has_stable_error:
      invalidHistoryResult.stderr.includes("error: invalid_history_turns:")
      && invalidHistoryResult.stderr.includes("history-turns must be an integer between 1 and 64"),
    over_history_exit_code: overHistoryResult.exit_code,
    over_history_has_stable_error:
      overHistoryResult.stderr.includes("error: invalid_history_turns:")
      && overHistoryResult.stderr.includes("history-turns must be an integer between 1 and 64"),
    missing_handoff_recent_exit_code: missingHandoffRecentResult.exit_code,
    missing_handoff_recent_has_stable_error:
      missingHandoffRecentResult.stderr.includes("error: invalid_handoff_recent_turns:")
      && missingHandoffRecentResult.stderr.includes("handoff-recent-turns must be an integer between 1 and 20"),
    zero_handoff_recent_exit_code: zeroHandoffRecentResult.exit_code,
    zero_handoff_recent_has_stable_error:
      zeroHandoffRecentResult.stderr.includes("error: invalid_handoff_recent_turns:")
      && zeroHandoffRecentResult.stderr.includes("handoff-recent-turns must be an integer between 1 and 20"),
    invalid_rewind_mode_exit_code: invalidRewindModeResult.exit_code,
    invalid_rewind_mode_has_stable_error:
      invalidRewindModeResult.stderr.includes("error: invalid_rewind_mode:")
      && invalidRewindModeResult.stderr.includes("rewind-mode must be both, conversation, code, or summarize"),
    missing_rewind_mode_exit_code: missingRewindModeResult.exit_code,
    missing_rewind_mode_has_stable_error:
      missingRewindModeResult.stderr.includes("error: invalid_rewind_mode:")
      && missingRewindModeResult.stderr.includes("rewind-mode must be both, conversation, code, or summarize"),
    invalid_env_handoff_exit_code: invalidEnvHandoffResult.exit_code,
    invalid_env_handoff_has_stable_error:
      invalidEnvHandoffResult.stderr.includes("error: invalid_handoff_auto_on_exit:")
      && invalidEnvHandoffResult.stderr.includes("handoff-auto-on-exit must be boolean"),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    has_start_banner: hasStartBannerMarker(combinedOutput),
  };
}

export function runStartInvalidExperienceControlsRejectFlow(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
    hasStartBannerMarker,
  } = context;
  const workDir = createTempDir("grobot-start-invalid-experience-controls-work");
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
    "start-invalid-experience-controls-user",
    "--message",
    "invalid experience controls should not reach runtime",
  ];
  const invalidPublishModeResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_EXPERIENCE_PUBLISH_MODE: "always",
    },
  );
  const invalidRecallLimitResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_EXPERIENCE_RECALL_LIMIT: "many",
    },
  );
  const overRecallLimitResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_EXPERIENCE_RECALL_LIMIT: "7",
    },
  );
  const zeroRecallLimitResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_EXPERIENCE_RECALL_LIMIT: "0",
    },
  );
  const combinedOutput = [
    invalidPublishModeResult.stdout,
    invalidPublishModeResult.stderr,
    invalidRecallLimitResult.stdout,
    invalidRecallLimitResult.stderr,
    overRecallLimitResult.stdout,
    overRecallLimitResult.stderr,
    zeroRecallLimitResult.stdout,
    zeroRecallLimitResult.stderr,
  ].join("\n");
  return {
    invalid_publish_mode_exit_code: invalidPublishModeResult.exit_code,
    invalid_publish_mode_has_stable_error:
      invalidPublishModeResult.stderr.includes("error: invalid_experience_publish_mode:")
      && invalidPublishModeResult.stderr.includes("experience-publish-mode must be auto or off"),
    invalid_recall_limit_exit_code: invalidRecallLimitResult.exit_code,
    invalid_recall_limit_has_stable_error:
      invalidRecallLimitResult.stderr.includes("error: invalid_experience_recall_limit:")
      && invalidRecallLimitResult.stderr.includes("experience-recall-limit must be an integer between 1 and 6"),
    over_recall_limit_exit_code: overRecallLimitResult.exit_code,
    over_recall_limit_has_stable_error:
      overRecallLimitResult.stderr.includes("error: invalid_experience_recall_limit:")
      && overRecallLimitResult.stderr.includes("experience-recall-limit must be an integer between 1 and 6"),
    zero_recall_limit_exit_code: zeroRecallLimitResult.exit_code,
    zero_recall_limit_has_stable_error:
      zeroRecallLimitResult.stderr.includes("error: invalid_experience_recall_limit:")
      && zeroRecallLimitResult.stderr.includes("experience-recall-limit must be an integer between 1 and 6"),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    has_start_banner: hasStartBannerMarker(combinedOutput),
  };
}

export function runStartMessageProviderConfigTsRust(
  context,
  providerBaseUrl,
  providerApiKey,
  providerModel,
) {
  const {
    repoRoot,
    createTempDir,
    buildSingleProviderConfig,
    writeConfig,
    runCommand,
  } = context;
  const workDir = createTempDir("grobot-start-work");
  const config = writeConfig(
    buildSingleProviderConfig(workDir, {
      name: "runtime-provider",
      baseUrl: providerBaseUrl,
      apiKey: providerApiKey,
      model: providerModel,
    }),
  );
  return runCommand(repoRoot, [
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
    "provider-config-smoke-user",
    "--no-shadow-mode",
    "--message",
    "provider config passthrough smoke",
  ]);
}

export function runStartImOnlyRejectFlow(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
    hasStartBannerMarker,
  } = context;
  const workDir = createTempDir("grobot-start-im-only-work");
  const config = writeConfig(buildSmokeConfig(workDir));
  const commandResult = runCommand(repoRoot, [
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
    "--message",
    "start im-only guard should reject local no-context invocation",
  ]);
  const outputText = `${commandResult.stdout}\n${commandResult.stderr}`;
  return {
    ...commandResult,
    has_im_only_error: outputText.includes("`grobot start` is IM-only"),
    has_im_only_hint_context: outputText.includes(
      "pass one of --platform/--tenant/--session-scope/--session-subject",
    ),
    has_im_only_hint_bare: outputText.includes("run `grobot` (no subcommand)"),
    has_start_banner: hasStartBannerMarker(outputText),
  };
}
