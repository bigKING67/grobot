import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortedObjectKeys(value) {
  return isObject(value) ? Object.keys(value).sort() : null;
}

function sameStringArray(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index]);
}

function sumStringArrayRecordLengths(value) {
  if (!isObject(value)) {
    return null;
  }
  let total = 0;
  for (const row of Object.values(value)) {
    if (!Array.isArray(row) || !row.every((item) => typeof item === "string" && item.trim().length > 0)) {
      return null;
    }
    total += row.length;
  }
  return total;
}

function assertRuntimeToolSchemaArgVisibility(projection) {
  if (!isObject(projection)) {
    throw new Error("runtime tool schema projection missing");
  }
  const perToolPropertyCount = isObject(projection.per_tool_property_count)
    ? projection.per_tool_property_count
    : null;
  const perToolVisibleArgs = isObject(projection.per_tool_visible_args)
    ? projection.per_tool_visible_args
    : null;
  const perToolSuppressedArgs = isObject(projection.per_tool_suppressed_args)
    ? projection.per_tool_suppressed_args
    : null;
  const propertyKeys = sortedObjectKeys(perToolPropertyCount);
  const visibleArgKeys = sortedObjectKeys(perToolVisibleArgs);
  const suppressedArgKeys = sortedObjectKeys(perToolSuppressedArgs);
  if (!sameStringArray(propertyKeys, visibleArgKeys) || !sameStringArray(propertyKeys, suppressedArgKeys)) {
    throw new Error("runtime tool schema arg metadata keys do not match per-tool property keys");
  }
  const visibleArgTotal = sumStringArrayRecordLengths(perToolVisibleArgs);
  const suppressedArgTotal = sumStringArrayRecordLengths(perToolSuppressedArgs);
  if (visibleArgTotal !== projection.schema_property_count) {
    throw new Error(
      `runtime tool visible arg total mismatch: actual=${String(visibleArgTotal)} expected=${String(projection.schema_property_count)}`,
    );
  }
  if (suppressedArgTotal !== projection.suppressed_schema_property_count) {
    throw new Error(
      `runtime tool suppressed arg total mismatch: actual=${String(suppressedArgTotal)} expected=${String(projection.suppressed_schema_property_count)}`,
    );
  }
  for (const [toolName, rawCount] of Object.entries(perToolPropertyCount)) {
    const visibleArgs = perToolVisibleArgs[toolName];
    if (!Array.isArray(visibleArgs) || visibleArgs.length !== rawCount) {
      throw new Error(
        `runtime tool visible arg count mismatch for ${toolName}: actual=${String(Array.isArray(visibleArgs) ? visibleArgs.length : null)} expected=${String(rawCount)}`,
      );
    }
  }
}

function parseJsonObjectSafe(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return isObject(parsed) ? parsed : null;
  } catch {
    // ignore and try line-based fallback
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (isObject(parsed)) {
        return parsed;
      }
    } catch {
      // continue probing
    }
  }
  return null;
}

function parseArgs(argv) {
  const command = argv[0] ?? "";
  if (!command) {
    throw new Error("missing command");
  }
  const options = new Map();
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

const ANSI_ESCAPE_PATTERN = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|[@-Z\\-_])/g;
const OSC_ESCAPE_PATTERN = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f]/g;

function normalizeTerminalTextForMatch(value) {
  const raw = String(value ?? "");
  return raw
    .replace(OSC_ESCAPE_PATTERN, "")
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(CONTROL_CHAR_PATTERN, "");
}

function hasStartBannerMarker(outputText) {
  const normalized = normalizeTerminalTextForMatch(outputText);
  if (/G\s*R\s*O\s*L\s*A\s*N\s*D(?:\s*®)?/i.test(normalized)) {
    return true;
  }
  if (/Grobot\s+v\d/i.test(normalized)) {
    return true;
  }
  if (/Grobot\s+dev\b/i.test(normalized)) {
    return true;
  }
  return false;
}

function requireOption(options, key) {
  const value = options.get(key);
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}

function runCommand(repoRoot, argv, envPrefix = null, stdinText = null) {
  const commandLine = argv.map(shellEscape).join(" ");
  const exportPrefix = buildEnvPrefix(envPrefix);
  const shellScript = `cd ${shellEscape(repoRoot)} && ${exportPrefix}${commandLine}`;
  const completed = spawnSync("bash", ["-lc", shellScript], {
    encoding: "utf8",
    input: typeof stdinText === "string" ? stdinText : undefined,
  });
  return {
    exit_code: completed.status ?? 1,
    stdout: completed.stdout ?? "",
    stderr: completed.stderr ?? "",
  };
}

function runShellScript(repoRoot, shellBody) {
  const shellScript = `cd ${shellEscape(repoRoot)} && ${shellBody}`;
  const completed = spawnSync("bash", ["-lc", shellScript], {
    encoding: "utf8",
  });
  return {
    exit_code: completed.status ?? 1,
    stdout: completed.stdout ?? "",
    stderr: completed.stderr ?? "",
  };
}

