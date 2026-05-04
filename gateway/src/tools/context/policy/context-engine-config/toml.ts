import { readFileSync } from "node:fs";
import {
  normalizeProfile,
  normalizePromptQualityGuardAdaptiveModeAllowlist,
  normalizePromptQualityGuardMaxFloorStage,
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
    if (typeof value === "string") {
      values.push(value);
    }
  }
  return values;
}

function parseTomlNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!/^[-+]?\d+(\.\d+)?$/.test(trimmed)) {
    return undefined;
  }
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function parseTomlBoolean(raw: string): boolean | undefined {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
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
  switch (key) {
    case "enabled":
      overrides.enabled = parseTomlBoolean(valueRaw);
      break;
    case "profile":
      overrides.profile = normalizeProfile(parseTomlString(valueRaw));
      break;
    case "context_window_tokens":
      overrides.contextWindowTokens = parseTomlNumber(valueRaw);
      break;
    case "reserved_output_tokens":
      overrides.reservedOutputTokens = parseTomlNumber(valueRaw);
      break;
    case "safety_margin_tokens":
      overrides.safetyMarginTokens = parseTomlNumber(valueRaw);
      break;
    case "auto_compact_token_limit":
      overrides.autoCompactTokenLimit = parseTomlNumber(valueRaw);
      break;
    case "proactive_ratio":
      overrides.proactiveRatio = parseTomlNumber(valueRaw);
      break;
    case "forced_ratio":
      overrides.forcedRatio = parseTomlNumber(valueRaw);
      break;
    case "hard_ratio":
      overrides.hardRatio = parseTomlNumber(valueRaw);
      break;
    case "reactive_max_retries":
      overrides.reactiveMaxRetries = parseTomlNumber(valueRaw);
      break;
    case "ptl_max_retries":
      overrides.ptlMaxRetries = parseTomlNumber(valueRaw);
      break;
    case "circuit_breaker_failures":
      overrides.circuitBreakerFailures = parseTomlNumber(valueRaw);
      break;
    case "reactive_on_prompt_too_long":
      overrides.reactiveOnPromptTooLong = parseTomlBoolean(valueRaw);
      break;
    case "lineage_enabled":
      overrides.lineageEnabled = parseTomlBoolean(valueRaw);
      break;
    case "lineage_max_rows":
      overrides.lineageMaxRows = parseTomlNumber(valueRaw);
      break;
    case "lineage_max_commits":
      overrides.lineageMaxCommits = parseTomlNumber(valueRaw);
      break;
    case "lineage_cache_ttl_ms":
      overrides.lineageCacheTtlMs = parseTomlNumber(valueRaw);
      break;
    case "workspace_signals_enabled":
      overrides.workspaceSignalsEnabled = parseTomlBoolean(valueRaw);
      break;
    case "workspace_signals_max_rows":
      overrides.workspaceSignalsMaxRows = parseTomlNumber(valueRaw);
      break;
    case "workspace_signals_include_untracked":
      overrides.workspaceSignalsIncludeUntracked = parseTomlBoolean(valueRaw);
      break;
    case "workspace_signals_cache_ttl_ms":
      overrides.workspaceSignalsCacheTtlMs = parseTomlNumber(valueRaw);
      break;
    case "semantic_prefetch_enabled":
      overrides.semanticPrefetchEnabled = parseTomlBoolean(valueRaw);
      break;
    case "semantic_prefetch_timeout_ms":
      overrides.semanticPrefetchTimeoutMs = parseTomlNumber(valueRaw);
      break;
    case "semantic_prefetch_max_evidence":
      overrides.semanticPrefetchMaxEvidence = parseTomlNumber(valueRaw);
      break;
    case "dependency_graph_enabled":
      overrides.dependencyGraphEnabled = parseTomlBoolean(valueRaw);
      break;
    case "dependency_graph_max_rows":
      overrides.dependencyGraphMaxRows = parseTomlNumber(valueRaw);
      break;
    case "symbol_graph_enabled":
      overrides.symbolGraphEnabled = parseTomlBoolean(valueRaw);
      break;
    case "symbol_graph_max_rows":
      overrides.symbolGraphMaxRows = parseTomlNumber(valueRaw);
      break;
    case "prompt_quality_low_quality_threshold":
      overrides.promptQualityLowQualityThreshold = parseTomlNumber(valueRaw);
      break;
    case "prompt_quality_degrade_overall_threshold":
      overrides.promptQualityDegradeOverallThreshold = parseTomlNumber(valueRaw);
      break;
    case "prompt_quality_degrade_low_quality_rate_threshold":
      overrides.promptQualityDegradeLowQualityRateThreshold = parseTomlNumber(valueRaw);
      break;
    case "prompt_quality_degrade_min_entries":
      overrides.promptQualityDegradeMinEntries = parseTomlNumber(valueRaw);
      break;
    case "prompt_quality_guard_enabled":
      overrides.promptQualityGuardEnabled = parseTomlBoolean(valueRaw);
      break;
    case "prompt_quality_guard_adaptive_enabled":
      overrides.promptQualityGuardAdaptiveEnabled = parseTomlBoolean(valueRaw);
      break;
    case "prompt_quality_guard_adaptive_mode_allowlist": {
      const rawValues = parseTomlStringArray(valueRaw);
      if (Array.isArray(rawValues)) {
        overrides.promptQualityGuardAdaptiveModeAllowlist =
          normalizePromptQualityGuardAdaptiveModeAllowlist(rawValues);
      }
      break;
    }
    case "prompt_quality_guard_promote_streak":
      overrides.promptQualityGuardPromoteStreak = parseTomlNumber(valueRaw);
      break;
    case "prompt_quality_guard_severe_promote_streak":
      overrides.promptQualityGuardSeverePromoteStreak = parseTomlNumber(valueRaw);
      break;
    case "prompt_quality_guard_release_streak":
      overrides.promptQualityGuardReleaseStreak = parseTomlNumber(valueRaw);
      break;
    case "prompt_quality_guard_hold_turns":
      overrides.promptQualityGuardHoldTurns = parseTomlNumber(valueRaw);
      break;
    case "prompt_quality_guard_max_floor_stage":
      overrides.promptQualityGuardMaxFloorStage = normalizePromptQualityGuardMaxFloorStage(
        parseTomlString(valueRaw),
      );
      break;
    case "prompt_quality_guard_severe_overall_threshold":
      overrides.promptQualityGuardSevereOverallThreshold = parseTomlNumber(valueRaw);
      break;
    case "prompt_quality_guard_severe_low_quality_rate_threshold":
      overrides.promptQualityGuardSevereLowQualityRateThreshold = parseTomlNumber(valueRaw);
      break;
    default:
      break;
  }
}
