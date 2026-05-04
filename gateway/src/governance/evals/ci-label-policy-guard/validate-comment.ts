import {
  COMMENT_TEMPLATE_ALLOWED_FORMATS,
  COMMENT_TEMPLATE_ALLOWED_KEYS,
  COMMENT_TRIGGER_ALLOWED_KEYS,
  COMMENT_TRIGGER_OVERALL_STATES,
  COMMENT_TRIGGER_TREND_SEVERITIES,
} from "./constants";
import {
  asObject,
  formatSortedSet,
  isNonEmptyString,
} from "./helpers";
import { type JsonObject } from "./types";

export function validateCommentTrigger(config: JsonObject, errors: string[]): void {
  const commentTrigger = asObject(config.comment_trigger) ?? {};
  if (!asObject(config.comment_trigger)) {
    errors.push("comment_trigger must be object");
  } else {
    const unknownCommentTriggerFields = Object.keys(commentTrigger)
      .filter((key) => !COMMENT_TRIGGER_ALLOWED_KEYS.has(key))
      .sort();
    if (unknownCommentTriggerFields.length > 0) {
      errors.push(`comment_trigger has unknown fields: ${unknownCommentTriggerFields.join(", ")}`);
    }
  }

  const overallStatesRaw = commentTrigger.overall_states;
  const overallStates: string[] = [];
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
  const trendSeverities: string[] = [];
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
}

export function validateCommentTemplate(config: JsonObject, errors: string[]): void {
  const commentTemplate = asObject(config.comment_template) ?? {};
  if (!asObject(config.comment_template)) {
    errors.push("comment_template must be object");
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

    if (!isNonEmptyString(keyRaw)) {
      errors.push(`comment_template.fields[${index}].key must be non-empty string`);
    } else {
      const key = keyRaw.trim();
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
}
