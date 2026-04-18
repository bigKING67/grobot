import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildPromptWithHistory } from "../../../orchestration/entrypoints/dev-cli/start/session-history";
import {
  estimateTokensFromText,
  computeUtilization,
  resolvePromptTargetTokenLimit,
} from "../budget/token-budget";
import { buildCompactSnapshot, buildPromptFromSnapshot } from "../curation/history-curation";
import { getChangedCodeSnapshot } from "../graph/changed-code-snapshot";
import {
  type ContextEngineConfig,
  type ContextHistoryMessage,
  type PromptCompactionStage,
  type PromptPreparationResult,
  type PromptVariant,
} from "../types";

function stageWeight(stage: PromptCompactionStage): number {
  switch (stage) {
    case "normal":
      return 0;
    case "proactive":
      return 1;
    case "forced":
      return 2;
    case "minimal":
      return 3;
    default:
      return 0;
  }
}

export function nextCompactionStage(stage: PromptCompactionStage): PromptCompactionStage | undefined {
  if (stage === "normal") {
    return "proactive";
  }
  if (stage === "proactive") {
    return "forced";
  }
  if (stage === "forced") {
    return "minimal";
  }
  return undefined;
}

export type PromptPreSendCompressionStep =
  | "recent_trim"
  | "snapshot_semantic_compress"
  | "snapshot_trim"
  | "head_trim";

export interface PromptPreSendCompressionPlan {
  strategy: "quality_first" | "hard_budget";
  overflowRatio: number;
  pressureScore: number;
  order: PromptPreSendCompressionStep[];
}

function roundMetric(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1000) / 1000;
}

export function derivePromptPreSendCompressionPlan(args: {
  selectedStage: PromptCompactionStage;
  estimatedTokens: number;
  targetTokenLimit: number;
  qualityGuardActive: boolean;
  qualityGuardSevere: boolean;
  pressureTrendMomentum?: number | null;
}): PromptPreSendCompressionPlan {
  const safeTargetTokenLimit = Math.max(1, Math.floor(args.targetTokenLimit));
  const overflowTokens = Math.max(0, Math.floor(args.estimatedTokens) - safeTargetTokenLimit);
  const overflowRatio = overflowTokens / safeTargetTokenLimit;
  const stagePressure = stageWeight(args.selectedStage) / stageWeight("minimal");
  const trendMomentum = typeof args.pressureTrendMomentum === "number"
    && Number.isFinite(args.pressureTrendMomentum)
    ? Math.max(-1, Math.min(1, args.pressureTrendMomentum))
    : 0;
  const trendPressure = Math.max(0, trendMomentum) * 0.2;
  const guardPressure = args.qualityGuardActive ? 0.18 : 0;
  const severePressure = args.qualityGuardSevere ? 0.12 : 0;
  const pressureScore = Math.min(
    1,
    overflowRatio * 0.75 + stagePressure * 0.35 + trendPressure + guardPressure + severePressure,
  );
  const strategy: PromptPreSendCompressionPlan["strategy"] =
    overflowRatio >= 0.18 || pressureScore >= 0.62
      ? "hard_budget"
      : "quality_first";
  const order: PromptPreSendCompressionStep[] = strategy === "hard_budget"
    ? ["recent_trim", "snapshot_trim", "snapshot_semantic_compress", "head_trim"]
    : ["recent_trim", "snapshot_semantic_compress", "snapshot_trim", "head_trim"];
  return {
    strategy,
    overflowRatio: roundMetric(overflowRatio),
    pressureScore: roundMetric(pressureScore),
    order,
  };
}

function normalizeHistory(history: readonly ContextHistoryMessage[]): ContextHistoryMessage[] {
  return history
    .map((row): ContextHistoryMessage => ({
      role: row.role === "assistant" ? "assistant" : "user",
      content: row.content.trim(),
    }))
    .filter((row) => row.content.length > 0);
}

