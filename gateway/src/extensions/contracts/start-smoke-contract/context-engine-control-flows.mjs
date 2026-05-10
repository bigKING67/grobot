import { mkdirSync, writeFileSync } from "node:fs";

function writeContextEngineProjectToml(workDir, lines) {
  const grobotDir = `${workDir}/.grobot`;
  mkdirSync(grobotDir, { recursive: true });
  writeFileSync(
    `${grobotDir}/project.toml`,
    [
      "schema_version = 1",
      'mode = "mvp"',
      "",
      "[context_engine]",
      ...lines,
      "",
    ].join("\n"),
    "utf8",
  );
}

function parseStatusJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function createContextEngineControlFlow(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
    hasStartBannerMarker,
  } = context;

  const makeStartCase = (suffix, options = {}) => {
    const workDir = createTempDir(`grobot-start-invalid-context-engine-${suffix}`);
    if (Array.isArray(options.projectTomlLines)) {
      writeContextEngineProjectToml(workDir, options.projectTomlLines);
    }
    const config = writeConfig(buildSmokeConfig(workDir));
    return runCommand(
      repoRoot,
      [
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
        `start-invalid-context-engine-${suffix}-user`,
        "--message",
        "invalid context engine config should not reach runtime",
      ],
      options.env,
    );
  };

  const makeStatusCase = (suffix, options = {}) => {
    const workDir = createTempDir(`grobot-status-invalid-context-engine-${suffix}`);
    if (Array.isArray(options.projectTomlLines)) {
      writeContextEngineProjectToml(workDir, options.projectTomlLines);
    }
    const config = writeConfig(buildSmokeConfig(workDir));
    return runCommand(
      repoRoot,
      [
        "./grobot",
        "status",
        "--json",
        "--project",
        "grobot",
        "--work-dir",
        workDir,
        "--project-root",
        repoRoot,
        "--config",
        config.configPath,
        "--gateway-impl",
        "ts",
        "--runtime-impl",
        "rust",
        "--session-subject",
        `status-invalid-context-engine-${suffix}-user`,
      ],
      options.env,
    );
  };

  return {
    makeStartCase,
    makeStatusCase,
    hasStartBannerMarker,
  };
}

