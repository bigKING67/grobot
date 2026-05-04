import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import {
  computeTracePipelinePolicyFingerprint,
} from "./trace-policy-guard";
import { cleanTraceDataset } from "./trace-clean";
import { mineTraceSessions } from "./trace-mining";
import { parseCliArgs } from "./trace-pipeline/cli-args";
import type { JsonObject, SampleGuardSplitResult, TracePipelineArgs } from "./trace-pipeline/types";

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

function formatJson(value: unknown, pretty: boolean): string {
  if (pretty) {
    return `${JSON.stringify(value, undefined, 2)}\n`;
  }
  return `${JSON.stringify(value)}\n`;
}

function findExistingParent(targetPath: string): string | null {
  let probe = dirname(targetPath);
  while (!existsSync(probe)) {
    const nextProbe = dirname(probe);
    if (nextProbe === probe) {
      return null;
    }
    probe = nextProbe;
  }
  return probe;
}

function validateTracePipelineInputs(args: TracePipelineArgs, splitThresholds: Record<string, number>): string[] {
  const errors: string[] = [];

  if (!existsSync(args.sessionsDir)) {
    errors.push(`sessions_dir does not exist: ${args.sessionsDir}`);
  } else if (!statSync(args.sessionsDir).isDirectory()) {
    errors.push(`sessions_dir is not a directory: ${args.sessionsDir}`);
  }
  if (args.whitelistCaseIdsFile !== null && !existsSync(args.whitelistCaseIdsFile)) {
    errors.push(`whitelist_case_ids_file does not exist: ${args.whitelistCaseIdsFile}`);
  }

  if (args.holdoutRatio < 0 || args.holdoutRatio > 1) {
    errors.push("holdout_ratio must be between 0 and 1");
  }
  if (args.similarityThreshold < 0 || args.similarityThreshold > 1) {
    errors.push("similarity_threshold must be between 0 and 1");
  }

  const intChecks: Record<string, number> = {
    max_cases: args.maxCases,
    min_chars: args.minChars,
    min_prompt_chars: args.minPromptChars,
    min_response_chars: args.minResponseChars,
    max_exact_duplicates_per_prompt: args.maxExactDuplicatesPerPrompt,
    max_near_duplicates_per_anchor: args.maxNearDuplicatesPerAnchor,
    min_cases_per_split: args.minCasesPerSplit,
    min_clean_cases: args.minCleanCases,
  };
  for (const [key, value] of Object.entries(intChecks)) {
    if (value < 0) {
      errors.push(`${key} must be >= 0`);
    }
  }

  for (const [splitName, threshold] of Object.entries(splitThresholds)) {
    if (threshold < 0) {
      errors.push(`split threshold must be >= 0: ${splitName}=${threshold}`);
    }
  }

  const outputPaths: Record<string, string> = {
    trace_cases_output: args.traceCasesOutput,
    trace_runs_output: args.traceRunsOutput,
    clean_cases_output: args.cleanCasesOutput,
    clean_runs_output: args.cleanRunsOutput,
    clean_report_output: args.cleanReportOutput,
  };
  for (const [key, target] of Object.entries(outputPaths)) {
    const probe = findExistingParent(target);
    if (probe === null) {
      errors.push(`${key} has no existing parent to create from: ${target}`);
      continue;
    }
    if (!statSync(probe).isDirectory()) {
      errors.push(`${key} parent is not a directory: ${probe}`);
      continue;
    }
    try {
      accessSync(probe, constants.W_OK);
    } catch {
      errors.push(`${key} parent is not writable: ${probe}`);
    }
  }
  return errors;
}

function countCasesBySplit(path: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const raw = readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const [index, lineRaw] of lines.entries()) {
    const line = lineRaw.trim();
    if (!line) {
      continue;
    }
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      throw new Error(`${path}:${index + 1}: invalid json row`);
    }
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      continue;
    }
    const splitRaw = (row as JsonObject).split;
    const split = typeof splitRaw === "string" && splitRaw.trim().length > 0 ? splitRaw : "optimization";
    counts[split] = (counts[split] ?? 0) + 1;
  }
  return counts;
}

