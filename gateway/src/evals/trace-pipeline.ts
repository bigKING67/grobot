import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import {
  computeTracePipelinePolicyFingerprint,
  loadTracePipelinePolicy,
} from "./trace-policy-guard";
import { cleanTraceDataset } from "./trace-clean";
import { mineTraceSessions } from "./trace-mining";

type JsonObject = Record<string, unknown>;

interface TracePipelineArgs {
  policyPath: string | null;
  sessionsDir: string;
  traceCasesOutput: string;
  traceRunsOutput: string;
  variant: string;
  holdoutRatio: number;
  seed: number;
  maxCases: number;
  minChars: number;
  cleanCasesOutput: string;
  cleanRunsOutput: string;
  cleanReportOutput: string;
  minPromptChars: number;
  minResponseChars: number;
  maxExactDuplicatesPerPrompt: number;
  similarityThreshold: number;
  maxNearDuplicatesPerAnchor: number;
  minCasesPerSplit: number;
  minCleanCases: number;
  failOnLowSample: boolean;
  minCleanCasesBySplitRaw: unknown;
  failOnSplitUnderflow: boolean;
  whitelistCaseIdsFile: string | null;
  dryValidateOnly: boolean;
  printJson: boolean;
  policyProfile: string | null;
  policySchemaVersion: number | null;
}

interface ParsedCliArgs {
  args: TracePipelineArgs;
  splitThresholds: Record<string, number>;
}

interface SampleGuardSplitResult {
  required: number;
  actual: number;
  pass: boolean;
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

function parseSplitThresholdsFromString(raw: string): Record<string, number> {
  if (!raw.trim()) {
    return {};
  }
  const thresholds: Record<string, number> = {};
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

function coerceSplitThresholds(value: unknown): Record<string, number> {
  if (value == null) {
    return {};
  }
  if (typeof value === "string") {
    return parseSplitThresholdsFromString(value);
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("min_clean_cases_by_split must be string or object");
  }
  const thresholds: Record<string, number> = {};
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

function formatJson(value: unknown, pretty: boolean): string {
  if (pretty) {
    return `${JSON.stringify(value, undefined, 2)}\n`;
  }
  return `${JSON.stringify(value)}\n`;
}

function buildDefaultArgs(): TracePipelineArgs {
  return {
    policyPath: null,
    sessionsDir: ".grobot/sessions",
    traceCasesOutput: "gateway/evals/data/cases.trace.jsonl",
    traceRunsOutput: "gateway/evals/data/runs.trace_baseline.jsonl",
    variant: "trace_baseline",
    holdoutRatio: 0.2,
    seed: 42,
    maxCases: 0,
    minChars: 8,
    cleanCasesOutput: "gateway/evals/data/cases.trace.cleaned.jsonl",
    cleanRunsOutput: "gateway/evals/data/runs.trace.cleaned.jsonl",
    cleanReportOutput: "gateway/evals/data/trace_clean_report.json",
    minPromptChars: 8,
    minResponseChars: 8,
    maxExactDuplicatesPerPrompt: 2,
    similarityThreshold: 0.88,
    maxNearDuplicatesPerAnchor: 1,
    minCasesPerSplit: 0,
    minCleanCases: 0,
    failOnLowSample: false,
    minCleanCasesBySplitRaw: "",
    failOnSplitUnderflow: false,
    whitelistCaseIdsFile: null,
    dryValidateOnly: false,
    printJson: false,
    policyProfile: null,
    policySchemaVersion: null,
  };
}

function readArgValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1] ?? "";
  if (!value || value.startsWith("--")) {
    throw new Error(`missing value for ${flag}`);
  }
  return value;
}

function parseInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${flag} must be int`);
  }
  return parsed;
}

function parseFloatNumber(value: string, flag: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be number`);
  }
  return parsed;
}

