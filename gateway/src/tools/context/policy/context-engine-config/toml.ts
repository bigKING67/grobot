import { readFileSync } from "node:fs";
import {
  parseBooleanToken,
  parseContextCompressionProfile,
  parsePromptQualityGuardMaxFloorStage,
  normalizePromptQualityGuardAdaptiveMode,
} from "./normalize";
import type { TomlOverrides } from "./types";

function stripInlineComment(line: string): string {
  let inQuote = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inQuote = !inQuote;
      continue;
    }
    if (char === "#" && !inQuote) {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseTomlString(raw: string): string | undefined {
  const trimmed = raw.trim();
  const match = trimmed.match(/^"([^"]*)"$/);
  if (!match || typeof match[1] !== "string") {
    return undefined;
  }
  return match[1].trim();
}

function parseTomlStringArray(raw: string): string[] | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return undefined;
  }
  const content = trimmed.slice(1, -1).trim();
  if (!content) {
    return [];
  }
  const values: string[] = [];
  for (const segment of content.split(",")) {
    const value = parseTomlString(segment);
    if (typeof value !== "string") {
      return undefined;
    }
    values.push(value);
  }
  return values;
}

export function parseTomlNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(trimmed)) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function parseTomlBoolean(raw: string): boolean | undefined {
  const normalized = raw.trim();
  if (normalized !== "true" && normalized !== "false") {
    return undefined;
  }
  return parseBooleanToken(normalized);
}

function pushTomlError(
  overrides: TomlOverrides,
  field: string,
  detail: string,
): void {
  if (!overrides.errors) {
    overrides.errors = [];
  }
  overrides.errors.push({ field, detail });
}

function readTomlBoolean(
  overrides: TomlOverrides,
  field: string,
  valueRaw: string,
): boolean | undefined {
  const parsed = parseTomlBoolean(valueRaw);
  if (typeof parsed !== "boolean") {
    pushTomlError(overrides, field, `${field} must be boolean`);
  }
  return parsed;
}

function readTomlNumber(
  overrides: TomlOverrides,
  field: string,
  valueRaw: string,
): number | undefined {
  const parsed = parseTomlNumber(valueRaw);
  if (typeof parsed !== "number") {
    pushTomlError(overrides, field, `${field} must be a number`);
  }
  return parsed;
}

function readTomlProfile(
  overrides: TomlOverrides,
  field: string,
  valueRaw: string,
) {
  const raw = parseTomlString(valueRaw);
  const parsed = parseContextCompressionProfile(raw);
  if (!parsed) {
    pushTomlError(
      overrides,
      field,
      `${field} must be balanced, aggressive, or conservative`,
    );
  }
  return parsed;
}

function readTomlPromptQualityGuardMaxFloorStage(
  overrides: TomlOverrides,
  field: string,
  valueRaw: string,
) {
  const raw = parseTomlString(valueRaw);
  const parsed = parsePromptQualityGuardMaxFloorStage(raw);
  if (!parsed) {
    pushTomlError(
      overrides,
      field,
      `${field} must be proactive, forced, or minimal`,
    );
  }
  return parsed;
}

function readTomlAdaptiveModeAllowlist(
  overrides: TomlOverrides,
  field: string,
  valueRaw: string,
) {
  const rawValues = parseTomlStringArray(valueRaw);
  if (!Array.isArray(rawValues)) {
    pushTomlError(overrides, field, `${field} must be an array of strings`);
    return undefined;
  }
  const unique = new Set<"harden" | "relax">();
  for (const rawValue of rawValues) {
    const normalized = normalizePromptQualityGuardAdaptiveMode(rawValue);
    if (!normalized) {
      pushTomlError(overrides, field, `${field} must include only harden or relax`);
      return undefined;
    }
    unique.add(normalized);
  }
  if (unique.size === 0) {
    pushTomlError(overrides, field, `${field} must include harden, relax, or both`);
    return undefined;
  }
  return Array.from(unique.values());
}

