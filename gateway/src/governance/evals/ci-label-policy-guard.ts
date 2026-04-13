import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

type JsonObject = Record<string, unknown>;

const CI_LABEL_POLICY_SCHEMA = "ci_label_policy";
const CI_LABEL_POLICY_VERSION = 1;

const REQUIRED_FIELDS = [
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

const ALLOWED_FIELDS = new Set<string>(REQUIRED_FIELDS);

const COMMENT_TEMPLATE_ALLOWED_KEYS = new Set<string>([
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

const COMMENT_TEMPLATE_ALLOWED_FORMATS = new Set<string>(["text", "code"]);
const COMMENT_TRIGGER_ALLOWED_KEYS = new Set<string>(["overall_states", "trend_severities"]);
const COMMENT_TRIGGER_OVERALL_STATES = new Set<string>(["pass", "fail", "unknown"]);
const COMMENT_TRIGGER_TREND_SEVERITIES = new Set<string>(["info", "warn", "error"]);

const POLICY_DRIFT_ALLOWED_KEYS = new Set<string>([
  "label_prefix",
  "worsening_alert_threshold",
  "worsening_label",
  "comment_trigger_severities",
  "action_hints",
]);

const POLICY_DRIFT_ALLOWED_SEVERITIES = new Set<string>(["high", "medium", "low", "none"]);

interface ParsedCliArgs {
  policies: string[];
  printJson: boolean;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isColor(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-fA-F]{6}$/.test(value.trim());
}

function readJsonObject(path: string): JsonObject {
  const raw = readFileSync(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} must be a JSON object`);
  }
  return parsed as JsonObject;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (typeof value === "object" && value !== null) {
    const sorted: JsonObject = {};
    for (const key of Object.keys(value as JsonObject).sort()) {
      sorted[key] = sortJson((value as JsonObject)[key]);
    }
    return sorted;
  }
  return value;
}

function formatSortedSet(values: Set<string>): string {
  const sorted = Array.from(values).sort();
  return `[${sorted.map((item) => `'${item}'`).join(", ")}]`;
}

function matchesRegexAtStart(regex: RegExp, value: string): boolean {
  regex.lastIndex = 0;
  const match = regex.exec(value);
  return match !== null && match.index === 0;
}

function normalizePolicy(policy: JsonObject): JsonObject {
  const commentTriggerRaw = policy.comment_trigger;
  const commentTemplateRaw = policy.comment_template;
  const policyDriftRaw = policy.policy_drift;

  const commentTrigger =
    typeof commentTriggerRaw === "object" && commentTriggerRaw !== null && !Array.isArray(commentTriggerRaw)
      ? (commentTriggerRaw as JsonObject)
      : {};
  const commentTemplate =
    typeof commentTemplateRaw === "object" && commentTemplateRaw !== null && !Array.isArray(commentTemplateRaw)
      ? (commentTemplateRaw as JsonObject)
      : {};
  const policyDrift =
    typeof policyDriftRaw === "object" && policyDriftRaw !== null && !Array.isArray(policyDriftRaw)
      ? (policyDriftRaw as JsonObject)
      : {};

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

export function loadCiLabelPolicy(policyPath: string): JsonObject {
  return readJsonObject(policyPath);
}

export function computeCiLabelPolicyFingerprint(path: string): { policyHash: string; canonical: JsonObject } {
  const policy = loadCiLabelPolicy(path);
  const canonical = normalizePolicy(policy);
  const encoded = JSON.stringify(sortJson(canonical));
  const digest = createHash("sha256").update(encoded).digest("hex");
  return { policyHash: `sha256:${digest}`, canonical };
}

export function validateCiLabelPolicyConfig(config: JsonObject): string[] {
  const errors: string[] = [];

  for (const key of REQUIRED_FIELDS) {
    if (!(key in config)) {
      errors.push(`missing required field: ${key}`);
    }
  }

  const unknownFields = Object.keys(config)
    .filter((key) => !ALLOWED_FIELDS.has(key))
    .sort();
  if (unknownFields.length > 0) {
    errors.push(`unknown fields: ${unknownFields.join(", ")}`);
  }

  const schemaRaw = config.schema;
  if (!isNonEmptyString(schemaRaw)) {
    errors.push("schema must be non-empty string");
  } else if (schemaRaw !== CI_LABEL_POLICY_SCHEMA) {
    errors.push(`unsupported schema: ${schemaRaw} (expected ${CI_LABEL_POLICY_SCHEMA})`);
  }

  const schemaVersionRaw = config.schema_version;
  if (typeof schemaVersionRaw !== "number" || !Number.isInteger(schemaVersionRaw)) {
    errors.push("schema_version must be int");
  } else if (schemaVersionRaw !== CI_LABEL_POLICY_VERSION) {
    errors.push(`unsupported schema_version: ${schemaVersionRaw} (expected ${CI_LABEL_POLICY_VERSION})`);
  }

  const safeLabelPatternRaw = config.safe_label_pattern;
  let safeLabelRegex: RegExp | null = null;
  if (!isNonEmptyString(safeLabelPatternRaw)) {
    errors.push("safe_label_pattern must be non-empty string");
  } else {
    try {
      safeLabelRegex = new RegExp(safeLabelPatternRaw);
      if (!matchesRegexAtStart(safeLabelRegex, "ci/harness-pass")) {
        errors.push("safe_label_pattern must match ci/harness-pass");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`safe_label_pattern is invalid regex: ${message}`);
    }
  }

  const commentMarkerRaw = config.comment_marker;
  if (!isNonEmptyString(commentMarkerRaw)) {
    errors.push("comment_marker must be non-empty string");
  } else if (!commentMarkerRaw.includes("<!--")) {
    errors.push("comment_marker must include HTML marker syntax");
  }

  const commentTriggerRaw = config.comment_trigger;
  let commentTrigger: JsonObject = {};
  if (typeof commentTriggerRaw !== "object" || commentTriggerRaw === null || Array.isArray(commentTriggerRaw)) {
    errors.push("comment_trigger must be object");
  } else {
    commentTrigger = commentTriggerRaw as JsonObject;
    const unknownCommentTriggerFields = Object.keys(commentTrigger)
      .filter((key) => !COMMENT_TRIGGER_ALLOWED_KEYS.has(key))
      .sort();
    if (unknownCommentTriggerFields.length > 0) {
      errors.push(`comment_trigger has unknown fields: ${unknownCommentTriggerFields.join(", ")}`);
    }
  }

  const overallStatesRaw = commentTrigger.overall_states;
  let overallStates: string[] = [];
  if (!Array.isArray(overallStatesRaw)) {
    errors.push("comment_trigger.overall_states must be array");
  } else {
    const seenOverallStates = new Set<string>();
    for (const [index, value] of overallStatesRaw.entries()) {
      if (!isNonEmptyString(value)) {
        errors.push(`comment_trigger.overall_states[${index}] must be non-empty string`);
        continue;
      }
      const normalized = value.trim();
      if (!COMMENT_TRIGGER_OVERALL_STATES.has(normalized)) {
        errors.push(
          `comment_trigger.overall_states[${index}] must be one of ${formatSortedSet(COMMENT_TRIGGER_OVERALL_STATES)}`,
        );
      }
      if (seenOverallStates.has(normalized)) {
        errors.push(`duplicate comment_trigger.overall_states value: ${normalized}`);
      } else {
        seenOverallStates.add(normalized);
      }
      overallStates.push(normalized);
    }
  }

  const trendSeveritiesRaw = commentTrigger.trend_severities;
  let trendSeverities: string[] = [];
  if (!Array.isArray(trendSeveritiesRaw)) {
    errors.push("comment_trigger.trend_severities must be array");
  } else {
    const seenTrendSeverities = new Set<string>();
    for (const [index, value] of trendSeveritiesRaw.entries()) {
      if (!isNonEmptyString(value)) {
        errors.push(`comment_trigger.trend_severities[${index}] must be non-empty string`);
        continue;
      }
      const normalized = value.trim();
      if (!COMMENT_TRIGGER_TREND_SEVERITIES.has(normalized)) {
        errors.push(
          `comment_trigger.trend_severities[${index}] must be one of ${formatSortedSet(COMMENT_TRIGGER_TREND_SEVERITIES)}`,
        );
      }
      if (seenTrendSeverities.has(normalized)) {
        errors.push(`duplicate comment_trigger.trend_severities value: ${normalized}`);
      } else {
        seenTrendSeverities.add(normalized);
      }
      trendSeverities.push(normalized);
    }
  }
  if (overallStates.length === 0 && trendSeverities.length === 0) {
    errors.push("comment_trigger must include at least one overall_state or trend_severity");
  }

  const commentTemplateRaw = config.comment_template;
  let commentTemplate: JsonObject = {};
  if (typeof commentTemplateRaw !== "object" || commentTemplateRaw === null || Array.isArray(commentTemplateRaw)) {
    errors.push("comment_template must be object");
  } else {
    commentTemplate = commentTemplateRaw as JsonObject;
  }

  const commentTemplateTitle = commentTemplate.title;
  if (!isNonEmptyString(commentTemplateTitle)) {
    errors.push("comment_template.title must be non-empty string");
  }

  const commentTemplateFieldsRaw = commentTemplate.fields;
  let commentTemplateFields: JsonObject[] = [];
  if (!Array.isArray(commentTemplateFieldsRaw)) {
    errors.push("comment_template.fields must be array");
  } else {
    commentTemplateFields = commentTemplateFieldsRaw.filter(
      (field): field is JsonObject => typeof field === "object" && field !== null && !Array.isArray(field),
    );
    if (commentTemplateFields.length !== commentTemplateFieldsRaw.length) {
      errors.push("comment_template.fields entries must be objects");
    }
  }
  if (commentTemplateFields.length === 0) {
    errors.push("comment_template.fields must not be empty");
  }

  const seenCommentFieldKeys = new Set<string>();
  for (const [index, field] of commentTemplateFields.entries()) {
    const keyRaw = field.key;
    const labelRaw = field.label;
    const formatRaw = field.format;

    let key = "";
    if (!isNonEmptyString(keyRaw)) {
      errors.push(`comment_template.fields[${index}].key must be non-empty string`);
    } else {
      key = keyRaw.trim();
      if (!COMMENT_TEMPLATE_ALLOWED_KEYS.has(key)) {
        errors.push(
          `comment_template.fields[${index}].key must be one of ${formatSortedSet(COMMENT_TEMPLATE_ALLOWED_KEYS)}`,
        );
      }
      if (seenCommentFieldKeys.has(key)) {
        errors.push(`duplicate comment_template field key: ${key}`);
      }
      seenCommentFieldKeys.add(key);
    }

    if (!isNonEmptyString(labelRaw)) {
      errors.push(`comment_template.fields[${index}].label must be non-empty string`);
    }
    if (!isNonEmptyString(formatRaw)) {
      errors.push(`comment_template.fields[${index}].format must be non-empty string`);
    } else {
      const format = formatRaw.trim();
      if (!COMMENT_TEMPLATE_ALLOWED_FORMATS.has(format)) {
        errors.push(
          `comment_template.fields[${index}].format must be one of ${formatSortedSet(COMMENT_TEMPLATE_ALLOWED_FORMATS)}`,
        );
      }
    }
  }

  const policyDriftRaw = config.policy_drift;
  let policyDrift: JsonObject = {};
  if (typeof policyDriftRaw !== "object" || policyDriftRaw === null || Array.isArray(policyDriftRaw)) {
    errors.push("policy_drift must be object");
  } else {
    policyDrift = policyDriftRaw as JsonObject;
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
  let worseningAlertThreshold = 0;
  if (typeof worseningAlertThresholdRaw !== "number" || !Number.isInteger(worseningAlertThresholdRaw)) {
    errors.push("policy_drift.worsening_alert_threshold must be int");
  } else {
    worseningAlertThreshold = worseningAlertThresholdRaw;
    if (worseningAlertThreshold < 1) {
      errors.push("policy_drift.worsening_alert_threshold must be >= 1");
    }
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
  let policyDriftTriggerSeverities: string[] = [];
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
      policyDriftTriggerSeverities.push(normalized);
    }
    if (policyDriftTriggerSeverities.length === 0) {
      errors.push("policy_drift.comment_trigger_severities must not be empty");
    }
  }

  const policyDriftActionHintsRaw = policyDrift.action_hints;
  let policyDriftActionHints: JsonObject = {};
  if (
    typeof policyDriftActionHintsRaw !== "object" ||
    policyDriftActionHintsRaw === null ||
    Array.isArray(policyDriftActionHintsRaw)
  ) {
    errors.push("policy_drift.action_hints must be object");
  } else {
    policyDriftActionHints = policyDriftActionHintsRaw as JsonObject;
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

  if (!isColor(config.default_color)) {
    errors.push("default_color must be 6-digit hex");
  }
  if (!isNonEmptyString(config.default_description)) {
    errors.push("default_description must be non-empty string");
  }

  const managedPrefixesRaw = config.managed_label_prefixes;
  let managedPrefixes: string[] = [];
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

  if (policyDriftLabelPrefix && managedPrefixes.length > 0 && !managedPrefixes.includes(policyDriftLabelPrefix)) {
    errors.push(
      `policy_drift.label_prefix must be included in managed_label_prefixes: ${policyDriftLabelPrefix}`,
    );
  }
  if (
    policyDriftWorseningLabel &&
    managedPrefixes.length > 0 &&
    !managedPrefixes.includes(policyDriftWorseningLabel)
  ) {
    errors.push(
      `policy_drift.worsening_label must be included in managed_label_prefixes: ${policyDriftWorseningLabel}`,
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

    let normalizedPrefix = "";
    if (!isNonEmptyString(prefixRaw)) {
      errors.push(`label_rules[${index}].prefix must be non-empty string`);
    } else {
      normalizedPrefix = prefixRaw.trim();
      if (!normalizedPrefix.startsWith("ci/")) {
        errors.push(`label_rules[${index}].prefix must start with ci/`);
      }
      if (seenPrefixes.has(normalizedPrefix)) {
        errors.push(`duplicate label rule prefix: ${normalizedPrefix}`);
      }
      seenPrefixes.add(normalizedPrefix);
      if (managedPrefixes.length > 0 && !managedPrefixes.some((managedPrefix) => normalizedPrefix.startsWith(managedPrefix))) {
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

  return errors;
}

export function validateCiLabelPolicyFile(policyPath: string): { config: JsonObject | null; errors: string[] } {
  let policy: JsonObject;
  try {
    policy = loadCiLabelPolicy(policyPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { config: null, errors: [message] };
  }
  return { config: policy, errors: validateCiLabelPolicyConfig(policy) };
}

export function buildPolicyResult(policyPath: string, includeDetails: boolean): JsonObject {
  const { config, errors } = validateCiLabelPolicyFile(policyPath);
  const result: JsonObject = {
    policy: policyPath,
    ok: errors.length === 0,
    errors: [...errors],
  };
  if (config === null) {
    return result;
  }
  try {
    const { policyHash, canonical } = computeCiLabelPolicyFingerprint(policyPath);
    result.policy_hash = policyHash;
    if (includeDetails) {
      result.normalized_keys = Object.keys(canonical).sort();
      result.canonical_policy = canonical;
    }
  } catch (error) {
    result.ok = false;
    const message = error instanceof Error ? error.message : String(error);
    (result.errors as string[]).push(message);
  }
  return result;
}

function parseArgs(argv: string[]): ParsedCliArgs {
  const policies: string[] = [];
  let printJson = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--policy") {
      const value = argv[index + 1] ?? "";
      if (value.trim().length > 0) {
        policies.push(value.trim());
      }
      index += 1;
      continue;
    }
    if (token === "--print-json") {
      printJson = true;
      continue;
    }
  }
  if (policies.length === 0) {
    throw new Error("missing required args: --policy");
  }
  return { policies, printJson };
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const results: JsonObject[] = [];
  let hasError = false;
  for (const policyPath of args.policies) {
    const result = buildPolicyResult(policyPath, args.printJson);
    if (result.ok !== true) {
      hasError = true;
    }
    results.push(result);
  }
  const output = { policies: results };
  if (args.printJson) {
    process.stdout.write(`${JSON.stringify(output, undefined, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
  return hasError ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`ci-label-policy-guard fatal: ${String(error)}\n`);
  process.exitCode = 1;
}
