import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

type JsonObject = Record<string, unknown>;

const PLAN_EVENTS_POLICY_SCHEMA = "plan_events_policy";
const PLAN_EVENTS_POLICY_VERSION = 1;
const POLICY_OVERRIDE_ALLOW_ENV = "GROBOT_PLAN_EVENTS_POLICY_OVERRIDE_ALLOW";
const POLICY_OVERRIDE_DENY_ENV = "GROBOT_PLAN_EVENTS_POLICY_OVERRIDE_DENY";

const ALLOWED_POLICY_FIELDS = ["schema", "schema_version", "profile", "gates"] as const;
const ALLOWED_GATE_FIELDS = [
  "min_events_count",
  "min_sessions_count",
  "min_plan_mode_entered_count",
  "min_plan_created_count",
  "min_plan_progress_appended_count",
  "max_invalid_lines",
  "max_missing_files",
  "max_review_failed_rate",
  "max_guard_denied_rate",
  "max_idempotent_hit_rate",
  "max_stale_recovery_count",
] as const;
const ALLOWED_GATE_FIELD_SET = new Set<string>(ALLOWED_GATE_FIELDS as readonly string[]);
type PolicyGateField = (typeof ALLOWED_GATE_FIELDS)[number];

interface ParsedCliArgs {
  policyPath: string;
  reportPath: string;
  printJson: boolean;
}

interface LoadedPolicy {
  schema: string;
  schema_version: number;
  profile: string;
  gates: {
    min_events_count: number;
    min_sessions_count: number;
    min_plan_mode_entered_count: number;
    min_plan_created_count: number;
    min_plan_progress_appended_count: number;
    max_invalid_lines: number;
    max_missing_files: number;
    max_review_failed_rate: number | null;
    max_guard_denied_rate: number | null;
    max_idempotent_hit_rate: number | null;
    max_stale_recovery_count: number | null;
  };
}

interface PolicyEnvOverrideResult {
  policy: LoadedPolicy;
  overrides: JsonObject;
  scope: {
    allow_source: "default_all" | "env";
    allow_fields: PolicyGateField[];
    deny_source: "default_none" | "env";
    deny_fields: PolicyGateField[];
  };
}

interface PolicyOverrideScope {
  allow: Set<PolicyGateField> | null;
  deny: Set<PolicyGateField>;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArgs(argv: string[]): ParsedCliArgs {
  let policyPath = "";
  let reportPath = "";
  let printJson = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--policy") {
      policyPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--report") {
      reportPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--print-json") {
      printJson = true;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (!policyPath.trim()) {
    throw new Error("missing --policy");
  }
  if (!reportPath.trim()) {
    throw new Error("missing --report");
  }
  return {
    policyPath: resolvePath(policyPath.trim()),
    reportPath: resolvePath(reportPath.trim()),
    printJson,
  };
}

function readJsonObject(path: string): JsonObject {
  const raw = readFileSync(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error(`json root must be object: ${path}`);
  }
  return parsed;
}

function parseIntField(raw: unknown, fieldName: string, min = 0): number {
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new Error(`policy field ${fieldName} must be int`);
  }
  if (raw < min) {
    throw new Error(`policy field ${fieldName} must be >= ${String(min)}`);
  }
  return raw;
}

function parseOptionalRate(raw: unknown, fieldName: string): number | null {
  if (raw == null) {
    return null;
  }
  if (typeof raw !== "number") {
    throw new Error(`policy field ${fieldName} must be number or null`);
  }
  if (raw < 0 || raw > 1) {
    throw new Error(`policy field ${fieldName} must be within [0,1]`);
  }
  return Number(raw);
}

function parseOptionalInt(raw: unknown, fieldName: string): number | null {
  if (raw == null) {
    return null;
  }
  return parseIntField(raw, fieldName, 0);
}

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

