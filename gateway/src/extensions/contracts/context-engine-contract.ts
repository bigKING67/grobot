import {
  compressPromptSnapshotSectionsSemanticallyForBudget,
  applyPromptQualityGuardFloor,
  assessPromptQualityGuardRuntime,
  derivePromptQualityGuardAdaptivePolicy,
  derivePromptPreSendCompressionPlan,
  appendPromptQualityWindowEntry,
  assessPromptQualityWindowDegradation,
  computePromptQualitySample,
  defaultPromptQualityGuardState,
  derivePromptQualityGuardOutcomeDriftGuard,
  evaluatePromptQualityGuard,
  estimateTokensFromText,
  nextCompactionStage,
  normalizePromptQualityGuardState,
  prepareTurnPrompt,
  readPromptQualityWindowSummary,
  resolveContextEngineConfig,
  resolvePromptTargetTokenLimit,
  shouldTriggerDownshiftPrecompact,
  trimPromptRecentTurnsForBudget,
  trimPromptSnapshotSectionsForBudget,
  type ContextEngineConfig,
  type ContextHistoryMessage,
  type PromptCompactionStage,
} from "../../tools/context";
import { type RuntimeModelConfig } from "../../models/types";
import { retrieveDependencyGraphHints } from "../../tools/context/graph/dependency-hints";
import { retrieveSymbolGraphHints } from "../../tools/context/graph/symbol-hints";
import {
  readContextGraphCacheStats,
  resetContextGraphCacheStats,
  type ContextGraphCacheStats,
} from "../../tools/context/graph/cache-utils";
import { type ChangedCodeSnapshot } from "../../tools/context/graph/changed-code-snapshot";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonArg(raw: string, argName: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON for ${argName}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`${argName} must be a JSON object`);
  }
  return parsed;
}