function buildVariants(args: {
  userText: string;
  history: readonly ContextHistoryMessage[];
  historyTurns: number;
  workDir?: string;
  config: ContextEngineConfig;
}): PromptVariant[] {
  const history = normalizeHistory(args.history);
  const changedCodeSnapshot =
    args.config.dependencyGraph.enabled || args.config.symbolGraph.enabled
      ? getChangedCodeSnapshot({
        workDir: args.workDir,
        maxFiles: 40,
        maxFileBytes: 250_000,
        includeUntracked: true,
        cacheTtlMs: 1_500,
      })
      : undefined;
  const snapshotBaseOptions = {
    workDir: args.workDir,
    lineageEnabled: args.config.lineage.enabled,
    lineageMaxRows: args.config.lineage.maxRows,
    lineageMaxCommits: args.config.lineage.maxCommits,
    lineageCacheTtlMs: args.config.lineage.cacheTtlMs,
    workspaceSignalsEnabled: args.config.workspaceSignals.enabled,
    workspaceSignalsMaxRows: args.config.workspaceSignals.maxRows,
    workspaceSignalsIncludeUntracked: args.config.workspaceSignals.includeUntracked,
    workspaceSignalsCacheTtlMs: args.config.workspaceSignals.cacheTtlMs,
    dependencyGraphEnabled: args.config.dependencyGraph.enabled,
    dependencyGraphMaxRows: args.config.dependencyGraph.maxRows,
    symbolGraphEnabled: args.config.symbolGraph.enabled,
    symbolGraphMaxRows: args.config.symbolGraph.maxRows,
    changedCodeSnapshot,
  };
  const snapshotProactive = buildCompactSnapshot(
    args.userText,
    history,
    4,
    240,
    snapshotBaseOptions,
  );
  const snapshotForced = buildCompactSnapshot(
    args.userText,
    history,
    2,
    160,
    {
      ...snapshotBaseOptions,
      lineageMaxRows: Math.max(1, Math.min(2, args.config.lineage.maxRows)),
      workspaceSignalsMaxRows: Math.max(1, Math.min(2, args.config.workspaceSignals.maxRows)),
      dependencyGraphMaxRows: Math.max(1, Math.min(2, args.config.dependencyGraph.maxRows)),
      symbolGraphMaxRows: Math.max(1, Math.min(2, args.config.symbolGraph.maxRows)),
    },
  );
  const snapshotMinimal = buildCompactSnapshot(
    args.userText,
    history,
    1,
    120,
    {
      ...snapshotBaseOptions,
      lineageEnabled: false,
      dependencyGraphEnabled: false,
      symbolGraphEnabled: false,
      workspaceSignalsMaxRows: 1,
    },
  );
  const recentNormal = history.slice(-Math.max(1, Math.min(args.historyTurns, 6)) * 2);
  const recentProactive = history.slice(-6);
  const recentForced = history.slice(-2);
  const normalPrompt = buildPromptWithHistory(args.userText, history, Math.min(args.historyTurns, 6));
  const proactivePrompt = buildPromptFromSnapshot({
    userText: args.userText,
    snapshot: snapshotProactive,
    recentRows: recentProactive,
    includeRecentRows: true,
  });
  const forcedPrompt = buildPromptFromSnapshot({
    userText: args.userText,
    snapshot: snapshotForced,
    recentRows: recentForced,
    includeRecentRows: true,
  });
  const minimalPrompt = buildPromptFromSnapshot({
    userText: args.userText,
    snapshot: snapshotMinimal,
    recentRows: [],
    includeRecentRows: false,
  });
  const variants: PromptVariant[] = [
    { stage: "normal", prompt: normalPrompt, estimatedTokens: estimateTokensFromText(normalPrompt) },
    { stage: "proactive", prompt: proactivePrompt, estimatedTokens: estimateTokensFromText(proactivePrompt) },
    { stage: "forced", prompt: forcedPrompt, estimatedTokens: estimateTokensFromText(forcedPrompt) },
    { stage: "minimal", prompt: minimalPrompt, estimatedTokens: estimateTokensFromText(minimalPrompt) },
  ];
  // Keep deterministic order and remove accidental duplicates by stage.
  return variants
    .sort((left, right) => stageWeight(left.stage) - stageWeight(right.stage))
    .filter((row, index, rows) => rows.findIndex((item) => item.stage === row.stage) === index);
}

function selectStageByUtilization(
  utilization: number,
  config: ContextEngineConfig,
): PromptCompactionStage {
  if (utilization >= config.thresholds.hardRatio) {
    return "minimal";
  }
  if (utilization >= config.thresholds.forcedRatio) {
    return "forced";
  }
  if (utilization >= config.thresholds.proactiveRatio) {
    return "proactive";
  }
  return "normal";
}

function applyAutoCompactGuardToStage(args: {
  baseStage: PromptCompactionStage;
  totalEstimatedTokens: number;
  autoCompactTokenLimit: number;
}): {
  stage: PromptCompactionStage;
  autoCompactLimitTriggered: boolean;
} {
  const autoCompactLimitTriggered = args.totalEstimatedTokens >= args.autoCompactTokenLimit;
  if (!autoCompactLimitTriggered) {
    return {
      stage: args.baseStage,
      autoCompactLimitTriggered: false,
    };
  }
  if (stageWeight(args.baseStage) >= stageWeight("proactive")) {
    return {
      stage: args.baseStage,
      autoCompactLimitTriggered: true,
    };
  }
  return {
    stage: "proactive",
    autoCompactLimitTriggered: true,
  };
}

export function shouldTriggerDownshiftPrecompact(args: {
  allowProactiveCompaction: boolean;
  previousTargetTokenLimit?: number;
  currentTargetTokenLimit: number;
  totalEstimatedTokens: number;
}): boolean {
  if (!args.allowProactiveCompaction) {
    return false;
  }
  if (typeof args.previousTargetTokenLimit !== "number") {
    return false;
  }
  if (args.currentTargetTokenLimit >= args.previousTargetTokenLimit) {
    return false;
  }
  return args.totalEstimatedTokens > args.currentTargetTokenLimit;
}

function findVariant(
  variants: readonly PromptVariant[],
  stage: PromptCompactionStage,
): PromptVariant {
  const match = variants.find((item) => item.stage === stage);
  if (match) {
    return match;
  }
  return variants[0] as PromptVariant;
}

function selectVariantWithBudgetGuard(args: {
  variants: readonly PromptVariant[];
  thresholdStage: PromptCompactionStage;
  targetTokenLimit: number;
}): {
  selected: PromptVariant;
  selectionReason: "threshold" | "budget_guard";
} {
  const thresholdVariant = findVariant(args.variants, args.thresholdStage);
  if (thresholdVariant.estimatedTokens <= args.targetTokenLimit) {
    return {
      selected: thresholdVariant,
      selectionReason: "threshold",
    };
  }
  let fallback = thresholdVariant;
  let stageCursor: PromptCompactionStage | undefined = thresholdVariant.stage;
  while (stageCursor) {
    const nextStage = nextCompactionStage(stageCursor);
    if (!nextStage) {
      break;
    }
    const candidate = findVariant(args.variants, nextStage);
    if (candidate.estimatedTokens < fallback.estimatedTokens) {
      fallback = candidate;
    }
    if (candidate.estimatedTokens <= args.targetTokenLimit) {
      return {
        selected: candidate,
        selectionReason: "budget_guard",
      };
    }
    stageCursor = nextStage;
  }
  return {
    selected: fallback,
    selectionReason: "budget_guard",
  };
}

