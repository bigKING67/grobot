export const CI_LABEL_POLICY_SCHEMA = "ci_label_policy";
export const CI_LABEL_POLICY_VERSION = 1;

export const REQUIRED_FIELDS = [
  "schema",
  "schema_version",
  "safe_label_pattern",
  "comment_marker",
  "comment_trigger",
  "comment_template",
  "policy_drift",
  "managed_label_prefixes",
  "default_color",
  "default_description",
  "label_rules",
] as const;

export const ALLOWED_FIELDS = new Set<string>(REQUIRED_FIELDS);

export const COMMENT_TEMPLATE_ALLOWED_KEYS = new Set<string>([
  "overall",
  "trend_tag",
  "trend_severity",
  "policy_drift",
  "auto_loop_state",
  "auto_loop_selected_variant",
  "auto_loop_selected_proposal",
  "auto_loop_circuit_breaker",
  "owner",
  "action",
  "suggested_labels",
]);

export const COMMENT_TEMPLATE_ALLOWED_FORMATS = new Set<string>(["text", "code"]);
export const COMMENT_TRIGGER_ALLOWED_KEYS = new Set<string>(["overall_states", "trend_severities"]);
export const COMMENT_TRIGGER_OVERALL_STATES = new Set<string>(["pass", "fail", "unknown"]);
export const COMMENT_TRIGGER_TREND_SEVERITIES = new Set<string>(["info", "warn", "error"]);

export const POLICY_DRIFT_ALLOWED_KEYS = new Set<string>([
  "label_prefix",
  "worsening_alert_threshold",
  "worsening_label",
  "comment_trigger_severities",
  "action_hints",
]);

export const POLICY_DRIFT_ALLOWED_SEVERITIES = new Set<string>(["high", "medium", "low", "none"]);
