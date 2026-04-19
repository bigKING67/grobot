import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolveBaseSha } from "./skill-router-baseline-report";
import { loadReport, saveReport } from "./skill-router-trend-meta";
import { buildContextMemoryBaselineReport } from "./context-memory-baseline-report";

type JsonObject = Record<string, unknown>;
const TSX_PACKAGE = "tsx@4.20.6";

const DIMENSIONS = ["context_compression", "memory_lineage", "experience_learning"] as const;
type DimensionName = typeof DIMENSIONS[number];

interface ParsedCliArgs {
  eventName: string;
  prBaseSha: string;
  beforeSha: string;
  baselineAvailable: string;
  repoRoot: string;
  outputPath: string;
  baseReportPath: string;
  policyPath: string;
  policyBlobPath: string;
  evalScriptPath: string;
  casesPath: string;
  runsPath: string;
  printJson: boolean;
}

interface ContextMemoryCiGateInput {
  eventName: string;
  prBaseSha: string;
  beforeSha: string;
  baselineAvailable: unknown;
  repoRoot: string;
  outputPath: string;
  baseReportPath: string;
  policyPath: string;
  policyBlobPath: string;
  evalScriptPath: string;
  casesPath: string;
  runsPath: string;
}

interface ContextMemoryCiGateResult {
  exit_code: number;
  phase: string;
  trend_mode?: string;
  trend_reason?: string;
}

interface TrendCompareResult {
  passed: boolean;
  failures: string[];
  baseline: JsonObject;
  current: JsonObject;
  deltas: JsonObject;
}

type BaselineAvailabilityMode = "force_on" | "force_off" | "auto";

function normalizeBool(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return false;
  }
  return value.trim().toLowerCase() === "true";
}

function parseBaselineAvailabilityMode(value: unknown): BaselineAvailabilityMode {
  if (typeof value !== "string") {
    return "auto";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return "force_on";
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return "force_off";
  }
  return "auto";
}

