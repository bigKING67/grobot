export function runFailoverRejectsPython(context) {
  const {
    repoRoot,
    createTempDir,
    buildFailoverConfig,
    writeConfig,
    runCommand,
  } = context;
  const workDir = createTempDir("grobot-start-work");
  const config = writeConfig(buildFailoverConfig(workDir));
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
    "python",
    "--runtime-impl",
    "python",
    "--session-subject",
    "failover-reject-user",
    "--message",
    "legacy path should be rejected",
  ]);
}

export function runFailoverTsRust(context) {
  const {
    repoRoot,
    createTempDir,
    buildFailoverConfig,
    writeConfig,
    runCommand,
  } = context;
  const workDir = createTempDir("grobot-start-work");
  const config = writeConfig(buildFailoverConfig(workDir));
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
    "failover-ts-rust-user",
    "--no-shadow-mode",
    "--provider",
    "failing",
    "--message",
    "ts rust hard-cut",
  ]);
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : {};
}

function providerRuntimeStatesFromStatus(parsedStatus) {
  const routeDecision = asRecord(parsedStatus?.route_decision);
  const routeObserved = asRecord(routeDecision.observed);
  return Array.isArray(routeObserved.provider_runtime_states)
    ? routeObserved.provider_runtime_states
    : [];
}

function providerRuntimeStatesFromRegistry(registryPayload) {
  const sessions = Array.isArray(registryPayload?.sessions) ? registryPayload.sessions : [];
  const activeId = typeof registryPayload?.active_id === "string" ? registryPayload.active_id : "main";
  const activeSession = sessions.find((session) => asRecord(session).id === activeId) ?? sessions[0];
  const activeRecord = asRecord(activeSession);
  return Array.isArray(activeRecord.provider_runtime_states)
    ? activeRecord.provider_runtime_states
    : [];
}

function findProviderState(states, providerName) {
  return asRecord(states.find((state) => asRecord(state).provider_name === providerName));
}

export function runProviderFailureRouteStatusTsRust(context) {
  const {
    repoRoot,
    createTempDir,
    buildFailoverConfig,
    writeConfig,
    runCommand,
    parseJsonObjectSafe,
    readJsonFileSafe,
    sanitizeSessionKey,
  } = context;
  const workDir = createTempDir("grobot-provider-failure-status-work");
  const config = writeConfig(buildFailoverConfig(workDir));
  const sessionSubject = "provider-failure-status-user";
  const sessionNamespaceKey = `feishu:grobot:dm:${sessionSubject}`;
  const registryPath = `${workDir}/.grobot/sessions/${sanitizeSessionKey(sessionNamespaceKey)}.sessions.json`;
  const baseArgs = [
    "--project",
    "grobot",
    "--project-root",
    workDir,
    "--work-dir",
    workDir,
    "--config",
    config.configPath,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
    "--session-subject",
    sessionSubject,
  ];
  const startResult = runCommand(
    repoRoot,
    [
      "./grobot",
      "start",
      ...baseArgs,
      "--no-shadow-mode",
      "--provider",
      "failing",
      "--no-handoff-auto-on-exit",
      "--message",
      "provider failure should persist structured route diagnostics",
    ],
    {
      GROBOT_RUNTIME_HTTP_TIMEOUT_MS: "1200",
    },
  );
  const statusArgs = [
    "./grobot",
    "status",
    ...baseArgs,
  ];
  const statusJsonResult = runCommand(repoRoot, [...statusArgs, "--json"]);
  const statusLegacyTextResult = runCommand(repoRoot, statusArgs, {
    GROBOT_STATUS_LEGACY_TEXT: "1",
  });
  const statusDefaultTextResult = runCommand(repoRoot, statusArgs);
  const parsedStatus = parseJsonObjectSafe(statusJsonResult.stdout);
  const statusStates = providerRuntimeStatesFromStatus(parsedStatus);
  const failingStatusState = findProviderState(statusStates, "failing");
  const successStatusState = findProviderState(statusStates, "success");
  const failingStatusErrorData = asRecord(failingStatusState.last_error_data);
  const registryPayload = readJsonFileSafe(registryPath);
  const registryStates = providerRuntimeStatesFromRegistry(registryPayload);
  const failingRegistryState = findProviderState(registryStates, "failing");
  const failingRegistryErrorData = asRecord(failingRegistryState.last_error_data);
  const failingAttempt = Number(failingStatusErrorData.attempt);
  const failingMaxAttempts = Number(failingStatusErrorData.max_attempts);
  return {
    exit_code: startResult.exit_code,
    status_exit_code: statusJsonResult.exit_code,
    legacy_text_exit_code: statusLegacyTextResult.exit_code,
    default_text_exit_code: statusDefaultTextResult.exit_code,
    status_json_parse_ok: Boolean(parsedStatus),
    registry_path: registryPath,
    registry_exists: Boolean(registryPayload),
    status_provider_state_count: statusStates.length,
    registry_provider_state_count: registryStates.length,
    start_stderr_has_human_failure:
      startResult.stderr.includes("Turn failed")
      && startResult.stderr.includes("Upstream connection failed"),
    start_stderr_hides_raw_error_class:
      !startResult.stderr.includes("upstream_connect_failed")
      && !startResult.stderr.includes("runtime rpc error -32001"),
    status_has_failing_state: Object.keys(failingStatusState).length > 0,
    status_has_success_state: Object.keys(successStatusState).length > 0,
    status_failing_last_error_class: failingStatusState.last_error_class ?? null,
    status_failing_last_error_diagnostic: failingStatusErrorData.diagnostic_kind ?? null,
    status_failing_last_error_source: failingStatusErrorData.source ?? null,
    status_failing_last_error_stage: failingStatusErrorData.stage ?? null,
    status_failing_last_error_retryable: failingStatusErrorData.retryable ?? null,
    status_failing_last_error_attempt: Number.isFinite(failingAttempt) ? failingAttempt : null,
    status_failing_last_error_max_attempts:
      Number.isFinite(failingMaxAttempts) ? failingMaxAttempts : null,
    status_failing_attempts_exhausted:
      Number.isFinite(failingAttempt)
      && Number.isFinite(failingMaxAttempts)
      && failingAttempt >= failingMaxAttempts,
    status_failing_redacts_body_preview:
      !Object.prototype.hasOwnProperty.call(failingStatusErrorData, "body_preview"),
    status_failing_redacts_response_headers:
      !Object.prototype.hasOwnProperty.call(failingStatusErrorData, "response_headers"),
    registry_has_failing_last_error_data:
      Object.keys(failingRegistryErrorData).length > 0,
    registry_failing_last_error_diagnostic:
      failingRegistryErrorData.diagnostic_kind ?? null,
    legacy_text_has_route_provider_errors:
      statusLegacyTextResult.stdout.includes("route_provider_errors: failing:upstream_connect_failed")
      && statusLegacyTextResult.stdout.includes("diagnostic=upstream_connect_failed")
      && statusLegacyTextResult.stdout.includes("retryable=false"),
    default_text_has_last_provider_error:
      statusDefaultTextResult.stdout.includes("last provider error failing:upstream connect failed")
      && statusDefaultTextResult.stdout.includes("retryable false"),
  };
}

