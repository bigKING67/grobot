import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve as resolvePath } from "node:path";

type JsonObject = Record<string, unknown>;

const SKILL_ROUTER_POLICY_SCHEMA = "skill_router_eval_policy";
const SKILL_ROUTER_POLICY_VERSION = 1;

const SKILL_ROUTER_POLICY_ALLOWED_FIELDS = [
  "schema",
  "schema_version",
  "profile",
  "cases",
  "global_skills_dir",
  "project_skills_dir",
  "project_toml",
  "router_overrides",
  "gates",
] as const;

const SKILL_ROUTER_POLICY_ROUTER_OVERRIDE_FIELDS = [
  "score_threshold",
  "min_score_gap",
  "max_descriptors",
  "descriptor_scan_lines",
] as const;

const SKILL_ROUTER_POLICY_GATES_FIELDS = [
  "min_accuracy",
  "max_forbidden_violations",
  "max_accuracy_drop",
  "max_forbidden_increase",
] as const;

const REQUIRED_FIELDS = [
  "schema",
  "schema_version",
  "profile",
  "cases",
  "global_skills_dir",
  "project_skills_dir",
  "router_overrides",
  "gates",
] as const;

const REQUIRED_GATE_FIELDS = [
  "min_accuracy",
  "max_forbidden_violations",
  "max_accuracy_drop",
  "max_forbidden_increase",
] as const;

interface ParsedCliArgs {
  policies: string[];
  printJson: boolean;
}

interface LoadedPolicy {
  schema: string;
  schema_version: number;
  profile: string;
  cases: string;
  global_skills_dir: string;
  project_skills_dir: string;
  project_toml: string | null;
  router_overrides: JsonObject;
  gates: JsonObject;
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

function resolvePolicyPath(baseDir: string, rawValue: unknown, fieldName: string): string {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    throw new Error(`policy field ${fieldName} must be non-empty string`);
  }
  const candidate = rawValue.trim();
  if (isAbsolutePath(candidate)) {
    return normalizePath(resolvePath(candidate));
  }
  return normalizePath(resolvePath(baseDir, candidate));
}

function resolveFromCwd(path: string): string {
  return normalizePath(resolvePath(path));
}

function readJsonObject(path: string): JsonObject {
  const raw = readFileSync(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("policy must be a JSON object");
  }
  return parsed as JsonObject;
}

function parseRouterOverrideFloat(rawValue: unknown, fieldName: string): number | null {
  if (rawValue == null) {
    return null;
  }
  if (typeof rawValue !== "number") {
    throw new Error(`policy router_overrides.${fieldName} must be number`);
  }
  if (rawValue < 0) {
    throw new Error(`policy router_overrides.${fieldName} must be >= 0`);
  }
  return Number(rawValue);
}

function parseRouterOverrideInt(rawValue: unknown, fieldName: string): number | null {
  if (rawValue == null) {
    return null;
  }
  if (typeof rawValue !== "number" || !Number.isInteger(rawValue)) {
    throw new Error(`policy router_overrides.${fieldName} must be int`);
  }
  if (rawValue <= 0) {
    throw new Error(`policy router_overrides.${fieldName} must be > 0`);
  }
  return rawValue;
}

function parseGateAccuracy(rawValue: unknown): number | null {
  if (rawValue == null) {
    return null;
  }
  if (typeof rawValue !== "number") {
    throw new Error("policy gates.min_accuracy must be number");
  }
  if (rawValue < 0 || rawValue > 1) {
    throw new Error("policy gates.min_accuracy must be within [0, 1]");
  }
  return Number(rawValue);
}

function parseGateForbidden(rawValue: unknown, fieldName: string): number | null {
  if (rawValue == null) {
    return null;
  }
  if (typeof rawValue !== "number" || !Number.isInteger(rawValue)) {
    throw new Error(`policy gates.${fieldName} must be int`);
  }
  if (rawValue < 0) {
    throw new Error(`policy gates.${fieldName} must be >= 0`);
  }
  return rawValue;
}

function parseGateAccuracyDrop(rawValue: unknown): number | null {
  if (rawValue == null) {
    return null;
  }
  if (typeof rawValue !== "number") {
    throw new Error("policy gates.max_accuracy_drop must be number");
  }
  if (rawValue < 0 || rawValue > 1) {
    throw new Error("policy gates.max_accuracy_drop must be within [0, 1]");
  }
  return Number(rawValue);
}

