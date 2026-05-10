import assert from "node:assert/strict";
import {
  logStep,
  parseJsonOutput,
  repoRoot,
  runContract,
} from "../harness.mjs";

export function runRuntimeToolLoopSmoke() {
  const failureResult = runContract(
    "runtime-smoke-contract.mjs",
    "tool-call-fail-fast",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const failure = parseJsonOutput("runtime-smoke-contract tool-call-fail-fast", failureResult.stdout);
  assert.equal(failure.exit_code !== 0, true);
  assert.equal(String(failure.stderr).includes("Turn failed"), true);
  assert.equal(String(failure.stderr).includes("Tool not visible"), true);
  assert.equal(String(failure.stderr).includes("tool_not_visible"), false);
  assert.equal(Number(failure.runtime_call_count) >= 1, true);
  logStep("runtime-smoke-contract tool-call-fail-fast");

  const successResult = runContract(
    "runtime-smoke-contract.mjs",
    "tool-call-success",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const success = parseJsonOutput("runtime-smoke-contract tool-call-success", successResult.stdout);
  assert.equal(success.exit_code, 0);
  assert.equal(String(success.stdout).includes("TOOL_LOOP_RUNTIME_OK"), true);
  assert.equal(Number(success.runtime_call_count) >= 2, true);
  logStep("runtime-smoke-contract tool-call-success");
}

export function runRuntimeMcpCallSmoke() {
  const successResult = runContract(
    "runtime-smoke-contract.mjs",
    "mcp-call-success",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const success = parseJsonOutput("runtime-smoke-contract mcp-call-success", successResult.stdout);
  assert.equal(success.exit_code, 0);
  assert.equal(String(success.assistant_message).includes("MCP_CALL_RUNTIME_OK"), true);
  assert.equal(Number(success.runtime_call_count) >= 2, true);
  assert.equal(String(success.runtime_last_body).includes("echo:hello-mcp"), true);
  logStep("runtime-smoke-contract mcp-call-success");

  const timeoutResult = runContract(
    "runtime-smoke-contract.mjs",
    "mcp-call-timeout",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const timeout = parseJsonOutput("runtime-smoke-contract mcp-call-timeout", timeoutResult.stdout);
  assert.equal(timeout.exit_code, 0);
  assert.equal(timeout.error_code, -32001);
  assert.equal(timeout.error_class, "mcp_timeout");
  assert.equal(Number(timeout.runtime_call_count) >= 1, true);
  logStep("runtime-smoke-contract mcp-call-timeout");
}

export function runRuntimeMcpSessionSmoke() {
  const result = runContract(
    "runtime-smoke-contract.mjs",
    "mcp-session-idle-reap",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const payload = parseJsonOutput("runtime-smoke-contract mcp-session-idle-reap", result.stdout);
  assert.equal(payload.exit_code, 0);
  assert.equal(Number(payload.rpc_count), 2);
  assert.equal(Number(payload.tool_payload_count), 2);
  assert.equal(payload.first_error_code, null);
  assert.equal(payload.second_error_code, null);
  assert.equal(payload.first_session_reused, false);
  assert.equal(payload.second_session_reused, false);
  assert.equal(Number(payload.first_session_pid) > 0 && Number(payload.second_session_pid) > 0, true);
  assert.equal(Number(payload.first_session_pid) !== Number(payload.second_session_pid), true);
  logStep("runtime-smoke-contract mcp-session-idle-reap");
}

export function runRuntimeMcpServerSmoke() {
  const result = runContract(
    "runtime-smoke-contract.mjs",
    "mcp-servers-success",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const payload = parseJsonOutput("runtime-smoke-contract mcp-servers-success", result.stdout);
  assert.equal(payload.exit_code, 0);
  assert.equal(String(payload.assistant_message).includes("MCP_SERVERS_RUNTIME_OK"), true);
  assert.equal(Number(payload.runtime_call_count) >= 2, true);
  assert.equal(String(payload.runtime_last_body).includes("\\\"ready_count\\\":1"), true);
  logStep("runtime-smoke-contract mcp-servers-success");
}

export function runRuntimeToolDiagnosticSmoke() {
  const result = runContract(
    "runtime-smoke-contract.mjs",
    "tool-call-diagnostic-events",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const payload = parseJsonOutput("runtime-smoke-contract tool-call-diagnostic-events", result.stdout);
  assert.equal(payload.exit_code, 0);
  assert.equal(payload.error_code, -32001);
  assert.equal(payload.error_class, "tool_call_not_supported");
  assert.equal(Array.isArray(payload.event_types), true);
  assert.equal(payload.event_types.includes("tool_start"), true);
  assert.equal(payload.event_types.includes("tool_end"), true);
  assert.equal(payload.event_types.includes("turn_failed"), true);
  logStep("runtime-smoke-contract tool-call-diagnostic-events");
}

export function runRuntimeToolMcpSmoke() {
  runRuntimeToolLoopSmoke();
  runRuntimeMcpCallSmoke();
  runRuntimeMcpSessionSmoke();
  runRuntimeMcpServerSmoke();
  runRuntimeToolDiagnosticSmoke();
}