export function preparePromptWithBudget(args: {
  userText: string;
  history: readonly ContextHistoryMessage[];
  historyTurns: number;
  workDir?: string;
  config: ContextEngineConfig;
}): PromptPreparationResult {
  const variants = buildVariants({
    userText: args.userText,
    history: args.history,
    historyTurns: args.historyTurns,
    workDir: args.workDir,
    config: args.config,
  });
  const { effectiveWindowTokens, autoCompactTokenLimit, targetTokenLimit } =
    resolvePromptTargetTokenLimit(args.config);
  const totalEstimatedTokens = variants[0]?.estimatedTokens ?? 0;
  const utilization = computeUtilization(totalEstimatedTokens, effectiveWindowTokens);
  const utilizationStage = args.config.enabled
    ? selectStageByUtilization(utilization, args.config)
    : "normal";
  const stageGuard = args.config.enabled
    ? applyAutoCompactGuardToStage({
      baseStage: utilizationStage,
      totalEstimatedTokens,
      autoCompactTokenLimit,
    })
    : {
      stage: utilizationStage,
      autoCompactLimitTriggered: false,
    };
  const thresholdStage = stageGuard.stage;
  const selection = args.config.enabled
    ? selectVariantWithBudgetGuard({
      variants,
      thresholdStage,
      targetTokenLimit,
    })
    : {
      selected: findVariant(variants, thresholdStage),
      selectionReason: "threshold" as const,
    };
  return {
    selected: selection.selected,
    variants: [...variants],
    thresholdStage,
    selectionReason: selection.selectionReason,
    autoCompactTokenLimit,
    targetTokenLimit,
    autoCompactLimitTriggered: stageGuard.autoCompactLimitTriggered,
    utilization,
    selectedUtilization: computeUtilization(selection.selected.estimatedTokens, effectiveWindowTokens),
    effectiveWindowTokens,
    totalEstimatedTokens,
  };
}

export function escalatePromptVariant(
  variants: readonly PromptVariant[],
  currentStage: PromptCompactionStage,
): PromptVariant | undefined {
  const nextStage = nextCompactionStage(currentStage);
  if (!nextStage) {
    return undefined;
  }
  return variants.find((item) => item.stage === nextStage);
}

export function truncatePromptHeadForPtlRetry(prompt: string, attempt: number): string {
  const normalizedAttempt = Math.max(1, attempt);
  const lines = prompt.split(/\r?\n/);
  const contextHeaderIndex = lines.findIndex((line) => line.trim() === "[Conversation Context]");
  const userHeaderIndex = lines.findIndex((line) => line.trim() === "[Current User Message]");
  if (contextHeaderIndex < 0 || userHeaderIndex <= contextHeaderIndex + 1) {
    return prompt;
  }
  const contextLines = lines.slice(contextHeaderIndex + 1, userHeaderIndex);
  if (contextLines.length <= 2) {
    return prompt;
  }
  const dropCount = Math.min(
    contextLines.length - 1,
    Math.max(1, Math.floor(contextLines.length * Math.min(0.5, normalizedAttempt * 0.2))),
  );
  const trimmedContext = contextLines.slice(dropCount);
  const rebuilt = [
    ...lines.slice(0, contextHeaderIndex + 1),
    "[earlier conversation truncated for compaction retry]",
    ...trimmedContext,
    ...lines.slice(userHeaderIndex),
  ];
  return rebuilt.join("\n");
}

export function trimPromptRecentTurnsForBudget(args: {
  prompt: string;
  targetTokenLimit: number;
  minRecentRows?: number;
}): {
  prompt: string;
  removedRows: number;
  estimatedTokens: number;
} {
  const targetTokenLimit = Math.max(1, Math.floor(args.targetTokenLimit));
  const minRecentRows = Math.max(0, Math.floor(args.minRecentRows ?? 1));
  const originalPrompt = args.prompt;
  let estimatedTokens = estimateTokensFromText(originalPrompt);
  if (estimatedTokens <= targetTokenLimit) {
    return {
      prompt: originalPrompt,
      removedRows: 0,
      estimatedTokens,
    };
  }

  const lines = originalPrompt.split(/\r?\n/);
  const recentHeaderIndex = lines.findIndex((line) => line.trim() === "[Recent Turns]");
  const userHeaderIndex = lines.findIndex((line) => line.trim() === "[Current User Message]");
  if (recentHeaderIndex < 0 || userHeaderIndex <= recentHeaderIndex + 1) {
    return {
      prompt: originalPrompt,
      removedRows: 0,
      estimatedTokens,
    };
  }

  const recentRows = lines.slice(recentHeaderIndex + 1, userHeaderIndex);
  const nonEmptyRows = recentRows.filter((line) => line.trim().length > 0);
  if (nonEmptyRows.length <= minRecentRows) {
    return {
      prompt: originalPrompt,
      removedRows: 0,
      estimatedTokens,
    };
  }

  const prefix = lines.slice(0, recentHeaderIndex + 1);
  const suffix = lines.slice(userHeaderIndex);
  const maxRemovableRows = Math.max(0, nonEmptyRows.length - minRecentRows);
  let removedRows = 0;
  let currentRows = [...nonEmptyRows];
  let currentPrompt = originalPrompt;

  while (removedRows < maxRemovableRows) {
    currentRows = currentRows.slice(1);
    removedRows += 1;
    const marker = removedRows > 0
      ? ["[earlier recent turns truncated for budget]"]
      : [];
    currentPrompt = [
      ...prefix,
      ...marker,
      ...currentRows,
      ...suffix,
    ].join("\n");
    estimatedTokens = estimateTokensFromText(currentPrompt);
    if (estimatedTokens <= targetTokenLimit) {
      return {
        prompt: currentPrompt,
        removedRows,
        estimatedTokens,
      };
    }
  }

  return {
    prompt: currentPrompt,
    removedRows,
    estimatedTokens,
  };
}