export function runStartInvalidContextEngineEnvControlsRejectFlow(context) {
  const { makeStartCase, hasStartBannerMarker } = createContextEngineControlFlow(context);
  const invalidEnvWindowSyntaxResult = makeStartCase(
    "env-window-syntax",
    { env: { GROBOT_CONTEXT_ENGINE_WINDOW: "123abc" } },
  );
  const invalidEnvWindowRangeResult = makeStartCase(
    "env-window-range",
    { env: { GROBOT_CONTEXT_ENGINE_WINDOW: "0" } },
  );
  const invalidEnvRatioResult = makeStartCase(
    "env-ratio",
    { env: { GROBOT_CONTEXT_ENGINE_PROACTIVE_RATIO: "1.2" } },
  );
  const invalidEnvBooleanResult = makeStartCase(
    "env-boolean",
    { env: { GROBOT_CONTEXT_ENGINE_SEMANTIC_PREFETCH_ENABLED: "maybe" } },
  );
  const invalidTomlNumberResult = makeStartCase(
    "toml-number",
    { projectTomlLines: ['reserved_output_tokens = "bad"'] },
  );
  const invalidTomlRangeResult = makeStartCase(
    "toml-range",
    { projectTomlLines: ["hard_ratio = 2"] },
  );
  const invalidTomlEnumResult = makeStartCase(
    "toml-enum",
    { projectTomlLines: ['profile = "fast"'] },
  );
  const invalidAdaptiveAllowlistResult = makeStartCase(
    "adaptive-allowlist",
    {
      env: {
        GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST: "harden,sideways",
      },
    },
  );
  const combinedOutput = [
    invalidEnvWindowSyntaxResult.stdout,
    invalidEnvWindowSyntaxResult.stderr,
    invalidEnvWindowRangeResult.stdout,
    invalidEnvWindowRangeResult.stderr,
    invalidEnvRatioResult.stdout,
    invalidEnvRatioResult.stderr,
    invalidEnvBooleanResult.stdout,
    invalidEnvBooleanResult.stderr,
    invalidAdaptiveAllowlistResult.stdout,
    invalidAdaptiveAllowlistResult.stderr,
  ].join("\n");
  return {
    invalid_env_window_syntax_exit_code: invalidEnvWindowSyntaxResult.exit_code,
    invalid_env_window_syntax_has_stable_error:
      invalidEnvWindowSyntaxResult.stderr.includes("error: invalid_context_engine_window:")
      && invalidEnvWindowSyntaxResult.stderr.includes("context-engine-window must be a number")
      && invalidEnvWindowSyntaxResult.stderr.includes("source=env:GROBOT_CONTEXT_ENGINE_WINDOW"),
    invalid_env_window_range_exit_code: invalidEnvWindowRangeResult.exit_code,
    invalid_env_window_range_has_stable_error:
      invalidEnvWindowRangeResult.stderr.includes("error: invalid_context_engine_window:")
      && invalidEnvWindowRangeResult.stderr.includes("context-engine-window must be an integer between 1024 and 2000000"),
    invalid_env_ratio_exit_code: invalidEnvRatioResult.exit_code,
    invalid_env_ratio_has_stable_error:
      invalidEnvRatioResult.stderr.includes("error: invalid_context_engine_proactive_ratio:")
      && invalidEnvRatioResult.stderr.includes("context-engine-proactive-ratio must be a number between 0.5 and 0.995"),
    invalid_env_boolean_exit_code: invalidEnvBooleanResult.exit_code,
    invalid_env_boolean_has_stable_error:
      invalidEnvBooleanResult.stderr.includes("error: invalid_context_engine_semantic_prefetch_enabled:")
      && invalidEnvBooleanResult.stderr.includes("context-engine-semantic-prefetch-enabled must be boolean"),
    invalid_adaptive_allowlist_exit_code: invalidAdaptiveAllowlistResult.exit_code,
    invalid_adaptive_allowlist_has_stable_error:
      invalidAdaptiveAllowlistResult.stderr.includes("error: invalid_context_engine_prompt_quality_guard_adaptive_mode_allowlist:")
      && invalidAdaptiveAllowlistResult.stderr.includes("context-engine-prompt-quality-guard-adaptive-mode-allowlist must include only harden or relax"),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    has_start_banner: hasStartBannerMarker(combinedOutput),
  };
}

