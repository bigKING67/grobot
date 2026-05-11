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
