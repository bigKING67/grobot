import assert from "node:assert/strict";
import {
  logStep,
  parseJsonOutput,
  repoRoot,
  runContract,
} from "../harness.mjs";

function runStatusLineControlContract(command) {
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

export function assertStatusLineControlSmoke() {
  const payload = runStatusLineControlContract("start-invalid-status-line-controls-reject-flow");
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
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-invalid-status-line-controls-reject-flow");
}

export function assertStatusLineBasicControlSmoke() {
  const payload = runStatusLineControlContract("start-invalid-status-line-basic-controls-reject-flow");
  assert.equal(payload.invalid_enabled_exit_code, 2);
  assert.equal(payload.invalid_enabled_has_stable_error, true);
  assert.equal(payload.invalid_layout_exit_code, 2);
  assert.equal(payload.invalid_layout_has_stable_error, true);
  assert.equal(payload.invalid_theme_exit_code, 2);
  assert.equal(payload.invalid_theme_has_stable_error, true);
  assert.equal(payload.invalid_separator_exit_code, 2);
  assert.equal(payload.invalid_separator_has_stable_error, true);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-invalid-status-line-basic-controls-reject-flow");
}

export function assertStatusLineSegmentOrderControlSmoke() {
  const payload = runStatusLineControlContract("start-invalid-status-line-segment-order-controls-reject-flow");
  assert.equal(payload.invalid_segment_order_syntax_exit_code, 2);
  assert.equal(payload.invalid_segment_order_syntax_has_stable_error, true);
  assert.equal(payload.invalid_segment_order_unknown_exit_code, 2);
  assert.equal(payload.invalid_segment_order_unknown_has_stable_error, true);
  assert.equal(payload.invalid_segment_order_duplicate_exit_code, 2);
  assert.equal(payload.invalid_segment_order_duplicate_has_stable_error, true);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-invalid-status-line-segment-order-controls-reject-flow");
}

export function assertStatusLineThresholdControlSmoke() {
  const payload = runStatusLineControlContract("start-invalid-status-line-threshold-controls-reject-flow");
  assert.equal(payload.invalid_warning_ratio_exit_code, 2);
  assert.equal(payload.invalid_warning_ratio_has_stable_error, true);
  assert.equal(payload.invalid_critical_ratio_exit_code, 2);
  assert.equal(payload.invalid_critical_ratio_has_stable_error, true);
  assert.equal(payload.invalid_warning_percent_exit_code, 2);
  assert.equal(payload.invalid_warning_percent_has_stable_error, true);
  assert.equal(payload.invalid_threshold_order_exit_code, 2);
  assert.equal(payload.invalid_threshold_order_has_stable_error, true);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-invalid-status-line-threshold-controls-reject-flow");
}

export function assertStatusLineCacheControlSmoke() {
  const payload = runStatusLineControlContract("start-invalid-status-line-cache-controls-reject-flow");
  assert.equal(payload.invalid_budget_ttl_exit_code, 2);
  assert.equal(payload.invalid_budget_ttl_has_stable_error, true);
  assert.equal(payload.invalid_session_ttl_exit_code, 2);
  assert.equal(payload.invalid_session_ttl_has_stable_error, true);
  assert.equal(payload.invalid_topic_width_exit_code, 2);
  assert.equal(payload.invalid_topic_width_has_stable_error, true);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-invalid-status-line-cache-controls-reject-flow");
}

export function assertStatusLineSegmentToggleControlSmoke() {
  const payload = runStatusLineControlContract("start-invalid-status-line-segment-toggle-controls-reject-flow");
  assert.equal(payload.invalid_segment_bool_exit_code, 2);
  assert.equal(payload.invalid_segment_bool_has_stable_error, true);
  assert.equal(payload.invalid_segment_key_exit_code, 2);
  assert.equal(payload.invalid_segment_key_has_stable_error, true);
  assertNoFatalNoBanner(payload);
  logStep("start-smoke-contract start-invalid-status-line-segment-toggle-controls-reject-flow");
}

export function assertStatusLineValidBoundarySmoke() {
  const payload = runStatusLineControlContract("start-status-line-valid-boundary-flow");
  assert.equal(payload.valid_boundary_exit_code !== 2, true);
  assert.equal(payload.valid_boundary_reached_runtime, true);
  logStep("start-smoke-contract start-status-line-valid-boundary-flow");
}
