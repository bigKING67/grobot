import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

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

async function sleep(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function requestJson(url, init = {}) {
  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => {
    controller.abort();
  }, init.timeoutMs ?? 2_000);
  try {
    const response = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.headers ?? {},
      body: init.body,
      signal: controller.signal,
    });
    const raw = await response.text();
    let parsed = {};
    if (raw.trim()) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = {};
      }
    }
    return {
      status: response.status,
      body: typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {},
    };
  } catch (error) {
    return {
      status: 0,
      body: {
        error: "request_failed",
        detail: String(error),
      },
    };
  } finally {
    clearTimeout(timeoutTimer);
  }
}

async function waitStatusReady(baseUrl, timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const statusResult = await requestJson(`${baseUrl}/api/v1/status`, { timeoutMs: 500 });
    if (statusResult.status === 200) {
      return statusResult;
    }
    await sleep(100);
  }
  return null;
}

async function terminateProcess(proc) {
  if (proc.killed || proc.exitCode !== null) {
    proc.unref();
    return;
  }
  proc.kill("SIGTERM");
  const terminated = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, 3_000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  if (terminated) {
    proc.unref();
    return;
  }
  proc.kill("SIGKILL");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve();
    }, 2_000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  proc.unref();
}

async function runConfigReadPolicyAuto(options) {
  const repoRoot = requireOption(options, "repo-root");
  const workDir = requireOption(options, "work-dir");
  const homeDir = requireOption(options, "home-dir");
  const bind = requireOption(options, "bind");
  const baseUrl = `http://${bind}`;

  const proc = spawn(
    "./grobot",
    [
      "serve",
      "--work-dir",
      workDir,
      "--gateway-impl",
      "ts",
      "--ts-dev-cli",
      "--runtime-impl",
      "rust",
      "--bind",
      bind,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        GROBOT_HOME: homeDir,
      },
      stdio: "ignore",
    }
  );

  try {
    const statusResult = await waitStatusReady(baseUrl, 8_000);
    if (statusResult === null) {
      return {
        ready: false,
        exit_code: proc.exitCode,
        signal_code: proc.signalCode,
      };
    }
    const configResult = await requestJson(`${baseUrl}/api/v1/config`, { timeoutMs: 1_000 });
    return {
      ready: true,
      status_endpoint: statusResult,
      config_endpoint: configResult,
    };
  } finally {
    await terminateProcess(proc);
  }
}

async function runConfigReadPolicyDisabled(options) {
  const repoRoot = requireOption(options, "repo-root");
  const workDir = requireOption(options, "work-dir");
  const bind = requireOption(options, "bind");
  const managementToken = requireOption(options, "management-token");
  const baseUrl = `http://${bind}`;

  const proc = spawn(
    "./grobot",
    [
      "serve",
      "--work-dir",
      workDir,
      "--gateway-impl",
      "ts",
      "--ts-dev-cli",
      "--runtime-impl",
      "rust",
      "--bind",
      bind,
      "--management-token",
      managementToken,
      "--config-read-policy",
      "disabled",
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
      },
      stdio: "ignore",
    }
  );

  try {
    const statusResult = await waitStatusReady(baseUrl, 8_000);
    if (statusResult === null) {
      return {
        ready: false,
        exit_code: proc.exitCode,
        signal_code: proc.signalCode,
      };
    }
    const configResult = await requestJson(`${baseUrl}/api/v1/config`, {
      timeoutMs: 1_000,
      headers: {
        Authorization: `Bearer ${managementToken}`,
      },
    });
    return {
      ready: true,
      status_endpoint: statusResult,
      config_endpoint: configResult,
    };
  } finally {
    await terminateProcess(proc);
  }
}

async function runSessionStoreRedisUnavailable(options) {
  const repoRoot = requireOption(options, "repo-root");
  const workDir = requireOption(options, "work-dir");
  const bind = requireOption(options, "bind");
  const managementToken = requireOption(options, "management-token");
  const redisUrl = requireOption(options, "redis-url");
  const baseUrl = `http://${bind}`;

  const proc = spawn(
    "./grobot",
    [
      "serve",
      "--work-dir",
      workDir,
      "--gateway-impl",
      "ts",
      "--ts-dev-cli",
      "--runtime-impl",
      "rust",
      "--bind",
      bind,
      "--management-token",
      managementToken,
      "--session-store",
      "redis",
      "--redis-url",
      redisUrl,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
      },
      stdio: "ignore",
    }
  );

  try {
    const statusResult = await waitStatusReady(baseUrl, 8_000);
    if (statusResult === null) {
      return {
        ready: false,
        exit_code: proc.exitCode,
        signal_code: proc.signalCode,
      };
    }
    return {
      ready: true,
      status_endpoint: statusResult,
    };
  } finally {
    await terminateProcess(proc);
  }
}