function loadPolicy(path: string): LoadedPolicy {
  const payload = readJsonObject(path);
  const unknownFields = Object.keys(payload).filter((key) => !(ALLOWED_POLICY_FIELDS as readonly string[]).includes(key));
  if (unknownFields.length > 0) {
    throw new Error(`policy has unknown fields: ${unknownFields.sort().join(", ")}`);
  }
  const schema = payload.schema;
  if (schema !== PLAN_EVENTS_POLICY_SCHEMA) {
    throw new Error(`policy schema must be ${PLAN_EVENTS_POLICY_SCHEMA}`);
  }
  const schemaVersion = payload.schema_version;
  if (schemaVersion !== PLAN_EVENTS_POLICY_VERSION) {
    throw new Error(
      `unsupported policy schema_version: ${String(schemaVersion)} (supported=${String(PLAN_EVENTS_POLICY_VERSION)})`,
    );
  }
  const profileRaw = payload.profile;
  if (typeof profileRaw !== "string" || profileRaw.trim().length === 0) {
    throw new Error("policy profile must be non-empty string");
  }
  const gatesRaw = payload.gates;
  if (!isRecord(gatesRaw)) {
    throw new Error("policy gates must be object");
  }
  const unknownGateFields = Object.keys(gatesRaw).filter((key) => !(ALLOWED_GATE_FIELDS as readonly string[]).includes(key));
  if (unknownGateFields.length > 0) {
    throw new Error(`policy gates has unknown fields: ${unknownGateFields.sort().join(", ")}`);
  }
  return {
    schema: PLAN_EVENTS_POLICY_SCHEMA,
    schema_version: PLAN_EVENTS_POLICY_VERSION,
    profile: profileRaw.trim(),
    gates: {
      min_events_count: parseIntField(gatesRaw.min_events_count, "gates.min_events_count"),
      min_sessions_count: parseIntField(gatesRaw.min_sessions_count, "gates.min_sessions_count"),
      min_plan_mode_entered_count: parseIntField(
        gatesRaw.min_plan_mode_entered_count,
        "gates.min_plan_mode_entered_count",
      ),
      min_plan_created_count: parseIntField(gatesRaw.min_plan_created_count, "gates.min_plan_created_count"),
      min_plan_progress_appended_count: parseIntField(
        gatesRaw.min_plan_progress_appended_count,
        "gates.min_plan_progress_appended_count",
      ),
      max_invalid_lines: parseIntField(gatesRaw.max_invalid_lines, "gates.max_invalid_lines"),
      max_missing_files: parseIntField(gatesRaw.max_missing_files, "gates.max_missing_files"),
      max_review_failed_rate: parseOptionalRate(
        gatesRaw.max_review_failed_rate,
        "gates.max_review_failed_rate",
      ),
      max_guard_denied_rate: parseOptionalRate(gatesRaw.max_guard_denied_rate, "gates.max_guard_denied_rate"),
      max_idempotent_hit_rate: parseOptionalRate(
        gatesRaw.max_idempotent_hit_rate,
        "gates.max_idempotent_hit_rate",
      ),
      max_stale_recovery_count: parseOptionalInt(
        gatesRaw.max_stale_recovery_count,
        "gates.max_stale_recovery_count",
      ),
    },
  };
}