export function runStartInvalidContextEngineTomlControlsRejectFlow(context) {
  const { makeStartCase, hasStartBannerMarker } = createContextEngineControlFlow(context);
  const invalidTomlNumberResult = makeStartCase(
    "toml-number",
    { projectTomlLines: ['reserved_output_tokens = "bad"'] },
  );
  const invalidTomlRangeResult = makeStartCase(
    "toml-range",
    { projectTomlLines: ["hard_ratio = 2"] },
  );
  const invalidTomlEnumResult = makeStartCase(
    "toml-enum",
    { projectTomlLines: ['profile = "fast"'] },
  );
  const invalidThresholdOrderResult = makeStartCase(
    "threshold-order",
    {
      projectTomlLines: [
        "proactive_ratio = 0.90",
        "forced_ratio = 0.89",
        "hard_ratio = 0.95",
      ],
    },
  );
  const invalidEffectiveWindowResult = makeStartCase(
    "effective-window",
    {
      projectTomlLines: [
        "context_window_tokens = 2048",
        "reserved_output_tokens = 1024",
        "safety_margin_tokens = 1024",
      ],
    },
  );
  const invalidAutoCompactLimitResult = makeStartCase(
    "auto-compact-limit",
    {
      projectTomlLines: [
        "context_window_tokens = 2048",
        "reserved_output_tokens = 1",
        "safety_margin_tokens = 1",
        "auto_compact_token_limit = 2048",
      ],
    },
  );
  const combinedOutput = [
    invalidTomlNumberResult.stdout,
    invalidTomlNumberResult.stderr,
    invalidTomlRangeResult.stdout,
    invalidTomlRangeResult.stderr,
    invalidTomlEnumResult.stdout,
    invalidTomlEnumResult.stderr,
    invalidThresholdOrderResult.stdout,
    invalidThresholdOrderResult.stderr,
    invalidEffectiveWindowResult.stdout,
    invalidEffectiveWindowResult.stderr,
    invalidAutoCompactLimitResult.stdout,
    invalidAutoCompactLimitResult.stderr,
  ].join("\n");
  return {
    invalid_toml_number_exit_code: invalidTomlNumberResult.exit_code,
    invalid_toml_number_has_stable_error:
      invalidTomlNumberResult.stderr.includes("error: invalid_context_engine_reserved_output_tokens:")
      && invalidTomlNumberResult.stderr.includes("context-engine-reserved-output-tokens must be a number")
      && invalidTomlNumberResult.stderr.includes("source=project_toml"),
    invalid_toml_range_exit_code: invalidTomlRangeResult.exit_code,
    invalid_toml_range_has_stable_error:
      invalidTomlRangeResult.stderr.includes("error: invalid_context_engine_hard_ratio:")
      && invalidTomlRangeResult.stderr.includes("context-engine-hard-ratio must be a number between 0.5 and 0.995"),
    invalid_toml_enum_exit_code: invalidTomlEnumResult.exit_code,
    invalid_toml_enum_has_stable_error:
      invalidTomlEnumResult.stderr.includes("error: invalid_context_engine_profile:")
      && invalidTomlEnumResult.stderr.includes("context-engine-profile must be balanced, aggressive, or conservative"),
    invalid_threshold_order_exit_code: invalidThresholdOrderResult.exit_code,
    invalid_threshold_order_has_stable_error:
      invalidThresholdOrderResult.stderr.includes("error: invalid_context_engine_forced_ratio:")
      && invalidThresholdOrderResult.stderr.includes("context-engine-forced-ratio must be greater than context-engine-proactive-ratio"),
    invalid_effective_window_exit_code: invalidEffectiveWindowResult.exit_code,
    invalid_effective_window_has_stable_error:
      invalidEffectiveWindowResult.stderr.includes("error: invalid_context_engine_effective_window:")
      && invalidEffectiveWindowResult.stderr.includes("context-engine-effective-window must be at least 1024"),
    invalid_auto_compact_limit_exit_code: invalidAutoCompactLimitResult.exit_code,
    invalid_auto_compact_limit_has_stable_error:
      invalidAutoCompactLimitResult.stderr.includes("error: invalid_context_engine_auto_compact_token_limit:")
      && invalidAutoCompactLimitResult.stderr.includes("context-engine-auto-compact-token-limit must be less than or equal to effective context window"),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    has_start_banner: hasStartBannerMarker(combinedOutput),
  };
}

