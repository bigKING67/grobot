import assert from "node:assert/strict";
import {
  logStep,
  parseJsonOutput,
  repoRoot,
  runContract,
} from "../harness.mjs";

export function assertRuntimeBinControlSmoke() {
  const result = runContract(
    "start-smoke-contract.mjs",
    "runtime-bin-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const payload = parseJsonOutput(
    "start-smoke-contract runtime-bin-reject-flow",
    result.stdout,
  );
  assert.equal(payload.start_empty_runtime_bin_exit_code, 2);
  assert.equal(payload.start_empty_runtime_bin_has_stable_error, true);
  assert.equal(payload.status_json_empty_runtime_bin_exit_code, 2);
  assert.equal(payload.status_json_empty_runtime_bin_error, "invalid_runtime_bin");
  assert.equal(payload.status_json_empty_runtime_bin_field, "runtime-bin");
  assert.equal(payload.status_json_empty_runtime_bin_detail, "runtime-bin must be a non-empty path");
  assert.equal(payload.status_text_empty_runtime_bin_exit_code, 2);
  assert.equal(payload.status_text_empty_runtime_bin_has_stable_error, true);
  assert.equal(payload.hides_top_level_fatal, true);
  assert.equal(payload.has_start_banner, false);
  logStep("start-smoke-contract runtime-bin-reject-flow");
}
