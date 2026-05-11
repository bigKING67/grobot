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

function assertMcpInstructionValidatorContract() {
  const result = runContract("mcp-instruction-config-validator-contract.mjs", "", [], { timeoutMs: 120_000 });
  assert.equal(result.code, 0, `mcp instruction validator contract failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const payload = parseJsonOutput("mcp-instruction-config-validator-contract", result.stdout);
  assert.equal(payload.status, "ok");
  assert.equal(payload.rejected_count, 6);
  assert.equal(Number(payload.unique_error_count) >= 5, true);
  assert.equal(payload.valid_disabled_boundary, true);
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
  assertMcpInstructionValidatorContract();
  logStep("mcp-instruction-config-validator-contract basic-controls");
}

export function assertMcpInstructionScopeControlSmoke() {
  assertMcpInstructionValidatorContract();
  logStep("mcp-instruction-config-validator-contract scope-controls");
}

export function assertMcpInstructionServerControlSmoke() {
  assertMcpInstructionValidatorContract();
  logStep("mcp-instruction-config-validator-contract server-controls");
}

export function assertMcpInstructionValidatorSmoke() {
  assertMcpInstructionValidatorContract();
  logStep("mcp-instruction-config-validator-contract batch-controls");
}

export function assertMcpInstructionValidDisabledBoundarySmoke() {
  const payload = runMcpInstructionControlContract("start-mcp-instruction-valid-disabled-boundary-flow");
  assertMcpInstructionValidDisabledBoundaryPayload(payload);
  logStep("start-smoke-contract start-mcp-instruction-valid-disabled-boundary-flow");
}