export function runStatusInvalidContextEngineControlsRejectFlow(context) {
  const {
    hasStartBannerMarker,
    makeStatusCase,
  } = createContextEngineControlFlow(context);
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
  } = context;
  const statusInvalidRatioResult = makeStatusCase(
    "env-ratio",
    { env: { GROBOT_CONTEXT_ENGINE_PROACTIVE_RATIO: "2" } },
  );
  const statusInvalidRatioJson = parseStatusJson(statusInvalidRatioResult.stdout);
  const statusTextWorkDir = createTempDir("grobot-status-invalid-context-engine-text");
  const statusTextConfig = writeConfig(buildSmokeConfig(statusTextWorkDir));
  const statusTextInvalidBooleanResult = runCommand(
    repoRoot,
    [
      "./grobot",
      "status",
      "--project",
      "grobot",
      "--work-dir",
      statusTextWorkDir,
      "--project-root",
      repoRoot,
      "--config",
      statusTextConfig.configPath,
      "--gateway-impl",
      "ts",
      "--runtime-impl",
      "rust",
    ],
    { GROBOT_CONTEXT_ENGINE_SEMANTIC_PREFETCH_ENABLED: "maybe" },
  );
  const combinedOutput = [
    statusInvalidRatioResult.stdout,
    statusInvalidRatioResult.stderr,
    statusTextInvalidBooleanResult.stdout,
    statusTextInvalidBooleanResult.stderr,
  ].join("\n");
  return {
    status_json_invalid_ratio_exit_code: statusInvalidRatioResult.exit_code,
    status_json_invalid_ratio_has_stable_error:
      statusInvalidRatioJson?.status === "error"
      && statusInvalidRatioJson?.error === "invalid_context_engine_proactive_ratio"
      && statusInvalidRatioJson?.field === "context-engine-proactive-ratio"
      && String(statusInvalidRatioJson?.detail).includes("between 0.5 and 0.995")
      && String(statusInvalidRatioJson?.detail).includes("source=env:GROBOT_CONTEXT_ENGINE_PROACTIVE_RATIO"),
    status_text_invalid_boolean_exit_code: statusTextInvalidBooleanResult.exit_code,
    status_text_invalid_boolean_has_stable_error:
      statusTextInvalidBooleanResult.stderr.includes("error: invalid_context_engine_semantic_prefetch_enabled:")
      && statusTextInvalidBooleanResult.stderr.includes("context-engine-semantic-prefetch-enabled must be boolean"),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    has_start_banner: hasStartBannerMarker(combinedOutput),
  };
}

export function runStartContextEngineValidBoundaryFlow(context) {
  const { makeStartCase } = createContextEngineControlFlow(context);
  const validBoundaryResult = makeStartCase(
    "valid-boundary",
    {
      env: {
        GROBOT_CONTEXT_ENGINE_ENABLED: "yes",
        GROBOT_CONTEXT_ENGINE_WINDOW: "1026",
        GROBOT_CONTEXT_ENGINE_RESERVED_OUTPUT_TOKENS: "1",
        GROBOT_CONTEXT_ENGINE_SAFETY_MARGIN_TOKENS: "1",
        GROBOT_CONTEXT_ENGINE_AUTO_COMPACT_TOKEN_LIMIT: "1",
        GROBOT_CONTEXT_ENGINE_PROACTIVE_RATIO: "0.5",
        GROBOT_CONTEXT_ENGINE_FORCED_RATIO: "0.51",
        GROBOT_CONTEXT_ENGINE_HARD_RATIO: "0.995",
        GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_HOLD_TURNS: "0",
        GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_MAX_FLOOR_STAGE: "minimal",
        GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST: "harden,relax",
      },
    },
  );
  return {
    valid_boundary_exit_code: validBoundaryResult.exit_code,
    valid_boundary_reached_runtime:
      validBoundaryResult.stderr.includes("Turn failed")
      || validBoundaryResult.stderr.includes("Upstream connection failed"),
  };
}

export function runStartInvalidContextEngineControlsRejectFlow(context) {
  const envControls = runStartInvalidContextEngineEnvControlsRejectFlow(context);
  const tomlControls = runStartInvalidContextEngineTomlControlsRejectFlow(context);
  const statusControls = runStatusInvalidContextEngineControlsRejectFlow(context);
  return {
    ...envControls,
    ...tomlControls,
    ...statusControls,
    ...runStartContextEngineValidBoundaryFlow(context),
    hides_top_level_fatal:
      envControls.hides_top_level_fatal
      && tomlControls.hides_top_level_fatal
      && statusControls.hides_top_level_fatal,
    has_start_banner:
      envControls.has_start_banner
      || tomlControls.has_start_banner
      || statusControls.has_start_banner,
  };
}
