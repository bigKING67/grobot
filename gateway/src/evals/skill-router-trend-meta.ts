import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const ZERO_SHA = "0000000000000000000000000000000000000000";

type JsonObject = Record<string, unknown>;

export interface SkillRouterTrendMetaInput {
  currentReport: JsonObject;
  baseReport: JsonObject;
  trendMode: unknown;
  trendReason: unknown;
  trendRequired: unknown;
  baselineAvailable: unknown;
  baseSha: unknown;
  currentPolicyBlob: unknown;
  basePolicyBlob: unknown;
  policyBlobMatch: unknown;
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized || normalized === ZERO_SHA) {
    return undefined;
  }
  return normalized;
}

function normalizeOptionalBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
}

function extractPolicyHash(report: JsonObject): string | undefined {
  const policyRaw = report.policy;
  if (typeof policyRaw === "object" && policyRaw !== null && !Array.isArray(policyRaw)) {
    const hash = normalizeOptionalText((policyRaw as JsonObject).hash);
    if (hash) {
      return hash;
    }
  }
  return normalizeOptionalText(report.policy_hash);
}

function asObject(value: unknown): JsonObject {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

export function loadReport(path: string): JsonObject {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const raw = readFileSync(path, "utf8");
    return asObject(JSON.parse(raw));
  } catch {
    return {};
  }
}

function dirname(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

export function saveReport(path: string, payload: JsonObject): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, undefined, 2)}\n`, "utf8");
}

export function buildSkillRouterTrendMeta(input: SkillRouterTrendMetaInput): JsonObject {
  const currentPolicyHash = extractPolicyHash(input.currentReport);
  const basePolicyHash = extractPolicyHash(input.baseReport);
  let policyHashMatch: boolean | undefined;
  if (currentPolicyHash && basePolicyHash) {
    policyHashMatch = currentPolicyHash === basePolicyHash;
  }
  const normalizedTrendMode = normalizeOptionalText(input.trendMode) ?? "gate_only";
  const normalizedTrendReason = normalizeOptionalText(input.trendReason) ?? "unknown";
  return {
    mode: normalizedTrendMode,
    reason: normalizedTrendReason,
    required: normalizeOptionalBool(input.trendRequired) === true,
    executed: normalizedTrendMode === "gate_and_trend",
    baseline_available: normalizeOptionalBool(input.baselineAvailable),
    base_sha: normalizeOptionalText(input.baseSha) ?? null,
    policy_blob_current: normalizeOptionalText(input.currentPolicyBlob) ?? null,
    policy_blob_base: normalizeOptionalText(input.basePolicyBlob) ?? null,
    policy_blob_match: normalizeOptionalBool(input.policyBlobMatch),
    policy_hash_current: currentPolicyHash ?? null,
    policy_hash_base: basePolicyHash ?? null,
    policy_hash_match: policyHashMatch ?? null,
  };
}