function runTracePipeline(
  args: TracePipelineArgs,
  splitThresholds: Record<string, number>,
): JsonObject {
  const mineStats = mineTraceSessions({
    sessionsDir: args.sessionsDir,
    casesOutput: args.traceCasesOutput,
    runsOutput: args.traceRunsOutput,
    variant: args.variant,
    holdoutRatio: args.holdoutRatio,
    seed: args.seed,
    maxCases: args.maxCases,
    minChars: args.minChars,
  });
  const cleanReport = cleanTraceDataset({
    casesInput: args.traceCasesOutput,
    runsInput: args.traceRunsOutput,
    casesOutput: args.cleanCasesOutput,
    runsOutput: args.cleanRunsOutput,
    reportOutput: args.cleanReportOutput,
    minPromptChars: args.minPromptChars,
    minResponseChars: args.minResponseChars,
    maxExactDuplicatesPerPrompt: args.maxExactDuplicatesPerPrompt,
    similarityThreshold: args.similarityThreshold,
    maxNearDuplicatesPerAnchor: args.maxNearDuplicatesPerAnchor,
    whitelistCaseIdsFile: args.whitelistCaseIdsFile,
    minCasesPerSplit: args.minCasesPerSplit,
  });
  const cleanStatsRaw = cleanReport.stats;
  const cleanStats =
    typeof cleanStatsRaw === "object" && cleanStatsRaw !== null && !Array.isArray(cleanStatsRaw)
      ? (cleanStatsRaw as JsonObject)
      : {};
  const actualCleanCasesRaw = cleanStats.output_cases;
  const actualCleanCases =
    typeof actualCleanCasesRaw === "number" && Number.isInteger(actualCleanCasesRaw) ? actualCleanCasesRaw : 0;

  const splitCounts = countCasesBySplit(args.cleanCasesOutput);
  const splitResults: Record<string, SampleGuardSplitResult> = {};
  let splitPass = true;
  for (const [splitName, threshold] of Object.entries(splitThresholds)) {
    const actual = splitCounts[splitName] ?? 0;
    const passed = actual >= threshold;
    splitResults[splitName] = { required: threshold, actual, pass: passed };
    if (!passed) {
      splitPass = false;
    }
  }

  const sampleGuard: JsonObject = {
    enabled: args.minCleanCases > 0,
    min_clean_cases: args.minCleanCases,
    actual_clean_cases: actualCleanCases,
    pass: args.minCleanCases > 0 ? actualCleanCases >= args.minCleanCases : true,
    split: {
      enabled: Object.keys(splitThresholds).length > 0,
      thresholds: splitThresholds,
      counts: splitCounts,
      pass: splitPass,
      results: splitResults,
    },
  };

  if (args.failOnLowSample && sampleGuard.pass !== true) {
    throw new Error(
      `cleaned cases below threshold: actual=${actualCleanCases}, required=${args.minCleanCases}`,
    );
  }
  if (args.failOnSplitUnderflow && !splitPass) {
    const failedItems: string[] = [];
    for (const [splitName, payload] of Object.entries(splitResults)) {
      if (!payload.pass) {
        failedItems.push(`${splitName}:${payload.actual}/${payload.required}`);
      }
    }
    throw new Error(`split sample below threshold: ${failedItems.join(",")}`);
  }

  return {
    mine: {
      sessions_dir: args.sessionsDir,
      cases_output: args.traceCasesOutput,
      runs_output: args.traceRunsOutput,
      stats: mineStats,
    },
    clean: cleanReport,
    sample_guard: sampleGuard,
  };
}

export function runCli(argv: string[]): number {
  const { args, splitThresholds } = parseCliArgs(argv);
  const validationErrors = validateTracePipelineInputs(args, splitThresholds);

  let policyHash: string | null = null;
  let policyCanonical: JsonObject | null = null;
  if (args.policyPath !== null) {
    const fingerprint = computeTracePipelinePolicyFingerprint(args.policyPath);
    policyHash = fingerprint.policyHash;
    policyCanonical = fingerprint.canonical;
  }

  if (args.dryValidateOnly) {
    const dryOutput: JsonObject = {
      dry_validate_only: true,
      ok: validationErrors.length === 0,
      errors: validationErrors,
      policy: args.policyPath,
      policy_profile: args.policyProfile,
      policy_schema_version: args.policySchemaVersion,
      policy_hash: policyHash,
      inputs: {
        sessions_dir: args.sessionsDir,
        trace_cases_output: args.traceCasesOutput,
        trace_runs_output: args.traceRunsOutput,
        clean_cases_output: args.cleanCasesOutput,
        clean_runs_output: args.cleanRunsOutput,
        clean_report_output: args.cleanReportOutput,
      },
    };
    if (args.printJson && policyCanonical !== null) {
      dryOutput.policy_canonical = policyCanonical;
    }
    process.stdout.write(formatJson(dryOutput, args.printJson));
    return validationErrors.length > 0 ? 1 : 0;
  }

  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join("; "));
  }

  const report = runTracePipeline(args, splitThresholds);
  if (args.printJson) {
    process.stdout.write(formatJson(report, true));
    return 0;
  }

  const mine = (report.mine as JsonObject | undefined) ?? {};
  const clean = (report.clean as JsonObject | undefined) ?? {};
  const cleanOutputsRaw = clean.outputs;
  const cleanOutputs =
    typeof cleanOutputsRaw === "object" && cleanOutputsRaw !== null && !Array.isArray(cleanOutputsRaw)
      ? (cleanOutputsRaw as JsonObject)
      : {};
  const output: JsonObject = {
    mine_stats: mine.stats ?? {},
    clean_stats: clean.stats ?? {},
    sample_guard: report.sample_guard ?? {},
    policy: args.policyPath,
    policy_profile: args.policyProfile,
    policy_schema_version: args.policySchemaVersion,
    policy_hash: policyHash,
    outputs: {
      trace_cases: mine.cases_output ?? args.traceCasesOutput,
      trace_runs: mine.runs_output ?? args.traceRunsOutput,
      clean_cases: cleanOutputs.cases ?? args.cleanCasesOutput,
      clean_runs: cleanOutputs.runs ?? args.cleanRunsOutput,
    },
  };
  process.stdout.write(formatJson(output, false));
  return 0;
}

const entryScript = process.argv[1] ?? "";
const shouldRunCli = entryScript.includes("trace-pipeline");

if (shouldRunCli) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`trace-pipeline fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
