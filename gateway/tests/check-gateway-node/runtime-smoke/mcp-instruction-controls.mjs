import assert from "node:assert/strict";
import {
  logStep,
  parseJsonOutput,
  repoRoot,
  runContract,
} from "../harness.mjs";

export function assertMcpInstructionControlSmoke() {
  const payload = runMcpInstructionControlContract("start-invalid-mcp-instruction-controls-reject-flow");
  assertMcpInstructionBasicPayload(payload);
  assertMcpInstructionScopePayload(payload);
  assertMcpInstructionServerPayload(payload);
  assertMcpInstructionValidDisabledBoundaryPayload(payload);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-invalid-mcp-instruction-controls-reject-flow");
}

function runMcpInstructionControlContract(command) {
  const result = runContract(
    "start-smoke-contract.mjs",
    command,
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  return parseJsonOutput(`start-smoke-contract ${command}`, result.stdout);
}

function assertNoFatalNoBanner(payload) {
  assert.equal(payload.hides_top_level_fatal, true);
  assert.equal(payload.has_start_banner, false);
}

function assertMcpInstructionBasicPayload(payload) {
  assert.equal(payload.invalid_enabled_exit_code, 2);
  assert.equal(payload.invalid_enabled_has_stable_error, true);
  assert.equal(payload.invalid_strict_exit_code, 2);
  assert.equal(payload.invalid_strict_has_stable_error, true);
}

function assertMcpInstructionScopePayload(payload) {
  assert.equal(payload.invalid_scope_exit_code, 2);
  assert.equal(payload.invalid_scope_has_stable_error, true);
  assert.equal(payload.invalid_scope_syntax_exit_code, 2);
  assert.equal(payload.invalid_scope_syntax_has_stable_error, true);
}

function assertMcpInstructionServerPayload(payload) {
  assert.equal(payload.invalid_server_name_exit_code, 2);
  assert.equal(payload.invalid_server_name_has_stable_error, true);
  assert.equal(payload.invalid_server_enabled_exit_code, 2);
  assert.equal(payload.invalid_server_enabled_has_stable_error, true);
}

function assertMcpInstructionValidDisabledBoundaryPayload(payload) {
  assert.equal(payload.valid_disabled_boundary_exit_code !== 2, true);
  assert.equal(payload.valid_disabled_boundary_reached_runtime, true);
}

export function assertMcpInstructionBasicControlSmoke() {
  const payload = runMcpInstructionControlContract("start-invalid-mcp-instruction-basic-controls-reject-flow");
  assertMcpInstructionBasicPayload(payload);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-invalid-mcp-instruction-basic-controls-reject-flow");
}

export function assertMcpInstructionScopeControlSmoke() {
  const payload = runMcpInstructionControlContract("start-invalid-mcp-instruction-scope-controls-reject-flow");
  assertMcpInstructionScopePayload(payload);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-invalid-mcp-instruction-scope-controls-reject-flow");
}

export function assertMcpInstructionServerControlSmoke() {
  const payload = runMcpInstructionControlContract("start-invalid-mcp-instruction-server-controls-reject-flow");
  assertMcpInstructionServerPayload(payload);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-invalid-mcp-instruction-server-controls-reject-flow");
}

export function assertMcpInstructionValidDisabledBoundarySmoke() {
  const payload = runMcpInstructionControlContract("start-mcp-instruction-valid-disabled-boundary-flow");
  assertMcpInstructionValidDisabledBoundaryPayload(payload);
  logStep("start-smoke-contract start-mcp-instruction-valid-disabled-boundary-flow");
}
