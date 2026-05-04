import {
  ALLOWED_GATE_FIELDS,
  ALLOWED_GATE_FIELD_SET,
  POLICY_OVERRIDE_ALLOW_ENV,
  POLICY_OVERRIDE_DENY_ENV,
  type PolicyGateField,
} from "./constants";
import type { JsonObject, LoadedPolicy, PolicyEnvOverrideResult, PolicyOverrideScope } from "./types";

function normalizeEnvToken(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed;
}

function parseOverrideScopeEnv(envName: string): Set<PolicyGateField> | null {
  const token = normalizeEnvToken(process.env[envName]);
  if (token === undefined) {
    return null;
  }
  if (token === "*") {
    return new Set<PolicyGateField>(ALLOWED_GATE_FIELDS);
  }
  const parts = token
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (parts.length === 0) {
    throw new Error(`env ${envName} must contain comma-separated gate fields or *`);
  }
  const scope = new Set<PolicyGateField>();
  for (const item of parts) {
    if (!ALLOWED_GATE_FIELD_SET.has(item)) {
      const allowed = [...ALLOWED_GATE_FIELDS].join(", ");
      throw new Error(`env ${envName} has unknown gate field: ${item}; allowed=${allowed}`);
    }
    scope.add(item as PolicyGateField);
  }
  return scope;
}

function resolvePolicyOverrideScope(): PolicyOverrideScope {
  return {
    allow: parseOverrideScopeEnv(POLICY_OVERRIDE_ALLOW_ENV),
    deny: parseOverrideScopeEnv(POLICY_OVERRIDE_DENY_ENV) ?? new Set<PolicyGateField>(),
  };
}

function assertOverrideScopeConsistency(scope: PolicyOverrideScope): void {
  if (scope.allow === null) {
    return;
  }
  const overlap = [...scope.allow]
    .filter((field) => scope.deny.has(field))
    .sort();
  if (overlap.length === 0) {
    return;
  }
  throw new Error(
    `${POLICY_OVERRIDE_ALLOW_ENV} overlaps ${POLICY_OVERRIDE_DENY_ENV}: ${overlap.join(", ")}`,
  );
}

function assertOverrideAllowed(scope: PolicyOverrideScope, field: PolicyGateField, envName: string): void {
  if (scope.allow !== null && !scope.allow.has(field)) {
    const allowed = [...scope.allow].sort().join(", ");
    throw new Error(
      `env ${envName} override for ${field} denied by ${POLICY_OVERRIDE_ALLOW_ENV} allowlist (${allowed || "<empty>"})`,
    );
  }
  if (scope.deny.has(field)) {
    const denied = [...scope.deny].sort().join(", ");
    throw new Error(
      `env ${envName} override for ${field} denied by ${POLICY_OVERRIDE_DENY_ENV} denylist (${denied || "<empty>"})`,
    );
  }
}

function parseEnvIntOverride(envName: string, fieldName: string, min = 0): number | undefined {
  const token = normalizeEnvToken(process.env[envName]);
  if (token === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(token, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`env ${envName} must be integer for ${fieldName}`);
  }
  if (parsed < min) {
    throw new Error(`env ${envName} must be >= ${String(min)} for ${fieldName}`);
  }
  return parsed;
}

function parseEnvOptionalIntOverride(envName: string, fieldName: string, min = 0): number | null | undefined {
  const token = normalizeEnvToken(process.env[envName]);
  if (token === undefined) {
    return undefined;
  }
  const lowered = token.toLowerCase();
  if (lowered === "null" || lowered === "none" || lowered === "off") {
    return null;
  }
  const parsed = Number.parseInt(token, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`env ${envName} must be integer|null for ${fieldName}`);
  }
  if (parsed < min) {
    throw new Error(`env ${envName} must be >= ${String(min)} for ${fieldName}`);
  }
  return parsed;
}

function parseEnvOptionalRateOverride(envName: string, fieldName: string): number | null | undefined {
  const token = normalizeEnvToken(process.env[envName]);
  if (token === undefined) {
    return undefined;
  }
  const lowered = token.toLowerCase();
  if (lowered === "null" || lowered === "none" || lowered === "off") {
    return null;
  }
  const parsed = Number(token);
  if (!Number.isFinite(parsed)) {
    throw new Error(`env ${envName} must be number|null for ${fieldName}`);
  }
  if (parsed < 0 || parsed > 1) {
    throw new Error(`env ${envName} must be within [0,1] for ${fieldName}`);
  }
  return Number(parsed);
}