function applyPolicyDefaults(args: TracePipelineArgs, policyPath: string): void {
  const policy = loadTracePipelinePolicy(policyPath);
  const mapPathField = (key: string): string | null => {
    const value = policy[key];
    if (value == null) {
      return null;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`policy field ${key} must be non-empty string`);
    }
    return normalizePath(value);
  };

  const sessionsDir = mapPathField("sessions_dir");
  if (sessionsDir) {
    args.sessionsDir = sessionsDir;
  }
  const traceCasesOutput = mapPathField("trace_cases_output");
  if (traceCasesOutput) {
    args.traceCasesOutput = traceCasesOutput;
  }
  const traceRunsOutput = mapPathField("trace_runs_output");
  if (traceRunsOutput) {
    args.traceRunsOutput = traceRunsOutput;
  }
  const cleanCasesOutput = mapPathField("clean_cases_output");
  if (cleanCasesOutput) {
    args.cleanCasesOutput = cleanCasesOutput;
  }
  const cleanRunsOutput = mapPathField("clean_runs_output");
  if (cleanRunsOutput) {
    args.cleanRunsOutput = cleanRunsOutput;
  }
  const cleanReportOutput = mapPathField("clean_report_output");
  if (cleanReportOutput) {
    args.cleanReportOutput = cleanReportOutput;
  }

  const whitelistCaseIdsFile = policy.whitelist_case_ids_file;
  if (whitelistCaseIdsFile === null) {
    args.whitelistCaseIdsFile = null;
  } else if (typeof whitelistCaseIdsFile === "string" && whitelistCaseIdsFile.trim().length > 0) {
    args.whitelistCaseIdsFile = normalizePath(whitelistCaseIdsFile);
  }

  const variant = policy.variant;
  if (typeof variant === "string" && variant.trim().length > 0) {
    args.variant = variant;
  }

  const holdoutRatio = policy.holdout_ratio;
  if (typeof holdoutRatio === "number") {
    args.holdoutRatio = holdoutRatio;
  }
  const seed = policy.seed;
  if (typeof seed === "number" && Number.isInteger(seed)) {
    args.seed = seed;
  }
  const maxCases = policy.max_cases;
  if (typeof maxCases === "number" && Number.isInteger(maxCases)) {
    args.maxCases = maxCases;
  }
  const minChars = policy.min_chars;
  if (typeof minChars === "number" && Number.isInteger(minChars)) {
    args.minChars = minChars;
  }
  const minPromptChars = policy.min_prompt_chars;
  if (typeof minPromptChars === "number" && Number.isInteger(minPromptChars)) {
    args.minPromptChars = minPromptChars;
  }
  const minResponseChars = policy.min_response_chars;
  if (typeof minResponseChars === "number" && Number.isInteger(minResponseChars)) {
    args.minResponseChars = minResponseChars;
  }
  const maxExactDuplicatesPerPrompt = policy.max_exact_duplicates_per_prompt;
  if (typeof maxExactDuplicatesPerPrompt === "number" && Number.isInteger(maxExactDuplicatesPerPrompt)) {
    args.maxExactDuplicatesPerPrompt = maxExactDuplicatesPerPrompt;
  }
  const similarityThreshold = policy.similarity_threshold;
  if (typeof similarityThreshold === "number") {
    args.similarityThreshold = similarityThreshold;
  }
  const maxNearDuplicatesPerAnchor = policy.max_near_duplicates_per_anchor;
  if (typeof maxNearDuplicatesPerAnchor === "number" && Number.isInteger(maxNearDuplicatesPerAnchor)) {
    args.maxNearDuplicatesPerAnchor = maxNearDuplicatesPerAnchor;
  }
  const minCasesPerSplit = policy.min_cases_per_split;
  if (typeof minCasesPerSplit === "number" && Number.isInteger(minCasesPerSplit)) {
    args.minCasesPerSplit = minCasesPerSplit;
  }
  const minCleanCases = policy.min_clean_cases;
  if (typeof minCleanCases === "number" && Number.isInteger(minCleanCases)) {
    args.minCleanCases = minCleanCases;
  }
  const failOnLowSample = policy.fail_on_low_sample;
  if (typeof failOnLowSample === "boolean") {
    args.failOnLowSample = failOnLowSample;
  }
  if ("min_clean_cases_by_split" in policy) {
    args.minCleanCasesBySplitRaw = policy.min_clean_cases_by_split;
  }
  const failOnSplitUnderflow = policy.fail_on_split_underflow;
  if (typeof failOnSplitUnderflow === "boolean") {
    args.failOnSplitUnderflow = failOnSplitUnderflow;
  }
  const profile = policy.profile;
  if (typeof profile === "string" && profile.trim().length > 0) {
    args.policyProfile = profile.trim();
  }
  const schemaVersion = policy.schema_version;
  if (typeof schemaVersion === "number" && Number.isInteger(schemaVersion)) {
    args.policySchemaVersion = schemaVersion;
  }
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const args = buildDefaultArgs();
  let prePolicyPath: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--policy") {
      continue;
    }
    const value = readArgValue(argv, index, "--policy");
    prePolicyPath = value;
    index += 1;
  }
  if (prePolicyPath !== null) {
    args.policyPath = prePolicyPath;
    applyPolicyDefaults(args, prePolicyPath);
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--policy": {
        args.policyPath = readArgValue(argv, index, "--policy");
        index += 1;
        break;
      }
      case "--sessions-dir": {
        args.sessionsDir = readArgValue(argv, index, "--sessions-dir");
        index += 1;
        break;
      }
      case "--trace-cases-output": {
        args.traceCasesOutput = readArgValue(argv, index, "--trace-cases-output");
        index += 1;
        break;
      }
      case "--trace-runs-output": {
        args.traceRunsOutput = readArgValue(argv, index, "--trace-runs-output");
        index += 1;
        break;
      }
      case "--variant": {
        args.variant = readArgValue(argv, index, "--variant");
        index += 1;
        break;
      }
      case "--holdout-ratio": {
        args.holdoutRatio = parseFloatNumber(readArgValue(argv, index, "--holdout-ratio"), "--holdout-ratio");
        index += 1;
        break;
      }
      case "--seed": {
        args.seed = parseInteger(readArgValue(argv, index, "--seed"), "--seed");
        index += 1;
        break;
      }
      case "--max-cases": {
        args.maxCases = parseInteger(readArgValue(argv, index, "--max-cases"), "--max-cases");
        index += 1;
        break;
      }
      case "--min-chars": {
        args.minChars = parseInteger(readArgValue(argv, index, "--min-chars"), "--min-chars");
        index += 1;
        break;
      }
      case "--clean-cases-output": {
        args.cleanCasesOutput = readArgValue(argv, index, "--clean-cases-output");
        index += 1;
        break;
      }
      case "--clean-runs-output": {
        args.cleanRunsOutput = readArgValue(argv, index, "--clean-runs-output");
        index += 1;
        break;
      }
      case "--clean-report-output": {
        args.cleanReportOutput = readArgValue(argv, index, "--clean-report-output");
        index += 1;
        break;
      }
      case "--min-prompt-chars": {
        args.minPromptChars = parseInteger(readArgValue(argv, index, "--min-prompt-chars"), "--min-prompt-chars");
        index += 1;
        break;
      }
      case "--min-response-chars": {
        args.minResponseChars = parseInteger(readArgValue(argv, index, "--min-response-chars"), "--min-response-chars");
        index += 1;
        break;
      }
      case "--max-exact-duplicates-per-prompt": {
        args.maxExactDuplicatesPerPrompt = parseInteger(
          readArgValue(argv, index, "--max-exact-duplicates-per-prompt"),
          "--max-exact-duplicates-per-prompt",
        );
        index += 1;
        break;
      }
      case "--similarity-threshold": {
        args.similarityThreshold = parseFloatNumber(
          readArgValue(argv, index, "--similarity-threshold"),
          "--similarity-threshold",
        );
        index += 1;
        break;
      }
      case "--max-near-duplicates-per-anchor": {
        args.maxNearDuplicatesPerAnchor = parseInteger(
          readArgValue(argv, index, "--max-near-duplicates-per-anchor"),
          "--max-near-duplicates-per-anchor",
        );
        index += 1;
        break;
      }
      case "--min-cases-per-split": {
        args.minCasesPerSplit = parseInteger(
          readArgValue(argv, index, "--min-cases-per-split"),
          "--min-cases-per-split",
        );
        index += 1;
        break;
      }
      case "--min-clean-cases": {
        args.minCleanCases = parseInteger(readArgValue(argv, index, "--min-clean-cases"), "--min-clean-cases");
        index += 1;
        break;
      }
      case "--fail-on-low-sample": {
        args.failOnLowSample = true;
        break;
      }
      case "--min-clean-cases-by-split": {
        args.minCleanCasesBySplitRaw = readArgValue(argv, index, "--min-clean-cases-by-split");
        index += 1;
        break;
      }
      case "--fail-on-split-underflow": {
        args.failOnSplitUnderflow = true;
        break;
      }
      case "--whitelist-case-ids-file": {
        args.whitelistCaseIdsFile = readArgValue(argv, index, "--whitelist-case-ids-file");
        index += 1;
        break;
      }
      case "--dry-validate-only": {
        args.dryValidateOnly = true;
        break;
      }
      case "--print-json": {
        args.printJson = true;
        break;
      }
      default: {
        throw new Error(`unknown argument: ${token}`);
      }
    }
  }

  const splitThresholds = coerceSplitThresholds(args.minCleanCasesBySplitRaw);
  return { args, splitThresholds };
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
