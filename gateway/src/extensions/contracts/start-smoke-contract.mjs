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
  const contextGraphCacheWindowDegradation = isObject(contextGraphCacheWindow?.degradation)
    ? contextGraphCacheWindow.degradation
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
    status_has_context_graph_cache_window: Boolean(contextGraphCacheWindow),
    status_context_graph_cache_window_path_type: typeof contextGraphCacheWindow?.path,
    status_context_graph_cache_window_configured_size_type: typeof contextGraphCacheWindow?.configured_size,
    status_context_graph_cache_window_configured_size_value:
      typeof contextGraphCacheWindow?.configured_size === "number"
        ? contextGraphCacheWindow.configured_size
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
    status_context_engine_workspace_signals_enabled_type: typeof contextEngineWorkspaceSignals?.enabled,
    status_context_engine_has_prompt_quality_window: Boolean(promptQualityWindow),
    status_context_engine_prompt_quality_window_path_type: typeof promptQualityWindow?.path,
    status_context_engine_prompt_quality_window_configured_size_type: typeof promptQualityWindow?.configured_size,
    status_context_engine_prompt_quality_window_entries_type: typeof promptQualityWindow?.entries,
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
    case "status-ts-rust-window-size": {
      const parsedWindowSize = Number.parseInt(options.get("window-size") ?? "7", 10);
      const normalizedWindowSize =
        Number.isFinite(parsedWindowSize) && parsedWindowSize > 0 ? parsedWindowSize : 7;
      payload = runStatusTsRust(repoRoot, normalizedWindowSize);
      break;
    }
    case "start-context-pre-send-head-trim-flow":
      payload = runStartContextPreSendHeadTrimFlow(repoRoot);
      break;
    case "start-context-quality-guard-flow":
      payload = runStartContextQualityGuardFlow(repoRoot);
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
