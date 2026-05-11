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

function assertExperienceSchedulerValidatorContract() {
  const result = runContract("experience-scheduler-config-validator-contract.mjs", "", [], { timeoutMs: 120_000 });
  assert.equal(result.code, 0, `experience scheduler validator contract failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const payload = parseJsonOutput("experience-scheduler-config-validator-contract", result.stdout);
  assert.equal(payload.status, "ok");
  assert.equal(payload.rejected_count, 10);
  assert.equal(Number(payload.unique_error_count) >= 6, true);
  assert.equal(payload.valid_boundary, true);
}

export function assertExperienceSchedulerControlSmoke() {
  const payload = runExperienceSchedulerControlContract("start-invalid-experience-scheduler-controls-reject-flow");
  assertExperienceSchedulerEnvBasicPayload(payload);
  assertExperienceSchedulerEnvPathDelayPayload(payload);
  assertExperienceSchedulerTomlBasicPayload(payload);
  assertExperienceSchedulerTomlPathDelayPayload(payload);
  assert.equal(payload.valid_boundary_exit_code !== 2, true);
  assert.equal(payload.valid_boundary_reached_runtime, true);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-invalid-experience-scheduler-controls-reject-flow");
}

function assertExperienceSchedulerEnvBasicPayload(payload) {
  assert.equal(payload.invalid_env_boolean_exit_code, 2);
  assert.equal(payload.invalid_env_boolean_has_stable_error, true);
  assert.equal(payload.invalid_env_interval_syntax_exit_code, 2);
  assert.equal(payload.invalid_env_interval_syntax_has_stable_error, true);
  assert.equal(payload.invalid_env_interval_range_exit_code, 2);
  assert.equal(payload.invalid_env_interval_range_has_stable_error, true);
}

function assertExperienceSchedulerEnvPathDelayPayload(payload) {
  assert.equal(payload.invalid_env_tasks_dir_exit_code, 2);
  assert.equal(payload.invalid_env_tasks_dir_has_stable_error, true);
  assert.equal(payload.invalid_env_default_delay_exit_code, 2);
  assert.equal(payload.invalid_env_default_delay_has_stable_error, true);
}

function assertExperienceSchedulerTomlBasicPayload(payload) {
  assert.equal(payload.invalid_toml_boolean_exit_code, 2);
  assert.equal(payload.invalid_toml_boolean_has_stable_error, true);
  assert.equal(payload.invalid_toml_interval_exit_code, 2);
  assert.equal(payload.invalid_toml_interval_has_stable_error, true);
  assert.equal(payload.invalid_toml_interval_secs_exit_code, 2);
  assert.equal(payload.invalid_toml_interval_secs_has_stable_error, true);
}

function assertExperienceSchedulerTomlPathDelayPayload(payload) {
  assert.equal(payload.invalid_toml_path_exit_code, 2);
  assert.equal(payload.invalid_toml_path_has_stable_error, true);
  assert.equal(payload.invalid_toml_default_delay_exit_code, 2);
  assert.equal(payload.invalid_toml_default_delay_has_stable_error, true);
}

export function assertExperienceSchedulerEnvControlSmoke() {
  assertExperienceSchedulerValidatorContract();
  logStep("experience-scheduler-config-validator-contract env-controls");
}

export function assertExperienceSchedulerTomlControlSmoke() {
  assertExperienceSchedulerValidatorContract();
  logStep("experience-scheduler-config-validator-contract toml-controls");
}

export function assertExperienceSchedulerValidatorSmoke() {
  assertExperienceSchedulerValidatorContract();
  logStep("experience-scheduler-config-validator-contract batch-controls");
}

export function assertExperienceSchedulerValidBoundarySmoke() {
  const payload = runExperienceSchedulerControlContract("start-experience-scheduler-valid-boundary-flow");
  assert.equal(payload.valid_boundary_exit_code !== 2, true);
  assert.equal(payload.valid_boundary_reached_runtime, true);
  logStep("start-smoke-contract start-experience-scheduler-valid-boundary-flow");
}
