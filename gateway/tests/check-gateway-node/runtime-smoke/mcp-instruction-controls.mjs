import assert from "node:assert/strict";
import {
  logStep,
  parseJsonOutput,
  repoRoot,
  runContract,
} from "../harness.mjs";

export function assertMcpInstructionControlSmoke() {
  const result = runContract(
    "start-smoke-contract.mjs",
    "start-invalid-mcp-instruction-controls-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const payload = parseJsonOutput(
    "start-smoke-contract start-invalid-mcp-instruction-controls-reject-flow",
    result.stdout,
  );
  assert.equal(payload.invalid_enabled_exit_code, 2);
  assert.equal(payload.invalid_enabled_has_stable_error, true);
  assert.equal(payload.invalid_strict_exit_code, 2);
  assert.equal(payload.invalid_strict_has_stable_error, true);
  assert.equal(payload.invalid_scope_exit_code, 2);
  assert.equal(payload.invalid_scope_has_stable_error, true);
  assert.equal(payload.invalid_scope_syntax_exit_code, 2);
  assert.equal(payload.invalid_scope_syntax_has_stable_error, true);
  assert.equal(payload.invalid_server_name_exit_code, 2);
  assert.equal(payload.invalid_server_name_has_stable_error, true);
  assert.equal(payload.invalid_server_enabled_exit_code, 2);
  assert.equal(payload.invalid_server_enabled_has_stable_error, true);
  assert.equal(payload.valid_disabled_boundary_exit_code !== 2, true);
  assert.equal(payload.valid_disabled_boundary_reached_runtime, true);
  assert.equal(payload.hides_top_level_fatal, true);
  assert.equal(payload.has_start_banner, false);
  logStep("start-smoke-contract start-invalid-mcp-instruction-controls-reject-flow");
}
