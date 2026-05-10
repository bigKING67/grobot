import assert from "node:assert/strict";
import {
  logStep,
  parseJsonOutput,
  repoRoot,
  runContract,
} from "../harness.mjs";

export function assertToolSurfaceProfileControlSmoke() {
  const result = runContract(
    "start-smoke-contract.mjs",
    "start-invalid-tool-surface-profile-controls-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const payload = parseJsonOutput(
    "start-smoke-contract start-invalid-tool-surface-profile-controls-reject-flow",
    result.stdout,
  );
  assert.equal(payload.start_invalid_profile_exit_code, 2);
  assert.equal(payload.start_invalid_profile_has_stable_error, true);
  assert.equal(payload.start_empty_profile_exit_code, 2);
  assert.equal(payload.start_empty_profile_has_stable_error, true);
  assert.equal(payload.status_json_invalid_profile_exit_code, 2);
  assert.equal(payload.status_json_invalid_profile_error, "invalid_tool_surface_profile");
  assert.equal(payload.status_json_invalid_profile_field, "tool-surface-profile");
  assert.equal(
    String(payload.status_json_invalid_profile_detail).includes("tool-surface-profile must be one of:"),
    true,
  );
  assert.equal(payload.status_text_empty_profile_exit_code, 2);
  assert.equal(payload.status_text_empty_profile_has_stable_error, true);
  assert.equal(payload.hides_top_level_fatal, true);
  assert.equal(payload.has_start_banner, false);
  logStep("start-smoke-contract start-invalid-tool-surface-profile-controls-reject-flow");
}
