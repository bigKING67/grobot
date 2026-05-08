import assert from "node:assert/strict";
import {
  logStep,
  parseJsonOutput,
  repoRoot,
  runContract,
} from "../harness.mjs";

export function assertRuntimeToolControlSmoke() {
  const result = runContract(
    "start-smoke-contract.mjs",
    "start-invalid-tool-loop-controls-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const payload = parseJsonOutput(
    "start-smoke-contract start-invalid-tool-loop-controls-reject-flow",
    result.stdout,
  );
  assert.equal(payload.invalid_max_tool_rounds_exit_code, 2);
  assert.equal(payload.invalid_max_tool_rounds_has_stable_error, true);
  assert.equal(payload.over_max_tool_rounds_exit_code, 2);
  assert.equal(payload.over_max_tool_rounds_has_stable_error, true);
  assert.equal(payload.invalid_fallback_mode_exit_code, 2);
  assert.equal(payload.invalid_fallback_mode_has_stable_error, true);
  assert.equal(payload.over_recovery_rounds_exit_code, 2);
  assert.equal(payload.over_recovery_rounds_has_stable_error, true);
  assert.equal(payload.negative_recovery_rounds_exit_code, 2);
  assert.equal(payload.negative_recovery_rounds_has_stable_error, true);
  assert.equal(payload.invalid_tools_allow_scalar_exit_code, 2);
  assert.equal(payload.invalid_tools_allow_scalar_has_stable_error, true);
  assert.equal(payload.invalid_tools_allow_mixed_exit_code, 2);
  assert.equal(payload.invalid_tools_allow_mixed_has_stable_error, true);
  assert.equal(payload.invalid_tools_allow_empty_exit_code, 2);
  assert.equal(payload.invalid_tools_allow_empty_has_stable_error, true);
  assert.equal(payload.invalid_tools_allow_empty_entry_exit_code, 2);
  assert.equal(payload.invalid_tools_allow_empty_entry_has_stable_error, true);
  assert.equal(payload.invalid_tools_allow_duplicate_exit_code, 2);
  assert.equal(payload.invalid_tools_allow_duplicate_has_stable_error, true);
  assert.equal(payload.valid_tools_allow_exit_code !== 2, true);
  assert.equal(payload.valid_tools_allow_reached_runtime, true);
  assert.equal(payload.hides_top_level_fatal, true);
  assert.equal(payload.has_start_banner, false);
  logStep("start-smoke-contract start-invalid-tool-loop-controls-reject-flow");
}

export function assertStatusRuntimeToolControlSmoke() {
  const result = runContract(
    "start-smoke-contract.mjs",
    "status-invalid-tools-allow-controls-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const payload = parseJsonOutput(
    "start-smoke-contract status-invalid-tools-allow-controls-reject-flow",
    result.stdout,
  );
  assert.equal(payload.invalid_tools_allow_json_exit_code, 2);
  assert.equal(payload.invalid_tools_allow_json_error, "invalid_runtime_tools_allow");
  assert.equal(payload.invalid_tools_allow_json_field, "runtime-tools-allow");
  assert.equal(
    payload.invalid_tools_allow_json_detail,
    "runtime-tools-allow must be a non-empty array of non-empty strings (source=project_toml)",
  );
  assert.equal(payload.invalid_tools_allow_text_exit_code, 2);
  assert.equal(payload.invalid_tools_allow_text_has_stable_error, true);
  assert.equal(payload.hides_top_level_fatal, true);
  logStep("start-smoke-contract status-invalid-tools-allow-controls-reject-flow");
}
