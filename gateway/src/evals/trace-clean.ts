import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

type JsonObject = Record<string, unknown>;

const REDACTED_SECRET = "[REDACTED_SECRET]";

const SENSITIVE_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/gi,
  /api[_-]?key\s*[:=]\s*[A-Za-z0-9._-]+/gi,
  /authorization\s*:\s*bearer\s+[A-Za-z0-9._-]+/gi,
  /bearer\s+[A-Za-z0-9._-]{12,}/gi,
];

interface CleanTraceDatasetArgs {
  casesInput: string;
  runsInput: string;
  casesOutput: string;
  runsOutput: string;
  reportOutput: string;
  minPromptChars: number;
  minResponseChars: number;
  maxExactDuplicatesPerPrompt: number;
  similarityThreshold: number;
  maxNearDuplicatesPerAnchor: number;
  whitelistCaseIdsFile: string | null;
  minCasesPerSplit: number;
}

interface ParsedCliArgs extends CleanTraceDatasetArgs {}

interface CleanStats {
  input_cases: number;
  output_cases: number;
  input_runs: number;
  output_runs: number;
  dropped_duplicate_prompt_cases: number;
  dropped_near_duplicate_cases: number;
  dropped_short_prompt_cases: number;
  dropped_invalid_cases: number;
  kept_by_whitelist_cases: number;
  kept_by_split_minimum_cases: number;
  dropped_orphan_runs: number;
  dropped_duplicate_runs: number;
  dropped_short_runs: number;
  dropped_invalid_runs: number;
  redacted_case_prompts: number;
  redacted_case_expectations: number;
  redacted_run_responses: number;
}

interface FallbackCandidate {
  id: string;
  reason: "duplicate_prompt" | "near_duplicate";
  prompt: string;
  anchor_id?: string;
  similarity?: number;
  row: JsonObject;
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

function parseArgs(argv: string[]): ParsedCliArgs {
  const args: ParsedCliArgs = {
    casesInput: "gateway/evals/data/cases.trace.jsonl",
    runsInput: "gateway/evals/data/runs.trace_baseline.jsonl",
    casesOutput: "gateway/evals/data/cases.trace.cleaned.jsonl",
    runsOutput: "gateway/evals/data/runs.trace.cleaned.jsonl",
    reportOutput: "gateway/evals/data/trace_clean_report.json",
    minPromptChars: 8,
    minResponseChars: 8,
    maxExactDuplicatesPerPrompt: 2,
    similarityThreshold: 0.88,
    maxNearDuplicatesPerAnchor: 1,
    whitelistCaseIdsFile: null,
    minCasesPerSplit: 0,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const readValue = (): string => {
      const value = argv[index + 1] ?? "";
      if (!value || value.startsWith("--")) {
        throw new Error(`missing value for ${token}`);
      }
      return value;
    };
    switch (token) {
      case "--cases-input":
        args.casesInput = readValue();
        index += 1;
        break;
      case "--runs-input":
        args.runsInput = readValue();
        index += 1;
        break;
      case "--cases-output":
        args.casesOutput = readValue();
        index += 1;
        break;
      case "--runs-output":
        args.runsOutput = readValue();
        index += 1;
        break;
      case "--report-output":
        args.reportOutput = readValue();
        index += 1;
        break;
      case "--min-prompt-chars":
        args.minPromptChars = parseInteger(readValue(), "--min-prompt-chars");
        index += 1;
        break;
      case "--min-response-chars":
        args.minResponseChars = parseInteger(readValue(), "--min-response-chars");
        index += 1;
        break;
      case "--max-exact-duplicates-per-prompt":
        args.maxExactDuplicatesPerPrompt = parseInteger(readValue(), "--max-exact-duplicates-per-prompt");
        index += 1;
        break;
      case "--similarity-threshold":
        args.similarityThreshold = parseFloatNumber(readValue(), "--similarity-threshold");
        index += 1;
        break;
      case "--max-near-duplicates-per-anchor":
        args.maxNearDuplicatesPerAnchor = parseInteger(readValue(), "--max-near-duplicates-per-anchor");
        index += 1;
        break;
      case "--min-cases-per-split":
        args.minCasesPerSplit = parseInteger(readValue(), "--min-cases-per-split");
        index += 1;
        break;
      case "--whitelist-case-ids-file":
        args.whitelistCaseIdsFile = readValue();
        index += 1;
        break;
      default:
        throw new Error(`unknown argument: ${token}`);
    }
  }
  return args;
}

function loadJsonl(path: string): JsonObject[] {
  const raw = readFileSync(path, "utf8");
  const rows: JsonObject[] = [];
  const lines = raw.split(/\r?\n/);
  for (const [lineNumber, lineRaw] of lines.entries()) {
    const stripped = lineRaw.trim();
    if (!stripped || stripped.startsWith("#")) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch (error) {
      throw new Error(`${path}:${lineNumber + 1}: invalid json: ${String(error)}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${path}:${lineNumber + 1}: each row must be object`);
    }
    rows.push(parsed as JsonObject);
  }
  return rows;
}

function writeJsonl(path: string, rows: JsonObject[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const body = rows.map((item) => JSON.stringify(item)).join("\n");
  if (body.length > 0) {
    writeFileSync(path, `${body}\n`, "utf8");
    return;
  }
  writeFileSync(path, "", "utf8");
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((item) => item.length > 0)
    .join(" ");
}

function tokenizeForSimilarity(value: string): Set<string> {
  const lowered = value.toLowerCase();
  const matches = lowered.match(/[a-z0-9_]+|[\u4e00-\u9fff]/g) ?? [];
  return new Set(matches.filter((token) => token.length > 0));
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set<string>([...left, ...right]).size;
  if (union <= 0) {
    return 0;
  }
  return intersection / union;
}

function loadWhitelistIds(path: string | null): Set<string> {
  if (path === null) {
    return new Set<string>();
  }
  const raw = readFileSync(path, "utf8");
  const ids = new Set<string>();
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    ids.add(line);
  }
  return ids;
}

function redactSensitive(text: string): { value: string; changed: boolean } {
  let redacted = text;
  let changed = false;
  for (const pattern of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(redacted)) {
      pattern.lastIndex = 0;
      redacted = redacted.replace(pattern, REDACTED_SECRET);
      changed = true;
    }
  }
  return { value: redacted, changed };
}

