import { mkdirSync, writeFileSync } from "node:fs";

function outputText(...results) {
  return results.flatMap((result) => [result.stdout, result.stderr]).join("\n");
}

function footer(combinedOutput, hasStartBannerMarker) {
  return {
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    has_start_banner: hasStartBannerMarker(combinedOutput),
  };
}

function createStartControlArgs(context, prefix, subject, message) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
    hasStartBannerMarker,
  } = context;
  const workDir = createTempDir(prefix);
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
    subject,
    "--message",
    message,
  ];
  return {
    commonArgs,
    hasStartBannerMarker,
    repoRoot,
    runCommand,
    workDir,
  };
}

export function runStartInvalidStorageControlsRejectFlow(context) {
  const cliControls = runStartInvalidStorageCliControlsRejectFlow(context);
  const envControls = runStartInvalidStorageEnvControlsRejectFlow(context);
  const tomlControls = runStartInvalidStorageTomlControlsRejectFlow(context);
  return {
    ...cliControls,
    ...envControls,
    ...tomlControls,
    hides_top_level_fatal:
      cliControls.hides_top_level_fatal
      && envControls.hides_top_level_fatal
      && tomlControls.hides_top_level_fatal,
    has_start_banner:
      cliControls.has_start_banner
      || envControls.has_start_banner
      || tomlControls.has_start_banner,
  };
}

function createStorageControlArgs(context) {
  return createStartControlArgs(
    context,
    "grobot-start-invalid-storage-controls-work",
    "start-invalid-storage-controls-user",
    "invalid storage controls should not reach runtime",
  );
}

export function runStartInvalidStorageCliControlsRejectFlow(context) {
  const {
    commonArgs,
    hasStartBannerMarker,
    repoRoot,
    runCommand,
  } = createStorageControlArgs(context);
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
  const combinedOutput = outputText(
    invalidBackendResult,
    missingBackendResult,
    invalidRedisFallbackResult,
    invalidRedisUrlResult,
  );
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
    ...footer(combinedOutput, hasStartBannerMarker),
  };
}

export function runStartInvalidStorageEnvControlsRejectFlow(context) {
  const {
    commonArgs,
    hasStartBannerMarker,
    repoRoot,
    runCommand,
  } = createStorageControlArgs(context);
  const invalidEnvBackendResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_SESSION_STORE: "sqlite",
    },
  );
  const combinedOutput = outputText(invalidEnvBackendResult);
  return {
    invalid_env_backend_exit_code: invalidEnvBackendResult.exit_code,
    invalid_env_backend_has_stable_error:
      invalidEnvBackendResult.stderr.includes("error: invalid_session_store:")
      && invalidEnvBackendResult.stderr.includes("session-store must be file, redis, or auto"),
    ...footer(combinedOutput, hasStartBannerMarker),
  };
}

export function runStartInvalidStorageTomlControlsRejectFlow(context) {
  const {
    buildSmokeConfig,
    createTempDir,
    hasStartBannerMarker,
    repoRoot,
    runCommand,
    writeConfig,
  } = context;
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
  const invalidProjectHotCacheTrailingResult = makeProjectTomlCase(
    "hot-cache-trailing",
    ['hot_cache = "redis" trailing'],
  );
  const invalidProjectRequireRedisTrailingResult = makeProjectTomlCase(
    "require-redis-trailing",
    ["require_redis = true trailing"],
  );
  const combinedOutput = outputText(
    invalidProjectHotCacheTrailingResult,
    invalidProjectRequireRedisTrailingResult,
  );
  return {
    invalid_project_hot_cache_trailing_exit_code: invalidProjectHotCacheTrailingResult.exit_code,
    invalid_project_hot_cache_trailing_has_stable_error:
      invalidProjectHotCacheTrailingResult.stderr.includes("error: invalid_memory_store_backend:")
      && invalidProjectHotCacheTrailingResult.stderr.includes("memory-store-backend must be file, redis, or auto"),
    invalid_project_require_redis_trailing_exit_code: invalidProjectRequireRedisTrailingResult.exit_code,
    invalid_project_require_redis_trailing_has_stable_error:
      invalidProjectRequireRedisTrailingResult.stderr.includes("error: invalid_require_redis:")
      && invalidProjectRequireRedisTrailingResult.stderr.includes("require-redis must be boolean"),
    ...footer(combinedOutput, hasStartBannerMarker),
  };
}

export function runStartInvalidSessionControlsRejectFlow(context) {
  const historyControls = runStartInvalidSessionHistoryControlsRejectFlow(context);
  const rewindControls = runStartInvalidSessionRewindControlsRejectFlow(context);
  const handoffEnvControls = runStartInvalidSessionHandoffEnvControlsRejectFlow(context);
  return {
    ...historyControls,
    ...rewindControls,
    ...handoffEnvControls,
    hides_top_level_fatal:
      historyControls.hides_top_level_fatal
      && rewindControls.hides_top_level_fatal
      && handoffEnvControls.hides_top_level_fatal,
    has_start_banner:
      historyControls.has_start_banner
      || rewindControls.has_start_banner
      || handoffEnvControls.has_start_banner,
  };
}

