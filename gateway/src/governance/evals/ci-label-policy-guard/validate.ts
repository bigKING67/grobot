import { type JsonObject } from "./types";
import { validateCommentTemplate, validateCommentTrigger } from "./validate-comment";
import { validateRootFields } from "./validate-common";
import { validatePolicyDrift } from "./validate-drift";
import { validateLabelRules } from "./validate-labels";

export function validateCiLabelPolicyConfig(config: JsonObject): string[] {
  const errors: string[] = [];
  const safeLabelRegex = validateRootFields(config, errors);
  validateCommentTrigger(config, errors);
  validateCommentTemplate(config, errors);
  const drift = validatePolicyDrift(config, safeLabelRegex, errors);
  validateLabelRules({
    config,
    safeLabelRegex,
    policyDriftLabelPrefix: drift.policyDriftLabelPrefix,
    policyDriftWorseningLabel: drift.policyDriftWorseningLabel,
    errors,
  });
  return errors;
}
