import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { startMockModelServer } from "./_shared/mock-model-server.mjs";

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

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
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

function runCommandAsync(repoRoot, argv, envPrefix = null, stdinText = null, timeoutMs = 240_000) {
  return new Promise((resolveResult, rejectResult) => {
    const commandLine = argv.map(shellEscape).join(" ");
    const exportPrefix = buildEnvPrefix(envPrefix);
    const shellScript = `cd ${shellEscape(repoRoot)} && ${exportPrefix}${commandLine}`;
    const child = spawn("bash", ["-lc", shellScript], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      resolveResult(payload);
    };

    const timeoutHandle = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        exit_code: 1,
        stdout,
        stderr: stderr.length > 0 ? `${stderr}\ncommand timeout after ${String(timeoutMs)}ms` : `command timeout after ${String(timeoutMs)}ms`,
      });
    }, timeoutMs);

    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    child.on("error", rejectResult);
    child.on("close", (code) => {
      finish({
        exit_code: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });

    if (typeof stdinText === "string" && child.stdin) {
      child.stdin.write(stdinText);
    }
    if (child.stdin) {
      child.stdin.end();
    }
  });
}

function parseJsonOutput(name, stdout) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${name}: stdout is not valid JSON: ${String(error)}\n${stdout}`);
  }
}

function parseFirstJsonLine(name, stdout) {
  const firstLine = String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    throw new Error(`${name}: empty stdout`);
  }
  try {
    return JSON.parse(firstLine);
  } catch (error) {
    throw new Error(`${name}: first non-empty line is not valid JSON: ${String(error)}\n${stdout}`);
  }
}

async function runProviderConfigPassthrough(repoRoot) {
  const providerConfigModel = await startMockModelServer({ content: "CONFIG_PROVIDER_OK" });
  try {
    const runResult = await runCommandAsync(
      repoRoot,
      [
        "node",
        "gateway/src/extensions/contracts/start-smoke-contract.mjs",
        "start-message-provider-config-ts-rust",
        "--repo-root",
        repoRoot,
        "--provider-base-url",
        providerConfigModel.baseUrl,
        "--provider-api-key",
        "provider-config-key",
        "--provider-model",
        "provider-config-model",
      ],
      null,
      null,
      240_000,
    );
    const payload = parseJsonOutput(
      "runtime-smoke-contract provider-config-passthrough",
      runResult.stdout,
    );
    const calls = providerConfigModel.getCalls();
    const lastCall = calls[calls.length - 1] ?? null;
    return {
      ...payload,
      runtime_call_count: calls.length,
      runtime_last_call: lastCall,
    };
  } finally {
    await providerConfigModel.close();
  }
}

async function runToolCallFailFast(repoRoot) {
  const model = await startMockModelServer({ mode: "tool_call" });
  try {
    const runResult = await runCommandAsync(
      repoRoot,
      [
        "node",
        "gateway/src/extensions/contracts/start-smoke-contract.mjs",
        "failover-runs-ts-rust",
        "--repo-root",
        repoRoot,
      ],
      {
        ...process.env,
        GROBOT_BASE_URL: model.baseUrl,
        GROBOT_API_KEY: "mock-runtime-key",
        GROBOT_MODEL: "mock-runtime-model",
        GROBOT_RUNTIME_HTTP_TIMEOUT_MS: "8000",
      },
      null,
      240_000,
    );
    const payload = parseJsonOutput(
      "runtime-smoke-contract tool-call-fail-fast",
      runResult.stdout,
    );
    return {
      ...payload,
      runtime_call_count: model.getCalls().length,
    };
  } finally {
    await model.close();
  }
}

async function runToolCallDiagnosticEvents(repoRoot) {
  const model = await startMockModelServer({ mode: "tool_call" });
  try {
    const runtimeBinaryPath = resolve(repoRoot, "runtime/target/debug/grobot-runtime");
    const requestId = `req_tool_events_${Date.now()}`;
    const requestLine = JSON.stringify({
      jsonrpc: "2.0",
      id: "tool-event-check",
      method: "runtime.turn.execute",
      params: {
        request_id: requestId,
        session_key: "feishu:grobot:dm:tool-events",
        user_message: "tool event contract check",
        context_lines: [],
      },
    });
    const runResult = await runCommandAsync(
      repoRoot,
      [runtimeBinaryPath],
      {
        ...process.env,
        GROBOT_BASE_URL: model.baseUrl,
        GROBOT_API_KEY: "tool-event-key",
        GROBOT_MODEL: "tool-event-model",
        GROBOT_RUNTIME_HTTP_TIMEOUT_MS: "8000",
      },
      `${requestLine}\n`,
      120_000,
    );
    const rpcPayload = parseFirstJsonLine(
      "runtime-smoke-contract tool-call-diagnostic-events",
      runResult.stdout,
    );
    const errorData = isObject(rpcPayload?.error?.data) ? rpcPayload.error.data : {};
    const events = Array.isArray(errorData.events) ? errorData.events : [];
    const eventTypes = events.map((entry) => {
      if (!isObject(entry) || typeof entry.event_type !== "string") {
        return "";
      }
      return entry.event_type;
    });
    return {
      exit_code: runResult.exit_code,
      stderr: runResult.stderr,
      error_code: rpcPayload?.error?.code,
      error_class: errorData.error_class ?? "",
      event_types: eventTypes,
    };
  } finally {
    await model.close();
  }
}

async function runProviderPoolLoadBalance(repoRoot) {
  const providerPoolModel = await startMockModelServer({ content: "POOL_RUNTIME_OK" });
  const providerCount = 10;
  const turnCount = 6;
  try {
    const runResult = await runCommandAsync(
      repoRoot,
      [
        "node",
        "gateway/src/extensions/contracts/start-smoke-contract.mjs",
        "provider-pool-multi-turn-ts-rust",
        "--repo-root",
        repoRoot,
        "--provider-base-url",
        providerPoolModel.baseUrl,
        "--provider-count",
        String(providerCount),
        "--turn-count",
        String(turnCount),
      ],
      null,
      null,
      240_000,
    );
    const payload = parseJsonOutput(
      "runtime-smoke-contract provider-pool-load-balance",
      runResult.stdout,
    );
    const calls = providerPoolModel.getCalls();
    const authorizationCounts = new Map();
    for (const call of calls) {
      const authorization = typeof call.authorization === "string" ? call.authorization : "";
      const key = authorization.length > 0 ? authorization : "<empty>";
      authorizationCounts.set(key, (authorizationCounts.get(key) ?? 0) + 1);
    }
    const sortedAuthorizationCounts = Array.from(authorizationCounts.entries())
      .map(([authorization, count]) => ({ authorization, count }))
      .sort((left, right) => right.count - left.count);
    return {
      ...payload,
      provider_count: providerCount,
      turn_count: turnCount,
      runtime_call_count: calls.length,
      unique_authorization_count: authorizationCounts.size,
      authorization_counts: sortedAuthorizationCounts,
    };
  } finally {
    await providerPoolModel.close();
  }
}

async function runCli(argv) {
  const { command, options } = parseArgs(argv);
  const repoRoot = resolve(requireOption(options, "repo-root"));
  let payload;
    switch (command) {
      case "provider-config-passthrough":
        payload = await runProviderConfigPassthrough(repoRoot);
        break;
      case "provider-pool-load-balance":
        payload = await runProviderPoolLoadBalance(repoRoot);
        break;
      case "tool-call-fail-fast":
        payload = await runToolCallFailFast(repoRoot);
        break;
    case "tool-call-diagnostic-events":
      payload = await runToolCallDiagnosticEvents(repoRoot);
      break;
    default:
      throw new Error(`unknown command: ${command}`);
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  return 0;
}

const entryScript = process.argv[1] ?? "";
const shouldRun = entryScript.includes("runtime-smoke-contract");

if (shouldRun) {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    const message = isObject(error) && typeof error.message === "string" ? error.message : String(error);
    process.stderr.write(`runtime-smoke-contract fatal: ${message}\n`);
    process.exitCode = 1;
  }
}
