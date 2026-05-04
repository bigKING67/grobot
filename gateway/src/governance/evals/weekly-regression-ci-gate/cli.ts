import type { ParsedCliArgs } from "./types";

export function parseArgs(argv: string[]): ParsedCliArgs {
  let eventName = "";
  let prBaseSha = "";
  let beforeSha = "";
  let baselineAvailable = "auto";
  let repoRoot = ".";
  let outputPath = "gateway/evals/data/weekly_regression_ci_report.json";
  let contextMemoryReportPath = "gateway/evals/data/context_memory_ci_report.json";
  let contextMemoryBaseReportPath = "gateway/evals/data/context_memory_ci_report.base.json";
  let runsPath = "gateway/evals/fixtures/context_memory_runs.ci.jsonl";
  let ledgerPath = "gateway/evals/data/experiment_ledger_ci.jsonl";
  let autoLoopReportPath = "gateway/evals/data/auto_loop_ci_report.json";
  let policyPath = "gateway/evals/weekly_regression_policy.ci.json";
  let policyBlobPath = "gateway/evals/weekly_regression_policy.ci.json";
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
    if (token === "--context-memory-report") {
      contextMemoryReportPath = argv[index + 1] ?? contextMemoryReportPath;
      index += 1;
      continue;
    }
    if (token === "--context-memory-base-report") {
      contextMemoryBaseReportPath = argv[index + 1] ?? contextMemoryBaseReportPath;
      index += 1;
      continue;
    }
    if (token === "--runs-path") {
      runsPath = argv[index + 1] ?? runsPath;
      index += 1;
      continue;
    }
    if (token === "--ledger-path") {
      ledgerPath = argv[index + 1] ?? ledgerPath;
      index += 1;
      continue;
    }
    if (token === "--auto-loop-report") {
      autoLoopReportPath = argv[index + 1] ?? autoLoopReportPath;
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
    contextMemoryReportPath,
    contextMemoryBaseReportPath,
    runsPath,
    ledgerPath,
    autoLoopReportPath,
    policyPath,
    policyBlobPath,
    printJson,
  };
}