export function runProviderPoolMultiTurnTsRust(context, providerBaseUrl, providerCount, turnCount) {
  const {
    repoRoot,
    createTempDir,
    buildProviderPoolConfig,
    writeConfig,
    runCommand,
  } = context;
  const workDir = createTempDir("grobot-start-work");
  const homeDir = createTempDir("grobot-start-home");
  const normalizedProviderCount = Number.isFinite(providerCount) ? Math.max(1, Math.floor(providerCount)) : 10;
  const normalizedTurnCount = Number.isFinite(turnCount) ? Math.max(1, Math.floor(turnCount)) : 6;
  const config = writeConfig(
    buildProviderPoolConfig(workDir, providerBaseUrl, normalizedProviderCount),
  );
  const lines = [];
  for (let index = 1; index <= normalizedTurnCount; index += 1) {
    lines.push(`pool-turn-${String(index)}`);
  }
  lines.push("/health");
  lines.push("/exit");
  lines.push("");
  return runCommand(
    repoRoot,
    [
      "./grobot",
      "start",
      "--project",
      "grobot",
      "--project-root",
      workDir,
      "--work-dir",
      workDir,
      "--home",
      homeDir,
      "--config",
      config.configPath,
      "--gateway-impl",
      "ts",
      "--runtime-impl",
      "rust",
      "--session-subject",
      "provider-pool-user",
      "--history-turns",
      "12",
    ],
    null,
    lines.join("\n"),
  );
}

export function runStartSessionStoreRedisFallback(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
    readJsonFileSafe,
    sanitizeSessionKey,
  } = context;
  const workDir = createTempDir("grobot-start-work");
  const homeDir = createTempDir("grobot-start-home");
  const config = writeConfig(buildSmokeConfig(workDir));
  const sessionKey = "feishu:grobot:dm:redis-fallback-user";
  const historyPath = `${workDir}/.grobot/sessions/${sanitizeSessionKey(sessionKey)}.history.json`;
  const result = runCommand(repoRoot, [
    "./grobot",
    "start",
    "--project",
    "grobot",
    "--work-dir",
    workDir,
    "--home",
    homeDir,
    "--config",
    config.configPath,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
    "--session-subject",
    "redis-fallback-user",
    "--session-backend",
    "redis",
    "--redis-url",
    "redis://127.0.0.1:6399/0",
    "--message",
    "session store redis fallback smoke",
  ]);
  const historyPayload = readJsonFileSafe(historyPath);
  return {
    ...result,
    history_path: historyPath,
    history_exists: Boolean(historyPayload),
    history_message_count:
      historyPayload && Array.isArray(historyPayload.messages) ? historyPayload.messages.length : 0,
  };
}
