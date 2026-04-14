import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

type JsonObject = Record<string, unknown>;

const PLAN_EVENTS_POLICY_SCHEMA = "plan_events_policy";
const PLAN_EVENTS_POLICY_VERSION = 1;

const ALLOWED_POLICY_FIELDS = ["schema", "schema_version", "profile", "gates"] as const;
const ALLOWED_GATE_FIELDS = [
  "min_events_count",
  "min_sessions_count",
  "min_plan_mode_entered_count",
  "min_plan_created_count",
  "min_plan_progress_appended_count",
  "max_invalid_lines",
  "max_missing_files",
  "max_guard_denied_rate",
  "max_idempotent_hit_rate",
  "max_stale_recovery_count",
] as const;

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
    max_guard_denied_rate: number | null;
    max_idempotent_hit_rate: number | null;
    max_stale_recovery_count: number | null;
  };
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
    invalid_lines: asNumber(totalsRaw, "invalid_lines"),
    missing_files_count: asNumber(totalsRaw, "missing_files_count"),
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
  const policy = loadPolicy(cli.policyPath);
  const report = readJsonObject(cli.reportPath);
  const result = evaluatePolicy(policy, report);
  if (cli.printJson) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    process.stdout.write(`[plan-events-policy-guard] status=${result.status} violations=${String(result.violations_count)}\n`);
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