function normalizeSectionKey(raw: string): string {
  return raw.trim().toLowerCase();
}

const SNAPSHOT_SECTION_DROP_ORDER = [
  "tool outputs (pass/fail only)",
  "live workspace changes",
  "symbol graph hints",
  "dependency graph hints",
  "commit lineage hints",
  "current verification status",
  "open todos and rollback notes",
  "modified files and key changes",
] as const;

const SNAPSHOT_SECTION_MANDATORY = new Set<string>([
  "architecture decisions",
  "modified files and key changes",
]);

const SNAPSHOT_SECTION_SEMANTIC_COMPRESS_ORDER = [
  "tool outputs (pass/fail only)",
  "live workspace changes",
  "symbol graph hints",
  "dependency graph hints",
  "commit lineage hints",
  "current verification status",
  "open todos and rollback notes",
] as const;

const SNAPSHOT_SECTION_SEMANTIC_COMPRESS_MAX_ROWS: Record<string, number> = {
  "tool outputs (pass/fail only)": 1,
  "live workspace changes": 2,
  "symbol graph hints": 2,
  "dependency graph hints": 2,
  "commit lineage hints": 2,
  "current verification status": 2,
  "open todos and rollback notes": 2,
};

const SNAPSHOT_SECTION_SEMANTIC_MAX_CHARS = 160;
const SNAPSHOT_GENERATIVE_SUMMARY_MAX_CHARS = 128;
const SNAPSHOT_GENERATIVE_DEFAULT_TIMEOUT_MS = 1_200;
const SNAPSHOT_GENERATIVE_MIN_TIMEOUT_MS = 300;
const SNAPSHOT_GENERATIVE_MAX_TIMEOUT_MS = 8_000;
const SNAPSHOT_GENERATIVE_DEFAULT_MAX_EVIDENCE = 6;
const SNAPSHOT_GENERATIVE_MAX_EVIDENCE = 16;

interface PromptSemanticGenerationContext {
  available: boolean;
  warning?: string;
  technicalTerms: string[];
  topPaths: string[];
  evidencePaths: string[];
}

function clampInteger(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < min) {
    return min;
  }
  if (normalized > max) {
    return max;
  }
  return normalized;
}

function normalizeWarning(raw: string): string | undefined {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (!compact) {
    return undefined;
  }
  if (compact.length <= 220) {
    return compact;
  }
  return `${compact.slice(0, 219).trimEnd()}...`;
}

function toStringArray(raw: unknown, maxRows: number): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
    if (output.length >= maxRows) {
      break;
    }
  }
  return output;
}

function resolveContextWeaverBridgeScriptPath(workDir: string): string | undefined {
  const bridgeRelativePath = ["adapters", "contextweaver", "bridge", "cli.mjs"];
  let cursor = resolve(workDir);
  while (true) {
    const candidate = resolve(cursor, ...bridgeRelativePath);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = resolve(cursor, "..");
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  return undefined;
}

function stripAnsiSequences(raw: string): string {
  return raw.replace(/\u001b\[[0-9;]*m/g, "");
}

function readFirstJsonObjectLine(stdout: string): Record<string, unknown> | undefined {
  const lines = stdout
    .split(/\r?\n/)
    .map((item) => stripAnsiSequences(item).trim())
    .filter((item) => item.length > 0);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] as string;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      const firstBrace = line.indexOf("{");
      const lastBrace = line.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        const candidate = line.slice(firstBrace, lastBrace + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
        } catch {
          // ignore and continue scanning lines.
        }
      }
    }
  }
  return undefined;
}

function collectPathHintsFromEvidence(raw: unknown, maxRows: number): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }
    const row = item as Record<string, unknown>;
    const path = typeof row.path === "string" ? row.path.trim() : "";
    if (!path) {
      continue;
    }
    const key = path.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(path);
    if (output.length >= maxRows) {
      break;
    }
  }
  return output;
}

