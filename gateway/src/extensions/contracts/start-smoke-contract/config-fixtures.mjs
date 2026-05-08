import { mkdirSync, writeFileSync } from "node:fs";

export function buildSmokeConfig(workDir) {
  return [
    'language = "zh"',
    "",
    "[[projects]]",
    'name = "grobot"',
    "",
    "[projects.agent]",
    'type = "claudecode"',
    'provider = "mock"',
    "",
    "[projects.agent.options]",
    `work_dir = "${workDir}"`,
    'mode = "default"',
    "",
    "[[projects.agent.providers]]",
    'name = "mock"',
    'api_key = "mock-key"',
    'base_url = "http://127.0.0.1:65534/v1"',
    'model = "mock-model"',
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

export function buildSingleProviderConfig(workDir, provider) {
  return [
    'language = "zh"',
    "",
    "[[projects]]",
    'name = "grobot"',
    "",
    "[projects.agent]",
    'type = "claudecode"',
    `provider = "${provider.name}"`,
    "",
    "[projects.agent.options]",
    `work_dir = "${workDir}"`,
    'mode = "default"',
    "",
    "[[projects.agent.providers]]",
    `name = "${provider.name}"`,
    `api_key = "${provider.apiKey}"`,
    `base_url = "${provider.baseUrl}"`,
    `model = "${provider.model}"`,
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

export function buildFailoverConfig(workDir, options = {}) {
  const successBaseUrl = typeof options.successBaseUrl === "string" && options.successBaseUrl.trim().length > 0
    ? options.successBaseUrl.trim()
    : "http://127.0.0.1:65533/v1";
  return [
    'language = "zh"',
    "",
    "[[projects]]",
    'name = "grobot"',
    "",
    "[projects.agent]",
    'type = "claudecode"',
    'provider = "failing"',
    "",
    "[projects.agent.options]",
    `work_dir = "${workDir}"`,
    'mode = "default"',
    "",
    "[[projects.agent.providers]]",
    'name = "failing"',
    'api_key = "failing-key"',
    'base_url = "http://127.0.0.1:65534/v1"',
    'model = "failing-model"',
    "",
    "[[projects.agent.providers]]",
    'name = "success"',
    'api_key = "success-key"',
    `base_url = "${successBaseUrl}"`,
    'model = "success-model"',
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

export function buildProviderPoolConfig(workDir, providerBaseUrl, providerCount) {
  const normalizedCount = Number.isFinite(providerCount) ? Math.max(1, Math.floor(providerCount)) : 1;
  const lines = [
    'language = "zh"',
    "",
    "[[projects]]",
    'name = "grobot"',
    "",
    "[projects.agent]",
    'type = "claudecode"',
    'provider = "pool-01"',
    "",
    "[projects.agent.options]",
    `work_dir = "${workDir}"`,
    'mode = "default"',
    "",
  ];
  for (let index = 1; index <= normalizedCount; index += 1) {
    const suffix = String(index).padStart(2, "0");
    lines.push("[[projects.agent.providers]]");
    lines.push(`name = "pool-${suffix}"`);
    lines.push(`api_key = "pool-key-${suffix}"`);
    lines.push(`base_url = "${providerBaseUrl}"`);
    lines.push('model = "pool-model"');
    lines.push("priority = 10");
    lines.push("weight = 100");
    lines.push("requests_per_minute = 1");
    lines.push("burst = 1");
    lines.push("max_inflight = 2");
    lines.push("");
  }
  lines.push("[[projects.platforms]]");
  lines.push('type = "feishu"');
  lines.push("");
  lines.push("[projects.platforms.options]");
  lines.push('app_id = "x"');
  lines.push('app_secret = "y"');
  lines.push("");
  return lines.join("\n");
}

export function writeExecutionProjectToml(workDir) {
  const grobotDir = `${workDir}/.grobot`;
  mkdirSync(grobotDir, { recursive: true });
  writeFileSync(
    `${grobotDir}/project.toml`,
    [
      "schema_version = 1",
      'mode = "mvp"',
      "",
      "[execution]",
      'gateway_impl = "ts"',
      'runtime_impl = "rust"',
      "shadow_mode = false",
      "",
    ].join("\n"),
    "utf8"
  );
}

export function writeContextEngineTrimProjectToml(workDir) {
  const grobotDir = `${workDir}/.grobot`;
  mkdirSync(grobotDir, { recursive: true });
  writeFileSync(
    `${grobotDir}/project.toml`,
    [
      "schema_version = 1",
      'mode = "mvp"',
      "",
      "[context_engine]",
      "enabled = true",
      'profile = "aggressive"',
      "context_window_tokens = 1800",
      "reserved_output_tokens = 700",
      "safety_margin_tokens = 50",
      "proactive_ratio = 0.78",
      "forced_ratio = 0.84",
      "hard_ratio = 0.90",
      "reactive_max_retries = 1",
      "ptl_max_retries = 3",
      "circuit_breaker_failures = 3",
      "reactive_on_prompt_too_long = true",
      "lineage_enabled = false",
      "workspace_signals_enabled = false",
      "dependency_graph_enabled = false",
      "symbol_graph_enabled = false",
      "semantic_prefetch_enabled = false",
      "",
    ].join("\n"),
    "utf8",
  );
}

export function writeContextEngineQualityGuardProjectToml(workDir) {
  const grobotDir = `${workDir}/.grobot`;
  mkdirSync(grobotDir, { recursive: true });
  writeFileSync(
    `${grobotDir}/project.toml`,
    [
      "schema_version = 1",
      'mode = "mvp"',
      "",
      "[context_engine]",
      "enabled = true",
      'profile = "conservative"',
      "context_window_tokens = 64000",
      "reserved_output_tokens = 9000",
      "safety_margin_tokens = 1800",
      "proactive_ratio = 0.96",
      "forced_ratio = 0.98",
      "hard_ratio = 0.99",
      "reactive_max_retries = 1",
      "ptl_max_retries = 3",
      "circuit_breaker_failures = 3",
      "reactive_on_prompt_too_long = true",
      "lineage_enabled = false",
      "workspace_signals_enabled = false",
      "dependency_graph_enabled = false",
      "symbol_graph_enabled = false",
      "semantic_prefetch_enabled = false",
      "prompt_quality_low_quality_threshold = 0.70",
      "prompt_quality_degrade_overall_threshold = 0.92",
      "prompt_quality_degrade_low_quality_rate_threshold = 0.20",
      "prompt_quality_degrade_min_entries = 2",
      "prompt_quality_guard_enabled = true",
      "prompt_quality_guard_promote_streak = 1",
      "prompt_quality_guard_severe_promote_streak = 1",
      "prompt_quality_guard_release_streak = 2",
      "prompt_quality_guard_hold_turns = 2",
      'prompt_quality_guard_max_floor_stage = "minimal"',
      "prompt_quality_guard_severe_overall_threshold = 0.50",
      "prompt_quality_guard_severe_low_quality_rate_threshold = 0.80",
      "",
    ].join("\n"),
    "utf8",
  );
}

export function writeContextEngineGraphAutotuneProjectToml(workDir) {
  const grobotDir = `${workDir}/.grobot`;
  mkdirSync(grobotDir, { recursive: true });
  writeFileSync(
    `${grobotDir}/project.toml`,
    [
      "schema_version = 1",
      'mode = "mvp"',
      "",
      "[context_engine]",
      "enabled = true",
      'profile = "balanced"',
      "context_window_tokens = 64000",
      "reserved_output_tokens = 9000",
      "safety_margin_tokens = 1800",
      "proactive_ratio = 0.90",
      "forced_ratio = 0.95",
      "hard_ratio = 0.98",
      "reactive_max_retries = 1",
      "ptl_max_retries = 2",
      "circuit_breaker_failures = 3",
      "reactive_on_prompt_too_long = true",
      "lineage_enabled = false",
      "workspace_signals_enabled = false",
      "dependency_graph_enabled = true",
      "dependency_graph_max_rows = 2",
      "symbol_graph_enabled = true",
      "symbol_graph_max_rows = 2",
      "semantic_prefetch_enabled = false",
      "prompt_quality_degrade_min_entries = 2",
      "",
    ].join("\n"),
    "utf8",
  );
}
