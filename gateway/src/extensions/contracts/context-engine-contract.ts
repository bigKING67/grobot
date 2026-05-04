import {
  compressPromptSnapshotSectionsSemanticallyForBudget,
  derivePromptPreSendCompressionPlan,
  estimateTokensFromText,
  nextCompactionStage,
  prepareTurnPrompt,
  resolveContextEngineConfig,
  resolvePromptTargetTokenLimit,
  shouldTriggerDownshiftPrecompact,
  trimPromptRecentTurnsForBudget,
  trimPromptSnapshotSectionsForBudget,
  type ContextEngineConfig,
  type ContextHistoryMessage,
} from "../../tools/context";
import { type RuntimeModelConfig } from "../../models/types";
import {
  runGraphCache,
  runGraphCacheHotLoop,
  runGraphPersistentIndex,
} from "./context-engine-contract/graph-contracts";
import {
  runPromptQualityGuardAdaptivePolicy,
  runPromptQualityGuardAdaptiveSequence,
} from "./context-engine-contract/prompt-quality-adaptive";
import {
  runPromptQualityGuard,
  runPromptQualityGuardRuntime,
} from "./context-engine-contract/prompt-quality-guard";
import {
  isRecord,
  normalizePromptCompactionStage,
} from "./context-engine-contract/prompt-quality-shared";
import { runPromptQualityWindow } from "./context-engine-contract/prompt-quality-window";

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
    case "graph-persistent-index": {
      process.stdout.write(`${JSON.stringify(runGraphPersistentIndex(payload))}\n`);
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
