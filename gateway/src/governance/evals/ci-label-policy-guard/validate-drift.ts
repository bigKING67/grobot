import {
  POLICY_DRIFT_ALLOWED_KEYS,
  POLICY_DRIFT_ALLOWED_SEVERITIES,
} from "./constants";
import {
  asObject,
  formatSortedSet,
  isNonEmptyString,
  matchesRegexAtStart,
} from "./helpers";
import { type JsonObject } from "./types";

export interface PolicyDriftValidationResult {
  policyDriftLabelPrefix: string;
  policyDriftWorseningLabel: string;
}

export function validatePolicyDrift(
  config: JsonObject,
  safeLabelRegex: RegExp | null,
  errors: string[],
): PolicyDriftValidationResult {
  const policyDrift = asObject(config.policy_drift) ?? {};
  if (!asObject(config.policy_drift)) {
    errors.push("policy_drift must be object");
  } else {
    const unknownPolicyDriftFields = Object.keys(policyDrift)
      .filter((key) => !POLICY_DRIFT_ALLOWED_KEYS.has(key))
      .sort();
    if (unknownPolicyDriftFields.length > 0) {
      errors.push(`policy_drift has unknown fields: ${unknownPolicyDriftFields.join(", ")}`);
    }
  }

  const labelPrefixRaw = policyDrift.label_prefix;
  let policyDriftLabelPrefix = "";
  if (!isNonEmptyString(labelPrefixRaw)) {
    errors.push("policy_drift.label_prefix must be non-empty string");
  } else {
    policyDriftLabelPrefix = labelPrefixRaw.trim();
    if (!policyDriftLabelPrefix.startsWith("ci/")) {
      errors.push("policy_drift.label_prefix must start with ci/");
    }
    if (safeLabelRegex !== null && !matchesRegexAtStart(safeLabelRegex, `${policyDriftLabelPrefix}x`)) {
      errors.push(`policy_drift.label_prefix is incompatible with safe_label_pattern: ${policyDriftLabelPrefix}`);
    }
  }

  const worseningAlertThresholdRaw = policyDrift.worsening_alert_threshold;
  if (typeof worseningAlertThresholdRaw !== "number" || !Number.isInteger(worseningAlertThresholdRaw)) {
    errors.push("policy_drift.worsening_alert_threshold must be int");
  } else if (worseningAlertThresholdRaw < 1) {
    errors.push("policy_drift.worsening_alert_threshold must be >= 1");
  }

  const worseningLabelRaw = policyDrift.worsening_label;
  let policyDriftWorseningLabel = "";
  if (!isNonEmptyString(worseningLabelRaw)) {
    errors.push("policy_drift.worsening_label must be non-empty string");
  } else {
    policyDriftWorseningLabel = worseningLabelRaw.trim();
    if (!policyDriftWorseningLabel.startsWith("ci/")) {
      errors.push("policy_drift.worsening_label must start with ci/");
    }
    if (policyDriftLabelPrefix && !policyDriftWorseningLabel.startsWith(policyDriftLabelPrefix)) {
      errors.push(
        `policy_drift.worsening_label must start with policy_drift.label_prefix: ${policyDriftWorseningLabel}`,
      );
    }
    if (safeLabelRegex !== null && !matchesRegexAtStart(safeLabelRegex, policyDriftWorseningLabel)) {
      errors.push(
        `policy_drift.worsening_label is incompatible with safe_label_pattern: ${policyDriftWorseningLabel}`,
      );
    }
  }

  const policyDriftTriggerRaw = policyDrift.comment_trigger_severities;
  if (!Array.isArray(policyDriftTriggerRaw)) {
    errors.push("policy_drift.comment_trigger_severities must be array");
  } else {
    const seenPolicyDriftSeverities = new Set<string>();
    for (const [index, value] of policyDriftTriggerRaw.entries()) {
      if (!isNonEmptyString(value)) {
        errors.push(`policy_drift.comment_trigger_severities[${index}] must be non-empty string`);
        continue;
      }
      const normalized = value.trim();
      if (!POLICY_DRIFT_ALLOWED_SEVERITIES.has(normalized)) {
        errors.push(
          `policy_drift.comment_trigger_severities[${index}] must be one of ${formatSortedSet(POLICY_DRIFT_ALLOWED_SEVERITIES)}`,
        );
      }
      if (seenPolicyDriftSeverities.has(normalized)) {
        errors.push(`duplicate policy_drift.comment_trigger_severities value: ${normalized}`);
      } else {
        seenPolicyDriftSeverities.add(normalized);
      }
    }
    if (policyDriftTriggerRaw.length === 0) {
      errors.push("policy_drift.comment_trigger_severities must not be empty");
    }
  }

  const policyDriftActionHints = asObject(policyDrift.action_hints) ?? {};
  if (!asObject(policyDrift.action_hints)) {
    errors.push("policy_drift.action_hints must be object");
  } else {
    const unknownActionHintKeys = Object.keys(policyDriftActionHints)
      .map((key) => String(key))
      .filter((key) => !POLICY_DRIFT_ALLOWED_SEVERITIES.has(key))
      .sort();
    if (unknownActionHintKeys.length > 0) {
      errors.push(`policy_drift.action_hints has unknown keys: ${unknownActionHintKeys.join(", ")}`);
    }
  }

  for (const severity of Array.from(POLICY_DRIFT_ALLOWED_SEVERITIES).sort()) {
    if (!(severity in policyDriftActionHints)) {
      errors.push(`policy_drift.action_hints.${severity} must be non-empty string`);
      continue;
    }
    const value = policyDriftActionHints[severity];
    if (!isNonEmptyString(value)) {
      errors.push(`policy_drift.action_hints.${severity} must be non-empty string`);
    }
  }

  return {
    policyDriftLabelPrefix,
    policyDriftWorseningLabel,
  };
}