function loadPromptSemanticGenerationContext(args: {
  workDir?: string;
  prompt: string;
  timeoutMs?: number;
  maxEvidence?: number;
}): PromptSemanticGenerationContext {
  const workDir = typeof args.workDir === "string" ? args.workDir.trim() : "";
  if (!workDir) {
    return {
      available: false,
      warning: "semantic generation skipped: missing work dir",
      technicalTerms: [],
      topPaths: [],
      evidencePaths: [],
    };
  }
  const bridgeScriptPath = resolveContextWeaverBridgeScriptPath(workDir);
  if (!bridgeScriptPath) {
    return {
      available: false,
      warning: "semantic generation skipped: contextweaver bridge not found",
      technicalTerms: [],
      topPaths: [],
      evidencePaths: [],
    };
  }
  const timeoutMs = clampInteger(
    typeof args.timeoutMs === "number" ? args.timeoutMs : SNAPSHOT_GENERATIVE_DEFAULT_TIMEOUT_MS,
    SNAPSHOT_GENERATIVE_DEFAULT_TIMEOUT_MS,
    SNAPSHOT_GENERATIVE_MIN_TIMEOUT_MS,
    SNAPSHOT_GENERATIVE_MAX_TIMEOUT_MS,
  );
  const maxEvidence = clampInteger(
    typeof args.maxEvidence === "number" ? args.maxEvidence : SNAPSHOT_GENERATIVE_DEFAULT_MAX_EVIDENCE,
    SNAPSHOT_GENERATIVE_DEFAULT_MAX_EVIDENCE,
    1,
    SNAPSHOT_GENERATIVE_MAX_EVIDENCE,
  );
  const payload = JSON.stringify({
    prompt: args.prompt.trim(),
    maxEvidence,
    sourceConcurrency: 1,
    refresh: "auto",
    sourceRoots: [
      {
        source: "code",
        rootPath: workDir,
      },
    ],
  });
  const nodeBinary = typeof process.argv[0] === "string" && process.argv[0].trim().length > 0
    ? process.argv[0].trim()
    : "node";
  const spawnOptions = {
    cwd: workDir,
    encoding: "utf8",
    timeout: timeoutMs + 500,
    maxBuffer: 1_000_000,
    env: process.env,
  } as unknown as Parameters<typeof spawnSync>[2];
  const run = spawnSync(nodeBinary, [
    bridgeScriptPath,
    "prompt-enhancer",
    "--payload",
    payload,
    "--timeout-ms",
    String(timeoutMs),
  ], spawnOptions);
  if (run.error || run.status !== 0) {
    const runErrorMessage = run.error instanceof Error ? run.error.message : "";
    return {
      available: false,
      warning: normalizeWarning(String((run.stderr ?? runErrorMessage) || "semantic generation bridge failed")),
      technicalTerms: [],
      topPaths: [],
      evidencePaths: [],
    };
  }
  const parsed = readFirstJsonObjectLine(String(run.stdout ?? ""));
  if (!parsed) {
    return {
      available: false,
      warning: "semantic generation skipped: bridge returned empty JSON",
      technicalTerms: [],
      topPaths: [],
      evidencePaths: [],
    };
  }
  const technicalTerms = toStringArray(parsed.technical_terms, 8);
  const topPaths = toStringArray(parsed.top_paths, 8);
  const evidencePaths = collectPathHintsFromEvidence(parsed.evidence, 8);
  const warnings = toStringArray(parsed.warnings, 2);
  return {
    available: true,
    warning: warnings[0],
    technicalTerms,
    topPaths,
    evidencePaths,
  };
}

function compactSemanticLine(raw: string, maxChars: number): string {
  const normalized = raw.replace(/\s+/g, " ").trim().replace(/^[-*]\s+/, "");
  if (normalized.length <= maxChars) {
    return normalized;
  }
  const headLength = Math.max(40, Math.floor(maxChars * 0.72));
  const tailLength = Math.max(24, maxChars - headLength - 5);
  const head = normalized.slice(0, headLength).trimEnd();
  const tail = normalized.slice(Math.max(0, normalized.length - tailLength)).trimStart();
  return `${head} ... ${tail}`;
}

function collectSemanticSignalTokens(lines: readonly string[]): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const patterns = [
    /[A-Za-z0-9_./-]+\.[A-Za-z0-9_]+(?::\d+)?/g,
    /\b[a-f0-9]{7,40}\b/gi,
    /\b(?:PASS|FAIL|TODO|WARN|ERROR|SKIP)\b/g,
    /[A-Za-z_][A-Za-z0-9_]*(?=\s*\()/g,
  ];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    for (const pattern of patterns) {
      const matched = line.match(pattern) ?? [];
      for (const candidate of matched) {
        const token = candidate.trim();
        if (!token) {
          continue;
        }
        const key = token.toLowerCase();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        tokens.push(token);
        if (tokens.length >= 8) {
          return tokens;
        }
      }
    }
  }
  return tokens;
}

function compressSnapshotSectionLines(args: {
  sectionKey: string;
  lines: readonly string[];
}): {
  lines: string[];
  changed: boolean;
} {
  if (args.lines.length <= 1) {
    return {
      lines: [...args.lines],
      changed: false,
    };
  }
  const header = args.lines[0] ?? "";
  const rawContentRows = args.lines.slice(1).filter((line) => line.trim().length > 0);
  if (rawContentRows.length === 0) {
    return {
      lines: [header],
      changed: args.lines.length > 1,
    };
  }
  if (rawContentRows.some((line) => line.includes("[compressed]"))) {
    return {
      lines: [...args.lines],
      changed: false,
    };
  }
  const maxRows = SNAPSHOT_SECTION_SEMANTIC_COMPRESS_MAX_ROWS[args.sectionKey] ?? 2;
  const keepRows = rawContentRows.slice(0, Math.max(1, maxRows)).map((line) => {
    const compacted = compactSemanticLine(line, SNAPSHOT_SECTION_SEMANTIC_MAX_CHARS);
    return `- ${compacted}`;
  });
  const tailRows = rawContentRows.slice(keepRows.length);
  const tailTokens = collectSemanticSignalTokens(tailRows).slice(0, 6);
  const omittedRows = Math.max(0, rawContentRows.length - keepRows.length);
  const summaryRows: string[] = [];
  if (omittedRows > 0 || tailTokens.length > 0) {
    const parts = [`[compressed] omitted=${String(omittedRows)}`];
    if (tailTokens.length > 0) {
      parts.push(`key=${tailTokens.join(", ")}`);
    }
    summaryRows.push(`- ${parts.join("; ")}`);
  }
  const rebuilt = [header, ...keepRows, ...summaryRows];
  const changed = rebuilt.join("\n").length < args.lines.join("\n").length;
  return {
    lines: changed ? rebuilt : [...args.lines],
    changed,
  };
}

