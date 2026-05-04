import {
  ALLOWED_GATE_FIELDS,
  ALLOWED_POLICY_FIELDS,
  PLAN_EVENTS_POLICY_SCHEMA,
  PLAN_EVENTS_POLICY_VERSION,
} from "./constants";
import {
  isRecord,
  parseIntField,
  parseOptionalInt,
  parseOptionalRate,
  readJsonObject,
} from "./json";
import type { LoadedPolicy } from "./types";

export function loadPolicy(path: string): LoadedPolicy {
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
      max_quality_guard_blocked_rate: parseOptionalRate(
        gatesRaw.max_quality_guard_blocked_rate,
        "gates.max_quality_guard_blocked_rate",
      ),
      max_idempotent_hit_rate: parseOptionalRate(
        gatesRaw.max_idempotent_hit_rate,
        "gates.max_idempotent_hit_rate",
      ),
      max_policy_fail_rate: parseOptionalRate(
        gatesRaw.max_policy_fail_rate,
        "gates.max_policy_fail_rate",
      ),
      max_unknown_phase_rate: parseOptionalRate(
        gatesRaw.max_unknown_phase_rate,
        "gates.max_unknown_phase_rate",
      ),
      max_stale_recovery_count: parseOptionalInt(
        gatesRaw.max_stale_recovery_count,
        "gates.max_stale_recovery_count",
      ),
    },
  };
}
