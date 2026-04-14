import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

function tomlString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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

function runRuntimeRpcSequence(repoRoot, envPrefix, requests, timeoutMs = 180_000) {
  return new Promise((resolveResult, rejectResult) => {
    const runtimeBinaryPath = resolve(repoRoot, "runtime/target/debug/grobot-runtime");
    const child = spawn(runtimeBinaryPath, {
      cwd: repoRoot,
      env: envPrefix ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let requestIndex = 0;
    let timeoutHandle = null;

    const finish = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
      resolveResult(payload);
    };

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
      rejectResult(error);
    };

    const pushNextRequest = () => {
      if (requestIndex >= requests.length) {
        if (child.stdin) {
          child.stdin.end();
        }
        return;
      }
      const request = requests[requestIndex] ?? {};
      requestIndex += 1;
      const line = typeof request.line === "string" ? request.line : "";
      const delayMsRaw = request.delay_ms;
      const delayMs = Number.isFinite(delayMsRaw) && delayMsRaw > 0 ? delayMsRaw : 0;
      if (child.stdin && line.length > 0) {
        child.stdin.write(`${line}\n`);
      }
      if (delayMs > 0) {
        setTimeout(pushNextRequest, delayMs);
        return;
      }
      pushNextRequest();
    };

    timeoutHandle = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        exit_code: 1,
        stdout,
        stderr: stderr.length > 0
          ? `${stderr}\ncommand timeout after ${String(timeoutMs)}ms`
          : `command timeout after ${String(timeoutMs)}ms`,
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

    child.on("error", fail);
    child.on("close", (code) => {
      finish({
        exit_code: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });

    pushNextRequest();
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

function parseJsonLines(name, stdout) {
  const lines = String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new Error(`${name}: empty stdout`);
  }
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${name}: line ${String(index + 1)} is not valid JSON: ${String(error)}\n${line}`);
    }
  });
}

function collectMcpToolPayloadsFromModelCalls(calls) {
  const payloads = [];
  for (const call of calls) {
    if (typeof call?.bodyText !== "string") {
      continue;
    }
    let body = null;
    try {
      body = JSON.parse(call.bodyText);
    } catch {
      continue;
    }
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    for (const message of messages) {
      if (message?.role !== "tool" || message?.name !== "mcp_call" || typeof message?.content !== "string") {
        continue;
      }
      try {
        payloads.push(JSON.parse(message.content));
      } catch {
        // ignore malformed tool payload in smoke contract
      }
    }
  }
  return payloads;
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

async function runToolCallSuccess(repoRoot) {
  const model = await startMockModelServer({ mode: "tool_loop_success" });
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
      "runtime-smoke-contract tool-call-success",
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

async function runMcpCallSuccess(repoRoot) {
  const model = await startMockModelServer({ mode: "tool_loop_mcp_call_success" });
  const workDir = mkdtempSync(resolve(tmpdir(), "grobot-mcp-work-"));
  const homeDir = mkdtempSync(resolve(tmpdir(), "grobot-mcp-home-"));
  try {
    const grobotDir = resolve(workDir, ".grobot");
    mkdirSync(grobotDir, { recursive: true });
    const mockMcpServerPath = resolve(
      repoRoot,
      "gateway/src/extensions/contracts/_shared/mock-mcp-server.mjs",
    );
    const mcpTomlPath = resolve(grobotDir, "mcp.toml");
    writeFileSync(
      mcpTomlPath,
      [
        "[[servers]]",
        'name = "mock"',
        'command = "node"',
        `args = [${tomlString(mockMcpServerPath)}]`,
        "enabled = true",
        "",
      ].join("\n"),
      "utf8",
    );
    const runtimeBinaryPath = resolve(repoRoot, "runtime/target/debug/grobot-runtime");
    const requestId = `req_mcp_call_${Date.now()}`;
    const requestLine = JSON.stringify({
      jsonrpc: "2.0",
      id: "mcp-call-success-check",
      method: "runtime.turn.execute",
      params: {
        request_id: requestId,
        session_key: "feishu:grobot:dm:mcp-success",
        user_message: "mcp call contract check",
        context_lines: [],
        tool_context: {
          work_dir: workDir,
          enabled_tools: ["mcp_call"],
          max_tool_rounds: 4,
        },
      },
    });
    const runResult = await runCommandAsync(
      repoRoot,
      [runtimeBinaryPath],
      {
        ...process.env,
        HOME: homeDir,
        GROBOT_BASE_URL: model.baseUrl,
        GROBOT_API_KEY: "mcp-call-key",
        GROBOT_MODEL: "mcp-call-model",
        GROBOT_RUNTIME_HTTP_TIMEOUT_MS: "8000",
      },
      `${requestLine}\n`,
      120_000,
    );
    const rpcPayload = parseFirstJsonLine(
      "runtime-smoke-contract mcp-call-success",
      runResult.stdout,
    );
    const calls = model.getCalls();
    const lastCall = calls[calls.length - 1] ?? null;
    const errorData = isObject(rpcPayload?.error?.data) ? rpcPayload.error.data : {};
    return {
      exit_code: runResult.exit_code,
      stderr: runResult.stderr,
      runtime_call_count: calls.length,
      assistant_message: rpcPayload?.result?.assistant_message ?? "",
      runtime_last_body: typeof lastCall?.bodyText === "string" ? lastCall.bodyText : "",
      error_code: rpcPayload?.error?.code ?? null,
      error_class: errorData.error_class ?? "",
    };
  } finally {
    await model.close();
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    try {
      rmSync(homeDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

async function runMcpCallTimeout(repoRoot) {
  const model = await startMockModelServer({ mode: "tool_loop_mcp_call_success" });
  const workDir = mkdtempSync(resolve(tmpdir(), "grobot-mcp-timeout-work-"));
  const homeDir = mkdtempSync(resolve(tmpdir(), "grobot-mcp-timeout-home-"));
  try {
    const grobotDir = resolve(workDir, ".grobot");
    mkdirSync(grobotDir, { recursive: true });
    const mockMcpServerPath = resolve(
      repoRoot,
      "gateway/src/extensions/contracts/_shared/mock-mcp-server.mjs",
    );
    const mcpTomlPath = resolve(grobotDir, "mcp.toml");
    const projectTomlPath = resolve(grobotDir, "project.toml");
    writeFileSync(
      mcpTomlPath,
      [
        "[[servers]]",
        'name = "mock"',
        'command = "node"',
        `args = [${tomlString(mockMcpServerPath)}, "--tool-call-delay-ms", "260"]`,
        "enabled = true",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      projectTomlPath,
      [
        "[tools.mcp]",
        "call_timeout_ms = 120",
      ].join("\n"),
      "utf8",
    );
    const runtimeBinaryPath = resolve(repoRoot, "runtime/target/debug/grobot-runtime");
    const requestId = `req_mcp_timeout_${Date.now()}`;
    const requestLine = JSON.stringify({
      jsonrpc: "2.0",
      id: "mcp-call-timeout-check",
      method: "runtime.turn.execute",
      params: {
        request_id: requestId,
        session_key: "feishu:grobot:dm:mcp-timeout",
        user_message: "mcp timeout contract check",
        context_lines: [],
        tool_context: {
          work_dir: workDir,
          enabled_tools: ["mcp_call"],
          max_tool_rounds: 4,
        },
      },
    });
    const runResult = await runCommandAsync(
      repoRoot,
      [runtimeBinaryPath],
      {
        ...process.env,
        HOME: homeDir,
        GROBOT_BASE_URL: model.baseUrl,
        GROBOT_API_KEY: "mcp-timeout-key",
        GROBOT_MODEL: "mcp-timeout-model",
        GROBOT_RUNTIME_HTTP_TIMEOUT_MS: "8000",
      },
      `${requestLine}\n`,
      120_000,
    );
    const rpcPayload = parseFirstJsonLine(
      "runtime-smoke-contract mcp-call-timeout",
      runResult.stdout,
    );
    const errorData = isObject(rpcPayload?.error?.data) ? rpcPayload.error.data : {};
    return {
      exit_code: runResult.exit_code,
      stderr: runResult.stderr,
      runtime_call_count: model.getCalls().length,
      assistant_message: rpcPayload?.result?.assistant_message ?? "",
      error_code: rpcPayload?.error?.code ?? null,
      error_class: errorData.error_class ?? "",
    };
  } finally {
    await model.close();
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    try {
      rmSync(homeDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

async function runMcpSessionIdleReap(repoRoot) {
  const model = await startMockModelServer({ mode: "tool_loop_mcp_call_success" });
  const workDir = mkdtempSync(resolve(tmpdir(), "grobot-mcp-idle-work-"));
  const homeDir = mkdtempSync(resolve(tmpdir(), "grobot-mcp-idle-home-"));
  try {
    const grobotDir = resolve(workDir, ".grobot");
    mkdirSync(grobotDir, { recursive: true });
    const mockMcpServerPath = resolve(
      repoRoot,
      "gateway/src/extensions/contracts/_shared/mock-mcp-server.mjs",
    );
    const mcpTomlPath = resolve(grobotDir, "mcp.toml");
    const projectTomlPath = resolve(grobotDir, "project.toml");
    writeFileSync(
      mcpTomlPath,
      [
        "[[servers]]",
        'name = "mock"',
        'command = "node"',
        `args = [${tomlString(mockMcpServerPath)}]`,
        "enabled = true",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      projectTomlPath,
      [
        "[tools.mcp]",
        "call_timeout_ms = 4000",
        "session_idle_ttl_secs = 10",
      ].join("\n"),
      "utf8",
    );
    const sessionKey = `feishu:grobot:dm:mcp-idle-${Date.now()}`;
    const requestOne = JSON.stringify({
      jsonrpc: "2.0",
      id: "mcp-session-idle-reap-check-1",
      method: "runtime.turn.execute",
      params: {
        request_id: `req_mcp_idle_1_${Date.now()}`,
        session_key: sessionKey,
        user_message: "mcp idle reap contract check #1",
        context_lines: [],
        tool_context: {
          work_dir: workDir,
          enabled_tools: ["mcp_call"],
          max_tool_rounds: 4,
        },
      },
    });
    const requestTwo = JSON.stringify({
      jsonrpc: "2.0",
      id: "mcp-session-idle-reap-check-2",
      method: "runtime.turn.execute",
      params: {
        request_id: `req_mcp_idle_2_${Date.now()}`,
        session_key: sessionKey,
        user_message: "mcp idle reap contract check #2",
        context_lines: [],
        tool_context: {
          work_dir: workDir,
          enabled_tools: ["mcp_call"],
          max_tool_rounds: 4,
        },
      },
    });
    const runResult = await runRuntimeRpcSequence(
      repoRoot,
      {
        ...process.env,
        HOME: homeDir,
        GROBOT_BASE_URL: model.baseUrl,
        GROBOT_API_KEY: "mcp-idle-key",
        GROBOT_MODEL: "mcp-idle-model",
        GROBOT_RUNTIME_HTTP_TIMEOUT_MS: "8000",
      },
      [
        { line: requestOne, delay_ms: 10_500 },
        { line: requestTwo },
      ],
      120_000,
    );
    const rpcPayloads = parseJsonLines(
      "runtime-smoke-contract mcp-session-idle-reap",
      runResult.stdout,
    );
    const firstRpc = rpcPayloads[0] ?? {};
    const secondRpc = rpcPayloads[1] ?? {};
    const mcpPayloads = collectMcpToolPayloadsFromModelCalls(model.getCalls());
    const firstMcp = mcpPayloads[0] ?? {};
    const secondMcp = mcpPayloads[1] ?? {};
    return {
      exit_code: runResult.exit_code,
      stderr: runResult.stderr,
      runtime_call_count: model.getCalls().length,
      rpc_count: rpcPayloads.length,
      first_error_code: firstRpc?.error?.code ?? null,
      second_error_code: secondRpc?.error?.code ?? null,
      tool_payload_count: mcpPayloads.length,
      first_session_reused: Boolean(firstMcp?.session_reused),
      second_session_reused: Boolean(secondMcp?.session_reused),
      first_session_pid: Number.isFinite(firstMcp?.session_pid) ? firstMcp.session_pid : null,
      second_session_pid: Number.isFinite(secondMcp?.session_pid) ? secondMcp.session_pid : null,
    };
  } finally {
    await model.close();
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    try {
      rmSync(homeDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

async function runMcpServersSuccess(repoRoot) {
  const model = await startMockModelServer({ mode: "tool_loop_mcp_servers_success" });
  const workDir = mkdtempSync(resolve(tmpdir(), "grobot-mcp-servers-work-"));
  const homeDir = mkdtempSync(resolve(tmpdir(), "grobot-mcp-servers-home-"));
  try {
    const grobotDir = resolve(workDir, ".grobot");
    mkdirSync(grobotDir, { recursive: true });
    const mcpTomlPath = resolve(grobotDir, "mcp.toml");
    writeFileSync(
      mcpTomlPath,
      [
        "[[servers]]",
        'name = "mock-ready"',
        'command = "node"',
        'args = ["--version"]',
        "enabled = true",
        "",
      ].join("\n"),
      "utf8",
    );
    const runtimeBinaryPath = resolve(repoRoot, "runtime/target/debug/grobot-runtime");
    const requestId = `req_mcp_servers_${Date.now()}`;
    const requestLine = JSON.stringify({
      jsonrpc: "2.0",
      id: "mcp-servers-success-check",
      method: "runtime.turn.execute",
      params: {
        request_id: requestId,
        session_key: "feishu:grobot:dm:mcp-servers",
        user_message: "mcp servers contract check",
        context_lines: [],
        tool_context: {
          work_dir: workDir,
          enabled_tools: ["mcp_servers"],
          max_tool_rounds: 4,
        },
      },
    });
    const runResult = await runCommandAsync(
      repoRoot,
      [runtimeBinaryPath],
      {
        ...process.env,
        HOME: homeDir,
        GROBOT_BASE_URL: model.baseUrl,
        GROBOT_API_KEY: "mcp-servers-key",
        GROBOT_MODEL: "mcp-servers-model",
        GROBOT_RUNTIME_HTTP_TIMEOUT_MS: "8000",
      },
      `${requestLine}\n`,
      120_000,
    );
    const rpcPayload = parseFirstJsonLine(
      "runtime-smoke-contract mcp-servers-success",
      runResult.stdout,
    );
    const calls = model.getCalls();
    const lastCall = calls[calls.length - 1] ?? null;
    const errorData = isObject(rpcPayload?.error?.data) ? rpcPayload.error.data : {};
    return {
      exit_code: runResult.exit_code,
      stderr: runResult.stderr,
      runtime_call_count: calls.length,
      assistant_message: rpcPayload?.result?.assistant_message ?? "",
      runtime_last_body: typeof lastCall?.bodyText === "string" ? lastCall.bodyText : "",
      error_code: rpcPayload?.error?.code ?? null,
      error_class: errorData.error_class ?? "",
    };
  } finally {
    await model.close();
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    try {
      rmSync(homeDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
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
    case "tool-call-success":
      payload = await runToolCallSuccess(repoRoot);
      break;
    case "tool-call-diagnostic-events":
      payload = await runToolCallDiagnosticEvents(repoRoot);
      break;
    case "mcp-call-success":
      payload = await runMcpCallSuccess(repoRoot);
      break;
    case "mcp-call-timeout":
      payload = await runMcpCallTimeout(repoRoot);
      break;
    case "mcp-session-idle-reap":
      payload = await runMcpSessionIdleReap(repoRoot);
      break;
    case "mcp-servers-success":
      payload = await runMcpServersSuccess(repoRoot);
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