function redactStringList(raw: unknown): { values: string[]; changed: boolean } {
  if (!Array.isArray(raw)) {
    return { values: [], changed: false };
  }
  const output: string[] = [];
  let changed = false;
  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const redacted = redactSensitive(item);
    output.push(redacted.value);
    changed = changed || redacted.changed;
  }
  return { values: output, changed };
}

function copyObject(raw: unknown): JsonObject {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  return { ...(raw as JsonObject) };
}

function prepareCleanCaseRow(
  row: JsonObject,
  promptClean: string,
  isWhitelisted: boolean,
  retainedBySplitMinimum: boolean,
): { caseRow: JsonObject; promptHit: boolean; expectationHit: boolean } {
  const caseRow: JsonObject = { ...row };
  const promptRedacted = redactSensitive(promptClean);

  const expectationsRaw = caseRow.expectations;
  let expectationHit = false;
  if (typeof expectationsRaw === "object" && expectationsRaw !== null && !Array.isArray(expectationsRaw)) {
    const expectations = { ...(expectationsRaw as JsonObject) };
    for (const key of ["required_substrings", "forbidden_substrings", "required_context_items"]) {
      const redacted = redactStringList((expectationsRaw as JsonObject)[key]);
      if (Array.isArray((expectationsRaw as JsonObject)[key])) {
        expectations[key] = redacted.values;
      }
      if (redacted.changed) {
        expectationHit = true;
      }
    }
    caseRow.expectations = expectations;
  }

  caseRow.prompt = promptRedacted.value;
  const metadata = copyObject(caseRow.metadata);
  metadata.cleaned = true;
  metadata.review_required = true;
  metadata.whitelisted = isWhitelisted;
  if (retainedBySplitMinimum) {
    metadata.retained_by_split_minimum = true;
  }
  caseRow.metadata = metadata;
  return { caseRow, promptHit: promptRedacted.changed, expectationHit };
}

