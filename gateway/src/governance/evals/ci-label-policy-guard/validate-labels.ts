import {
  isColor,
  isNonEmptyString,
  matchesRegexAtStart,
} from "./helpers";
import { type JsonObject } from "./types";

export function validateLabelRules(input: {
  config: JsonObject;
  safeLabelRegex: RegExp | null;
  policyDriftLabelPrefix: string;
  policyDriftWorseningLabel: string;
  errors: string[];
}): void {
  const { config, errors, safeLabelRegex } = input;
  if (!isColor(config.default_color)) {
    errors.push("default_color must be 6-digit hex");
  }
  if (!isNonEmptyString(config.default_description)) {
    errors.push("default_description must be non-empty string");
  }

  const managedPrefixesRaw = config.managed_label_prefixes;
  const managedPrefixes: string[] = [];
  if (!Array.isArray(managedPrefixesRaw)) {
    errors.push("managed_label_prefixes must be array");
  } else {
    for (const [index, value] of managedPrefixesRaw.entries()) {
      if (!isNonEmptyString(value)) {
        errors.push(`managed_label_prefixes[${index}] must be non-empty string`);
        continue;
      }
      managedPrefixes.push(value.trim());
    }
    if (managedPrefixes.length === 0) {
      errors.push("managed_label_prefixes must not be empty");
    }
  }

  const seenManagedPrefixes = new Set<string>();
  for (const [index, prefix] of managedPrefixes.entries()) {
    if (!prefix.startsWith("ci/")) {
      errors.push(`managed_label_prefixes[${index}] must start with ci/`);
    }
    if (seenManagedPrefixes.has(prefix)) {
      errors.push(`duplicate managed label prefix: ${prefix}`);
    }
    seenManagedPrefixes.add(prefix);
    if (safeLabelRegex !== null && !matchesRegexAtStart(safeLabelRegex, `${prefix}x`)) {
      errors.push(`managed_label_prefixes[${index}] is incompatible with safe_label_pattern: ${prefix}`);
    }
  }

  if (
    input.policyDriftLabelPrefix &&
    managedPrefixes.length > 0 &&
    !managedPrefixes.includes(input.policyDriftLabelPrefix)
  ) {
    errors.push(
      `policy_drift.label_prefix must be included in managed_label_prefixes: ${input.policyDriftLabelPrefix}`,
    );
  }
  if (
    input.policyDriftWorseningLabel &&
    managedPrefixes.length > 0 &&
    !managedPrefixes.includes(input.policyDriftWorseningLabel)
  ) {
    errors.push(
      `policy_drift.worsening_label must be included in managed_label_prefixes: ${input.policyDriftWorseningLabel}`,
    );
  }

  const labelRulesRaw = config.label_rules;
  let labelRules: JsonObject[] = [];
  if (!Array.isArray(labelRulesRaw)) {
    errors.push("label_rules must be array");
  } else {
    labelRules = labelRulesRaw.filter(
      (rule): rule is JsonObject => typeof rule === "object" && rule !== null && !Array.isArray(rule),
    );
    if (labelRules.length !== labelRulesRaw.length) {
      errors.push("label_rules entries must be objects");
    }
  }
  if (labelRules.length === 0) {
    errors.push("label_rules must not be empty");
  }

  const seenPrefixes = new Set<string>();
  for (const [index, rule] of labelRules.entries()) {
    const prefixRaw = rule.prefix;
    const colorRaw = rule.color;
    const descriptionRaw = rule.description;

    if (!isNonEmptyString(prefixRaw)) {
      errors.push(`label_rules[${index}].prefix must be non-empty string`);
    } else {
      const normalizedPrefix = prefixRaw.trim();
      if (!normalizedPrefix.startsWith("ci/")) {
        errors.push(`label_rules[${index}].prefix must start with ci/`);
      }
      if (seenPrefixes.has(normalizedPrefix)) {
        errors.push(`duplicate label rule prefix: ${normalizedPrefix}`);
      }
      seenPrefixes.add(normalizedPrefix);
      if (
        managedPrefixes.length > 0 &&
        !managedPrefixes.some((managedPrefix) => normalizedPrefix.startsWith(managedPrefix))
      ) {
        errors.push(`label_rules[${index}].prefix is not covered by managed_label_prefixes: ${normalizedPrefix}`);
      }
    }

    if (!isColor(colorRaw)) {
      errors.push(`label_rules[${index}].color must be 6-digit hex`);
    }
    if (!isNonEmptyString(descriptionRaw)) {
      errors.push(`label_rules[${index}].description must be non-empty string`);
    }
  }
}
