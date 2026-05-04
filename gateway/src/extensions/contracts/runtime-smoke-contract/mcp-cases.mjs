import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { startMockModelServer } from "../_shared/mock-model-server.mjs";
import {
  collectMcpToolPayloadsFromModelCalls,
  isObject,
  parseFirstJsonLine,
  parseJsonLines,
  runCommandAsync,
  runRuntimeRpcSequence,
  tomlString,
} from "./helpers.mjs";

function cleanupTempDir(path) {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

export async function runMcpCallSuccess(repoRoot) {
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
    cleanupTempDir(workDir);
    cleanupTempDir(homeDir);
  }
}

export async function runMcpCallTimeout(repoRoot) {
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
    cleanupTempDir(workDir);
    cleanupTempDir(homeDir);
  }
}

export async function runMcpSessionIdleReap(repoRoot) {
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
    cleanupTempDir(workDir);
    cleanupTempDir(homeDir);
  }
}

export async function runMcpServersSuccess(repoRoot) {
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
    cleanupTempDir(workDir);
    cleanupTempDir(homeDir);
  }
}
