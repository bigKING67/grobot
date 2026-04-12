import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    ["/sessions", "/new", "/sessions", "interactive ts start", "/handoff", "/exit", ""].join("\n"),
  );
  const namespaceKey = "feishu:grobot:dm:smoke-user";
  const registryPath = `${homeDir}/runtime/sessions/${sanitizeSessionKey(namespaceKey)}.sessions.json`;
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
  const activeHistoryPath = `${homeDir}/runtime/sessions/${sanitizeSessionKey(activeSessionKey)}.history.json`;
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

function runStartSessionStoreRedisFallback(repoRoot) {
  const workDir = createTempDir("grobot-start-work");
  const homeDir = createTempDir("grobot-start-home");
  const config = writeConfig(buildSmokeConfig(workDir));
  const sessionKey = "feishu:grobot:dm:redis-fallback-user";
  const historyPath = `${homeDir}/runtime/sessions/${sanitizeSessionKey(sessionKey)}.history.json`;
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

function runStatusTsRust(repoRoot) {
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
  ]);
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
    case "start-interactive-session-flow":
      payload = runStartInteractiveSessionFlow(repoRoot);
      break;
    case "failover-rejects-python":
      payload = runFailoverRejectsPython(repoRoot);
      break;
    case "failover-runs-ts-rust":
      payload = runFailoverTsRust(repoRoot);
      break;
    case "start-session-store-redis-fallback":
      payload = runStartSessionStoreRedisFallback(repoRoot);
      break;
    case "status-ts-rust":
      payload = runStatusTsRust(repoRoot);
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
