export function runStartInvalidMemoryStrategyProfileControlsRejectFlow(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
    hasStartBannerMarker,
  } = context;
  const workDir = createTempDir("grobot-start-invalid-memory-strategy-profile-work");
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
    "start-invalid-memory-strategy-profile-user",
    "--message",
    "invalid memory strategy profile should not reach runtime",
  ];
  const invalidProfileResult = runCommand(repoRoot, commonArgs, {
    GROBOT_MEMORY_STRATEGY_PROFILE: "chaos",
  });
  const emptyProfileResult = runCommand(repoRoot, commonArgs, {
    GROBOT_MEMORY_STRATEGY_PROFILE: "   ",
  });
  const combinedOutput = [
    invalidProfileResult.stdout,
    invalidProfileResult.stderr,
    emptyProfileResult.stdout,
    emptyProfileResult.stderr,
  ].join("\n");
  const expectedMessage =
    "memory-strategy-profile must be one of: general, debug_heavy, delivery, docs";
  return {
    invalid_profile_exit_code: invalidProfileResult.exit_code,
    invalid_profile_has_stable_error:
      invalidProfileResult.stderr.includes("error: invalid_memory_strategy_profile:")
      && invalidProfileResult.stderr.includes(expectedMessage),
    empty_profile_exit_code: emptyProfileResult.exit_code,
    empty_profile_has_stable_error:
      emptyProfileResult.stderr.includes("error: invalid_memory_strategy_profile:")
      && emptyProfileResult.stderr.includes(expectedMessage),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    has_start_banner: hasStartBannerMarker(combinedOutput),
  };
}