export function readTomlOverrides(projectTomlPath?: string): TomlOverrides {
  if (!projectTomlPath) {
    return {};
  }
  let raw = "";
  try {
    raw = readFileSync(projectTomlPath, "utf8");
  } catch {
    return {};
  }
  const overrides: TomlOverrides = {};
  const lines = raw.split(/\r?\n/);
  let inSection = false;
  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      inSection = sectionMatch[1] === "context_engine";
      continue;
    }
    if (!inSection) {
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kvMatch) {
      continue;
    }
    applyContextEngineTomlKey(overrides, kvMatch[1], kvMatch[2]);
  }
  return overrides;
}

function applyContextEngineTomlKey(
  overrides: TomlOverrides,
  key: string,
  valueRaw: string,
): void {
  if (!overrides.sourceKeys) {
    overrides.sourceKeys = new Set<string>();
  }
  switch (key) {
    case "enabled":
      overrides.sourceKeys.add("enabled");
      overrides.enabled = readTomlBoolean(overrides, "context-engine-enabled", valueRaw);
      break;
    case "profile":
      overrides.sourceKeys.add("profile");
      overrides.profile = readTomlProfile(overrides, "context-engine-profile", valueRaw);
      break;
    case "context_window_tokens":
      overrides.sourceKeys.add("contextWindowTokens");
      overrides.contextWindowTokens = readTomlNumber(overrides, "context-engine-window", valueRaw);
      break;
    case "reserved_output_tokens":
      overrides.sourceKeys.add("reservedOutputTokens");
      overrides.reservedOutputTokens = readTomlNumber(overrides, "context-engine-reserved-output-tokens", valueRaw);
      break;
    case "safety_margin_tokens":
      overrides.sourceKeys.add("safetyMarginTokens");
      overrides.safetyMarginTokens = readTomlNumber(overrides, "context-engine-safety-margin-tokens", valueRaw);
      break;
    case "auto_compact_token_limit":
      overrides.sourceKeys.add("autoCompactTokenLimit");
      overrides.autoCompactTokenLimit = readTomlNumber(overrides, "context-engine-auto-compact-token-limit", valueRaw);
      break;
    case "proactive_ratio":
      overrides.sourceKeys.add("proactiveRatio");
      overrides.proactiveRatio = readTomlNumber(overrides, "context-engine-proactive-ratio", valueRaw);
      break;
    case "forced_ratio":
      overrides.sourceKeys.add("forcedRatio");
      overrides.forcedRatio = readTomlNumber(overrides, "context-engine-forced-ratio", valueRaw);
      break;
    case "hard_ratio":
      overrides.sourceKeys.add("hardRatio");
      overrides.hardRatio = readTomlNumber(overrides, "context-engine-hard-ratio", valueRaw);
      break;
    case "reactive_max_retries":
      overrides.sourceKeys.add("reactiveMaxRetries");
      overrides.reactiveMaxRetries = readTomlNumber(overrides, "context-engine-reactive-max-retries", valueRaw);
      break;
    case "ptl_max_retries":
      overrides.sourceKeys.add("ptlMaxRetries");
      overrides.ptlMaxRetries = readTomlNumber(overrides, "context-engine-ptl-max-retries", valueRaw);
      break;
    case "circuit_breaker_failures":
      overrides.sourceKeys.add("circuitBreakerFailures");
      overrides.circuitBreakerFailures = readTomlNumber(overrides, "context-engine-circuit-breaker-failures", valueRaw);
      break;
    case "reactive_on_prompt_too_long":
      overrides.sourceKeys.add("reactiveOnPromptTooLong");
      overrides.reactiveOnPromptTooLong = readTomlBoolean(overrides, "context-engine-reactive-on-ptl", valueRaw);
      break;
    case "lineage_enabled":
      overrides.sourceKeys.add("lineageEnabled");
      overrides.lineageEnabled = readTomlBoolean(overrides, "context-engine-lineage-enabled", valueRaw);
      break;
    case "lineage_max_rows":
      overrides.sourceKeys.add("lineageMaxRows");
      overrides.lineageMaxRows = readTomlNumber(overrides, "context-engine-lineage-max-rows", valueRaw);
      break;
    case "lineage_max_commits":
      overrides.sourceKeys.add("lineageMaxCommits");
      overrides.lineageMaxCommits = readTomlNumber(overrides, "context-engine-lineage-max-commits", valueRaw);
      break;
    case "lineage_cache_ttl_ms":
      overrides.sourceKeys.add("lineageCacheTtlMs");
      overrides.lineageCacheTtlMs = readTomlNumber(overrides, "context-engine-lineage-cache-ttl-ms", valueRaw);
      break;
    case "workspace_signals_enabled":
      overrides.sourceKeys.add("workspaceSignalsEnabled");
      overrides.workspaceSignalsEnabled = readTomlBoolean(overrides, "context-engine-workspace-signals-enabled", valueRaw);
      break;
    case "workspace_signals_max_rows":
      overrides.sourceKeys.add("workspaceSignalsMaxRows");
      overrides.workspaceSignalsMaxRows = readTomlNumber(overrides, "context-engine-workspace-signals-max-rows", valueRaw);
      break;
    case "workspace_signals_include_untracked":
      overrides.sourceKeys.add("workspaceSignalsIncludeUntracked");
      overrides.workspaceSignalsIncludeUntracked = readTomlBoolean(overrides, "context-engine-workspace-signals-include-untracked", valueRaw);
      break;
    case "workspace_signals_cache_ttl_ms":
      overrides.sourceKeys.add("workspaceSignalsCacheTtlMs");
      overrides.workspaceSignalsCacheTtlMs = readTomlNumber(overrides, "context-engine-workspace-signals-cache-ttl-ms", valueRaw);
      break;
    case "semantic_prefetch_enabled":
      overrides.sourceKeys.add("semanticPrefetchEnabled");
      overrides.semanticPrefetchEnabled = readTomlBoolean(overrides, "context-engine-semantic-prefetch-enabled", valueRaw);
      break;
    case "semantic_prefetch_timeout_ms":
      overrides.sourceKeys.add("semanticPrefetchTimeoutMs");
      overrides.semanticPrefetchTimeoutMs = readTomlNumber(overrides, "context-engine-semantic-prefetch-timeout-ms", valueRaw);
      break;
    case "semantic_prefetch_max_evidence":
      overrides.sourceKeys.add("semanticPrefetchMaxEvidence");
      overrides.semanticPrefetchMaxEvidence = readTomlNumber(overrides, "context-engine-semantic-prefetch-max-evidence", valueRaw);
      break;
    case "dependency_graph_enabled":
      overrides.sourceKeys.add("dependencyGraphEnabled");
      overrides.dependencyGraphEnabled = readTomlBoolean(overrides, "context-engine-dependency-graph-enabled", valueRaw);
      break;
    case "dependency_graph_max_rows":
      overrides.sourceKeys.add("dependencyGraphMaxRows");
      overrides.dependencyGraphMaxRows = readTomlNumber(overrides, "context-engine-dependency-graph-max-rows", valueRaw);
      break;
    case "symbol_graph_enabled":
      overrides.sourceKeys.add("symbolGraphEnabled");
      overrides.symbolGraphEnabled = readTomlBoolean(overrides, "context-engine-symbol-graph-enabled", valueRaw);
      break;
    case "symbol_graph_max_rows":
      overrides.sourceKeys.add("symbolGraphMaxRows");
      overrides.symbolGraphMaxRows = readTomlNumber(overrides, "context-engine-symbol-graph-max-rows", valueRaw);
      break;
    case "prompt_quality_low_quality_threshold":
      overrides.sourceKeys.add("promptQualityLowQualityThreshold");
      overrides.promptQualityLowQualityThreshold = readTomlNumber(overrides, "context-engine-prompt-quality-low-quality-threshold", valueRaw);
      break;
    case "prompt_quality_degrade_overall_threshold":
      overrides.sourceKeys.add("promptQualityDegradeOverallThreshold");
      overrides.promptQualityDegradeOverallThreshold = readTomlNumber(overrides, "context-engine-prompt-quality-degrade-overall-threshold", valueRaw);
      break;
    case "prompt_quality_degrade_low_quality_rate_threshold":
      overrides.sourceKeys.add("promptQualityDegradeLowQualityRateThreshold");
      overrides.promptQualityDegradeLowQualityRateThreshold = readTomlNumber(overrides, "context-engine-prompt-quality-degrade-low-quality-rate-threshold", valueRaw);
      break;
    case "prompt_quality_degrade_min_entries":
      overrides.sourceKeys.add("promptQualityDegradeMinEntries");
      overrides.promptQualityDegradeMinEntries = readTomlNumber(overrides, "context-engine-prompt-quality-degrade-min-entries", valueRaw);
      break;
    case "prompt_quality_guard_enabled":
      overrides.sourceKeys.add("promptQualityGuardEnabled");
      overrides.promptQualityGuardEnabled = readTomlBoolean(overrides, "context-engine-prompt-quality-guard-enabled", valueRaw);
      break;
    case "prompt_quality_guard_adaptive_enabled":
      overrides.sourceKeys.add("promptQualityGuardAdaptiveEnabled");
      overrides.promptQualityGuardAdaptiveEnabled = readTomlBoolean(overrides, "context-engine-prompt-quality-guard-adaptive-enabled", valueRaw);
      break;
    case "prompt_quality_guard_adaptive_mode_allowlist": {
      overrides.sourceKeys.add("promptQualityGuardAdaptiveModeAllowlist");
      overrides.promptQualityGuardAdaptiveModeAllowlist =
        readTomlAdaptiveModeAllowlist(
          overrides,
          "context-engine-prompt-quality-guard-adaptive-mode-allowlist",
          valueRaw,
        );
      break;
    }
    case "prompt_quality_guard_promote_streak":
      overrides.sourceKeys.add("promptQualityGuardPromoteStreak");
      overrides.promptQualityGuardPromoteStreak = readTomlNumber(overrides, "context-engine-prompt-quality-guard-promote-streak", valueRaw);
      break;
    case "prompt_quality_guard_severe_promote_streak":
      overrides.sourceKeys.add("promptQualityGuardSeverePromoteStreak");
      overrides.promptQualityGuardSeverePromoteStreak = readTomlNumber(overrides, "context-engine-prompt-quality-guard-severe-promote-streak", valueRaw);
      break;
    case "prompt_quality_guard_release_streak":
      overrides.sourceKeys.add("promptQualityGuardReleaseStreak");
      overrides.promptQualityGuardReleaseStreak = readTomlNumber(overrides, "context-engine-prompt-quality-guard-release-streak", valueRaw);
      break;
    case "prompt_quality_guard_hold_turns":
      overrides.sourceKeys.add("promptQualityGuardHoldTurns");
      overrides.promptQualityGuardHoldTurns = readTomlNumber(overrides, "context-engine-prompt-quality-guard-hold-turns", valueRaw);
      break;
    case "prompt_quality_guard_max_floor_stage":
      overrides.sourceKeys.add("promptQualityGuardMaxFloorStage");
      overrides.promptQualityGuardMaxFloorStage = readTomlPromptQualityGuardMaxFloorStage(
        overrides,
        "context-engine-prompt-quality-guard-max-floor-stage",
        valueRaw,
      );
      break;
    case "prompt_quality_guard_severe_overall_threshold":
      overrides.sourceKeys.add("promptQualityGuardSevereOverallThreshold");
      overrides.promptQualityGuardSevereOverallThreshold = readTomlNumber(overrides, "context-engine-prompt-quality-guard-severe-overall-threshold", valueRaw);
      break;
    case "prompt_quality_guard_severe_low_quality_rate_threshold":
      overrides.sourceKeys.add("promptQualityGuardSevereLowQualityRateThreshold");
      overrides.promptQualityGuardSevereLowQualityRateThreshold = readTomlNumber(overrides, "context-engine-prompt-quality-guard-severe-low-quality-rate-threshold", valueRaw);
      break;
    default:
      break;
  }
}