function createSessionControlArgs(context) {
  return createStartControlArgs(
    context,
    "grobot-start-invalid-session-controls-work",
    "start-invalid-session-controls-user",
    "invalid session controls should not reach runtime",
  );
}

export function runStartInvalidSessionHistoryControlsRejectFlow(context) {
  const {
    commonArgs,
    hasStartBannerMarker,
    repoRoot,
    runCommand,
  } = createSessionControlArgs(context);
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
  const combinedOutput = outputText(
    invalidHistoryResult,
    overHistoryResult,
    missingHandoffRecentResult,
    zeroHandoffRecentResult,
  );
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
    ...footer(combinedOutput, hasStartBannerMarker),
  };
}

export function runStartInvalidSessionRewindControlsRejectFlow(context) {
  const {
    commonArgs,
    hasStartBannerMarker,
    repoRoot,
    runCommand,
  } = createSessionControlArgs(context);
  const invalidRewindModeResult = runCommand(repoRoot, [
    ...commonArgs,
    "--rewind-mode",
    "history",
  ]);
  const missingRewindModeResult = runCommand(repoRoot, [
    ...commonArgs,
    "--rewind-mode",
  ]);
  const combinedOutput = outputText(invalidRewindModeResult, missingRewindModeResult);
  return {
    invalid_rewind_mode_exit_code: invalidRewindModeResult.exit_code,
    invalid_rewind_mode_has_stable_error:
      invalidRewindModeResult.stderr.includes("error: invalid_rewind_mode:")
      && invalidRewindModeResult.stderr.includes("rewind-mode must be both, conversation, code, or summarize"),
    missing_rewind_mode_exit_code: missingRewindModeResult.exit_code,
    missing_rewind_mode_has_stable_error:
      missingRewindModeResult.stderr.includes("error: invalid_rewind_mode:")
      && missingRewindModeResult.stderr.includes("rewind-mode must be both, conversation, code, or summarize"),
    ...footer(combinedOutput, hasStartBannerMarker),
  };
}

export function runStartInvalidSessionHandoffEnvControlsRejectFlow(context) {
  const {
    commonArgs,
    hasStartBannerMarker,
    repoRoot,
    runCommand,
  } = createSessionControlArgs(context);
  const invalidEnvHandoffResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_HANDOFF_AUTO_ON_EXIT: "maybe",
    },
  );
  const emptyEnvHandoffResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_HANDOFF_AUTO_ON_EXIT: "   ",
    },
  );
  const combinedOutput = outputText(invalidEnvHandoffResult, emptyEnvHandoffResult);
  return {
    invalid_env_handoff_exit_code: invalidEnvHandoffResult.exit_code,
    invalid_env_handoff_has_stable_error:
      invalidEnvHandoffResult.stderr.includes("error: invalid_handoff_auto_on_exit:")
      && invalidEnvHandoffResult.stderr.includes("handoff-auto-on-exit must be boolean"),
    empty_env_handoff_exit_code: emptyEnvHandoffResult.exit_code,
    empty_env_handoff_has_stable_error:
      emptyEnvHandoffResult.stderr.includes("error: invalid_handoff_auto_on_exit:")
      && emptyEnvHandoffResult.stderr.includes("handoff-auto-on-exit must be boolean"),
    ...footer(combinedOutput, hasStartBannerMarker),
  };
}

export function runStartInvalidExperienceControlsRejectFlow(context) {
  const publishControls = runStartInvalidExperiencePublishControlsRejectFlow(context);
  const recallControls = runStartInvalidExperienceRecallControlsRejectFlow(context);
  return {
    ...publishControls,
    ...recallControls,
    hides_top_level_fatal:
      publishControls.hides_top_level_fatal
      && recallControls.hides_top_level_fatal,
    has_start_banner:
      publishControls.has_start_banner
      || recallControls.has_start_banner,
  };
}

function createExperienceControlArgs(context) {
  return createStartControlArgs(
    context,
    "grobot-start-invalid-experience-controls-work",
    "start-invalid-experience-controls-user",
    "invalid experience controls should not reach runtime",
  );
}

export function runStartInvalidExperiencePublishControlsRejectFlow(context) {
  const {
    commonArgs,
    hasStartBannerMarker,
    repoRoot,
    runCommand,
  } = createExperienceControlArgs(context);
  const invalidPublishModeResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_EXPERIENCE_PUBLISH_MODE: "always",
    },
  );
  const combinedOutput = outputText(invalidPublishModeResult);
  return {
    invalid_publish_mode_exit_code: invalidPublishModeResult.exit_code,
    invalid_publish_mode_has_stable_error:
      invalidPublishModeResult.stderr.includes("error: invalid_experience_publish_mode:")
      && invalidPublishModeResult.stderr.includes("experience-publish-mode must be auto or off"),
    ...footer(combinedOutput, hasStartBannerMarker),
  };
}

export function runStartInvalidExperienceRecallControlsRejectFlow(context) {
  const {
    commonArgs,
    hasStartBannerMarker,
    repoRoot,
    runCommand,
  } = createExperienceControlArgs(context);
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
  const combinedOutput = outputText(
    invalidRecallLimitResult,
    overRecallLimitResult,
    zeroRecallLimitResult,
  );
  return {
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
    ...footer(combinedOutput, hasStartBannerMarker),
  };
}
