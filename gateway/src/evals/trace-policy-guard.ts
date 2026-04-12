import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

type JsonObject = Record<string, unknown>;

const TRACE_PIPELINE_POLICY_SCHEMA = "trace_pipeline_policy";
const TRACE_PIPELINE_POLICY_VERSION = 2;
const TRACE_PIPELINE_POLICY_MIN_SUPPORTED_VERSION = 1;
const TRACE_PIPELINE_POLICY_MAX_SUPPORTED_VERSION = 2;

const PATH_POLICY_FIELDS = [
  "sessions_dir",
  "trace_cases_output",
  "trace_runs_output",
  "clean_cases_output",
  "clean_runs_output",
  "clean_report_output",
  "whitelist_case_ids_file",
] as const;

const INT_POLICY_FIELDS = [
  "seed",
  "max_cases",
  "min_chars",
  "min_prompt_chars",
  "min_response_chars",
  "max_exact_duplicates_per_prompt",
  "max_near_duplicates_per_anchor",
  "min_cases_per_split",
  "min_clean_cases",
] as const;

const FLOAT_POLICY_FIELDS = ["holdout_ratio", "similarity_threshold"] as const;
const BOOL_POLICY_FIELDS = ["fail_on_low_sample", "fail_on_split_underflow"] as const;
const META_POLICY_FIELDS = ["schema", "schema_version", "profile"] as const;

const REQUIRED_FIELDS = [
  "schema",
  "schema_version",
  "profile",
  "sessions_dir",
  "trace_cases_output",
  "trace_runs_output",
  "variant",
  "holdout_ratio",
  "seed",
  "max_cases",
  "min_chars",
  "clean_cases_output",
  "clean_runs_output",
  "clean_report_output",
  "min_prompt_chars",
  "min_response_chars",
  "max_exact_duplicates_per_prompt",
  "similarity_threshold",
  "max_near_duplicates_per_anchor",
  "min_cases_per_split",
  "min_clean_cases",
  "fail_on_low_sample",
  "min_clean_cases_by_split",
  "fail_on_split_underflow",
] as const;