function tokenizeText(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function collectPathHintsFromLines(lines: readonly string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  const pattern = /[A-Za-z0-9_./-]+\.[A-Za-z0-9_]+(?::\d+)?/g;
  for (const row of lines) {
    const matches = row.match(pattern) ?? [];
    for (const matched of matches) {
      const value = matched.trim();
      if (!value) {
        continue;
      }
      const key = value.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      output.push(value);
      if (output.length >= 8) {
        return output;
      }
    }
  }
  return output;
}

function collectIdentifierHints(lines: readonly string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  const pattern = /[A-Za-z_][A-Za-z0-9_]*/g;
  for (const row of lines) {
    const matches = row.match(pattern) ?? [];
    for (const matched of matches) {
      const value = matched.trim();
      if (value.length < 3) {
        continue;
      }
      const key = value.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      output.push(value);
      if (output.length >= 12) {
        return output;
      }
    }
  }
  return output;
}

function scoreSectionLineForSynthesis(args: {
  row: string;
  terms: ReadonlySet<string>;
  paths: ReadonlySet<string>;
}): number {
  const normalized = args.row.replace(/^[-*]\s+/, "").trim();
  if (!normalized) {
    return 0;
  }
  const tokens = new Set(tokenizeText(normalized));
  let score = 1;
  for (const token of tokens) {
    if (args.terms.has(token)) {
      score += 2;
    }
  }
  for (const path of args.paths) {
    if (normalized.toLowerCase().includes(path)) {
      score += 3;
    }
  }
  if (/[A-Za-z0-9_./-]+\.[A-Za-z0-9_]+(?::\d+)?/.test(normalized)) {
    score += 2;
  }
  if (/\b(pass|fail|warn|error|todo)\b/i.test(normalized)) {
    score += 1;
  }
  return score;
}

function synthesizeSnapshotSectionLines(args: {
  sectionKey: string;
  lines: readonly string[];
  generationContext: PromptSemanticGenerationContext;
}): {
  lines: string[];
  changed: boolean;
} {
  if (args.lines.length <= 1) {
    return {
      lines: [...args.lines],
      changed: false,
    };
  }
  const header = args.lines[0] ?? "";
  const rawContentRows = args.lines
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (rawContentRows.length <= 1) {
    return {
      lines: [...args.lines],
      changed: false,
    };
  }
  if (
    rawContentRows.some((line) => line.includes("[generated]"))
    || rawContentRows.some((line) => line.includes("[synth]"))
  ) {
    return {
      lines: [...args.lines],
      changed: false,
    };
  }
  const topPathHints = [
    ...args.generationContext.topPaths,
    ...args.generationContext.evidencePaths,
    ...collectPathHintsFromLines(rawContentRows),
  ].slice(0, 8);
  const topPathSet = new Set(topPathHints.map((item) => item.toLowerCase()));
  const termHints = [
    ...args.generationContext.technicalTerms,
    ...collectIdentifierHints(rawContentRows),
  ].slice(0, 12);
  const termSet = new Set(termHints.map((item) => item.toLowerCase()));
  const scoredRows = rawContentRows
    .map((row) => ({
      row,
      score: scoreSectionLineForSynthesis({
        row,
        terms: termSet,
        paths: topPathSet,
      }),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 2);
  if (scoredRows.length === 0) {
    return {
      lines: [...args.lines],
      changed: false,
    };
  }
  const summaryRows = scoredRows.map((item) =>
    `- [synth] ${compactSemanticLine(item.row, SNAPSHOT_GENERATIVE_SUMMARY_MAX_CHARS)}`
  );
  const sectionHint = args.sectionKey.replace(/\s+/g, "_");
  const pathFocus = topPathHints.slice(0, 3);
  const termFocus = termHints.slice(0, 4);
  const focusParts: string[] = [];
  focusParts.push(`section=${sectionHint}`);
  if (pathFocus.length > 0) {
    focusParts.push(`paths=${pathFocus.join(" | ")}`);
  }
  if (termFocus.length > 0) {
    focusParts.push(`terms=${termFocus.join(", ")}`);
  }
  if (focusParts.length > 0) {
    summaryRows.push(`- [generated] ${focusParts.join("; ")}`);
  }
  const rebuilt = [header, ...summaryRows];
  const changed =
    rebuilt.join("\n").length < args.lines.join("\n").length
    || rebuilt.length < args.lines.length;
  return {
    lines: changed ? rebuilt : [...args.lines],
    changed,
  };
}

export function compressPromptSnapshotSectionsSemanticallyForBudget(args: {
  prompt: string;
  targetTokenLimit: number;
  workDir?: string;
  userText?: string;
  generativeTimeoutMs?: number;
  generativeMaxEvidence?: number;
}): {
  prompt: string;
  compressedSections: string[];
  generativeSections: string[];
  generativeUsed: boolean;
  warnings: string[];
  estimatedTokens: number;
} {
  const targetTokenLimit = Math.max(1, Math.floor(args.targetTokenLimit));
  const originalPrompt = args.prompt;
  const workDir = typeof args.workDir === "string" ? args.workDir.trim() : "";
  const userText = typeof args.userText === "string" ? args.userText.trim() : "";
  const warnings: string[] = [];
  let estimatedTokens = estimateTokensFromText(originalPrompt);
  if (estimatedTokens <= targetTokenLimit) {
    return {
      prompt: originalPrompt,
      compressedSections: [],
      generativeSections: [],
      generativeUsed: false,
      warnings,
      estimatedTokens,
    };
  }

  const lines = originalPrompt.split(/\r?\n/);
  const contextHeaderIndex = lines.findIndex((line) => line.trim() === "[Conversation Context]");
  const userHeaderIndex = lines.findIndex((line) => line.trim() === "[Current User Message]");
  if (contextHeaderIndex < 0 || userHeaderIndex <= contextHeaderIndex + 1) {
    return {
      prompt: originalPrompt,
      compressedSections: [],
      generativeSections: [],
      generativeUsed: false,
      warnings,
      estimatedTokens,
    };
  }

  const contextLines = lines.slice(contextHeaderIndex + 1, userHeaderIndex);
  const snapshotHeaderIndex = contextLines.findIndex(
    (line) => line.trim() === "[Compact Context Snapshot v2]",
  );
  if (snapshotHeaderIndex < 0) {
    return {
      prompt: originalPrompt,
      compressedSections: [],
      generativeSections: [],
      generativeUsed: false,
      warnings,
      estimatedTokens,
    };
  }
  const recentHeaderIndex = contextLines.findIndex((line) => line.trim() === "[Recent Turns]");
  const snapshotTailIndex = recentHeaderIndex >= 0 ? recentHeaderIndex : contextLines.length;
  if (snapshotTailIndex <= snapshotHeaderIndex + 1) {
    return {
      prompt: originalPrompt,
      compressedSections: [],
      generativeSections: [],
      generativeUsed: false,
      warnings,
      estimatedTokens,
    };
  }

  const snapshotPrefix = contextLines.slice(0, snapshotHeaderIndex + 1);
  const snapshotBody = contextLines.slice(snapshotHeaderIndex + 1, snapshotTailIndex);
  const snapshotSuffix = contextLines.slice(snapshotTailIndex);
  const sectionBlocks: Array<{
    title: string;
    lines: string[];
  }> = [];
  let cursor = 0;
  while (cursor < snapshotBody.length) {
    const line = snapshotBody[cursor]?.trim() ?? "";
    const headerMatch = line.match(/^\[(.+)\]$/);
    if (!headerMatch || typeof headerMatch[1] !== "string") {
      cursor += 1;
      continue;
    }
    const title = headerMatch[1].trim();
    const blockLines: string[] = [snapshotBody[cursor] ?? ""];
    cursor += 1;
    while (cursor < snapshotBody.length) {
      const nextLine = snapshotBody[cursor] ?? "";
      if (/^\[(.+)\]$/.test(nextLine.trim())) {
        break;
      }
      blockLines.push(nextLine);
      cursor += 1;
    }
    sectionBlocks.push({
      title,
      lines: blockLines,
    });
  }
  if (sectionBlocks.length === 0) {
    return {
      prompt: originalPrompt,
      compressedSections: [],
      generativeSections: [],
      generativeUsed: false,
      warnings,
      estimatedTokens,
    };
  }

  const compressedTitles: string[] = [];
  const generativeTitles: string[] = [];
  const keepBlocks = [...sectionBlocks];
  let currentPrompt = originalPrompt;
  const rebuildPrompt = (): string => {
    const markerLines: string[] = [];
    if (compressedTitles.length > 0) {
      markerLines.push("[snapshot sections semantically compressed for budget]");
    }
    if (generativeTitles.length > 0) {
      markerLines.push("[snapshot sections generatively compressed for budget]");
    }
    const rebuiltContext = [
      ...snapshotPrefix,
      ...markerLines,
      ...keepBlocks.flatMap((row) => row.lines),
      ...snapshotSuffix,
    ];
    return [
      ...lines.slice(0, contextHeaderIndex + 1),
      ...rebuiltContext,
      ...lines.slice(userHeaderIndex),
    ].join("\n");
  };
  const pushUniqueTitle = (rows: string[], title: string): void => {
    if (!rows.includes(title)) {
      rows.push(title);
    }
  };
  for (const key of SNAPSHOT_SECTION_SEMANTIC_COMPRESS_ORDER) {
    for (let index = 0; index < keepBlocks.length; index += 1) {
      const block = keepBlocks[index];
      if (!block) {
        continue;
      }
      if (normalizeSectionKey(block.title) !== key) {
        continue;
      }
      const compressed = compressSnapshotSectionLines({
        sectionKey: key,
        lines: block.lines,
      });
      if (!compressed.changed) {
        continue;
      }
      keepBlocks[index] = {
        ...block,
        lines: compressed.lines,
      };
      pushUniqueTitle(compressedTitles, block.title);
      currentPrompt = rebuildPrompt();
      estimatedTokens = estimateTokensFromText(currentPrompt);
      if (estimatedTokens <= targetTokenLimit) {
        return {
          prompt: currentPrompt,
          compressedSections: compressedTitles,
          generativeSections: generativeTitles,
          generativeUsed: generativeTitles.length > 0,
          warnings,
          estimatedTokens,
        };
      }
    }
  }

  if (estimatedTokens > targetTokenLimit) {
    const generationContext = loadPromptSemanticGenerationContext({
      workDir,
      prompt: userText || originalPrompt,
      timeoutMs: args.generativeTimeoutMs,
      maxEvidence: args.generativeMaxEvidence,
    });
    if (generationContext.warning) {
      warnings.push(generationContext.warning);
    }
    if (generationContext.available) {
      for (const key of SNAPSHOT_SECTION_SEMANTIC_COMPRESS_ORDER) {
        for (let index = 0; index < keepBlocks.length; index += 1) {
          const block = keepBlocks[index];
          if (!block) {
            continue;
          }
          if (normalizeSectionKey(block.title) !== key) {
            continue;
          }
          const synthesized = synthesizeSnapshotSectionLines({
            sectionKey: key,
            lines: block.lines,
            generationContext,
          });
          if (!synthesized.changed) {
            continue;
          }
          keepBlocks[index] = {
            ...block,
            lines: synthesized.lines,
          };
          pushUniqueTitle(compressedTitles, block.title);
          pushUniqueTitle(generativeTitles, block.title);
          currentPrompt = rebuildPrompt();
          estimatedTokens = estimateTokensFromText(currentPrompt);
          if (estimatedTokens <= targetTokenLimit) {
            return {
              prompt: currentPrompt,
              compressedSections: compressedTitles,
              generativeSections: generativeTitles,
              generativeUsed: generativeTitles.length > 0,
              warnings,
              estimatedTokens,
            };
          }
        }
      }
    }
  }

  return {
    prompt: currentPrompt,
    compressedSections: compressedTitles,
    generativeSections: generativeTitles,
    generativeUsed: generativeTitles.length > 0,
    warnings,
    estimatedTokens,
  };
}

export function trimPromptSnapshotSectionsForBudget(args: {
  prompt: string;
  targetTokenLimit: number;
}): {
  prompt: string;
  removedSections: string[];
  estimatedTokens: number;
} {
  const targetTokenLimit = Math.max(1, Math.floor(args.targetTokenLimit));
  const originalPrompt = args.prompt;
  let estimatedTokens = estimateTokensFromText(originalPrompt);
  if (estimatedTokens <= targetTokenLimit) {
    return {
      prompt: originalPrompt,
      removedSections: [],
      estimatedTokens,
    };
  }

  const lines = originalPrompt.split(/\r?\n/);
  const contextHeaderIndex = lines.findIndex((line) => line.trim() === "[Conversation Context]");
  const userHeaderIndex = lines.findIndex((line) => line.trim() === "[Current User Message]");
  if (contextHeaderIndex < 0 || userHeaderIndex <= contextHeaderIndex + 1) {
    return {
      prompt: originalPrompt,
      removedSections: [],
      estimatedTokens,
    };
  }

  const contextLines = lines.slice(contextHeaderIndex + 1, userHeaderIndex);
  const snapshotHeaderIndex = contextLines.findIndex(
    (line) => line.trim() === "[Compact Context Snapshot v2]",
  );
  if (snapshotHeaderIndex < 0) {
    return {
      prompt: originalPrompt,
      removedSections: [],
      estimatedTokens,
    };
  }
  const recentHeaderIndex = contextLines.findIndex((line) => line.trim() === "[Recent Turns]");
  const snapshotTailIndex = recentHeaderIndex >= 0 ? recentHeaderIndex : contextLines.length;
  if (snapshotTailIndex <= snapshotHeaderIndex + 1) {
    return {
      prompt: originalPrompt,
      removedSections: [],
      estimatedTokens,
    };
  }

  const snapshotPrefix = contextLines.slice(0, snapshotHeaderIndex + 1);
  const snapshotBody = contextLines.slice(snapshotHeaderIndex + 1, snapshotTailIndex);
  const snapshotSuffix = contextLines.slice(snapshotTailIndex);
  const sectionBlocks: Array<{
    title: string;
    lines: string[];
  }> = [];
  let cursor = 0;
  while (cursor < snapshotBody.length) {
    const line = snapshotBody[cursor]?.trim() ?? "";
    const headerMatch = line.match(/^\[(.+)\]$/);
    if (!headerMatch || typeof headerMatch[1] !== "string") {
      cursor += 1;
      continue;
    }
    const title = headerMatch[1].trim();
    const blockLines: string[] = [snapshotBody[cursor] ?? ""];
    cursor += 1;
    while (cursor < snapshotBody.length) {
      const nextLine = snapshotBody[cursor] ?? "";
      if (/^\[(.+)\]$/.test(nextLine.trim())) {
        break;
      }
      blockLines.push(nextLine);
      cursor += 1;
    }
    sectionBlocks.push({
      title,
      lines: blockLines,
    });
  }
  if (sectionBlocks.length === 0) {
    return {
      prompt: originalPrompt,
      removedSections: [],
      estimatedTokens,
    };
  }

  const removableKeys = new Set<string>(SNAPSHOT_SECTION_DROP_ORDER);
  const droppedTitles: string[] = [];
  const keepBlocks = [...sectionBlocks];

  const removeOneSectionByKey = (key: string): boolean => {
    for (let index = 0; index < keepBlocks.length; index += 1) {
      const title = keepBlocks[index]?.title ?? "";
      const normalizedTitle = normalizeSectionKey(title);
      if (normalizedTitle !== key) {
        continue;
      }
      if (SNAPSHOT_SECTION_MANDATORY.has(normalizedTitle)) {
        return false;
      }
      keepBlocks.splice(index, 1);
      droppedTitles.push(title);
      return true;
    }
    return false;
  };

  let currentPrompt = originalPrompt;
  for (const key of SNAPSHOT_SECTION_DROP_ORDER) {
    if (!removableKeys.has(key)) {
      continue;
    }
    while (removeOneSectionByKey(key)) {
      const marker = droppedTitles.length > 0
        ? ["[snapshot sections truncated for budget]"]
        : [];
      const rebuiltContext = [
        ...snapshotPrefix,
        ...marker,
        ...keepBlocks.flatMap((block) => block.lines),
        ...snapshotSuffix,
      ];
      currentPrompt = [
        ...lines.slice(0, contextHeaderIndex + 1),
        ...rebuiltContext,
        ...lines.slice(userHeaderIndex),
      ].join("\n");
      estimatedTokens = estimateTokensFromText(currentPrompt);
      if (estimatedTokens <= targetTokenLimit) {
        return {
          prompt: currentPrompt,
          removedSections: droppedTitles,
          estimatedTokens,
        };
      }
    }
  }

  return {
    prompt: currentPrompt,
    removedSections: droppedTitles,
    estimatedTokens,
  };
}