function parseArgs(argv: string[]): {
  command: string;
  options: Map<string, string>;
} {
  const command = argv[0] ?? "";
  if (!command) {
    throw new Error("missing command");
  }
  const options = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) {
      throw new Error(`unknown argument: ${token}`);
    }
    const value = argv[index + 1] ?? "";
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${token}`);
    }
    options.set(token.slice(2), value);
    index += 1;
  }
  return { command, options };
}

function requireOption(options: Map<string, string>, key: string): string {
  const value = options.get(key);
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}

function toHistoryRows(raw: unknown): ContextHistoryMessage[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const rows: ContextHistoryMessage[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    const role = item.role === "assistant" ? "assistant" : "user";
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (!content) {
      continue;
    }
    rows.push({ role, content });
  }
  return rows;
}

function readRuntimeModelConfig(raw: unknown): RuntimeModelConfig | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const output: RuntimeModelConfig = {};
  if (typeof raw.providerKind === "string") {
    output.providerKind = raw.providerKind as RuntimeModelConfig["providerKind"];
  }
  if (typeof raw.baseUrl === "string") {
    output.baseUrl = raw.baseUrl;
  }
  if (typeof raw.model === "string") {
    output.model = raw.model;
  }
  if (typeof raw.timeoutMs === "number" && Number.isFinite(raw.timeoutMs)) {
    output.timeoutMs = raw.timeoutMs;
  }
  return output;
}

function readContextEngineConfig(raw: unknown): ContextEngineConfig {
  if (!isRecord(raw)) {
    throw new Error("payload.config must be an object");
  }
  const config = raw as unknown as ContextEngineConfig;
  return config;
}

function readChangedCodeSnapshot(raw: unknown): ChangedCodeSnapshot {
  if (!isRecord(raw)) {
    throw new Error("payload.snapshot must be an object");
  }
  const rootPath = typeof raw.root_path === "string" ? raw.root_path.trim() : "";
  if (!rootPath) {
    throw new Error("payload.snapshot.root_path must be non-empty");
  }
  const filesRaw = Array.isArray(raw.files) ? raw.files : [];
  const files = filesRaw
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      const path = typeof item.path === "string" ? item.path.trim() : "";
      const content = typeof item.content === "string" ? item.content : "";
      if (!path) {
        return null;
      }
      return {
        path,
        content,
      };
    })
    .filter((item): item is { path: string; content: string } => Boolean(item));
  return {
    rootPath,
    files,
  };
}

function readBucketStat(
  stats: Record<string, ContextGraphCacheStats>,
  bucket: string,
): ContextGraphCacheStats {
  const row = stats[bucket];
  if (!row) {
    return {
      hit: 0,
      miss: 0,
      write: 0,
      evict: 0,
    };
  }
  return {
    hit: row.hit,
    miss: row.miss,
    write: row.write,
    evict: row.evict,
  };
}

function runResolveConfig(payload: Record<string, unknown>): Record<string, unknown> {
  const runtimeModelConfig = readRuntimeModelConfig(payload.runtime_model_config);
  const projectTomlPath = typeof payload.project_toml_path === "string"
    ? payload.project_toml_path
    : undefined;
  const config = resolveContextEngineConfig({
    projectTomlPath,
    runtimeModelConfig,
  });
  const tokenBudget = resolvePromptTargetTokenLimit(config);
  return {
    enabled: config.enabled,
    profile: config.profile,
    context_window_tokens: config.contextWindowTokens,
    reserved_output_tokens: config.reservedOutputTokens,
    safety_margin_tokens: config.safetyMarginTokens,
    auto_compact_token_limit: tokenBudget.autoCompactTokenLimit,
    target_token_limit: tokenBudget.targetTokenLimit,
    effective_window_tokens: tokenBudget.effectiveWindowTokens,
    proactive_ratio: config.thresholds.proactiveRatio,
    forced_ratio: config.thresholds.forcedRatio,
    hard_ratio: config.thresholds.hardRatio,
    reactive_max_retries: config.recovery.reactiveMaxRetries,
    ptl_max_retries: config.recovery.ptlMaxRetries,
    circuit_breaker_failures: config.recovery.circuitBreakerFailures,
    reactive_on_prompt_too_long: config.reactiveOnPromptTooLong,
    prompt_quality: config.promptQuality,
    lineage: config.lineage,
    workspace_signals: config.workspaceSignals,
    semantic_prefetch: config.semanticPrefetch,
    dependency_graph: config.dependencyGraph,
    symbol_graph: config.symbolGraph,
  };
}

function runPreparePrompt(payload: Record<string, unknown>): Record<string, unknown> {
  const userText = typeof payload.user_text === "string" ? payload.user_text : "";
  const historyTurns = typeof payload.history_turns === "number" && Number.isFinite(payload.history_turns)
    ? Math.max(1, Math.floor(payload.history_turns))
    : 6;
  const historyMessages = toHistoryRows(payload.history);
  const config = readContextEngineConfig(payload.config);
  const result = prepareTurnPrompt({
    userText,
    historyMessages,
    historyTurns,
    config,
  });
  const variantTokens: Record<string, number> = {};
  for (const variant of result.variants) {
    variantTokens[variant.stage] = variant.estimatedTokens;
  }
  return {
    selected_stage: result.selected.stage,
    threshold_stage: result.thresholdStage,
    selection_reason: result.selectionReason,
    auto_compact_token_limit: result.autoCompactTokenLimit,
    target_token_limit: result.targetTokenLimit,
    auto_limit_triggered: result.autoCompactLimitTriggered,
    utilization: result.utilization,
    selected_utilization: result.selectedUtilization,
    effective_window_tokens: result.effectiveWindowTokens,
    total_estimated_tokens: result.totalEstimatedTokens,
    variant_tokens: variantTokens,
  };
}

function runGraphCache(payload: Record<string, unknown>): Record<string, unknown> {
  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  if (!query) {
    throw new Error("payload.query must be non-empty");
  }
  const maxRows = typeof payload.max_rows === "number" && Number.isFinite(payload.max_rows)
    ? Math.max(1, Math.min(20, Math.floor(payload.max_rows)))
    : 4;
  const snapshot = readChangedCodeSnapshot(payload.snapshot);
  resetContextGraphCacheStats();
  const firstStartedAtMs = Date.now();
  const firstSymbolRows = retrieveSymbolGraphHints(query, {
    maxRows,
    changedCodeSnapshot: snapshot,
  });
  const firstDependencyRows = retrieveDependencyGraphHints(query, {
    maxRows,
    changedCodeSnapshot: snapshot,
  });
  const firstDurationMs = Math.max(0, Date.now() - firstStartedAtMs);
  const firstStats = readContextGraphCacheStats();
  const secondStartedAtMs = Date.now();
  const secondSymbolRows = retrieveSymbolGraphHints(query, {
    maxRows,
    changedCodeSnapshot: snapshot,
  });
  const secondDependencyRows = retrieveDependencyGraphHints(query, {
    maxRows,
    changedCodeSnapshot: snapshot,
  });
  const secondDurationMs = Math.max(0, Date.now() - secondStartedAtMs);
  const secondStats = readContextGraphCacheStats();
  const firstSymbolQuery = readBucketStat(firstStats, "symbol_query");
  const firstDependencyQuery = readBucketStat(firstStats, "dependency_query");
  const secondSymbolQuery = readBucketStat(secondStats, "symbol_query");
  const secondDependencyQuery = readBucketStat(secondStats, "dependency_query");
  return {
    timing: {
      first_pass_duration_ms: firstDurationMs,
      second_pass_duration_ms: secondDurationMs,
    },
    cache_reuse_observed:
      secondSymbolQuery.hit > firstSymbolQuery.hit
      && secondDependencyQuery.hit > firstDependencyQuery.hit,
    first_pass: {
      symbol_rows: firstSymbolRows,
      dependency_rows: firstDependencyRows,
      stats: {
        symbol_query: firstSymbolQuery,
        symbol_declaration: readBucketStat(firstStats, "symbol_declaration"),
        dependency_query: firstDependencyQuery,
        dependency_import: readBucketStat(firstStats, "dependency_import"),
      },
    },
    second_pass: {
      symbol_rows: secondSymbolRows,
      dependency_rows: secondDependencyRows,
      stats: {
        symbol_query: secondSymbolQuery,
        symbol_declaration: readBucketStat(secondStats, "symbol_declaration"),
        dependency_query: secondDependencyQuery,
        dependency_import: readBucketStat(secondStats, "dependency_import"),
      },
    },
  };
}

function runGraphCacheHotLoop(payload: Record<string, unknown>): Record<string, unknown> {
  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  if (!query) {
    throw new Error("payload.query must be non-empty");
  }
  const maxRows = typeof payload.max_rows === "number" && Number.isFinite(payload.max_rows)
    ? Math.max(1, Math.min(20, Math.floor(payload.max_rows)))
    : 4;
  const repeat = typeof payload.repeat === "number" && Number.isFinite(payload.repeat)
    ? Math.max(3, Math.min(24, Math.floor(payload.repeat)))
    : 8;
  const burst = typeof payload.burst === "number" && Number.isFinite(payload.burst)
    ? Math.max(1, Math.min(32, Math.floor(payload.burst)))
    : 1;
  const snapshot = readChangedCodeSnapshot(payload.snapshot);
  resetContextGraphCacheStats();
  const turns: Array<{
    turn: number;
    burst: number;
    duration_ms: number;
    rows_consistent: boolean;
    symbol_query: ContextGraphCacheStats;
    dependency_query: ContextGraphCacheStats;
  }> = [];
  let firstSymbolRows: string[] = [];
  let firstDependencyRows: string[] = [];
  let lastSymbolRows: string[] = [];
  let lastDependencyRows: string[] = [];
  for (let turn = 1; turn <= repeat; turn += 1) {
    const startedAtMs = Date.now();
    let symbolRows: string[] = [];
    let dependencyRows: string[] = [];
    let rowsConsistent = true;
    for (let burstIndex = 0; burstIndex < burst; burstIndex += 1) {
      const currentSymbolRows = retrieveSymbolGraphHints(query, {
        maxRows,
        changedCodeSnapshot: snapshot,
      });
      const currentDependencyRows = retrieveDependencyGraphHints(query, {
        maxRows,
        changedCodeSnapshot: snapshot,
      });
      if (burstIndex === 0) {
        symbolRows = currentSymbolRows;
        dependencyRows = currentDependencyRows;
        continue;
      }
      if (
        rowsConsistent
        && (
          JSON.stringify(symbolRows) !== JSON.stringify(currentSymbolRows)
          || JSON.stringify(dependencyRows) !== JSON.stringify(currentDependencyRows)
        )
      ) {
        rowsConsistent = false;
      }
    }
    const durationMs = Math.max(0, Date.now() - startedAtMs);
    const stats = readContextGraphCacheStats();
    const symbolQuery = readBucketStat(stats, "symbol_query");
    const dependencyQuery = readBucketStat(stats, "dependency_query");
    if (turn === 1) {
      firstSymbolRows = symbolRows;
      firstDependencyRows = dependencyRows;
    }
    lastSymbolRows = symbolRows;
    lastDependencyRows = dependencyRows;
    turns.push({
      turn,
      burst,
      duration_ms: durationMs,
      rows_consistent: rowsConsistent,
      symbol_query: symbolQuery,
      dependency_query: dependencyQuery,
    });
  }
  const firstTurn = turns[0] ?? {
    symbol_query: { hit: 0, miss: 0, write: 0, evict: 0 },
    dependency_query: { hit: 0, miss: 0, write: 0, evict: 0 },
  };
  const lastTurn = turns[turns.length - 1] ?? firstTurn;
  return {
    repeat,
    burst,
    cache_reuse_observed:
      lastTurn.symbol_query.hit > firstTurn.symbol_query.hit
      && lastTurn.dependency_query.hit > firstTurn.dependency_query.hit,
    first_rows: {
      symbol_rows: firstSymbolRows,
      dependency_rows: firstDependencyRows,
    },
    last_rows: {
      symbol_rows: lastSymbolRows,
      dependency_rows: lastDependencyRows,
    },
    turns,
  };
}

function normalizePromptCompactionStage(raw: unknown): PromptCompactionStage {
  if (raw === "proactive" || raw === "forced" || raw === "minimal") {
    return raw;
  }
  return "normal";
}

function runDownshiftGuard(payload: Record<string, unknown>): Record<string, unknown> {
  const allowProactiveCompaction = payload.allow_proactive_compaction !== false;
  const previousTargetTokenLimit =
    typeof payload.previous_target_token_limit === "number"
    && Number.isFinite(payload.previous_target_token_limit)
      ? Math.max(1, Math.floor(payload.previous_target_token_limit))
      : undefined;
  const currentTargetTokenLimit =
    typeof payload.current_target_token_limit === "number"
    && Number.isFinite(payload.current_target_token_limit)
      ? Math.max(1, Math.floor(payload.current_target_token_limit))
      : 1;
  const totalEstimatedTokens =
    typeof payload.total_estimated_tokens === "number"
    && Number.isFinite(payload.total_estimated_tokens)
      ? Math.max(0, Math.floor(payload.total_estimated_tokens))
      : 0;
  const selectedStage = normalizePromptCompactionStage(payload.selected_stage);
  const triggered = shouldTriggerDownshiftPrecompact({
    allowProactiveCompaction,
    previousTargetTokenLimit,
    currentTargetTokenLimit,
    totalEstimatedTokens,
  });
  const promotedStage = triggered
    ? nextCompactionStage(selectedStage) ?? selectedStage
    : selectedStage;
  return {
    allow_proactive_compaction: allowProactiveCompaction,
    previous_target_token_limit: previousTargetTokenLimit ?? null,
    current_target_token_limit: currentTargetTokenLimit,
    total_estimated_tokens: totalEstimatedTokens,
    selected_stage: selectedStage,
    triggered,
    promoted_stage: promotedStage,
  };
}

function runTrimRecentTurns(payload: Record<string, unknown>): Record<string, unknown> {
  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  if (!prompt.trim()) {
    throw new Error("payload.prompt must be non-empty");
  }
  const targetTokenLimit = typeof payload.target_token_limit === "number"
    && Number.isFinite(payload.target_token_limit)
    ? Math.max(1, Math.floor(payload.target_token_limit))
    : 1;
  const minRecentRows = typeof payload.min_recent_rows === "number"
    && Number.isFinite(payload.min_recent_rows)
    ? Math.max(0, Math.floor(payload.min_recent_rows))
    : 1;
  const originalEstimatedTokens = estimateTokensFromText(prompt);
  const trimmed = trimPromptRecentTurnsForBudget({
    prompt,
    targetTokenLimit,
    minRecentRows,
  });
  return {
    target_token_limit: targetTokenLimit,
    min_recent_rows: minRecentRows,
    original_estimated_tokens: originalEstimatedTokens,
    trimmed_estimated_tokens: trimmed.estimatedTokens,
    removed_recent_rows: trimmed.removedRows,
    changed: trimmed.prompt !== prompt,
    has_recent_turns_section: prompt.includes("[Recent Turns]"),
  };
}

function runTrimSnapshotSections(payload: Record<string, unknown>): Record<string, unknown> {
  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  if (!prompt.trim()) {
    throw new Error("payload.prompt must be non-empty");
  }
  const targetTokenLimit = typeof payload.target_token_limit === "number"
    && Number.isFinite(payload.target_token_limit)
    ? Math.max(1, Math.floor(payload.target_token_limit))
    : 1;
  const originalEstimatedTokens = estimateTokensFromText(prompt);
  const trimmed = trimPromptSnapshotSectionsForBudget({
    prompt,
    targetTokenLimit,
  });
  return {
    target_token_limit: targetTokenLimit,
    original_estimated_tokens: originalEstimatedTokens,
    trimmed_estimated_tokens: trimmed.estimatedTokens,
    removed_sections: trimmed.removedSections,
    removed_sections_count: trimmed.removedSections.length,
    changed: trimmed.prompt !== prompt,
    has_snapshot: prompt.includes("[Compact Context Snapshot v2]"),
  };
}

function runSemanticCompressSnapshotSections(payload: Record<string, unknown>): Record<string, unknown> {
  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  if (!prompt.trim()) {
    throw new Error("payload.prompt must be non-empty");
  }
  const targetTokenLimit = typeof payload.target_token_limit === "number"
    && Number.isFinite(payload.target_token_limit)
    ? Math.max(1, Math.floor(payload.target_token_limit))
    : 1;
  const workDir = typeof payload.work_dir === "string" && payload.work_dir.trim().length > 0
    ? payload.work_dir.trim()
    : undefined;
  const userText = typeof payload.user_text === "string" && payload.user_text.trim().length > 0
    ? payload.user_text.trim()
    : undefined;
  const generativeTimeoutMs = typeof payload.generative_timeout_ms === "number"
    && Number.isFinite(payload.generative_timeout_ms)
    ? payload.generative_timeout_ms
    : undefined;
  const generativeMaxEvidence = typeof payload.generative_max_evidence === "number"
    && Number.isFinite(payload.generative_max_evidence)
    ? payload.generative_max_evidence
    : undefined;
  const originalEstimatedTokens = estimateTokensFromText(prompt);
  const compressed = compressPromptSnapshotSectionsSemanticallyForBudget({
    prompt,
    targetTokenLimit,
    workDir,
    userText,
    generativeTimeoutMs,
    generativeMaxEvidence,
  });
  return {
    target_token_limit: targetTokenLimit,
    original_estimated_tokens: originalEstimatedTokens,
    compressed_estimated_tokens: compressed.estimatedTokens,
    compressed_sections: compressed.compressedSections,
    compressed_sections_count: compressed.compressedSections.length,
    generative_used: compressed.generativeUsed,
    generative_sections: compressed.generativeSections,
    generative_sections_count: compressed.generativeSections.length,
    warnings: compressed.warnings,
    changed: compressed.prompt !== prompt,
    has_snapshot: prompt.includes("[Compact Context Snapshot v2]"),
  };
}

function runPreSendCompressionPlan(payload: Record<string, unknown>): Record<string, unknown> {
  const selectedStage = normalizePromptCompactionStage(payload.selected_stage);
  const estimatedTokens = typeof payload.estimated_tokens === "number" && Number.isFinite(payload.estimated_tokens)
    ? Math.max(0, Math.floor(payload.estimated_tokens))
    : 0;
  const targetTokenLimit = typeof payload.target_token_limit === "number"
    && Number.isFinite(payload.target_token_limit)
    ? Math.max(1, Math.floor(payload.target_token_limit))
    : 1;
  const qualityGuardActive = payload.quality_guard_active === true;
  const qualityGuardSevere = payload.quality_guard_severe === true;
  const pressureTrendMomentum = typeof payload.pressure_trend_momentum === "number"
    && Number.isFinite(payload.pressure_trend_momentum)
    ? payload.pressure_trend_momentum
    : null;
  const plan = derivePromptPreSendCompressionPlan({
    selectedStage,
    estimatedTokens,
    targetTokenLimit,
    qualityGuardActive,
    qualityGuardSevere,
    pressureTrendMomentum,
  });
  return {
    selected_stage: selectedStage,
    estimated_tokens: estimatedTokens,
    target_token_limit: targetTokenLimit,
    quality_guard_active: qualityGuardActive,
    quality_guard_severe: qualityGuardSevere,
    pressure_trend_momentum: pressureTrendMomentum,
    strategy: plan.strategy,
    overflow_ratio: plan.overflowRatio,
    pressure_score: plan.pressureScore,
    order: plan.order,
  };
}

function runPromptQualityWindow(payload: Record<string, unknown>): Record<string, unknown> {
  const workDir = typeof payload.work_dir === "string" ? payload.work_dir.trim() : "";
  if (!workDir) {
    throw new Error("payload.work_dir must be non-empty");
  }
  const sessionKey = typeof payload.session_key === "string" && payload.session_key.trim().length > 0
    ? payload.session_key.trim()
    : "contract:prompt-quality-window";
  const samples = Array.isArray(payload.samples) ? payload.samples : [];
  if (samples.length === 0) {
    throw new Error("payload.samples must be a non-empty array");
  }
  const nowMs = Date.now();
  let written = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const row = samples[index];
    if (!isRecord(row)) {
      continue;
    }
    const prompt = typeof row.prompt === "string" ? row.prompt : "";
    if (!prompt.trim()) {
      continue;
    }
    const stage = normalizePromptCompactionStage(row.stage);
    const estimatedTokens = typeof row.estimated_tokens === "number" && Number.isFinite(row.estimated_tokens)
      ? Math.max(0, Math.floor(row.estimated_tokens))
      : estimateTokensFromText(prompt);
    const targetTokenLimit = typeof row.target_token_limit === "number" && Number.isFinite(row.target_token_limit)
      ? Math.max(1, Math.floor(row.target_token_limit))
      : Math.max(1, estimatedTokens);
    const recentTrimRows = typeof row.recent_trim_rows === "number" && Number.isFinite(row.recent_trim_rows)
      ? Math.max(0, Math.floor(row.recent_trim_rows))
      : 0;
    const snapshotTrimSections = typeof row.snapshot_trim_sections === "number" && Number.isFinite(row.snapshot_trim_sections)
      ? Math.max(0, Math.floor(row.snapshot_trim_sections))
      : 0;
    const snapshotSemanticCompressSections =
      typeof row.snapshot_semantic_compress_sections === "number"
      && Number.isFinite(row.snapshot_semantic_compress_sections)
        ? Math.max(0, Math.floor(row.snapshot_semantic_compress_sections))
        : 0;
    const headTrimRetries = typeof row.head_trim_retries === "number" && Number.isFinite(row.head_trim_retries)
      ? Math.max(0, Math.floor(row.head_trim_retries))
      : 0;
    const autoLimitTriggered = row.auto_limit_triggered === true;
    const downshiftGuardTriggered = row.downshift_guard_triggered === true;
    const preSendStrategy = row.pre_send_strategy === "hard_budget"
      ? "hard_budget"
      : "quality_first";
    const preSendOverflowRatio = typeof row.pre_send_overflow_ratio === "number"
      && Number.isFinite(row.pre_send_overflow_ratio)
      ? Math.max(0, row.pre_send_overflow_ratio)
      : 0;
    const preSendPressureScore = typeof row.pre_send_pressure_score === "number"
      && Number.isFinite(row.pre_send_pressure_score)
      ? Math.max(0, row.pre_send_pressure_score)
      : 0;
    const selectionReason = typeof row.selection_reason === "string" && row.selection_reason.trim().length > 0
      ? row.selection_reason.trim()
      : "contract";
    const quality = computePromptQualitySample({
      prompt,
      stage,
      estimatedTokens,
      targetTokenLimit,
      recentTrimRows,
      snapshotTrimSections,
      snapshotSemanticCompressSections,
      headTrimRetries,
      autoLimitTriggered,
      downshiftGuardTriggered,
      preSendStrategy,
      preSendOverflowRatio,
      preSendPressureScore,
    });
    appendPromptQualityWindowEntry({
      workDir,
      entry: {
        ts: new Date(nowMs + index).toISOString(),
        sessionKey,
        stage,
        selectionReason,
        estimatedTokens,
        targetTokenLimit,
        scores: quality.scores,
        signals: quality.signals,
      },
    });
    written += 1;
  }
  const size = typeof payload.size === "number" && Number.isFinite(payload.size)
    ? Math.max(1, Math.floor(payload.size))
    : 20;
  const lowQualityThreshold = typeof payload.low_quality_threshold === "number"
    && Number.isFinite(payload.low_quality_threshold)
    ? payload.low_quality_threshold
    : undefined;
  const summary = readPromptQualityWindowSummary({
    workDir,
    size,
    lowQualityThreshold,
  });
  const thresholdOverall = typeof payload.threshold_overall === "number" && Number.isFinite(payload.threshold_overall)
    ? payload.threshold_overall
    : 0.62;
  const thresholdLowQualityRate = typeof payload.threshold_low_quality_rate === "number"
    && Number.isFinite(payload.threshold_low_quality_rate)
    ? payload.threshold_low_quality_rate
    : 0.4;
  const minEntries = typeof payload.min_entries === "number" && Number.isFinite(payload.min_entries)
    ? Math.max(1, Math.floor(payload.min_entries))
    : 8;
  const degradation = assessPromptQualityWindowDegradation({
    summary,
    thresholdOverall,
    thresholdLowQualityRate,
    minEntries,
  });
  return {
    wrote_entries: written,
    summary: {
      path: summary.path,
      configured_size: summary.configuredSize,
      entries: summary.entries,
      from_ts: summary.fromTs,
      to_ts: summary.toTs,
      average_scores: summary.averageScores,
      latest_scores: summary.latestScores,
      low_quality: {
        count: summary.lowQualityCount,
        rate: summary.lowQualityRate,
        threshold_overall: summary.lowQualityThreshold,
      },
      stage_counts: summary.stageCounts,
      signal_averages: summary.signalAverages == null
        ? null
        : {
          recent_rows: summary.signalAverages.recentRows,
          snapshot_sections: summary.signalAverages.snapshotSections,
          recent_trim_rows: summary.signalAverages.recentTrimRows,
          snapshot_trim_sections: summary.signalAverages.snapshotTrimSections,
          snapshot_semantic_compress_sections:
            summary.signalAverages.snapshotSemanticCompressSections,
          head_trim_retries: summary.signalAverages.headTrimRetries,
          pre_send_overflow_ratio: summary.signalAverages.preSendOverflowRatio,
          pre_send_pressure_score: summary.signalAverages.preSendPressureScore,
        },
      compression_activity: {
        recent_trim_rate: summary.compressionActivity.recentTrimRate,
        snapshot_trim_rate: summary.compressionActivity.snapshotTrimRate,
        snapshot_semantic_compress_rate:
          summary.compressionActivity.snapshotSemanticCompressRate,
        head_trim_rate: summary.compressionActivity.headTrimRate,
        auto_limit_triggered_rate: summary.compressionActivity.autoLimitTriggeredRate,
        downshift_guard_triggered_rate: summary.compressionActivity.downshiftGuardTriggeredRate,
      },
      strategy_activity: {
        quality_first_rate: summary.strategyActivity.qualityFirstRate,
        hard_budget_rate: summary.strategyActivity.hardBudgetRate,
      },
      token_budget: {
        average_estimated_tokens: summary.tokenBudget.averageEstimatedTokens,
        average_target_token_limit: summary.tokenBudget.averageTargetTokenLimit,
        average_utilization_ratio: summary.tokenBudget.averageUtilizationRatio,
      },
      strategy_trends: {
        short: {
          window_size: summary.strategyTrends.short.windowSize,
          entries: summary.strategyTrends.short.entries,
          hard_budget_rate: summary.strategyTrends.short.hardBudgetRate,
          average_overflow_ratio: summary.strategyTrends.short.averageOverflowRatio,
          average_pressure_score: summary.strategyTrends.short.averagePressureScore,
        },
        medium: {
          window_size: summary.strategyTrends.medium.windowSize,
          entries: summary.strategyTrends.medium.entries,
          hard_budget_rate: summary.strategyTrends.medium.hardBudgetRate,
          average_overflow_ratio: summary.strategyTrends.medium.averageOverflowRatio,
          average_pressure_score: summary.strategyTrends.medium.averagePressureScore,
        },
        delta: {
          hard_budget_rate: summary.strategyTrends.delta.hardBudgetRate,
          average_overflow_ratio: summary.strategyTrends.delta.averageOverflowRatio,
          average_pressure_score: summary.strategyTrends.delta.averagePressureScore,
        },
      },
      strategy_outcomes: {
        hard_budget_followup_overall_delta:
          summary.strategyOutcomes.hardBudgetFollowupOverallDelta,
        quality_first_followup_overall_delta:
          summary.strategyOutcomes.qualityFirstFollowupOverallDelta,
        hard_budget_recovery_rate:
          summary.strategyOutcomes.hardBudgetRecoveryRate,
        quality_first_improved_rate:
          summary.strategyOutcomes.qualityFirstImprovedRate,
        hard_budget_transition_count:
          summary.strategyOutcomes.hardBudgetTransitions,
        quality_first_transition_count:
          summary.strategyOutcomes.qualityFirstTransitions,
      },
      pressure_trends: {
        short: {
          window_size: summary.pressureTrends.short.windowSize,
          entries: summary.pressureTrends.short.entries,
          snapshot_semantic_compress_rate:
            summary.pressureTrends.short.snapshotSemanticCompressRate,
          auto_limit_triggered_rate:
            summary.pressureTrends.short.autoLimitTriggeredRate,
          average_utilization_ratio:
            summary.pressureTrends.short.averageUtilizationRatio,
        },
        medium: {
          window_size: summary.pressureTrends.medium.windowSize,
          entries: summary.pressureTrends.medium.entries,
          snapshot_semantic_compress_rate:
            summary.pressureTrends.medium.snapshotSemanticCompressRate,
          auto_limit_triggered_rate:
            summary.pressureTrends.medium.autoLimitTriggeredRate,
          average_utilization_ratio:
            summary.pressureTrends.medium.averageUtilizationRatio,
        },
        delta: {
          snapshot_semantic_compress_rate:
            summary.pressureTrends.delta.snapshotSemanticCompressRate,
          auto_limit_triggered_rate:
            summary.pressureTrends.delta.autoLimitTriggeredRate,
          average_utilization_ratio:
            summary.pressureTrends.delta.averageUtilizationRatio,
        },
      },
    },
    degradation: {
      degraded: degradation.degraded,
      reason: degradation.reason,
      threshold_overall: degradation.thresholdOverall,
      threshold_low_quality_rate: degradation.thresholdLowQualityRate,
      min_entries: degradation.minEntries,
      observed_entries: degradation.observedEntries,
      observed_overall: degradation.observedOverall,
      observed_low_quality_rate: degradation.observedLowQualityRate,
    },
  };
}

function runPromptQualityGuard(payload: Record<string, unknown>): Record<string, unknown> {
  const policy = parsePromptQualityGuardPolicy(payload);
  const selectedStage = normalizePromptCompactionStage(payload.selected_stage);
  const observationsRaw = Array.isArray(payload.observations) ? payload.observations : [];
  if (observationsRaw.length === 0) {
    throw new Error("payload.observations must be a non-empty array");
  }
  let state = isRecord(payload.state)
    ? normalizePromptQualityGuardState(payload.state)
    : defaultPromptQualityGuardState();
  const timeline: Array<Record<string, unknown>> = [];
  for (let index = 0; index < observationsRaw.length; index += 1) {
    const row = observationsRaw[index];
    if (!isRecord(row)) {
      continue;
    }
    const rowSelectedStage = normalizePromptCompactionStage(row.selected_stage ?? selectedStage);
    const observation = {
      degraded: row.degraded === true,
      reason: typeof row.reason === "string" ? row.reason : "unknown",
      observedOverall:
        typeof row.observed_overall === "number" && Number.isFinite(row.observed_overall)
          ? row.observed_overall
          : null,
      observedLowQualityRate:
        typeof row.observed_low_quality_rate === "number"
        && Number.isFinite(row.observed_low_quality_rate)
          ? row.observed_low_quality_rate
          : null,
    };
    const decision = evaluatePromptQualityGuard({
      policy,
      currentState: state,
      observation,
    });
    state = decision.state;
    const appliedStage = applyPromptQualityGuardFloor({
      selectedStage: rowSelectedStage,
      floorStage: decision.floorStage,
    });
    timeline.push({
      index,
      observation,
      floor_stage: decision.floorStage,
      applied_stage: appliedStage,
      triggered: decision.triggered,
      promoted: decision.promoted,
      released: decision.released,
      severe: decision.severe,
      severe_escalated: decision.severeEscalated,
      state: decision.state,
    });
  }
  return {
    policy,
    selected_stage: selectedStage,
    timeline,
    final_state: state,
  };
}

function parsePromptQualityGuardPolicy(payload: Record<string, unknown>): {
  enabled: boolean;
  promoteStreak: number;
  severePromoteStreak: number;
  releaseStreak: number;
  holdTurns: number;
  maxFloorStage: PromptCompactionStage;
  severeOverallThreshold: number;
  severeLowQualityRateThreshold: number;
} {
  const policyRaw = isRecord(payload.policy) ? payload.policy : {};
  return {
    enabled: policyRaw.enabled !== false,
    promoteStreak:
      typeof policyRaw.promote_streak === "number" && Number.isFinite(policyRaw.promote_streak)
        ? Math.max(1, Math.floor(policyRaw.promote_streak))
        : 2,
    severePromoteStreak:
      typeof policyRaw.severe_promote_streak === "number" && Number.isFinite(policyRaw.severe_promote_streak)
        ? Math.max(1, Math.floor(policyRaw.severe_promote_streak))
        : 2,
    releaseStreak:
      typeof policyRaw.release_streak === "number" && Number.isFinite(policyRaw.release_streak)
        ? Math.max(1, Math.floor(policyRaw.release_streak))
        : 3,
    holdTurns:
      typeof policyRaw.hold_turns === "number" && Number.isFinite(policyRaw.hold_turns)
        ? Math.max(0, Math.floor(policyRaw.hold_turns))
        : 2,
    maxFloorStage: normalizePromptCompactionStage(policyRaw.max_floor_stage ?? "minimal"),
    severeOverallThreshold:
      typeof policyRaw.severe_overall_threshold === "number"
      && Number.isFinite(policyRaw.severe_overall_threshold)
        ? policyRaw.severe_overall_threshold
        : 0.45,
    severeLowQualityRateThreshold:
      typeof policyRaw.severe_low_quality_rate_threshold === "number"
      && Number.isFinite(policyRaw.severe_low_quality_rate_threshold)
        ? policyRaw.severe_low_quality_rate_threshold
        : 0.7,
  };
}

function parsePromptQualityGuardAdaptiveModeAllowlist(
  payload: Record<string, unknown>,
): Array<"harden" | "relax"> {
  const policyRaw = isRecord(payload.policy) ? payload.policy : {};
  const rawValues = Array.isArray(policyRaw.adaptive_mode_allowlist)
    ? policyRaw.adaptive_mode_allowlist
    : [];
  const unique = new Set<"harden" | "relax">();
  for (const value of rawValues) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (normalized === "harden" || normalized === "relax") {
      unique.add(normalized);
    }
  }
  return Array.from(unique.values());
}

function runPromptQualityGuardRuntime(payload: Record<string, unknown>): Record<string, unknown> {
  const policy = parsePromptQualityGuardPolicy(payload);
  const state = isRecord(payload.state)
    ? normalizePromptQualityGuardState(payload.state)
    : defaultPromptQualityGuardState();
  const observation = {
    degraded: payload.degraded === true,
    reason: typeof payload.reason === "string" ? payload.reason : "unknown",
    observedOverall:
      typeof payload.observed_overall === "number" && Number.isFinite(payload.observed_overall)
        ? payload.observed_overall
        : null,
    observedLowQualityRate:
      typeof payload.observed_low_quality_rate === "number"
      && Number.isFinite(payload.observed_low_quality_rate)
        ? payload.observed_low_quality_rate
        : null,
  };
  const assessment = assessPromptQualityGuardRuntime({
    policy,
    currentState: state,
    observation,
  });
  return {
    policy,
    state,
    observation,
    assessment: {
      enabled: assessment.enabled,
      phase: assessment.phase,
      transition: assessment.transition,
      degraded: assessment.degraded,
      severe: assessment.severe,
      reason: assessment.reason,
      triggered: assessment.triggered,
      floor_stage: assessment.floorStage,
      proposed_floor_stage: assessment.proposedFloorStage,
      promote_remaining: assessment.promoteRemaining,
      severe_promote_remaining: assessment.severePromoteRemaining,
      release_remaining: assessment.releaseRemaining,
      hold_turns_remaining: assessment.holdTurnsRemaining,
      observed_overall: assessment.observedOverall,
      observed_low_quality_rate: assessment.observedLowQualityRate,
    },
  };
}

function parsePromptQualityGuardAdaptiveWindow(payload: Record<string, unknown>) {
  return {
    degraded: payload.degraded === true,
    reason: typeof payload.reason === "string" ? payload.reason : "unknown",
    lowQualityRate:
      typeof payload.low_quality_rate === "number" && Number.isFinite(payload.low_quality_rate)
        ? payload.low_quality_rate
        : null,
    averageOverall:
      typeof payload.average_overall === "number" && Number.isFinite(payload.average_overall)
        ? payload.average_overall
        : null,
    observedOverall:
      typeof payload.observed_overall === "number" && Number.isFinite(payload.observed_overall)
        ? payload.observed_overall
        : null,
    observedLowQualityRate:
      typeof payload.observed_low_quality_rate === "number"
      && Number.isFinite(payload.observed_low_quality_rate)
        ? payload.observed_low_quality_rate
        : null,
    snapshotSemanticCompressRate:
      typeof payload.snapshot_semantic_compress_rate === "number"
      && Number.isFinite(payload.snapshot_semantic_compress_rate)
        ? payload.snapshot_semantic_compress_rate
        : null,
    autoLimitTriggeredRate:
      typeof payload.auto_limit_triggered_rate === "number"
      && Number.isFinite(payload.auto_limit_triggered_rate)
        ? payload.auto_limit_triggered_rate
        : null,
    averageUtilizationRatio:
      typeof payload.average_utilization_ratio === "number"
      && Number.isFinite(payload.average_utilization_ratio)
        ? payload.average_utilization_ratio
        : null,
    shortSnapshotSemanticCompressRate:
      typeof payload.short_snapshot_semantic_compress_rate === "number"
      && Number.isFinite(payload.short_snapshot_semantic_compress_rate)
        ? payload.short_snapshot_semantic_compress_rate
        : null,
    mediumSnapshotSemanticCompressRate:
      typeof payload.medium_snapshot_semantic_compress_rate === "number"
      && Number.isFinite(payload.medium_snapshot_semantic_compress_rate)
        ? payload.medium_snapshot_semantic_compress_rate
        : null,
    shortAutoLimitTriggeredRate:
      typeof payload.short_auto_limit_triggered_rate === "number"
      && Number.isFinite(payload.short_auto_limit_triggered_rate)
        ? payload.short_auto_limit_triggered_rate
        : null,
    mediumAutoLimitTriggeredRate:
      typeof payload.medium_auto_limit_triggered_rate === "number"
      && Number.isFinite(payload.medium_auto_limit_triggered_rate)
        ? payload.medium_auto_limit_triggered_rate
        : null,
    shortAverageUtilizationRatio:
      typeof payload.short_average_utilization_ratio === "number"
      && Number.isFinite(payload.short_average_utilization_ratio)
        ? payload.short_average_utilization_ratio
        : null,
    mediumAverageUtilizationRatio:
      typeof payload.medium_average_utilization_ratio === "number"
      && Number.isFinite(payload.medium_average_utilization_ratio)
        ? payload.medium_average_utilization_ratio
        : null,
    hardBudgetStrategyRate:
      typeof payload.hard_budget_strategy_rate === "number"
      && Number.isFinite(payload.hard_budget_strategy_rate)
        ? payload.hard_budget_strategy_rate
        : null,
    qualityFirstStrategyRate:
      typeof payload.quality_first_strategy_rate === "number"
      && Number.isFinite(payload.quality_first_strategy_rate)
        ? payload.quality_first_strategy_rate
        : null,
    averagePreSendOverflowRatio:
      typeof payload.average_pre_send_overflow_ratio === "number"
      && Number.isFinite(payload.average_pre_send_overflow_ratio)
        ? payload.average_pre_send_overflow_ratio
        : null,
    averagePreSendPressureScore:
      typeof payload.average_pre_send_pressure_score === "number"
      && Number.isFinite(payload.average_pre_send_pressure_score)
        ? payload.average_pre_send_pressure_score
        : null,
    shortHardBudgetStrategyRate:
      typeof payload.short_hard_budget_strategy_rate === "number"
      && Number.isFinite(payload.short_hard_budget_strategy_rate)
        ? payload.short_hard_budget_strategy_rate
        : null,
    mediumHardBudgetStrategyRate:
      typeof payload.medium_hard_budget_strategy_rate === "number"
      && Number.isFinite(payload.medium_hard_budget_strategy_rate)
        ? payload.medium_hard_budget_strategy_rate
        : null,
    shortAveragePreSendOverflowRatio:
      typeof payload.short_average_pre_send_overflow_ratio === "number"
      && Number.isFinite(payload.short_average_pre_send_overflow_ratio)
        ? payload.short_average_pre_send_overflow_ratio
        : null,
    mediumAveragePreSendOverflowRatio:
      typeof payload.medium_average_pre_send_overflow_ratio === "number"
      && Number.isFinite(payload.medium_average_pre_send_overflow_ratio)
        ? payload.medium_average_pre_send_overflow_ratio
        : null,
    shortAveragePreSendPressureScore:
      typeof payload.short_average_pre_send_pressure_score === "number"
      && Number.isFinite(payload.short_average_pre_send_pressure_score)
        ? payload.short_average_pre_send_pressure_score
        : null,
    mediumAveragePreSendPressureScore:
      typeof payload.medium_average_pre_send_pressure_score === "number"
      && Number.isFinite(payload.medium_average_pre_send_pressure_score)
        ? payload.medium_average_pre_send_pressure_score
        : null,
    hardBudgetFollowupOverallDelta:
      typeof payload.hard_budget_followup_overall_delta === "number"
      && Number.isFinite(payload.hard_budget_followup_overall_delta)
        ? payload.hard_budget_followup_overall_delta
        : null,
    qualityFirstFollowupOverallDelta:
      typeof payload.quality_first_followup_overall_delta === "number"
      && Number.isFinite(payload.quality_first_followup_overall_delta)
        ? payload.quality_first_followup_overall_delta
        : null,
    hardBudgetRecoveryRate:
      typeof payload.hard_budget_recovery_rate === "number"
      && Number.isFinite(payload.hard_budget_recovery_rate)
        ? payload.hard_budget_recovery_rate
        : null,
    qualityFirstImprovedRate:
      typeof payload.quality_first_improved_rate === "number"
      && Number.isFinite(payload.quality_first_improved_rate)
        ? payload.quality_first_improved_rate
        : null,
    hardBudgetTransitionCount:
      typeof payload.hard_budget_transition_count === "number"
      && Number.isFinite(payload.hard_budget_transition_count)
        ? Math.max(0, Math.floor(payload.hard_budget_transition_count))
        : null,
    qualityFirstTransitionCount:
      typeof payload.quality_first_transition_count === "number"
      && Number.isFinite(payload.quality_first_transition_count)
        ? Math.max(0, Math.floor(payload.quality_first_transition_count))
        : null,
  };
}

function runPromptQualityGuardAdaptivePolicy(payload: Record<string, unknown>): Record<string, unknown> {
  const basePolicy = parsePromptQualityGuardPolicy(payload);
  const state = isRecord(payload.state)
    ? normalizePromptQualityGuardState(payload.state)
    : defaultPromptQualityGuardState();
  const window = parsePromptQualityGuardAdaptiveWindow(payload);
  const decision = derivePromptQualityGuardAdaptivePolicy({
    basePolicy,
    adaptiveEnabled: payload.adaptive_enabled !== false,
    adaptiveModeAllowlist: parsePromptQualityGuardAdaptiveModeAllowlist(payload),
    currentState: state,
    window,
  });
  return {
    decision: {
      enabled: decision.enabled,
      mode: decision.mode,
      reason: decision.reason,
      allowlist: decision.allowlist,
      mode_blocked: decision.modeBlocked,
      blocked_mode: decision.blockedMode,
      adjustment: {
        promote_streak_delta: decision.adjustment.promoteStreakDelta,
        severe_promote_streak_delta: decision.adjustment.severePromoteStreakDelta,
        release_streak_delta: decision.adjustment.releaseStreakDelta,
        hold_turns_delta: decision.adjustment.holdTurnsDelta,
      },
      base_policy: {
        enabled: decision.basePolicy.enabled,
        promote_streak: decision.basePolicy.promoteStreak,
        severe_promote_streak: decision.basePolicy.severePromoteStreak,
        release_streak: decision.basePolicy.releaseStreak,
        hold_turns: decision.basePolicy.holdTurns,
        max_floor_stage: decision.basePolicy.maxFloorStage,
      },
      effective_policy: {
        enabled: decision.effectivePolicy.enabled,
        promote_streak: decision.effectivePolicy.promoteStreak,
        severe_promote_streak: decision.effectivePolicy.severePromoteStreak,
        release_streak: decision.effectivePolicy.releaseStreak,
        hold_turns: decision.effectivePolicy.holdTurns,
        max_floor_stage: decision.effectivePolicy.maxFloorStage,
      },
      pressure_policy: {
        source: decision.pressurePolicy.source,
        updated: decision.pressurePolicy.updated,
        learn_alpha: decision.pressurePolicy.learnAlpha,
        utilization_threshold: decision.pressurePolicy.utilizationThreshold,
        semantic_rate_threshold: decision.pressurePolicy.semanticRateThreshold,
        auto_limit_rate_threshold: decision.pressurePolicy.autoLimitRateThreshold,
        joint_rate_threshold: decision.pressurePolicy.jointRateThreshold,
        trend_utilization_delta: decision.pressurePolicy.trendUtilizationDelta,
        trend_semantic_delta: decision.pressurePolicy.trendSemanticDelta,
        trend_auto_limit_delta: decision.pressurePolicy.trendAutoLimitDelta,
        trend_momentum: decision.pressurePolicy.trendMomentum,
        trend_flip_suppressed: decision.pressurePolicy.trendFlipSuppressed,
      },
      outcome_reliability: {
        required_transitions: decision.outcomeReliability.requiredTransitions,
        next_required_transitions: decision.outcomeReliability.nextRequiredTransitions,
        hard_budget_transitions: decision.outcomeReliability.hardBudgetTransitions,
        quality_first_transitions: decision.outcomeReliability.qualityFirstTransitions,
        hard_budget_evidence_score: decision.outcomeReliability.hardBudgetEvidenceScore,
        quality_first_evidence_score: decision.outcomeReliability.qualityFirstEvidenceScore,
        combined_evidence_score: decision.outcomeReliability.combinedEvidenceScore,
        hard_budget_reliable: decision.outcomeReliability.hardBudgetReliable,
        quality_first_reliable: decision.outcomeReliability.qualityFirstReliable,
      },
      outcome_drift_guard: {
        high_evidence_harden_bias: decision.outcomeDriftGuard.highEvidenceHardenBias,
        high_evidence_turn: decision.outcomeDriftGuard.highEvidenceTurn,
        high_evidence_turns: decision.outcomeDriftGuard.highEvidenceTurns,
        high_evidence_harden_turns: decision.outcomeDriftGuard.highEvidenceHardenTurns,
        high_evidence_harden_rate: decision.outcomeDriftGuard.highEvidenceHardenRate,
        threshold_harden_rate: decision.outcomeDriftGuard.thresholdHardenRate,
        min_high_evidence_turns: decision.outcomeDriftGuard.minHighEvidenceTurns,
        reason: decision.outcomeDriftGuard.reason,
        auto_action_level: decision.outcomeDriftGuard.autoActionLevel,
        recent_auto_action_levels: decision.outcomeDriftGuard.recentAutoActionLevels,
        window_summary: {
          window_size: decision.outcomeDriftGuard.windowSummary.windowSize,
          entries: decision.outcomeDriftGuard.windowSummary.entries,
          latest: decision.outcomeDriftGuard.windowSummary.latest,
          dominant: decision.outcomeDriftGuard.windowSummary.dominant,
          alert_level: decision.outcomeDriftGuard.windowSummary.alertLevel,
          transition_count: decision.outcomeDriftGuard.windowSummary.transitionCount,
          active_rate: decision.outcomeDriftGuard.windowSummary.activeRate,
          medium_or_hard_rate: decision.outcomeDriftGuard.windowSummary.mediumOrHardRate,
          hard_rate: decision.outcomeDriftGuard.windowSummary.hardRate,
          level_counts: decision.outcomeDriftGuard.windowSummary.levelCounts,
        },
        recommendation: decision.outcomeDriftGuard.recommendation,
      },
      window: {
        degraded: window.degraded,
        reason: window.reason,
        low_quality_rate: window.lowQualityRate,
        average_overall: window.averageOverall,
        observed_overall: window.observedOverall,
        observed_low_quality_rate: window.observedLowQualityRate,
        snapshot_semantic_compress_rate: window.snapshotSemanticCompressRate,
        auto_limit_triggered_rate: window.autoLimitTriggeredRate,
        average_utilization_ratio: window.averageUtilizationRatio,
        short_snapshot_semantic_compress_rate: window.shortSnapshotSemanticCompressRate,
        medium_snapshot_semantic_compress_rate: window.mediumSnapshotSemanticCompressRate,
        short_auto_limit_triggered_rate: window.shortAutoLimitTriggeredRate,
        medium_auto_limit_triggered_rate: window.mediumAutoLimitTriggeredRate,
        short_average_utilization_ratio: window.shortAverageUtilizationRatio,
        medium_average_utilization_ratio: window.mediumAverageUtilizationRatio,
        hard_budget_strategy_rate: window.hardBudgetStrategyRate,
        quality_first_strategy_rate: window.qualityFirstStrategyRate,
        average_pre_send_overflow_ratio: window.averagePreSendOverflowRatio,
        average_pre_send_pressure_score: window.averagePreSendPressureScore,
        short_hard_budget_strategy_rate: window.shortHardBudgetStrategyRate,
        medium_hard_budget_strategy_rate: window.mediumHardBudgetStrategyRate,
        short_average_pre_send_overflow_ratio: window.shortAveragePreSendOverflowRatio,
        medium_average_pre_send_overflow_ratio: window.mediumAveragePreSendOverflowRatio,
        short_average_pre_send_pressure_score: window.shortAveragePreSendPressureScore,
        medium_average_pre_send_pressure_score: window.mediumAveragePreSendPressureScore,
        hard_budget_followup_overall_delta: window.hardBudgetFollowupOverallDelta,
        quality_first_followup_overall_delta: window.qualityFirstFollowupOverallDelta,
        hard_budget_recovery_rate: window.hardBudgetRecoveryRate,
        quality_first_improved_rate: window.qualityFirstImprovedRate,
        hard_budget_transition_count: window.hardBudgetTransitionCount,
        quality_first_transition_count: window.qualityFirstTransitionCount,
      },
    },
  };
}

function runPromptQualityGuardAdaptiveSequence(payload: Record<string, unknown>): Record<string, unknown> {
  const basePolicy = parsePromptQualityGuardPolicy(payload);
  const adaptiveEnabled = payload.adaptive_enabled !== false;
  const adaptiveModeAllowlist = parsePromptQualityGuardAdaptiveModeAllowlist(payload);
  const selectedStage = normalizePromptCompactionStage(payload.selected_stage);
  const windowsRaw = Array.isArray(payload.windows) ? payload.windows : [];
  if (windowsRaw.length === 0) {
    throw new Error("payload.windows must be a non-empty array");
  }
  let state = isRecord(payload.state)
    ? normalizePromptQualityGuardState(payload.state)
    : defaultPromptQualityGuardState();
  let previousMode: string | null = null;
  let modeTransitionCount = 0;
  let trendFlipSuppressedCount = 0;
  let previousUtilizationThreshold: number | null = null;
  let previousNextRequiredTransitions: number | null = null;
  let maxUtilizationThresholdStep = 0;
  let totalUtilizationThresholdStep = 0;
  let utilizationThresholdStepSamples = 0;
  let nextRequiredTransitionStepCount = 0;
  let hardBudgetReliableCount = 0;
  let qualityFirstReliableCount = 0;
  let highEvidenceTurns = 0;
  let highEvidenceHardenTurns = 0;
  const learnAlphaValues: number[] = [];
  const requiredTransitionsValues: number[] = [];
  const nextRequiredTransitionsValues: number[] = [];
  const combinedEvidenceScoreValues: number[] = [];
  const floorStages: PromptCompactionStage[] = [];
  const modes: string[] = [];

  for (let index = 0; index < windowsRaw.length; index += 1) {
    const row = windowsRaw[index];
    if (!isRecord(row)) {
      continue;
    }
    const window = parsePromptQualityGuardAdaptiveWindow(row);
    const adaptiveDecision = derivePromptQualityGuardAdaptivePolicy({
      basePolicy,
      adaptiveEnabled,
      adaptiveModeAllowlist,
      currentState: state,
      window,
    });
    const observation = {
      degraded: window.degraded,
      reason: window.reason,
      observedOverall: window.observedOverall,
      observedLowQualityRate: window.observedLowQualityRate,
    };
    const guardDecision = evaluatePromptQualityGuard({
      policy: adaptiveDecision.effectivePolicy,
      currentState: state,
      observation,
    });
    state = {
      ...guardDecision.state,
      pressureUtilizationThreshold: adaptiveDecision.pressurePolicy.utilizationThreshold,
      pressureSemanticRateThreshold: adaptiveDecision.pressurePolicy.semanticRateThreshold,
      pressureAutoLimitRateThreshold: adaptiveDecision.pressurePolicy.autoLimitRateThreshold,
      pressureJointRateThreshold: adaptiveDecision.pressurePolicy.jointRateThreshold,
      pressureTrendUtilizationDelta: adaptiveDecision.pressurePolicy.trendUtilizationDelta,
      pressureTrendSemanticDelta: adaptiveDecision.pressurePolicy.trendSemanticDelta,
      pressureTrendAutoLimitDelta: adaptiveDecision.pressurePolicy.trendAutoLimitDelta,
      pressureTrendMomentum: adaptiveDecision.pressurePolicy.trendMomentum,
      outcomeRequiredTransitions: adaptiveDecision.outcomeReliability.nextRequiredTransitions,
      outcomeCombinedEvidenceScore: adaptiveDecision.outcomeReliability.combinedEvidenceScore,
    };
    requiredTransitionsValues.push(adaptiveDecision.outcomeReliability.requiredTransitions);
    nextRequiredTransitionsValues.push(adaptiveDecision.outcomeReliability.nextRequiredTransitions);
    combinedEvidenceScoreValues.push(adaptiveDecision.outcomeReliability.combinedEvidenceScore);
    if (
      previousNextRequiredTransitions !== null
      && previousNextRequiredTransitions !== adaptiveDecision.outcomeReliability.nextRequiredTransitions
    ) {
      nextRequiredTransitionStepCount += 1;
    }
    previousNextRequiredTransitions = adaptiveDecision.outcomeReliability.nextRequiredTransitions;
    if (adaptiveDecision.outcomeReliability.hardBudgetReliable) {
      hardBudgetReliableCount += 1;
    }
    if (adaptiveDecision.outcomeReliability.qualityFirstReliable) {
      qualityFirstReliableCount += 1;
    }
    const highEvidenceTurn =
      adaptiveDecision.outcomeReliability.combinedEvidenceScore >= 0.72
      && (
        adaptiveDecision.outcomeReliability.hardBudgetReliable
        || adaptiveDecision.outcomeReliability.qualityFirstReliable
      );
    if (highEvidenceTurn) {
      highEvidenceTurns += 1;
      if (adaptiveDecision.mode === "harden") {
        highEvidenceHardenTurns += 1;
      }
    }
    const appliedStage = applyPromptQualityGuardFloor({
      selectedStage,
      floorStage: guardDecision.floorStage,
    });
    floorStages.push(appliedStage);
    modes.push(adaptiveDecision.mode);
    if (previousMode !== null && previousMode !== adaptiveDecision.mode) {
      modeTransitionCount += 1;
    }
    previousMode = adaptiveDecision.mode;
    if (adaptiveDecision.pressurePolicy.trendFlipSuppressed) {
      trendFlipSuppressedCount += 1;
    }
    learnAlphaValues.push(adaptiveDecision.pressurePolicy.learnAlpha);
    if (previousUtilizationThreshold !== null) {
      const step = Math.abs(
        adaptiveDecision.pressurePolicy.utilizationThreshold - previousUtilizationThreshold,
      );
      maxUtilizationThresholdStep = Math.max(maxUtilizationThresholdStep, step);
      totalUtilizationThresholdStep += step;
      utilizationThresholdStepSamples += 1;
    }
    previousUtilizationThreshold = adaptiveDecision.pressurePolicy.utilizationThreshold;
  }

  const totalTurns = learnAlphaValues.length;
  const uniqueModes = Array.from(new Set(modes));
  const uniqueStages = Array.from(new Set(floorStages));
  const learnAlphaMin = totalTurns > 0 ? Math.min(...learnAlphaValues) : null;
  const learnAlphaMax = totalTurns > 0 ? Math.max(...learnAlphaValues) : null;
  const learnAlphaAvg = totalTurns > 0
    ? Math.round((learnAlphaValues.reduce((sum, value) => sum + value, 0) / totalTurns) * 1000) / 1000
    : null;
  const modeTransitionRate = totalTurns > 1
    ? Math.round((modeTransitionCount / (totalTurns - 1)) * 1000) / 1000
    : 0;
  const trendFlipSuppressedRate = totalTurns > 0
    ? Math.round((trendFlipSuppressedCount / totalTurns) * 1000) / 1000
    : 0;
  const requiredTransitionsMin = totalTurns > 0 ? Math.min(...requiredTransitionsValues) : null;
  const requiredTransitionsMax = totalTurns > 0 ? Math.max(...requiredTransitionsValues) : null;
  const requiredTransitionsAvg = totalTurns > 0
    ? Math.round((requiredTransitionsValues.reduce((sum, value) => sum + value, 0) / totalTurns) * 1000) / 1000
    : null;
  const nextRequiredTransitionsMin = totalTurns > 0 ? Math.min(...nextRequiredTransitionsValues) : null;
  const nextRequiredTransitionsMax = totalTurns > 0 ? Math.max(...nextRequiredTransitionsValues) : null;
  const nextRequiredTransitionsAvg = totalTurns > 0
    ? Math.round((nextRequiredTransitionsValues.reduce((sum, value) => sum + value, 0) / totalTurns) * 1000) / 1000
    : null;
  const combinedEvidenceScoreMin = totalTurns > 0 ? Math.min(...combinedEvidenceScoreValues) : null;
  const combinedEvidenceScoreMax = totalTurns > 0 ? Math.max(...combinedEvidenceScoreValues) : null;
  const combinedEvidenceScoreAvg = totalTurns > 0
    ? Math.round((combinedEvidenceScoreValues.reduce((sum, value) => sum + value, 0) / totalTurns) * 1000) / 1000
    : null;
  const hardBudgetReliableRate = totalTurns > 0
    ? Math.round((hardBudgetReliableCount / totalTurns) * 1000) / 1000
    : 0;
  const qualityFirstReliableRate = totalTurns > 0
    ? Math.round((qualityFirstReliableCount / totalTurns) * 1000) / 1000
    : 0;
  const driftGuardBase = derivePromptQualityGuardOutcomeDriftGuard({
    highEvidenceTurn: false,
    highEvidenceTurns,
    highEvidenceHardenTurns,
  });
  const driftWindowSeedEntries = Math.min(
    highEvidenceTurns,
    driftGuardBase.windowSummary.windowSize,
  );
  const driftWindowSeed = Array.from(
    { length: driftWindowSeedEntries },
    () => driftGuardBase.autoActionLevel,
  );
  const driftGuard = derivePromptQualityGuardOutcomeDriftGuard({
    highEvidenceTurn: false,
    highEvidenceTurns,
    highEvidenceHardenTurns,
    recentAutoActionLevels: driftWindowSeed,
  });

  return {
    turns: totalTurns,
    selected_stage: selectedStage,
    adaptive_enabled: adaptiveEnabled,
    adaptive_mode_allowlist: adaptiveModeAllowlist,
    mode_transitions: {
      count: modeTransitionCount,
      rate: modeTransitionRate,
      unique_modes: uniqueModes,
    },
    floor_stages: {
      unique_stages: uniqueStages,
      final_stage: floorStages[floorStages.length - 1] ?? selectedStage,
    },
    pressure_alpha: {
      min: learnAlphaMin,
      max: learnAlphaMax,
      avg: learnAlphaAvg,
    },
    pressure_threshold_steps: {
      max_utilization_step:
        Math.round(maxUtilizationThresholdStep * 1000) / 1000,
      avg_utilization_step:
        utilizationThresholdStepSamples > 0
          ? Math.round((totalUtilizationThresholdStep / utilizationThresholdStepSamples) * 1000) / 1000
          : 0,
      samples: utilizationThresholdStepSamples,
    },
    trend_flip_suppressed: {
      count: trendFlipSuppressedCount,
      rate: trendFlipSuppressedRate,
    },
    outcome_reliability: {
      required_transitions: {
        min: requiredTransitionsMin,
        max: requiredTransitionsMax,
        avg: requiredTransitionsAvg,
        final: requiredTransitionsValues[requiredTransitionsValues.length - 1] ?? null,
      },
      next_required_transitions: {
        min: nextRequiredTransitionsMin,
        max: nextRequiredTransitionsMax,
        avg: nextRequiredTransitionsAvg,
        final: nextRequiredTransitionsValues[nextRequiredTransitionsValues.length - 1] ?? null,
        transitions: nextRequiredTransitionStepCount,
      },
      combined_evidence_score: {
        min: combinedEvidenceScoreMin,
        max: combinedEvidenceScoreMax,
        avg: combinedEvidenceScoreAvg,
        final: combinedEvidenceScoreValues[combinedEvidenceScoreValues.length - 1] ?? null,
      },
      reliable_rate: {
        hard_budget: hardBudgetReliableRate,
        quality_first: qualityFirstReliableRate,
      },
    },
    drift_guard: {
      high_evidence_harden_bias: driftGuard.highEvidenceHardenBias,
      high_evidence_turns: driftGuard.highEvidenceTurns,
      high_evidence_harden_turns: driftGuard.highEvidenceHardenTurns,
      high_evidence_harden_rate: driftGuard.highEvidenceHardenRate,
      threshold_harden_rate: driftGuard.thresholdHardenRate,
      min_high_evidence_turns: driftGuard.minHighEvidenceTurns,
      reason: driftGuard.reason,
      auto_action_level: driftGuard.autoActionLevel,
      recent_auto_action_levels: driftGuard.recentAutoActionLevels,
      window_summary: {
        window_size: driftGuard.windowSummary.windowSize,
        entries: driftGuard.windowSummary.entries,
        latest: driftGuard.windowSummary.latest,
        dominant: driftGuard.windowSummary.dominant,
        alert_level: driftGuard.windowSummary.alertLevel,
        transition_count: driftGuard.windowSummary.transitionCount,
        active_rate: driftGuard.windowSummary.activeRate,
        medium_or_hard_rate: driftGuard.windowSummary.mediumOrHardRate,
        hard_rate: driftGuard.windowSummary.hardRate,
        level_counts: driftGuard.windowSummary.levelCounts,
      },
      recommendation: driftGuard.recommendation,
    },
    final_state: state,
  };
}

function runCli(argv: string[]): number {
  const { command, options } = parseArgs(argv);
  const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
  switch (command) {
    case "resolve-config": {
      process.stdout.write(`${JSON.stringify(runResolveConfig(payload))}\n`);
      return 0;
    }
    case "prepare-prompt": {
      process.stdout.write(`${JSON.stringify(runPreparePrompt(payload))}\n`);
      return 0;
    }
    case "graph-cache": {
      process.stdout.write(`${JSON.stringify(runGraphCache(payload))}\n`);
      return 0;
    }
    case "graph-cache-hot-loop": {
      process.stdout.write(`${JSON.stringify(runGraphCacheHotLoop(payload))}\n`);
      return 0;
    }
    case "downshift-guard": {
      process.stdout.write(`${JSON.stringify(runDownshiftGuard(payload))}\n`);
      return 0;
    }
    case "trim-recent-turns": {
      process.stdout.write(`${JSON.stringify(runTrimRecentTurns(payload))}\n`);
      return 0;
    }
    case "trim-snapshot-sections": {
      process.stdout.write(`${JSON.stringify(runTrimSnapshotSections(payload))}\n`);
      return 0;
    }
    case "semantic-compress-snapshot-sections": {
      process.stdout.write(`${JSON.stringify(runSemanticCompressSnapshotSections(payload))}\n`);
      return 0;
    }
    case "pre-send-compression-plan": {
      process.stdout.write(`${JSON.stringify(runPreSendCompressionPlan(payload))}\n`);
      return 0;
    }
    case "prompt-quality-window": {
      process.stdout.write(`${JSON.stringify(runPromptQualityWindow(payload))}\n`);
      return 0;
    }
    case "prompt-quality-guard": {
      process.stdout.write(`${JSON.stringify(runPromptQualityGuard(payload))}\n`);
      return 0;
    }
    case "prompt-quality-guard-runtime": {
      process.stdout.write(`${JSON.stringify(runPromptQualityGuardRuntime(payload))}\n`);
      return 0;
    }
    case "prompt-quality-guard-adaptive-policy": {
      process.stdout.write(`${JSON.stringify(runPromptQualityGuardAdaptivePolicy(payload))}\n`);
      return 0;
    }
    case "prompt-quality-guard-adaptive-sequence": {
      process.stdout.write(`${JSON.stringify(runPromptQualityGuardAdaptiveSequence(payload))}\n`);
      return 0;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

const entryScript = process.argv[1] ?? "";
const shouldRun = entryScript.includes("context-engine-contract");
if (shouldRun) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`context-engine-contract fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}

export { runCli };
