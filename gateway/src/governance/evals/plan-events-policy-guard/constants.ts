export const PLAN_EVENTS_POLICY_SCHEMA = "plan_events_policy";
export const PLAN_EVENTS_POLICY_VERSION = 1;
export const POLICY_OVERRIDE_ALLOW_ENV = "GROBOT_PLAN_EVENTS_POLICY_OVERRIDE_ALLOW";
export const POLICY_OVERRIDE_DENY_ENV = "GROBOT_PLAN_EVENTS_POLICY_OVERRIDE_DENY";

export const ALLOWED_POLICY_FIELDS = ["schema", "schema_version", "profile", "gates"] as const;
export const ALLOWED_GATE_FIELDS = [
  "min_events_count",
  "min_sessions_count",
  "min_plan_mode_entered_count",
  "min_plan_created_count",
  "min_plan_progress_appended_count",
  "max_invalid_lines",
  "max_missing_files",
  "max_review_failed_rate",
  "max_guard_denied_rate",
  "max_quality_guard_blocked_rate",
  "max_idempotent_hit_rate",
  "max_policy_fail_rate",
  "max_unknown_phase_rate",
  "max_stale_recovery_count",
] as const;

export const ALLOWED_GATE_FIELD_SET = new Set<string>(ALLOWED_GATE_FIELDS as readonly string[]);
export type PolicyGateField = (typeof ALLOWED_GATE_FIELDS)[number];
