import assert from "node:assert/strict";
import {
  logStep,
  parseJsonOutput,
  repoRoot,
  runContract,
} from "../harness.mjs";

function runExperienceRuntimeControlContract(command) {
  const result = runContract(
    "experience-runtime-controls-contract.mjs",
    command,
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  return parseJsonOutput(`experience-runtime-controls-contract ${command}`, result.stdout);
}

export function assertExperienceRuntimeControlSmoke() {
  const payload = runExperienceRuntimeControlContract("boundary-controls-reject-flow");
  assert.equal(payload.start_empty_team_exit_code, 2);
  assert.equal(payload.start_empty_team_has_stable_error, true);
  assert.equal(payload.start_missing_team_option_exit_code, 2);
  assert.equal(payload.start_missing_team_option_has_stable_error, true);
  assert.equal(payload.start_empty_team_option_exit_code, 2);
  assert.equal(payload.start_empty_team_option_has_stable_error, true);
  assert.equal(payload.start_empty_pool_path_exit_code, 2);
  assert.equal(payload.start_empty_pool_path_has_stable_error, true);
  assert.equal(payload.start_empty_publish_mode_exit_code, 2);
  assert.equal(payload.start_empty_publish_mode_has_stable_error, true);
  assert.equal(payload.start_empty_recall_limit_exit_code, 2);
  assert.equal(payload.start_empty_recall_limit_has_stable_error, true);
  assert.equal(payload.serve_empty_team_exit_code, 2);
  assert.equal(payload.serve_empty_team_has_stable_error, true);
  assert.equal(payload.serve_empty_pool_path_exit_code, 2);
  assert.equal(payload.serve_empty_pool_path_has_stable_error, true);
  assert.equal(payload.serve_empty_publish_mode_exit_code, 2);
  assert.equal(payload.serve_empty_publish_mode_has_stable_error, true);
  assert.equal(payload.serve_empty_recall_limit_exit_code, 2);
  assert.equal(payload.serve_empty_recall_limit_has_stable_error, true);
  assert.equal(payload.hides_top_level_fatal, true);
  assert.equal(payload.start_banner_not_reached, true);
  assert.equal(payload.serve_ready_not_reached, true);
  logStep("experience-runtime-controls-contract boundary-controls-reject-flow");
}

export function assertExperienceRuntimeStartControlSmoke() {
  const payload = runExperienceRuntimeControlContract("start-boundary-controls-reject-flow");
  assert.equal(payload.start_empty_team_exit_code, 2);
  assert.equal(payload.start_empty_team_has_stable_error, true);
  assert.equal(payload.start_missing_team_option_exit_code, 2);
  assert.equal(payload.start_missing_team_option_has_stable_error, true);
  assert.equal(payload.start_empty_team_option_exit_code, 2);
  assert.equal(payload.start_empty_team_option_has_stable_error, true);
  assert.equal(payload.start_empty_pool_path_exit_code, 2);
  assert.equal(payload.start_empty_pool_path_has_stable_error, true);
  assert.equal(payload.start_empty_publish_mode_exit_code, 2);
  assert.equal(payload.start_empty_publish_mode_has_stable_error, true);
  assert.equal(payload.start_empty_recall_limit_exit_code, 2);
  assert.equal(payload.start_empty_recall_limit_has_stable_error, true);
  assert.equal(payload.hides_top_level_fatal, true);
  assert.equal(payload.start_banner_not_reached, true);
  logStep("experience-runtime-controls-contract start-boundary-controls-reject-flow");
}

export function assertExperienceRuntimeServeControlSmoke() {
  const payload = runExperienceRuntimeControlContract("serve-boundary-controls-reject-flow");
  assert.equal(payload.serve_empty_team_exit_code, 2);
  assert.equal(payload.serve_empty_team_has_stable_error, true);
  assert.equal(payload.serve_empty_pool_path_exit_code, 2);
  assert.equal(payload.serve_empty_pool_path_has_stable_error, true);
  assert.equal(payload.serve_empty_publish_mode_exit_code, 2);
  assert.equal(payload.serve_empty_publish_mode_has_stable_error, true);
  assert.equal(payload.serve_empty_recall_limit_exit_code, 2);
  assert.equal(payload.serve_empty_recall_limit_has_stable_error, true);
  assert.equal(payload.hides_top_level_fatal, true);
  assert.equal(payload.serve_ready_not_reached, true);
  logStep("experience-runtime-controls-contract serve-boundary-controls-reject-flow");
}
