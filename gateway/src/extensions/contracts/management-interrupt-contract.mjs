import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

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

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

async function requestJson(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
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
    let body = {};
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        body = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
      } catch {
        body = {};
      }
    }
    return {
      status: response.status,
      body,
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
    clearTimeout(timer);
  }
}

async function waitStatusReady(baseUrl, timeoutMs = 8_000) {
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
  const terminated = await new Promise((resolveTerminate) => {
    const timer = setTimeout(() => {
      resolveTerminate(false);
    }, 3_000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolveTerminate(true);
    });
  });
  if (terminated) {
    proc.unref();
    return;
  }
  proc.kill("SIGKILL");
  await new Promise((resolveKill) => {
    const timer = setTimeout(() => {
      resolveKill();
    }, 2_000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolveKill();
    });
  });
  proc.unref();
}

async function runInterruptTtlValidation(options) {
  const repoRoot = requireOption(options, "repo-root");
  const workDir = requireOption(options, "work-dir");
  const bind = requireOption(options, "bind");
  const managementToken = requireOption(options, "management-token");
  mkdirSync(workDir, { recursive: true });
  const baseUrl = `http://${bind}`;
  const proc = spawn(
    "./grobot",
    [
      "serve",
      "--project",
      "grobot",
      "--project-root",
      workDir,
      "--work-dir",
      workDir,
      "--gateway-impl",
      "ts",
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
      },
      stdio: "ignore",
    },
  );

  try {
    const statusResult = await waitStatusReady(baseUrl);
    if (statusResult === null) {
      return {
        ready: false,
        exit_code: proc.exitCode,
        signal_code: proc.signalCode,
      };
    }
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${managementToken}`,
    };
    const interruptUrl = `${baseUrl}/api/v1/sessions/${encodeURIComponent("feishu:grobot:dm:ttl-contract")}/interrupt`;
    const validTtl = await requestJson(interruptUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: JSON.stringify({ ttl_secs: 42.9 }),
    });
    const defaultTtl = await requestJson(interruptUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: "{}",
    });
    const invalidZero = await requestJson(interruptUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: JSON.stringify({ ttl_secs: 0 }),
    });
    const invalidString = await requestJson(interruptUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: JSON.stringify({ ttl_secs: "60" }),
    });
    const invalidShape = await requestJson(interruptUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: "[]",
    });
    const invalidJson = await requestJson(interruptUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: "{",
    });
    return {
      ready: true,
      valid_ttl_status: validTtl.status,
      valid_ttl_secs: validTtl.body.ttl_secs ?? null,
      default_ttl_status: defaultTtl.status,
      default_ttl_secs: defaultTtl.body.ttl_secs ?? null,
      invalid_zero_status: invalidZero.status,
      invalid_zero_error: invalidZero.body.error ?? null,
      invalid_string_status: invalidString.status,
      invalid_string_error: invalidString.body.error ?? null,
      invalid_shape_status: invalidShape.status,
      invalid_shape_error: invalidShape.body.error ?? null,
      invalid_json_status: invalidJson.status,
      invalid_json_error: invalidJson.body.error ?? null,
      invalid_json_detail_has_context:
        typeof invalidJson.body.detail === "string"
        && invalidJson.body.detail.includes("Invalid JSON body"),
    };
  } finally {
    await terminateProcess(proc);
  }
}

async function runCli(argv) {
  const { command, options } = parseArgs(argv);
  switch (command) {
    case "interrupt-ttl-validation": {
      const payload = await runInterruptTtlValidation(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

const entryScript = process.argv[1] ?? "";
if (entryScript.includes("management-interrupt-contract.mjs")) {
  runCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`management-interrupt-contract fatal: ${String(error)}\n`);
      process.exitCode = 1;
    });
}