function shellEscape(value) {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildEnvPrefix(envPrefix) {
  if (!envPrefix) {
    return "";
  }
  const entries = Object.entries(envPrefix);
  if (entries.length === 0) {
    return "";
  }
  return `${entries.map(([key, value]) => `${key}=${shellEscape(value)}`).join(" ")} `;
}

function buildSmokeConfig(workDir) {
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

function buildSingleProviderConfig(workDir, provider) {
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

function buildFailoverConfig(workDir) {
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
    'base_url = "http://127.0.0.1:65533/v1"',
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

function buildProviderPoolConfig(workDir, providerBaseUrl, providerCount) {
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

function writeConfig(content) {
  const configDir = createTempDir("grobot-start-config");
  const configPath = `${configDir}/config.toml`;
  writeFileSync(configPath, content, "utf8");
  return { configPath };
}

function createTempDir(prefix) {
  const random = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  const dir = resolve("/tmp", `${prefix}-${random}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeSessionKey(sessionKey) {
  return String(sessionKey).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function sanitizePlanSessionSegment(raw) {
  const normalized = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/g, "")
    .replace(/-+$/g, "");
  const resolved = normalized.length > 0 ? normalized : "main";
  return resolved.slice(0, 64);
}

function readJsonFileSafe(path) {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readTextFileSafe(path) {
  if (!existsSync(path)) {
    return "";
  }
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function countOccurrences(text, pattern) {
  if (!text || !pattern) {
    return 0;
  }
  let cursor = 0;
  let count = 0;
  while (cursor < text.length) {
    const nextIndex = text.indexOf(pattern, cursor);
    if (nextIndex < 0) {
      break;
    }
    count += 1;
    cursor = nextIndex + pattern.length;
  }
  return count;
}

function runPackageLauncherRejectsPython(repoRoot) {
  return runCommand(repoRoot, ["./packages/cli/bin/grobot", "status", "--gateway-impl=python"]);
}

function runStartMessageSmoke(repoRoot) {
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

function runStartMessageProviderConfigTsRust(
  repoRoot,
  providerBaseUrl,
  providerApiKey,
  providerModel,
) {
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

function runStartInteractiveSessionFlow(repoRoot) {
  const workDir = createTempDir("grobot-start-work");
  const homeDir = createTempDir("grobot-start-home");
  const config = writeConfig(buildSmokeConfig(workDir));
  const commandResult = runCommand(
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
      "smoke-user",
      "--history-turns",
      "8",
    ],
    null,
    ["/sessions", "/new", "/sessions", "TODO: interactive ts start", "/exit", ""].join("\n"),
  );
  const namespaceKey = "feishu:grobot:dm:smoke-user";
  const registryPath = `${workDir}/.grobot/sessions/${sanitizeSessionKey(namespaceKey)}.sessions.json`;
  const registryPayload = readJsonFileSafe(registryPath);
  const handoffPath = `${workDir}/HANDOFF.md`;
  const handoffContent = readTextFileSafe(handoffPath);
  const sessions = registryPayload && Array.isArray(registryPayload.sessions) ? registryPayload.sessions : [];
  const activeSessionId = registryPayload && typeof registryPayload.active_id === "string" ? registryPayload.active_id : "";
  let activeSessionKey = namespaceKey;
  for (const item of sessions) {
    if (!item || typeof item !== "object") {
      continue;
    }
    if (String(item.id ?? "") !== activeSessionId) {
      continue;
    }
    const key = typeof item.session_key === "string" ? item.session_key : "";
    if (key.trim().length > 0) {
      activeSessionKey = key.trim();
      break;
    }
  }
  const activeHistoryPath = `${workDir}/.grobot/sessions/${sanitizeSessionKey(activeSessionKey)}.history.json`;
  const activeHistoryPayload = readJsonFileSafe(activeHistoryPath);
  return {
    ...commandResult,
    registry_path: registryPath,
    history_path: activeHistoryPath,
    handoff_path: handoffPath,
    session_count: sessions.length,
    active_session_id: activeSessionId,
    history_message_count:
      activeHistoryPayload && Array.isArray(activeHistoryPayload.messages) ? activeHistoryPayload.messages.length : 0,
    handoff_exists: handoffContent.length > 0,
    handoff_has_compact_instructions: handoffContent.includes("## Compact Instructions"),
    handoff_has_auto_exit_reason: handoffContent.includes("reason: auto-exit"),
  };
}

function runStartBareInteractiveSessionFlow(repoRoot) {
  const workDir = createTempDir("grobot-bare-start-work");
  const homeDir = createTempDir("grobot-bare-start-home");
  const config = writeConfig(buildSmokeConfig(workDir));
  const commandResult = runCommand(
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
      "bare-command-user",
      "--history-turns",
      "8",
    ],
    null,
    ["/status", "/exit", ""].join("\n"),
  );
  const outputText = `${commandResult.stdout}\n${commandResult.stderr}`;
  return {
    ...commandResult,
    has_start_banner: hasStartBannerMarker(outputText),
    has_status_snapshot: outputText.includes("[status]"),
    has_no_command_hint:
      !outputText.includes("Enter message")
      && !outputText.includes("/ for commands · ? for shortcuts"),
    has_no_unsupported_command_error: outputText.includes("unsupported command for ts-dev-cli") === false,
  };
}

function runStartInteractiveDiagnosticsFlow(repoRoot, mode, scriptedInput, subjectSuffix = "base") {
  const normalizedMode = mode === "trace"
    ? "trace"
    : mode === "verbose"
      ? "verbose"
      : "compact";
  const normalizedSuffix = String(subjectSuffix)
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "base";
  const sessionSubject = normalizedMode === "compact"
    ? `diagnostics-compact-user-${normalizedSuffix}`
    : normalizedMode === "trace"
      ? `diagnostics-trace-user-${normalizedSuffix}`
      : `diagnostics-verbose-user-${normalizedSuffix}`;
  const workDir = createTempDir("grobot-interactive-diagnostics-work");
  const homeDir = createTempDir("grobot-interactive-diagnostics-home");
  const config = writeConfig(buildSmokeConfig(workDir));
  const args = [
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
    sessionSubject,
    "--history-turns",
    "8",
  ];
  if (normalizedMode !== "compact") {
    args.push("--verbose");
  }
  if (normalizedMode === "trace") {
    args.push("--trace");
  }
  const commandResult = runCommand(
    repoRoot,
    args,
    {
      GROBOT_STARTUP_DIAGNOSTICS: "0",
      GROBOT_INTERACTIVE_DIAGNOSTICS: "0",
      GROBOT_ALLOW_TS_DEV_CLI: "1",
      GROBOT_ALLOW_REDIS_FALLBACK: "1",
    },
    scriptedInput ?? ["/new", "diagnostics visibility smoke", "/exit", ""].join("\n"),
  );
  return {
    ...commandResult,
    diagnostic_mode: normalizedMode,
    verbose_mode: normalizedMode !== "compact",
    has_process_lines: commandResult.stdout.includes("[process]"),
    has_process_summary_lines: commandResult.stdout.includes("[process-summary]"),
    has_short_process_summary_code: /\[process-summary\]\s+(ok|err|int)\s+\d/.test(
      commandResult.stdout,
    ),
    stderr_has_event_lines: /\bevent=/.test(commandResult.stderr),
    stderr_has_trace_lines: commandResult.stderr.includes("[trace]"),
    stderr_has_runtime_error: commandResult.stderr.includes("runtime failed:"),
    stderr_has_prompt_prepared: commandResult.stderr.includes(
      "[context-engine] event=prompt_prepared",
    ),
  };
}

function runStartInteractiveDiagnosticsPlanFlow(repoRoot, mode) {
  const payload = runStartInteractiveDiagnosticsFlow(
    repoRoot,
    mode,
    ["/plan diagnostics integration flow", "/plan open", "/exit", ""].join("\n"),
    "plan",
  );
  return {
    ...payload,
    command_flow: "plan",
    has_plan_marker: payload.stdout.includes("[plan]"),
  };
}

function runStartInteractiveDiagnosticsSkillCreatorFlow(repoRoot, mode) {
  const payload = runStartInteractiveDiagnosticsFlow(
    repoRoot,
    mode,
    ["/skill-creator create a demo skill for diagnostics contracts", "/exit", ""].join("\n"),
    "skill-creator",
  );
  return {
    ...payload,
    command_flow: "skill_creator",
    has_skill_creator_marker: payload.stdout.includes("[skill-creator]"),
  };
}

function runStartInteractiveDiagnosticsUserCommandFlow(repoRoot, mode) {
  const payload = runStartInteractiveDiagnosticsFlow(
    repoRoot,
    mode,
    [
      "/commands new ping You are /ping. reply with pong.",
      "/ping diagnostics",
      "/exit",
      "",
    ].join("\n"),
    "user-command",
  );
  return {
    ...payload,
    command_flow: "user_command",
    has_commands_marker: payload.stdout.includes("[commands]"),
  };
}

function runStartImOnlyRejectFlow(repoRoot) {
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

function runStartInteractiveSessionCommandsFallbackFlow(repoRoot) {
  const workDir = createTempDir("grobot-start-work");
  const homeDir = createTempDir("grobot-start-home");
  const config = writeConfig(buildSmokeConfig(workDir));
  const subject = "session-command-fallback-user";
  const commandResult = runCommand(
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
      subject,
      "--history-turns",
      "8",
    ],
    null,
    [
      "/new",
      "/switch",
      "/continue",
      "/resume",
      "/rewind",
      "/sessions",
      "/status",
      "/status theme nerd",
      "/status layout compact",
      "/status segment tokens off",
      "/status current",
      "/exit",
      "",
    ].join("\n"),
  );
  const namespaceKey = `feishu:grobot:dm:${subject}`;
  const registryPath = `${workDir}/.grobot/sessions/${sanitizeSessionKey(namespaceKey)}.sessions.json`;
  const registryPayload = readJsonFileSafe(registryPath);
  const sessions = registryPayload && Array.isArray(registryPayload.sessions) ? registryPayload.sessions : [];
  const outputText = `${commandResult.stdout}\n${commandResult.stderr}`;
  const inferredSessionIds = new Set();
  for (const match of outputText.matchAll(/^\s*\*?\s*([A-Za-z0-9_-]+)\s+\|/gm)) {
    const sessionId = String(match[1] ?? "").trim();
    if (sessionId.length > 0) {
      inferredSessionIds.add(sessionId);
    }
  }
  return {
    ...commandResult,
    registry_path: registryPath,
    session_count: Math.max(sessions.length, inferredSessionIds.size),
    has_switch_usage: outputText.includes("Usage: /switch"),
    has_continue_usage: outputText.includes("Usage: /continue"),
    has_resume_usage: outputText.includes("Usage: /resume"),
    has_rewind_usage: outputText.includes("Usage: /rewind"),
    has_sessions_overview: outputText.includes("Session namespace:"),
    has_session_title_main: outputText.includes("Main Session"),
    has_session_title_untitled: outputText.includes("Untitled Session"),
    has_status_snapshot: outputText.includes("[status]"),
    has_status_theme_set: outputText.includes("[status] theme set to nerd_font"),
    has_status_layout_set: outputText.includes("[status] layout_mode set to compact"),
    has_status_tokens_off: outputText.includes("[status] segment tokens off"),
    has_status_theme_current: outputText.includes("theme: nerd_font"),
    has_status_layout_current: outputText.includes("layout_mode: compact"),
    has_status_tokens_current_off: outputText.includes("tokens=off"),
  };
}

function runStartInteractiveInterruptFlow(
  repoRoot,
  providerBaseUrl,
  providerApiKey,
  providerModel,
) {
  const workDir = createTempDir("grobot-start-interrupt-work");
  const homeDir = createTempDir("grobot-start-interrupt-home");
  const config = writeConfig(
    buildSingleProviderConfig(workDir, {
      name: "interrupt-provider",
      baseUrl: providerBaseUrl,
      apiKey: providerApiKey,
      model: providerModel,
    }),
  );
  const commandArgs = [
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
    "interrupt-smoke-user",
    "--history-turns",
    "8",
    "--runtime-http-timeout-ms",
    "12000",
  ];
  const commandLine = commandArgs.map(shellEscape).join(" ");
  const commandResult = runShellScript(
    repoRoot,
    [
      "{",
      "  printf '%s\\n' 'interrupt smoke turn'",
      "  sleep 0.80",
      "  printf '%s\\n' '/interrupt'",
      "  sleep 0.25",
      "  printf '%s\\n' '/exit'",
      "  printf '\\n'",
      `} | ${commandLine}`,
    ].join("\n"),
  );
  const combinedOutput = `${commandResult.stdout}\n${commandResult.stderr}`;
  return {
    ...commandResult,
    interrupt_requested_seen: combinedOutput.includes(
      "[interrupt] code=TURN_INTERRUPT_OK detail=requested source=command",
    ),
    interrupt_event_requested_seen: combinedOutput.includes(
      "[interrupt] event=requested source=command",
    ),
    interrupt_event_applied_seen: combinedOutput.includes(
      "[interrupt] event=applied source=command",
    ),
    interrupt_notice_seen: combinedOutput.includes("[interrupt] turn interrupted"),
    interrupt_continue_hint_seen: combinedOutput.includes("You can send a new instruction."),
  };
}

function runStartSessionMenuViewModelContract(repoRoot) {
  const scriptPath = resolve(repoRoot, "gateway/src/extensions/contracts/start-session-menu-contract.ts");
  const contractResult = runCommand(repoRoot, [
    "npx",
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    scriptPath,
  ]);
  if (contractResult.exit_code !== 0) {
    return contractResult;
  }
  try {
    const parsed = JSON.parse(contractResult.stdout);
    return {
      ...contractResult,
      ...parsed,
    };
  } catch (error) {
    return {
      ...contractResult,
      exit_code: 1,
      parse_error: String(error),
    };
  }
}

function runStartPlanModeFlow(repoRoot) {
  const workDir = createTempDir("grobot-plan-work");
  const homeDir = createTempDir("grobot-plan-home");
  const config = writeConfig(buildSmokeConfig(workDir));
  const commandResult = runCommand(
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
      "plan-smoke-user",
      "--history-turns",
      "8",
    ],
    null,
      [
        "/plan implement plan-mode skeleton",
        "Implement the plan.",
        "/plan open",
        "/exit",
        "",
      ].join("\n"),
  );
  const namespaceKey = "feishu:grobot:dm:plan-smoke-user";
  const registryPath = `${workDir}/.grobot/sessions/${sanitizeSessionKey(namespaceKey)}.sessions.json`;
  const registryPayload = readJsonFileSafe(registryPath);
  const sessions = registryPayload && Array.isArray(registryPayload.sessions) ? registryPayload.sessions : [];
  const activeSessionId = registryPayload && typeof registryPayload.active_id === "string" ? registryPayload.active_id : "";
  let activeSessionKey = namespaceKey;
  for (const item of sessions) {
    if (!item || typeof item !== "object") {
      continue;
    }
    if (String(item.id ?? "") !== activeSessionId) {
      continue;
    }
    const key = typeof item.session_key === "string" ? item.session_key : "";
    if (key.trim().length > 0) {
      activeSessionKey = key.trim();
      break;
    }
  }
  const planDir = `${workDir}/.grobot/plans/${sanitizePlanSessionSegment(activeSessionKey)}`;
  const planIndexPath = `${planDir}/index.json`;
  const activePlanPath = `${planDir}/ACTIVE.md`;
  const eventsPath = `${planDir}/events.jsonl`;
  const planIndex = readJsonFileSafe(planIndexPath);
  const planEntries = planIndex && Array.isArray(planIndex.entries) ? planIndex.entries : [];
  const planEntry =
    planEntries.length > 0 && planEntries[0] && typeof planEntries[0] === "object"
      ? planEntries[0]
      : null;
  const reviewFailCount =
    planEntry && Number.isFinite(Number(planEntry.review_fail_count))
      ? Number(planEntry.review_fail_count)
      : 0;
  const blockedCount =
    planEntry && Number.isFinite(Number(planEntry.blocked_count))
      ? Number(planEntry.blocked_count)
      : 0;
  const eventsContent = readTextFileSafe(eventsPath);
  const combinedOutput = `${commandResult.stdout}\n${commandResult.stderr}`;
  const finalStatusMarkerCurrent =
    "[plan-status]\nplan_status_output_mode: full\nmode: plan_only\n[plan-current]";
  return {
    ...commandResult,
    registry_path: registryPath,
    plan_dir: planDir,
    plan_index_path: planIndexPath,
    active_plan_path: activePlanPath,
    events_path: eventsPath,
    events_count: eventsContent ? eventsContent.trim().split("\n").filter((line) => line.trim().length > 0).length : 0,
    session_count: sessions.length,
    active_session_id: activeSessionId,
    active_session_key: activeSessionKey,
    plan_entry_count: planEntries.length,
    plan_active_id: planIndex && typeof planIndex.active_plan_id === "string" ? planIndex.active_plan_id : "",
    plan_active_exists: existsSync(activePlanPath),
    review_failed_marker_seen:
      combinedOutput.includes("[plan-review] code=PLAN_REVIEW_FAILED")
      || combinedOutput.includes("[plan-review] code=PLAN_REVIEW_BLOCKED"),
    review_blocked_marker_seen: combinedOutput.includes("[plan-review] code=PLAN_REVIEW_BLOCKED"),
    plan_cancelled_marker_seen: combinedOutput.includes("[plan] cancelled plan_id="),
    plan_final_status_line_seen: combinedOutput.includes(finalStatusMarkerCurrent),
    plan_last_status: planEntry && typeof planEntry.status === "string" ? planEntry.status : "",
    plan_last_review_fail_count: reviewFailCount,
    plan_last_blocked_count: blockedCount,
    events_has_plan_review_failed: eventsContent.includes("\"event\":\"plan_review_failed\""),
    events_has_plan_mode_cancelled: eventsContent.includes("\"event\":\"plan_mode_cancelled\""),
  };
}

function runStartPlanConcurrencyFlow(repoRoot) {
  const appendAttempts = 8;
  const maxAttempts = 3;
  let lastPayload = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const workDir = createTempDir("grobot-plan-concurrency-work");
    const homeDir = createTempDir("grobot-plan-concurrency-home");
    const config = writeConfig(buildSmokeConfig(workDir));
    const subject = "plan-concurrency-user";
    const namespaceKey = `feishu:grobot:dm:${subject}`;
    const sessionId = sanitizePlanSessionSegment(namespaceKey);
    const baseArgs = [
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
      subject,
      "--history-turns",
      "8",
    ];
    const seedResult = runCommand(repoRoot, [...baseArgs, "--message", "/plan concurrency lock smoke"]);
    const prefix = baseArgs.map(shellEscape).join(" ");
    const shellLines = [
      "set +e",
      "fail=0",
      "pids=''",
    ];
    for (let index = 1; index <= appendAttempts; index += 1) {
      const message = `none of these: concurrent-note-${String(index)}`;
      shellLines.push(`(${prefix} --message ${shellEscape(message)}) &`);
      shellLines.push("pids=\"$pids $!\"");
    }
    shellLines.push("for pid in $pids; do");
    shellLines.push("  wait \"$pid\" || fail=1");
    shellLines.push("done");
    shellLines.push("exit $fail");
    const parallelResult = runShellScript(repoRoot, shellLines.join("\n"));
    const planDir = `${workDir}/.grobot/plans/${sessionId}`;
    const planIndexPath = `${planDir}/index.json`;
    const planIndex = readJsonFileSafe(planIndexPath);
    const planEntries = planIndex && Array.isArray(planIndex.entries) ? planIndex.entries : [];
    const activePlanId = planIndex && typeof planIndex.active_plan_id === "string" ? planIndex.active_plan_id : "";
    const activeEntry = planEntries.find((item) => item && typeof item === "object" && item.plan_id === activePlanId) || null;
    const activePlanContent =
      activeEntry && typeof activeEntry.filename === "string"
        ? readTextFileSafe(`${planDir}/${activeEntry.filename}`)
        : "";
    const noteMatches = activePlanContent.match(/concurrent-note-\d+/g) ?? [];
    const uniqueNotes = Array.from(new Set(noteMatches));
    const eventsPath = `${planDir}/events.jsonl`;
    const eventsContent = readTextFileSafe(eventsPath);
    const combinedOutput = [
      seedResult.stdout,
      seedResult.stderr,
      parallelResult.stdout,
      parallelResult.stderr,
    ].join("\n");
    const lockTimeoutCount = countOccurrences(combinedOutput, "plan artifact lock timeout");
    const payload = {
      attempt,
      max_attempts: maxAttempts,
      seed_exit_code: seedResult.exit_code,
      parallel_exit_code: parallelResult.exit_code,
      append_attempts: appendAttempts,
      append_hits: uniqueNotes.length,
      plan_dir: planDir,
      plan_index_path: planIndexPath,
      events_path: eventsPath,
      events_count: eventsContent ? eventsContent.trim().split("\n").filter((line) => line.trim().length > 0).length : 0,
      lock_timeout_count: lockTimeoutCount,
      plan_entry_count: planEntries.length,
      active_plan_id: activePlanId,
      active_plan_status: activeEntry && typeof activeEntry.status === "string" ? activeEntry.status : "",
    };
    const passed =
      seedResult.exit_code === 0 &&
      parallelResult.exit_code === 0 &&
      payload.append_hits === payload.append_attempts &&
      payload.lock_timeout_count === 0;
    if (passed) {
      return {
        exit_code: 0,
        ...payload,
      };
    }
    lastPayload = payload;
  }
  if (!lastPayload) {
    return {
      exit_code: 1,
      seed_exit_code: 1,
      parallel_exit_code: 1,
      append_attempts: appendAttempts,
      append_hits: 0,
      events_count: 0,
      lock_timeout_count: 0,
      plan_entry_count: 0,
      active_plan_id: "",
      active_plan_status: "",
      attempt: maxAttempts,
      max_attempts: maxAttempts,
    };
  }
  return {
    exit_code: 1,
    ...lastPayload,
  };
}

function writeMcpInstructionProjectToml(workDir) {
  const grobotDir = `${workDir}/.grobot`;
  mkdirSync(grobotDir, { recursive: true });
  writeFileSync(
    `${grobotDir}/project.toml`,
    [
      "schema_version = 1",
      'mode = "mvp"',
      "",
      "[mcp.instructions]",
      "enabled = true",
      'scope = "project_first"',
      "strict = false",
      "",
    ].join("\n"),
    "utf8",
  );
}

function writeProjectMcpRegistry(workDir) {
  const grobotDir = `${workDir}/.grobot`;
  mkdirSync(grobotDir, { recursive: true });
  writeFileSync(
    `${grobotDir}/mcp.toml`,
    [
      "[[servers]]",
      'name = "grok-search"',
      'command = "uvx"',
      "args = [\"--version\"]",
      "enabled = true",
      "",
    ].join("\n"),
    "utf8",
  );
}

function writeRulePack(path, content) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function runStartMcpInstructionEventsFlow(repoRoot) {
  const workDir = createTempDir("grobot-mcp-instruction-work");
  const homeDir = createTempDir("grobot-mcp-instruction-home");
  const config = writeConfig(buildSmokeConfig(workDir));
  const projectRulePath = `${workDir}/.grobot/rules/mcp/grok-search.md`;
  const globalRulePath = `${homeDir}/rules/mcp/grok-search.md`;

  writeMcpInstructionProjectToml(workDir);
  writeProjectMcpRegistry(workDir);
  writeRulePack(projectRulePath, "PROJECT_GROK_SEARCH_RULE\n");
  writeRulePack(globalRulePath, "GLOBAL_GROK_SEARCH_RULE\n");

  const baseArgs = [
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
    "mcp-instruction-user",
  ];

  const projectResult = runCommand(
    repoRoot,
    [...baseArgs, "--message", "mcp instruction pack project source smoke"],
    {
      GROBOT_STARTUP_DIAGNOSTICS: "1",
    },
  );

  writeRulePack(projectRulePath, "\n");
  writeRulePack(globalRulePath, "GLOBAL_GROK_SEARCH_RULE\n");
  const fallbackResult = runCommand(
    repoRoot,
    [...baseArgs, "--message", "mcp instruction pack fallback source smoke"],
    {
      GROBOT_STARTUP_DIAGNOSTICS: "1",
    },
  );

  writeRulePack(projectRulePath, "\n");
  writeRulePack(globalRulePath, "\n");
  const missingResult = runCommand(
    repoRoot,
    [...baseArgs, "--message", "mcp instruction pack missing smoke"],
    {
      GROBOT_STARTUP_DIAGNOSTICS: "1",
    },
  );

  return {
    project_exit_code: projectResult.exit_code,
    fallback_exit_code: fallbackResult.exit_code,
    missing_exit_code: missingResult.exit_code,
    project_pack_loaded_project: projectResult.stderr.includes(
      "event=pack_loaded server=grok-search source=project",
    ),
    project_prompt_injected: projectResult.stderr.includes(
      "event=prompt_injected servers=grok-search",
    ),
    fallback_used: fallbackResult.stderr.includes(
      "event=fallback_used server=grok-search from=project to=global",
    ),
    fallback_pack_loaded_global: fallbackResult.stderr.includes(
      "event=pack_loaded server=grok-search source=global",
    ),
    fallback_prompt_injected: fallbackResult.stderr.includes(
      "event=prompt_injected servers=grok-search",
    ),
    missing_pack_event: missingResult.stderr.includes(
      "event=pack_missing server=grok-search strict=false",
    ),
    missing_prompt_injected: missingResult.stderr.includes("event=prompt_injected"),
    strict_failure_seen: missingResult.stderr.includes("event=strict_failure"),
  };
}

function runFailoverRejectsPython(repoRoot) {
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

function runFailoverTsRust(repoRoot) {
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

function runProviderPoolMultiTurnTsRust(repoRoot, providerBaseUrl, providerCount, turnCount) {
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

function runStartSessionStoreRedisFallback(repoRoot) {
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

function writeExecutionProjectToml(workDir) {
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

function writeContextEngineTrimProjectToml(workDir) {
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

function writeContextEngineQualityGuardProjectToml(workDir) {
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

function writeContextEngineGraphAutotuneProjectToml(workDir) {
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

function runStatusTsRust(repoRoot, windowSize) {
  const workDir = createTempDir("grobot-status-work");
  writeExecutionProjectToml(workDir);
  const commandArgs = [
    "./grobot",
    "status",
    "--json",
    "--work-dir",
    workDir,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
  ];
  if (typeof windowSize === "number" && Number.isFinite(windowSize) && windowSize > 0) {
    commandArgs.push("--context-graph-cache-window-size", String(Math.floor(windowSize)));
  }
  const result = runCommand(repoRoot, commandArgs);
  const parsedStatus = parseJsonObjectSafe(result.stdout);
  const routeDecision = isObject(parsedStatus?.route_decision)
    ? parsedStatus.route_decision
    : null;
  const routeObserved = isObject(routeDecision?.observed)
    ? routeDecision.observed
    : null;
  const routeObservedProviderRuntimeStates = Array.isArray(routeObserved?.provider_runtime_states)
    ? routeObserved.provider_runtime_states
    : null;
  const routeFailover = isObject(routeDecision?.failover)
    ? routeDecision.failover
    : null;
  const topLevelCacheStats = isObject(parsedStatus?.cache_stats)
    ? parsedStatus.cache_stats
    : null;
  const runtimeHealth = isObject(parsedStatus?.runtime_health)
    ? parsedStatus.runtime_health
    : null;
  const runtimeTools = isObject(parsedStatus?.runtime_tools)
    ? parsedStatus.runtime_tools
    : null;
  const runtimeToolModelVisibleTools = Array.isArray(runtimeTools?.model_visible_tools)
    ? runtimeTools.model_visible_tools
    : [];
  const runtimeToolDispatchEnabledTools = Array.isArray(runtimeTools?.dispatch_enabled_tools)
    ? runtimeTools.dispatch_enabled_tools
    : [];
  const runtimeToolSurfaceDecision = isObject(runtimeTools?.surface_decision)
    ? runtimeTools.surface_decision
    : null;
  const runtimeToolSchemaProjection = isObject(runtimeTools?.schema_projection)
    ? runtimeTools.schema_projection
    : null;
  const runtimeToolSchemaProjectionDrift = isObject(runtimeTools?.schema_projection_drift)
    ? runtimeTools.schema_projection_drift
    : null;
  const runtimeToolSchemaProjectionDriftArgMismatchDetails =
    Array.isArray(runtimeToolSchemaProjectionDrift?.arg_mismatch_details)
      ? runtimeToolSchemaProjectionDrift.arg_mismatch_details
      : [];
  if (runtimeToolSchemaProjection?.source !== "runtime.tools.describe") {
    throw new Error(
      `runtime tool schema projection should be sourced from runtime.tools.describe: ${String(runtimeToolSchemaProjection?.source ?? "missing")}`,
    );
  }
  if (runtimeToolSchemaProjectionDrift?.checked !== true) {
    throw new Error(
      `runtime tool schema projection drift guard did not run: ${String(runtimeToolSchemaProjectionDrift?.reason ?? "missing")}`,
    );
  }
  if (runtimeToolSchemaProjectionDrift?.active === true) {
    throw new Error(
      `runtime tool schema projection drift detected: ${String(runtimeToolSchemaProjectionDrift.reason ?? "unknown")}`,
    );
  }
  assertRuntimeToolSchemaArgVisibility(runtimeToolSchemaProjection);
  const runtimeToolSurfaceDecisionScores = isObject(runtimeToolSurfaceDecision?.scores)
    ? runtimeToolSurfaceDecision.scores
    : null;
  const runtimeToolSurfaceDecisionSuppressed = Array.isArray(runtimeToolSurfaceDecision?.suppressed)
    ? runtimeToolSurfaceDecision.suppressed
    : [];
  const runtimeToolMetrics = isObject(runtimeTools?.metrics)
    ? runtimeTools.metrics
    : null;
  const runtimeToolRecoveryFeedback = isObject(runtimeTools?.recovery_feedback)
    ? runtimeTools.recovery_feedback
    : null;
  const runtimeToolRecoveryTimeline = Array.isArray(runtimeTools?.recovery_timeline)
    ? runtimeTools.recovery_timeline
    : [];
  const runtimeToolRecoveryTimelineLatest = isObject(runtimeToolRecoveryTimeline[0])
    ? runtimeToolRecoveryTimeline[0]
    : null;
  const runtimeToolRecoveryHealth = isObject(runtimeTools?.recovery_health)
    ? runtimeTools.recovery_health
    : null;
  const runtimeToolSurfaceAdaptation = isObject(runtimeTools?.surface_adaptation)
    ? runtimeTools.surface_adaptation
    : null;
  const runtimeToolSurfaceAdaptationOutcome = isObject(runtimeTools?.surface_adaptation_outcome)
    ? runtimeTools.surface_adaptation_outcome
    : null;
  const runtimeToolSurfaceAdaptationGuard = isObject(runtimeToolSurfaceAdaptationOutcome?.guard)
    ? runtimeToolSurfaceAdaptationOutcome.guard
    : null;
  const runtimeHealthCacheStats = isObject(runtimeHealth?.cache_stats)
    ? runtimeHealth.cache_stats
    : null;
  const runtimePromptCache = isObject(runtimeHealthCacheStats?.prompt_cache)
    ? runtimeHealthCacheStats.prompt_cache
    : null;
  const runtimePromptCacheWindow = isObject(runtimePromptCache?.window)
    ? runtimePromptCache.window
    : null;
  const contextGraphCacheStats = isObject(parsedStatus?.context_graph_cache_stats)
    ? parsedStatus.context_graph_cache_stats
    : null;
  const symbolQueryGraphCacheStats = isObject(contextGraphCacheStats?.symbol_query)
    ? contextGraphCacheStats.symbol_query
    : null;
  const symbolDeclarationGraphCacheStats = isObject(contextGraphCacheStats?.symbol_declaration)
    ? contextGraphCacheStats.symbol_declaration
    : null;
  const dependencyQueryGraphCacheStats = isObject(contextGraphCacheStats?.dependency_query)
    ? contextGraphCacheStats.dependency_query
    : null;
  const dependencyImportGraphCacheStats = isObject(contextGraphCacheStats?.dependency_import)
    ? contextGraphCacheStats.dependency_import
    : null;
  const contextGraphCacheWindow = isObject(contextGraphCacheStats?.window)
    ? contextGraphCacheStats.window
    : null;
  const contextGraphCacheAutotuneState = isObject(contextGraphCacheStats?.autotune_state)
    ? contextGraphCacheStats.autotune_state
    : null;
  const contextGraphCacheWindowDeltaTotals = isObject(contextGraphCacheWindow?.delta_totals)
    ? contextGraphCacheWindow.delta_totals
    : null;
  const symbolQueryWindowDeltaStats = isObject(contextGraphCacheWindowDeltaTotals?.symbol_query)
    ? contextGraphCacheWindowDeltaTotals.symbol_query
    : null;
  const symbolDeclarationWindowDeltaStats = isObject(contextGraphCacheWindowDeltaTotals?.symbol_declaration)
    ? contextGraphCacheWindowDeltaTotals.symbol_declaration
    : null;
  const dependencyQueryWindowDeltaStats = isObject(contextGraphCacheWindowDeltaTotals?.dependency_query)
    ? contextGraphCacheWindowDeltaTotals.dependency_query
    : null;
  const dependencyImportWindowDeltaStats = isObject(contextGraphCacheWindowDeltaTotals?.dependency_import)
    ? contextGraphCacheWindowDeltaTotals.dependency_import
    : null;
  const contextGraphCacheWindowQueryTotals = isObject(contextGraphCacheWindow?.query_totals)
    ? contextGraphCacheWindow.query_totals
    : null;
  const contextGraphCacheWindowOverallTotals = isObject(contextGraphCacheWindow?.overall_totals)
    ? contextGraphCacheWindow.overall_totals
    : null;
  const contextGraphCacheWindowQuality = isObject(contextGraphCacheWindow?.quality)
    ? contextGraphCacheWindow.quality
    : null;
  const contextGraphCacheWindowQualityDependency = isObject(contextGraphCacheWindowQuality?.dependency)
    ? contextGraphCacheWindowQuality.dependency
    : null;
  const contextGraphCacheWindowQualitySymbol = isObject(contextGraphCacheWindowQuality?.symbol)
    ? contextGraphCacheWindowQuality.symbol
    : null;
  const contextGraphCacheWindowDegradation = isObject(contextGraphCacheWindow?.degradation)
    ? contextGraphCacheWindow.degradation
    : null;
  const contextPersistentGraphIndex = isObject(parsedStatus?.context_persistent_graph_index)
    ? parsedStatus.context_persistent_graph_index
    : null;
  const contextPersistentGraphIndexLastRefresh = isObject(contextPersistentGraphIndex?.last_refresh)
    ? contextPersistentGraphIndex.last_refresh
    : null;
  const contextPersistentGraphIndexWindow = isObject(contextPersistentGraphIndex?.window)
    ? contextPersistentGraphIndex.window
    : null;
  const contextPersistentGraphIndexWindowModeCounts = isObject(contextPersistentGraphIndexWindow?.mode_counts)
    ? contextPersistentGraphIndexWindow.mode_counts
    : null;
  const contextPersistentGraphIndexWindowTotals = isObject(contextPersistentGraphIndexWindow?.totals)
    ? contextPersistentGraphIndexWindow.totals
    : null;
  const contextPersistentGraphIndexWindowRates = isObject(contextPersistentGraphIndexWindow?.rates)
    ? contextPersistentGraphIndexWindow.rates
    : null;
  const contextPersistentGraphIndexWindowLatest = isObject(contextPersistentGraphIndexWindow?.latest)
    ? contextPersistentGraphIndexWindow.latest
    : null;
  const contextPersistentGraphIndexDegradation = isObject(contextPersistentGraphIndex?.degradation)
    ? contextPersistentGraphIndex.degradation
    : null;
  const contextEngine = isObject(parsedStatus?.context_engine)
    ? parsedStatus.context_engine
    : null;
  const contextEngineThresholds = isObject(contextEngine?.thresholds)
    ? contextEngine.thresholds
    : null;
  const contextEngineRecovery = isObject(contextEngine?.recovery)
    ? contextEngine.recovery
    : null;
  const contextEnginePromptQuality = isObject(contextEngine?.prompt_quality)
    ? contextEngine.prompt_quality
    : null;
  const contextEnginePromptQualityGuardAdaptiveModeAllowlist = Array.isArray(
    contextEnginePromptQuality?.guard_adaptive_mode_allowlist,
  )
    ? contextEnginePromptQuality.guard_adaptive_mode_allowlist
    : null;
  const contextEnginePromptQualityGuardState = isObject(contextEngine?.prompt_quality_guard_state)
    ? contextEngine.prompt_quality_guard_state
    : null;
  const contextEnginePromptQualityGuardRuntimeAssessment = isObject(
    contextEngine?.prompt_quality_guard_runtime_assessment,
  )
    ? contextEngine.prompt_quality_guard_runtime_assessment
    : null;
  const contextEnginePromptQualityGuardAdaptivePolicy = isObject(
    contextEngine?.prompt_quality_guard_adaptive_policy,
  )
    ? contextEngine.prompt_quality_guard_adaptive_policy
    : null;
  const contextEnginePromptQualityGuardAdaptivePolicyAllowlist = Array.isArray(
    contextEnginePromptQualityGuardAdaptivePolicy?.allowlist,
  )
    ? contextEnginePromptQualityGuardAdaptivePolicy.allowlist
    : null;
  const contextEnginePromptQualityGuardAdaptivePolicyBase = isObject(
    contextEnginePromptQualityGuardAdaptivePolicy?.base_policy,
  )
    ? contextEnginePromptQualityGuardAdaptivePolicy.base_policy
    : null;
  const contextEnginePromptQualityGuardAdaptivePolicyEffective = isObject(
    contextEnginePromptQualityGuardAdaptivePolicy?.effective_policy,
  )
    ? contextEnginePromptQualityGuardAdaptivePolicy.effective_policy
    : null;
  const contextEnginePromptQualityGuardAdaptivePolicyAdjustment = isObject(
    contextEnginePromptQualityGuardAdaptivePolicy?.adjustment,
  )
    ? contextEnginePromptQualityGuardAdaptivePolicy.adjustment
    : null;
  const contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy = isObject(
    contextEnginePromptQualityGuardAdaptivePolicy?.pressure_policy,
  )
    ? contextEnginePromptQualityGuardAdaptivePolicy.pressure_policy
    : null;
  const contextEnginePromptQualityGuardAdaptivePolicyOutcomeReliability = isObject(
    contextEnginePromptQualityGuardAdaptivePolicy?.outcome_reliability,
  )
    ? contextEnginePromptQualityGuardAdaptivePolicy.outcome_reliability
    : null;
  const contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard = isObject(
    contextEnginePromptQualityGuardAdaptivePolicy?.outcome_drift_guard,
  )
    ? contextEnginePromptQualityGuardAdaptivePolicy.outcome_drift_guard
    : null;
  const contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary = isObject(
    contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.window_summary,
  )
    ? contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard.window_summary
    : null;
  const contextEnginePromptQualityGuardAdaptivePolicyWindow = isObject(
    contextEnginePromptQualityGuardAdaptivePolicy?.window,
  )
    ? contextEnginePromptQualityGuardAdaptivePolicy.window
    : null;
  const contextEngineGraphQualitySignals = isObject(contextEngine?.graph_quality_signals)
    ? contextEngine.graph_quality_signals
    : null;
  const contextEngineGraphQualitySignalsCombined = isObject(contextEngineGraphQualitySignals?.combined)
    ? contextEngineGraphQualitySignals.combined
    : null;
  const contextEngineGraphQualitySignalsCombinedDegradedSources = Array.isArray(
    contextEngineGraphQualitySignalsCombined?.degraded_sources,
  )
    ? contextEngineGraphQualitySignalsCombined.degraded_sources
    : null;
  const contextEngineLineage = isObject(contextEngine?.lineage)
    ? contextEngine.lineage
    : null;
  const contextEngineWorkspaceSignals = isObject(contextEngine?.workspace_signals)
    ? contextEngine.workspace_signals
    : null;
  const promptQualityWindow = isObject(contextEngine?.prompt_quality_window)
    ? contextEngine.prompt_quality_window
    : null;
  const promptQualityWindowAverageScores = isObject(promptQualityWindow?.average_scores)
    ? promptQualityWindow.average_scores
    : null;
  const promptQualityWindowLatestScores = isObject(promptQualityWindow?.latest_scores)
    ? promptQualityWindow.latest_scores
    : null;
  const promptQualityWindowLowQuality = isObject(promptQualityWindow?.low_quality)
    ? promptQualityWindow.low_quality
    : null;
  const promptQualityWindowStageCounts = isObject(promptQualityWindow?.stage_counts)
    ? promptQualityWindow.stage_counts
    : null;
  const promptQualityWindowSignalAverages = isObject(promptQualityWindow?.signal_averages)
    ? promptQualityWindow.signal_averages
    : null;
  const promptQualityWindowCompressionActivity = isObject(promptQualityWindow?.compression_activity)
    ? promptQualityWindow.compression_activity
    : null;
  const promptQualityWindowTokenBudget = isObject(promptQualityWindow?.token_budget)
    ? promptQualityWindow.token_budget
    : null;
  const promptQualityWindowStrategyActivity = isObject(promptQualityWindow?.strategy_activity)
    ? promptQualityWindow.strategy_activity
    : null;
  const promptQualityWindowStrategyTrends = isObject(promptQualityWindow?.strategy_trends)
    ? promptQualityWindow.strategy_trends
    : null;
  const promptQualityWindowStrategyTrendsShort = isObject(promptQualityWindowStrategyTrends?.short)
    ? promptQualityWindowStrategyTrends.short
    : null;
  const promptQualityWindowStrategyTrendsMedium = isObject(promptQualityWindowStrategyTrends?.medium)
    ? promptQualityWindowStrategyTrends.medium
    : null;
  const promptQualityWindowStrategyTrendsDelta = isObject(promptQualityWindowStrategyTrends?.delta)
    ? promptQualityWindowStrategyTrends.delta
    : null;
  const promptQualityWindowStrategyOutcomes = isObject(promptQualityWindow?.strategy_outcomes)
    ? promptQualityWindow.strategy_outcomes
    : null;
  const promptQualityWindowPressureTrends = isObject(promptQualityWindow?.pressure_trends)
    ? promptQualityWindow.pressure_trends
    : null;
  const promptQualityWindowPressureTrendsShort = isObject(promptQualityWindowPressureTrends?.short)
    ? promptQualityWindowPressureTrends.short
    : null;
  const promptQualityWindowPressureTrendsMedium = isObject(promptQualityWindowPressureTrends?.medium)
    ? promptQualityWindowPressureTrends.medium
    : null;
  const promptQualityWindowPressureTrendsDelta = isObject(promptQualityWindowPressureTrends?.delta)
    ? promptQualityWindowPressureTrends.delta
    : null;
  const promptQualityWindowDegradation = isObject(promptQualityWindow?.degradation)
    ? promptQualityWindow.degradation
    : null;
  const cacheStatsLocation = typeof parsedStatus?.cache_stats_location === "string"
    ? parsedStatus.cache_stats_location
    : null;
  return {
    ...result,
    status_json_parse_ok: Boolean(parsedStatus),
    status_has_route_decision: Boolean(routeDecision),
    status_has_route_observed: Boolean(routeObserved),
    status_has_route_observed_provider_runtime_states: Array.isArray(routeObservedProviderRuntimeStates),
    status_has_route_ordered_providers: Array.isArray(routeDecision?.ordered_providers),
    status_has_route_failover: Boolean(routeFailover),
    status_route_observed_source_type: typeof routeObserved?.source,
    status_has_runtime_tools: Boolean(runtimeTools),
    status_runtime_tool_surface_profile: runtimeTools?.tool_surface_profile ?? null,
    status_runtime_tool_surface_source_type: typeof runtimeTools?.tool_surface_source,
    status_runtime_tool_policy_version: runtimeTools?.tool_policy_version ?? null,
    status_runtime_tool_model_visible_tools_is_array: Array.isArray(runtimeTools?.model_visible_tools),
    status_runtime_tool_model_visible_tool_count: runtimeToolModelVisibleTools.length,
    status_runtime_tool_dispatch_enabled_tools_is_array: Array.isArray(runtimeTools?.dispatch_enabled_tools),
    status_runtime_tool_dispatch_enabled_tool_count: runtimeToolDispatchEnabledTools.length,
    status_runtime_tool_model_visible_has_prompt_enhancer:
      runtimeToolModelVisibleTools.includes("prompt_enhancer"),
    status_runtime_tool_model_visible_has_web_scan:
      runtimeToolModelVisibleTools.includes("web_scan"),
    status_runtime_tool_model_visible_has_glob:
      runtimeToolModelVisibleTools.includes("glob"),
    status_runtime_tool_schema_fingerprint_type: typeof runtimeTools?.schema_fingerprint,
    status_runtime_tool_schema_profiles_fingerprint_type: typeof runtimeTools?.schema_profiles_fingerprint,
    status_runtime_tool_schema_estimated_tokens_type: typeof runtimeTools?.schema_estimated_tokens,
    status_runtime_tool_advanced_schema_type: typeof runtimeTools?.advanced_tool_schema,
    status_runtime_tool_schema_projection_present: Boolean(runtimeToolSchemaProjection),
    status_runtime_tool_schema_projection_source_type: typeof runtimeToolSchemaProjection?.source,
    status_runtime_tool_schema_projection_profile: runtimeToolSchemaProjection?.profile ?? null,
    status_runtime_tool_schema_projection_mode_type: typeof runtimeToolSchemaProjection?.projection_mode,
    status_runtime_tool_schema_projection_visible_count_type: typeof runtimeToolSchemaProjection?.visible_tool_count,
    status_runtime_tool_schema_projection_dispatch_count_type: typeof runtimeToolSchemaProjection?.dispatch_enabled_tool_count,
    status_runtime_tool_schema_projection_property_count_type: typeof runtimeToolSchemaProjection?.schema_property_count,
    status_runtime_tool_schema_projection_full_property_count_type: typeof runtimeToolSchemaProjection?.full_schema_property_count,
    status_runtime_tool_schema_projection_suppressed_property_count_type:
      typeof runtimeToolSchemaProjection?.suppressed_schema_property_count,
    status_runtime_tool_schema_projection_fingerprint_type: typeof runtimeToolSchemaProjection?.schema_fingerprint,
    status_runtime_tool_schema_projection_per_tool_type:
      typeof runtimeToolSchemaProjection?.per_tool_property_count,
    status_runtime_tool_schema_projection_visible_args_type:
      typeof runtimeToolSchemaProjection?.per_tool_visible_args,
    status_runtime_tool_schema_projection_suppressed_args_type:
      typeof runtimeToolSchemaProjection?.per_tool_suppressed_args,
    status_runtime_tool_schema_projection_visible_args_sum:
      sumStringArrayRecordLengths(runtimeToolSchemaProjection?.per_tool_visible_args),
    status_runtime_tool_schema_projection_suppressed_args_sum:
      sumStringArrayRecordLengths(runtimeToolSchemaProjection?.per_tool_suppressed_args),
    status_runtime_tool_schema_projection_drift_present: Boolean(runtimeToolSchemaProjectionDrift),
    status_runtime_tool_schema_projection_drift_checked_type: typeof runtimeToolSchemaProjectionDrift?.checked,
    status_runtime_tool_schema_projection_drift_active_type: typeof runtimeToolSchemaProjectionDrift?.active,
    status_runtime_tool_schema_projection_drift_reason_type: typeof runtimeToolSchemaProjectionDrift?.reason,
    status_runtime_tool_schema_projection_drift_runtime_visible_args_type:
      typeof runtimeToolSchemaProjectionDrift?.runtime_per_tool_visible_args,
    status_runtime_tool_schema_projection_drift_gateway_visible_args_type:
      typeof runtimeToolSchemaProjectionDrift?.gateway_per_tool_visible_args,
    status_runtime_tool_schema_projection_drift_runtime_suppressed_args_type:
      typeof runtimeToolSchemaProjectionDrift?.runtime_per_tool_suppressed_args,
    status_runtime_tool_schema_projection_drift_gateway_suppressed_args_type:
      typeof runtimeToolSchemaProjectionDrift?.gateway_per_tool_suppressed_args,
    status_runtime_tool_schema_projection_drift_runtime_visible_args_sum:
      sumStringArrayRecordLengths(runtimeToolSchemaProjectionDrift?.runtime_per_tool_visible_args),
    status_runtime_tool_schema_projection_drift_gateway_visible_args_sum:
      sumStringArrayRecordLengths(runtimeToolSchemaProjectionDrift?.gateway_per_tool_visible_args),
    status_runtime_tool_schema_projection_drift_runtime_suppressed_args_sum:
      sumStringArrayRecordLengths(runtimeToolSchemaProjectionDrift?.runtime_per_tool_suppressed_args),
    status_runtime_tool_schema_projection_drift_gateway_suppressed_args_sum:
      sumStringArrayRecordLengths(runtimeToolSchemaProjectionDrift?.gateway_per_tool_suppressed_args),
    status_runtime_tool_schema_projection_drift_arg_mismatch_details_is_array:
      Array.isArray(runtimeToolSchemaProjectionDrift?.arg_mismatch_details),
    status_runtime_tool_schema_projection_drift_arg_mismatch_details_count:
      runtimeToolSchemaProjectionDriftArgMismatchDetails.length,
    status_runtime_tool_surface_decision_present: Boolean(runtimeToolSurfaceDecision),
    status_runtime_tool_surface_decision_profile: runtimeToolSurfaceDecision?.profile ?? null,
    status_runtime_tool_surface_decision_reason_type: typeof runtimeToolSurfaceDecision?.reason,
    status_runtime_tool_surface_decision_scores_type: typeof runtimeToolSurfaceDecision?.scores,
    status_runtime_tool_surface_decision_score_coding_type: typeof runtimeToolSurfaceDecisionScores?.coding,
    status_runtime_tool_surface_decision_suppressed_is_array: Array.isArray(runtimeToolSurfaceDecision?.suppressed),
    status_runtime_tool_surface_decision_suppressed_count: runtimeToolSurfaceDecisionSuppressed.length,
    status_runtime_tool_metrics_present: Boolean(runtimeToolMetrics),
    status_runtime_tool_metrics_calls_total_type: typeof runtimeToolMetrics?.callsTotal,
    status_runtime_tool_metrics_failures_type: typeof runtimeToolMetrics?.failuresByErrorClass,
    status_runtime_tool_metrics_recovery_stages_type: typeof runtimeToolMetrics?.recoveryStages,
    status_runtime_tool_recovery_feedback_present: Boolean(runtimeToolRecoveryFeedback),
    status_runtime_tool_recovery_feedback_active_type: typeof runtimeToolRecoveryFeedback?.active,
    status_runtime_tool_recovery_feedback_severity_type: typeof runtimeToolRecoveryFeedback?.severity,
    status_runtime_tool_recovery_feedback_reason_type: typeof runtimeToolRecoveryFeedback?.reason,
    status_runtime_tool_recovery_feedback_recoverable_type: typeof runtimeToolRecoveryFeedback?.recoverable,
    status_runtime_tool_recovery_feedback_requires_user_intervention_type:
      typeof runtimeToolRecoveryFeedback?.requires_user_intervention,
    status_runtime_tool_recovery_feedback_consumed_type: typeof runtimeToolRecoveryFeedback?.consumed,
    status_runtime_tool_recovery_feedback_consumed_reason_type: typeof runtimeToolRecoveryFeedback?.consumed_reason,
    status_runtime_tool_recovery_feedback_observed_at_type: typeof runtimeToolRecoveryFeedback?.observed_at,
    status_runtime_tool_recovery_timeline_is_array: Array.isArray(runtimeTools?.recovery_timeline),
    status_runtime_tool_recovery_timeline_count: runtimeToolRecoveryTimeline.length,
    status_runtime_tool_recovery_timeline_latest_recovery_key_type:
      typeof runtimeToolRecoveryTimelineLatest?.recovery_key,
    status_runtime_tool_recovery_timeline_latest_active_type: typeof runtimeToolRecoveryTimelineLatest?.active,
    status_runtime_tool_recovery_timeline_latest_consumed_type: typeof runtimeToolRecoveryTimelineLatest?.consumed,
    status_runtime_tool_recovery_timeline_latest_stage_type: typeof runtimeToolRecoveryTimelineLatest?.stage,
    status_runtime_tool_recovery_health_present: Boolean(runtimeToolRecoveryHealth),
    status_runtime_tool_recovery_health_timeline_count_type:
      typeof runtimeToolRecoveryHealth?.timeline_entry_count,
    status_runtime_tool_recovery_health_score_type:
      typeof runtimeToolRecoveryHealth?.score,
    status_runtime_tool_recovery_health_level_type:
      typeof runtimeToolRecoveryHealth?.level,
    status_runtime_tool_recovery_health_reason_type:
      typeof runtimeToolRecoveryHealth?.reason,
    status_runtime_tool_recovery_health_recommended_action_type:
      typeof runtimeToolRecoveryHealth?.recommended_next_action,
    status_runtime_tool_recovery_health_attention_source_type:
      typeof runtimeToolRecoveryHealth?.attention_source,
    status_runtime_tool_recovery_health_attention_key_type:
      typeof runtimeToolRecoveryHealth?.attention_recovery_key,
    status_runtime_tool_recovery_health_attention_tool_name_type:
      typeof runtimeToolRecoveryHealth?.attention_tool_name,
    status_runtime_tool_recovery_health_attention_requires_user_intervention_type:
      typeof runtimeToolRecoveryHealth?.attention_requires_user_intervention,
    status_runtime_tool_recovery_health_attention_age_ms_type:
      typeof runtimeToolRecoveryHealth?.attention_age_ms,
    status_runtime_tool_recovery_health_active_count_type:
      typeof runtimeToolRecoveryHealth?.active_recovery_count,
    status_runtime_tool_recovery_health_unconsumed_count_type:
      typeof runtimeToolRecoveryHealth?.unconsumed_count,
    status_runtime_tool_recovery_health_latest_key_type:
      typeof runtimeToolRecoveryHealth?.latest_recovery_key,
    status_runtime_tool_recovery_health_has_stuck_type:
      typeof runtimeToolRecoveryHealth?.has_stuck_nonrecoverable,
    status_runtime_tool_surface_adaptation_present: Boolean(runtimeToolSurfaceAdaptation),
    status_runtime_tool_surface_adaptation_active_type: typeof runtimeToolSurfaceAdaptation?.active,
    status_runtime_tool_surface_adaptation_reason_type: typeof runtimeToolSurfaceAdaptation?.reason,
    status_runtime_tool_surface_adaptation_from_profile_type: typeof runtimeToolSurfaceAdaptation?.from_profile,
    status_runtime_tool_surface_adaptation_applied_profile_type: typeof runtimeToolSurfaceAdaptation?.applied_profile,
    status_runtime_tool_surface_adaptation_auto_blocked_type:
      typeof runtimeToolSurfaceAdaptation?.auto_adaptation_blocked,
    status_runtime_tool_surface_adaptation_recoverable_type: typeof runtimeToolSurfaceAdaptation?.recovery_recoverable,
    status_runtime_tool_surface_adaptation_observed_at_type: typeof runtimeToolSurfaceAdaptation?.recovery_observed_at,
    status_runtime_tool_surface_adaptation_outcome_present: Boolean(runtimeToolSurfaceAdaptationOutcome),
    status_runtime_tool_surface_adaptation_outcome_path_type: typeof runtimeToolSurfaceAdaptationOutcome?.path,
    status_runtime_tool_surface_adaptation_outcome_recent_count_type: typeof runtimeToolSurfaceAdaptationOutcome?.recent_adaptation_count,
    status_runtime_tool_surface_adaptation_outcome_profile_outcomes_type: typeof runtimeToolSurfaceAdaptationOutcome?.profile_outcomes,
    status_runtime_tool_surface_adaptation_outcome_consumption_count_type: typeof runtimeToolSurfaceAdaptationOutcome?.recent_recovery_consumption_count,
    status_runtime_tool_surface_adaptation_outcome_latest_consumption_type: typeof runtimeToolSurfaceAdaptationOutcome?.latest_recovery_consumption,
    status_runtime_tool_surface_adaptation_guard_present: Boolean(runtimeToolSurfaceAdaptationGuard),
    status_runtime_tool_surface_adaptation_guard_active_type: typeof runtimeToolSurfaceAdaptationGuard?.active,
    status_runtime_tool_surface_adaptation_guard_reason_type: typeof runtimeToolSurfaceAdaptationGuard?.reason,
    status_has_runtime_health_cache_stats: Boolean(runtimeHealthCacheStats),
    status_has_top_level_cache_stats: Boolean(topLevelCacheStats),
    status_cache_stats_location: cacheStatsLocation,
    status_prompt_cache_hint_attempted_type: typeof runtimePromptCache?.hint_attempted_total,
    status_prompt_cache_window_hint_attempted_type: typeof runtimePromptCacheWindow?.hint_attempted_total,
    status_has_context_graph_cache_stats: Boolean(contextGraphCacheStats),
    status_symbol_query_cache_hit_type: typeof symbolQueryGraphCacheStats?.hit,
    status_symbol_declaration_cache_write_type: typeof symbolDeclarationGraphCacheStats?.write,
    status_dependency_query_cache_miss_type: typeof dependencyQueryGraphCacheStats?.miss,
    status_dependency_import_cache_evict_type: typeof dependencyImportGraphCacheStats?.evict,
    status_context_graph_cache_autotune_state_present: Boolean(contextGraphCacheAutotuneState),
    status_context_graph_cache_autotune_state_last_direction_type:
      typeof contextGraphCacheAutotuneState?.last_direction,
    status_context_graph_cache_autotune_state_hold_turns_remaining_type:
      typeof contextGraphCacheAutotuneState?.hold_turns_remaining,
    status_context_graph_cache_autotune_state_downshift_warmup_streak_type:
      typeof contextGraphCacheAutotuneState?.downshift_warmup_streak,
    status_context_graph_cache_autotune_state_last_reason_type:
      contextGraphCacheAutotuneState?.last_reason === null
        ? "null"
        : typeof contextGraphCacheAutotuneState?.last_reason,
    status_context_graph_cache_autotune_state_updated_at_type:
      contextGraphCacheAutotuneState?.updated_at === null
        ? "null"
        : typeof contextGraphCacheAutotuneState?.updated_at,
    status_context_graph_cache_autotune_state_adaptive_cache_threshold_type:
      typeof contextGraphCacheAutotuneState?.adaptive_cache_query_hit_rate_threshold,
    status_context_graph_cache_autotune_state_adaptive_parsed_max_type:
      typeof contextGraphCacheAutotuneState?.adaptive_persistent_parsed_per_scanned_max,
    status_context_graph_cache_autotune_state_adaptive_reused_min_type:
      typeof contextGraphCacheAutotuneState?.adaptive_persistent_reused_per_scanned_min,
    status_context_graph_cache_autotune_state_adaptive_removed_max_type:
      typeof contextGraphCacheAutotuneState?.adaptive_persistent_removed_per_scanned_max,
    status_context_graph_cache_autotune_state_adaptive_alpha_type:
      typeof contextGraphCacheAutotuneState?.adaptive_learn_alpha,
    status_context_graph_cache_autotune_state_adaptive_updates_type:
      typeof contextGraphCacheAutotuneState?.adaptive_updates,
    status_context_graph_cache_autotune_state_adaptive_source_type:
      typeof contextGraphCacheAutotuneState?.adaptive_source,
    status_context_graph_cache_autotune_state_adaptive_action_scale_type:
      typeof contextGraphCacheAutotuneState?.adaptive_action_scale,
    status_context_graph_cache_autotune_state_adaptive_action_updates_type:
      typeof contextGraphCacheAutotuneState?.adaptive_action_updates,
    status_context_graph_cache_autotune_state_adaptive_action_source_type:
      typeof contextGraphCacheAutotuneState?.adaptive_action_source,
    status_context_graph_cache_autotune_state_persistence_domain_type:
      typeof contextGraphCacheAutotuneState?.persistence_domain,
    status_has_context_graph_cache_window: Boolean(contextGraphCacheWindow),
    status_context_graph_cache_window_path_type: typeof contextGraphCacheWindow?.path,
    status_context_graph_cache_window_configured_size_type: typeof contextGraphCacheWindow?.configured_size,
    status_context_graph_cache_window_configured_size_value:
      typeof contextGraphCacheWindow?.configured_size === "number"
        ? contextGraphCacheWindow.configured_size
        : null,
    status_context_graph_cache_window_persistence_domain_type:
      typeof contextGraphCacheWindow?.persistence_domain,
    status_context_graph_cache_window_persistence_domain_value:
      typeof contextGraphCacheWindow?.persistence_domain === "string"
        ? contextGraphCacheWindow.persistence_domain
        : null,
    status_context_graph_cache_window_entries_type: typeof contextGraphCacheWindow?.entries,
    status_context_graph_cache_window_from_ts_type: contextGraphCacheWindow?.from_ts === null
      ? "null"
      : typeof contextGraphCacheWindow?.from_ts,
    status_context_graph_cache_window_to_ts_type: contextGraphCacheWindow?.to_ts === null
      ? "null"
      : typeof contextGraphCacheWindow?.to_ts,
    status_context_graph_cache_window_delta_symbol_query_hit_type: typeof symbolQueryWindowDeltaStats?.hit,
    status_context_graph_cache_window_delta_symbol_declaration_write_type: typeof symbolDeclarationWindowDeltaStats?.write,
    status_context_graph_cache_window_delta_dependency_query_miss_type: typeof dependencyQueryWindowDeltaStats?.miss,
    status_context_graph_cache_window_delta_dependency_import_evict_type: typeof dependencyImportWindowDeltaStats?.evict,
    status_context_graph_cache_window_query_totals_hit_type: typeof contextGraphCacheWindowQueryTotals?.hit,
    status_context_graph_cache_window_overall_totals_hit_type: typeof contextGraphCacheWindowOverallTotals?.hit,
    status_context_graph_cache_window_query_hit_rate_type: contextGraphCacheWindow?.query_hit_rate === null
      ? "null"
      : typeof contextGraphCacheWindow?.query_hit_rate,
    status_context_graph_cache_window_overall_hit_rate_type: contextGraphCacheWindow?.overall_hit_rate === null
      ? "null"
      : typeof contextGraphCacheWindow?.overall_hit_rate,
    status_context_graph_cache_window_has_quality: Boolean(contextGraphCacheWindowQuality),
    status_context_graph_cache_window_quality_entries_with_quality_type:
      typeof contextGraphCacheWindowQuality?.entries_with_quality,
    status_context_graph_cache_window_quality_dependency_avg_rows_type:
      contextGraphCacheWindowQualityDependency?.avg_rows === null
        ? "null"
        : typeof contextGraphCacheWindowQualityDependency?.avg_rows,
    status_context_graph_cache_window_quality_dependency_avg_max_chain_depth_type:
      contextGraphCacheWindowQualityDependency?.avg_max_chain_depth === null
        ? "null"
        : typeof contextGraphCacheWindowQualityDependency?.avg_max_chain_depth,
    status_context_graph_cache_window_quality_dependency_multi_hop_rate_type:
      contextGraphCacheWindowQualityDependency?.multi_hop_rate === null
        ? "null"
        : typeof contextGraphCacheWindowQualityDependency?.multi_hop_rate,
    status_context_graph_cache_window_quality_symbol_bridge_coverage_rate_type:
      contextGraphCacheWindowQualitySymbol?.bridge_coverage_rate === null
        ? "null"
        : typeof contextGraphCacheWindowQualitySymbol?.bridge_coverage_rate,
    status_context_graph_cache_window_quality_symbol_breadth_coverage_rate_type:
      contextGraphCacheWindowQualitySymbol?.breadth_coverage_rate === null
        ? "null"
        : typeof contextGraphCacheWindowQualitySymbol?.breadth_coverage_rate,
    status_context_graph_cache_window_quality_symbol_avg_refs_type:
      contextGraphCacheWindowQualitySymbol?.avg_refs === null
        ? "null"
        : typeof contextGraphCacheWindowQualitySymbol?.avg_refs,
    status_context_graph_cache_window_quality_symbol_max_refs_type:
      contextGraphCacheWindowQualitySymbol?.max_refs === null
        ? "null"
        : typeof contextGraphCacheWindowQualitySymbol?.max_refs,
    status_context_graph_cache_window_has_degradation: Boolean(contextGraphCacheWindowDegradation),
    status_context_graph_cache_window_degradation_degraded_type: typeof contextGraphCacheWindowDegradation?.degraded,
    status_context_graph_cache_window_degradation_reason_type: typeof contextGraphCacheWindowDegradation?.reason,
    status_context_graph_cache_window_degradation_threshold_type:
      typeof contextGraphCacheWindowDegradation?.threshold_query_hit_rate,
    status_context_graph_cache_window_degradation_min_entries_type:
      typeof contextGraphCacheWindowDegradation?.min_entries,
    status_context_graph_cache_window_degradation_observed_entries_type:
      typeof contextGraphCacheWindowDegradation?.observed_entries,
    status_context_graph_cache_window_degradation_observed_query_hit_rate_type:
      contextGraphCacheWindowDegradation?.observed_query_hit_rate === null
        ? "null"
        : typeof contextGraphCacheWindowDegradation?.observed_query_hit_rate,
    status_has_context_persistent_graph_index: Boolean(contextPersistentGraphIndex),
    status_context_persistent_graph_index_enabled_type: typeof contextPersistentGraphIndex?.enabled,
    status_context_persistent_graph_index_root_path_type: typeof contextPersistentGraphIndex?.root_path,
    status_context_persistent_graph_index_index_path_type: typeof contextPersistentGraphIndex?.index_path,
    status_context_persistent_graph_index_persistence_domain_type:
      typeof contextPersistentGraphIndex?.persistence_domain,
    status_context_persistent_graph_index_persistence_domain_value:
      typeof contextPersistentGraphIndex?.persistence_domain === "string"
        ? contextPersistentGraphIndex.persistence_domain
        : null,
    status_context_persistent_graph_index_updated_at_type:
      contextPersistentGraphIndex?.updated_at === null
        ? "null"
        : typeof contextPersistentGraphIndex?.updated_at,
    status_context_persistent_graph_index_file_count_type: typeof contextPersistentGraphIndex?.file_count,
    status_context_persistent_graph_index_symbol_count_type: typeof contextPersistentGraphIndex?.symbol_count,
    status_context_persistent_graph_index_edge_count_type: typeof contextPersistentGraphIndex?.edge_count,
    status_context_persistent_graph_index_has_last_refresh: Boolean(contextPersistentGraphIndexLastRefresh),
    status_context_persistent_graph_index_last_refresh_mode_type:
      typeof contextPersistentGraphIndexLastRefresh?.mode,
    status_context_persistent_graph_index_last_refresh_parsed_files_type:
      typeof contextPersistentGraphIndexLastRefresh?.parsed_files,
    status_context_persistent_graph_index_last_refresh_reused_files_type:
      typeof contextPersistentGraphIndexLastRefresh?.reused_files,
    status_context_persistent_graph_index_last_refresh_removed_files_type:
      typeof contextPersistentGraphIndexLastRefresh?.removed_files,
    status_context_persistent_graph_index_has_window: Boolean(contextPersistentGraphIndexWindow),
    status_context_persistent_graph_index_window_path_type:
      typeof contextPersistentGraphIndexWindow?.path,
    status_context_persistent_graph_index_window_configured_size_type:
      typeof contextPersistentGraphIndexWindow?.configured_size,
    status_context_persistent_graph_index_window_configured_size_value:
      typeof contextPersistentGraphIndexWindow?.configured_size === "number"
        ? contextPersistentGraphIndexWindow.configured_size
        : null,
    status_context_persistent_graph_index_window_persistence_domain_type:
      typeof contextPersistentGraphIndexWindow?.persistence_domain,
    status_context_persistent_graph_index_window_persistence_domain_value:
      typeof contextPersistentGraphIndexWindow?.persistence_domain === "string"
        ? contextPersistentGraphIndexWindow.persistence_domain
        : null,
    status_context_persistent_graph_index_window_entries_type:
      typeof contextPersistentGraphIndexWindow?.entries,
    status_context_persistent_graph_index_window_from_ts_type:
      contextPersistentGraphIndexWindow?.from_ts === null
        ? "null"
        : typeof contextPersistentGraphIndexWindow?.from_ts,
    status_context_persistent_graph_index_window_to_ts_type:
      contextPersistentGraphIndexWindow?.to_ts === null
        ? "null"
        : typeof contextPersistentGraphIndexWindow?.to_ts,
    status_context_persistent_graph_index_window_mode_counts_incremental_type:
      typeof contextPersistentGraphIndexWindowModeCounts?.incremental,
    status_context_persistent_graph_index_window_totals_parsed_files_type:
      typeof contextPersistentGraphIndexWindowTotals?.parsed_files,
    status_context_persistent_graph_index_window_totals_reused_files_type:
      typeof contextPersistentGraphIndexWindowTotals?.reused_files,
    status_context_persistent_graph_index_window_rates_parsed_per_scanned_type:
      contextPersistentGraphIndexWindowRates?.parsed_per_scanned === null
        ? "null"
        : typeof contextPersistentGraphIndexWindowRates?.parsed_per_scanned,
    status_context_persistent_graph_index_window_rates_reused_per_scanned_type:
      contextPersistentGraphIndexWindowRates?.reused_per_scanned === null
        ? "null"
        : typeof contextPersistentGraphIndexWindowRates?.reused_per_scanned,
    status_context_persistent_graph_index_window_rates_removed_per_scanned_type:
      contextPersistentGraphIndexWindowRates?.removed_per_scanned === null
        ? "null"
        : typeof contextPersistentGraphIndexWindowRates?.removed_per_scanned,
    status_context_persistent_graph_index_window_has_latest:
      contextPersistentGraphIndexWindow?.latest === null
        ? true
        : Boolean(contextPersistentGraphIndexWindowLatest),
    status_context_persistent_graph_index_window_latest_mode_type:
      contextPersistentGraphIndexWindowLatest == null
        ? "null"
        : typeof contextPersistentGraphIndexWindowLatest?.mode,
    status_context_persistent_graph_index_window_latest_parsed_files_type:
      contextPersistentGraphIndexWindowLatest == null
        ? "null"
        : typeof contextPersistentGraphIndexWindowLatest?.parsed_files,
    status_context_persistent_graph_index_window_latest_file_count_type:
      contextPersistentGraphIndexWindowLatest == null
        ? "null"
        : typeof contextPersistentGraphIndexWindowLatest?.file_count,
    status_context_persistent_graph_index_has_degradation:
      Boolean(contextPersistentGraphIndexDegradation),
    status_context_persistent_graph_index_degradation_degraded_type:
      typeof contextPersistentGraphIndexDegradation?.degraded,
    status_context_persistent_graph_index_degradation_reason_type:
      typeof contextPersistentGraphIndexDegradation?.reason,
    status_context_persistent_graph_index_degradation_threshold_parsed_type:
      typeof contextPersistentGraphIndexDegradation?.threshold_parsed_per_scanned_max,
    status_context_persistent_graph_index_degradation_threshold_reused_type:
      typeof contextPersistentGraphIndexDegradation?.threshold_reused_per_scanned_min,
    status_context_persistent_graph_index_degradation_threshold_removed_type:
      typeof contextPersistentGraphIndexDegradation?.threshold_removed_per_scanned_max,
    status_context_persistent_graph_index_degradation_observed_parsed_type:
      contextPersistentGraphIndexDegradation?.observed_parsed_per_scanned === null
        ? "null"
        : typeof contextPersistentGraphIndexDegradation?.observed_parsed_per_scanned,
    status_context_persistent_graph_index_degradation_observed_reused_type:
      contextPersistentGraphIndexDegradation?.observed_reused_per_scanned === null
        ? "null"
        : typeof contextPersistentGraphIndexDegradation?.observed_reused_per_scanned,
    status_context_persistent_graph_index_degradation_observed_removed_type:
      contextPersistentGraphIndexDegradation?.observed_removed_per_scanned === null
        ? "null"
        : typeof contextPersistentGraphIndexDegradation?.observed_removed_per_scanned,
    status_has_context_engine: Boolean(contextEngine),
    status_context_engine_enabled_type: typeof contextEngine?.enabled,
    status_context_engine_profile_type: typeof contextEngine?.profile,
    status_context_engine_auto_limit_type: typeof contextEngine?.auto_compact_token_limit,
    status_context_engine_target_limit_type: typeof contextEngine?.target_token_limit,
    status_context_engine_effective_window_type: typeof contextEngine?.effective_window_tokens,
    status_context_engine_threshold_hard_type: typeof contextEngineThresholds?.hard_ratio,
    status_context_engine_recovery_ptl_type: typeof contextEngineRecovery?.ptl_max_retries,
    status_context_engine_prompt_quality_low_quality_threshold_type:
      typeof contextEnginePromptQuality?.low_quality_threshold,
    status_context_engine_prompt_quality_degrade_overall_threshold_type:
      typeof contextEnginePromptQuality?.degrade_overall_threshold,
    status_context_engine_prompt_quality_degrade_low_quality_rate_threshold_type:
      typeof contextEnginePromptQuality?.degrade_low_quality_rate_threshold,
    status_context_engine_prompt_quality_degrade_min_entries_type:
      typeof contextEnginePromptQuality?.degrade_min_entries,
    status_context_engine_prompt_quality_guard_enabled_type:
      typeof contextEnginePromptQuality?.guard_enabled,
    status_context_engine_prompt_quality_guard_adaptive_enabled_type:
      typeof contextEnginePromptQuality?.guard_adaptive_enabled,
    status_context_engine_prompt_quality_guard_adaptive_mode_allowlist_type:
      Array.isArray(contextEnginePromptQualityGuardAdaptiveModeAllowlist) ? "array" : "undefined",
    status_context_engine_prompt_quality_guard_promote_streak_type:
      typeof contextEnginePromptQuality?.guard_promote_streak,
    status_context_engine_prompt_quality_guard_severe_promote_streak_type:
      typeof contextEnginePromptQuality?.guard_severe_promote_streak,
    status_context_engine_prompt_quality_guard_release_streak_type:
      typeof contextEnginePromptQuality?.guard_release_streak,
    status_context_engine_prompt_quality_guard_hold_turns_type:
      typeof contextEnginePromptQuality?.guard_hold_turns,
    status_context_engine_prompt_quality_guard_max_floor_stage_type:
      typeof contextEnginePromptQuality?.guard_max_floor_stage,
    status_context_engine_prompt_quality_guard_severe_overall_threshold_type:
      typeof contextEnginePromptQuality?.guard_severe_overall_threshold,
    status_context_engine_prompt_quality_guard_severe_low_quality_rate_threshold_type:
      typeof contextEnginePromptQuality?.guard_severe_low_quality_rate_threshold,
    status_context_engine_has_prompt_quality_guard_state:
      Boolean(contextEnginePromptQualityGuardState),
    status_context_engine_prompt_quality_guard_state_floor_stage_type:
      typeof contextEnginePromptQualityGuardState?.floor_stage,
    status_context_engine_prompt_quality_guard_state_degraded_streak_type:
      typeof contextEnginePromptQualityGuardState?.degraded_streak,
    status_context_engine_prompt_quality_guard_state_severe_streak_type:
      typeof contextEnginePromptQualityGuardState?.severe_streak,
    status_context_engine_prompt_quality_guard_state_healthy_streak_type:
      typeof contextEnginePromptQualityGuardState?.healthy_streak,
    status_context_engine_prompt_quality_guard_state_hold_turns_remaining_type:
      typeof contextEnginePromptQualityGuardState?.hold_turns_remaining,
    status_context_engine_prompt_quality_guard_state_last_reason_type:
      typeof contextEnginePromptQualityGuardState?.last_reason,
    status_context_engine_prompt_quality_guard_state_updated_at_type:
      contextEnginePromptQualityGuardState?.updated_at === null
        ? "null"
        : typeof contextEnginePromptQualityGuardState?.updated_at,
    status_context_engine_prompt_quality_guard_state_pressure_utilization_threshold_type:
      typeof contextEnginePromptQualityGuardState?.pressure_utilization_threshold,
    status_context_engine_prompt_quality_guard_state_pressure_semantic_rate_threshold_type:
      typeof contextEnginePromptQualityGuardState?.pressure_semantic_rate_threshold,
    status_context_engine_prompt_quality_guard_state_pressure_auto_limit_rate_threshold_type:
      typeof contextEnginePromptQualityGuardState?.pressure_auto_limit_rate_threshold,
    status_context_engine_prompt_quality_guard_state_pressure_joint_rate_threshold_type:
      typeof contextEnginePromptQualityGuardState?.pressure_joint_rate_threshold,
    status_context_engine_prompt_quality_guard_state_pressure_trend_utilization_delta_type:
      typeof contextEnginePromptQualityGuardState?.pressure_trend_utilization_delta,
    status_context_engine_prompt_quality_guard_state_pressure_trend_semantic_delta_type:
      typeof contextEnginePromptQualityGuardState?.pressure_trend_semantic_delta,
    status_context_engine_prompt_quality_guard_state_pressure_trend_auto_limit_delta_type:
      typeof contextEnginePromptQualityGuardState?.pressure_trend_auto_limit_delta,
    status_context_engine_prompt_quality_guard_state_pressure_trend_momentum_type:
      typeof contextEnginePromptQualityGuardState?.pressure_trend_momentum,
    status_context_engine_prompt_quality_guard_state_outcome_required_transitions_type:
      typeof contextEnginePromptQualityGuardState?.outcome_required_transitions,
    status_context_engine_prompt_quality_guard_state_outcome_combined_evidence_score_type:
      typeof contextEnginePromptQualityGuardState?.outcome_combined_evidence_score,
    status_context_engine_prompt_quality_guard_state_outcome_high_evidence_turns_type:
      typeof contextEnginePromptQualityGuardState?.outcome_high_evidence_turns,
    status_context_engine_prompt_quality_guard_state_outcome_high_evidence_harden_turns_type:
      typeof contextEnginePromptQualityGuardState?.outcome_high_evidence_harden_turns,
    status_context_engine_prompt_quality_guard_state_outcome_drift_recent_auto_action_levels_type:
      Array.isArray(contextEnginePromptQualityGuardState?.outcome_drift_recent_auto_action_levels)
        ? "array"
        : typeof contextEnginePromptQualityGuardState?.outcome_drift_recent_auto_action_levels,
    status_context_engine_prompt_quality_guard_state_persistence_domain_type:
      typeof contextEnginePromptQualityGuardState?.persistence_domain,
    status_context_engine_has_prompt_quality_guard_runtime_assessment:
      Boolean(contextEnginePromptQualityGuardRuntimeAssessment),
    status_context_engine_prompt_quality_guard_runtime_assessment_enabled_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.enabled,
    status_context_engine_prompt_quality_guard_runtime_assessment_phase_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.phase,
    status_context_engine_prompt_quality_guard_runtime_assessment_transition_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.transition,
    status_context_engine_prompt_quality_guard_runtime_assessment_degraded_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.degraded,
    status_context_engine_prompt_quality_guard_runtime_assessment_severe_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.severe,
    status_context_engine_prompt_quality_guard_runtime_assessment_reason_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.reason,
    status_context_engine_prompt_quality_guard_runtime_assessment_triggered_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.triggered,
    status_context_engine_prompt_quality_guard_runtime_assessment_floor_stage_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.floor_stage,
    status_context_engine_prompt_quality_guard_runtime_assessment_proposed_floor_stage_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.proposed_floor_stage,
    status_context_engine_prompt_quality_guard_runtime_assessment_promote_remaining_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.promote_remaining,
    status_context_engine_prompt_quality_guard_runtime_assessment_severe_promote_remaining_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.severe_promote_remaining,
    status_context_engine_prompt_quality_guard_runtime_assessment_release_remaining_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.release_remaining,
    status_context_engine_prompt_quality_guard_runtime_assessment_hold_turns_remaining_type:
      typeof contextEnginePromptQualityGuardRuntimeAssessment?.hold_turns_remaining,
    status_context_engine_prompt_quality_guard_runtime_assessment_observed_overall_type:
      contextEnginePromptQualityGuardRuntimeAssessment?.observed_overall === null
        ? "null"
        : typeof contextEnginePromptQualityGuardRuntimeAssessment?.observed_overall,
    status_context_engine_prompt_quality_guard_runtime_assessment_observed_low_quality_rate_type:
      contextEnginePromptQualityGuardRuntimeAssessment?.observed_low_quality_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardRuntimeAssessment?.observed_low_quality_rate,
    status_context_engine_has_prompt_quality_guard_adaptive_policy:
      Boolean(contextEnginePromptQualityGuardAdaptivePolicy),
    status_context_engine_prompt_quality_guard_adaptive_policy_mode_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicy?.mode,
    status_context_engine_prompt_quality_guard_adaptive_policy_reason_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicy?.reason,
    status_context_engine_prompt_quality_guard_adaptive_policy_allowlist_type:
      Array.isArray(contextEnginePromptQualityGuardAdaptivePolicyAllowlist) ? "array" : "undefined",
    status_context_engine_prompt_quality_guard_adaptive_policy_mode_blocked_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicy?.mode_blocked,
    status_context_engine_prompt_quality_guard_adaptive_policy_blocked_mode_type:
      contextEnginePromptQualityGuardAdaptivePolicy?.blocked_mode === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicy?.blocked_mode,
    status_context_engine_prompt_quality_guard_adaptive_policy_base_promote_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyBase?.promote_streak,
    status_context_engine_prompt_quality_guard_adaptive_policy_effective_promote_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyEffective?.promote_streak,
    status_context_engine_prompt_quality_guard_adaptive_policy_effective_release_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyEffective?.release_streak,
    status_context_engine_prompt_quality_guard_adaptive_policy_effective_hold_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyEffective?.hold_turns,
    status_context_engine_prompt_quality_guard_adaptive_policy_adjustment_promote_delta_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyAdjustment?.promote_streak_delta,
    status_context_engine_prompt_quality_guard_adaptive_policy_adjustment_release_delta_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyAdjustment?.release_streak_delta,
    status_context_engine_prompt_quality_guard_adaptive_policy_adjustment_hold_delta_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyAdjustment?.hold_turns_delta,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_source_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.source,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_updated_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.updated,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_learn_alpha_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.learn_alpha,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_utilization_threshold_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.utilization_threshold,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_semantic_rate_threshold_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.semantic_rate_threshold,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_auto_limit_rate_threshold_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.auto_limit_rate_threshold,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_joint_rate_threshold_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.joint_rate_threshold,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_trend_utilization_delta_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.trend_utilization_delta,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_trend_semantic_delta_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.trend_semantic_delta,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_trend_auto_limit_delta_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.trend_auto_limit_delta,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_trend_momentum_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.trend_momentum,
    status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_trend_flip_suppressed_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyPressurePolicy?.trend_flip_suppressed,
    status_context_engine_prompt_quality_guard_adaptive_policy_outcome_required_transitions_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeReliability?.required_transitions,
    status_context_engine_prompt_quality_guard_adaptive_policy_outcome_next_required_transitions_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeReliability?.next_required_transitions,
    status_context_engine_prompt_quality_guard_adaptive_policy_outcome_hard_budget_transitions_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeReliability?.hard_budget_transitions,
    status_context_engine_prompt_quality_guard_adaptive_policy_outcome_quality_first_transitions_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeReliability?.quality_first_transitions,
    status_context_engine_prompt_quality_guard_adaptive_policy_outcome_hard_budget_evidence_score_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeReliability?.hard_budget_evidence_score,
    status_context_engine_prompt_quality_guard_adaptive_policy_outcome_quality_first_evidence_score_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeReliability?.quality_first_evidence_score,
    status_context_engine_prompt_quality_guard_adaptive_policy_outcome_combined_evidence_score_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeReliability?.combined_evidence_score,
    status_context_engine_prompt_quality_guard_adaptive_policy_outcome_hard_budget_reliable_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeReliability?.hard_budget_reliable,
    status_context_engine_prompt_quality_guard_adaptive_policy_outcome_quality_first_reliable_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeReliability?.quality_first_reliable,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_high_evidence_harden_bias_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.high_evidence_harden_bias,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_high_evidence_turn_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.high_evidence_turn,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_high_evidence_turns_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.high_evidence_turns,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_high_evidence_harden_turns_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.high_evidence_harden_turns,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_high_evidence_harden_rate_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.high_evidence_harden_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_threshold_harden_rate_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.threshold_harden_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_min_high_evidence_turns_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.min_high_evidence_turns,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_reason_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.reason,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_auto_action_level_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.auto_action_level,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_recent_auto_action_levels_type:
      Array.isArray(contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.recent_auto_action_levels)
        ? "array"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.recent_auto_action_levels,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_entries_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary?.entries,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_latest_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary?.latest,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_dominant_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary?.dominant,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_alert_level_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary?.alert_level,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_transition_count_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary?.transition_count,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_active_rate_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary?.active_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_medium_or_hard_rate_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary?.medium_or_hard_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_hard_rate_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary?.hard_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_level_counts_type:
      isObject(contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary?.level_counts)
        ? "object"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftWindowSummary?.level_counts,
    status_context_engine_prompt_quality_guard_adaptive_policy_drift_recommendation_type:
      typeof contextEnginePromptQualityGuardAdaptivePolicyOutcomeDriftGuard?.recommendation,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_semantic_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.snapshot_semantic_compress_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.snapshot_semantic_compress_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_auto_limit_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.auto_limit_triggered_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.auto_limit_triggered_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_avg_utilization_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.average_utilization_ratio === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.average_utilization_ratio,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_short_semantic_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_snapshot_semantic_compress_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_snapshot_semantic_compress_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_medium_semantic_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_snapshot_semantic_compress_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_snapshot_semantic_compress_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_short_auto_limit_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_auto_limit_triggered_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_auto_limit_triggered_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_medium_auto_limit_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_auto_limit_triggered_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_auto_limit_triggered_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_short_avg_utilization_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_average_utilization_ratio === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_average_utilization_ratio,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_medium_avg_utilization_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_average_utilization_ratio === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_average_utilization_ratio,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_hard_budget_strategy_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.hard_budget_strategy_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.hard_budget_strategy_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_quality_first_strategy_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.quality_first_strategy_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.quality_first_strategy_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_avg_pre_send_overflow_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.average_pre_send_overflow_ratio === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.average_pre_send_overflow_ratio,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_avg_pre_send_pressure_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.average_pre_send_pressure_score === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.average_pre_send_pressure_score,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_short_hard_budget_strategy_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_hard_budget_strategy_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_hard_budget_strategy_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_medium_hard_budget_strategy_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_hard_budget_strategy_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_hard_budget_strategy_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_short_avg_pre_send_overflow_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_average_pre_send_overflow_ratio === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_average_pre_send_overflow_ratio,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_medium_avg_pre_send_overflow_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_average_pre_send_overflow_ratio === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_average_pre_send_overflow_ratio,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_short_avg_pre_send_pressure_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_average_pre_send_pressure_score === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.short_average_pre_send_pressure_score,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_medium_avg_pre_send_pressure_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_average_pre_send_pressure_score === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.medium_average_pre_send_pressure_score,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_hard_budget_followup_delta_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.hard_budget_followup_overall_delta === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.hard_budget_followup_overall_delta,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_quality_first_followup_delta_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.quality_first_followup_overall_delta === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.quality_first_followup_overall_delta,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_hard_budget_recovery_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.hard_budget_recovery_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.hard_budget_recovery_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_quality_first_improved_rate_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.quality_first_improved_rate === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.quality_first_improved_rate,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_hard_budget_transition_count_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.hard_budget_transition_count === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.hard_budget_transition_count,
    status_context_engine_prompt_quality_guard_adaptive_policy_window_quality_first_transition_count_type:
      contextEnginePromptQualityGuardAdaptivePolicyWindow?.quality_first_transition_count === null
        ? "null"
        : typeof contextEnginePromptQualityGuardAdaptivePolicyWindow?.quality_first_transition_count,
    status_context_engine_lineage_enabled_type: typeof contextEngineLineage?.enabled,
    status_context_engine_lineage_persistence_domain_type:
      typeof contextEngineLineage?.persistence_domain,
    status_context_engine_lineage_persistence_domain_value:
      typeof contextEngineLineage?.persistence_domain === "string"
        ? contextEngineLineage.persistence_domain
        : null,
    status_context_engine_workspace_signals_enabled_type: typeof contextEngineWorkspaceSignals?.enabled,
    status_context_engine_has_prompt_quality_window: Boolean(promptQualityWindow),
    status_context_engine_has_graph_quality_signals: Boolean(contextEngineGraphQualitySignals),
    status_context_engine_graph_quality_combined_state_type:
      typeof contextEngineGraphQualitySignalsCombined?.state,
    status_context_engine_graph_quality_combined_reason_type:
      typeof contextEngineGraphQualitySignalsCombined?.reason,
    status_context_engine_graph_quality_combined_recommended_action_type:
      typeof contextEngineGraphQualitySignalsCombined?.recommended_action,
    status_context_engine_graph_quality_combined_degraded_sources_type:
      Array.isArray(contextEngineGraphQualitySignalsCombinedDegradedSources)
        ? "array"
        : typeof contextEngineGraphQualitySignalsCombinedDegradedSources,
    status_context_engine_prompt_quality_window_path_type: typeof promptQualityWindow?.path,
    status_context_engine_prompt_quality_window_configured_size_type: typeof promptQualityWindow?.configured_size,
    status_context_engine_prompt_quality_window_entries_type: typeof promptQualityWindow?.entries,
    status_context_engine_prompt_quality_window_persistence_domain_type:
      typeof promptQualityWindow?.persistence_domain,
    status_context_engine_prompt_quality_window_persistence_domain_value:
      typeof promptQualityWindow?.persistence_domain === "string"
        ? promptQualityWindow.persistence_domain
        : null,
    status_context_engine_prompt_quality_window_from_ts_type: promptQualityWindow?.from_ts === null
      ? "null"
      : typeof promptQualityWindow?.from_ts,
    status_context_engine_prompt_quality_window_to_ts_type: promptQualityWindow?.to_ts === null
      ? "null"
      : typeof promptQualityWindow?.to_ts,
    status_context_engine_prompt_quality_window_average_overall_type: promptQualityWindow?.average_scores === null
      ? "null"
      : typeof promptQualityWindowAverageScores?.overall,
    status_context_engine_prompt_quality_window_latest_overall_type: promptQualityWindow?.latest_scores === null
      ? "null"
      : typeof promptQualityWindowLatestScores?.overall,
    status_context_engine_prompt_quality_window_low_quality_rate_type:
      promptQualityWindowLowQuality?.rate === null
        ? "null"
        : typeof promptQualityWindowLowQuality?.rate,
    status_context_engine_prompt_quality_window_low_quality_threshold_type:
      typeof promptQualityWindowLowQuality?.threshold_overall,
    status_context_engine_prompt_quality_window_stage_normal_type:
      typeof promptQualityWindowStageCounts?.normal,
    status_context_engine_prompt_quality_window_stage_proactive_type:
      typeof promptQualityWindowStageCounts?.proactive,
    status_context_engine_prompt_quality_window_stage_forced_type:
      typeof promptQualityWindowStageCounts?.forced,
    status_context_engine_prompt_quality_window_stage_minimal_type:
      typeof promptQualityWindowStageCounts?.minimal,
    status_context_engine_prompt_quality_window_signal_avg_recent_trim_rows_type:
      promptQualityWindowSignalAverages === null
        ? "null"
        : typeof promptQualityWindowSignalAverages?.recent_trim_rows,
    status_context_engine_prompt_quality_window_signal_avg_snapshot_semantic_compress_sections_type:
      promptQualityWindowSignalAverages === null
        ? "null"
        : typeof promptQualityWindowSignalAverages?.snapshot_semantic_compress_sections,
    status_context_engine_prompt_quality_window_signal_avg_pre_send_overflow_type:
      promptQualityWindowSignalAverages === null
        ? "null"
        : typeof promptQualityWindowSignalAverages?.pre_send_overflow_ratio,
    status_context_engine_prompt_quality_window_signal_avg_pre_send_pressure_type:
      promptQualityWindowSignalAverages === null
        ? "null"
        : typeof promptQualityWindowSignalAverages?.pre_send_pressure_score,
    status_context_engine_prompt_quality_window_compression_snapshot_semantic_rate_type:
      promptQualityWindowCompressionActivity?.snapshot_semantic_compress_rate === null
        ? "null"
        : typeof promptQualityWindowCompressionActivity?.snapshot_semantic_compress_rate,
    status_context_engine_prompt_quality_window_compression_auto_limit_rate_type:
      promptQualityWindowCompressionActivity?.auto_limit_triggered_rate === null
        ? "null"
        : typeof promptQualityWindowCompressionActivity?.auto_limit_triggered_rate,
    status_context_engine_prompt_quality_window_token_budget_avg_utilization_type:
      promptQualityWindowTokenBudget?.average_utilization_ratio === null
        ? "null"
        : typeof promptQualityWindowTokenBudget?.average_utilization_ratio,
    status_context_engine_prompt_quality_window_strategy_quality_first_rate_type:
      promptQualityWindowStrategyActivity?.quality_first_rate === null
        ? "null"
        : typeof promptQualityWindowStrategyActivity?.quality_first_rate,
    status_context_engine_prompt_quality_window_strategy_hard_budget_rate_type:
      promptQualityWindowStrategyActivity?.hard_budget_rate === null
        ? "null"
        : typeof promptQualityWindowStrategyActivity?.hard_budget_rate,
    status_context_engine_prompt_quality_window_has_strategy_outcomes:
      Boolean(promptQualityWindowStrategyOutcomes),
    status_context_engine_prompt_quality_window_strategy_outcomes_hard_budget_followup_delta_type:
      promptQualityWindowStrategyOutcomes?.hard_budget_followup_overall_delta === null
        ? "null"
        : typeof promptQualityWindowStrategyOutcomes?.hard_budget_followup_overall_delta,
    status_context_engine_prompt_quality_window_strategy_outcomes_quality_first_followup_delta_type:
      promptQualityWindowStrategyOutcomes?.quality_first_followup_overall_delta === null
        ? "null"
        : typeof promptQualityWindowStrategyOutcomes?.quality_first_followup_overall_delta,
    status_context_engine_prompt_quality_window_strategy_outcomes_hard_budget_recovery_rate_type:
      promptQualityWindowStrategyOutcomes?.hard_budget_recovery_rate === null
        ? "null"
        : typeof promptQualityWindowStrategyOutcomes?.hard_budget_recovery_rate,
    status_context_engine_prompt_quality_window_strategy_outcomes_quality_first_improved_rate_type:
      promptQualityWindowStrategyOutcomes?.quality_first_improved_rate === null
        ? "null"
        : typeof promptQualityWindowStrategyOutcomes?.quality_first_improved_rate,
    status_context_engine_prompt_quality_window_strategy_outcomes_hard_budget_transition_count_type:
      promptQualityWindowStrategyOutcomes?.hard_budget_transition_count === null
        ? "null"
        : typeof promptQualityWindowStrategyOutcomes?.hard_budget_transition_count,
    status_context_engine_prompt_quality_window_strategy_outcomes_quality_first_transition_count_type:
      promptQualityWindowStrategyOutcomes?.quality_first_transition_count === null
        ? "null"
        : typeof promptQualityWindowStrategyOutcomes?.quality_first_transition_count,
    status_context_engine_prompt_quality_window_has_strategy_trends:
      Boolean(promptQualityWindowStrategyTrends),
    status_context_engine_prompt_quality_window_strategy_trends_short_window_size_type:
      typeof promptQualityWindowStrategyTrendsShort?.window_size,
    status_context_engine_prompt_quality_window_strategy_trends_short_hard_budget_rate_type:
      promptQualityWindowStrategyTrendsShort?.hard_budget_rate === null
        ? "null"
        : typeof promptQualityWindowStrategyTrendsShort?.hard_budget_rate,
    status_context_engine_prompt_quality_window_strategy_trends_short_avg_overflow_type:
      promptQualityWindowStrategyTrendsShort?.average_overflow_ratio === null
        ? "null"
        : typeof promptQualityWindowStrategyTrendsShort?.average_overflow_ratio,
    status_context_engine_prompt_quality_window_strategy_trends_short_avg_pressure_type:
      promptQualityWindowStrategyTrendsShort?.average_pressure_score === null
        ? "null"
        : typeof promptQualityWindowStrategyTrendsShort?.average_pressure_score,
    status_context_engine_prompt_quality_window_strategy_trends_medium_window_size_type:
      typeof promptQualityWindowStrategyTrendsMedium?.window_size,
    status_context_engine_prompt_quality_window_strategy_trends_medium_hard_budget_rate_type:
      promptQualityWindowStrategyTrendsMedium?.hard_budget_rate === null
        ? "null"
        : typeof promptQualityWindowStrategyTrendsMedium?.hard_budget_rate,
    status_context_engine_prompt_quality_window_strategy_trends_delta_hard_budget_rate_type:
      promptQualityWindowStrategyTrendsDelta?.hard_budget_rate === null
        ? "null"
        : typeof promptQualityWindowStrategyTrendsDelta?.hard_budget_rate,
    status_context_engine_prompt_quality_window_strategy_trends_delta_avg_overflow_type:
      promptQualityWindowStrategyTrendsDelta?.average_overflow_ratio === null
        ? "null"
        : typeof promptQualityWindowStrategyTrendsDelta?.average_overflow_ratio,
    status_context_engine_prompt_quality_window_strategy_trends_delta_avg_pressure_type:
      promptQualityWindowStrategyTrendsDelta?.average_pressure_score === null
        ? "null"
        : typeof promptQualityWindowStrategyTrendsDelta?.average_pressure_score,
    status_context_engine_prompt_quality_window_has_pressure_trends:
      Boolean(promptQualityWindowPressureTrends),
    status_context_engine_prompt_quality_window_pressure_trends_short_window_size_type:
      typeof promptQualityWindowPressureTrendsShort?.window_size,
    status_context_engine_prompt_quality_window_pressure_trends_short_entries_type:
      typeof promptQualityWindowPressureTrendsShort?.entries,
    status_context_engine_prompt_quality_window_pressure_trends_short_semantic_rate_type:
      promptQualityWindowPressureTrendsShort?.snapshot_semantic_compress_rate === null
        ? "null"
        : typeof promptQualityWindowPressureTrendsShort?.snapshot_semantic_compress_rate,
    status_context_engine_prompt_quality_window_pressure_trends_short_auto_limit_rate_type:
      promptQualityWindowPressureTrendsShort?.auto_limit_triggered_rate === null
        ? "null"
        : typeof promptQualityWindowPressureTrendsShort?.auto_limit_triggered_rate,
    status_context_engine_prompt_quality_window_pressure_trends_short_avg_utilization_type:
      promptQualityWindowPressureTrendsShort?.average_utilization_ratio === null
        ? "null"
        : typeof promptQualityWindowPressureTrendsShort?.average_utilization_ratio,
    status_context_engine_prompt_quality_window_pressure_trends_medium_window_size_type:
      typeof promptQualityWindowPressureTrendsMedium?.window_size,
    status_context_engine_prompt_quality_window_pressure_trends_medium_entries_type:
      typeof promptQualityWindowPressureTrendsMedium?.entries,
    status_context_engine_prompt_quality_window_pressure_trends_medium_semantic_rate_type:
      promptQualityWindowPressureTrendsMedium?.snapshot_semantic_compress_rate === null
        ? "null"
        : typeof promptQualityWindowPressureTrendsMedium?.snapshot_semantic_compress_rate,
    status_context_engine_prompt_quality_window_pressure_trends_medium_auto_limit_rate_type:
      promptQualityWindowPressureTrendsMedium?.auto_limit_triggered_rate === null
        ? "null"
        : typeof promptQualityWindowPressureTrendsMedium?.auto_limit_triggered_rate,
    status_context_engine_prompt_quality_window_pressure_trends_medium_avg_utilization_type:
      promptQualityWindowPressureTrendsMedium?.average_utilization_ratio === null
        ? "null"
        : typeof promptQualityWindowPressureTrendsMedium?.average_utilization_ratio,
    status_context_engine_prompt_quality_window_pressure_trends_delta_semantic_rate_type:
      promptQualityWindowPressureTrendsDelta?.snapshot_semantic_compress_rate === null
        ? "null"
        : typeof promptQualityWindowPressureTrendsDelta?.snapshot_semantic_compress_rate,
    status_context_engine_prompt_quality_window_pressure_trends_delta_auto_limit_rate_type:
      promptQualityWindowPressureTrendsDelta?.auto_limit_triggered_rate === null
        ? "null"
        : typeof promptQualityWindowPressureTrendsDelta?.auto_limit_triggered_rate,
    status_context_engine_prompt_quality_window_pressure_trends_delta_avg_utilization_type:
      promptQualityWindowPressureTrendsDelta?.average_utilization_ratio === null
        ? "null"
        : typeof promptQualityWindowPressureTrendsDelta?.average_utilization_ratio,
    status_context_engine_prompt_quality_window_has_degradation:
      Boolean(promptQualityWindowDegradation),
    status_context_engine_prompt_quality_window_degradation_degraded_type:
      typeof promptQualityWindowDegradation?.degraded,
    status_context_engine_prompt_quality_window_degradation_reason_type:
      typeof promptQualityWindowDegradation?.reason,
    status_context_engine_prompt_quality_window_degradation_threshold_overall_type:
      typeof promptQualityWindowDegradation?.threshold_overall,
    status_context_engine_prompt_quality_window_degradation_threshold_low_quality_rate_type:
      typeof promptQualityWindowDegradation?.threshold_low_quality_rate,
    status_context_engine_prompt_quality_window_degradation_min_entries_type:
      typeof promptQualityWindowDegradation?.min_entries,
    status_context_engine_prompt_quality_window_degradation_observed_entries_type:
      typeof promptQualityWindowDegradation?.observed_entries,
    status_context_engine_prompt_quality_window_degradation_observed_overall_type:
      promptQualityWindowDegradation?.observed_overall === null
        ? "null"
        : typeof promptQualityWindowDegradation?.observed_overall,
    status_context_engine_prompt_quality_window_degradation_observed_low_quality_rate_type:
      promptQualityWindowDegradation?.observed_low_quality_rate === null
        ? "null"
        : typeof promptQualityWindowDegradation?.observed_low_quality_rate,
    status_route_reason_type: typeof routeDecision?.reason,
  };
}

function runStartContextPreSendHeadTrimFlow(repoRoot) {
  const workDir = createTempDir("grobot-start-pretrim-work");
  writeContextEngineTrimProjectToml(workDir);
  const config = writeConfig(buildSmokeConfig(workDir));
  const longMessage = "context engine retry compaction needs deterministic head trim behavior. ".repeat(340);
  const result = runCommand(repoRoot, [
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
    "pretrim-quality-user",
    "--history-turns",
    "8",
    "--message",
    longMessage,
  ]);
  const preTrimEvent = result.stderr.match(
    /event=pre_send_head_trim stage=([a-z_]+) retries=(\d+) estimated_tokens=(\d+) effective_window=(\d+)/,
  );
  const recentTrimEvent = result.stderr.match(
    /event=pre_send_recent_trim stage=([a-z_]+) removed_rows=(\d+) estimated_tokens=(\d+) target_limit=(\d+)/,
  );
  const snapshotTrimEvent = result.stderr.match(
    /event=pre_send_snapshot_trim stage=([a-z_]+) removed_sections=(\d+) estimated_tokens=(\d+) target_limit=(\d+)/,
  );
  const snapshotSemanticCompressEvent = result.stderr.match(
    /event=pre_send_snapshot_semantic_compress stage=([a-z_]+) compressed_sections=(\d+) estimated_tokens=(\d+) target_limit=(\d+)/,
  );
  const promptPrepared = result.stderr.match(
    /event=prompt_prepared[^\n]*recent_trim_rows=(\d+)[^\n]*snapshot_trim_sections=(\d+)[^\n]*snapshot_semantic_compress_sections=(\d+)[^\n]*pretrim_retries=(\d+)/,
  );
  return {
    ...result,
    pre_send_head_trim_seen: Boolean(preTrimEvent),
    pre_send_head_trim_stage: preTrimEvent?.[1] ?? "",
    pre_send_head_trim_retries: Number.parseInt(preTrimEvent?.[2] ?? "0", 10),
    pre_send_estimated_tokens: Number.parseInt(preTrimEvent?.[3] ?? "0", 10),
    pre_send_effective_window: Number.parseInt(preTrimEvent?.[4] ?? "0", 10),
    pre_send_recent_trim_seen: Boolean(recentTrimEvent),
    pre_send_recent_trim_stage: recentTrimEvent?.[1] ?? "",
    pre_send_recent_trim_removed_rows: Number.parseInt(recentTrimEvent?.[2] ?? "0", 10),
    pre_send_recent_trim_estimated_tokens: Number.parseInt(recentTrimEvent?.[3] ?? "0", 10),
    pre_send_recent_trim_target_limit: Number.parseInt(recentTrimEvent?.[4] ?? "0", 10),
    pre_send_snapshot_trim_seen: Boolean(snapshotTrimEvent),
    pre_send_snapshot_trim_stage: snapshotTrimEvent?.[1] ?? "",
    pre_send_snapshot_trim_removed_sections: Number.parseInt(snapshotTrimEvent?.[2] ?? "0", 10),
    pre_send_snapshot_trim_estimated_tokens: Number.parseInt(snapshotTrimEvent?.[3] ?? "0", 10),
    pre_send_snapshot_trim_target_limit: Number.parseInt(snapshotTrimEvent?.[4] ?? "0", 10),
    pre_send_snapshot_semantic_compress_seen: Boolean(snapshotSemanticCompressEvent),
    pre_send_snapshot_semantic_compress_stage: snapshotSemanticCompressEvent?.[1] ?? "",
    pre_send_snapshot_semantic_compress_sections: Number.parseInt(snapshotSemanticCompressEvent?.[2] ?? "0", 10),
    pre_send_snapshot_semantic_compress_estimated_tokens: Number.parseInt(
      snapshotSemanticCompressEvent?.[3] ?? "0",
      10,
    ),
    pre_send_snapshot_semantic_compress_target_limit: Number.parseInt(
      snapshotSemanticCompressEvent?.[4] ?? "0",
      10,
    ),
    prompt_prepared_seen: result.stderr.includes("event=prompt_prepared"),
    prompt_prepared_recent_trim_rows: Number.parseInt(promptPrepared?.[1] ?? "0", 10),
    prompt_prepared_snapshot_trim_sections: Number.parseInt(promptPrepared?.[2] ?? "0", 10),
    prompt_prepared_snapshot_semantic_compress_sections: Number.parseInt(promptPrepared?.[3] ?? "0", 10),
    prompt_prepared_pretrim_retries: Number.parseInt(promptPrepared?.[4] ?? "0", 10),
  };
}

function runStartContextQualityGuardFlow(repoRoot) {
  const workDir = createTempDir("grobot-start-quality-guard-work");
  writeContextEngineQualityGuardProjectToml(workDir);
  const contextDir = `${workDir}/.grobot/context`;
  mkdirSync(contextDir, { recursive: true });
  const seedPath = `${contextDir}/prompt-quality-window.jsonl`;
  const seedNowMs = Date.now();
  const seedRows = [
    {
      ts: new Date(seedNowMs - 2_000).toISOString(),
      sessionKey: "seed:quality-guard",
      stage: "normal",
      selectionReason: "seed",
      estimatedTokens: 2100,
      targetTokenLimit: 2000,
      scores: {
        coverage: 0.35,
        recency: 0.30,
        size: 0.20,
        overall: 0.30,
      },
      signals: {
        recentRows: 1,
        snapshotSections: 1,
        recentTrimRows: 0,
        snapshotTrimSections: 0,
        headTrimRetries: 0,
        autoLimitTriggered: false,
        downshiftGuardTriggered: false,
      },
    },
    {
      ts: new Date(seedNowMs - 1_000).toISOString(),
      sessionKey: "seed:quality-guard",
      stage: "normal",
      selectionReason: "seed",
      estimatedTokens: 2300,
      targetTokenLimit: 2000,
      scores: {
        coverage: 0.30,
        recency: 0.20,
        size: 0.10,
        overall: 0.22,
      },
      signals: {
        recentRows: 0,
        snapshotSections: 1,
        recentTrimRows: 0,
        snapshotTrimSections: 0,
        headTrimRetries: 0,
        autoLimitTriggered: false,
        downshiftGuardTriggered: false,
      },
    },
  ];
  writeFileSync(
    seedPath,
    `${seedRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
  const config = writeConfig(buildSmokeConfig(workDir));
  const result = runCommand(repoRoot, [
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
    "quality-guard-user",
    "--history-turns",
    "8",
    "--message",
    "quality guard should proactively escalate compaction when recent prompt quality window is degraded",
  ]);
  const qualityGuardEvent = result.stderr.match(
    /event=quality_guard_precompact stage=([a-z_]+).* reason=([a-z_]+)/,
  );
  const promptPreparedEvent = result.stderr.match(
    /event=prompt_prepared[^\n]*quality_guard=(true|false)/,
  );
  return {
    ...result,
    quality_guard_seen: Boolean(qualityGuardEvent),
    quality_guard_stage: qualityGuardEvent?.[1] ?? "",
    quality_guard_reason: qualityGuardEvent?.[2] ?? "",
    prompt_prepared_quality_guard: promptPreparedEvent?.[1] ?? "",
    seed_path: seedPath,
  };
}

function extractGraphAutotuneTelemetry(stderr) {
  const graphAutotuneEvent = stderr.match(
    /event=graph_quality_autotune action=([a-z_]+) reason=([a-z_+]+) suppressed=([a-z_]+) dep_rows=(\d+)->(\d+) symbol_rows=(\d+)->(\d+) entries=(\d+) quality_entries=(\d+)/,
  );
  const graphAutotuneAdaptiveEvent = stderr.match(
    /adaptive_threshold_source=([a-z_]+) adaptive_updated=(true|false) adaptive_alpha=([0-9.]+) adaptive_updates=(\d+) adaptive_thresholds=([0-9.]+)\/([0-9.]+)\/([0-9.]+)\/([0-9.]+)/,
  );
  const graphAutotuneAdaptiveActionEvent = stderr.match(
    /adaptive_action_source=([a-z_]+) adaptive_action_updated=(true|false) adaptive_action_scale=([0-9.]+) adaptive_action_updates=(\d+)/,
  );
  return {
    graph_autotune_seen: Boolean(graphAutotuneEvent),
    graph_autotune_action: graphAutotuneEvent?.[1] ?? "",
    graph_autotune_reason: graphAutotuneEvent?.[2] ?? "",
    graph_autotune_suppressed: graphAutotuneEvent?.[3] ?? "",
    graph_autotune_dep_rows_from: Number.parseInt(graphAutotuneEvent?.[4] ?? "0", 10),
    graph_autotune_dep_rows_to: Number.parseInt(graphAutotuneEvent?.[5] ?? "0", 10),
    graph_autotune_symbol_rows_from: Number.parseInt(graphAutotuneEvent?.[6] ?? "0", 10),
    graph_autotune_symbol_rows_to: Number.parseInt(graphAutotuneEvent?.[7] ?? "0", 10),
    graph_autotune_entries: Number.parseInt(graphAutotuneEvent?.[8] ?? "0", 10),
    graph_autotune_quality_entries: Number.parseInt(graphAutotuneEvent?.[9] ?? "0", 10),
    graph_autotune_adaptive_source: graphAutotuneAdaptiveEvent?.[1] ?? "",
    graph_autotune_adaptive_updated: graphAutotuneAdaptiveEvent?.[2] ?? "",
    graph_autotune_adaptive_alpha: Number.parseFloat(graphAutotuneAdaptiveEvent?.[3] ?? "0"),
    graph_autotune_adaptive_updates: Number.parseInt(graphAutotuneAdaptiveEvent?.[4] ?? "0", 10),
    graph_autotune_adaptive_cache_threshold:
      Number.parseFloat(graphAutotuneAdaptiveEvent?.[5] ?? "0"),
    graph_autotune_adaptive_parsed_max:
      Number.parseFloat(graphAutotuneAdaptiveEvent?.[6] ?? "0"),
    graph_autotune_adaptive_reused_min:
      Number.parseFloat(graphAutotuneAdaptiveEvent?.[7] ?? "0"),
    graph_autotune_adaptive_removed_max:
      Number.parseFloat(graphAutotuneAdaptiveEvent?.[8] ?? "0"),
    graph_autotune_adaptive_action_source: graphAutotuneAdaptiveActionEvent?.[1] ?? "",
    graph_autotune_adaptive_action_updated: graphAutotuneAdaptiveActionEvent?.[2] ?? "",
    graph_autotune_adaptive_action_scale:
      Number.parseFloat(graphAutotuneAdaptiveActionEvent?.[3] ?? "0"),
    graph_autotune_adaptive_action_updates:
      Number.parseInt(graphAutotuneAdaptiveActionEvent?.[4] ?? "0", 10),
  };
}

function writeGraphAutotuneSeedRows(seedPath, input) {
  const seedNowMs = Date.now();
  const rows = [0, 1].map((index) => ({
    ts: new Date(seedNowMs - (2 - index) * 1_000).toISOString(),
    sessionKey: input.sessionKey,
    stage: "normal",
    selectionReason: "seed",
    delta: {
      symbolQuery: { hit: input.queryHit, miss: input.queryMiss, write: 0, evict: 0 },
      symbolDeclaration: { hit: input.queryHit, miss: input.queryMiss, write: 0, evict: 0 },
      dependencyQuery: { hit: input.queryHit, miss: input.queryMiss, write: 0, evict: 0 },
      dependencyImport: { hit: input.queryHit, miss: input.queryMiss, write: 0, evict: 0 },
    },
    total: {
      symbolQuery: {
        hit: input.queryHit + index,
        miss: input.queryMiss + 1,
        write: 1,
        evict: 0,
      },
      symbolDeclaration: {
        hit: input.queryHit + index,
        miss: input.queryMiss + 1,
        write: 1,
        evict: 0,
      },
      dependencyQuery: {
        hit: input.queryHit + index,
        miss: input.queryMiss + 1,
        write: 1,
        evict: 0,
      },
      dependencyImport: {
        hit: input.queryHit + index,
        miss: input.queryMiss + 1,
        write: 1,
        evict: 0,
      },
    },
    quality: {
      dependency: {
        rows: input.quality.dependency.rows,
        multiHopRows: input.quality.dependency.multiHopRows,
        depth4PlusRows: input.quality.dependency.depth4PlusRows,
        maxChainDepth: input.quality.dependency.maxChainDepth,
      },
      symbol: {
        rows: input.quality.symbol.rows,
        rowsWithBridge: input.quality.symbol.rowsWithBridge,
        rowsWithBreadth: input.quality.symbol.rowsWithBreadth,
        bridgeTotal: input.quality.symbol.bridgeTotal,
        breadthTotal: input.quality.symbol.breadthTotal,
        refsTotal: input.quality.symbol.refsTotal,
        refsCount: input.quality.symbol.refsCount,
        maxRefs: input.quality.symbol.maxRefs,
      },
    },
  }));
  writeFileSync(seedPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function runStartContextGraphQualityAutotuneFlow(repoRoot) {
  const workDir = createTempDir("grobot-start-graph-autotune-work");
  writeContextEngineGraphAutotuneProjectToml(workDir);
  const contextDir = `${workDir}/.grobot/context`;
  mkdirSync(contextDir, { recursive: true });
  const seedPath = `${contextDir}/graph-cache-window.jsonl`;
  writeGraphAutotuneSeedRows(seedPath, {
    sessionKey: "seed:graph-autotune",
    queryHit: 1,
    queryMiss: 0,
    quality: {
      dependency: {
        rows: 1,
        multiHopRows: 0,
        depth4PlusRows: 0,
        maxChainDepth: 1,
      },
      symbol: {
        rows: 1,
        rowsWithBridge: 0,
        rowsWithBreadth: 0,
        bridgeTotal: 0,
        breadthTotal: 0,
        refsTotal: 0.2,
        refsCount: 1,
        maxRefs: 1,
      },
    },
  });
  const config = writeConfig(buildSmokeConfig(workDir));
  const result = runCommand(repoRoot, [
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
    "graph-autotune-user",
    "--history-turns",
    "6",
    "--message",
    "graph quality autotune should raise graph hint rows when evidence quality is poor",
  ]);
  return {
    ...result,
    ...extractGraphAutotuneTelemetry(result.stderr),
    seed_path: seedPath,
  };
}

function runStartContextGraphQualityAutotuneHysteresisFlow(repoRoot) {
  const workDir = createTempDir("grobot-start-graph-autotune-hysteresis-work");
  writeContextEngineGraphAutotuneProjectToml(workDir);
  const contextDir = `${workDir}/.grobot/context`;
  const memoryContextEngineDir = `${workDir}/.grobot/memory/context-engine`;
  mkdirSync(contextDir, { recursive: true });
  mkdirSync(memoryContextEngineDir, { recursive: true });
  const graphSeedPath = `${contextDir}/graph-cache-window.jsonl`;
  const promptSeedPath = `${contextDir}/prompt-quality-window.jsonl`;
  const stateSeedPath = `${memoryContextEngineDir}/graph-quality-autotune-state.json`;
  const seedNowMs = Date.now();
  writeGraphAutotuneSeedRows(graphSeedPath, {
    sessionKey: "seed:graph-autotune-hysteresis",
    queryHit: 2,
    queryMiss: 0,
    quality: {
      dependency: {
        rows: 4,
        multiHopRows: 3,
        depth4PlusRows: 2,
        maxChainDepth: 4,
      },
      symbol: {
        rows: 4,
        rowsWithBridge: 4,
        rowsWithBreadth: 4,
        bridgeTotal: 16,
        breadthTotal: 14,
        refsTotal: 22,
        refsCount: 4,
        maxRefs: 8,
      },
    },
  });
  const promptRows = [0, 1].map((index) => ({
    ts: new Date(seedNowMs - (2 - index) * 1_000).toISOString(),
    sessionKey: "seed:graph-autotune-hysteresis",
    stage: "minimal",
    selectionReason: "seed",
    estimatedTokens: 7800 + index * 200,
    targetTokenLimit: 5000,
    scores: {
      coverage: 0.60,
      recency: 0.55,
      size: 0.32,
      overall: 0.49,
    },
    signals: {
      recentRows: 1,
      snapshotSections: 2,
      recentTrimRows: 1,
      snapshotTrimSections: 1,
      snapshotSemanticCompressSections: 2,
      headTrimRetries: 0,
      autoLimitTriggered: true,
      downshiftGuardTriggered: false,
      preSendStrategy: "hard_budget",
      preSendOverflowRatio: 0.35,
      preSendPressureScore: 0.82,
    },
  }));
  const stateSeed = {
    lastDirection: "upshift",
    holdTurnsRemaining: 2,
    downshiftWarmupStreak: 0,
    lastReason: "seed",
    updatedAt: new Date(seedNowMs - 3_000).toISOString(),
  };
  writeFileSync(
    promptSeedPath,
    `${promptRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
  writeFileSync(stateSeedPath, `${JSON.stringify(stateSeed, null, 2)}\n`, "utf8");
  const config = writeConfig(buildSmokeConfig(workDir));
  const result = runCommand(repoRoot, [
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
    "graph-autotune-hysteresis-user",
    "--history-turns",
    "6",
    "--message",
    "graph quality autotune hysteresis should suppress instant direction flip",
  ]);
  return {
    ...result,
    ...extractGraphAutotuneTelemetry(result.stderr),
    graph_seed_path: graphSeedPath,
    prompt_seed_path: promptSeedPath,
    state_seed_path: stateSeedPath,
  };
}

function runStartContextGraphQualityAutotuneAdaptiveSequenceFlow(repoRoot) {
  const workDir = createTempDir("grobot-start-graph-autotune-adaptive-seq-work");
  writeContextEngineGraphAutotuneProjectToml(workDir);
  const contextDir = `${workDir}/.grobot/context`;
  const memoryContextEngineDir = `${workDir}/.grobot/memory/context-engine`;
  mkdirSync(contextDir, { recursive: true });
  mkdirSync(memoryContextEngineDir, { recursive: true });
  const graphSeedPath = `${contextDir}/graph-cache-window.jsonl`;
  const statePath = `${memoryContextEngineDir}/graph-quality-autotune-state.json`;
  const config = writeConfig(buildSmokeConfig(workDir));
  const runTurn = (message) => runCommand(repoRoot, [
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
    "graph-autotune-adaptive-seq-user",
    "--history-turns",
    "6",
    "--message",
    message,
  ]);
  const readAdaptiveSnapshot = (raw) => {
    if (!isObject(raw)) {
      return {
        present: false,
        adaptive_updates: 0,
        adaptive_cache_threshold: null,
        adaptive_alpha: null,
        adaptive_source: "",
        adaptive_action_scale: null,
        adaptive_action_updates: 0,
        adaptive_action_source: "",
      };
    }
    return {
      present: true,
      adaptive_updates: Number.isFinite(raw.adaptiveUpdates) ? Number(raw.adaptiveUpdates) : 0,
      adaptive_cache_threshold:
        Number.isFinite(raw.cacheDegradeQueryHitRateThreshold)
          ? Number(raw.cacheDegradeQueryHitRateThreshold)
          : null,
      adaptive_alpha: Number.isFinite(raw.adaptiveLearnAlpha) ? Number(raw.adaptiveLearnAlpha) : null,
      adaptive_source: typeof raw.adaptiveSource === "string" ? raw.adaptiveSource : "",
      adaptive_action_scale: Number.isFinite(raw.adaptiveActionScale)
        ? Number(raw.adaptiveActionScale)
        : null,
      adaptive_action_updates: Number.isFinite(raw.adaptiveActionUpdates)
        ? Number(raw.adaptiveActionUpdates)
        : 0,
      adaptive_action_source: typeof raw.adaptiveActionSource === "string"
        ? raw.adaptiveActionSource
        : "",
    };
  };

  writeGraphAutotuneSeedRows(graphSeedPath, {
    sessionKey: "seed:graph-autotune-adaptive-seq-high",
    queryHit: 18,
    queryMiss: 2,
    quality: {
      dependency: {
        rows: 4,
        multiHopRows: 3,
        depth4PlusRows: 2,
        maxChainDepth: 4,
      },
      symbol: {
        rows: 4,
        rowsWithBridge: 4,
        rowsWithBreadth: 4,
        bridgeTotal: 15,
        breadthTotal: 12,
        refsTotal: 20,
        refsCount: 4,
        maxRefs: 8,
      },
    },
  });
  const firstResult = runTurn(
    "graph autotune adaptive sequence pass 1 should learn from high cache hit rate evidence",
  );
  const firstTelemetry = extractGraphAutotuneTelemetry(firstResult.stderr);
  const firstState = readAdaptiveSnapshot(readJsonFileSafe(statePath));

  writeGraphAutotuneSeedRows(graphSeedPath, {
    sessionKey: "seed:graph-autotune-adaptive-seq-low",
    queryHit: 2,
    queryMiss: 18,
    quality: {
      dependency: {
        rows: 1,
        multiHopRows: 0,
        depth4PlusRows: 0,
        maxChainDepth: 1,
      },
      symbol: {
        rows: 1,
        rowsWithBridge: 0,
        rowsWithBreadth: 0,
        bridgeTotal: 0,
        breadthTotal: 0,
        refsTotal: 0.5,
        refsCount: 1,
        maxRefs: 1,
      },
    },
  });
  const secondResult = runTurn(
    "graph autotune adaptive sequence pass 2 should adjust thresholds downward under low hit evidence",
  );
  const secondTelemetry = extractGraphAutotuneTelemetry(secondResult.stderr);
  const secondState = readAdaptiveSnapshot(readJsonFileSafe(statePath));

  writeGraphAutotuneSeedRows(graphSeedPath, {
    sessionKey: "seed:graph-autotune-adaptive-seq-rebound",
    queryHit: 14,
    queryMiss: 3,
    quality: {
      dependency: {
        rows: 3,
        multiHopRows: 2,
        depth4PlusRows: 1,
        maxChainDepth: 3,
      },
      symbol: {
        rows: 3,
        rowsWithBridge: 2,
        rowsWithBreadth: 3,
        bridgeTotal: 8,
        breadthTotal: 9,
        refsTotal: 11,
        refsCount: 3,
        maxRefs: 5,
      },
    },
  });
  const thirdResult = runTurn(
    "graph autotune adaptive sequence pass 3 should rebound smoothly without oscillation spike",
  );
  const thirdTelemetry = extractGraphAutotuneTelemetry(thirdResult.stderr);
  const thirdState = readAdaptiveSnapshot(readJsonFileSafe(statePath));

  const secondMinusFirstActionScale = (
    Number.isFinite(secondState.adaptive_action_scale)
    && Number.isFinite(firstState.adaptive_action_scale)
  )
    ? Number(secondState.adaptive_action_scale) - Number(firstState.adaptive_action_scale)
    : null;
  const thirdMinusSecondActionScale = (
    Number.isFinite(thirdState.adaptive_action_scale)
    && Number.isFinite(secondState.adaptive_action_scale)
  )
    ? Number(thirdState.adaptive_action_scale) - Number(secondState.adaptive_action_scale)
    : null;

  return {
    first_exit_code: firstResult.exit_code,
    second_exit_code: secondResult.exit_code,
    third_exit_code: thirdResult.exit_code,
    first_graph_autotune_seen: firstTelemetry.graph_autotune_seen,
    second_graph_autotune_seen: secondTelemetry.graph_autotune_seen,
    third_graph_autotune_seen: thirdTelemetry.graph_autotune_seen,
    first_graph_autotune_adaptive_updated: firstTelemetry.graph_autotune_adaptive_updated,
    second_graph_autotune_adaptive_updated: secondTelemetry.graph_autotune_adaptive_updated,
    third_graph_autotune_adaptive_updated: thirdTelemetry.graph_autotune_adaptive_updated,
    first_state_present: firstState.present,
    second_state_present: secondState.present,
    third_state_present: thirdState.present,
    first_state_adaptive_updates: firstState.adaptive_updates,
    second_state_adaptive_updates: secondState.adaptive_updates,
    third_state_adaptive_updates: thirdState.adaptive_updates,
    first_state_adaptive_cache_threshold: firstState.adaptive_cache_threshold,
    second_state_adaptive_cache_threshold: secondState.adaptive_cache_threshold,
    third_state_adaptive_cache_threshold: thirdState.adaptive_cache_threshold,
    first_state_adaptive_alpha: firstState.adaptive_alpha,
    second_state_adaptive_alpha: secondState.adaptive_alpha,
    third_state_adaptive_alpha: thirdState.adaptive_alpha,
    first_state_adaptive_source: firstState.adaptive_source,
    second_state_adaptive_source: secondState.adaptive_source,
    third_state_adaptive_source: thirdState.adaptive_source,
    first_state_adaptive_action_scale: firstState.adaptive_action_scale,
    second_state_adaptive_action_scale: secondState.adaptive_action_scale,
    third_state_adaptive_action_scale: thirdState.adaptive_action_scale,
    first_state_adaptive_action_updates: firstState.adaptive_action_updates,
    second_state_adaptive_action_updates: secondState.adaptive_action_updates,
    third_state_adaptive_action_updates: thirdState.adaptive_action_updates,
    first_state_adaptive_action_source: firstState.adaptive_action_source,
    second_state_adaptive_action_source: secondState.adaptive_action_source,
    third_state_adaptive_action_source: thirdState.adaptive_action_source,
    second_minus_first_action_scale: secondMinusFirstActionScale,
    third_minus_second_action_scale: thirdMinusSecondActionScale,
    state_path: statePath,
    graph_seed_path: graphSeedPath,
  };
}

function runStartContextMemoryDecayAutotuneQualityFlow(repoRoot) {
  const workDir = createTempDir("grobot-start-memory-decay-autotune-quality-work");
  writeExecutionProjectToml(workDir);
  const contextDir = `${workDir}/.grobot/context`;
  const memoryContextEngineDir = `${workDir}/.grobot/memory/context-engine`;
  mkdirSync(contextDir, { recursive: true });
  mkdirSync(memoryContextEngineDir, { recursive: true });
  const promptSeedPath = `${contextDir}/prompt-quality-window.jsonl`;
  const statePath = `${memoryContextEngineDir}/memory-decay-autotune-state.json`;
  const strategyStatePath = `${memoryContextEngineDir}/memory-strategy-autotune-state.json`;
  const seedNowMs = Date.now();
  const promptRows = [0, 1, 2].map((index) => ({
    ts: new Date(seedNowMs - (3 - index) * 1_000).toISOString(),
    sessionKey: "seed:memory-decay-quality-autotune",
    stage: "minimal",
    selectionReason: "seed",
    estimatedTokens: 8200 + (index * 200),
    targetTokenLimit: 5000,
    scores: {
      coverage: 0.38,
      recency: 0.33,
      size: 0.29,
      overall: 0.46 - (index * 0.04),
    },
    signals: {
      recentRows: 2,
      snapshotSections: 3,
      recentTrimRows: 1,
      snapshotTrimSections: 2,
      snapshotSemanticCompressSections: 3,
      headTrimRetries: 1,
      autoLimitTriggered: true,
      downshiftGuardTriggered: true,
      preSendStrategy: "hard_budget",
      preSendOverflowRatio: 0.52 + (index * 0.03),
      preSendPressureScore: 0.84 + (index * 0.02),
    },
  }));
  writeFileSync(
    promptSeedPath,
    `${promptRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
  const seededState = {
    maxRowsPerSession: 240,
    minConfidenceVerified: 0.20,
    minConfidenceUnverified: 0.45,
    unverifiedMaxAgeHours: 72,
    adaptiveLearnAlpha: 0.2,
    adaptiveUpdates: 4,
    dropRatioEma: 0.01,
    capacityTrimRatioEma: 0.02,
    lowConfidenceRatioEma: 0.03,
    ageDropRatioEma: 0.04,
    qualityLowRateEma: 0.72,
    qualityPressureEma: 0.74,
    hardBudgetFollowupDeltaEma: -0.12,
    qualityFirstFollowupDeltaEma: -0.02,
    lastReason: "seed_quality_pressure",
    updatedAt: "2026-04-19T10:00:00.000Z",
  };
  writeFileSync(statePath, `${JSON.stringify(seededState, null, 2)}\n`, "utf8");
  const seededStrategyState = {
    injectBudgetRatio: 0.27,
    maxSectionTokens: 1360,
    maxGaMemoryRows: 5,
    maxTeamExperienceRows: 4,
    minTeamExperienceScore: 34,
    adaptiveLearnAlpha: 0.2,
    adaptiveUpdates: 3,
    qualityLowRateEma: 0.66,
    qualityPressureEma: 0.74,
    hardBudgetRateEma: 0.61,
    qualityFirstImprovedRateEma: 0.28,
    hardBudgetFollowupDeltaEma: -0.11,
    qualityFirstFollowupDeltaEma: -0.03,
    lastReason: "seed_quality_pressure",
    updatedAt: "2026-04-19T10:05:00.000Z",
  };
  writeFileSync(strategyStatePath, `${JSON.stringify(seededStrategyState, null, 2)}\n`, "utf8");
  const config = writeConfig(buildSmokeConfig(workDir));
  const startResult = runCommand(repoRoot, [
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
    "memory-decay-quality-autotune-user",
    "--history-turns",
    "8",
    "--message",
    "memory decay autotune should tighten by prompt quality pressure",
  ], {
    GROBOT_STARTUP_DIAGNOSTICS: "1",
  });
  const maintenanceEvent = startResult.stderr.match(
    /event=maintenance[^\n]*quality_low_rate=([0-9.<>-]+)[^\n]*quality_pressure=([0-9.<>-]+)[^\n]*decay_autotune_reason=([a-z_,]+)/,
  );
  const statusResult = runCommand(repoRoot, [
    "./grobot",
    "status",
    "--json",
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
  ]);
  const parsedStatus = parseJsonObjectSafe(statusResult.stdout);
  const memoryOrchestrator = isObject(parsedStatus?.context_engine?.memory_orchestrator)
    ? parsedStatus.context_engine.memory_orchestrator
    : null;
  const statusAutotune = isObject(memoryOrchestrator?.autotune)
    ? memoryOrchestrator.autotune
    : null;
  const statusStrategyAutotune = isObject(memoryOrchestrator?.strategy_autotune)
    ? memoryOrchestrator.strategy_autotune
    : null;
  const persistedState = readJsonFileSafe(statePath);
  const persistedAutotune = isObject(persistedState) ? persistedState : null;
  const persistedStrategyState = readJsonFileSafe(strategyStatePath);
  const persistedStrategyAutotune = isObject(persistedStrategyState) ? persistedStrategyState : null;
  const decayMaxRowsAfter = typeof memoryOrchestrator?.decay_max_rows_per_session === "number"
    ? memoryOrchestrator.decay_max_rows_per_session
    : null;
  const decayMinConfidenceVerifiedAfter =
    typeof memoryOrchestrator?.decay_min_confidence_verified === "number"
      ? memoryOrchestrator.decay_min_confidence_verified
      : null;
  const decayMinConfidenceUnverifiedAfter =
    typeof memoryOrchestrator?.decay_min_confidence_unverified === "number"
      ? memoryOrchestrator.decay_min_confidence_unverified
      : null;
  return {
    start_exit_code: startResult.exit_code,
    status_exit_code: statusResult.exit_code,
    maintenance_quality_signal_logged: Boolean(maintenanceEvent),
    maintenance_quality_low_rate: maintenanceEvent?.[1] ?? "",
    maintenance_quality_pressure: maintenanceEvent?.[2] ?? "",
    maintenance_autotune_reason: maintenanceEvent?.[3] ?? "",
    maintenance_autotune_quality_reason_seen:
      typeof maintenanceEvent?.[3] === "string"
      && maintenanceEvent[3].includes("quality_pressure_tighten"),
    status_json_parse_ok: Boolean(parsedStatus),
    status_memory_orchestrator_present: Boolean(memoryOrchestrator),
    status_memory_autotune_present: Boolean(statusAutotune),
    status_memory_strategy_autotune_present: Boolean(statusStrategyAutotune),
    status_memory_autotune_quality_fields_present:
      typeof statusAutotune?.quality_low_rate_ema === "number"
      && typeof statusAutotune?.quality_pressure_ema === "number"
      && typeof statusAutotune?.hard_budget_followup_delta_ema === "number"
      && typeof statusAutotune?.quality_first_followup_delta_ema === "number",
    status_memory_strategy_autotune_quality_fields_present:
      typeof statusStrategyAutotune?.quality_low_rate_ema === "number"
      && typeof statusStrategyAutotune?.quality_pressure_ema === "number"
      && typeof statusStrategyAutotune?.average_utilization_ratio_ema === "number"
      && typeof statusStrategyAutotune?.auto_limit_triggered_rate_ema === "number"
      && typeof statusStrategyAutotune?.snapshot_semantic_compress_rate_ema === "number"
      && typeof statusStrategyAutotune?.hard_budget_rate_ema === "number"
      && typeof statusStrategyAutotune?.quality_first_improved_rate_ema === "number"
      && typeof statusStrategyAutotune?.hard_budget_followup_delta_ema === "number"
      && typeof statusStrategyAutotune?.quality_first_followup_delta_ema === "number",
    status_memory_strategy_autotune_profile_fields_present:
      typeof statusStrategyAutotune?.schema_version === "number"
      && typeof statusStrategyAutotune?.profile === "string",
    status_memory_strategy_autotune_pending_fields_present:
      typeof statusStrategyAutotune?.pending_evaluation_direction === "string"
      && typeof statusStrategyAutotune?.pending_evaluation_warmup_turns === "number",
    status_memory_strategy_autotune_outcome_fields_present:
      typeof statusStrategyAutotune?.outcome_confidence_ema === "number"
      && typeof statusStrategyAutotune?.last_outcome_gain === "number"
      && typeof statusStrategyAutotune?.outcome_rollback_count === "number"
      && typeof statusStrategyAutotune?.outcome_negative_streak === "number",
    status_memory_autotune_last_reason:
      typeof statusAutotune?.last_reason === "string" ? statusAutotune.last_reason : "",
    status_memory_autotune_reason_has_quality_tighten:
      typeof statusAutotune?.last_reason === "string"
      && statusAutotune.last_reason.includes("quality_pressure_tighten"),
    status_memory_strategy_autotune_last_reason:
      typeof statusStrategyAutotune?.last_reason === "string"
        ? statusStrategyAutotune.last_reason
        : "",
    status_memory_strategy_autotune_reason_has_quality_tighten:
      typeof statusStrategyAutotune?.last_reason === "string"
      && statusStrategyAutotune.last_reason.includes("quality_pressure_tighten"),
    status_memory_decay_max_rows_before: seededState.maxRowsPerSession,
    status_memory_decay_max_rows_after: decayMaxRowsAfter,
    status_memory_decay_max_rows_tightened:
      typeof decayMaxRowsAfter === "number" && decayMaxRowsAfter < seededState.maxRowsPerSession,
    status_memory_decay_verified_conf_before: seededState.minConfidenceVerified,
    status_memory_decay_verified_conf_after: decayMinConfidenceVerifiedAfter,
    status_memory_decay_unverified_conf_before: seededState.minConfidenceUnverified,
    status_memory_decay_unverified_conf_after: decayMinConfidenceUnverifiedAfter,
    status_memory_decay_confidence_tightened:
      typeof decayMinConfidenceVerifiedAfter === "number"
      && typeof decayMinConfidenceUnverifiedAfter === "number"
      && decayMinConfidenceVerifiedAfter > seededState.minConfidenceVerified
      && decayMinConfidenceUnverifiedAfter > seededState.minConfidenceUnverified,
    status_memory_strategy_budget_ratio_before: seededStrategyState.injectBudgetRatio,
    status_memory_strategy_budget_ratio_after:
      typeof memoryOrchestrator?.inject_budget_ratio === "number"
        ? memoryOrchestrator.inject_budget_ratio
        : null,
    status_memory_strategy_budget_ratio_tightened:
      typeof memoryOrchestrator?.inject_budget_ratio === "number"
      && memoryOrchestrator.inject_budget_ratio < seededStrategyState.injectBudgetRatio,
    status_memory_strategy_section_before: seededStrategyState.maxSectionTokens,
    status_memory_strategy_section_after:
      typeof memoryOrchestrator?.max_section_tokens === "number"
        ? memoryOrchestrator.max_section_tokens
        : null,
    status_memory_strategy_section_tightened:
      typeof memoryOrchestrator?.max_section_tokens === "number"
      && memoryOrchestrator.max_section_tokens < seededStrategyState.maxSectionTokens,
    state_exists: Boolean(persistedAutotune),
    state_adaptive_updates_before: seededState.adaptiveUpdates,
    state_adaptive_updates_after:
      typeof persistedAutotune?.adaptiveUpdates === "number"
        ? persistedAutotune.adaptiveUpdates
        : null,
    state_adaptive_updates_increased:
      typeof persistedAutotune?.adaptiveUpdates === "number"
      && persistedAutotune.adaptiveUpdates > seededState.adaptiveUpdates,
    state_quality_ema_present:
      typeof persistedAutotune?.qualityLowRateEma === "number"
      && typeof persistedAutotune?.qualityPressureEma === "number"
      && typeof persistedAutotune?.hardBudgetFollowupDeltaEma === "number"
      && typeof persistedAutotune?.qualityFirstFollowupDeltaEma === "number",
    state_last_reason:
      typeof persistedAutotune?.lastReason === "string" ? persistedAutotune.lastReason : "",
    state_last_reason_has_quality_tighten:
      typeof persistedAutotune?.lastReason === "string"
      && persistedAutotune.lastReason.includes("quality_pressure_tighten"),
    strategy_state_exists: Boolean(persistedStrategyAutotune),
    strategy_state_adaptive_updates_before: seededStrategyState.adaptiveUpdates,
    strategy_state_adaptive_updates_after:
      typeof persistedStrategyAutotune?.adaptiveUpdates === "number"
        ? persistedStrategyAutotune.adaptiveUpdates
        : null,
    strategy_state_adaptive_updates_increased:
      typeof persistedStrategyAutotune?.adaptiveUpdates === "number"
      && persistedStrategyAutotune.adaptiveUpdates > seededStrategyState.adaptiveUpdates,
    strategy_state_quality_ema_present:
      typeof persistedStrategyAutotune?.qualityLowRateEma === "number"
      && typeof persistedStrategyAutotune?.qualityPressureEma === "number"
      && typeof persistedStrategyAutotune?.hardBudgetRateEma === "number"
      && typeof persistedStrategyAutotune?.qualityFirstImprovedRateEma === "number",
    strategy_state_profile_fields_present:
      typeof persistedStrategyAutotune?.schemaVersion === "number"
      && typeof persistedStrategyAutotune?.profile === "string",
    strategy_state_pending_outcome_fields_present:
      typeof persistedStrategyAutotune?.pendingEvaluationDirection === "string"
      && typeof persistedStrategyAutotune?.pendingEvaluationWarmupTurns === "number"
      && typeof persistedStrategyAutotune?.outcomeConfidenceEma === "number"
      && typeof persistedStrategyAutotune?.lastOutcomeGain === "number"
      && typeof persistedStrategyAutotune?.outcomeRollbackCount === "number",
    strategy_state_last_reason:
      typeof persistedStrategyAutotune?.lastReason === "string"
        ? persistedStrategyAutotune.lastReason
        : "",
    strategy_state_last_reason_has_quality_tighten:
      typeof persistedStrategyAutotune?.lastReason === "string"
      && persistedStrategyAutotune.lastReason.includes("quality_pressure_tighten"),
    state_path: statePath,
    strategy_state_path: strategyStatePath,
    prompt_seed_path: promptSeedPath,
  };
}

function runStartContextMemoryDecayAutotuneQualityRelaxFlow(repoRoot) {
  const workDir = createTempDir("grobot-start-memory-decay-autotune-quality-relax-work");
  writeExecutionProjectToml(workDir);
  const contextDir = `${workDir}/.grobot/context`;
  const memoryContextEngineDir = `${workDir}/.grobot/memory/context-engine`;
  mkdirSync(contextDir, { recursive: true });
  mkdirSync(memoryContextEngineDir, { recursive: true });
  const promptSeedPath = `${contextDir}/prompt-quality-window.jsonl`;
  const statePath = `${memoryContextEngineDir}/memory-decay-autotune-state.json`;
  const strategyStatePath = `${memoryContextEngineDir}/memory-strategy-autotune-state.json`;
  const seedNowMs = Date.now();
  const promptRows = [0, 1, 2].map((index) => ({
    ts: new Date(seedNowMs - (3 - index) * 1_000).toISOString(),
    sessionKey: "seed:memory-decay-quality-autotune-relax",
    stage: "normal",
    selectionReason: "seed",
    estimatedTokens: 4200 + (index * 80),
    targetTokenLimit: 5000,
    scores: {
      coverage: 0.74,
      recency: 0.72,
      size: 0.76,
      overall: 0.72 + (index * 0.06),
    },
    signals: {
      recentRows: 2,
      snapshotSections: 3,
      recentTrimRows: 0,
      snapshotTrimSections: 0,
      snapshotSemanticCompressSections: 0,
      headTrimRetries: 0,
      autoLimitTriggered: false,
      downshiftGuardTriggered: false,
      preSendStrategy: "quality_first",
      preSendOverflowRatio: 0.05 + (index * 0.01),
      preSendPressureScore: 0.18 + (index * 0.02),
    },
  }));
  writeFileSync(
    promptSeedPath,
    `${promptRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
  const seededState = {
    maxRowsPerSession: 220,
    minConfidenceVerified: 0.28,
    minConfidenceUnverified: 0.58,
    unverifiedMaxAgeHours: 72,
    adaptiveLearnAlpha: 0.2,
    adaptiveUpdates: 5,
    dropRatioEma: 0.01,
    capacityTrimRatioEma: 0.01,
    lowConfidenceRatioEma: 0.02,
    ageDropRatioEma: 0.03,
    qualityLowRateEma: 0.12,
    qualityPressureEma: 0.18,
    hardBudgetFollowupDeltaEma: 0.00,
    qualityFirstFollowupDeltaEma: 0.03,
    lastReason: "seed_quality_relax",
    updatedAt: "2026-04-19T10:30:00.000Z",
  };
  writeFileSync(statePath, `${JSON.stringify(seededState, null, 2)}\n`, "utf8");
  const seededStrategyState = {
    injectBudgetRatio: 0.16,
    maxSectionTokens: 820,
    maxGaMemoryRows: 2,
    maxTeamExperienceRows: 2,
    minTeamExperienceScore: 44,
    adaptiveLearnAlpha: 0.2,
    adaptiveUpdates: 4,
    qualityLowRateEma: 0.09,
    qualityPressureEma: 0.18,
    hardBudgetRateEma: 0.1,
    qualityFirstImprovedRateEma: 0.8,
    hardBudgetFollowupDeltaEma: -0.01,
    qualityFirstFollowupDeltaEma: 0.08,
    lastReason: "seed_quality_relax",
    updatedAt: "2026-04-19T10:35:00.000Z",
  };
  writeFileSync(strategyStatePath, `${JSON.stringify(seededStrategyState, null, 2)}\n`, "utf8");
  const config = writeConfig(buildSmokeConfig(workDir));
  const startResult = runCommand(repoRoot, [
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
    "memory-decay-quality-autotune-relax-user",
    "--history-turns",
    "8",
    "--message",
    "memory decay autotune should relax by prompt quality signal",
  ]);
  const maintenanceEvent = startResult.stderr.match(
    /event=maintenance[^\n]*quality_low_rate=([0-9.<>-]+)[^\n]*quality_pressure=([0-9.<>-]+)[^\n]*decay_autotune_reason=([a-z_,]+)/,
  );
  const statusResult = runCommand(repoRoot, [
    "./grobot",
    "status",
    "--json",
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
  ]);
  const parsedStatus = parseJsonObjectSafe(statusResult.stdout);
  const memoryOrchestrator = isObject(parsedStatus?.context_engine?.memory_orchestrator)
    ? parsedStatus.context_engine.memory_orchestrator
    : null;
  const statusAutotune = isObject(memoryOrchestrator?.autotune)
    ? memoryOrchestrator.autotune
    : null;
  const statusStrategyAutotune = isObject(memoryOrchestrator?.strategy_autotune)
    ? memoryOrchestrator.strategy_autotune
    : null;
  const statusReason = typeof statusAutotune?.last_reason === "string"
    ? statusAutotune.last_reason
    : "";
  const statusStrategyReason = typeof statusStrategyAutotune?.last_reason === "string"
    ? statusStrategyAutotune.last_reason
    : "";
  const persistedState = readJsonFileSafe(statePath);
  const persistedAutotune = isObject(persistedState) ? persistedState : null;
  const persistedStrategyState = readJsonFileSafe(strategyStatePath);
  const persistedStrategyAutotune = isObject(persistedStrategyState) ? persistedStrategyState : null;
  const decayMaxRowsAfter = typeof memoryOrchestrator?.decay_max_rows_per_session === "number"
    ? memoryOrchestrator.decay_max_rows_per_session
    : null;
  const decayMinConfidenceVerifiedAfter =
    typeof memoryOrchestrator?.decay_min_confidence_verified === "number"
      ? memoryOrchestrator.decay_min_confidence_verified
      : null;
  const decayMinConfidenceUnverifiedAfter =
    typeof memoryOrchestrator?.decay_min_confidence_unverified === "number"
      ? memoryOrchestrator.decay_min_confidence_unverified
      : null;
  return {
    start_exit_code: startResult.exit_code,
    status_exit_code: statusResult.exit_code,
    maintenance_quality_signal_logged:
      Boolean(maintenanceEvent) || statusReason.includes("quality_signal_relax"),
    maintenance_quality_low_rate: maintenanceEvent?.[1] ?? "",
    maintenance_quality_pressure: maintenanceEvent?.[2] ?? "",
    maintenance_autotune_reason: maintenanceEvent?.[3] ?? "",
    maintenance_autotune_quality_reason_seen:
      (
        typeof maintenanceEvent?.[3] === "string"
        && maintenanceEvent[3].includes("quality_signal_relax")
      ) || statusReason.includes("quality_signal_relax"),
    status_json_parse_ok: Boolean(parsedStatus),
    status_memory_orchestrator_present: Boolean(memoryOrchestrator),
    status_memory_autotune_present: Boolean(statusAutotune),
    status_memory_strategy_autotune_present: Boolean(statusStrategyAutotune),
    status_memory_autotune_quality_fields_present:
      typeof statusAutotune?.quality_low_rate_ema === "number"
      && typeof statusAutotune?.quality_pressure_ema === "number"
      && typeof statusAutotune?.hard_budget_followup_delta_ema === "number"
      && typeof statusAutotune?.quality_first_followup_delta_ema === "number",
    status_memory_strategy_autotune_quality_fields_present:
      typeof statusStrategyAutotune?.quality_low_rate_ema === "number"
      && typeof statusStrategyAutotune?.quality_pressure_ema === "number"
      && typeof statusStrategyAutotune?.average_utilization_ratio_ema === "number"
      && typeof statusStrategyAutotune?.auto_limit_triggered_rate_ema === "number"
      && typeof statusStrategyAutotune?.snapshot_semantic_compress_rate_ema === "number"
      && typeof statusStrategyAutotune?.hard_budget_rate_ema === "number"
      && typeof statusStrategyAutotune?.quality_first_improved_rate_ema === "number"
      && typeof statusStrategyAutotune?.hard_budget_followup_delta_ema === "number"
      && typeof statusStrategyAutotune?.quality_first_followup_delta_ema === "number",
    status_memory_strategy_autotune_profile_fields_present:
      typeof statusStrategyAutotune?.schema_version === "number"
      && typeof statusStrategyAutotune?.profile === "string",
    status_memory_strategy_autotune_pending_fields_present:
      typeof statusStrategyAutotune?.pending_evaluation_direction === "string"
      && typeof statusStrategyAutotune?.pending_evaluation_warmup_turns === "number",
    status_memory_strategy_autotune_outcome_fields_present:
      typeof statusStrategyAutotune?.outcome_confidence_ema === "number"
      && typeof statusStrategyAutotune?.last_outcome_gain === "number"
      && typeof statusStrategyAutotune?.outcome_rollback_count === "number"
      && typeof statusStrategyAutotune?.outcome_negative_streak === "number",
    status_memory_autotune_last_reason: statusReason,
    status_memory_autotune_reason_has_quality_relax:
      statusReason.includes("quality_signal_relax"),
    status_memory_strategy_autotune_last_reason: statusStrategyReason,
    status_memory_strategy_autotune_reason_has_quality_relax:
      statusStrategyReason.includes("quality_signal_relax"),
    status_memory_decay_max_rows_before: seededState.maxRowsPerSession,
    status_memory_decay_max_rows_after: decayMaxRowsAfter,
    status_memory_decay_max_rows_relaxed:
      typeof decayMaxRowsAfter === "number" && decayMaxRowsAfter > seededState.maxRowsPerSession,
    status_memory_decay_verified_conf_before: seededState.minConfidenceVerified,
    status_memory_decay_verified_conf_after: decayMinConfidenceVerifiedAfter,
    status_memory_decay_unverified_conf_before: seededState.minConfidenceUnverified,
    status_memory_decay_unverified_conf_after: decayMinConfidenceUnverifiedAfter,
    status_memory_decay_confidence_relaxed:
      typeof decayMinConfidenceVerifiedAfter === "number"
      && typeof decayMinConfidenceUnverifiedAfter === "number"
      && decayMinConfidenceVerifiedAfter < seededState.minConfidenceVerified
      && decayMinConfidenceUnverifiedAfter < seededState.minConfidenceUnverified,
    status_memory_strategy_budget_ratio_before: seededStrategyState.injectBudgetRatio,
    status_memory_strategy_budget_ratio_after:
      typeof memoryOrchestrator?.inject_budget_ratio === "number"
        ? memoryOrchestrator.inject_budget_ratio
        : null,
    status_memory_strategy_budget_ratio_relaxed:
      typeof memoryOrchestrator?.inject_budget_ratio === "number"
      && memoryOrchestrator.inject_budget_ratio > seededStrategyState.injectBudgetRatio,
    status_memory_strategy_section_before: seededStrategyState.maxSectionTokens,
    status_memory_strategy_section_after:
      typeof memoryOrchestrator?.max_section_tokens === "number"
        ? memoryOrchestrator.max_section_tokens
        : null,
    status_memory_strategy_section_relaxed:
      typeof memoryOrchestrator?.max_section_tokens === "number"
      && memoryOrchestrator.max_section_tokens > seededStrategyState.maxSectionTokens,
    state_exists: Boolean(persistedAutotune),
    state_adaptive_updates_before: seededState.adaptiveUpdates,
    state_adaptive_updates_after:
      typeof persistedAutotune?.adaptiveUpdates === "number"
        ? persistedAutotune.adaptiveUpdates
        : null,
    state_adaptive_updates_increased:
      typeof persistedAutotune?.adaptiveUpdates === "number"
      && persistedAutotune.adaptiveUpdates > seededState.adaptiveUpdates,
    state_quality_ema_present:
      typeof persistedAutotune?.qualityLowRateEma === "number"
      && typeof persistedAutotune?.qualityPressureEma === "number"
      && typeof persistedAutotune?.hardBudgetFollowupDeltaEma === "number"
      && typeof persistedAutotune?.qualityFirstFollowupDeltaEma === "number",
    state_last_reason:
      typeof persistedAutotune?.lastReason === "string" ? persistedAutotune.lastReason : "",
    state_last_reason_has_quality_relax:
      typeof persistedAutotune?.lastReason === "string"
      && persistedAutotune.lastReason.includes("quality_signal_relax"),
    strategy_state_exists: Boolean(persistedStrategyAutotune),
    strategy_state_adaptive_updates_before: seededStrategyState.adaptiveUpdates,
    strategy_state_adaptive_updates_after:
      typeof persistedStrategyAutotune?.adaptiveUpdates === "number"
        ? persistedStrategyAutotune.adaptiveUpdates
        : null,
    strategy_state_adaptive_updates_increased:
      typeof persistedStrategyAutotune?.adaptiveUpdates === "number"
      && persistedStrategyAutotune.adaptiveUpdates > seededStrategyState.adaptiveUpdates,
    strategy_state_quality_ema_present:
      typeof persistedStrategyAutotune?.qualityLowRateEma === "number"
      && typeof persistedStrategyAutotune?.qualityPressureEma === "number"
      && typeof persistedStrategyAutotune?.hardBudgetRateEma === "number"
      && typeof persistedStrategyAutotune?.qualityFirstImprovedRateEma === "number",
    strategy_state_profile_fields_present:
      typeof persistedStrategyAutotune?.schemaVersion === "number"
      && typeof persistedStrategyAutotune?.profile === "string",
    strategy_state_pending_outcome_fields_present:
      typeof persistedStrategyAutotune?.pendingEvaluationDirection === "string"
      && typeof persistedStrategyAutotune?.pendingEvaluationWarmupTurns === "number"
      && typeof persistedStrategyAutotune?.outcomeConfidenceEma === "number"
      && typeof persistedStrategyAutotune?.lastOutcomeGain === "number"
      && typeof persistedStrategyAutotune?.outcomeRollbackCount === "number",
    strategy_state_last_reason:
      typeof persistedStrategyAutotune?.lastReason === "string"
        ? persistedStrategyAutotune.lastReason
        : "",
    strategy_state_last_reason_has_quality_relax:
      typeof persistedStrategyAutotune?.lastReason === "string"
      && persistedStrategyAutotune.lastReason.includes("quality_signal_relax"),
    state_path: statePath,
    strategy_state_path: strategyStatePath,
    prompt_seed_path: promptSeedPath,
  };
}

function runStartContextMemoryDecayAutotuneHysteresisFlow(repoRoot) {
  const workDir = createTempDir("grobot-start-memory-decay-autotune-hysteresis-work");
  writeExecutionProjectToml(workDir);
  const contextDir = `${workDir}/.grobot/context`;
  const memoryContextEngineDir = `${workDir}/.grobot/memory/context-engine`;
  mkdirSync(contextDir, { recursive: true });
  mkdirSync(memoryContextEngineDir, { recursive: true });
  const promptSeedPath = `${contextDir}/prompt-quality-window.jsonl`;
  const statePath = `${memoryContextEngineDir}/memory-decay-autotune-state.json`;
  const seededState = {
    maxRowsPerSession: 240,
    minConfidenceVerified: 0.20,
    minConfidenceUnverified: 0.45,
    unverifiedMaxAgeHours: 72,
    adaptiveLearnAlpha: 0.2,
    adaptiveUpdates: 5,
    dropRatioEma: 0.01,
    capacityTrimRatioEma: 0.01,
    lowConfidenceRatioEma: 0.02,
    ageDropRatioEma: 0.03,
    qualityLowRateEma: 0.72,
    qualityPressureEma: 0.74,
    hardBudgetFollowupDeltaEma: -0.12,
    qualityFirstFollowupDeltaEma: -0.02,
    lastReason: "seed_hysteresis",
    updatedAt: "2026-04-19T11:00:00.000Z",
  };
  writeFileSync(statePath, `${JSON.stringify(seededState, null, 2)}\n`, "utf8");
  const config = writeConfig(buildSmokeConfig(workDir));

  const buildPromptRows = (profile) => {
    const seedNowMs = Date.now();
    if (profile === "pressure") {
      return [0, 1, 2].map((index) => ({
        ts: new Date(seedNowMs - (3 - index) * 1_000).toISOString(),
        sessionKey: "seed:memory-decay-hysteresis-pressure",
        stage: "minimal",
        selectionReason: "seed",
        estimatedTokens: 8200 + (index * 120),
        targetTokenLimit: 5000,
        scores: {
          coverage: 0.38,
          recency: 0.33,
          size: 0.29,
          overall: 0.46 - (index * 0.04),
        },
        signals: {
          recentRows: 2,
          snapshotSections: 3,
          recentTrimRows: 1,
          snapshotTrimSections: 2,
          snapshotSemanticCompressSections: 3,
          headTrimRetries: 1,
          autoLimitTriggered: true,
          downshiftGuardTriggered: true,
          preSendStrategy: "hard_budget",
          preSendOverflowRatio: 0.52 + (index * 0.03),
          preSendPressureScore: 0.84 + (index * 0.02),
        },
      }));
    }
    return [0, 1, 2, 3].map((index) => ({
      ts: new Date(seedNowMs - (4 - index) * 1_000).toISOString(),
      sessionKey: "seed:memory-decay-hysteresis-relax",
      stage: "normal",
      selectionReason: "seed",
      estimatedTokens: 4200 + (index * 80),
      targetTokenLimit: 5000,
      scores: {
        coverage: 0.74,
        recency: 0.72,
        size: 0.76,
        overall: 0.72 + (index * 0.06),
      },
      signals: {
        recentRows: 2,
        snapshotSections: 3,
        recentTrimRows: 0,
        snapshotTrimSections: 0,
        snapshotSemanticCompressSections: 0,
        headTrimRetries: 0,
        autoLimitTriggered: false,
        downshiftGuardTriggered: false,
        preSendStrategy: "quality_first",
        preSendOverflowRatio: 0.05 + (index * 0.01),
        preSendPressureScore: 0.18 + (index * 0.02),
      },
    }));
  };

  const runRound = (label, profile, message) => {
    const rows = buildPromptRows(profile);
    writeFileSync(promptSeedPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
    const startResult = runCommand(repoRoot, [
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
      `memory-decay-hysteresis-${label}`,
      "--history-turns",
      "8",
      "--message",
      message,
    ]);
    const statusResult = runCommand(repoRoot, [
      "./grobot",
      "status",
      "--json",
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
    ]);
    const parsedStatus = parseJsonObjectSafe(statusResult.stdout);
    const memoryOrchestrator = isObject(parsedStatus?.context_engine?.memory_orchestrator)
      ? parsedStatus.context_engine.memory_orchestrator
      : null;
    const statusAutotune = isObject(memoryOrchestrator?.autotune)
      ? memoryOrchestrator.autotune
      : null;
    const persisted = readJsonFileSafe(statePath);
    const persistedAutotune = isObject(persisted) ? persisted : null;
    const reason = typeof statusAutotune?.last_reason === "string" ? statusAutotune.last_reason : "";
    return {
      label,
      profile,
      start_exit_code: startResult.exit_code,
      status_exit_code: statusResult.exit_code,
      reason,
      has_tighten: reason.includes("quality_pressure_tighten"),
      has_relax: reason.includes("quality_signal_relax"),
      decay_max_rows:
        typeof memoryOrchestrator?.decay_max_rows_per_session === "number"
          ? memoryOrchestrator.decay_max_rows_per_session
          : null,
      decay_min_conf_verified:
        typeof memoryOrchestrator?.decay_min_confidence_verified === "number"
          ? memoryOrchestrator.decay_min_confidence_verified
          : null,
      decay_min_conf_unverified:
        typeof memoryOrchestrator?.decay_min_confidence_unverified === "number"
          ? memoryOrchestrator.decay_min_confidence_unverified
          : null,
      adaptive_updates:
        typeof persistedAutotune?.adaptiveUpdates === "number"
          ? persistedAutotune.adaptiveUpdates
          : null,
      quality_low_ema:
        typeof persistedAutotune?.qualityLowRateEma === "number"
          ? persistedAutotune.qualityLowRateEma
          : null,
      quality_pressure_ema:
        typeof persistedAutotune?.qualityPressureEma === "number"
          ? persistedAutotune.qualityPressureEma
          : null,
    };
  };

  const firstRound = runRound(
    "pressure-1",
    "pressure",
    "memory decay hysteresis pass 1 should tighten under pressure",
  );

  const lowRounds = [];
  let relaxRoundIndex = null;
  for (let index = 1; index <= 10; index += 1) {
    const lowRound = runRound(
      `relax-${String(index)}`,
      "relax",
      `memory decay hysteresis relax pass ${String(index)}`,
    );
    lowRounds.push(lowRound);
    if (lowRound.has_relax) {
      relaxRoundIndex = index;
      break;
    }
  }

  const roundsBeforeRelax = relaxRoundIndex == null
    ? lowRounds
    : lowRounds.slice(0, Math.max(0, relaxRoundIndex - 1));
  const noEarlyRelax = roundsBeforeRelax.every((round) => !round.has_relax);
  const relaxRound = relaxRoundIndex == null ? null : lowRounds[relaxRoundIndex - 1] ?? null;
  const relaxPrevRound = relaxRoundIndex == null
    ? null
    : (relaxRoundIndex > 1 ? lowRounds[relaxRoundIndex - 2] ?? null : firstRound);
  const relaxRowsExpanded = Boolean(
    relaxRound
    && relaxPrevRound
    && typeof relaxRound.decay_max_rows === "number"
    && typeof relaxPrevRound.decay_max_rows === "number"
    && relaxRound.decay_max_rows > relaxPrevRound.decay_max_rows,
  );
  const relaxConfidenceRelaxed = Boolean(
    relaxRound
    && relaxPrevRound
    && typeof relaxRound.decay_min_conf_verified === "number"
    && typeof relaxRound.decay_min_conf_unverified === "number"
    && typeof relaxPrevRound.decay_min_conf_verified === "number"
    && typeof relaxPrevRound.decay_min_conf_unverified === "number"
    && relaxRound.decay_min_conf_verified < relaxPrevRound.decay_min_conf_verified
    && relaxRound.decay_min_conf_unverified < relaxPrevRound.decay_min_conf_unverified,
  );
  const allRounds = [firstRound, ...lowRounds];
  let updatesMonotonic = true;
  for (let index = 1; index < allRounds.length; index += 1) {
    const prev = allRounds[index - 1];
    const next = allRounds[index];
    if (
      !prev
      || !next
      || typeof prev.adaptive_updates !== "number"
      || typeof next.adaptive_updates !== "number"
      || next.adaptive_updates < prev.adaptive_updates
    ) {
      updatesMonotonic = false;
      break;
    }
  }
  const finalLowRound = lowRounds.length > 0 ? lowRounds[lowRounds.length - 1] ?? null : null;
  const finalQualityLowEma =
    finalLowRound && typeof finalLowRound.quality_low_ema === "number"
      ? finalLowRound.quality_low_ema
      : null;
  const finalQualityPressureEma =
    finalLowRound && typeof finalLowRound.quality_pressure_ema === "number"
      ? finalLowRound.quality_pressure_ema
      : null;
  const finalQualityRelaxWindowReached = Boolean(
    typeof finalQualityLowEma === "number"
    && typeof finalQualityPressureEma === "number"
    && finalQualityLowEma <= 0.2
    && finalQualityPressureEma <= 0.38,
  );

  return {
    first_round_start_exit_code: firstRound.start_exit_code,
    first_round_status_exit_code: firstRound.status_exit_code,
    first_round_reason: firstRound.reason,
    first_round_has_quality_tighten: firstRound.has_tighten,
    low_rounds_executed: lowRounds.length,
    relax_seen: relaxRoundIndex != null,
    relax_round_index: relaxRoundIndex,
    no_early_relax: noEarlyRelax,
    relax_rows_expanded: relaxRowsExpanded,
    relax_confidence_relaxed: relaxConfidenceRelaxed,
    updates_monotonic: updatesMonotonic,
    final_quality_low_ema: finalQualityLowEma,
    final_quality_pressure_ema: finalQualityPressureEma,
    final_quality_relax_window_reached: finalQualityRelaxWindowReached,
    state_path: statePath,
    prompt_seed_path: promptSeedPath,
  };
}

function writeNonRecoverableToolRecoveryMetrics(workDir) {
  const runtimeDir = `${workDir}/.grobot/runtime`;
  mkdirSync(runtimeDir, { recursive: true });
  const observedAt = new Date().toISOString();
  const previousObservedAt = new Date(Date.parse(observedAt) - 5 * 60_000).toISOString();
  writeFileSync(
    `${runtimeDir}/tool-surface-metrics.json`,
    `${JSON.stringify({
      version: 1,
      updatedAt: observedAt,
      callsTotal: 1,
      failedTotal: 1,
      deferredTotal: 0,
      callsByTool: { web_scan: 1 },
      failuresByErrorClass: { config_missing: 1 },
      recoveryStages: { ask_user: 1 },
      durationTotalMsByTool: { web_scan: 12 },
      durationCountByTool: { web_scan: 1 },
      recentRecoveries: [
        {
          stage: "local_fix",
          reason: "path_not_found",
          recommendedNextAction: "locate_path_with_glob_before_retry",
          toolName: "read",
          errorClass: "path_not_found",
          recoverable: true,
          observedAt: previousObservedAt,
        },
        {
          stage: "ask_user",
          reason: "config_missing",
          recommendedNextAction: "ask_user_for_config_or_switch_provider",
          toolName: "web_scan",
          errorClass: "config_missing",
          recoverable: false,
          observedAt,
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  return observedAt;
}

function writeNonRecoverableToolRecoveryConsumption(workDir, observedAt) {
  const runtimeDir = `${workDir}/.grobot/runtime`;
  mkdirSync(runtimeDir, { recursive: true });
  const consumedAt = new Date(Date.parse(observedAt) + 60_000).toISOString();
  writeFileSync(
    `${runtimeDir}/tool-surface-adaptation-state.json`,
    `${JSON.stringify({
      version: 1,
      updatedAt: consumedAt,
      recentAdaptations: [],
      profileOutcomes: {},
      recentRecoveryConsumptions: [
        {
          id: "tsc_nonrecoverable_intervention_prompted_contract",
          reason: "nonrecoverable_intervention_prompted",
          recoveryStage: "ask_user",
          recoveryToolName: "web_scan",
          recoveryErrorClass: "config_missing",
          recoveryObservedAt: observedAt,
          consumedAt,
          traceId: "trace_status_nonrecoverable_consumed_contract",
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
}

function runStatusNonRecoverableToolRecovery(repoRoot) {
  const workDir = createTempDir("grobot-status-nonrecoverable-work");
  writeExecutionProjectToml(workDir);
  writeNonRecoverableToolRecoveryMetrics(workDir);
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
  const jsonResult = runCommand(repoRoot, [...statusArgs, "--json"]);
  const textResult = runCommand(repoRoot, statusArgs);
  const parsedStatus = parseJsonObjectSafe(jsonResult.stdout);
  const runtimeTools = isObject(parsedStatus?.runtime_tools)
    ? parsedStatus.runtime_tools
    : null;
  const recoveryFeedback = isObject(runtimeTools?.recovery_feedback)
    ? runtimeTools.recovery_feedback
    : null;
  const recoveryTimeline = Array.isArray(runtimeTools?.recovery_timeline)
    ? runtimeTools.recovery_timeline
    : [];
  const latestRecoveryTimeline = isObject(recoveryTimeline[0]) ? recoveryTimeline[0] : null;
  const previousRecoveryTimeline = isObject(recoveryTimeline[1]) ? recoveryTimeline[1] : null;
  const recoveryHealth = isObject(runtimeTools?.recovery_health)
    ? runtimeTools.recovery_health
    : null;
  const surfaceAdaptation = isObject(runtimeTools?.surface_adaptation)
    ? runtimeTools.surface_adaptation
    : null;
  return {
    exit_code: jsonResult.exit_code,
    text_exit_code: textResult.exit_code,
    status_json_parse_ok: Boolean(parsedStatus),
    recovery_feedback_active: recoveryFeedback?.active ?? null,
    recovery_feedback_stage: recoveryFeedback?.stage ?? null,
    recovery_feedback_recoverable: recoveryFeedback?.recoverable ?? null,
    recovery_feedback_requires_user_intervention:
      recoveryFeedback?.requires_user_intervention ?? null,
    recovery_timeline_count: recoveryTimeline.length,
    recovery_timeline_latest_recovery_key: latestRecoveryTimeline?.recovery_key ?? null,
    recovery_timeline_latest_active: latestRecoveryTimeline?.active ?? null,
    recovery_timeline_latest_consumed: latestRecoveryTimeline?.consumed ?? null,
    recovery_timeline_latest_stage: latestRecoveryTimeline?.stage ?? null,
    recovery_timeline_latest_tool_name: latestRecoveryTimeline?.tool_name ?? null,
    recovery_timeline_previous_recovery_key: previousRecoveryTimeline?.recovery_key ?? null,
    recovery_timeline_previous_tool_name: previousRecoveryTimeline?.tool_name ?? null,
    recovery_health_active_recovery_count: recoveryHealth?.active_recovery_count ?? null,
    recovery_health_active_nonrecoverable_count:
      recoveryHealth?.active_nonrecoverable_count ?? null,
    recovery_health_unconsumed_count: recoveryHealth?.unconsumed_count ?? null,
    recovery_health_has_stuck_nonrecoverable:
      recoveryHealth?.has_stuck_nonrecoverable ?? null,
    recovery_health_latest_recovery_key: recoveryHealth?.latest_recovery_key ?? null,
    recovery_health_score: recoveryHealth?.score ?? null,
    recovery_health_level: recoveryHealth?.level ?? null,
    recovery_health_reason: recoveryHealth?.reason ?? null,
    recovery_health_recommended_next_action:
      recoveryHealth?.recommended_next_action ?? null,
    recovery_health_attention_source: recoveryHealth?.attention_source ?? null,
    recovery_health_attention_recovery_key:
      recoveryHealth?.attention_recovery_key ?? null,
    recovery_health_attention_tool_name:
      recoveryHealth?.attention_tool_name ?? null,
    recovery_health_attention_requires_user_intervention:
      recoveryHealth?.attention_requires_user_intervention ?? null,
    surface_adaptation_active: surfaceAdaptation?.active ?? null,
    surface_adaptation_reason: surfaceAdaptation?.reason ?? null,
    surface_adaptation_from_profile: surfaceAdaptation?.from_profile ?? null,
    surface_adaptation_applied_profile: surfaceAdaptation?.applied_profile ?? null,
    surface_adaptation_auto_adaptation_blocked:
      surfaceAdaptation?.auto_adaptation_blocked ?? null,
    surface_adaptation_recovery_recoverable:
      surfaceAdaptation?.recovery_recoverable ?? null,
    text_has_requires_user_intervention:
      textResult.stdout.includes("requires_user_intervention=true"),
    text_has_auto_adaptation_blocked:
      textResult.stdout.includes("auto_adaptation_blocked=true"),
    text_has_nonrecoverable_reason:
      textResult.stdout.includes("recovery_requires_user_intervention"),
    text_has_recovery_timeline:
      textResult.stdout.includes("runtime_tool_recovery_timeline: entries=2")
      && textResult.stdout.includes("latest=web_scan/config_missing"),
    text_has_recovery_health:
      textResult.stdout.includes("runtime_tool_recovery_health:")
      && textResult.stdout.includes("active_nonrecoverable=1")
      && textResult.stdout.includes("stuck_nonrecoverable=true"),
  };
}

function runStatusNonRecoverableToolRecoveryConsumed(repoRoot) {
  const workDir = createTempDir("grobot-status-nonrecoverable-consumed-work");
  writeExecutionProjectToml(workDir);
  const observedAt = writeNonRecoverableToolRecoveryMetrics(workDir);
  writeNonRecoverableToolRecoveryConsumption(workDir, observedAt);
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
  const jsonResult = runCommand(repoRoot, [...statusArgs, "--json"]);
  const textResult = runCommand(repoRoot, statusArgs);
  const parsedStatus = parseJsonObjectSafe(jsonResult.stdout);
  const runtimeTools = isObject(parsedStatus?.runtime_tools)
    ? parsedStatus.runtime_tools
    : null;
  const recoveryFeedback = isObject(runtimeTools?.recovery_feedback)
    ? runtimeTools.recovery_feedback
    : null;
  const recoveryTimeline = Array.isArray(runtimeTools?.recovery_timeline)
    ? runtimeTools.recovery_timeline
    : [];
  const latestRecoveryTimeline = isObject(recoveryTimeline[0]) ? recoveryTimeline[0] : null;
  const previousRecoveryTimeline = isObject(recoveryTimeline[1]) ? recoveryTimeline[1] : null;
  const recoveryHealth = isObject(runtimeTools?.recovery_health)
    ? runtimeTools.recovery_health
    : null;
  const surfaceAdaptation = isObject(runtimeTools?.surface_adaptation)
    ? runtimeTools.surface_adaptation
    : null;
  return {
    exit_code: jsonResult.exit_code,
    text_exit_code: textResult.exit_code,
    status_json_parse_ok: Boolean(parsedStatus),
    recovery_feedback_active: recoveryFeedback?.active ?? null,
    recovery_feedback_reason: recoveryFeedback?.reason ?? null,
    recovery_feedback_recoverable: recoveryFeedback?.recoverable ?? null,
    recovery_feedback_requires_user_intervention:
      recoveryFeedback?.requires_user_intervention ?? null,
    recovery_feedback_consumed: recoveryFeedback?.consumed ?? null,
    recovery_feedback_consumed_reason: recoveryFeedback?.consumed_reason ?? null,
    recovery_timeline_count: recoveryTimeline.length,
    recovery_timeline_latest_recovery_key: latestRecoveryTimeline?.recovery_key ?? null,
    recovery_timeline_latest_active: latestRecoveryTimeline?.active ?? null,
    recovery_timeline_latest_consumed: latestRecoveryTimeline?.consumed ?? null,
    recovery_timeline_latest_consumed_reason: latestRecoveryTimeline?.consumed_reason ?? null,
    recovery_timeline_latest_stage: latestRecoveryTimeline?.stage ?? null,
    recovery_timeline_latest_tool_name: latestRecoveryTimeline?.tool_name ?? null,
    recovery_timeline_previous_recovery_key: previousRecoveryTimeline?.recovery_key ?? null,
    recovery_timeline_previous_tool_name: previousRecoveryTimeline?.tool_name ?? null,
    recovery_health_active_recovery_count: recoveryHealth?.active_recovery_count ?? null,
    recovery_health_active_nonrecoverable_count:
      recoveryHealth?.active_nonrecoverable_count ?? null,
    recovery_health_unconsumed_count: recoveryHealth?.unconsumed_count ?? null,
    recovery_health_has_stuck_nonrecoverable:
      recoveryHealth?.has_stuck_nonrecoverable ?? null,
    recovery_health_latest_recovery_key: recoveryHealth?.latest_recovery_key ?? null,
    recovery_health_score: recoveryHealth?.score ?? null,
    recovery_health_level: recoveryHealth?.level ?? null,
    recovery_health_reason: recoveryHealth?.reason ?? null,
    recovery_health_recommended_next_action:
      recoveryHealth?.recommended_next_action ?? null,
    recovery_health_attention_source: recoveryHealth?.attention_source ?? null,
    recovery_health_attention_recovery_key:
      recoveryHealth?.attention_recovery_key ?? null,
    recovery_health_attention_tool_name:
      recoveryHealth?.attention_tool_name ?? null,
    recovery_health_attention_requires_user_intervention:
      recoveryHealth?.attention_requires_user_intervention ?? null,
    surface_adaptation_active: surfaceAdaptation?.active ?? null,
    surface_adaptation_reason: surfaceAdaptation?.reason ?? null,
    surface_adaptation_auto_adaptation_blocked:
      surfaceAdaptation?.auto_adaptation_blocked ?? null,
    surface_adaptation_recovery_recoverable:
      surfaceAdaptation?.recovery_recoverable ?? null,
    text_has_consumed_nonrecoverable:
      textResult.stdout.includes("consumed=true")
      && textResult.stdout.includes("latest_consumption=nonrecoverable_intervention_prompted"),
    text_has_recovery_timeline:
      textResult.stdout.includes("runtime_tool_recovery_timeline: entries=2")
      && textResult.stdout.includes("latest=web_scan/config_missing")
      && textResult.stdout.includes("consumed=true"),
    text_has_recovery_health:
      textResult.stdout.includes("runtime_tool_recovery_health:")
      && textResult.stdout.includes("active_nonrecoverable=0")
      && textResult.stdout.includes("stuck_nonrecoverable=false"),
  };
}

function runStatusTsRustDeprecatedFlag(repoRoot) {
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

function runStatusTsRustMemoryLegacyFallback(repoRoot) {
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

function runStatusRuntimeDescribeUnavailable(repoRoot) {
  const workDir = createTempDir("grobot-status-runtime-describe-unavailable-work");
  writeExecutionProjectToml(workDir);
  const missingRuntimePath = "/tmp/grobot-missing-runtime";
  const result = runCommand(
    repoRoot,
    [
      "./grobot",
      "status",
      "--work-dir",
      workDir,
      "--gateway-impl",
      "ts",
      "--runtime-impl",
      "rust",
    ],
    { GROBOT_RUNTIME_BIN: missingRuntimePath },
  );
  return {
    ...result,
    missing_runtime_path: missingRuntimePath,
    has_gateway_fallback_projection: result.stdout.includes("runtime_tool_schema_projection: source=gateway.fallback"),
    has_gateway_fallback_suppressed_none: result.stdout.includes("runtime_tool_schema_suppressed_args: <none>"),
    has_gateway_fallback_drift_args_none: result.stdout.includes("runtime_tool_schema_projection_drift_args: <none>"),
    has_unavailable_suppressed_args: result.stdout.includes("runtime_tool_schema_suppressed_args: <unavailable"),
    has_unavailable_describe_reason: result.stdout.includes("runtime_tools_describe_unavailable:spawn_failed"),
  };
}

function runStatusRejectLegacyFlag(repoRoot) {
  return runCommand(repoRoot, ["./grobot", "status", "--legacy-python-cli"]);
}

function runStatusRejectPythonGateway(repoRoot) {
  return runCommand(repoRoot, ["./grobot", "status", "--gateway-impl", "python"]);
}

function runStatusRejectLegacyEnv(repoRoot) {
  return runCommand(repoRoot, ["./grobot", "status"], { GROBOT_LEGACY_PYTHON: "1" });
}

function runCli(argv) {
  const { command, options } = parseArgs(argv);
  const repoRoot = resolve(requireOption(options, "repo-root"));
  let payload;
    switch (command) {
    case "package-launcher-rejects-python":
      payload = runPackageLauncherRejectsPython(repoRoot);
      break;
    case "start-message-smoke":
      payload = runStartMessageSmoke(repoRoot);
      break;
    case "start-message-provider-config-ts-rust":
      payload = runStartMessageProviderConfigTsRust(
        repoRoot,
        requireOption(options, "provider-base-url"),
        requireOption(options, "provider-api-key"),
        requireOption(options, "provider-model"),
      );
      break;
    case "start-interactive-session-flow":
      payload = runStartInteractiveSessionFlow(repoRoot);
      break;
    case "start-bare-interactive-session-flow":
      payload = runStartBareInteractiveSessionFlow(repoRoot);
      break;
    case "start-interactive-diagnostics-compact-flow":
      payload = runStartInteractiveDiagnosticsFlow(repoRoot, "compact");
      break;
    case "start-interactive-diagnostics-verbose-flow":
      payload = runStartInteractiveDiagnosticsFlow(repoRoot, "verbose");
      break;
    case "start-interactive-diagnostics-trace-flow":
      payload = runStartInteractiveDiagnosticsFlow(repoRoot, "trace");
      break;
    case "start-interactive-diagnostics-plan-compact-flow":
      payload = runStartInteractiveDiagnosticsPlanFlow(repoRoot, "compact");
      break;
    case "start-interactive-diagnostics-plan-verbose-flow":
      payload = runStartInteractiveDiagnosticsPlanFlow(repoRoot, "verbose");
      break;
    case "start-interactive-diagnostics-skill-creator-compact-flow":
      payload = runStartInteractiveDiagnosticsSkillCreatorFlow(repoRoot, "compact");
      break;
    case "start-interactive-diagnostics-skill-creator-verbose-flow":
      payload = runStartInteractiveDiagnosticsSkillCreatorFlow(repoRoot, "verbose");
      break;
    case "start-interactive-diagnostics-user-command-compact-flow":
      payload = runStartInteractiveDiagnosticsUserCommandFlow(repoRoot, "compact");
      break;
    case "start-interactive-diagnostics-user-command-verbose-flow":
      payload = runStartInteractiveDiagnosticsUserCommandFlow(repoRoot, "verbose");
      break;
    case "start-im-only-reject-flow":
      payload = runStartImOnlyRejectFlow(repoRoot);
      break;
    case "start-interactive-session-commands-fallback-flow":
      payload = runStartInteractiveSessionCommandsFallbackFlow(repoRoot);
      break;
    case "start-interactive-interrupt-flow":
      payload = runStartInteractiveInterruptFlow(
        repoRoot,
        requireOption(options, "provider-base-url"),
        requireOption(options, "provider-api-key"),
        requireOption(options, "provider-model"),
      );
      break;
    case "start-session-menu-view-model-contract":
      payload = runStartSessionMenuViewModelContract(repoRoot);
      break;
    case "start-plan-mode-flow":
      payload = runStartPlanModeFlow(repoRoot);
      break;
    case "start-plan-concurrency-flow":
      payload = runStartPlanConcurrencyFlow(repoRoot);
      break;
    case "start-mcp-instruction-events-flow":
      payload = runStartMcpInstructionEventsFlow(repoRoot);
      break;
    case "failover-rejects-python":
      payload = runFailoverRejectsPython(repoRoot);
      break;
    case "failover-runs-ts-rust":
      payload = runFailoverTsRust(repoRoot);
      break;
    case "provider-pool-multi-turn-ts-rust":
      payload = runProviderPoolMultiTurnTsRust(
        repoRoot,
        requireOption(options, "provider-base-url"),
        Number.parseInt(options.get("provider-count") ?? "10", 10),
        Number.parseInt(options.get("turn-count") ?? "6", 10),
      );
      break;
    case "start-session-store-redis-fallback":
      payload = runStartSessionStoreRedisFallback(repoRoot);
      break;
    case "status-ts-rust":
      payload = runStatusTsRust(repoRoot);
      break;
    case "status-ts-rust-window-size": {
      const parsedWindowSize = Number.parseInt(options.get("window-size") ?? "7", 10);
      const normalizedWindowSize =
        Number.isFinite(parsedWindowSize) && parsedWindowSize > 0 ? parsedWindowSize : 7;
      payload = runStatusTsRust(repoRoot, normalizedWindowSize);
      break;
    }
    case "status-nonrecoverable-tool-recovery":
      payload = runStatusNonRecoverableToolRecovery(repoRoot);
      break;
    case "status-nonrecoverable-tool-recovery-consumed":
      payload = runStatusNonRecoverableToolRecoveryConsumed(repoRoot);
      break;
    case "start-context-pre-send-head-trim-flow":
      payload = runStartContextPreSendHeadTrimFlow(repoRoot);
      break;
    case "start-context-quality-guard-flow":
      payload = runStartContextQualityGuardFlow(repoRoot);
      break;
    case "start-context-graph-quality-autotune-flow":
      payload = runStartContextGraphQualityAutotuneFlow(repoRoot);
      break;
    case "start-context-graph-quality-autotune-hysteresis-flow":
      payload = runStartContextGraphQualityAutotuneHysteresisFlow(repoRoot);
      break;
    case "start-context-graph-quality-autotune-adaptive-sequence-flow":
      payload = runStartContextGraphQualityAutotuneAdaptiveSequenceFlow(repoRoot);
      break;
    case "start-context-memory-decay-autotune-quality-flow":
      payload = runStartContextMemoryDecayAutotuneQualityFlow(repoRoot);
      break;
    case "start-context-memory-decay-autotune-quality-relax-flow":
      payload = runStartContextMemoryDecayAutotuneQualityRelaxFlow(repoRoot);
      break;
    case "start-context-memory-decay-autotune-hysteresis-flow":
      payload = runStartContextMemoryDecayAutotuneHysteresisFlow(repoRoot);
      break;
    case "status-ts-rust-deprecated-flag":
      payload = runStatusTsRustDeprecatedFlag(repoRoot);
      break;
    case "status-ts-rust-memory-legacy-fallback":
      payload = runStatusTsRustMemoryLegacyFallback(repoRoot);
      break;
    case "status-runtime-describe-unavailable":
      payload = runStatusRuntimeDescribeUnavailable(repoRoot);
      break;
    case "status-reject-legacy-flag":
      payload = runStatusRejectLegacyFlag(repoRoot);
      break;
    case "status-reject-python-gateway":
      payload = runStatusRejectPythonGateway(repoRoot);
      break;
    case "status-reject-legacy-env":
      payload = runStatusRejectLegacyEnv(repoRoot);
      break;
    default:
      throw new Error(`unknown command: ${command}`);
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  return 0;
}

const entryScript = process.argv[1] ?? "";
const shouldRun = entryScript.includes("start-smoke-contract");

if (shouldRun) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    const message = isObject(error) && typeof error.message === "string" ? error.message : String(error);
    process.stderr.write(`start-smoke-contract fatal: ${message}\n`);
    process.exitCode = 1;
  }
}
