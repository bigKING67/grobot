import {
  ALLOWED_FIELDS,
  CI_LABEL_POLICY_SCHEMA,
  CI_LABEL_POLICY_VERSION,
  REQUIRED_FIELDS,
} from "./constants";
import {
  isNonEmptyString,
  matchesRegexAtStart,
} from "./helpers";
import { type JsonObject } from "./types";

export function validateRootFields(config: JsonObject, errors: string[]): RegExp | null {
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

  return safeLabelRegex;
}
