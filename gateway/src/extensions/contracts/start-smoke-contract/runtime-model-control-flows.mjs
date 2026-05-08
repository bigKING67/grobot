import { mkdirSync, writeFileSync } from "node:fs";

function buildKimiProviderConfig(workDir, extraProviderLines) {
  return [
    'language = "zh"',
    "",
    "[[projects]]",
    'name = "grobot"',
    "",
    "[projects.agent]",
    'type = "claudecode"',
    'provider = "kimi"',
    "",
    "[projects.agent.options]",
    `work_dir = "${workDir}"`,
    'mode = "default"',
    "",
    "[[projects.agent.providers]]",
    'name = "kimi"',
    'provider_kind = "kimi"',
    'api_key = "mock-kimi-key"',
    'base_url = "http://127.0.0.1:65534/v1"',
    'model = "kimi-k2.5"',
    ...extraProviderLines,
    "",
    "[[projects.platforms]]",
    'type = "feishu"',
    "",
    "[projects.platforms.options]",
    'app_id = "x"',
    'app_secret = "y"',
    "",
  ].join("\n");
}

function writeSearchRoutingProjectToml(workDir, lines) {
  const grobotDir = `${workDir}/.grobot`;
  mkdirSync(grobotDir, { recursive: true });
  writeFileSync(
    `${grobotDir}/project.toml`,
    [
      "schema_version = 1",
      'mode = "mvp"',
      "",
      "[search.routing]",
      ...lines,
      "",
    ].join("\n"),
    "utf8",
  );
}

