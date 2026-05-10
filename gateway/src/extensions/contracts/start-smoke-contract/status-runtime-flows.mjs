import { Buffer } from "node:buffer";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableJsonStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function fnv1a32HexFromUtf8(value) {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(value, "utf8")) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function buildRuntimeToolRecoveryCatalogFingerprint(catalog, policyVersion = "v1") {
  const payload = stableJsonStringify({
    policy_version: policyVersion,
    catalog,
  });
  return `recovery_catalog:${fnv1a32HexFromUtf8(payload)}`;
}

function writeFakeRuntimeToolsDescribe(context, payload) {
  const { createTempDir } = context;
  const runtimeDir = createTempDir("grobot-fake-runtime-tools-describe");
  const runtimePath = `${runtimeDir}/grobot-runtime`;
  const response = {
    jsonrpc: "2.0",
    id: "tools-describe-1",
    result: payload,
  };
  writeFileSync(
    runtimePath,
    [
      "#!/usr/bin/env node",
      "process.stdin.resume();",
      "process.stdin.on('end', () => {",
      `  process.stdout.write(${JSON.stringify(`${JSON.stringify(response)}\n`)});`,
      "});",
      "process.stdin.on('data', () => {});",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(runtimePath, 0o755);
  return runtimePath;
}

function buildInvalidSchemaProfileToolsDescribePayload() {
  const toolNames = ["glob", "search", "read", "write", "edit", "bash", "ask_user"];
  const recoveryCatalog = [
    {
      error_classes: ["config_missing"],
      risk_class: "missing_config",
      stage: "ask_user",
      recommended_next_action: "ask_user_for_config_or_switch_provider",
      recoverable: false,
    },
  ];
  return {
    tools: toolNames.map((name) => ({
      type: "function",
      function: {
        name,
        description: `fake ${name}`,
        parameters: { type: "object", properties: {} },
      },
    })),
    default_enabled_tools: toolNames,
    tool_recovery_policy_version: "v1",
    tool_recovery_catalog_fingerprint: buildRuntimeToolRecoveryCatalogFingerprint(recoveryCatalog),
    tool_recovery_actions: ["ask_user_for_config_or_switch_provider"],
    tool_recovery_catalog: recoveryCatalog,
    tool_surface_schema_profiles_fingerprint: "schema_profiles:invalid-test",
    tool_surface_schema_profiles: [
      {
        policy_version: "v1",
        profile: "coding",
        projection_mode: "slim",
        advanced_tool_schema: false,
        schema_fingerprint: "schema:v1:invalid-test",
        tool_names: ["read"],
        visible_tool_count: "1",
        schema_property_count: 1,
        full_schema_property_count: 1,
        suppressed_schema_property_count: 0,
        per_tool_property_count: { read: 1 },
        per_tool_visible_args: { read: ["path"] },
        per_tool_suppressed_args: { read: [] },
      },
    ],
  };
}

function stringArray(value) {
  return Array.isArray(value) ? value : [];
}

function runtimeToolsQualityFrom(parsedStatus, isObject) {
  return isObject(parsedStatus?.runtime_tools_quality)
    ? parsedStatus.runtime_tools_quality
    : null;
}

function runtimeQualityCommonFields(runtimeToolsQuality) {
  return {
    quality_status: runtimeToolsQuality?.status ?? null,
    quality_schema_version: runtimeToolsQuality?.quality_schema_version ?? null,
    quality_runtime_binary_exists: runtimeToolsQuality?.runtime_binary_exists ?? null,
    quality_runtime_health_ok: runtimeToolsQuality?.runtime_health_ok ?? null,
    quality_runtime_describe_source: runtimeToolsQuality?.runtime_describe_source ?? null,
    quality_schema_budget_status: runtimeToolsQuality?.schema_budget_status ?? null,
    quality_action_family: runtimeToolsQuality?.action_family ?? null,
    quality_action_reason: runtimeToolsQuality?.action_reason ?? null,
    quality_action_required: runtimeToolsQuality?.action_required ?? null,
    quality_actionable_next_step_has_runtime_status:
      String(runtimeToolsQuality?.actionable_next_step ?? "").includes("grobot status --json"),
  };
}

function parseRuntimeQualityStatus(context, jsonResult) {
  const { parseJsonObjectSafe, isObject } = context;
  const parsedStatus = parseJsonObjectSafe(jsonResult.stdout);
  const runtimeToolsQuality = runtimeToolsQualityFrom(parsedStatus, isObject);
  return {
    parsedStatus,
    runtimeToolsQuality,
    failureReasons: stringArray(runtimeToolsQuality?.failure_reasons),
    warningReasons: stringArray(runtimeToolsQuality?.warning_reasons),
  };
}

export function runStatusTsRustDeprecatedFlag(context) {
  const { repoRoot, createTempDir, writeExecutionProjectToml, runCommand } = context;
  const workDir = createTempDir("grobot-status-work");
  writeExecutionProjectToml(workDir);
  return runCommand(repoRoot, [
    "./grobot",
    "status",
    "--work-dir",
    workDir,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
    "--ts-dev-cli",
  ]);
}

export function runStatusTsRustMemoryLegacyFallback(context) {
  const {
    repoRoot,
    createTempDir,
    writeExecutionProjectToml,
    runCommand,
    parseJsonObjectSafe,
    isObject,
  } = context;
  const workDir = createTempDir("grobot-status-memory-legacy-fallback-work");
  writeExecutionProjectToml(workDir);
  const contextDir = `${workDir}/.grobot/context`;
  mkdirSync(contextDir, { recursive: true });
  const graphLegacyStatePath = `${contextDir}/graph-quality-autotune-state.json`;
  const promptGuardLegacyStatePath = `${contextDir}/prompt-quality-guard-state.json`;
  const graphLegacyState = {
    lastDirection: "downshift",
    holdTurnsRemaining: 7,
    downshiftWarmupStreak: 3,
    lastReason: "legacy_graph_state_seed",
    updatedAt: "2026-01-15T12:34:56.000Z",
    cacheDegradeQueryHitRateThreshold: 0.27,
    persistentDegradeParsedPerScannedMax: 0.31,
    persistentDegradeReusedPerScannedMin: 0.62,
    persistentDegradeRemovedPerScannedMax: 0.19,
    adaptiveLearnAlpha: 0.24,
    adaptiveUpdates: 9,
    adaptiveSource: "legacy_seed",
    adaptiveActionScale: 1.12,
    adaptiveActionUpdates: 5,
    adaptiveActionSource: "legacy_seed",
  };
  const promptGuardLegacyState = {
    floorStage: "forced",
    degradedStreak: 11,
    severeStreak: 2,
    healthyStreak: 0,
    holdTurnsRemaining: 4,
    lastReason: "legacy_prompt_guard_seed",
    updatedAt: "2026-01-16T08:09:10.000Z",
    pressureUtilizationThreshold: 0.91,
    pressureSemanticRateThreshold: 0.26,
    pressureAutoLimitRateThreshold: 0.34,
    pressureJointRateThreshold: 0.22,
    pressureTrendUtilizationDelta: 0.03,
    pressureTrendSemanticDelta: 0.02,
    pressureTrendAutoLimitDelta: 0.01,
    pressureTrendMomentum: 0.8,
    outcomeRequiredTransitions: 4,
    outcomeCombinedEvidenceScore: 0.55,
    outcomeHighEvidenceTurns: 6,
    outcomeHighEvidenceHardenTurns: 3,
    outcomeDriftRecentAutoActionLevels: ["none", "medium"],
  };
  writeFileSync(graphLegacyStatePath, `${JSON.stringify(graphLegacyState, null, 2)}\n`, "utf8");
  writeFileSync(
    promptGuardLegacyStatePath,
    `${JSON.stringify(promptGuardLegacyState, null, 2)}\n`,
    "utf8",
  );
  const result = runCommand(repoRoot, [
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
  const parsedStatus = parseJsonObjectSafe(result.stdout);
  const graphAutotuneState = isObject(parsedStatus?.context_graph_cache_stats?.autotune_state)
    ? parsedStatus.context_graph_cache_stats.autotune_state
    : null;
  const promptGuardState = isObject(parsedStatus?.context_engine?.prompt_quality_guard_state)
    ? parsedStatus.context_engine.prompt_quality_guard_state
    : null;
  return {
    ...result,
    status_json_parse_ok: Boolean(parsedStatus),
    graph_autotune_last_reason: graphAutotuneState?.last_reason ?? null,
    graph_autotune_hold_turns_remaining: graphAutotuneState?.hold_turns_remaining ?? null,
    graph_autotune_persistence_domain: graphAutotuneState?.persistence_domain ?? null,
    prompt_guard_floor_stage: promptGuardState?.floor_stage ?? null,
    prompt_guard_degraded_streak: promptGuardState?.degraded_streak ?? null,
    prompt_guard_last_reason: promptGuardState?.last_reason ?? null,
    prompt_guard_persistence_domain: promptGuardState?.persistence_domain ?? null,
    graph_legacy_state_path: graphLegacyStatePath,
    prompt_guard_legacy_state_path: promptGuardLegacyStatePath,
  };
}

export function runStatusRuntimeDescribeUnavailable(context) {
  const { repoRoot, createTempDir, writeExecutionProjectToml, runCommand } = context;
  const workDir = createTempDir("grobot-status-runtime-describe-unavailable-work");
  writeExecutionProjectToml(workDir);
  const missingRuntimePath = "/tmp/grobot-missing-runtime";
  const statusArgs = [
    "./grobot",
    "status",
    "--work-dir",
    workDir,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
  ];
  const result = runCommand(
    repoRoot,
    statusArgs,
    { GROBOT_RUNTIME_BIN: missingRuntimePath },
  );
  const jsonResult = runCommand(
    repoRoot,
    [...statusArgs, "--json"],
    { GROBOT_RUNTIME_BIN: missingRuntimePath },
  );
  const {
    parsedStatus,
    runtimeToolsQuality,
    failureReasons,
    warningReasons,
  } = parseRuntimeQualityStatus(context, jsonResult);
  const runtimeTools = isPlainObject(parsedStatus?.runtime_tools)
    ? parsedStatus.runtime_tools
    : null;
  const schemaProjection = isPlainObject(runtimeTools?.schema_projection)
    ? runtimeTools.schema_projection
    : null;
  const schemaDrift = isPlainObject(runtimeTools?.schema_projection_drift)
    ? runtimeTools.schema_projection_drift
    : null;
  const suppressedArgs = isPlainObject(schemaProjection?.per_tool_suppressed_args)
    ? schemaProjection.per_tool_suppressed_args
    : null;
  const suppressedArgCount = suppressedArgs
    ? Object.values(suppressedArgs)
        .reduce((count, value) => count + (Array.isArray(value) ? value.length : 0), 0)
    : 0;
  return {
    ...result,
    json_exit_code: jsonResult.exit_code,
    status_json_parse_ok: Boolean(parsedStatus),
    missing_runtime_path: missingRuntimePath,
    has_gateway_fallback_projection: schemaProjection?.source === "gateway.fallback",
    has_gateway_fallback_suppressed_none: suppressedArgCount === 0,
    has_gateway_fallback_drift_args_none:
      Array.isArray(schemaDrift?.arg_mismatch_details)
      && schemaDrift.arg_mismatch_details.length === 0,
    has_unavailable_suppressed_args: result.stdout.includes("runtime_tool_schema_suppressed_args"),
    has_unavailable_describe_reason:
      String(runtimeToolsQuality?.runtime_describe_detail ?? "")
        .includes("runtime_tools_describe_unavailable:spawn_failed"),
    ...runtimeQualityCommonFields(runtimeToolsQuality),
    quality_failure_has_runtime_binary_missing: failureReasons.includes("runtime_binary_missing"),
    quality_failure_has_runtime_health_failed: failureReasons.includes("runtime_health_failed"),
    quality_warning_has_describe_fallback: warningReasons.includes("runtime_tools_describe_fallback"),
    text_has_quality_fail:
      result.stdout.includes("Runtime needs check")
      && !result.stdout.includes("runtime_tool_quality: status=fail"),
  };
}

export function runStartRuntimeDescribeFallbackDiagnostic(context) {
  const {
    repoRoot,
    createTempDir,
    writeExecutionProjectToml,
    runCommand,
    writeConfig,
    buildSmokeConfig,
  } = context;
  const workDir = createTempDir("grobot-start-runtime-describe-fallback-work");
  const homeDir = createTempDir("grobot-start-runtime-describe-fallback-home");
  const config = writeConfig(buildSmokeConfig(workDir));
  writeExecutionProjectToml(workDir);
  const missingRuntimePath = "/tmp/grobot-missing-runtime";
  const result = runCommand(
    repoRoot,
    [
      "./grobot",
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
      "runtime-describe-fallback-user",
      "--history-turns",
      "2",
    ],
    {
      GROBOT_RUNTIME_BIN: missingRuntimePath,
      GROBOT_STARTUP_DIAGNOSTICS: "0",
      GROBOT_INTERACTIVE_DIAGNOSTICS: "0",
      GROBOT_ALLOW_TS_DEV_CLI: "1",
      GROBOT_ALLOW_REDIS_FALLBACK: "1",
    },
    ["/exit", ""].join("\n"),
  );
  return {
    ...result,
    missing_runtime_path: missingRuntimePath,
    has_runtime_tools_fallback_surface:
      result.stderr.includes("Runtime tool description unavailable")
      && result.stderr.includes("Started with built-in tool schema.")
      && result.stderr.includes("source start-default"),
    compact_avoids_tool_surface_event: !result.stderr.includes("[tool-surface] event=runtime_describe_fallback"),
    compact_avoids_enabled_tools_source_field: !result.stderr.includes("enabled_tools_source="),
    has_describe_reason: result.stderr.includes("runtime_tools_describe_unavailable:spawn_failed"),
    has_status_json_hint: result.stderr.includes("grobot status --json"),
    compact_avoids_fallback_manifest_field: !result.stderr.includes("manifest_fingerprint=fallback:"),
    compact_avoids_schema_profiles_field: !result.stderr.includes("schema_profiles_fingerprint=<none>"),
  };
}

export function runStatusRuntimeDescribeInvalidSchemaProfiles(context) {
  const { repoRoot, createTempDir, writeExecutionProjectToml, runCommand } = context;
  const workDir = createTempDir("grobot-status-runtime-describe-invalid-schema-work");
  writeExecutionProjectToml(workDir);
  const fakeRuntimePath = writeFakeRuntimeToolsDescribe(
    context,
    buildInvalidSchemaProfileToolsDescribePayload(),
  );
  const statusArgs = [
    "./grobot",
    "status",
    "--work-dir",
    workDir,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
  ];
  const result = runCommand(
    repoRoot,
    statusArgs,
    { GROBOT_RUNTIME_BIN: fakeRuntimePath },
  );
  const jsonResult = runCommand(
    repoRoot,
    [...statusArgs, "--json"],
    { GROBOT_RUNTIME_BIN: fakeRuntimePath },
  );
  const {
    parsedStatus,
    runtimeToolsQuality,
    failureReasons,
    warningReasons,
  } = parseRuntimeQualityStatus(context, jsonResult);
  const runtimeTools = isPlainObject(parsedStatus?.runtime_tools)
    ? parsedStatus.runtime_tools
    : null;
  const schemaProjection = isPlainObject(runtimeTools?.schema_projection)
    ? runtimeTools.schema_projection
    : null;
  return {
    ...result,
    json_exit_code: jsonResult.exit_code,
    status_json_parse_ok: Boolean(parsedStatus),
    fake_runtime_path: fakeRuntimePath,
    has_gateway_fallback_projection: schemaProjection?.source === "gateway.fallback",
    has_start_default_source: runtimeToolsQuality?.runtime_describe_source === "start-default",
    has_invalid_schema_reason:
      String(runtimeToolsQuality?.runtime_describe_detail ?? "")
        .includes("runtime_tools_describe_invalid_schema_profiles:schema_profiles_invalid_rows:1"),
    ...runtimeQualityCommonFields(runtimeToolsQuality),
    quality_failure_has_runtime_health_failed: failureReasons.includes("runtime_health_failed"),
    quality_warning_has_describe_fallback: warningReasons.includes("runtime_tools_describe_fallback"),
    text_has_quality_fail:
      result.stdout.includes("Runtime needs check")
      && !result.stdout.includes("runtime_tool_quality: status=fail"),
  };
}

export function runStartRuntimeDescribeInvalidSchemaProfiles(context) {
  const {
    repoRoot,
    createTempDir,
    writeExecutionProjectToml,
    runCommand,
    writeConfig,
    buildSmokeConfig,
  } = context;
  const workDir = createTempDir("grobot-start-runtime-describe-invalid-schema-work");
  const homeDir = createTempDir("grobot-start-runtime-describe-invalid-schema-home");
  const config = writeConfig(buildSmokeConfig(workDir));
  writeExecutionProjectToml(workDir);
  const fakeRuntimePath = writeFakeRuntimeToolsDescribe(
    context,
    buildInvalidSchemaProfileToolsDescribePayload(),
  );
  const result = runCommand(
    repoRoot,
    [
      "./grobot",
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
      "runtime-describe-invalid-schema-user",
      "--history-turns",
      "2",
    ],
    {
      GROBOT_RUNTIME_BIN: fakeRuntimePath,
      GROBOT_STARTUP_DIAGNOSTICS: "0",
      GROBOT_INTERACTIVE_DIAGNOSTICS: "0",
      GROBOT_ALLOW_TS_DEV_CLI: "1",
      GROBOT_ALLOW_REDIS_FALLBACK: "1",
    },
    ["/exit", ""].join("\n"),
  );
  return {
    ...result,
    fake_runtime_path: fakeRuntimePath,
    has_runtime_tools_fallback_surface:
      result.stderr.includes("Runtime tool description unavailable")
      && result.stderr.includes("Started with built-in tool schema.")
      && result.stderr.includes("source start-default"),
    compact_avoids_tool_surface_event: !result.stderr.includes("[tool-surface] event=runtime_describe_fallback"),
    compact_avoids_enabled_tools_source_field: !result.stderr.includes("enabled_tools_source="),
    has_invalid_schema_reason: result.stderr.includes(
      "runtime_tools_describe_invalid_schema_profiles:schema_profiles_invalid_rows:1",
    ),
    has_status_json_hint: result.stderr.includes("grobot status --json"),
    compact_avoids_fallback_manifest_field: !result.stderr.includes("manifest_fingerprint=fallback:"),
    compact_avoids_schema_profiles_field: !result.stderr.includes("schema_profiles_fingerprint=<none>"),
  };
}

export function runStatusRejectLegacyFlag(context) {
  const { repoRoot, runCommand } = context;
  return runCommand(repoRoot, ["./grobot", "status", "--legacy-python-cli"]);
}

export function runStatusRejectPythonGateway(context) {
  const { repoRoot, runCommand } = context;
  const pythonGatewayResult = runCommand(repoRoot, ["./grobot", "status", "--gateway-impl", "python"]);
  const emptyGatewayResult = runCommand(repoRoot, ["./grobot", "status", "--gateway-impl", ""]);
  const missingGatewayResult = runCommand(repoRoot, ["./grobot", "status", "--gateway-impl"]);
  const emptyRuntimeResult = runCommand(repoRoot, ["./grobot", "status", "--runtime-impl", ""]);
  const missingRuntimeResult = runCommand(repoRoot, ["./grobot", "status", "--runtime-impl"]);
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

export function runStatusRejectLegacyEnv(context) {
  const { repoRoot, runCommand } = context;
  return runCommand(repoRoot, ["./grobot", "status"], { GROBOT_LEGACY_PYTHON: "1" });
}

export function runRuntimeBinRejectFlow(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    parseJsonObjectSafe,
    runCommand,
    hasStartBannerMarker,
  } = context;
  const workDir = createTempDir("grobot-invalid-runtime-bin-work");
  const config = writeConfig(buildSmokeConfig(workDir));
  const startEmptyRuntimeBin = runCommand(repoRoot, [
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
    "invalid-runtime-bin-user",
    "--message",
    "invalid runtime bin should not reach runtime",
  ], {
    GROBOT_RUNTIME_BIN: "",
  });
  const statusJsonEmptyRuntimeBin = runCommand(repoRoot, [
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
    GROBOT_RUNTIME_BIN: "   ",
  });
  const statusJsonPayload = parseJsonObjectSafe(statusJsonEmptyRuntimeBin.stdout);
  const statusTextEmptyRuntimeBin = runCommand(repoRoot, [
    "./grobot",
    "status",
    "--work-dir",
    workDir,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
  ], {
    GROBOT_RUNTIME_BIN: "",
  });
  const combinedOutput = [
    startEmptyRuntimeBin.stdout,
    startEmptyRuntimeBin.stderr,
    statusJsonEmptyRuntimeBin.stdout,
    statusJsonEmptyRuntimeBin.stderr,
    statusTextEmptyRuntimeBin.stdout,
    statusTextEmptyRuntimeBin.stderr,
  ].join("\n");
  const hasStableError = (result) =>
    result.stderr.includes("error: invalid_runtime_bin:")
    && result.stderr.includes("runtime-bin must be a non-empty path");
  return {
    start_empty_runtime_bin_exit_code: startEmptyRuntimeBin.exit_code,
    start_empty_runtime_bin_has_stable_error: hasStableError(startEmptyRuntimeBin),
    status_json_empty_runtime_bin_exit_code: statusJsonEmptyRuntimeBin.exit_code,
    status_json_empty_runtime_bin_error: statusJsonPayload?.error ?? null,
    status_json_empty_runtime_bin_field: statusJsonPayload?.field ?? null,
    status_json_empty_runtime_bin_detail:
      typeof statusJsonPayload?.detail === "string" ? statusJsonPayload.detail : null,
    status_text_empty_runtime_bin_exit_code: statusTextEmptyRuntimeBin.exit_code,
    status_text_empty_runtime_bin_has_stable_error: hasStableError(statusTextEmptyRuntimeBin),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    has_start_banner: hasStartBannerMarker(combinedOutput),
  };
}
