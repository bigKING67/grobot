import { mkdirSync, writeFileSync } from "node:fs";

function writeToolsProjectToml(workDir, lines) {
  const grobotDir = `${workDir}/.grobot`;
  mkdirSync(grobotDir, { recursive: true });
  writeFileSync(
    `${grobotDir}/project.toml`,
    [
      "schema_version = 1",
      'mode = "mvp"',
      "",
      "[tools]",
      ...lines,
      "",
    ].join("\n"),
    "utf8",
  );
}

export function runStartInvalidToolLoopControlsRejectFlow(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
    hasStartBannerMarker,
  } = context;
  const workDir = createTempDir("grobot-start-invalid-tool-loop-controls-work");
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
    "start-invalid-tool-loop-controls-user",
    "--message",
    "invalid tool loop controls should not reach runtime",
  ];
  const makeToolsAllowCase = (suffix, projectTomlLines) => {
    const caseWorkDir = createTempDir(`grobot-start-invalid-tools-allow-${suffix}`);
    writeToolsProjectToml(caseWorkDir, projectTomlLines);
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
      `start-invalid-tools-allow-${suffix}-user`,
      "--message",
      "invalid tools allow config should not reach runtime",
    ]);
  };
  const invalidMaxToolRoundsResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_MAX_TOOL_ROUNDS: "many",
    },
  );
  const overMaxToolRoundsResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_MAX_TOOL_ROUNDS: "33",
    },
  );
  const invalidFallbackModeResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_NO_TOOL_FALLBACK_MODE: "loose",
    },
  );
  const overRecoveryRoundsResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_MAX_RECOVERY_ROUNDS: "9",
    },
  );
  const negativeRecoveryRoundsResult = runCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_MAX_RECOVERY_ROUNDS: "-1",
    },
  );
  const invalidToolsAllowScalarResult = makeToolsAllowCase(
    "scalar",
    ['allow = "bash"'],
  );
  const invalidToolsAllowMixedResult = makeToolsAllowCase(
    "mixed",
    ['allow = ["bash", 3]'],
  );
  const invalidToolsAllowEmptyResult = makeToolsAllowCase(
    "empty",
    ["allow = []"],
  );
  const invalidToolsAllowEmptyEntryResult = makeToolsAllowCase(
    "empty-entry",
    ['allow = ["bash", ""]'],
  );
  const invalidToolsAllowDuplicateResult = makeToolsAllowCase(
    "duplicate",
    ['allow = ["bash", "bash"]'],
  );
  const validToolsAllowResult = makeToolsAllowCase(
    "valid-boundary",
    ['allow = ["bash", "rg"]'],
  );
  const combinedOutput = [
    invalidMaxToolRoundsResult.stdout,
    invalidMaxToolRoundsResult.stderr,
    overMaxToolRoundsResult.stdout,
    overMaxToolRoundsResult.stderr,
    invalidFallbackModeResult.stdout,
    invalidFallbackModeResult.stderr,
    overRecoveryRoundsResult.stdout,
    overRecoveryRoundsResult.stderr,
    negativeRecoveryRoundsResult.stdout,
    negativeRecoveryRoundsResult.stderr,
    invalidToolsAllowScalarResult.stdout,
    invalidToolsAllowScalarResult.stderr,
    invalidToolsAllowMixedResult.stdout,
    invalidToolsAllowMixedResult.stderr,
    invalidToolsAllowEmptyResult.stdout,
    invalidToolsAllowEmptyResult.stderr,
    invalidToolsAllowEmptyEntryResult.stdout,
    invalidToolsAllowEmptyEntryResult.stderr,
    invalidToolsAllowDuplicateResult.stdout,
    invalidToolsAllowDuplicateResult.stderr,
  ].join("\n");
  const hasToolsAllowShapeError = (result) =>
    result.stderr.includes("error: invalid_runtime_tools_allow:")
    && result.stderr.includes("runtime-tools-allow must be a non-empty array of non-empty strings")
    && result.stderr.includes("source=project_toml");
  return {
    invalid_max_tool_rounds_exit_code: invalidMaxToolRoundsResult.exit_code,
    invalid_max_tool_rounds_has_stable_error:
      invalidMaxToolRoundsResult.stderr.includes("error: invalid_max_tool_rounds:")
      && invalidMaxToolRoundsResult.stderr.includes("max-tool-rounds must be an integer between 1 and 32"),
    over_max_tool_rounds_exit_code: overMaxToolRoundsResult.exit_code,
    over_max_tool_rounds_has_stable_error:
      overMaxToolRoundsResult.stderr.includes("error: invalid_max_tool_rounds:")
      && overMaxToolRoundsResult.stderr.includes("max-tool-rounds must be an integer between 1 and 32"),
    invalid_fallback_mode_exit_code: invalidFallbackModeResult.exit_code,
    invalid_fallback_mode_has_stable_error:
      invalidFallbackModeResult.stderr.includes("error: invalid_no_tool_fallback_mode:")
      && invalidFallbackModeResult.stderr.includes("no-tool-fallback-mode must be off, safe, or strict"),
    over_recovery_rounds_exit_code: overRecoveryRoundsResult.exit_code,
    over_recovery_rounds_has_stable_error:
      overRecoveryRoundsResult.stderr.includes("error: invalid_max_recovery_rounds:")
      && overRecoveryRoundsResult.stderr.includes("max-recovery-rounds must be an integer between 0 and 8"),
    negative_recovery_rounds_exit_code: negativeRecoveryRoundsResult.exit_code,
    negative_recovery_rounds_has_stable_error:
      negativeRecoveryRoundsResult.stderr.includes("error: invalid_max_recovery_rounds:")
      && negativeRecoveryRoundsResult.stderr.includes("max-recovery-rounds must be an integer between 0 and 8"),
    invalid_tools_allow_scalar_exit_code: invalidToolsAllowScalarResult.exit_code,
    invalid_tools_allow_scalar_has_stable_error:
      hasToolsAllowShapeError(invalidToolsAllowScalarResult),
    invalid_tools_allow_mixed_exit_code: invalidToolsAllowMixedResult.exit_code,
    invalid_tools_allow_mixed_has_stable_error:
      hasToolsAllowShapeError(invalidToolsAllowMixedResult),
    invalid_tools_allow_empty_exit_code: invalidToolsAllowEmptyResult.exit_code,
    invalid_tools_allow_empty_has_stable_error:
      hasToolsAllowShapeError(invalidToolsAllowEmptyResult),
    invalid_tools_allow_empty_entry_exit_code: invalidToolsAllowEmptyEntryResult.exit_code,
    invalid_tools_allow_empty_entry_has_stable_error:
      hasToolsAllowShapeError(invalidToolsAllowEmptyEntryResult),
    invalid_tools_allow_duplicate_exit_code: invalidToolsAllowDuplicateResult.exit_code,
    invalid_tools_allow_duplicate_has_stable_error:
      invalidToolsAllowDuplicateResult.stderr.includes("error: invalid_runtime_tools_allow:")
      && invalidToolsAllowDuplicateResult.stderr.includes("runtime-tools-allow values must be unique")
      && invalidToolsAllowDuplicateResult.stderr.includes("source=project_toml"),
    valid_tools_allow_exit_code: validToolsAllowResult.exit_code,
    valid_tools_allow_reached_runtime:
      validToolsAllowResult.stderr.includes("Turn failed")
      || validToolsAllowResult.stderr.includes("Upstream connection failed"),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    has_start_banner: hasStartBannerMarker(combinedOutput),
  };
}

