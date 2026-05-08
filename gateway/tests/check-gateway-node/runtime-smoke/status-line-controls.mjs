import assert from "node:assert/strict";
import {
  logStep,
  parseJsonOutput,
  repoRoot,
  runContract,
} from "../harness.mjs";

export function assertStatusLineControlSmoke() {
  const result = runContract(
    "start-smoke-contract.mjs",
    "start-invalid-status-line-controls-reject-flow",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const payload = parseJsonOutput(
    "start-smoke-contract start-invalid-status-line-controls-reject-flow",
    result.stdout,
  );
  assert.equal(payload.invalid_enabled_exit_code, 2);
  assert.equal(payload.invalid_enabled_has_stable_error, true);
  assert.equal(payload.invalid_layout_exit_code, 2);
  assert.equal(payload.invalid_layout_has_stable_error, true);
  assert.equal(payload.invalid_theme_exit_code, 2);
  assert.equal(payload.invalid_theme_has_stable_error, true);
  assert.equal(payload.invalid_separator_exit_code, 2);
  assert.equal(payload.invalid_separator_has_stable_error, true);
  assert.equal(payload.invalid_segment_order_syntax_exit_code, 2);
  assert.equal(payload.invalid_segment_order_syntax_has_stable_error, true);
  assert.equal(payload.invalid_segment_order_unknown_exit_code, 2);
  assert.equal(payload.invalid_segment_order_unknown_has_stable_error, true);
  assert.equal(payload.invalid_segment_order_duplicate_exit_code, 2);
  assert.equal(payload.invalid_segment_order_duplicate_has_stable_error, true);
  assert.equal(payload.invalid_warning_ratio_exit_code, 2);
  assert.equal(payload.invalid_warning_ratio_has_stable_error, true);
  assert.equal(payload.invalid_critical_ratio_exit_code, 2);
  assert.equal(payload.invalid_critical_ratio_has_stable_error, true);
  assert.equal(payload.invalid_warning_percent_exit_code, 2);
  assert.equal(payload.invalid_warning_percent_has_stable_error, true);
  assert.equal(payload.invalid_threshold_order_exit_code, 2);
  assert.equal(payload.invalid_threshold_order_has_stable_error, true);
  assert.equal(payload.invalid_budget_ttl_exit_code, 2);
  assert.equal(payload.invalid_budget_ttl_has_stable_error, true);
  assert.equal(payload.invalid_session_ttl_exit_code, 2);
  assert.equal(payload.invalid_session_ttl_has_stable_error, true);
  assert.equal(payload.invalid_topic_width_exit_code, 2);
  assert.equal(payload.invalid_topic_width_has_stable_error, true);
  assert.equal(payload.invalid_segment_bool_exit_code, 2);
  assert.equal(payload.invalid_segment_bool_has_stable_error, true);
  assert.equal(payload.invalid_segment_key_exit_code, 2);
  assert.equal(payload.invalid_segment_key_has_stable_error, true);
  assert.equal(payload.valid_boundary_exit_code !== 2, true);
  assert.equal(payload.valid_boundary_reached_runtime, true);
  assert.equal(payload.hides_top_level_fatal, true);
  assert.equal(payload.has_start_banner, false);
  logStep("start-smoke-contract start-invalid-status-line-controls-reject-flow");
}