function resolveBaselineAvailability(input: {
  mode: BaselineAvailabilityMode;
  baseSha: string | undefined;
  baseReportPath: string;
}): boolean {
  if (input.mode === "force_on") {
    return true;
  }
  if (input.mode === "force_off") {
    return false;
  }
  if (existsSync(input.baseReportPath)) {
    return true;
  }
  return typeof input.baseSha === "string";
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function asObject(value: unknown): JsonObject {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function dirname(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function removeTrailingSlashes(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

function pathJoin(base: string, relative: string): string {
  const trimmedBase = removeTrailingSlashes(base);
  const trimmedRelative = relative.replace(/^[\\/]+/, "");
  return `${trimmedBase}/${trimmedRelative}`;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/");
}

function resolvePathFromRepoRoot(repoRoot: string, path: string): string {
  if (isAbsolutePath(path)) {
    return path;
  }
  return pathJoin(repoRoot, path);
}

function toAbsolutePath(path: string): string {
  if (isAbsolutePath(path)) {
    return path;
  }
  const cwd = process.cwd().replace(/[\\]+/g, "/");
  return pathJoin(cwd, path);
}

function runPassthrough(command: string[]): number {
  if (command.length === 0) {
    return 1;
  }
  const result = spawnSync(command[0], command.slice(1), {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 240_000,
  });
  return typeof result.status === "number" ? result.status : 1;
}

function runCapture(command: string[]): string | undefined {
  if (command.length === 0) {
    return undefined;
  }
  const result = spawnSync(command[0], command.slice(1), {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.status !== 0) {
    return undefined;
  }
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  return stdout.length > 0 ? stdout : undefined;
}

function runEval(input: {
  evalScriptPath: string;
  casesPath: string;
  runsPath: string;
  policyPath: string;
  outputPath: string;
}): number {
  const extension = input.evalScriptPath.toLowerCase();
  const command: string[] = [];
  if (extension.endsWith(".ts")) {
    command.push("npx", "--yes", "--package", TSX_PACKAGE, "tsx", input.evalScriptPath);
  } else if (extension.endsWith(".js")) {
    command.push("node", input.evalScriptPath);
  } else {
    process.stderr.write(`context-memory-ci-gate: unsupported eval script extension: ${input.evalScriptPath}\n`);
    return 2;
  }

  command.push(
    "--cases",
    input.casesPath,
    "--runs",
    input.runsPath,
    "--gate-policy",
    input.policyPath,
    "--print-json",
    "--output",
    input.outputPath,
    "--fail-on-gate",
  );

  return runPassthrough(command);
}

function parseArgs(argv: string[]): ParsedCliArgs {
  let eventName = "";
  let prBaseSha = "";
  let beforeSha = "";
  let baselineAvailable = "auto";
  let repoRoot = ".";
  let outputPath = "gateway/evals/data/context_memory_ci_report.json";
  let baseReportPath = "gateway/evals/data/context_memory_ci_report.base.json";
  let policyPath = "gateway/evals/context_memory_policy.ci.json";
  let policyBlobPath = "gateway/evals/context_memory_policy.ci.json";
  let evalScriptPath = "gateway/src/governance/evals/context-memory-experience-eval.ts";
  let casesPath = "gateway/evals/fixtures/context_memory_cases.ci.jsonl";
  let runsPath = "gateway/evals/fixtures/context_memory_runs.ci.jsonl";
  let printJson = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--event-name") {
      eventName = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--pr-base-sha") {
      prBaseSha = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--before-sha") {
      beforeSha = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--baseline-available") {
      baselineAvailable = argv[index + 1] ?? "auto";
      index += 1;
      continue;
    }
    if (token === "--repo-root") {
      repoRoot = argv[index + 1] ?? ".";
      index += 1;
      continue;
    }
    if (token === "--output") {
      outputPath = argv[index + 1] ?? outputPath;
      index += 1;
      continue;
    }
    if (token === "--base-report") {
      baseReportPath = argv[index + 1] ?? baseReportPath;
      index += 1;
      continue;
    }
    if (token === "--policy") {
      policyPath = argv[index + 1] ?? policyPath;
      index += 1;
      continue;
    }
    if (token === "--policy-blob-path") {
      policyBlobPath = argv[index + 1] ?? policyBlobPath;
      index += 1;
      continue;
    }
    if (token === "--eval-script") {
      evalScriptPath = argv[index + 1] ?? evalScriptPath;
      index += 1;
      continue;
    }
    if (token === "--cases") {
      casesPath = argv[index + 1] ?? casesPath;
      index += 1;
      continue;
    }
    if (token === "--runs") {
      runsPath = argv[index + 1] ?? runsPath;
      index += 1;
      continue;
    }
    if (token === "--print-json") {
      printJson = true;
      continue;
    }
  }

  return {
    eventName,
    prBaseSha,
    beforeSha,
    baselineAvailable,
    repoRoot,
    outputPath,
    baseReportPath,
    policyPath,
    policyBlobPath,
    evalScriptPath,
    casesPath,
    runsPath,
    printJson,
  };
}

function readVariantSummary(report: JsonObject, variant: string): { averageScore: number; passRate: number; reward: number } {
  const variants = asObject(report.variants);
  const variantPayload = asObject(variants[variant]);
  const summary = asObject(variantPayload.summary);
  const reward = asObject(variantPayload.reward_v1);
  return {
    averageScore: asNumber(summary.average_score),
    passRate: asNumber(summary.pass_rate),
    reward: asNumber(reward.composite_score),
  };
}

function readVariantDimension(report: JsonObject, variant: string, dimension: DimensionName): {
  averageScore: number;
  passRate: number;
} {
  const variants = asObject(report.variants);
  const variantPayload = asObject(variants[variant]);
  const dimensions = asObject(variantPayload.dimensions);
  const dimensionPayload = asObject(dimensions[dimension]);
  return {
    averageScore: asNumber(dimensionPayload.average_score),
    passRate: asNumber(dimensionPayload.pass_rate),
  };
}

function buildTrendComparison(currentReport: JsonObject, baseReport: JsonObject): TrendCompareResult {
  const failures: string[] = [];
  const epsilon = 1e-9;

  const baselineSummary = readVariantSummary(baseReport, "candidate");
  const currentSummary = readVariantSummary(currentReport, "candidate");

  if (baselineSummary.averageScore <= 0 && baselineSummary.passRate <= 0) {
    failures.push("baseline candidate summary missing or invalid");
  }
  if (currentSummary.averageScore <= 0 && currentSummary.passRate <= 0) {
    failures.push("current candidate summary missing or invalid");
  }

  const overallAverageDrop = baselineSummary.averageScore - currentSummary.averageScore;
  const overallPassRateDrop = baselineSummary.passRate - currentSummary.passRate;
  const rewardDrop = baselineSummary.reward - currentSummary.reward;

  if (overallAverageDrop > epsilon) {
    failures.push(`candidate average_score drop ${overallAverageDrop.toFixed(4)} > 0`);
  }
  if (overallPassRateDrop > epsilon) {
    failures.push(`candidate pass_rate drop ${overallPassRateDrop.toFixed(4)} > 0`);
  }
  if (rewardDrop > epsilon) {
    failures.push(`candidate reward_v1 drop ${rewardDrop.toFixed(4)} > 0`);
  }

  const dimensionBaselinePayload: JsonObject = {};
  const dimensionCurrentPayload: JsonObject = {};
  const dimensionDeltaPayload: JsonObject = {};

  for (const dimension of DIMENSIONS) {
    const baselineDim = readVariantDimension(baseReport, "candidate", dimension);
    const currentDim = readVariantDimension(currentReport, "candidate", dimension);
    const averageDrop = baselineDim.averageScore - currentDim.averageScore;
    const passDrop = baselineDim.passRate - currentDim.passRate;

    if (averageDrop > epsilon) {
      failures.push(`dimension=${dimension} average_score drop ${averageDrop.toFixed(4)} > 0`);
    }
    if (passDrop > epsilon) {
      failures.push(`dimension=${dimension} pass_rate drop ${passDrop.toFixed(4)} > 0`);
    }

    dimensionBaselinePayload[dimension] = {
      average_score: baselineDim.averageScore,
      pass_rate: baselineDim.passRate,
    };
    dimensionCurrentPayload[dimension] = {
      average_score: currentDim.averageScore,
      pass_rate: currentDim.passRate,
    };
    dimensionDeltaPayload[dimension] = {
      average_score_drop: averageDrop,
      pass_rate_drop: passDrop,
    };
  }

  return {
    passed: failures.length === 0,
    failures,
    baseline: {
      variant: "candidate",
      summary: {
        average_score: baselineSummary.averageScore,
        pass_rate: baselineSummary.passRate,
        reward_v1_composite: baselineSummary.reward,
      },
      dimensions: dimensionBaselinePayload,
    },
    current: {
      variant: "candidate",
      summary: {
        average_score: currentSummary.averageScore,
        pass_rate: currentSummary.passRate,
        reward_v1_composite: currentSummary.reward,
      },
      dimensions: dimensionCurrentPayload,
    },
    deltas: {
      candidate: {
        average_score_drop: overallAverageDrop,
        pass_rate_drop: overallPassRateDrop,
        reward_v1_drop: rewardDrop,
      },
      dimensions: dimensionDeltaPayload,
    },
  };
}

function extractPolicyHash(report: JsonObject): string | null {
  const policyHash = normalizeOptionalText(report.policy_hash);
  return policyHash ?? null;
}

function buildTrendMeta(input: {
  currentReport: JsonObject;
  baseReport: JsonObject;
  trendMode: string;
  trendReason: string;
  trendRequired: boolean;
  baselineAvailable: boolean;
  baseSha: string | undefined;
  currentPolicyBlob: string | undefined;
  basePolicyBlob: string | undefined;
  policyBlobMatch: boolean | null;
}): JsonObject {
  const currentPolicyHash = extractPolicyHash(input.currentReport);
  const basePolicyHash = extractPolicyHash(input.baseReport);
  let policyHashMatch: boolean | null = null;
  if (currentPolicyHash != null && basePolicyHash != null) {
    policyHashMatch = currentPolicyHash === basePolicyHash;
  }

  return {
    mode: input.trendMode,
    reason: input.trendReason,
    required: input.trendRequired,
    executed: input.trendMode === "gate_and_trend",
    baseline_available: input.baselineAvailable,
    base_sha: input.baseSha ?? null,
    policy_blob_current: input.currentPolicyBlob ?? null,
    policy_blob_base: input.basePolicyBlob ?? null,
    policy_blob_match: input.policyBlobMatch,
    policy_hash_current: currentPolicyHash,
    policy_hash_base: basePolicyHash,
    policy_hash_match: policyHashMatch,
  };
}

export function runContextMemoryCiGate(input: ContextMemoryCiGateInput): ContextMemoryCiGateResult {
  const repoRoot = removeTrailingSlashes(input.repoRoot);
  const outputPath = resolvePathFromRepoRoot(repoRoot, input.outputPath);
  const baseReportPath = resolvePathFromRepoRoot(repoRoot, input.baseReportPath);
  const policyPath = resolvePathFromRepoRoot(repoRoot, input.policyPath);
  const evalScriptPath = resolvePathFromRepoRoot(repoRoot, input.evalScriptPath);
  const casesPath = resolvePathFromRepoRoot(repoRoot, input.casesPath);
  const runsPath = resolvePathFromRepoRoot(repoRoot, input.runsPath);

  mkdirSync(dirname(outputPath), { recursive: true });

  const gateExitCode = runEval({
    evalScriptPath,
    casesPath,
    runsPath,
    policyPath,
    outputPath,
  });
  if (gateExitCode !== 0) {
    return {
      exit_code: gateExitCode,
      phase: "gate_eval",
    };
  }

  const baseSha = resolveBaseSha({
    eventName: input.eventName,
    prBaseSha: input.prBaseSha,
    beforeSha: input.beforeSha,
    repoRoot,
  });
  const baselineMode = parseBaselineAvailabilityMode(input.baselineAvailable);
  let baselineAvailableFlag = resolveBaselineAvailability({
    mode: baselineMode,
    baseSha,
    baseReportPath,
  });

  let baselineBuildAttempted = false;
  let baselineBuildSucceeded = false;
  const shouldAutoRebuildBaseline =
    baselineAvailableFlag &&
    baselineMode === "auto" &&
    typeof baseSha === "string";
  const shouldBuildMissingBaseline =
    baselineAvailableFlag &&
    !existsSync(baseReportPath) &&
    typeof baseSha === "string";
  if (shouldAutoRebuildBaseline || shouldBuildMissingBaseline) {
    baselineBuildAttempted = true;
    const baselineBuild = buildContextMemoryBaselineReport({
      eventName: input.eventName,
      prBaseSha: input.prBaseSha,
      beforeSha: input.beforeSha,
      repoRoot,
      outputPath: baseReportPath,
      policyRelPath: toAbsolutePath(policyPath),
      casesRelPath: toAbsolutePath(casesPath),
      runsRelPath: toAbsolutePath(runsPath),
    });
    baselineBuildSucceeded = baselineBuild.available === true && existsSync(baseReportPath);
    baselineAvailableFlag = baselineBuildSucceeded;
  }

  const currentPolicyBlob = runCapture(["git", "-C", repoRoot, "rev-parse", `HEAD:${input.policyBlobPath}`]);
  let basePolicyBlob: string | undefined;
  if (baselineAvailableFlag && typeof baseSha === "string") {
    basePolicyBlob = runCapture(["git", "-C", repoRoot, "rev-parse", `${baseSha}:${input.policyBlobPath}`]);
  }

  let trendMode = "gate_only";
  let trendReason = "baseline_unavailable";
  let trendRequired = false;
  let policyBlobMatch: boolean | null = null;

  const currentReport = loadReport(outputPath);
  const baseReport = loadReport(baseReportPath);

  let trend: TrendCompareResult | null = null;

  if (baselineAvailableFlag) {
    trendReason = "baseline_report_missing";
    if (existsSync(baseReportPath)) {
      trendReason = "policy_blob_unavailable";
      if (typeof currentPolicyBlob === "string" && typeof basePolicyBlob === "string") {
        if (currentPolicyBlob === basePolicyBlob) {
          policyBlobMatch = true;
          trendRequired = true;
          trendMode = "gate_and_trend";
          trendReason = "policy_blob_match";
          trend = buildTrendComparison(currentReport, baseReport);
        } else {
          policyBlobMatch = false;
          trendReason = "policy_blob_mismatch";
        }
      }
    }
  } else if (baselineBuildAttempted && !baselineBuildSucceeded) {
    trendReason = "baseline_build_failed";
  } else if (baselineMode !== "force_off" && typeof baseSha !== "string") {
    trendReason = "baseline_no_base_sha";
  }

  const trendMeta = buildTrendMeta({
    currentReport,
    baseReport,
    trendMode,
    trendReason,
    trendRequired,
    baselineAvailable: baselineAvailableFlag,
    baseSha,
    currentPolicyBlob,
    basePolicyBlob,
    policyBlobMatch,
  });

  (currentReport as JsonObject).trend = trend;
  (currentReport as JsonObject).trend_meta = trendMeta;
  saveReport(outputPath, currentReport);

  if (trendRequired && trend != null && !trend.passed) {
    return {
      exit_code: 6,
      phase: "trend_eval",
      trend_mode: trendMode,
      trend_reason: trendReason,
    };
  }

  return {
    exit_code: 0,
    phase: "done",
    trend_mode: trendMode,
    trend_reason: trendReason,
  };
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const result = runContextMemoryCiGate({
    eventName: args.eventName,
    prBaseSha: args.prBaseSha,
    beforeSha: args.beforeSha,
    baselineAvailable: args.baselineAvailable,
    repoRoot: args.repoRoot,
    outputPath: args.outputPath,
    baseReportPath: args.baseReportPath,
    policyPath: args.policyPath,
    policyBlobPath: args.policyBlobPath,
    evalScriptPath: args.evalScriptPath,
    casesPath: args.casesPath,
    runsPath: args.runsPath,
  });

  if (args.printJson) {
    process.stdout.write(`${JSON.stringify({ context_memory_ci_gate: result }, undefined, 0)}\n`);
  }

  return typeof result.exit_code === "number" ? result.exit_code : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`context-memory-ci-gate fatal: ${String(error)}\n`);
  process.exitCode = 1;
}
