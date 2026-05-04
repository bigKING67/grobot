export function runPackageLauncherRejectsPython(context) {
  const { repoRoot, runCommand } = context;
  return runCommand(repoRoot, ["./packages/cli/bin/grobot", "status", "--gateway-impl=python"]);
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