async function runSessionStoreRedisStatusAndMemoryList(options) {
  const repoRoot = requireOption(options, "repo-root");
  const workDir = requireOption(options, "work-dir");
  const bind = requireOption(options, "bind");
  const managementToken = requireOption(options, "management-token");
  const redisUrl = requireOption(options, "redis-url");
  const sessionId = requireOption(options, "session-id");
  const baseUrl = `http://${bind}`;

  const proc = spawn(
    "./grobot",
    [
      "serve",
      "--work-dir",
      workDir,
      "--gateway-impl",
      "ts",
      "--ts-dev-cli",
      "--runtime-impl",
      "rust",
      "--bind",
      bind,
      "--management-token",
      managementToken,
      "--session-store",
      "redis",
      "--redis-url",
      redisUrl,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
      },
      stdio: "ignore",
    }
  );

  try {
    const statusResult = await waitStatusReady(baseUrl, 8_000);
    if (statusResult === null) {
      return {
        ready: false,
        exit_code: proc.exitCode,
        signal_code: proc.signalCode,
      };
    }
    const encodedSessionId = encodeURIComponent(sessionId);
    const memoryListResult = await requestJson(
      `${baseUrl}/api/v1/sessions/${encodedSessionId}/memory?limit=20`,
      {
        timeoutMs: 1_000,
        headers: {
          Authorization: `Bearer ${managementToken}`,
        },
      }
    );
    return {
      ready: true,
      status_endpoint: statusResult,
      memory_list_endpoint: memoryListResult,
    };
  } finally {
    await terminateProcess(proc);
  }
}

async function runMemoryLifecycleRunError(options) {
  const repoRoot = requireOption(options, "repo-root");
  const workDir = requireOption(options, "work-dir");
  const bind = requireOption(options, "bind");
  const managementToken = requireOption(options, "management-token");
  const redisUrl = requireOption(options, "redis-url");
  const sessionId = requireOption(options, "session-id");
  const baseUrl = `http://${bind}`;

  const proc = spawn(
    "./grobot",
    [
      "serve",
      "--work-dir",
      workDir,
      "--gateway-impl",
      "ts",
      "--ts-dev-cli",
      "--runtime-impl",
      "rust",
      "--bind",
      bind,
      "--management-token",
      managementToken,
      "--session-store",
      "redis",
      "--redis-url",
      redisUrl,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
      },
      stdio: "ignore",
    }
  );

  try {
    const statusResult = await waitStatusReady(baseUrl, 8_000);
    if (statusResult === null) {
      return {
        ready: false,
        exit_code: proc.exitCode,
        signal_code: proc.signalCode,
      };
    }
    const lifecycleRunResult = await requestJson(`${baseUrl}/api/v1/memory/lifecycle/run`, {
      method: "POST",
      timeoutMs: 1_000,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${managementToken}`,
      },
      body: JSON.stringify({
        dry_run: false,
        sessions: [sessionId],
      }),
    });
    return {
      ready: true,
      status_endpoint: statusResult,
      lifecycle_run_endpoint: lifecycleRunResult,
    };
  } finally {
    await terminateProcess(proc);
  }
}

async function runReloadMemoryStoreFromProjectToml(options) {
  const repoRoot = requireOption(options, "repo-root");
  const workDir = requireOption(options, "work-dir");
  const bind = requireOption(options, "bind");
  const managementToken = requireOption(options, "management-token");
  const redisUrl = requireOption(options, "redis-url");
  const projectTomlPath = requireOption(options, "project-toml-path");
  const baseUrl = `http://${bind}`;

  const proc = spawn(
    "./grobot",
    [
      "serve",
      "--work-dir",
      workDir,
      "--gateway-impl",
      "ts",
      "--ts-dev-cli",
      "--runtime-impl",
      "rust",
      "--bind",
      bind,
      "--management-token",
      managementToken,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        GROBOT_REDIS_URL: redisUrl,
      },
      stdio: "ignore",
    }
  );

  try {
    const statusBefore = await waitStatusReady(baseUrl, 8_000);
    if (statusBefore === null) {
      return {
        ready: false,
        exit_code: proc.exitCode,
        signal_code: proc.signalCode,
      };
    }

    const currentProjectToml = readFileSync(projectTomlPath, "utf8");
    const runtimeStorageBlock = '\n\n[runtime.storage]\nhot_cache = "redis"\n';
    const nextProjectToml = currentProjectToml.includes("[runtime.storage]")
      ? currentProjectToml
      : `${currentProjectToml.trimEnd()}${runtimeStorageBlock}`;
    writeFileSync(projectTomlPath, nextProjectToml, "utf8");

    const reloadResult = await requestJson(`${baseUrl}/api/v1/reload`, {
      method: "POST",
      timeoutMs: 1_000,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${managementToken}`,
      },
      body: "{}",
    });
    const statusAfter = await requestJson(`${baseUrl}/api/v1/status`, { timeoutMs: 1_000 });
    return {
      ready: true,
      status_before: statusBefore,
      reload_endpoint: reloadResult,
      status_after: statusAfter,
    };
  } finally {
    await terminateProcess(proc);
  }
}

async function runCli(argv) {
  const { command, options } = parseArgs(argv);
  switch (command) {
    case "config-read-policy-auto": {
      const payload = await runConfigReadPolicyAuto(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    case "config-read-policy-disabled": {
      const payload = await runConfigReadPolicyDisabled(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    case "session-store-redis-unavailable": {
      const payload = await runSessionStoreRedisUnavailable(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    case "session-store-redis-status-and-memory-list": {
      const payload = await runSessionStoreRedisStatusAndMemoryList(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    case "memory-lifecycle-run-error": {
      const payload = await runMemoryLifecycleRunError(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    case "reload-memory-store-from-project-toml": {
      const payload = await runReloadMemoryStoreFromProjectToml(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

const entryScript = process.argv[1] ?? "";
const shouldRun = entryScript.includes("serve-smoke-contract.mjs");

if (shouldRun) {
  runCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`serve-smoke-contract fatal: ${String(error)}\n`);
      process.exitCode = 1;
    });
}
