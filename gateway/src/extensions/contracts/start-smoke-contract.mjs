import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const registryPath = `${workDir}/.grobot/session/${sanitizeSessionKey(namespaceKey)}.sessions.json`;
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
  const activeHistoryPath = `${workDir}/.grobot/session/${sanitizeSessionKey(activeSessionKey)}.history.json`;
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
    ["/new", "/switch", "/continue", "/sessions", "/exit", ""].join("\n"),
  );
  const namespaceKey = `feishu:grobot:dm:${subject}`;
  const registryPath = `${workDir}/.grobot/session/${sanitizeSessionKey(namespaceKey)}.sessions.json`;
  const registryPayload = readJsonFileSafe(registryPath);
  const sessions = registryPayload && Array.isArray(registryPayload.sessions) ? registryPayload.sessions : [];
  const outputText = `${commandResult.stdout}\n${commandResult.stderr}`;
  return {
    ...commandResult,
    registry_path: registryPath,
    session_count: sessions.length,
    has_switch_usage: outputText.includes("Usage: /switch <session_id>"),
    has_continue_usage: outputText.includes("Usage: /continue <session_id>"),
    has_sessions_overview: outputText.includes("Session namespace:"),
    has_session_title_main: outputText.includes("Main Session"),
    has_session_title_untitled: outputText.includes("Untitled Session"),
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
        "add milestone for bridge /plan compatibility",
        "/plan apply smoke-review-failure",
        "/plan status",
        "/plan cancel",
        "/plan status",
        "/exit",
        "",
      ].join("\n"),
  );
  const namespaceKey = "feishu:grobot:dm:plan-smoke-user";
  const registryPath = `${workDir}/.grobot/session/${sanitizeSessionKey(namespaceKey)}.sessions.json`;
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
    review_failed_marker_seen: combinedOutput.includes("[plan-review] code=PLAN_REVIEW_FAILED"),
    review_blocked_marker_seen: combinedOutput.includes("[plan-review] code=PLAN_REVIEW_BLOCKED"),
    plan_cancelled_marker_seen: combinedOutput.includes("[plan] cancelled plan_id="),
    plan_final_status_line_seen: combinedOutput.includes("[plan-status]\nmode: normal\nactive_plan_id: <none>"),
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
  );

  writeRulePack(projectRulePath, "\n");
  writeRulePack(globalRulePath, "GLOBAL_GROK_SEARCH_RULE\n");
  const fallbackResult = runCommand(
    repoRoot,
    [...baseArgs, "--message", "mcp instruction pack fallback source smoke"],
  );

  writeRulePack(projectRulePath, "\n");
  writeRulePack(globalRulePath, "\n");
  const missingResult = runCommand(
    repoRoot,
    [...baseArgs, "--message", "mcp instruction pack missing smoke"],
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
  const historyPath = `${workDir}/.grobot/session/${sanitizeSessionKey(sessionKey)}.history.json`;
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

function runStatusTsRust(repoRoot) {
  const workDir = createTempDir("grobot-status-work");
  writeExecutionProjectToml(workDir);
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
  const routeDecision = isObject(parsedStatus?.route_decision)
    ? parsedStatus.route_decision
    : null;
  const routeFailover = isObject(routeDecision?.failover)
    ? routeDecision.failover
    : null;
  const runtimeHealth = isObject(parsedStatus?.runtime_health)
    ? parsedStatus.runtime_health
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
  const contextEngine = isObject(parsedStatus?.context_engine)
    ? parsedStatus.context_engine
    : null;
  const contextEngineThresholds = isObject(contextEngine?.thresholds)
    ? contextEngine.thresholds
    : null;
  const contextEngineRecovery = isObject(contextEngine?.recovery)
    ? contextEngine.recovery
    : null;
  const contextEngineLineage = isObject(contextEngine?.lineage)
    ? contextEngine.lineage
    : null;
  const contextEngineWorkspaceSignals = isObject(contextEngine?.workspace_signals)
    ? contextEngine.workspace_signals
    : null;
  const cacheStatsLocation = typeof parsedStatus?.cache_stats_location === "string"
    ? parsedStatus.cache_stats_location
    : null;
  return {
    ...result,
    status_json_parse_ok: Boolean(parsedStatus),
    status_has_route_decision: Boolean(routeDecision),
    status_has_route_ordered_providers: Array.isArray(routeDecision?.ordered_providers),
    status_has_route_failover: Boolean(routeFailover),
    status_has_runtime_health_cache_stats: Boolean(runtimeHealthCacheStats),
    status_cache_stats_location: cacheStatsLocation,
    status_prompt_cache_hint_attempted_type: typeof runtimePromptCache?.hint_attempted_total,
    status_prompt_cache_window_hint_attempted_type: typeof runtimePromptCacheWindow?.hint_attempted_total,
    status_has_context_graph_cache_stats: Boolean(contextGraphCacheStats),
    status_symbol_query_cache_hit_type: typeof symbolQueryGraphCacheStats?.hit,
    status_symbol_declaration_cache_write_type: typeof symbolDeclarationGraphCacheStats?.write,
    status_dependency_query_cache_miss_type: typeof dependencyQueryGraphCacheStats?.miss,
    status_dependency_import_cache_evict_type: typeof dependencyImportGraphCacheStats?.evict,
    status_has_context_engine: Boolean(contextEngine),
    status_context_engine_enabled_type: typeof contextEngine?.enabled,
    status_context_engine_profile_type: typeof contextEngine?.profile,
    status_context_engine_effective_window_type: typeof contextEngine?.effective_window_tokens,
    status_context_engine_threshold_hard_type: typeof contextEngineThresholds?.hard_ratio,
    status_context_engine_recovery_ptl_type: typeof contextEngineRecovery?.ptl_max_retries,
    status_context_engine_lineage_enabled_type: typeof contextEngineLineage?.enabled,
    status_context_engine_workspace_signals_enabled_type: typeof contextEngineWorkspaceSignals?.enabled,
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
    "--history-turns",
    "8",
    "--message",
    longMessage,
  ]);
  const preTrimEvent = result.stderr.match(
    /event=pre_send_head_trim stage=([a-z_]+) retries=(\d+) estimated_tokens=(\d+) effective_window=(\d+)/,
  );
  const promptPrepared = result.stderr.match(
    /event=prompt_prepared[^\n]*pretrim_retries=(\d+)/,
  );
  return {
    ...result,
    pre_send_head_trim_seen: Boolean(preTrimEvent),
    pre_send_head_trim_stage: preTrimEvent?.[1] ?? "",
    pre_send_head_trim_retries: Number.parseInt(preTrimEvent?.[2] ?? "0", 10),
    pre_send_estimated_tokens: Number.parseInt(preTrimEvent?.[3] ?? "0", 10),
    pre_send_effective_window: Number.parseInt(preTrimEvent?.[4] ?? "0", 10),
    prompt_prepared_seen: result.stderr.includes("event=prompt_prepared"),
    prompt_prepared_pretrim_retries: Number.parseInt(promptPrepared?.[1] ?? "0", 10),
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
    case "start-context-pre-send-head-trim-flow":
      payload = runStartContextPreSendHeadTrimFlow(repoRoot);
      break;
    case "status-ts-rust-deprecated-flag":
      payload = runStatusTsRustDeprecatedFlag(repoRoot);
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
