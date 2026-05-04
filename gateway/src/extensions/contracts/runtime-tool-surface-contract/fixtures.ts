export const validRuntimeSchemaProfile = {
  policy_version: "v1",
  profile: "browser",
  projection_mode: "slim",
  advanced_tool_schema: false,
  schema_fingerprint: "schema:test",
  tool_names: ["web_scan", "web_execute_js"],
  visible_tool_count: 2,
  schema_property_count: 3,
  full_schema_property_count: 5,
  suppressed_schema_property_count: 2,
  per_tool_property_count: {
    web_scan: 1,
    web_execute_js: 2,
  },
  per_tool_visible_args: {
    web_scan: ["main_only"],
    web_execute_js: ["script", "timeout_ms"],
  },
  per_tool_suppressed_args: {
    web_scan: ["tmwd_mode"],
    web_execute_js: ["native_fallback_action"],
  },
};

export const validRuntimeRecoveryCatalog = [
  {
    error_classes: ["tool_argument_not_visible"],
    risk_class: "*",
    stage: "strategy_switch",
    recommended_next_action: "inspect_visible_tool_schema_then_retry",
    recoverable: true,
  },
  {
    error_classes: ["config_missing"],
    risk_class: "*",
    stage: "ask_user",
    recommended_next_action: "ask_user_for_config_or_switch_provider",
    recoverable: false,
  },
  {
    error_classes: ["*"],
    risk_class: "*",
    stage: "strategy_switch",
    recommended_next_action: "inspect_error_and_switch_strategy",
    recoverable: true,
  },
];