export function runStatusInvalidToolsAllowControlsRejectFlow(context) {
  const {
    repoRoot,
    createTempDir,
    runCommand,
    parseJsonObjectSafe,
  } = context;
  const workDir = createTempDir("grobot-status-invalid-tools-allow-work");
  writeToolsProjectToml(workDir, ['allow = ["bash", 3]']);
  const jsonResult = runCommand(repoRoot, [
    "./grobot",
    "status",
    "--json",
    "--work-dir",
    workDir,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
  ]);
  const jsonPayload = parseJsonObjectSafe(jsonResult.stdout);
  const textWorkDir = createTempDir("grobot-status-invalid-tools-allow-text");
  writeToolsProjectToml(textWorkDir, ['allow = ["bash", "bash"]']);
  const textResult = runCommand(repoRoot, [
    "./grobot",
    "status",
    "--work-dir",
    textWorkDir,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
  ]);
  const combinedOutput = [
    jsonResult.stdout,
    jsonResult.stderr,
    textResult.stdout,
    textResult.stderr,
  ].join("\n");
  return {
    invalid_tools_allow_json_exit_code: jsonResult.exit_code,
    invalid_tools_allow_json_error: jsonPayload?.error ?? null,
    invalid_tools_allow_json_field: jsonPayload?.field ?? null,
    invalid_tools_allow_json_detail:
      typeof jsonPayload?.detail === "string" ? jsonPayload.detail : null,
    invalid_tools_allow_text_exit_code: textResult.exit_code,
    invalid_tools_allow_text_has_stable_error:
      textResult.stderr.includes("error: invalid_runtime_tools_allow:")
      && textResult.stderr.includes("runtime-tools-allow values must be unique")
      && textResult.stderr.includes("source=project_toml"),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
  };
}

