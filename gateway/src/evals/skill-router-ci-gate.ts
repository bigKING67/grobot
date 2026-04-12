import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolveBaseSha } from "./skill-router-baseline-report";
import { buildSkillRouterTrendMeta, loadReport, saveReport } from "./skill-router-trend-meta";

type JsonObject = Record<string, unknown>;
const TSX_PACKAGE = "tsx@4.20.6";

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
  pythonBin: string;
  printJson: boolean;
}

interface SkillRouterCiGateInput {
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
  pythonBin: string;
}

interface SkillRouterCiGateResult {
  exit_code: number;
  phase: string;
  trend_mode?: string;
  trend_reason?: string;
}

function normalizeBool(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return false;
  }
  return value.trim().toLowerCase() === "true";
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

function runPassthrough(command: string[]): number {
  if (command.length === 0) {
    return 1;
  }
  const result = spawnSync(command[0], command.slice(1), {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 180_000,
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
  pythonBin: string;
  evalScriptPath: string;
  policyPath: string;
  outputPath: string;
  compareReportPath?: string;
}): number {
  const extension = input.evalScriptPath.toLowerCase();
  const command: string[] = [];
  if (extension.endsWith(".ts")) {
    command.push("npx", "--yes", "--package", TSX_PACKAGE, "tsx", input.evalScriptPath);
  } else if (extension.endsWith(".js")) {
    command.push("node", input.evalScriptPath);
  } else {
    command.push(input.pythonBin, input.evalScriptPath);
  }
  command.push(
    "--policy",
    input.policyPath,
    "--fail-on-gate",
    "--print-json",
    "--output",
    input.outputPath,
  );
  if (typeof input.compareReportPath === "string" && input.compareReportPath.length > 0) {
    command.push("--compare-report", input.compareReportPath, "--fail-on-trend");
  }
  return runPassthrough(command);
}

function parseArgs(argv: string[]): ParsedCliArgs {
  let eventName = "";
  let prBaseSha = "";
  let beforeSha = "";
  let baselineAvailable = "false";
  let repoRoot = ".";
  let outputPath = "gateway/evals/data/skill_router_ci_report.json";
  let baseReportPath = "gateway/evals/data/skill_router_ci_report.base.json";
  let policyPath = "gateway/evals/skill_router_policy.ci.json";
  let policyBlobPath = "gateway/evals/skill_router_policy.ci.json";
  let evalScriptPath = "gateway/src/evals/skill-router-eval.ts";
  let pythonBin = "python3";
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
      baselineAvailable = argv[index + 1] ?? "false";
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
    if (token === "--python-bin") {
      pythonBin = argv[index + 1] ?? pythonBin;
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
    pythonBin,
    printJson,
  };
}

export function runSkillRouterCiGate(input: SkillRouterCiGateInput): SkillRouterCiGateResult {
  const repoRoot = removeTrailingSlashes(input.repoRoot);
  const outputPath = resolvePathFromRepoRoot(repoRoot, input.outputPath);
  const baseReportPath = resolvePathFromRepoRoot(repoRoot, input.baseReportPath);
  const policyPath = resolvePathFromRepoRoot(repoRoot, input.policyPath);
  const evalScriptPath = resolvePathFromRepoRoot(repoRoot, input.evalScriptPath);

  mkdirSync(dirname(outputPath), { recursive: true });

  const gateExitCode = runEval({
    pythonBin: input.pythonBin,
    evalScriptPath,
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
  });
  const baselineAvailableFlag = normalizeBool(input.baselineAvailable);

  const currentPolicyBlob = runCapture(["git", "-C", repoRoot, "rev-parse", `HEAD:${input.policyBlobPath}`]);
  let basePolicyBlob: string | undefined;
  if (baselineAvailableFlag && typeof baseSha === "string") {
    basePolicyBlob = runCapture(["git", "-C", repoRoot, "rev-parse", `${baseSha}:${input.policyBlobPath}`]);
  }

  let trendMode = "gate_only";
  let trendReason = "baseline_unavailable";
  let trendRequired: unknown = "false";
  let policyBlobMatch: unknown = "unknown";

  if (baselineAvailableFlag) {
    trendReason = "baseline_report_missing";
    if (existsSync(baseReportPath)) {
      trendReason = "policy_blob_unavailable";
      if (typeof currentPolicyBlob === "string" && typeof basePolicyBlob === "string") {
        if (currentPolicyBlob === basePolicyBlob) {
          trendRequired = "true";
          policyBlobMatch = "true";
          const trendExitCode = runEval({
            pythonBin: input.pythonBin,
            evalScriptPath,
            policyPath,
            outputPath,
            compareReportPath: baseReportPath,
          });
          if (trendExitCode !== 0) {
            return {
              exit_code: trendExitCode,
              phase: "trend_eval",
              trend_mode: "gate_and_trend",
              trend_reason: "policy_blob_match",
            };
          }
          trendMode = "gate_and_trend";
          trendReason = "policy_blob_match";
        } else {
          policyBlobMatch = "false";
          trendReason = "policy_blob_mismatch";
        }
      }
    }
  }

  const currentReport = loadReport(outputPath);
  const baseReport = loadReport(baseReportPath);
  const trendMeta = buildSkillRouterTrendMeta({
    currentReport,
    baseReport,
    trendMode,
    trendReason,
    trendRequired,
    baselineAvailable: input.baselineAvailable,
    baseSha,
    currentPolicyBlob,
    basePolicyBlob,
    policyBlobMatch,
  });
  (currentReport as JsonObject).trend_meta = trendMeta;
  saveReport(outputPath, currentReport);

  return {
    exit_code: 0,
    phase: "done",
    trend_mode: trendMode,
    trend_reason: trendReason,
  };
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const result = runSkillRouterCiGate({
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
    pythonBin: args.pythonBin,
  });

  if (args.printJson) {
    process.stdout.write(`${JSON.stringify({ skill_router_ci_gate: result }, undefined, 0)}\n`);
  }

  return typeof result.exit_code === "number" ? result.exit_code : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`skill-router-ci-gate fatal: ${String(error)}\n`);
  process.exitCode = 1;
}