export function loadSkillRouterEvalPolicy(path: string): LoadedPolicy {
  const resolvedPath = resolveFromCwd(path);
  const payload = readJsonObject(resolvedPath);
  const unknownFields = Object.keys(payload).filter(
    (key) => !(SKILL_ROUTER_POLICY_ALLOWED_FIELDS as readonly string[]).includes(key),
  );
  if (unknownFields.length > 0) {
    throw new Error(`policy contains unknown fields: ${unknownFields.sort().join(", ")}`);
  }
  const schema = payload.schema;
  if (schema !== SKILL_ROUTER_POLICY_SCHEMA) {
    throw new Error(`policy schema must be ${SKILL_ROUTER_POLICY_SCHEMA}`);
  }
  const schemaVersion = payload.schema_version;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    throw new Error("policy schema_version must be int");
  }
  if (schemaVersion !== SKILL_ROUTER_POLICY_VERSION) {
    throw new Error(
      `unsupported policy schema_version: ${schemaVersion} (supported=${SKILL_ROUTER_POLICY_VERSION})`,
    );
  }
  const profileRaw = payload.profile;
  if (typeof profileRaw !== "string" || profileRaw.trim().length === 0) {
    throw new Error("policy profile must be non-empty string");
  }
  const baseDir = dirname(resolvedPath);
  const cases = resolvePolicyPath(baseDir, payload.cases, "cases");
  const globalSkillsDir = resolvePolicyPath(baseDir, payload.global_skills_dir, "global_skills_dir");
  const projectSkillsDir = resolvePolicyPath(baseDir, payload.project_skills_dir, "project_skills_dir");

  const projectTomlRaw = payload.project_toml;
  let projectToml: string | null = null;
  if (projectTomlRaw != null) {
    projectToml = resolvePolicyPath(baseDir, projectTomlRaw, "project_toml");
  }

  const routerOverridesRaw = payload.router_overrides;
  const routerOverrides =
    typeof routerOverridesRaw === "object" && routerOverridesRaw !== null && !Array.isArray(routerOverridesRaw)
      ? (routerOverridesRaw as JsonObject)
      : {};
  const unknownRouterFields = Object.keys(routerOverrides).filter(
    (key) => !(SKILL_ROUTER_POLICY_ROUTER_OVERRIDE_FIELDS as readonly string[]).includes(key),
  );
  if (unknownRouterFields.length > 0) {
    throw new Error(
      `policy router_overrides contains unknown fields: ${unknownRouterFields.sort().join(", ")}`,
    );
  }
  const scoreThreshold = parseRouterOverrideFloat(routerOverrides.score_threshold, "score_threshold");
  const minScoreGap = parseRouterOverrideFloat(routerOverrides.min_score_gap, "min_score_gap");
  const maxDescriptors = parseRouterOverrideInt(routerOverrides.max_descriptors, "max_descriptors");
  const descriptorScanLines = parseRouterOverrideInt(
    routerOverrides.descriptor_scan_lines,
    "descriptor_scan_lines",
  );

  const gatesRaw = payload.gates;
  const gates =
    typeof gatesRaw === "object" && gatesRaw !== null && !Array.isArray(gatesRaw)
      ? (gatesRaw as JsonObject)
      : {};
  const unknownGateFields = Object.keys(gates).filter(
    (key) => !(SKILL_ROUTER_POLICY_GATES_FIELDS as readonly string[]).includes(key),
  );
  if (unknownGateFields.length > 0) {
    throw new Error(`policy gates contains unknown fields: ${unknownGateFields.sort().join(", ")}`);
  }
  const minAccuracy = parseGateAccuracy(gates.min_accuracy);
  const maxForbiddenViolations = parseGateForbidden(
    gates.max_forbidden_violations,
    "max_forbidden_violations",
  );
  const maxAccuracyDrop = parseGateAccuracyDrop(gates.max_accuracy_drop);
  const maxForbiddenIncrease = parseGateForbidden(
    gates.max_forbidden_increase,
    "max_forbidden_increase",
  );

  const normalizedRouterOverrides: JsonObject = {};
  if (scoreThreshold !== null) {
    normalizedRouterOverrides.score_threshold = scoreThreshold;
  }
  if (minScoreGap !== null) {
    normalizedRouterOverrides.min_score_gap = minScoreGap;
  }
  if (maxDescriptors !== null) {
    normalizedRouterOverrides.max_descriptors = maxDescriptors;
  }
  if (descriptorScanLines !== null) {
    normalizedRouterOverrides.descriptor_scan_lines = descriptorScanLines;
  }

  const normalizedGates: JsonObject = {};
  if (minAccuracy !== null) {
    normalizedGates.min_accuracy = minAccuracy;
  }
  if (maxForbiddenViolations !== null) {
    normalizedGates.max_forbidden_violations = maxForbiddenViolations;
  }
  if (maxAccuracyDrop !== null) {
    normalizedGates.max_accuracy_drop = maxAccuracyDrop;
  }
  if (maxForbiddenIncrease !== null) {
    normalizedGates.max_forbidden_increase = maxForbiddenIncrease;
  }

  return {
    schema: SKILL_ROUTER_POLICY_SCHEMA,
    schema_version: schemaVersion,
    profile: profileRaw.trim(),
    cases,
    global_skills_dir: globalSkillsDir,
    project_skills_dir: projectSkillsDir,
    project_toml: projectToml,
    router_overrides: normalizedRouterOverrides,
    gates: normalizedGates,
  };
}

