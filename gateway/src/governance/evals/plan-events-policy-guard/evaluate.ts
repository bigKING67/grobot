import { isRecord, asNumber, asNumberOrNull, asNumberWithDefault, divideOrNull } from "./json";
import type { JsonObject, LoadedPolicy } from "./types";

export function evaluatePolicy(policy: LoadedPolicy, report: JsonObject): {
  status: "ok" | "error";
  profile: string;
  policy_schema: string;
  policy_schema_version: number;
  violations: string[];
  violations_count: number;
  metrics: JsonObject;
} {
  const totalsRaw = report.totals;
  if (!isRecord(totalsRaw)) {
    throw new Error("report.totals must be object");
  }
  const metrics = {
    events_count: asNumber(totalsRaw, "events_count"),
    sessions_count: asNumber(totalsRaw, "sessions_count"),
    plan_mode_entered_count: asNumber(totalsRaw, "plan_mode_entered_count"),
    plan_created_count: asNumber(totalsRaw, "plan_created_count"),
    plan_progress_appended_count: asNumber(totalsRaw, "plan_progress_appended_count"),
    plan_review_passed_count: asNumber(totalsRaw, "plan_review_passed_count"),
    plan_review_failed_count: asNumber(totalsRaw, "plan_review_failed_count"),
    invalid_lines: asNumber(totalsRaw, "invalid_lines"),
    missing_files_count: asNumber(totalsRaw, "missing_files_count"),
    review_failed_rate: asNumberOrNull(totalsRaw, "review_failed_rate"),
    guard_denied_rate: asNumberOrNull(totalsRaw, "guard_denied_rate"),
    quality_guard_blocked_rate: asNumberOrNull(totalsRaw, "quality_guard_blocked_rate"),
    idempotent_hit_rate: asNumberOrNull(totalsRaw, "idempotent_hit_rate"),
    policy_action_fail_count: asNumberWithDefault(totalsRaw, "policy_action_fail_count", 0),
    policy_action_degrade_count: asNumberWithDefault(totalsRaw, "policy_action_degrade_count", 0),
    plan_phase_unknown_count: asNumberWithDefault(totalsRaw, "plan_phase_unknown_count", 0),
    policy_fail_rate: divideOrNull(
      asNumberWithDefault(totalsRaw, "policy_action_fail_count", 0),
      asNumber(totalsRaw, "events_count"),
    ),
    unknown_phase_rate: divideOrNull(
      asNumberWithDefault(totalsRaw, "plan_phase_unknown_count", 0),
      asNumber(totalsRaw, "events_count"),
    ),
    plan_recovered_stale_approved_count: asNumber(totalsRaw, "plan_recovered_stale_approved_count"),
  };
  const violations: string[] = [];
  if (metrics.events_count < policy.gates.min_events_count) {
    violations.push(`events_count ${String(metrics.events_count)} < min_events_count ${String(policy.gates.min_events_count)}`);
  }
  if (metrics.sessions_count < policy.gates.min_sessions_count) {
    violations.push(`sessions_count ${String(metrics.sessions_count)} < min_sessions_count ${String(policy.gates.min_sessions_count)}`);
  }
  if (metrics.plan_mode_entered_count < policy.gates.min_plan_mode_entered_count) {
    violations.push(
      `plan_mode_entered_count ${String(metrics.plan_mode_entered_count)} < min_plan_mode_entered_count ${String(policy.gates.min_plan_mode_entered_count)}`,
    );
  }
  if (metrics.plan_created_count < policy.gates.min_plan_created_count) {
    violations.push(
      `plan_created_count ${String(metrics.plan_created_count)} < min_plan_created_count ${String(policy.gates.min_plan_created_count)}`,
    );
  }
  if (metrics.plan_progress_appended_count < policy.gates.min_plan_progress_appended_count) {
    violations.push(
      `plan_progress_appended_count ${String(metrics.plan_progress_appended_count)} < min_plan_progress_appended_count ${String(policy.gates.min_plan_progress_appended_count)}`,
    );
  }
  if (metrics.invalid_lines > policy.gates.max_invalid_lines) {
    violations.push(`invalid_lines ${String(metrics.invalid_lines)} > max_invalid_lines ${String(policy.gates.max_invalid_lines)}`);
  }
  if (metrics.missing_files_count > policy.gates.max_missing_files) {
    violations.push(
      `missing_files_count ${String(metrics.missing_files_count)} > max_missing_files ${String(policy.gates.max_missing_files)}`,
    );
  }
  if (
    policy.gates.max_review_failed_rate != null &&
    metrics.review_failed_rate != null &&
    metrics.review_failed_rate > policy.gates.max_review_failed_rate
  ) {
    violations.push(
      `review_failed_rate ${String(metrics.review_failed_rate)} > max_review_failed_rate ${String(policy.gates.max_review_failed_rate)}`,
    );
  }
  if (
    policy.gates.max_guard_denied_rate != null &&
    metrics.guard_denied_rate != null &&
    metrics.guard_denied_rate > policy.gates.max_guard_denied_rate
  ) {
    violations.push(
      `guard_denied_rate ${String(metrics.guard_denied_rate)} > max_guard_denied_rate ${String(policy.gates.max_guard_denied_rate)}`,
    );
  }
  if (
    policy.gates.max_quality_guard_blocked_rate != null &&
    metrics.quality_guard_blocked_rate != null &&
    metrics.quality_guard_blocked_rate > policy.gates.max_quality_guard_blocked_rate
  ) {
    violations.push(
      `quality_guard_blocked_rate ${String(metrics.quality_guard_blocked_rate)} > max_quality_guard_blocked_rate ${String(policy.gates.max_quality_guard_blocked_rate)}`,
    );
  }
  if (
    policy.gates.max_idempotent_hit_rate != null &&
    metrics.idempotent_hit_rate != null &&
    metrics.idempotent_hit_rate > policy.gates.max_idempotent_hit_rate
  ) {
    violations.push(
      `idempotent_hit_rate ${String(metrics.idempotent_hit_rate)} > max_idempotent_hit_rate ${String(policy.gates.max_idempotent_hit_rate)}`,
    );
  }
  if (
    policy.gates.max_policy_fail_rate != null &&
    metrics.policy_fail_rate != null &&
    metrics.policy_fail_rate > policy.gates.max_policy_fail_rate
  ) {
    violations.push(
      `policy_fail_rate ${String(metrics.policy_fail_rate)} > max_policy_fail_rate ${String(policy.gates.max_policy_fail_rate)}`,
    );
  }
  if (
    policy.gates.max_unknown_phase_rate != null &&
    metrics.unknown_phase_rate != null &&
    metrics.unknown_phase_rate > policy.gates.max_unknown_phase_rate
  ) {
    violations.push(
      `unknown_phase_rate ${String(metrics.unknown_phase_rate)} > max_unknown_phase_rate ${String(policy.gates.max_unknown_phase_rate)}`,
    );
  }
  if (
    policy.gates.max_stale_recovery_count != null &&
    metrics.plan_recovered_stale_approved_count > policy.gates.max_stale_recovery_count
  ) {
    violations.push(
      `plan_recovered_stale_approved_count ${String(metrics.plan_recovered_stale_approved_count)} > max_stale_recovery_count ${String(policy.gates.max_stale_recovery_count)}`,
    );
  }
  return {
    status: violations.length === 0 ? "ok" : "error",
    profile: policy.profile,
    policy_schema: policy.schema,
    policy_schema_version: policy.schema_version,
    violations,
    violations_count: violations.length,
    metrics,
  };
}
