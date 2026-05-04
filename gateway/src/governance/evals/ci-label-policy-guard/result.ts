import { computeCiLabelPolicyFingerprint, loadCiLabelPolicy } from "./policy";
import { type JsonObject } from "./types";
import { validateCiLabelPolicyConfig } from "./validate";

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
