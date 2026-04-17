import {
  prepareTurnPrompt,
  resolveContextEngineConfig,
  type ContextEngineConfig,
  type ContextHistoryMessage,
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
  return {
    enabled: config.enabled,
    profile: config.profile,
    context_window_tokens: config.contextWindowTokens,
    reserved_output_tokens: config.reservedOutputTokens,
    safety_margin_tokens: config.safetyMarginTokens,
    proactive_ratio: config.thresholds.proactiveRatio,
    forced_ratio: config.thresholds.forcedRatio,
    hard_ratio: config.thresholds.hardRatio,
    reactive_max_retries: config.recovery.reactiveMaxRetries,
    ptl_max_retries: config.recovery.ptlMaxRetries,
    circuit_breaker_failures: config.recovery.circuitBreakerFailures,
    reactive_on_prompt_too_long: config.reactiveOnPromptTooLong,
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
