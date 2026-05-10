import assert from "node:assert/strict";
import {
  logStep,
  parseJsonOutput,
  repoRoot,
  runContract,
} from "../harness.mjs";

function runExperienceSchedulerControlContract(command) {
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

export function assertExperienceSchedulerControlSmoke() {
  const payload = runExperienceSchedulerControlContract("start-invalid-experience-scheduler-controls-reject-flow");
  assert.equal(payload.invalid_env_boolean_exit_code, 2);
  assert.equal(payload.invalid_env_boolean_has_stable_error, true);
  assert.equal(payload.invalid_env_interval_syntax_exit_code, 2);
  assert.equal(payload.invalid_env_interval_syntax_has_stable_error, true);
  assert.equal(payload.invalid_env_interval_range_exit_code, 2);
  assert.equal(payload.invalid_env_interval_range_has_stable_error, true);
  assert.equal(payload.invalid_env_tasks_dir_exit_code, 2);
  assert.equal(payload.invalid_env_tasks_dir_has_stable_error, true);
  assert.equal(payload.invalid_env_default_delay_exit_code, 2);
  assert.equal(payload.invalid_env_default_delay_has_stable_error, true);
  assert.equal(payload.invalid_toml_boolean_exit_code, 2);
  assert.equal(payload.invalid_toml_boolean_has_stable_error, true);
  assert.equal(payload.invalid_toml_interval_exit_code, 2);
  assert.equal(payload.invalid_toml_interval_has_stable_error, true);
  assert.equal(payload.invalid_toml_interval_secs_exit_code, 2);
  assert.equal(payload.invalid_toml_interval_secs_has_stable_error, true);
  assert.equal(payload.invalid_toml_path_exit_code, 2);
  assert.equal(payload.invalid_toml_path_has_stable_error, true);
  assert.equal(payload.invalid_toml_default_delay_exit_code, 2);
  assert.equal(payload.invalid_toml_default_delay_has_stable_error, true);
  assert.equal(payload.valid_boundary_exit_code !== 2, true);
  assert.equal(payload.valid_boundary_reached_runtime, true);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-invalid-experience-scheduler-controls-reject-flow");
}

export function assertExperienceSchedulerEnvControlSmoke() {
  const payload = runExperienceSchedulerControlContract("start-invalid-experience-scheduler-env-controls-reject-flow");
  assert.equal(payload.invalid_env_boolean_exit_code, 2);
  assert.equal(payload.invalid_env_boolean_has_stable_error, true);
  assert.equal(payload.invalid_env_interval_syntax_exit_code, 2);
  assert.equal(payload.invalid_env_interval_syntax_has_stable_error, true);
  assert.equal(payload.invalid_env_interval_range_exit_code, 2);
  assert.equal(payload.invalid_env_interval_range_has_stable_error, true);
  assert.equal(payload.invalid_env_tasks_dir_exit_code, 2);
  assert.equal(payload.invalid_env_tasks_dir_has_stable_error, true);
  assert.equal(payload.invalid_env_default_delay_exit_code, 2);
  assert.equal(payload.invalid_env_default_delay_has_stable_error, true);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-invalid-experience-scheduler-env-controls-reject-flow");
}

export function assertExperienceSchedulerTomlControlSmoke() {
  const payload = runExperienceSchedulerControlContract("start-invalid-experience-scheduler-toml-controls-reject-flow");
  assert.equal(payload.invalid_toml_boolean_exit_code, 2);
  assert.equal(payload.invalid_toml_boolean_has_stable_error, true);
  assert.equal(payload.invalid_toml_interval_exit_code, 2);
  assert.equal(payload.invalid_toml_interval_has_stable_error, true);
  assert.equal(payload.invalid_toml_interval_secs_exit_code, 2);
  assert.equal(payload.invalid_toml_interval_secs_has_stable_error, true);
  assert.equal(payload.invalid_toml_path_exit_code, 2);
  assert.equal(payload.invalid_toml_path_has_stable_error, true);
  assert.equal(payload.invalid_toml_default_delay_exit_code, 2);
  assert.equal(payload.invalid_toml_default_delay_has_stable_error, true);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-invalid-experience-scheduler-toml-controls-reject-flow");
}

export function assertExperienceSchedulerValidBoundarySmoke() {
  const payload = runExperienceSchedulerControlContract("start-experience-scheduler-valid-boundary-flow");
  assert.equal(payload.valid_boundary_exit_code !== 2, true);
  assert.equal(payload.valid_boundary_reached_runtime, true);
  logStep("start-smoke-contract start-experience-scheduler-valid-boundary-flow");
}
