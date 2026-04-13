import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

type JsonObject = Record<string, unknown>;

export type PromotionState =
  | "draft"
  | "evaluated"
  | "shadow_passed"
  | "ready_for_manual_promotion"
  | "promoted"
  | "rolled_back"
  | "rejected";

export interface VariantSnapshot {
  variant: string;
  gate_passed: boolean;
  optimization_avg: number;
  optimization_pass_rate: number;
  holdout_avg: number;
  holdout_pass_rate: number;
  reward_v1_composite: number;
}

export interface ExperimentLedgerRecord {
  record_id: string;
  record_type: "auto_loop_run" | "promotion_transition";
  created_at: string;
  run_id: string;
  parent_run_id: string | null;
  proposal_id: string | null;
  baseline_variant: string | null;
  selected_variant: string | null;
  reward_version: "reward_v1";
  policy_hash: string | null;
  decision: string;
  promotion_state: PromotionState;
  rollback_triggered: boolean;
  notes: string | null;
  evidence_refs: string[];
  variant_snapshots: VariantSnapshot[];
}

function dirname(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function asObject(value: unknown): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be string`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must be non-empty string`);
  }
  return normalized;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be boolean`);
  }
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be finite number`);
  }
  return value;
}

function asStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be string list`);
  }
  const output: string[] = [];
  value.forEach((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`${field}[${index}] must be string`);
    }
    const normalized = item.trim();
    if (normalized.length > 0) {
      output.push(normalized);
    }
  });
  return output;
}

function parsePromotionState(value: unknown): PromotionState {
  const normalized = asString(value, "promotion_state");
  const allowed: PromotionState[] = [
    "draft",
    "evaluated",
    "shadow_passed",
    "ready_for_manual_promotion",
    "promoted",
    "rolled_back",
    "rejected",
  ];
  if (!allowed.includes(normalized as PromotionState)) {
    throw new Error(`promotion_state must be one of: ${allowed.join(", ")}`);
  }
  return normalized as PromotionState;
}

function parseVariantSnapshot(value: unknown, field: string): VariantSnapshot {
  const payload = asObject(value);
  if (payload == null) {
    throw new Error(`${field} must be object`);
  }
  return {
    variant: asString(payload.variant, `${field}.variant`),
    gate_passed: asBoolean(payload.gate_passed, `${field}.gate_passed`),
    optimization_avg: asNumber(payload.optimization_avg, `${field}.optimization_avg`),
    optimization_pass_rate: asNumber(payload.optimization_pass_rate, `${field}.optimization_pass_rate`),
    holdout_avg: asNumber(payload.holdout_avg, `${field}.holdout_avg`),
    holdout_pass_rate: asNumber(payload.holdout_pass_rate, `${field}.holdout_pass_rate`),
    reward_v1_composite: asNumber(payload.reward_v1_composite, `${field}.reward_v1_composite`),
  };
}

function parseExperimentLedgerRecord(value: unknown, sourceLabel: string): ExperimentLedgerRecord {
  const payload = asObject(value);
  if (payload == null) {
    throw new Error(`${sourceLabel}: row must be object`);
  }
  const recordType = asString(payload.record_type, `${sourceLabel}.record_type`);
  if (recordType !== "auto_loop_run" && recordType !== "promotion_transition") {
    throw new Error(`${sourceLabel}.record_type must be auto_loop_run or promotion_transition`);
  }
  const snapshotsRaw = payload.variant_snapshots;
  if (!Array.isArray(snapshotsRaw)) {
    throw new Error(`${sourceLabel}.variant_snapshots must be array`);
  }
  const snapshots = snapshotsRaw.map((item, index) =>
    parseVariantSnapshot(item, `${sourceLabel}.variant_snapshots[${index}]`)
  );
  return {
    record_id: asString(payload.record_id, `${sourceLabel}.record_id`),
    record_type: recordType,
    created_at: asString(payload.created_at, `${sourceLabel}.created_at`),
    run_id: asString(payload.run_id, `${sourceLabel}.run_id`),
    parent_run_id: asNullableString(payload.parent_run_id),
    proposal_id: asNullableString(payload.proposal_id),
    baseline_variant: asNullableString(payload.baseline_variant),
    selected_variant: asNullableString(payload.selected_variant),
    reward_version: "reward_v1",
    policy_hash: asNullableString(payload.policy_hash),
    decision: asString(payload.decision, `${sourceLabel}.decision`),
    promotion_state: parsePromotionState(payload.promotion_state),
    rollback_triggered: asBoolean(payload.rollback_triggered, `${sourceLabel}.rollback_triggered`),
    notes: asNullableString(payload.notes),
    evidence_refs: asStringList(payload.evidence_refs, `${sourceLabel}.evidence_refs`),
    variant_snapshots: snapshots,
  };
}

export function newRecordId(prefix: string): string {
  const now = Date.now();
  const random = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  return `${prefix}-${now}-${random}`;
}

export function loadExperimentLedger(path: string): ExperimentLedgerRecord[] {
  if (!existsSync(path)) {
    return [];
  }
  const raw = readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/);
  const records: ExperimentLedgerRecord[] = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`${path}:${index + 1}: invalid JSON: ${String(error)}`);
    }
    records.push(parseExperimentLedgerRecord(parsed, `${path}:${index + 1}`));
  });
  return records;
}

export function appendExperimentLedgerRecord(path: string, record: ExperimentLedgerRecord): void {
  const records = loadExperimentLedger(path);
  if (records.some((item) => item.record_id === record.record_id)) {
    throw new Error(`duplicate record_id detected in ledger: ${record.record_id}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  const serialized = JSON.stringify(record);
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  const suffix = previous.length > 0 && !previous.endsWith("\n") ? "\n" : "";
  writeFileSync(path, `${previous}${suffix}${serialized}\n`, "utf8");
}

export function findLatestRecordByProposal(
  records: ExperimentLedgerRecord[],
  proposalId: string
): ExperimentLedgerRecord | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const item = records[index];
    if (item.proposal_id === proposalId) {
      return item;
    }
  }
  return null;
}
