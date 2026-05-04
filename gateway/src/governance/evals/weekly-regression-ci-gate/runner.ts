import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolveBaseSha } from "../skill-router-baseline-report";
import { buildContextMemoryBaselineReport } from "../context-memory-baseline-report";
import { buildTrendMeta, compareTrend, evaluateGate } from "./gate";
import { readPolicy } from "./policy";
import { buildFallbackBaselineFromCurrent, buildWeeklySnapshot } from "./snapshot";
import type {
  JsonObject,
  TrendCompareResult,
  WeeklyRegressionCiGateInput,
  WeeklyRegressionCiGateResult,
  WeeklySnapshot,
} from "./types";
import {
  asObject,
  dirname,
  parseBaselineAvailabilityMode,
  parseJsonLines,
  parseJsonLinesContent,
  parseJsonObject,
  readFileAtRevision,
  removeTrailingSlashes,
  resolveBaselineAvailability,
  resolvePathFromRepoRoot,
  runCapture,
  toRepoRelativePath,
} from "./utils";

function writeReport(path: string, payload: JsonObject): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, undefined, 2)}\n`, "utf8");
}

export function runWeeklyRegressionCiGate(input: WeeklyRegressionCiGateInput): WeeklyRegressionCiGateResult {
  const repoRoot = removeTrailingSlashes(input.repoRoot);
  const outputPath = resolvePathFromRepoRoot(repoRoot, input.outputPath);
  const contextMemoryReportPath = resolvePathFromRepoRoot(repoRoot, input.contextMemoryReportPath);
  const contextMemoryBaseReportPath = resolvePathFromRepoRoot(repoRoot, input.contextMemoryBaseReportPath);
  const runsPath = resolvePathFromRepoRoot(repoRoot, input.runsPath);
  const ledgerPath = resolvePathFromRepoRoot(repoRoot, input.ledgerPath);
  const autoLoopReportPath = resolvePathFromRepoRoot(repoRoot, input.autoLoopReportPath);
  const policyPath = resolvePathFromRepoRoot(repoRoot, input.policyPath);

  const { policy, hash: policyHash } = readPolicy(policyPath);
  const currentContextReport = parseJsonObject(contextMemoryReportPath);
  const currentRuns = parseJsonLines(runsPath);
  const currentLedger = parseJsonLines(ledgerPath);
  const currentAutoLoop = parseJsonObject(autoLoopReportPath);
  const currentSnapshot = buildWeeklySnapshot({
    contextReport: currentContextReport,
    runsRows: currentRuns,
    ledgerRows: currentLedger,
    autoLoopReport: currentAutoLoop,
  });
  const gate = evaluateGate(currentSnapshot, policy);
  if (!gate.passed) {
    const report: JsonObject = {
      schema: "weekly_regression_ci_gate@v1",
      generated_at: new Date().toISOString(),
      policy: {
        schema: policy.schema,
        hash: policyHash,
      },
      gate,
      trend: null,
      trend_meta: {
        mode: "gate_only",
        reason: "gate_failed",
        required: false,
        executed: false,
      },
      current: currentSnapshot,
      overall_gate: {
        passed: false,
        failures: [...gate.failures],
      },
    };
    writeReport(outputPath, report);
    return {
      exit_code: 5,
      phase: "gate_eval",
      trend_mode: "gate_only",
      trend_reason: "gate_failed",
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
    contextMemoryBaseReportPath,
  });

  let baselineBuildAttempted = false;
  let baselineBuildSucceeded = false;
  if (baselineAvailableFlag && !existsSync(contextMemoryBaseReportPath) && typeof baseSha === "string") {
    baselineBuildAttempted = true;
    const baselineBuild = buildContextMemoryBaselineReport({
      eventName: input.eventName,
      prBaseSha: input.prBaseSha,
      beforeSha: input.beforeSha,
      repoRoot,
      outputPath: input.contextMemoryBaseReportPath,
    });
    baselineBuildSucceeded = baselineBuild.available === true && existsSync(contextMemoryBaseReportPath);
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
  let baselineSnapshot: WeeklySnapshot = buildFallbackBaselineFromCurrent(currentSnapshot);
  let trend: TrendCompareResult | null = null;

  if (baselineAvailableFlag) {
    trendReason = "baseline_report_missing";
    if (existsSync(contextMemoryBaseReportPath)) {
      trendReason = "policy_blob_unavailable";
      if (typeof currentPolicyBlob === "string" && typeof basePolicyBlob === "string") {
        if (currentPolicyBlob === basePolicyBlob) {
          policyBlobMatch = true;
          trendMode = "gate_and_trend";
          trendReason = "policy_blob_match";
          trendRequired = true;

          const baseContextReport = parseJsonObject(contextMemoryBaseReportPath);
          const runsRepoPath = toRepoRelativePath(repoRoot, runsPath);
          const ledgerRepoPath = toRepoRelativePath(repoRoot, ledgerPath);
          const autoLoopRepoPath = toRepoRelativePath(repoRoot, autoLoopReportPath);
          const baseRunsContent =
            typeof baseSha === "string" && runsRepoPath
              ? readFileAtRevision(repoRoot, baseSha, runsRepoPath)
              : undefined;
          const baseLedgerContent =
            typeof baseSha === "string" && ledgerRepoPath
              ? readFileAtRevision(repoRoot, baseSha, ledgerRepoPath)
              : undefined;
          const baseAutoLoopContent =
            typeof baseSha === "string" && autoLoopRepoPath
              ? readFileAtRevision(repoRoot, baseSha, autoLoopRepoPath)
              : undefined;

          const baseRuns = typeof baseRunsContent === "string" ? parseJsonLinesContent(baseRunsContent) : [];
          const baseLedger = typeof baseLedgerContent === "string" ? parseJsonLinesContent(baseLedgerContent) : [];
          let baseAutoLoop: JsonObject = {};
          if (typeof baseAutoLoopContent === "string") {
            try {
              baseAutoLoop = asObject(JSON.parse(baseAutoLoopContent) as unknown);
            } catch {
              baseAutoLoop = {};
            }
          }

          baselineSnapshot = buildWeeklySnapshot({
            contextReport: baseContextReport,
            runsRows: baseRuns,
            ledgerRows: baseLedger,
            autoLoopReport: baseAutoLoop,
          });
          trend = compareTrend(currentSnapshot, baselineSnapshot, policy);
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
    mode: trendMode,
    reason: trendReason,
    required: trendRequired,
    baselineAvailable: baselineAvailableFlag,
    baseSha,
    currentPolicyBlob,
    basePolicyBlob,
    policyBlobMatch,
    policyHash,
  });

  const overallFailures: string[] = [];
  overallFailures.push(...gate.failures);
  if (trendRequired) {
    if (!trend || !trend.passed) {
      overallFailures.push(...(trend?.failures ?? ["trend result missing"]));
    }
  }

  const report: JsonObject = {
    schema: "weekly_regression_ci_gate@v1",
    generated_at: new Date().toISOString(),
    policy: {
      schema: policy.schema,
      hash: policyHash,
      metrics: policy.metrics,
    },
    current: currentSnapshot,
    baseline: baselineSnapshot,
    gate,
    trend,
    trend_meta: trendMeta,
    overall_gate: {
      passed: overallFailures.length === 0,
      failures: overallFailures,
    },
  };
  writeReport(outputPath, report);

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