export function runStartInvalidRuntimeModelControlsRejectFlow(context) {
  const {
    repoRoot,
    createTempDir,
    writeConfig,
    runCommand,
    hasStartBannerMarker,
  } = context;
  const makeCase = (suffix, extraProviderLines) => {
    const workDir = createTempDir(`grobot-start-invalid-runtime-model-${suffix}`);
    const config = writeConfig(buildKimiProviderConfig(workDir, extraProviderLines));
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
      `start-invalid-runtime-model-${suffix}-user`,
      "--message",
      "invalid runtime model config should not reach runtime",
    ]);
  };
  const makeSearchRoutingCase = (suffix, projectTomlLines) => {
    const workDir = createTempDir(`grobot-start-invalid-runtime-model-${suffix}`);
    writeSearchRoutingProjectToml(workDir, projectTomlLines);
    const config = writeConfig(buildKimiProviderConfig(workDir, []));
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
      `start-invalid-runtime-model-${suffix}-user`,
      "--message",
      "invalid search routing config should not reach runtime",
    ]);
  };
  const invalidWebSearchModeResult = makeCase(
    "web-search-mode",
    ['kimi_web_search_mode = "always_on"'],
  );
  const invalidMaxTokensResult = makeCase("max-tokens", ["kimi_max_tokens = 100"]);
  const invalidTemperatureResult = makeCase("temperature", ["kimi_temperature = 3"]);
  const invalidTopPResult = makeCase("top-p", ["kimi_top_p = 1.5"]);
  const invalidPromptCacheStrategyResult = makeCase(
    "prompt-cache-strategy",
    ["prompt_cache_enabled = true", 'prompt_cache_strategy = "all_messages"'],
  );
  const invalidPromptCacheUserLastNResult = makeCase(
    "prompt-cache-user-last-n",
    ["prompt_cache_enabled = true", "prompt_cache_user_last_n = 13"],
  );
  const invalidPromptCacheCapabilityResult = makeCase(
    "prompt-cache-capability",
    ["prompt_cache_enabled = true", 'prompt_cache_capability = "openai_compatible"'],
  );
  const invalidPromptCacheEnabledTypeResult = makeCase(
    "prompt-cache-enabled-type",
    ["prompt_cache_enabled = maybe"],
  );
  const invalidSearchRoutingResult = makeSearchRoutingCase(
    "search-routing",
    ['kimi = "sideways"'],
  );
  const malformedSearchRoutingResult = makeSearchRoutingCase(
    "search-routing-malformed",
    ['kimi = "mcp_only" trailing'],
  );
  const validBoundaryResult = makeCase(
    "valid-boundary",
    [
      'kimi_web_search_mode = "off"',
      "kimi_max_tokens = 1024",
      "kimi_temperature = 2",
      "kimi_top_p = 1",
      "prompt_cache_enabled = true",
      'prompt_cache_strategy = "user_last_n"',
      "prompt_cache_user_last_n = 12",
      'prompt_cache_capability = "unsupported"',
    ],
  );
  const combinedOutput = [
    invalidWebSearchModeResult.stdout,
    invalidWebSearchModeResult.stderr,
    invalidMaxTokensResult.stdout,
    invalidMaxTokensResult.stderr,
    invalidTemperatureResult.stdout,
    invalidTemperatureResult.stderr,
    invalidTopPResult.stdout,
    invalidTopPResult.stderr,
    invalidPromptCacheStrategyResult.stdout,
    invalidPromptCacheStrategyResult.stderr,
    invalidPromptCacheUserLastNResult.stdout,
    invalidPromptCacheUserLastNResult.stderr,
    invalidPromptCacheCapabilityResult.stdout,
    invalidPromptCacheCapabilityResult.stderr,
    invalidPromptCacheEnabledTypeResult.stdout,
    invalidPromptCacheEnabledTypeResult.stderr,
    invalidSearchRoutingResult.stdout,
    invalidSearchRoutingResult.stderr,
    malformedSearchRoutingResult.stdout,
    malformedSearchRoutingResult.stderr,
  ].join("\n");
  const validSearchRoutingBoundaryResult = makeSearchRoutingCase(
    "search-routing-valid-boundary",
    ['kimi = "mcp_only"'],
  );
  return {
    invalid_web_search_mode_exit_code: invalidWebSearchModeResult.exit_code,
    invalid_web_search_mode_has_stable_error:
      invalidWebSearchModeResult.stderr.includes("error: invalid_kimi_web_search_mode:")
      && invalidWebSearchModeResult.stderr.includes("kimi-web-search-mode must be builtin_preferred, builtin_only, official_only, or off"),
    invalid_max_tokens_exit_code: invalidMaxTokensResult.exit_code,
    invalid_max_tokens_has_stable_error:
      invalidMaxTokensResult.stderr.includes("error: invalid_kimi_max_tokens:")
      && invalidMaxTokensResult.stderr.includes("kimi-max-tokens must be an integer between 1024 and 262144"),
    invalid_temperature_exit_code: invalidTemperatureResult.exit_code,
    invalid_temperature_has_stable_error:
      invalidTemperatureResult.stderr.includes("error: invalid_kimi_temperature:")
      && invalidTemperatureResult.stderr.includes("kimi-temperature must be a number between 0 and 2"),
    invalid_top_p_exit_code: invalidTopPResult.exit_code,
    invalid_top_p_has_stable_error:
      invalidTopPResult.stderr.includes("error: invalid_kimi_top_p:")
      && invalidTopPResult.stderr.includes("kimi-top-p must be a number between 0 and 1"),
    invalid_prompt_cache_strategy_exit_code: invalidPromptCacheStrategyResult.exit_code,
    invalid_prompt_cache_strategy_has_stable_error:
      invalidPromptCacheStrategyResult.stderr.includes("error: invalid_prompt_cache_strategy:")
      && invalidPromptCacheStrategyResult.stderr.includes("prompt-cache-strategy must be user_last_n"),
    invalid_prompt_cache_user_last_n_exit_code: invalidPromptCacheUserLastNResult.exit_code,
    invalid_prompt_cache_user_last_n_has_stable_error:
      invalidPromptCacheUserLastNResult.stderr.includes("error: invalid_prompt_cache_user_last_n:")
      && invalidPromptCacheUserLastNResult.stderr.includes("prompt-cache-user-last-n must be an integer between 1 and 12"),
    invalid_prompt_cache_capability_exit_code: invalidPromptCacheCapabilityResult.exit_code,
    invalid_prompt_cache_capability_has_stable_error:
      invalidPromptCacheCapabilityResult.stderr.includes("error: invalid_prompt_cache_capability:")
      && invalidPromptCacheCapabilityResult.stderr.includes("prompt-cache-capability must be anthropic_compatible or unsupported"),
    invalid_prompt_cache_enabled_type_exit_code: invalidPromptCacheEnabledTypeResult.exit_code,
    invalid_prompt_cache_enabled_type_has_stable_error:
      invalidPromptCacheEnabledTypeResult.stderr.includes("error: invalid_prompt_cache_enabled:")
      && invalidPromptCacheEnabledTypeResult.stderr.includes("prompt-cache-enabled must be boolean"),
    invalid_search_routing_exit_code: invalidSearchRoutingResult.exit_code,
    invalid_search_routing_has_stable_error:
      invalidSearchRoutingResult.stderr.includes("error: invalid_search_routing_kimi:")
      && invalidSearchRoutingResult.stderr.includes("search-routing-kimi must be mcp_first_fallback_builtin, builtin_only, or mcp_only")
      && invalidSearchRoutingResult.stderr.includes("source=project_toml"),
    malformed_search_routing_exit_code: malformedSearchRoutingResult.exit_code,
    malformed_search_routing_has_stable_error:
      malformedSearchRoutingResult.stderr.includes("error: invalid_search_routing_kimi:")
      && malformedSearchRoutingResult.stderr.includes("search-routing-kimi must be mcp_first_fallback_builtin, builtin_only, or mcp_only")
      && malformedSearchRoutingResult.stderr.includes("source=project_toml"),
    valid_boundary_exit_code: validBoundaryResult.exit_code,
    valid_boundary_reached_runtime:
      validBoundaryResult.stderr.includes("Turn failed")
      || validBoundaryResult.stderr.includes("Upstream connection failed"),
    valid_search_routing_boundary_exit_code: validSearchRoutingBoundaryResult.exit_code,
    valid_search_routing_boundary_reached_runtime:
      validSearchRoutingBoundaryResult.stderr.includes("Turn failed")
      || validSearchRoutingBoundaryResult.stderr.includes("Upstream connection failed"),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    has_start_banner: hasStartBannerMarker(combinedOutput),
  };
}
