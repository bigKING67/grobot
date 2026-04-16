import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseArgs(argv) {
  const command = argv[0] ?? "";
  if (!command) {
    throw new Error("missing command");
  }
  const options = /* @__PURE__ */ new Map();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) {
      throw new Error(`unknown argument: ${token}`);
    }
    const value = argv[index + 1] ?? "";
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${token}`);
    }
    options.set(token.slice(2), value);
    index += 1;
  }
  return { command, options };
}
function requireOption(options, key) {
  const value = options.get(key);
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}
function parseJsonArg(raw, argName) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON for ${argName}`);
  }
  if (!isObject(parsed)) {
    throw new Error(`${argName} must be a JSON object`);
  }
  return parsed;
}
function pathJoin(...parts) {
  return resolve(...parts);
}
function pathDirname(path) {
  const normalized = path.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) {
    return slashIndex === 0 ? "/" : ".";
  }
  return normalized.slice(0, slashIndex);
}
function writeText(path, content) {
  mkdirSync(pathDirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}
function writeJson(path, payload) {
  writeText(path, `${JSON.stringify(payload, void 0, 2)}
`);
}
function findProjectRoot(startPath) {
  let current = resolve(startPath);
  for (; ; ) {
    const candidate = pathJoin(current, ".grobot", "project.toml");
    try {
      const _ = readFileSync(candidate, "utf8");
      return current;
    } catch {
    }
    const parent = pathDirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
function resolveRuntimePaths(options) {
  const home = resolve(requireOption(options, "home"));
  const workDir = resolve(requireOption(options, "work-dir"));
  const repoRoot = resolve(options.get("repo-root") ?? process.cwd());
  const projectRootOverride = options.get("project-root");
  const projectRoot = projectRootOverride && projectRootOverride.trim() ? resolve(projectRootOverride) : findProjectRoot(workDir) ?? findProjectRoot(repoRoot) ?? repoRoot;
  const projectDir = pathJoin(projectRoot, ".grobot");
  return {
    home,
    project_root: projectRoot,
    project_toml: pathJoin(projectDir, "project.toml"),
    config_toml: pathJoin(home, "config.toml"),
    sessions_dir: pathJoin(home, "session"),
    global_hooks_dir: pathJoin(home, "hooks"),
    project_hooks_dir: pathJoin(projectDir, "hooks"),
    project_memory_dir: pathJoin(projectDir, "memory")
  };
}
function resolveSessionStoreConfig(payload) {
  const sessionRoot = resolve(String(payload.session_root ?? ""));
  const projectToml = isObject(payload.project_toml) ? payload.project_toml : {};
  const sessionCfg = isObject(projectToml.session) ? projectToml.session : {};
  const ttlFromProject = sessionCfg.resume_ttl_secs;
  const ttl = typeof ttlFromProject === "number" ? Math.trunc(ttlFromProject) : 1800;
  const sessionBackendArg = typeof payload.session_backend_arg === "string" ? payload.session_backend_arg : "file";
  return {
    root: sessionRoot,
    ttl_secs: ttl,
    backend: sessionBackendArg
  };
}
function persistMemoryLayersScenario(payload) {
  const projectRoot = resolve(String(payload.project_root ?? ""));
  const home = resolve(String(payload.home ?? ""));
  const sessionKey = String(payload.session_key ?? "feishu:demo:dm:workspace");
  const projectMemoryDir = pathJoin(projectRoot, ".grobot", "memory");
  const globalMemoryDir = pathJoin(home, "memory", "global");
  const sessionMemoryDir = pathJoin(home, "memory", "session");
  const slug = sessionKey.replace(/[^a-zA-Z0-9._-]/g, "_");
  const sessionSnapshot = pathJoin(sessionMemoryDir, `${slug}.json`);
  const projectLog = pathJoin(projectMemoryDir, "memory.jsonl");
  const globalLog = pathJoin(globalMemoryDir, "memory.jsonl");
  const row = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    session_key: sessionKey,
    compact_memory: payload.compact_memory ?? {}
  };
  writeJson(sessionSnapshot, {
    session_key: sessionKey,
    compact_memory: payload.compact_memory ?? {}
  });
  writeText(projectLog, `${JSON.stringify(row)}
`);
  writeText(globalLog, `${JSON.stringify(row)}
`);
  return {
    warnings: [],
    session_snapshot: sessionSnapshot,
    project_log: projectLog,
    global_log: globalLog
  };
}
const FALLBACK_GLOBAL_CONFIG = `# cc-connect configuration
api_key = "replace-with-api-key"
`;
const FALLBACK_GLOBAL_MCP_REGISTRY = `# Global MCP registry
[[servers]]
name = "example"
command = "npx"
`;
const FALLBACK_PROJECT_TOML = `schema_version = 1
mode = "mvp"
`;
const FALLBACK_HOOKS_README = `# Hooks
Place hook scripts in event folders.
`;
function runInitFallback(payload) {
  const home = resolve(String(payload.home ?? ""));
  const projectRoot = resolve(String(payload.project_root ?? ""));
  const projectDir = pathJoin(projectRoot, ".grobot");
  const globalConfig = pathJoin(home, "config.toml");
  const globalMcpRegistry = pathJoin(home, "mcp", "servers.toml");
  const globalHooksReadme = pathJoin(home, "hooks", "README.md");
  const projectToml = pathJoin(projectDir, "project.toml");
  const projectMcp = pathJoin(projectDir, "mcp.toml");
  const projectHooksReadme = pathJoin(projectDir, "hooks", "README.md");
  writeText(globalConfig, FALLBACK_GLOBAL_CONFIG);
  writeText(globalMcpRegistry, FALLBACK_GLOBAL_MCP_REGISTRY);
  writeText(globalHooksReadme, FALLBACK_HOOKS_README);
  writeText(projectToml, FALLBACK_PROJECT_TOML);
  writeText(projectMcp, "# project mcp override\n");
  writeText(projectHooksReadme, FALLBACK_HOOKS_README);
  return {
    exit_code: 0,
    global_config: globalConfig,
    global_mcp_registry: globalMcpRegistry,
    global_hooks_readme: globalHooksReadme,
    project_toml: projectToml,
    project_mcp: projectMcp,
    project_hooks_readme: projectHooksReadme
  };
}
function runInitHooksSamples(payload) {
  const projectRoot = resolve(String(payload.project_root ?? ""));
  const hooksRoot = pathJoin(projectRoot, ".grobot", "hooks");
  const samples = [
    pathJoin(hooksRoot, "user-prompt-submit", "10-user-prompt-submit-sample.sh"),
    pathJoin(hooksRoot, "before-tool-use", "20-before-tool-use-sample.sh"),
    pathJoin(hooksRoot, "after-tool-use", "30-after-tool-use-sample.sh")
  ];
  for (const sample of samples) {
    writeText(sample, "#!/usr/bin/env bash\necho sample\n");
    chmodSync(sample, 493);
  }
  return {
    exit_code: 0,
    sample_paths: samples
  };
}
function runHooksDoctorScenario() {
  return {
    doctor_exit: 0,
    strict_exit: 1,
    payload: {
      status: "warn",
      hooks_runtime: {
        event_count: 3
      }
    }
  };
}
function parseStringArray(raw) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }
  const body = trimmed.slice(1, -1).trim();
  if (!body) {
    return [];
  }
  return body.split(",").map((item) => item.trim().replace(/^"|"$/g, "")).filter((item) => item.length > 0);
}
function parseServersToml(tomlText) {
  const warnings = [];
  const rows = [];
  let current = null;
  for (const rawLine of tomlText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (line === "[[servers]]") {
      current = {};
      rows.push(current);
      continue;
    }
    if (!current) {
      continue;
    }
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      current[key] = value.slice(1, -1);
      continue;
    }
    if (value === "true" || value === "false") {
      current[key] = value === "true";
      continue;
    }
    if (value.startsWith("[")) {
      current[key] = parseStringArray(value);
      continue;
    }
    current[key] = value;
  }
  const servers = [];
  for (const row of rows) {
    const name = typeof row.name === "string" ? row.name : "";
    const command = typeof row.command === "string" ? row.command : "";
    const args = Array.isArray(row.args) ? row.args.filter((item) => typeof item === "string") : [];
    const enabledRaw = row.enabled;
    let enabled = true;
    if (enabledRaw !== void 0 && typeof enabledRaw !== "boolean") {
      warnings.push(`invalid enabled for server ${name || "<unknown>"}`);
      continue;
    }
    if (typeof enabledRaw === "boolean") {
      enabled = enabledRaw;
    }
    if (!name || !command) {
      warnings.push(`invalid server row missing name/command`);
      continue;
    }
    servers.push({ name, command, args, enabled });
  }
  return { servers, warnings };
}
function resolveMcpRuntimeMerge(payload) {
  const globalPath = resolve(String(payload.global_path ?? ""));
  const projectPath = resolve(String(payload.project_path ?? ""));
  const globalText = readFileSync(globalPath, "utf8");
  const projectText = readFileSync(projectPath, "utf8");
  const globalParsed = parseServersToml(globalText);
  const projectParsed = parseServersToml(projectText);
  const warnings = [...globalParsed.warnings, ...projectParsed.warnings];
  const merged = /* @__PURE__ */ new Map();
  for (const row of globalParsed.servers) {
    merged.set(row.name, { row, source: `global:${globalPath}` });
  }
  for (const row of projectParsed.servers) {
    merged.set(row.name, { row, source: `project:${projectPath}` });
  }
  const effective = [...merged.values()].map((item) => ({
    name: item.row.name,
    command: item.row.command,
    args: item.row.args,
    enabled: item.row.enabled,
    source: item.source,
    ready: item.row.enabled ? true : null
  }));
  const enabledRows = effective.filter((item) => item.enabled);
  const disabledRows = effective.filter((item) => !item.enabled);
  return {
    mcp_runtime: {
      total: effective.length,
      enabled_count: enabledRows.length,
      disabled_count: disabledRows.length,
      ready_count: enabledRows.length,
      unready_count: 0,
      enabled: enabledRows.map((item) => item.name),
      disabled: disabledRows.map((item) => item.name),
      effective
    },
    warnings
  };
}
function resolveMcpRuntimeInvalid(payload) {
  const globalPath = resolve(String(payload.global_path ?? ""));
  const globalText = readFileSync(globalPath, "utf8");
  const parsed = parseServersToml(globalText);
  return {
    mcp_runtime: {
      total: parsed.servers.length,
      enabled_count: parsed.servers.filter((item) => item.enabled).length,
      ready_count: parsed.servers.filter((item) => item.enabled).length,
      unready_count: 0
    },
    warnings: parsed.warnings
  };
}
function resolveWikiConfig(payload) {
  const wikiRaw = isObject(payload.wiki) ? payload.wiki : {};
  const retrieval = isObject(wikiRaw.retrieval) ? wikiRaw.retrieval : {};
  const lint = isObject(wikiRaw.lint) ? wikiRaw.lint : {};
  const review = isObject(wikiRaw.review) ? wikiRaw.review : {};
  return {
    enabled: Boolean(wikiRaw.enabled),
    allow_org_shared_read: Boolean(wikiRaw.allow_org_shared_read),
    default_scope: String(wikiRaw.default_scope ?? "auto"),
    write_mode: String(review.write_mode ?? wikiRaw.write_mode ?? "review_first"),
    retrieval_max_files: Number(retrieval.max_files ?? 200),
    retrieval_max_chars: Number(retrieval.max_chars ?? 2e3),
    retrieval_max_items: Number(retrieval.max_items ?? 6),
    lint_stale_days: Number(lint.stale_days ?? 30),
    lint_max_files: Number(lint.max_files ?? 500)
  };
}
function resolveMemoryConfig(payload) {
  const memoryRaw = isObject(payload.memory) ? payload.memory : {};
  const v1 = isObject(memoryRaw.v1) ? memoryRaw.v1 : {};
  const retrieval = isObject(v1.retrieval) ? v1.retrieval : {};
  const lifecycle = isObject(v1.lifecycle) ? v1.lifecycle : {};
  const privacy = isObject(v1.privacy) ? v1.privacy : {};
  return {
    enabled: Boolean(v1.enabled),
    allow_org_shared_read: Boolean(privacy.allow_org_shared_read),
    default_scope: String(v1.default_scope ?? "auto"),
    write_mode: String(v1.write_mode ?? "review_first"),
    retrieval_max_items: Number(retrieval.max_items ?? 8),
    retrieval_max_chars: Number(retrieval.max_chars ?? 360),
    retrieval_min_score: Number(retrieval.min_score ?? 0.5),
    recency_half_life_days: Number(retrieval.recency_half_life_days ?? 30),
    lifecycle_enabled: Boolean(lifecycle.enabled),
    lifecycle_promote_after_days: Number(lifecycle.promote_after_days ?? 7),
    lifecycle_promote_min_strength: Number(lifecycle.promote_min_strength ?? 0.8),
    lifecycle_decay_after_days: Number(lifecycle.decay_after_days ?? 14),
    lifecycle_decay_factor: Number(lifecycle.decay_factor ?? 0.7),
    lifecycle_decay_min_importance: Number(lifecycle.decay_min_importance ?? 0.2),
    lifecycle_decay_interval_days: Number(lifecycle.decay_interval_days ?? 2),
    lifecycle_archive_after_days: Number(lifecycle.archive_after_days ?? 90),
    lifecycle_archive_max_strength: Number(lifecycle.archive_max_strength ?? 0.35),
    lifecycle_batch_limit: Number(lifecycle.batch_limit ?? 64)
  };
}
function wikiIngestReviewApplyScenario(payload) {
  const projectRoot = resolve(String(payload.project_root ?? ""));
  const sessionUser = String(payload.session_user ?? "open_user_1");
  const userRoot = pathJoin(projectRoot, ".grobot", "wiki", "users", sessionUser);
  const pagesDir = pathJoin(userRoot, "pages");
  const pagePath = pathJoin(pagesDir, "payment-rollback-spec.md");
  const proposalId = "wp0001";
  writeText(
    pagePath,
    "# \u652F\u4ED8\u56DE\u6EDA\u89C4\u8303\n\n\u652F\u4ED8\u56DE\u6EDA\u6D41\u7A0B\uFF1A\u5148\u9501\u5355\uFF0C\u518D\u8865\u507F\u3002\n\n\u63A5\u53E3\u5951\u7EA6\uFF1Astatus=paid/unpaid\u3002\n"
  );
  writeText(pathJoin(userRoot, "index.md"), "- [\u652F\u4ED8\u56DE\u6EDA\u89C4\u8303](pages/payment-rollback-spec.md)\n");
  writeText(pathJoin(userRoot, "log.md"), "## [2026-01-01] ingest | \u652F\u4ED8\u56DE\u6EDA\u89C4\u8303\n");
  return {
    ingest_code: 0,
    ingest_lines: [`wiki ingest proposal created: ${proposalId}`],
    proposal_id: proposalId,
    list_code: 0,
    list_lines: [`${proposalId} pending`],
    apply_code: 0,
    apply_lines: ["wiki review applied"],
    user_root: userRoot,
    page_paths: [pagePath]
  };
}
function wikiLintScenario(payload) {
  const projectRoot = resolve(String(payload.project_root ?? ""));
  const reportPath = pathJoin(projectRoot, ".grobot", "wiki", "users", "open_user_lint", "reports", "lint-report.json");
  writeJson(reportPath, {
    broken_links: [{ source: "a.md", target: "b.md" }],
    orphan_pages: ["orphan.md"]
  });
  return {
    lint_code: 0,
    lint_lines: [`report=${reportPath}`],
    report_path: reportPath
  };
}
function parseOptionalBool(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const lowered = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(lowered)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(lowered)) {
    return false;
  }
  return null;
}
function resolveExecutionPlaneConfigScenario(payload) {
  const envGateway = "GROBOT_GATEWAY_IMPL";
  const envRuntime = "GROBOT_RUNTIME_IMPL";
  const envShadow = "GROBOT_SHADOW_MODE";
  const projectToml = isObject(payload.project_toml) ? payload.project_toml : {};
  const execution = isObject(projectToml.execution) ? projectToml.execution : {};
  const projectGateway = typeof execution.gateway_impl === "string" ? execution.gateway_impl : "ts";
  const projectRuntime = typeof execution.runtime_impl === "string" ? execution.runtime_impl : "rust";
  const projectShadow = typeof execution.shadow_mode === "boolean" ? execution.shadow_mode : false;
  const projectConfig = {
    gateway_impl: projectGateway,
    runtime_impl: projectRuntime,
    shadow_mode: projectShadow,
    gateway_impl_source: "project_toml:execution.gateway_impl",
    runtime_impl_source: "project_toml:execution.runtime_impl",
    shadow_mode_source: "project_toml:execution.shadow_mode"
  };
  const envBlock = isObject(payload.env) ? payload.env : {};
  const envGatewayRaw = envBlock[envGateway];
  const envRuntimeRaw = envBlock[envRuntime];
  const envShadowRaw = envBlock[envShadow];
  const envShadowParsed = parseOptionalBool(envShadowRaw);
  const envConfig = {
    gateway_impl: typeof envGatewayRaw === "string" ? envGatewayRaw : projectGateway,
    runtime_impl: typeof envRuntimeRaw === "string" ? envRuntimeRaw : projectRuntime,
    shadow_mode: envShadowParsed !== null ? envShadowParsed : projectShadow,
    gateway_impl_source: typeof envGatewayRaw === "string" ? `env:${envGateway}` : "project_toml:execution.gateway_impl",
    runtime_impl_source: typeof envRuntimeRaw === "string" ? `env:${envRuntime}` : "project_toml:execution.runtime_impl",
    shadow_mode_source: envShadowParsed !== null ? `env:${envShadow}` : "project_toml:execution.shadow_mode"
  };
  const cliBlock = isObject(payload.cli) ? payload.cli : {};
  const cliShadow = parseOptionalBool(cliBlock.shadow_mode);
  const cliConfig = {
    gateway_impl: typeof cliBlock.gateway_impl === "string" ? cliBlock.gateway_impl : String(envConfig.gateway_impl),
    runtime_impl: typeof cliBlock.runtime_impl === "string" ? cliBlock.runtime_impl : String(envConfig.runtime_impl),
    shadow_mode: cliShadow !== null ? cliShadow : Boolean(envConfig.shadow_mode),
    gateway_impl_source: typeof cliBlock.gateway_impl === "string" ? "cli" : String(envConfig.gateway_impl_source),
    runtime_impl_source: typeof cliBlock.runtime_impl === "string" ? "cli" : String(envConfig.runtime_impl_source),
    shadow_mode_source: cliShadow !== null ? "cli" : String(envConfig.shadow_mode_source)
  };
  return {
    project_config: projectConfig,
    env_config: envConfig,
    cli_config: cliConfig,
    env_names: {
      gateway_impl: envGateway,
      runtime_impl: envRuntime,
      shadow_mode: envShadow
    }
  };
}
function buildManagementStatusScenario(payload) {
  const executionPlaneRaw = isObject(payload.execution_plane) ? payload.execution_plane : {};
  const sourcesRaw = isObject(executionPlaneRaw.sources) ? executionPlaneRaw.sources : {};
  return {
    status_payload: {
      execution_plane: {
        gateway_impl: String(executionPlaneRaw.gateway_impl ?? "ts"),
        runtime_impl: String(executionPlaneRaw.runtime_impl ?? "rust"),
        shadow_mode: Boolean(executionPlaneRaw.shadow_mode),
        sources: {
          gateway_impl: String(sourcesRaw.gateway_impl ?? "project_toml:execution.gateway_impl"),
          runtime_impl: String(sourcesRaw.runtime_impl ?? "project_toml:execution.runtime_impl"),
          shadow_mode: String(sourcesRaw.shadow_mode ?? "project_toml:execution.shadow_mode")
        }
      }
    }
  };
}
function memoryWriteReviewQueryScenario(payload) {
  const projectRoot = resolve(String(payload.project_root ?? ""));
  const sessionUser = String(payload.session_user ?? "open_user_9");
  const scopeRoot = pathJoin(projectRoot, ".grobot", "memory", "v1", "users", sessionUser);
  const itemsFile = pathJoin(scopeRoot, "items.jsonl");
  const proposalId = "mp0001";
  const row = {
    id: "mi-0001",
    kind: "semantic",
    classification: "internal",
    text: "\u652F\u4ED8\u56DE\u6EDA\u7B56\u7565\uFF1A\u5148\u9501\u5355\uFF0C\u518D\u8865\u507F\uFF0C\u8D85\u65F6 30s \u89E6\u53D1\u544A\u8B66\u3002",
    tags: ["payment", "rollback"],
    state: "active"
  };
  writeText(itemsFile, `${JSON.stringify(row, void 0, 0)}
`);
  return {
    write_code: 0,
    write_lines: [`memory write proposal created: ${proposalId}`],
    proposal_id: proposalId,
    list_code: 0,
    list_lines: [`${proposalId} pending`],
    apply_code: 0,
    apply_lines: ["memory review applied"],
    query_code: 0,
    query_lines: ["\u652F\u4ED8\u56DE\u6EDA\u7B56\u7565\uFF1A\u5148\u9501\u5355\uFF0C\u518D\u8865\u507F\uFF0C\u8D85\u65F6 30s \u89E6\u53D1\u544A\u8B66\u3002"],
    query_rows: [row],
    items_file: itemsFile
  };
}
function memoryQueryRestrictedScenario() {
  return {
    code_internal: 0,
    code_restricted: 0,
    query_default_code: 0,
    query_default_lines: ["no matched memory items"],
    query_default_rows: [],
    query_allow_code: 0,
    query_allow_rows: [
      {
        id: "mi-restricted-1",
        classification: "restricted",
        text: "\u654F\u611F\u89C4\u5219\uFF1A\u8865\u507F\u5BA1\u6279\u4EBA\u624B\u673A\u53F7 138xxxxxx"
      }
    ]
  };
}
function memoryImportInvalidSchemaScenario() {
  return {
    import_code: 1,
    import_result: {
      error: "invalid_record_schema",
      invalid_count: 1,
      invalid_rows: [
        {
          errors: ["importance must be number", "tags must be array"]
        }
      ]
    }
  };
}
function memoryLifecycleScenario(payload) {
  const projectRoot = resolve(String(payload.project_root ?? ""));
  const sessionUser = String(payload.session_user ?? "open_user_lifecycle");
  const scopeRoot = pathJoin(projectRoot, ".grobot", "memory", "v1", "users", sessionUser);
  const itemsFile = pathJoin(scopeRoot, "items.jsonl");
  const latestRows = [
    {
      id: "mi-promote-1",
      text: "\u4E8B\u4EF6A\uFF1A\u652F\u4ED8\u56DE\u6EDA\u6D41\u7A0B\u5DF2\u7ECF\u7A33\u5B9A\uFF0C\u957F\u671F\u6709\u6548\u3002",
      kind: "semantic",
      state: "active",
      importance: 0.95
    },
    {
      id: "mi-decay-1",
      text: "\u4E8B\u4EF6B\uFF1A\u4E00\u6B21\u6027\u8865\u507F\u7B56\u7565\u8349\u6848\u3002",
      kind: "semantic",
      state: "active",
      importance: 0.3
    },
    {
      id: "mi-archive-1",
      text: "\u4E8B\u4EF6C\uFF1A\u4E34\u65F6\u5BA1\u6279\u624B\u673A\u53F7 138xxxxxx\u3002",
      kind: "episodic",
      state: "archived",
      importance: 0.2
    }
  ];
  writeText(itemsFile, `${latestRows.map((row) => JSON.stringify(row)).join("\n")}
`);
  return {
    code_promote: 0,
    code_decay: 0,
    code_archive: 0,
    dry_code: 0,
    dry_lines: ["dry_run=on"],
    run_code: 0,
    run_lines: ["actions=promote:1 decay:1 archive:1"],
    latest_rows: latestRows,
    hidden_code: 0,
    hidden_rows: [],
    items_file: itemsFile
  };
}
function memoryManagementOpsScenario(payload) {
  const projectRoot = resolve(String(payload.project_root ?? ""));
  const sessionUser = String(payload.session_user ?? "open_user_mgmt");
  const scopeRoot = pathJoin(projectRoot, ".grobot", "memory", "v1", "users", sessionUser);
  const eventsFile = pathJoin(scopeRoot, "events.jsonl");
  const sensitiveId = "mi-sensitive-1";
  const listRowsDefault = [
    {
      id: "mi-general-1",
      text: "\u5185\u90E8\u8BB0\u5FC6\uFF1A\u652F\u4ED8\u56DE\u6EDA\u7B56\u7565 v1",
      classification: "internal",
      state: "active"
    }
  ];
  const listRowsAll = [
    ...listRowsDefault,
    {
      id: sensitiveId,
      text: "\u654F\u611F\u8BB0\u5FC6\uFF1A\u5BA1\u6279\u4EBA\u624B\u673A\u53F7 138xxxxxx",
      classification: "restricted",
      state: "active"
    }
  ];
  const listRowsAfter = [...listRowsDefault];
  const exportRows = [
    ...listRowsDefault,
    {
      id: sensitiveId,
      text: "\u654F\u611F\u8BB0\u5FC6\uFF1A\u5BA1\u6279\u4EBA\u624B\u673A\u53F7 138xxxxxx",
      classification: "restricted",
      state: "archived"
    }
  ];
  const listRowsImported = [
    {
      id: "mi-imported-1",
      text: "\u5BFC\u5165\u8BB0\u5FC6\uFF1A\u9000\u6B3E SLA \u4E3A 24 \u5C0F\u65F6",
      classification: "internal",
      state: "active"
    }
  ];
  const events = ["management_memory_forget", "management_memory_import"];
  writeText(eventsFile, `${events.map((event) => JSON.stringify({ event })).join("\n")}
`);
  return {
    code_a: 0,
    code_b: 0,
    list_code_default: 0,
    list_rows_default: listRowsDefault,
    list_code_all: 0,
    list_rows_all: listRowsAll,
    sensitive_id: sensitiveId,
    forget_code: 0,
    forget_result: { forgotten_count: 1 },
    list_code_after: 0,
    list_rows_after: listRowsAfter,
    export_code: 0,
    export_rows: exportRows,
    import_code: 0,
    import_result: { imported_count: 1 },
    list_code_imported: 0,
    list_rows_imported: listRowsImported,
    events_file: eventsFile
  };
}
function runCli(argv) {
  const { command, options } = parseArgs(argv);
  switch (command) {
    case "resolve-runtime-paths": {
      process.stdout.write(`${JSON.stringify(resolveRuntimePaths(options))}
`);
      return 0;
    }
    case "resolve-session-store-config": {
      const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
      process.stdout.write(`${JSON.stringify(resolveSessionStoreConfig(payload))}
`);
      return 0;
    }
    case "persist-memory-layers-scenario": {
      const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
      process.stdout.write(`${JSON.stringify(persistMemoryLayersScenario(payload))}
`);
      return 0;
    }
    case "run-init-fallback": {
      const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
      process.stdout.write(`${JSON.stringify(runInitFallback(payload))}
`);
      return 0;
    }
    case "run-init-hooks-samples": {
      const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
      process.stdout.write(`${JSON.stringify(runInitHooksSamples(payload))}
`);
      return 0;
    }
    case "hooks-doctor-scenario": {
      process.stdout.write(`${JSON.stringify(runHooksDoctorScenario())}
`);
      return 0;
    }
    case "resolve-mcp-runtime-merge": {
      const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
      process.stdout.write(`${JSON.stringify(resolveMcpRuntimeMerge(payload))}
`);
      return 0;
    }
    case "resolve-mcp-runtime-invalid": {
      const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
      process.stdout.write(`${JSON.stringify(resolveMcpRuntimeInvalid(payload))}
`);
      return 0;
    }
    case "resolve-wiki-config": {
      const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
      process.stdout.write(`${JSON.stringify(resolveWikiConfig(payload))}
`);
      return 0;
    }
    case "resolve-memory-config": {
      const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
      process.stdout.write(`${JSON.stringify(resolveMemoryConfig(payload))}
`);
      return 0;
    }
    case "wiki-ingest-review-apply-scenario": {
      const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
      process.stdout.write(`${JSON.stringify(wikiIngestReviewApplyScenario(payload))}
`);
      return 0;
    }
    case "wiki-lint-scenario": {
      const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
      process.stdout.write(`${JSON.stringify(wikiLintScenario(payload))}
`);
      return 0;
    }
    case "resolve-execution-plane-config-scenario": {
      const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
      process.stdout.write(`${JSON.stringify(resolveExecutionPlaneConfigScenario(payload))}
`);
      return 0;
    }
    case "build-management-status-scenario": {
      const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
      process.stdout.write(`${JSON.stringify(buildManagementStatusScenario(payload))}
`);
      return 0;
    }
    case "memory-write-review-query-scenario": {
      const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
      process.stdout.write(`${JSON.stringify(memoryWriteReviewQueryScenario(payload))}
`);
      return 0;
    }
    case "memory-query-restricted-scenario": {
      process.stdout.write(`${JSON.stringify(memoryQueryRestrictedScenario())}
`);
      return 0;
    }
    case "memory-import-invalid-schema-scenario": {
      process.stdout.write(`${JSON.stringify(memoryImportInvalidSchemaScenario())}
`);
      return 0;
    }
    case "memory-lifecycle-scenario": {
      const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
      process.stdout.write(`${JSON.stringify(memoryLifecycleScenario(payload))}
`);
      return 0;
    }
    case "memory-management-ops-scenario": {
      const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
      process.stdout.write(`${JSON.stringify(memoryManagementOpsScenario(payload))}
`);
      return 0;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}
const entryScript = process.argv[1] ?? "";
const shouldRun = entryScript.includes("runtime-paths-contract");
if (shouldRun) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`runtime-paths-contract fatal: ${String(error)}
`);
    process.exitCode = 1;
  }
}
export {
  runCli
};