function applyPolicyEnvOverrides(policy: LoadedPolicy): PolicyEnvOverrideResult {
  const gates = { ...policy.gates };
  const overrides: JsonObject = {};
  const scope = resolvePolicyOverrideScope();
  assertOverrideScopeConsistency(scope);
  const allowFields = (scope.allow ? [...scope.allow] : [...ALLOWED_GATE_FIELDS]).sort();
  const denyFields = [...scope.deny].sort();

  const minEventsEnv = "GROBOT_PLAN_EVENTS_MIN_EVENTS_COUNT";
  const minEvents = parseEnvIntOverride(minEventsEnv, "gates.min_events_count");
  if (minEvents !== undefined) {
    assertOverrideAllowed(scope, "min_events_count", minEventsEnv);
    gates.min_events_count = minEvents;
    overrides.min_events_count = minEvents;
  }
  const minSessionsEnv = "GROBOT_PLAN_EVENTS_MIN_SESSIONS_COUNT";
  const minSessions = parseEnvIntOverride(minSessionsEnv, "gates.min_sessions_count");
  if (minSessions !== undefined) {
    assertOverrideAllowed(scope, "min_sessions_count", minSessionsEnv);
    gates.min_sessions_count = minSessions;
    overrides.min_sessions_count = minSessions;
  }
  const minModeEnteredEnv = "GROBOT_PLAN_EVENTS_MIN_PLAN_MODE_ENTERED_COUNT";
  const minModeEntered = parseEnvIntOverride(
    minModeEnteredEnv,
    "gates.min_plan_mode_entered_count",
  );
  if (minModeEntered !== undefined) {
    assertOverrideAllowed(scope, "min_plan_mode_entered_count", minModeEnteredEnv);
    gates.min_plan_mode_entered_count = minModeEntered;
    overrides.min_plan_mode_entered_count = minModeEntered;
  }
  const minPlanCreatedEnv = "GROBOT_PLAN_EVENTS_MIN_PLAN_CREATED_COUNT";
  const minPlanCreated = parseEnvIntOverride(
    minPlanCreatedEnv,
    "gates.min_plan_created_count",
  );
  if (minPlanCreated !== undefined) {
    assertOverrideAllowed(scope, "min_plan_created_count", minPlanCreatedEnv);
    gates.min_plan_created_count = minPlanCreated;
    overrides.min_plan_created_count = minPlanCreated;
  }
  const minPlanProgressAppendedEnv = "GROBOT_PLAN_EVENTS_MIN_PLAN_PROGRESS_APPENDED_COUNT";
  const minPlanProgressAppended = parseEnvIntOverride(
    minPlanProgressAppendedEnv,
    "gates.min_plan_progress_appended_count",
  );
  if (minPlanProgressAppended !== undefined) {
    assertOverrideAllowed(scope, "min_plan_progress_appended_count", minPlanProgressAppendedEnv);
    gates.min_plan_progress_appended_count = minPlanProgressAppended;
    overrides.min_plan_progress_appended_count = minPlanProgressAppended;
  }
  const maxInvalidLinesEnv = "GROBOT_PLAN_EVENTS_MAX_INVALID_LINES";
  const maxInvalidLines = parseEnvIntOverride(
    maxInvalidLinesEnv,
    "gates.max_invalid_lines",
  );
  if (maxInvalidLines !== undefined) {
    assertOverrideAllowed(scope, "max_invalid_lines", maxInvalidLinesEnv);
    gates.max_invalid_lines = maxInvalidLines;
    overrides.max_invalid_lines = maxInvalidLines;
  }
  const maxMissingFilesEnv = "GROBOT_PLAN_EVENTS_MAX_MISSING_FILES";
  const maxMissingFiles = parseEnvIntOverride(
    maxMissingFilesEnv,
    "gates.max_missing_files",
  );
  if (maxMissingFiles !== undefined) {
    assertOverrideAllowed(scope, "max_missing_files", maxMissingFilesEnv);
    gates.max_missing_files = maxMissingFiles;
    overrides.max_missing_files = maxMissingFiles;
  }
  const maxReviewFailedRateEnv = "GROBOT_PLAN_EVENTS_MAX_REVIEW_FAILED_RATE";
  const maxReviewFailedRate = parseEnvOptionalRateOverride(
    maxReviewFailedRateEnv,
    "gates.max_review_failed_rate",
  );
  if (maxReviewFailedRate !== undefined) {
    assertOverrideAllowed(scope, "max_review_failed_rate", maxReviewFailedRateEnv);
    gates.max_review_failed_rate = maxReviewFailedRate;
    overrides.max_review_failed_rate = maxReviewFailedRate;
  }
  const maxGuardDeniedRateEnv = "GROBOT_PLAN_EVENTS_MAX_GUARD_DENIED_RATE";
  const maxGuardDeniedRate = parseEnvOptionalRateOverride(
    maxGuardDeniedRateEnv,
    "gates.max_guard_denied_rate",
  );
  if (maxGuardDeniedRate !== undefined) {
    assertOverrideAllowed(scope, "max_guard_denied_rate", maxGuardDeniedRateEnv);
    gates.max_guard_denied_rate = maxGuardDeniedRate;
    overrides.max_guard_denied_rate = maxGuardDeniedRate;
  }
  const maxIdempotentHitRateEnv = "GROBOT_PLAN_EVENTS_MAX_IDEMPOTENT_HIT_RATE";
  const maxIdempotentHitRate = parseEnvOptionalRateOverride(
    maxIdempotentHitRateEnv,
    "gates.max_idempotent_hit_rate",
  );
  if (maxIdempotentHitRate !== undefined) {
    assertOverrideAllowed(scope, "max_idempotent_hit_rate", maxIdempotentHitRateEnv);
    gates.max_idempotent_hit_rate = maxIdempotentHitRate;
    overrides.max_idempotent_hit_rate = maxIdempotentHitRate;
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

function asNumber(record: JsonObject, key: string): number {
  const value = record[key];
  if (typeof value !== "number") {
    throw new Error(`report totals.${key} must be number`);
  }
  return value;
}

function asNumberOrNull(record: JsonObject, key: string): number | null {
  const value = record[key];
  if (value == null) {
    return null;
  }
  if (typeof value !== "number") {
    throw new Error(`report totals.${key} must be number|null`);
  }
  return value;
}

function evaluatePolicy(policy: LoadedPolicy, report: JsonObject): {
  status: "ok" | "error";
  profile: string;
  policy_schema: string;
  policy_schema_version: number;
  violations: string[];
  violations_count: number;
  metrics: JsonObject;
} {
  const totalsRaw = report.totals;
  if (!isRecord(totalsRaw)) {
    throw new Error("report.totals must be object");
  }
  const metrics = {
    events_count: asNumber(totalsRaw, "events_count"),
    sessions_count: asNumber(totalsRaw, "sessions_count"),
    plan_mode_entered_count: asNumber(totalsRaw, "plan_mode_entered_count"),
    plan_created_count: asNumber(totalsRaw, "plan_created_count"),
    plan_progress_appended_count: asNumber(totalsRaw, "plan_progress_appended_count"),
    plan_review_passed_count: asNumber(totalsRaw, "plan_review_passed_count"),
    plan_review_failed_count: asNumber(totalsRaw, "plan_review_failed_count"),
    invalid_lines: asNumber(totalsRaw, "invalid_lines"),
    missing_files_count: asNumber(totalsRaw, "missing_files_count"),
    review_failed_rate: asNumberOrNull(totalsRaw, "review_failed_rate"),
    guard_denied_rate: asNumberOrNull(totalsRaw, "guard_denied_rate"),
    idempotent_hit_rate: asNumberOrNull(totalsRaw, "idempotent_hit_rate"),
    plan_recovered_stale_approved_count: asNumber(totalsRaw, "plan_recovered_stale_approved_count"),
  };
  const violations: string[] = [];
  if (metrics.events_count < policy.gates.min_events_count) {
    violations.push(`events_count ${String(metrics.events_count)} < min_events_count ${String(policy.gates.min_events_count)}`);
  }
  if (metrics.sessions_count < policy.gates.min_sessions_count) {
    violations.push(`sessions_count ${String(metrics.sessions_count)} < min_sessions_count ${String(policy.gates.min_sessions_count)}`);
  }
  if (metrics.plan_mode_entered_count < policy.gates.min_plan_mode_entered_count) {
    violations.push(
      `plan_mode_entered_count ${String(metrics.plan_mode_entered_count)} < min_plan_mode_entered_count ${String(policy.gates.min_plan_mode_entered_count)}`,
    );
  }
  if (metrics.plan_created_count < policy.gates.min_plan_created_count) {
    violations.push(
      `plan_created_count ${String(metrics.plan_created_count)} < min_plan_created_count ${String(policy.gates.min_plan_created_count)}`,
    );
  }
  if (metrics.plan_progress_appended_count < policy.gates.min_plan_progress_appended_count) {
    violations.push(
      `plan_progress_appended_count ${String(metrics.plan_progress_appended_count)} < min_plan_progress_appended_count ${String(policy.gates.min_plan_progress_appended_count)}`,
    );
  }
  if (metrics.invalid_lines > policy.gates.max_invalid_lines) {
    violations.push(`invalid_lines ${String(metrics.invalid_lines)} > max_invalid_lines ${String(policy.gates.max_invalid_lines)}`);
  }
  if (metrics.missing_files_count > policy.gates.max_missing_files) {
    violations.push(
      `missing_files_count ${String(metrics.missing_files_count)} > max_missing_files ${String(policy.gates.max_missing_files)}`,
    );
  }
  if (
    policy.gates.max_review_failed_rate != null &&
    metrics.review_failed_rate != null &&
    metrics.review_failed_rate > policy.gates.max_review_failed_rate
  ) {
    violations.push(
      `review_failed_rate ${String(metrics.review_failed_rate)} > max_review_failed_rate ${String(policy.gates.max_review_failed_rate)}`,
    );
  }
  if (
    policy.gates.max_guard_denied_rate != null &&
    metrics.guard_denied_rate != null &&
    metrics.guard_denied_rate > policy.gates.max_guard_denied_rate
  ) {
    violations.push(
      `guard_denied_rate ${String(metrics.guard_denied_rate)} > max_guard_denied_rate ${String(policy.gates.max_guard_denied_rate)}`,
    );
  }
  if (
    policy.gates.max_idempotent_hit_rate != null &&
    metrics.idempotent_hit_rate != null &&
    metrics.idempotent_hit_rate > policy.gates.max_idempotent_hit_rate
  ) {
    violations.push(
      `idempotent_hit_rate ${String(metrics.idempotent_hit_rate)} > max_idempotent_hit_rate ${String(policy.gates.max_idempotent_hit_rate)}`,
    );
  }
  if (
    policy.gates.max_stale_recovery_count != null &&
    metrics.plan_recovered_stale_approved_count > policy.gates.max_stale_recovery_count
  ) {
    violations.push(
      `plan_recovered_stale_approved_count ${String(metrics.plan_recovered_stale_approved_count)} > max_stale_recovery_count ${String(policy.gates.max_stale_recovery_count)}`,
    );
  }
  return {
    status: violations.length === 0 ? "ok" : "error",
    profile: policy.profile,
    policy_schema: policy.schema,
    policy_schema_version: policy.schema_version,
    violations,
    violations_count: violations.length,
    metrics,
  };
}

function main(argv: string[]): number {
  const cli = parseArgs(argv);
  const policyLoaded = loadPolicy(cli.policyPath);
  const overrideResult = applyPolicyEnvOverrides(policyLoaded);
  const report = readJsonObject(cli.reportPath);
  const result = evaluatePolicy(overrideResult.policy, report);
  const output = {
    ...result,
    policy_overrides: overrideResult.overrides,
    policy_override_scope: overrideResult.scope,
  };
  if (cli.printJson) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } else {
    const overrideCount = Object.keys(overrideResult.overrides).length;
    const allowCount = overrideResult.scope.allow_fields.length;
    const denyCount = overrideResult.scope.deny_fields.length;
    process.stdout.write(
      `[plan-events-policy-guard] status=${result.status} violations=${String(result.violations_count)} overrides=${String(overrideCount)} allow=${String(allowCount)} deny=${String(denyCount)}\n`,
    );
  }
  return result.status === "ok" ? 0 : 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`plan-events-policy-guard failed: ${message}\n`);
  process.exitCode = 1;
}