export function runStartInvalidToolSurfaceProfileControlsRejectFlow(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
    parseJsonObjectSafe,
    hasStartBannerMarker,
  } = context;
  const workDir = createTempDir("grobot-invalid-tool-surface-profile-work");
  const config = writeConfig(buildSmokeConfig(workDir));
  const commonStartArgs = [
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
    "invalid-tool-surface-profile-user",
    "--message",
    "invalid tool surface profile should not reach runtime",
  ];
  const startInvalidProfile = runCommand(repoRoot, commonStartArgs, {
    GROBOT_TOOL_SURFACE_PROFILE: "everything",
  });
  const startEmptyProfile = runCommand(repoRoot, commonStartArgs, {
    GROBOT_TOOL_SURFACE_PROFILE: "   ",
  });
  const statusJsonInvalidProfile = runCommand(repoRoot, [
    "./grobot",
    "status",
    "--json",
    "--work-dir",
    workDir,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
  ], {
    GROBOT_TOOL_SURFACE_PROFILE: "everything",
  });
  const statusJsonPayload = parseJsonObjectSafe(statusJsonInvalidProfile.stdout);
  const statusTextEmptyProfile = runCommand(repoRoot, [
    "./grobot",
    "status",
    "--work-dir",
    workDir,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
  ], {
    GROBOT_TOOL_SURFACE_PROFILE: "",
  });
  const combinedOutput = [
    startInvalidProfile.stdout,
    startInvalidProfile.stderr,
    startEmptyProfile.stdout,
    startEmptyProfile.stderr,
    statusJsonInvalidProfile.stdout,
    statusJsonInvalidProfile.stderr,
    statusTextEmptyProfile.stdout,
    statusTextEmptyProfile.stderr,
  ].join("\n");
  const hasStableError = (result) =>
    result.stderr.includes("error: invalid_tool_surface_profile:")
    && result.stderr.includes("tool-surface-profile must be one of:");
  return {
    start_invalid_profile_exit_code: startInvalidProfile.exit_code,
    start_invalid_profile_has_stable_error: hasStableError(startInvalidProfile),
    start_empty_profile_exit_code: startEmptyProfile.exit_code,
    start_empty_profile_has_stable_error: hasStableError(startEmptyProfile),
    status_json_invalid_profile_exit_code: statusJsonInvalidProfile.exit_code,
    status_json_invalid_profile_error: statusJsonPayload?.error ?? null,
    status_json_invalid_profile_field: statusJsonPayload?.field ?? null,
    status_json_invalid_profile_detail:
      typeof statusJsonPayload?.detail === "string" ? statusJsonPayload.detail : null,
    status_text_empty_profile_exit_code: statusTextEmptyProfile.exit_code,
    status_text_empty_profile_has_stable_error: hasStableError(statusTextEmptyProfile),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    has_start_banner: hasStartBannerMarker(combinedOutput),
  };
}