interface ParsedCliArgs {
  policies: string[];
  printJson: boolean;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function dirname(path: string): string {
  const normalized = normalizePath(path).replace(/[\\/]+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function removeTrailingSlashes(value: string): string {
  return normalizePath(value).replace(/[\\/]+$/, "");
}

function pathJoin(base: string, relative: string): string {
  const trimmedBase = removeTrailingSlashes(base);
  const trimmedRelative = normalizePath(relative).replace(/^[\\/]+/, "");
  return `${trimmedBase}/${trimmedRelative}`;
}

function isAbsolutePath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
}

function splitThresholdsFromString(raw: string): JsonObject {
  if (!raw.trim()) {
    return {};
  }
  const thresholds: JsonObject = {};
  const tokens = raw.split(",");
  for (const tokenRaw of tokens) {
    const token = tokenRaw.trim();
    if (!token) {
      continue;
    }
    const separator = token.indexOf(":");
    if (separator <= 0) {
      throw new Error(`invalid split threshold token: ${token}`);
    }
    const splitName = token.slice(0, separator).trim();
    if (!splitName) {
      throw new Error(`invalid split name in token: ${token}`);
    }
    const thresholdText = token.slice(separator + 1).trim();
    const threshold = Number.parseInt(thresholdText, 10);
    if (!Number.isInteger(threshold)) {
      throw new Error(`invalid split threshold value in token: ${token}`);
    }
    if (threshold < 0) {
      throw new Error("split thresholds must be >= 0");
    }
    thresholds[splitName] = threshold;
  }
  return thresholds;
}

function coerceSplitThresholds(value: unknown): JsonObject {
  if (value == null) {
    return {};
  }
  if (typeof value === "string") {
    return splitThresholdsFromString(value);
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("min_clean_cases_by_split must be string or object");
  }
  const thresholds: JsonObject = {};
  for (const [key, raw] of Object.entries(value)) {
    const split = String(key).trim();
    if (!split) {
      throw new Error("split threshold key must not be empty");
    }
    if (typeof raw !== "number" || !Number.isInteger(raw)) {
      throw new Error(`invalid split threshold for ${split}: ${String(raw)}`);
    }
    if (raw < 0) {
      throw new Error("split thresholds must be >= 0");
    }
    thresholds[split] = raw;
  }
  return thresholds;
}

function resolvePolicyPath(policyPath: string, raw: string): string {
  if (isAbsolutePath(raw)) {
    return normalizePath(raw);
  }
  return pathJoin(dirname(policyPath), raw);
}

function readJsonObject(path: string): JsonObject {
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`failed to read policy: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid policy json: ${path}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("policy must be a json object");
  }
  return parsed as JsonObject;
}

function migratePolicyV1ToV2(payload: JsonObject): JsonObject {
  const migrated: JsonObject = { ...payload };
  const profileRaw = migrated.profile;
  const profile = typeof profileRaw === "string" ? profileRaw.trim() : "";
  migrated.profile = profile || "custom";
  migrated.schema = TRACE_PIPELINE_POLICY_SCHEMA;
  migrated.schema_version = 2;
  return migrated;
}

function upgradePolicyPayload(payload: JsonObject): { upgraded: JsonObject; migrations: string[] } {
  const schemaRaw = payload.schema;
  if (typeof schemaRaw !== "string" || schemaRaw.trim().length === 0) {
    throw new Error("policy field schema must be non-empty string");
  }
  if (schemaRaw !== TRACE_PIPELINE_POLICY_SCHEMA) {
    throw new Error(`unsupported policy schema: ${schemaRaw}`);
  }
  const versionRaw = payload.schema_version;
  if (typeof versionRaw !== "number" || !Number.isInteger(versionRaw)) {
    throw new Error("policy field schema_version must be int");
  }
  if (versionRaw < TRACE_PIPELINE_POLICY_MIN_SUPPORTED_VERSION) {
    throw new Error(
      `policy schema_version too old: ${versionRaw} < ${TRACE_PIPELINE_POLICY_MIN_SUPPORTED_VERSION}`,
    );
  }
  if (versionRaw > TRACE_PIPELINE_POLICY_MAX_SUPPORTED_VERSION) {
    throw new Error(
      `policy schema_version too new: ${versionRaw} > ${TRACE_PIPELINE_POLICY_MAX_SUPPORTED_VERSION}`,
    );
  }

  let upgraded: JsonObject = { ...payload };
  const migrations: string[] = [];
  let currentVersion = versionRaw;
  while (currentVersion < TRACE_PIPELINE_POLICY_VERSION) {
    if (currentVersion === 1) {
      upgraded = migratePolicyV1ToV2(upgraded);
      migrations.push("1->2");
      currentVersion = 2;
      continue;
    }
    throw new Error(`missing migrator for schema_version ${String(currentVersion)}`);
  }
  return { upgraded, migrations };
}

export function loadTracePipelinePolicy(path: string): JsonObject {
  const payload = readJsonObject(path);
  const supported = new Set<string>([
    ...PATH_POLICY_FIELDS,
    ...INT_POLICY_FIELDS,
    ...FLOAT_POLICY_FIELDS,
    ...BOOL_POLICY_FIELDS,
    ...META_POLICY_FIELDS,
    "variant",
    "min_clean_cases_by_split",
  ]);
  const unknownFields = Object.keys(payload).filter((key) => !supported.has(key)).sort();
  if (unknownFields.length > 0) {
    throw new Error(`unknown policy fields: ${unknownFields.join(",")}`);
  }

  const { upgraded, migrations } = upgradePolicyPayload(payload);
  const normalized: JsonObject = {};

  for (const key of PATH_POLICY_FIELDS) {
    if (!(key in upgraded)) {
      continue;
    }
    const value = upgraded[key];
    if (key === "whitelist_case_ids_file" && value === null) {
      normalized[key] = null;
      continue;
    }
    if (typeof value !== "string") {
      throw new Error(`policy field ${key} must be string path`);
    }
    normalized[key] = resolvePolicyPath(path, value);
  }

  for (const key of INT_POLICY_FIELDS) {
    if (!(key in upgraded)) {
      continue;
    }
    const value = upgraded[key];
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new Error(`policy field ${key} must be int`);
    }
    normalized[key] = value;
  }

  for (const key of FLOAT_POLICY_FIELDS) {
    if (!(key in upgraded)) {
      continue;
    }
    const value = upgraded[key];
    if (typeof value !== "number") {
      throw new Error(`policy field ${key} must be number`);
    }
    normalized[key] = Number(value);
  }

  for (const key of BOOL_POLICY_FIELDS) {
    if (!(key in upgraded)) {
      continue;
    }
    const value = upgraded[key];
    if (typeof value !== "boolean") {
      throw new Error(`policy field ${key} must be bool`);
    }
    normalized[key] = value;
  }

  if ("variant" in upgraded) {
    const value = upgraded.variant;
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error("policy field variant must be non-empty string");
    }
    normalized.variant = value;
  }

  if ("min_clean_cases_by_split" in upgraded) {
    normalized.min_clean_cases_by_split = coerceSplitThresholds(upgraded.min_clean_cases_by_split);
  }

  if ("schema" in upgraded) {
    const value = upgraded.schema;
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error("policy field schema must be non-empty string");
    }
    normalized.schema = value;
  }

  if ("schema_version" in upgraded) {
    const value = upgraded.schema_version;
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new Error("policy field schema_version must be int");
    }
    if (value <= 0) {
      throw new Error("policy field schema_version must be > 0");
    }
    normalized.schema_version = value;
  }

  if ("profile" in upgraded) {
    const value = upgraded.profile;
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error("policy field profile must be non-empty string");
    }
    normalized.profile = value.trim();
  }

  if (migrations.length > 0) {
    normalized.migrations = migrations;
  }
  return normalized;
}

function toPortablePath(policyPath: string, value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const base = removeTrailingSlashes(dirname(policyPath));
  const normalized = normalizePath(value);
  if (normalized === base) {
    return ".";
  }
  if (normalized.startsWith(`${base}/`)) {
    return normalized.slice(base.length + 1);
  }
  return normalized;
}

function canonicalizeForHash(policyPath: string, config: JsonObject): JsonObject {
  const canonical: JsonObject = {};
  const keys = Object.keys(config).sort();
  for (const key of keys) {
    if (key === "migrations") {
      continue;
    }
    const value = config[key];
    if ((PATH_POLICY_FIELDS as readonly string[]).includes(key)) {
      if (value === null) {
        canonical[key] = null;
      } else if (typeof value === "string") {
        canonical[key] = toPortablePath(policyPath, value);
      } else {
        throw new Error(`policy field ${key} must be resolved Path before hashing`);
      }
      continue;
    }
    if (key === "min_clean_cases_by_split") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("policy field min_clean_cases_by_split must be object before hashing");
      }
      const sorted: JsonObject = {};
      for (const splitKey of Object.keys(value).sort()) {
        sorted[splitKey] = Number((value as JsonObject)[splitKey]);
      }
      canonical[key] = sorted;
      continue;
    }
    canonical[key] = value;
  }
  return canonical;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (typeof value === "object" && value !== null) {
    const sorted: JsonObject = {};
    for (const key of Object.keys(value as JsonObject).sort()) {
      sorted[key] = sortJson((value as JsonObject)[key]);
    }
    return sorted;
  }
  return value;
}

export function computeTracePipelinePolicyFingerprint(path: string): {
  policyHash: string;
  canonical: JsonObject;
} {
  const config = loadTracePipelinePolicy(path);
  const canonical = canonicalizeForHash(path, config);
  const encoded = JSON.stringify(sortJson(canonical));
  const digest = createHash("sha256").update(encoded).digest("hex");
  return { policyHash: `sha256:${digest}`, canonical };
}

export function validateTracePolicyConfig(config: JsonObject): string[] {
  const errors: string[] = [];
  for (const key of REQUIRED_FIELDS) {
    if (!(key in config)) {
      errors.push(`missing required field: ${key}`);
    }
  }
  const schemaRaw = config.schema;
  if (typeof schemaRaw !== "string" || schemaRaw.trim().length === 0) {
    errors.push("schema must be non-empty string");
  } else if (schemaRaw !== TRACE_PIPELINE_POLICY_SCHEMA) {
    errors.push(`unsupported schema: ${schemaRaw} (expected ${TRACE_PIPELINE_POLICY_SCHEMA})`);
  }
  const profileRaw = config.profile;
  if (typeof profileRaw !== "string" || profileRaw.trim().length === 0) {
    errors.push("profile must be non-empty string");
  }
  const schemaVersionRaw = config.schema_version;
  if (typeof schemaVersionRaw !== "number" || !Number.isInteger(schemaVersionRaw)) {
    errors.push("schema_version must be int");
  } else if (
    schemaVersionRaw < TRACE_PIPELINE_POLICY_MIN_SUPPORTED_VERSION ||
    schemaVersionRaw > TRACE_PIPELINE_POLICY_MAX_SUPPORTED_VERSION
  ) {
    errors.push(
      `unsupported schema_version: ${schemaVersionRaw} (supported ${TRACE_PIPELINE_POLICY_MIN_SUPPORTED_VERSION}-${TRACE_PIPELINE_POLICY_MAX_SUPPORTED_VERSION})`,
    );
  }
  const failOnLowSample = config.fail_on_low_sample === true;
  const minCleanCases = typeof config.min_clean_cases === "number" && Number.isInteger(config.min_clean_cases) ? config.min_clean_cases : -1;
  if (minCleanCases < 0) {
    errors.push("min_clean_cases must be >= 0");
  }
  if (failOnLowSample && minCleanCases <= 0) {
    errors.push("fail_on_low_sample=true requires min_clean_cases > 0");
  }
  const minCasesPerSplit = config.min_cases_per_split;
  if (typeof minCasesPerSplit === "number" && Number.isInteger(minCasesPerSplit)) {
    if (minCasesPerSplit < 0) {
      errors.push("min_cases_per_split must be >= 0");
    }
  } else {
    errors.push("min_cases_per_split must be int");
  }
  const rawSplitThresholds = config.min_clean_cases_by_split;
  let splitThresholds: JsonObject = {};
  if (typeof rawSplitThresholds !== "object" || rawSplitThresholds === null || Array.isArray(rawSplitThresholds)) {
    errors.push("min_clean_cases_by_split must be object");
  } else {
    for (const [splitNameRaw, value] of Object.entries(rawSplitThresholds)) {
      const splitName = String(splitNameRaw).trim();
      if (!splitName) {
        errors.push("split threshold key must not be empty");
        continue;
      }
      if (typeof value !== "number" || !Number.isInteger(value)) {
        errors.push(`split threshold for ${splitName} must be int`);
        continue;
      }
      if (value <= 0) {
        errors.push(`split threshold for ${splitName} must be > 0`);
        continue;
      }
      splitThresholds[splitName] = value;
    }
  }
  const failOnSplitUnderflow = config.fail_on_split_underflow === true;
  if (failOnSplitUnderflow && Object.keys(splitThresholds).length === 0) {
    errors.push("fail_on_split_underflow=true requires non-empty min_clean_cases_by_split");
  }
  return errors;
}

export function buildTracePolicyResult(policyPath: string, includeDetails: boolean): JsonObject {
  let config: JsonObject | undefined;
  let errors: string[] = [];
  try {
    config = loadTracePipelinePolicy(policyPath);
    errors = validateTracePolicyConfig(config);
  } catch (error) {
    errors = [String(error)];
  }
  const result: JsonObject = {
    policy: policyPath,
    ok: errors.length === 0,
    errors,
  };
  if (!config) {
    return result;
  }
  try {
    const { policyHash, canonical } = computeTracePipelinePolicyFingerprint(policyPath);
    result.policy_hash = policyHash;
    if (includeDetails) {
      result.normalized_keys = Object.keys(config).sort();
      result.canonical_policy = canonical;
    }
  } catch (error) {
    result.ok = false;
    (result.errors as unknown as string[]).push(String(error));
  }
  return result;
}

function parseArgs(argv: string[]): ParsedCliArgs {
  const policies: string[] = [];
  let printJson = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--policy") {
      const value = argv[index + 1] ?? "";
      if (value.trim().length > 0) {
        policies.push(value.trim());
      }
      index += 1;
      continue;
    }
    if (token === "--print-json") {
      printJson = true;
      continue;
    }
  }
  if (policies.length === 0) {
    throw new Error("missing required args: --policy");
  }
  return { policies, printJson };
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const results: JsonObject[] = [];
  let hasError = false;
  for (const policyPath of args.policies) {
    const result = buildTracePolicyResult(policyPath, args.printJson);
    if (result.ok !== true) {
      hasError = true;
    }
    results.push(result);
  }
  const output = { policies: results };
  if (args.printJson) {
    process.stdout.write(`${JSON.stringify(output, undefined, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
  return hasError ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`trace-policy-guard fatal: ${String(error)}\n`);
  process.exitCode = 1;
}