function roundTo4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function cleanTraceDataset(args: CleanTraceDatasetArgs): JsonObject {
  if (args.minPromptChars < 1) {
    throw new Error("min_prompt_chars must be >= 1");
  }
  if (args.minResponseChars < 1) {
    throw new Error("min_response_chars must be >= 1");
  }
  if (args.maxExactDuplicatesPerPrompt < 1) {
    throw new Error("max_exact_duplicates_per_prompt must be >= 1");
  }
  if (args.similarityThreshold < 0 || args.similarityThreshold > 1) {
    throw new Error("similarity_threshold must be within [0, 1]");
  }
  if (args.maxNearDuplicatesPerAnchor < 0) {
    throw new Error("max_near_duplicates_per_anchor must be >= 0");
  }
  if (args.minCasesPerSplit < 0) {
    throw new Error("min_cases_per_split must be >= 0");
  }

  const rawCases = loadJsonl(args.casesInput);
  const rawRuns = loadJsonl(args.runsInput);
  const cleanedCases: JsonObject[] = [];
  const cleanedRuns: JsonObject[] = [];
  const reviewItems: JsonObject[] = [];

  const whitelistCaseIds = loadWhitelistIds(args.whitelistCaseIdsFile);
  const promptOccurrenceCount = new Map<string, number>();
  const splitAcceptedPrompts = new Map<string, Array<{ anchorId: string; tokens: Set<string>; promptKey: string }>>();
  const nearDuplicateAcceptCount = new Map<string, number>();
  const keptCaseIds = new Set<string>();
  const splitCandidateCounts = new Map<string, number>();
  const fallbackCandidatesBySplit = new Map<string, FallbackCandidate[]>();

  let droppedDuplicatePromptCases = 0;
  let droppedNearDuplicateCases = 0;
  let droppedShortPromptCases = 0;
  let droppedInvalidCases = 0;
  let keptByWhitelistCases = 0;
  let keptBySplitMinimumCases = 0;
  const retainedBySplitMinimum = new Map<string, number>();
  let redactedCasePrompts = 0;
  let redactedCaseExpectations = 0;

  for (const row of rawCases) {
    const caseIdRaw = row.id;
    const promptRaw = row.prompt;
    if (typeof caseIdRaw !== "string" || caseIdRaw.trim().length === 0) {
      droppedInvalidCases += 1;
      continue;
    }
    if (typeof promptRaw !== "string") {
      droppedInvalidCases += 1;
      continue;
    }
    const caseId = caseIdRaw;
    const promptClean = promptRaw.trim();
    if (promptClean.length < args.minPromptChars) {
      droppedShortPromptCases += 1;
      continue;
    }
    const splitRaw = row.split;
    const split = typeof splitRaw === "string" && splitRaw.length > 0 ? splitRaw : "optimization";
    splitCandidateCounts.set(split, (splitCandidateCounts.get(split) ?? 0) + 1);
    const promptKey = normalizeText(promptClean);
    const isWhitelisted = whitelistCaseIds.has(caseId);
    const occurrenceKey = `${split}::${promptKey}`;
    const occurrence = promptOccurrenceCount.get(occurrenceKey) ?? 0;
    if (!isWhitelisted && occurrence >= args.maxExactDuplicatesPerPrompt) {
      droppedDuplicatePromptCases += 1;
      const list = fallbackCandidatesBySplit.get(split) ?? [];
      list.push({
        id: caseId,
        reason: "duplicate_prompt",
        prompt: promptClean,
        row: JSON.parse(JSON.stringify(row)) as JsonObject,
      });
      fallbackCandidatesBySplit.set(split, list);
      continue;
    }

    const promptTokens = tokenizeForSimilarity(promptClean);
    if (!isWhitelisted && promptTokens.size > 0) {
      const accepted = splitAcceptedPrompts.get(split) ?? [];
      let bestAnchorId = "";
      let bestSimilarity = 0;
      let bestAnchorPromptKey = "";
      for (const anchor of accepted) {
        if (anchor.promptKey === promptKey) {
          continue;
        }
        const similarity = jaccardSimilarity(promptTokens, anchor.tokens);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestAnchorId = anchor.anchorId;
          bestAnchorPromptKey = anchor.promptKey;
        }
      }
      if (bestAnchorId && bestSimilarity >= args.similarityThreshold) {
        const acceptedNear = nearDuplicateAcceptCount.get(bestAnchorId) ?? 0;
        if (acceptedNear >= args.maxNearDuplicatesPerAnchor) {
          droppedNearDuplicateCases += 1;
          reviewItems.push({
            type: "case_near_duplicate_dropped",
            id: caseId,
            anchor_id: bestAnchorId,
            similarity: roundTo4(bestSimilarity),
            anchor_prompt_key: bestAnchorPromptKey,
          });
          const list = fallbackCandidatesBySplit.get(split) ?? [];
          list.push({
            id: caseId,
            reason: "near_duplicate",
            prompt: promptClean,
            anchor_id: bestAnchorId,
            similarity: roundTo4(bestSimilarity),
            row: JSON.parse(JSON.stringify(row)) as JsonObject,
          });
          fallbackCandidatesBySplit.set(split, list);
          continue;
        }
        nearDuplicateAcceptCount.set(bestAnchorId, acceptedNear + 1);
      }
    }

    promptOccurrenceCount.set(occurrenceKey, occurrence + 1);
    const prepared = prepareCleanCaseRow(row, promptClean, isWhitelisted, false);
    if (prepared.promptHit) {
      redactedCasePrompts += 1;
      reviewItems.push({ type: "case_prompt_redacted", id: caseId });
    }
    if (prepared.expectationHit) {
      redactedCaseExpectations += 1;
      reviewItems.push({ type: "case_expectation_redacted", id: caseId });
    }

    if (isWhitelisted) {
      keptByWhitelistCases += 1;
      reviewItems.push({ type: "case_whitelist_kept", id: caseId });
    }

    cleanedCases.push(prepared.caseRow);
    keptCaseIds.add(caseId);
    const accepted = splitAcceptedPrompts.get(split) ?? [];
    accepted.push({ anchorId: caseId, tokens: promptTokens, promptKey });
    splitAcceptedPrompts.set(split, accepted);
    nearDuplicateAcceptCount.set(caseId, nearDuplicateAcceptCount.get(caseId) ?? 0);
  }

  if (args.minCasesPerSplit > 0) {
    const splitKeptCounts = new Map<string, number>();
    for (const item of cleanedCases) {
      const splitRaw = item.split;
      const split = typeof splitRaw === "string" && splitRaw.length > 0 ? splitRaw : "optimization";
      splitKeptCounts.set(split, (splitKeptCounts.get(split) ?? 0) + 1);
    }
    for (const [split, available] of splitCandidateCounts.entries()) {
      const required = Math.min(args.minCasesPerSplit, available);
      let current = splitKeptCounts.get(split) ?? 0;
      if (current >= required) {
        continue;
      }
      const candidates = fallbackCandidatesBySplit.get(split) ?? [];
      for (const candidate of candidates) {
        if (current >= required) {
          break;
        }
        if (!candidate.id || keptCaseIds.has(candidate.id)) {
          continue;
        }
        const prepared = prepareCleanCaseRow(candidate.row, candidate.prompt, false, true);
        if (prepared.promptHit) {
          redactedCasePrompts += 1;
          reviewItems.push({ type: "case_prompt_redacted", id: candidate.id });
        }
        if (prepared.expectationHit) {
          redactedCaseExpectations += 1;
          reviewItems.push({ type: "case_expectation_redacted", id: candidate.id });
        }
        if (candidate.reason === "duplicate_prompt" && droppedDuplicatePromptCases > 0) {
          droppedDuplicatePromptCases -= 1;
        }
        if (candidate.reason === "near_duplicate" && droppedNearDuplicateCases > 0) {
          droppedNearDuplicateCases -= 1;
        }
        reviewItems.push({
          type: "case_split_minimum_kept",
          id: candidate.id,
          split,
          reason: candidate.reason,
        });
        cleanedCases.push(prepared.caseRow);
        keptCaseIds.add(candidate.id);
        keptBySplitMinimumCases += 1;
        retainedBySplitMinimum.set(split, (retainedBySplitMinimum.get(split) ?? 0) + 1);
        current += 1;
      }
      splitKeptCounts.set(split, current);
    }
  }

  const seenRunKeys = new Set<string>();
  let droppedOrphanRuns = 0;
  let droppedDuplicateRuns = 0;
  let droppedShortRuns = 0;
  let droppedInvalidRuns = 0;
  let redactedRunResponses = 0;

  for (const row of rawRuns) {
    const caseId = row.case_id;
    const variant = row.variant;
    const response = row.assistant_response;
    if (typeof caseId !== "string" || typeof variant !== "string") {
      droppedInvalidRuns += 1;
      continue;
    }
    if (!keptCaseIds.has(caseId)) {
      droppedOrphanRuns += 1;
      continue;
    }
    const key = `${caseId}::${variant}`;
    if (seenRunKeys.has(key)) {
      droppedDuplicateRuns += 1;
      continue;
    }
    seenRunKeys.add(key);
    if (typeof response !== "string") {
      droppedInvalidRuns += 1;
      continue;
    }
    if (response.trim().length < args.minResponseChars) {
      droppedShortRuns += 1;
      continue;
    }
    const redacted = redactSensitive(response);
    if (redacted.changed) {
      redactedRunResponses += 1;
      reviewItems.push({ type: "run_response_redacted", id: caseId, variant });
    }
    const runRow: JsonObject = { ...row, assistant_response: redacted.value };
    const metadata = copyObject(runRow.metadata);
    metadata.cleaned = true;
    runRow.metadata = metadata;
    cleanedRuns.push(runRow);
  }

  writeJsonl(args.casesOutput, cleanedCases);
  writeJsonl(args.runsOutput, cleanedRuns);

  const stats: CleanStats = {
    input_cases: rawCases.length,
    output_cases: cleanedCases.length,
    input_runs: rawRuns.length,
    output_runs: cleanedRuns.length,
    dropped_duplicate_prompt_cases: droppedDuplicatePromptCases,
    dropped_near_duplicate_cases: droppedNearDuplicateCases,
    dropped_short_prompt_cases: droppedShortPromptCases,
    dropped_invalid_cases: droppedInvalidCases,
    kept_by_whitelist_cases: keptByWhitelistCases,
    kept_by_split_minimum_cases: keptBySplitMinimumCases,
    dropped_orphan_runs: droppedOrphanRuns,
    dropped_duplicate_runs: droppedDuplicateRuns,
    dropped_short_runs: droppedShortRuns,
    dropped_invalid_runs: droppedInvalidRuns,
    redacted_case_prompts: redactedCasePrompts,
    redacted_case_expectations: redactedCaseExpectations,
    redacted_run_responses: redactedRunResponses,
  };

  const splitMinimum: JsonObject = {
    enabled: args.minCasesPerSplit > 0,
    min_cases_per_split: args.minCasesPerSplit,
    candidate_counts: Object.fromEntries(splitCandidateCounts.entries()),
    retained_counts: Object.fromEntries(retainedBySplitMinimum.entries()),
  };

  const report: JsonObject = {
    stats,
    inputs: { cases: args.casesInput, runs: args.runsInput },
    outputs: { cases: args.casesOutput, runs: args.runsOutput },
    split_minimum: splitMinimum,
    review_items: reviewItems,
  };
  mkdirSync(dirname(args.reportOutput), { recursive: true });
  writeFileSync(args.reportOutput, `${JSON.stringify(report, undefined, 2)}\n`, "utf8");
  return report;
}

export function runCli(argv: string[]): number {
  const args = parseArgs(argv);
  const report = cleanTraceDataset(args);
  const output: JsonObject = {
    stats: (report.stats as JsonObject | undefined) ?? {},
    report_output: (report.outputs as JsonObject | undefined) ?? {},
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  return 0;
}

const entryScript = process.argv[1] ?? "";
const shouldRunCli = entryScript.includes("trace-clean");

if (shouldRunCli) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`trace-clean fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}

export { REDACTED_SECRET };