function canonicalizePolicy(policy: LoadedPolicy): JsonObject {
  return {
    schema: policy.schema,
    schema_version: policy.schema_version,
    profile: policy.profile,
    cases: policy.cases,
    global_skills_dir: policy.global_skills_dir,
    project_skills_dir: policy.project_skills_dir,
    project_toml: policy.project_toml,
    router_overrides: policy.router_overrides,
    gates: policy.gates,
  };
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

export function computeSkillRouterPolicyFingerprint(path: string): {
  policyHash: string;
  canonical: JsonObject;
} {
  const policy = loadSkillRouterEvalPolicy(path);
  const canonical = canonicalizePolicy(policy);
  const canonicalJson = JSON.stringify(sortJson(canonical));
  const digest = createHash("sha256").update(canonicalJson).digest("hex");
  return {
    policyHash: `sha256:${digest}`,
    canonical,
  };
}

export function validateSkillRouterPolicyConfig(config: JsonObject): string[] {
  const errors: string[] = [];
  for (const key of REQUIRED_FIELDS) {
    if (!(key in config)) {
      errors.push(`missing required field: ${key}`);
    }
  }
  const schemaRaw = config.schema;
  if (typeof schemaRaw !== "string" || schemaRaw.trim().length === 0) {
    errors.push("schema must be non-empty string");
  } else if (schemaRaw !== SKILL_ROUTER_POLICY_SCHEMA) {
    errors.push(`unsupported schema: ${schemaRaw} (expected ${SKILL_ROUTER_POLICY_SCHEMA})`);
  }
  const profileRaw = config.profile;
  if (typeof profileRaw !== "string" || profileRaw.trim().length === 0) {
    errors.push("profile must be non-empty string");
  }
  const schemaVersionRaw = config.schema_version;
  if (typeof schemaVersionRaw !== "number" || !Number.isInteger(schemaVersionRaw)) {
    errors.push("schema_version must be int");
  } else if (schemaVersionRaw !== SKILL_ROUTER_POLICY_VERSION) {
    errors.push(
      `unsupported schema_version: ${schemaVersionRaw} (expected ${SKILL_ROUTER_POLICY_VERSION})`,
    );
  }
  for (const pathKey of ["cases", "global_skills_dir", "project_skills_dir"] as const) {
    const value = config[pathKey];
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push(`${pathKey} must be non-empty string`);
    }
  }
  const routerOverridesRaw = config.router_overrides;
  const routerOverrides =
    typeof routerOverridesRaw === "object" && routerOverridesRaw !== null && !Array.isArray(routerOverridesRaw)
      ? (routerOverridesRaw as JsonObject)
      : {};
  if (routerOverridesRaw == null || typeof routerOverridesRaw !== "object" || Array.isArray(routerOverridesRaw)) {
    errors.push("router_overrides must be object");
  }
  for (const key of SKILL_ROUTER_POLICY_ROUTER_OVERRIDE_FIELDS) {
    if (!(key in routerOverrides)) {
      errors.push(`router_overrides missing field: ${key}`);
    }
  }
  const scoreThreshold = routerOverrides.score_threshold;
  if (typeof scoreThreshold !== "number") {
    errors.push("router_overrides.score_threshold must be number");
  } else if (scoreThreshold < 0) {
    errors.push("router_overrides.score_threshold must be >= 0");
  }
  const minScoreGap = routerOverrides.min_score_gap;
  if (typeof minScoreGap !== "number") {
    errors.push("router_overrides.min_score_gap must be number");
  } else if (minScoreGap < 0) {
    errors.push("router_overrides.min_score_gap must be >= 0");
  }
  const maxDescriptors = routerOverrides.max_descriptors;
  if (typeof maxDescriptors !== "number" || !Number.isInteger(maxDescriptors)) {
    errors.push("router_overrides.max_descriptors must be int");
  } else if (maxDescriptors <= 0) {
    errors.push("router_overrides.max_descriptors must be > 0");
  }
  const descriptorScanLines = routerOverrides.descriptor_scan_lines;
  if (typeof descriptorScanLines !== "number" || !Number.isInteger(descriptorScanLines)) {
    errors.push("router_overrides.descriptor_scan_lines must be int");
  } else if (descriptorScanLines <= 0) {
    errors.push("router_overrides.descriptor_scan_lines must be > 0");
  }
  const gatesRaw = config.gates;
  const gates =
    typeof gatesRaw === "object" && gatesRaw !== null && !Array.isArray(gatesRaw)
      ? (gatesRaw as JsonObject)
      : {};
  if (gatesRaw == null || typeof gatesRaw !== "object" || Array.isArray(gatesRaw)) {
    errors.push("gates must be object");
  }
  for (const key of REQUIRED_GATE_FIELDS) {
    if (!(key in gates)) {
      errors.push(`gates missing field: ${key}`);
    }
  }
  const minAccuracy = gates.min_accuracy;
  if (typeof minAccuracy !== "number") {
    errors.push("gates.min_accuracy must be number");
  } else if (minAccuracy < 0 || minAccuracy > 1) {
    errors.push("gates.min_accuracy must be within [0, 1]");
  }
  const maxForbiddenViolations = gates.max_forbidden_violations;
  if (typeof maxForbiddenViolations !== "number" || !Number.isInteger(maxForbiddenViolations)) {
    errors.push("gates.max_forbidden_violations must be int");
  } else if (maxForbiddenViolations < 0) {
    errors.push("gates.max_forbidden_violations must be >= 0");
  }
  const maxAccuracyDrop = gates.max_accuracy_drop;
  if (typeof maxAccuracyDrop !== "number") {
    errors.push("gates.max_accuracy_drop must be number");
  } else if (maxAccuracyDrop < 0 || maxAccuracyDrop > 1) {
    errors.push("gates.max_accuracy_drop must be within [0, 1]");
  }
  const maxForbiddenIncrease = gates.max_forbidden_increase;
  if (typeof maxForbiddenIncrease !== "number" || !Number.isInteger(maxForbiddenIncrease)) {
    errors.push("gates.max_forbidden_increase must be int");
  } else if (maxForbiddenIncrease < 0) {
    errors.push("gates.max_forbidden_increase must be >= 0");
  }
  return errors;
}

export function buildSkillRouterPolicyResult(policyPath: string, includeDetails: boolean): JsonObject {
  let config: JsonObject | undefined;
  let errors: string[] = [];
  try {
    config = loadSkillRouterEvalPolicy(policyPath) as unknown as JsonObject;
    errors = validateSkillRouterPolicyConfig(config);
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
    const { policyHash, canonical } = computeSkillRouterPolicyFingerprint(policyPath);
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
    const result = buildSkillRouterPolicyResult(policyPath, args.printJson);
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

const entryScript = process.argv[1] ?? "";
const shouldRunCli = entryScript.includes("skill-router-policy-guard");

if (shouldRunCli) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`skill-router-policy-guard fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
