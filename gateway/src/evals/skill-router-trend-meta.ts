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

interface ParsedCliArgs {
  reportPath: string;
  baseReportPath: string;
  trendMode: string;
  trendReason: string;
  trendRequired: string;
  baselineAvailable: string;
  baseSha: string;
  currentPolicyBlob: string;
  basePolicyBlob: string;
  policyBlobMatch: string;
  printJson: boolean;
}

function readArgValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1] ?? "";
  if (!value || value.startsWith("--")) {
    throw new Error(`missing value for ${flag}`);
  }
  return value;
}

function parseArgs(argv: string[]): ParsedCliArgs {
  const args: ParsedCliArgs = {
    reportPath: "gateway/evals/data/skill_router_ci_report.json",
    baseReportPath: "gateway/evals/data/skill_router_ci_report.base.json",
    trendMode: "gate_only",
    trendReason: "unknown",
    trendRequired: "false",
    baselineAvailable: "false",
    baseSha: "",
    currentPolicyBlob: "",
    basePolicyBlob: "",
    policyBlobMatch: "unknown",
    printJson: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--report":
        args.reportPath = readArgValue(argv, index, "--report");
        index += 1;
        break;
      case "--base-report":
        args.baseReportPath = readArgValue(argv, index, "--base-report");
        index += 1;
        break;
      case "--trend-mode":
        args.trendMode = readArgValue(argv, index, "--trend-mode");
        index += 1;
        break;
      case "--trend-reason":
        args.trendReason = readArgValue(argv, index, "--trend-reason");
        index += 1;
        break;
      case "--trend-required":
        args.trendRequired = readArgValue(argv, index, "--trend-required");
        index += 1;
        break;
      case "--baseline-available":
        args.baselineAvailable = readArgValue(argv, index, "--baseline-available");
        index += 1;
        break;
      case "--base-sha":
        args.baseSha = readArgValue(argv, index, "--base-sha");
        index += 1;
        break;
      case "--current-policy-blob":
        args.currentPolicyBlob = readArgValue(argv, index, "--current-policy-blob");
        index += 1;
        break;
      case "--base-policy-blob":
        args.basePolicyBlob = readArgValue(argv, index, "--base-policy-blob");
        index += 1;
        break;
      case "--policy-blob-match":
        args.policyBlobMatch = readArgValue(argv, index, "--policy-blob-match");
        index += 1;
        break;
      case "--print-json":
        args.printJson = true;
        break;
      default:
        throw new Error(`unknown argument: ${token}`);
    }
  }
  return args;
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

export function runCli(argv: string[]): number {
  const args = parseArgs(argv);
  const report = loadReport(args.reportPath);
  const baseReport = loadReport(args.baseReportPath);
  const trendMeta = buildSkillRouterTrendMeta({
    currentReport: report,
    baseReport,
    trendMode: args.trendMode,
    trendReason: args.trendReason,
    trendRequired: args.trendRequired,
    baselineAvailable: args.baselineAvailable,
    baseSha: args.baseSha,
    currentPolicyBlob: args.currentPolicyBlob,
    basePolicyBlob: args.basePolicyBlob,
    policyBlobMatch: args.policyBlobMatch,
  });
  report.trend_meta = trendMeta;
  saveReport(args.reportPath, report);
  if (args.printJson) {
    process.stdout.write(`${JSON.stringify({ skill_router_trend_meta: trendMeta }, undefined, 0)}\n`);
  }
  return 0;
}

const entryScript = process.argv[1] ?? "";
const shouldRunCli = entryScript.includes("skill-router-trend-meta");

if (shouldRunCli) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`skill-router-trend-meta fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