function applyIntOverride(input: {
  scope: PolicyOverrideScope;
  gates: LoadedPolicy["gates"];
  overrides: JsonObject;
  field: Extract<PolicyGateField, `min_${string}` | "max_invalid_lines" | "max_missing_files">;
  envName: string;
  fieldName: string;
}): void {
  const value = parseEnvIntOverride(input.envName, input.fieldName);
  if (value === undefined) {
    return;
  }
  assertOverrideAllowed(input.scope, input.field, input.envName);
  input.gates[input.field] = value;
  input.overrides[input.field] = value;
}

function applyOptionalRateOverride(input: {
  scope: PolicyOverrideScope;
  gates: LoadedPolicy["gates"];
  overrides: JsonObject;
  field: Extract<PolicyGateField, `max_${string}_rate`>;
  envName: string;
  fieldName: string;
}): void {
  const value = parseEnvOptionalRateOverride(input.envName, input.fieldName);
  if (value === undefined) {
    return;
  }
  assertOverrideAllowed(input.scope, input.field, input.envName);
  input.gates[input.field] = value;
  input.overrides[input.field] = value;
}

export function applyPolicyEnvOverrides(policy: LoadedPolicy): PolicyEnvOverrideResult {
  const gates = { ...policy.gates };
  const overrides: JsonObject = {};
  const scope = resolvePolicyOverrideScope();
  assertOverrideScopeConsistency(scope);
  const allowFields = (scope.allow ? [...scope.allow] : [...ALLOWED_GATE_FIELDS]).sort();
  const denyFields = [...scope.deny].sort();

  const intOverrides = [
    ["min_events_count", "GROBOT_PLAN_EVENTS_MIN_EVENTS_COUNT"],
    ["min_sessions_count", "GROBOT_PLAN_EVENTS_MIN_SESSIONS_COUNT"],
    ["min_plan_mode_entered_count", "GROBOT_PLAN_EVENTS_MIN_PLAN_MODE_ENTERED_COUNT"],
    ["min_plan_created_count", "GROBOT_PLAN_EVENTS_MIN_PLAN_CREATED_COUNT"],
    ["min_plan_progress_appended_count", "GROBOT_PLAN_EVENTS_MIN_PLAN_PROGRESS_APPENDED_COUNT"],
    ["max_invalid_lines", "GROBOT_PLAN_EVENTS_MAX_INVALID_LINES"],
    ["max_missing_files", "GROBOT_PLAN_EVENTS_MAX_MISSING_FILES"],
  ] as const;
  for (const [field, envName] of intOverrides) {
    applyIntOverride({
      scope,
      gates,
      overrides,
      field,
      envName,
      fieldName: `gates.${field}`,
    });
  }

  const optionalRateOverrides = [
    ["max_review_failed_rate", "GROBOT_PLAN_EVENTS_MAX_REVIEW_FAILED_RATE"],
    ["max_guard_denied_rate", "GROBOT_PLAN_EVENTS_MAX_GUARD_DENIED_RATE"],
    ["max_quality_guard_blocked_rate", "GROBOT_PLAN_EVENTS_MAX_QUALITY_GUARD_BLOCKED_RATE"],
    ["max_idempotent_hit_rate", "GROBOT_PLAN_EVENTS_MAX_IDEMPOTENT_HIT_RATE"],
    ["max_policy_fail_rate", "GROBOT_PLAN_EVENTS_MAX_POLICY_FAIL_RATE"],
    ["max_unknown_phase_rate", "GROBOT_PLAN_EVENTS_MAX_UNKNOWN_PHASE_RATE"],
  ] as const;
  for (const [field, envName] of optionalRateOverrides) {
    applyOptionalRateOverride({
      scope,
      gates,
      overrides,
      field,
      envName,
      fieldName: `gates.${field}`,
    });
  }

  const maxStaleRecoveryCountEnv = "GROBOT_PLAN_EVENTS_MAX_STALE_RECOVERY_COUNT";
  const maxStaleRecoveryCount = parseEnvOptionalIntOverride(
    maxStaleRecoveryCountEnv,
    "gates.max_stale_recovery_count",
  );
  if (maxStaleRecoveryCount !== undefined) {
    assertOverrideAllowed(scope, "max_stale_recovery_count", maxStaleRecoveryCountEnv);
    gates.max_stale_recovery_count = maxStaleRecoveryCount;
    overrides.max_stale_recovery_count = maxStaleRecoveryCount;
  }

  return {
    policy: {
      ...policy,
      gates,
    },
    overrides,
    scope: {
      allow_source: scope.allow === null ? "default_all" : "env",
      allow_fields: allowFields,
      deny_source: denyFields.length === 0 ? "default_none" : "env",
      deny_fields: denyFields,
    },
  };
}
