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
  const makeCliOverrideCase = (suffix, extraCliArgs) => {
    const workDir = createTempDir(`grobot-start-invalid-runtime-model-${suffix}`);
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
      ...extraCliArgs,
      "--message",
      "invalid runtime model CLI override should not reach runtime",
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
  const invalidQuotedTrailingResult = makeCase(
    "quoted-trailing",
    ['prompt_cache_strategy = "user_last_n" trailing'],
  );
  const invalidIntegerTrailingResult = makeCase(
    "integer-trailing",
    ["kimi_max_tokens = 1024abc"],
  );
  const invalidKimiAllowlistMixedResult = makeCase(
    "kimi-allowlist-mixed",
    ['kimi_official_tools_allowlist = ["web-search", 3]'],
  );
  const invalidKimiAllowlistEmptyResult = makeCase(
    "kimi-allowlist-empty",
    ["kimi_official_tools_allowlist = []"],
  );
  const invalidProviderPriorityResult = makeCase(
    "provider-priority",
    ["priority = 0"],
  );
  const invalidProviderPriorityFractionResult = makeCase(
    "provider-priority-fraction",
    ["priority = 1.5"],
  );
  const invalidProviderWeightResult = makeCase(
    "provider-weight",
    ["weight = 0"],
  );
  const invalidPromptCacheUserLastNFractionResult = makeCase(
    "prompt-cache-user-last-n-fraction",
    ["prompt_cache_enabled = true", "prompt_cache_user_last_n = 2.5"],
  );
  const invalidProviderKindResult = makeCase(
    "provider-kind",
    ['provider_kind = "moon"'],
  );
  const invalidSearchRoutingResult = makeSearchRoutingCase(
    "search-routing",
    ['kimi = "sideways"'],
  );
  const malformedSearchRoutingResult = makeSearchRoutingCase(
    "search-routing-malformed",
    ['kimi = "mcp_only" trailing'],
  );
  const emptyProviderCliResult = makeCliOverrideCase("cli-provider-empty", ["--provider", ""]);
  const emptyModelCliResult = makeCliOverrideCase("cli-model-empty", ["--model", ""]);
  const emptyApiKeyCliResult = makeCliOverrideCase("cli-api-key-empty", ["--api-key", ""]);
  const missingBaseUrlCliResult = makeCliOverrideCase("cli-base-url-missing", ["--base-url"]);
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
    invalidQuotedTrailingResult.stdout,
    invalidQuotedTrailingResult.stderr,
    invalidIntegerTrailingResult.stdout,
    invalidIntegerTrailingResult.stderr,
    invalidKimiAllowlistMixedResult.stdout,
    invalidKimiAllowlistMixedResult.stderr,
    invalidKimiAllowlistEmptyResult.stdout,
    invalidKimiAllowlistEmptyResult.stderr,
    invalidProviderPriorityResult.stdout,
    invalidProviderPriorityResult.stderr,
    invalidProviderPriorityFractionResult.stdout,
    invalidProviderPriorityFractionResult.stderr,
    invalidProviderWeightResult.stdout,
    invalidProviderWeightResult.stderr,
    invalidPromptCacheUserLastNFractionResult.stdout,
    invalidPromptCacheUserLastNFractionResult.stderr,
    invalidProviderKindResult.stdout,
    invalidProviderKindResult.stderr,
    invalidSearchRoutingResult.stdout,
    invalidSearchRoutingResult.stderr,
    malformedSearchRoutingResult.stdout,
    malformedSearchRoutingResult.stderr,
    emptyProviderCliResult.stdout,
    emptyProviderCliResult.stderr,
    emptyModelCliResult.stdout,
    emptyModelCliResult.stderr,
    emptyApiKeyCliResult.stdout,
    emptyApiKeyCliResult.stderr,
    missingBaseUrlCliResult.stdout,
    missingBaseUrlCliResult.stderr,
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
    invalid_quoted_trailing_exit_code: invalidQuotedTrailingResult.exit_code,
    invalid_quoted_trailing_has_stable_error:
      invalidQuotedTrailingResult.stderr.includes("error: invalid_prompt_cache_strategy:")
      && invalidQuotedTrailingResult.stderr.includes("prompt-cache-strategy must be a string"),
    invalid_integer_trailing_exit_code: invalidIntegerTrailingResult.exit_code,
    invalid_integer_trailing_has_stable_error:
      invalidIntegerTrailingResult.stderr.includes("error: invalid_kimi_max_tokens:")
      && invalidIntegerTrailingResult.stderr.includes("kimi-max-tokens must be an integer"),
    invalid_kimi_allowlist_mixed_exit_code: invalidKimiAllowlistMixedResult.exit_code,
    invalid_kimi_allowlist_mixed_has_stable_error:
      invalidKimiAllowlistMixedResult.stderr.includes("error: invalid_kimi_official_tools_allowlist:")
      && invalidKimiAllowlistMixedResult.stderr.includes("kimi-official-tools-allowlist must be a non-empty array of strings"),
    invalid_kimi_allowlist_empty_exit_code: invalidKimiAllowlistEmptyResult.exit_code,
    invalid_kimi_allowlist_empty_has_stable_error:
      invalidKimiAllowlistEmptyResult.stderr.includes("error: invalid_kimi_official_tools_allowlist:")
      && invalidKimiAllowlistEmptyResult.stderr.includes("kimi-official-tools-allowlist must be a non-empty array of strings"),
    invalid_provider_priority_exit_code: invalidProviderPriorityResult.exit_code,
    invalid_provider_priority_has_stable_error:
      invalidProviderPriorityResult.stderr.includes("error: invalid_provider_priority:")
      && invalidProviderPriorityResult.stderr.includes("provider-priority must be a positive integer"),
    invalid_provider_priority_fraction_exit_code: invalidProviderPriorityFractionResult.exit_code,
    invalid_provider_priority_fraction_has_stable_error:
      invalidProviderPriorityFractionResult.stderr.includes("error: invalid_provider_priority:"),
    invalid_provider_weight_exit_code: invalidProviderWeightResult.exit_code,
    invalid_provider_weight_has_stable_error:
      invalidProviderWeightResult.stderr.includes("error: invalid_provider_weight:")
      && invalidProviderWeightResult.stderr.includes("provider-weight must be a positive number"),
    invalid_prompt_cache_user_last_n_fraction_exit_code:
      invalidPromptCacheUserLastNFractionResult.exit_code,
    invalid_prompt_cache_user_last_n_fraction_has_stable_error:
      invalidPromptCacheUserLastNFractionResult.stderr.includes("error: invalid_prompt_cache_user_last_n:")
      && invalidPromptCacheUserLastNFractionResult.stderr.includes("prompt-cache-user-last-n must be an integer"),
    invalid_provider_kind_exit_code: invalidProviderKindResult.exit_code,
    invalid_provider_kind_has_stable_error:
      invalidProviderKindResult.stderr.includes("error: invalid_provider_kind:")
      && invalidProviderKindResult.stderr.includes("provider-kind must be kimi, openai_compatible, or openai-compatible"),
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
    empty_provider_cli_exit_code: emptyProviderCliResult.exit_code,
    empty_provider_cli_has_stable_error:
      emptyProviderCliResult.stderr.includes("error: invalid_provider:")
      && emptyProviderCliResult.stderr.includes("provider must be a non-empty string"),
    empty_model_cli_exit_code: emptyModelCliResult.exit_code,
    empty_model_cli_has_stable_error:
      emptyModelCliResult.stderr.includes("error: invalid_model:")
      && emptyModelCliResult.stderr.includes("model must be a non-empty string"),
    empty_api_key_cli_exit_code: emptyApiKeyCliResult.exit_code,
    empty_api_key_cli_has_stable_error:
      emptyApiKeyCliResult.stderr.includes("error: invalid_api_key:")
      && emptyApiKeyCliResult.stderr.includes("api-key must be a non-empty string"),
    missing_base_url_cli_exit_code: missingBaseUrlCliResult.exit_code,
    missing_base_url_cli_has_stable_error:
      missingBaseUrlCliResult.stderr.includes("error: invalid_base_url:")
      && missingBaseUrlCliResult.stderr.includes("base-url must be a non-empty string"),
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
