import { asObject } from "./helpers";
import { type JsonObject } from "./types";

export function normalizePolicy(policy: JsonObject): JsonObject {
  const commentTrigger = asObject(policy.comment_trigger) ?? {};
  const commentTemplate = asObject(policy.comment_template) ?? {};
  const policyDrift = asObject(policy.policy_drift) ?? {};

  const normalizedCommentTriggerOverallStates = Array.isArray(commentTrigger.overall_states)
    ? commentTrigger.overall_states.filter((value): value is string => typeof value === "string").map((value) => value.trim())
    : [];

  const normalizedCommentTriggerTrendSeverities = Array.isArray(commentTrigger.trend_severities)
    ? commentTrigger.trend_severities
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
    : [];

  const normalizedCommentTemplateFields = Array.isArray(commentTemplate.fields)
    ? commentTemplate.fields
        .filter((field): field is JsonObject => typeof field === "object" && field !== null && !Array.isArray(field))
        .map((field) => ({
          key: String(field.key ?? "").trim(),
          label: String(field.label ?? "").trim(),
          format: String(field.format ?? "").trim(),
        }))
    : [];

  const normalizedPolicyDriftCommentTriggerSeverities = Array.isArray(policyDrift.comment_trigger_severities)
    ? policyDrift.comment_trigger_severities
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
    : [];

  const actionHintsRaw = policyDrift.action_hints;
  const normalizedPolicyDriftActionHints: JsonObject = {};
  if (typeof actionHintsRaw === "object" && actionHintsRaw !== null && !Array.isArray(actionHintsRaw)) {
    for (const [key, value] of Object.entries(actionHintsRaw)) {
      if (typeof key === "string" && typeof value === "string") {
        normalizedPolicyDriftActionHints[key.trim()] = value.trim();
      }
    }
  }

  const managedPrefixesRaw = policy.managed_label_prefixes;
  const normalizedManagedPrefixes = Array.isArray(managedPrefixesRaw)
    ? managedPrefixesRaw.filter((value): value is string => typeof value === "string").map((value) => value.trim())
    : [];

  const labelRulesRaw = policy.label_rules;
  const normalizedLabelRules = Array.isArray(labelRulesRaw)
    ? labelRulesRaw
        .filter((rule): rule is JsonObject => typeof rule === "object" && rule !== null && !Array.isArray(rule))
        .map((rule) => ({
          prefix: String(rule.prefix ?? "").trim(),
          color: String(rule.color ?? "").trim().toLowerCase(),
          description: String(rule.description ?? "").trim(),
        }))
    : [];

  const policyDriftThresholdRaw = policyDrift.worsening_alert_threshold;
  const policyDriftThreshold =
    typeof policyDriftThresholdRaw === "number" && Number.isInteger(policyDriftThresholdRaw)
      ? policyDriftThresholdRaw
      : 0;

  return {
    schema: String(policy.schema ?? "").trim(),
    schema_version:
      typeof policy.schema_version === "number" && Number.isInteger(policy.schema_version) ? policy.schema_version : 0,
    safe_label_pattern: String(policy.safe_label_pattern ?? "").trim(),
    comment_marker: String(policy.comment_marker ?? "").trim(),
    comment_trigger: {
      overall_states: normalizedCommentTriggerOverallStates,
      trend_severities: normalizedCommentTriggerTrendSeverities,
    },
    comment_template: {
      title: String(commentTemplate.title ?? "").trim(),
      fields: normalizedCommentTemplateFields,
    },
    policy_drift: {
      label_prefix: String(policyDrift.label_prefix ?? "").trim(),
      worsening_alert_threshold: policyDriftThreshold,
      worsening_label: String(policyDrift.worsening_label ?? "").trim(),
      comment_trigger_severities: normalizedPolicyDriftCommentTriggerSeverities,
      action_hints: normalizedPolicyDriftActionHints,
    },
    managed_label_prefixes: normalizedManagedPrefixes,
    default_color: String(policy.default_color ?? "").trim().toLowerCase(),
    default_description: String(policy.default_description ?? "").trim(),
    label_rules: normalizedLabelRules,
  };
}
