import { readFileSync } from "node:fs";
import { type RuntimeModelConfig } from "../../../models/types";
import {
  type ContextCompressionProfile,
  type ContextEngineConfig,
  type ContextPromptQualityGuardAdaptiveMode,
  type PromptCompactionStage,
} from "../types";

const DEFAULT_CONTEXT_WINDOW_OPENAI_COMPATIBLE = 128_000;
const DEFAULT_CONTEXT_WINDOW_KIMI = 262_144;
const DEFAULT_RESERVED_OUTPUT_TOKENS = 20_000;
const DEFAULT_SAFETY_MARGIN_TOKENS = 3_000;
const DEFAULT_AUTO_COMPACT_RATIO = 0.9;
const DEFAULT_LINEAGE_MAX_ROWS = 3;
const DEFAULT_LINEAGE_MAX_COMMITS = 120;
const DEFAULT_LINEAGE_CACHE_TTL_MS = 30_000;
const DEFAULT_WORKSPACE_SIGNALS_MAX_ROWS = 4;
const DEFAULT_WORKSPACE_SIGNALS_CACHE_TTL_MS = 2_000;
const DEFAULT_SEMANTIC_PREFETCH_TIMEOUT_MS = 2_500;
const DEFAULT_SEMANTIC_PREFETCH_MAX_EVIDENCE = 6;
const DEFAULT_DEPENDENCY_GRAPH_MAX_ROWS = 4;
const DEFAULT_SYMBOL_GRAPH_MAX_ROWS = 4;
const DEFAULT_PROMPT_QUALITY_LOW_QUALITY_THRESHOLD = 0.6;
const DEFAULT_PROMPT_QUALITY_DEGRADE_OVERALL_THRESHOLD = 0.62;
const DEFAULT_PROMPT_QUALITY_DEGRADE_LOW_RATE_THRESHOLD = 0.4;
const DEFAULT_PROMPT_QUALITY_DEGRADE_MIN_ENTRIES = 8;
const DEFAULT_PROMPT_QUALITY_GUARD_ENABLED = true;
const DEFAULT_PROMPT_QUALITY_GUARD_ADAPTIVE_ENABLED = true;
const DEFAULT_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST: ContextPromptQualityGuardAdaptiveMode[] = [
  "harden",
  "relax",
];
const DEFAULT_PROMPT_QUALITY_GUARD_PROMOTE_STREAK = 2;
const DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_PROMOTE_STREAK = 2;
const DEFAULT_PROMPT_QUALITY_GUARD_RELEASE_STREAK = 3;
const DEFAULT_PROMPT_QUALITY_GUARD_HOLD_TURNS = 2;
const DEFAULT_PROMPT_QUALITY_GUARD_MAX_FLOOR_STAGE: PromptCompactionStage = "minimal";
const DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_OVERALL_THRESHOLD = 0.45;
const DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_LOW_RATE_THRESHOLD = 0.7;

type ThresholdProfile = {
  proactive: number;
  forced: number;
  hard: number;
};

const PROFILE_THRESHOLDS: Record<ContextCompressionProfile, ThresholdProfile> = {
  balanced: {
    proactive: 0.88,
    forced: 0.93,
    hard: 0.97,
  },
  aggressive: {
    proactive: 0.82,
    forced: 0.89,
    hard: 0.94,
  },
  conservative: {
    proactive: 0.92,
    forced: 0.95,
    hard: 0.98,
  },
};

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

function parseEnvBoolean(raw: string | undefined): boolean | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "off", "no"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function parseEnvNumber(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = Number.parseFloat(raw.trim());
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function parseEnvStringList(raw: string | undefined): string[] | undefined {
  if (!raw) {
    return undefined;
  }
  const values = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return values.length > 0 ? values : [];
}

function clampRatio(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(0.995, Math.max(0.5, value));
}

function clampUnitRatio(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

function clampPositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return fallback;
  }
  return normalized;
}

function normalizeProfile(raw: string | undefined): ContextCompressionProfile {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "aggressive") {
    return "aggressive";
  }
  if (normalized === "conservative") {
    return "conservative";
  }
  return "balanced";
}

function normalizePromptQualityGuardMaxFloorStage(
  raw: string | undefined,
): PromptCompactionStage {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "proactive") {
    return "proactive";
  }
  if (normalized === "forced") {
    return "forced";
  }
  if (normalized === "minimal") {
    return "minimal";
  }
  return DEFAULT_PROMPT_QUALITY_GUARD_MAX_FLOOR_STAGE;
}

function normalizePromptQualityGuardAdaptiveMode(
  raw: string | undefined,
): ContextPromptQualityGuardAdaptiveMode | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "harden") {
    return "harden";
  }
  if (normalized === "relax") {
    return "relax";
  }
  return undefined;
}

function normalizePromptQualityGuardAdaptiveModeAllowlist(
  raw: string[] | undefined,
): ContextPromptQualityGuardAdaptiveMode[] {
  if (!Array.isArray(raw)) {
    return [...DEFAULT_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST];
  }
  const unique = new Set<ContextPromptQualityGuardAdaptiveMode>();
  for (const value of raw) {
    const normalized = normalizePromptQualityGuardAdaptiveMode(value);
    if (normalized) {
      unique.add(normalized);
    }
  }
  if (unique.size === 0) {
    return [...DEFAULT_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST];
  }
  return Array.from(unique.values());
}

function resolveDefaultContextWindow(modelConfig?: RuntimeModelConfig): number {
  const providerKind = modelConfig?.providerKind?.trim().toLowerCase();
  if (providerKind === "kimi") {
    return DEFAULT_CONTEXT_WINDOW_KIMI;
  }
  const baseUrl = modelConfig?.baseUrl?.trim().toLowerCase() ?? "";
  if (baseUrl.includes("moonshot.cn")) {
    return DEFAULT_CONTEXT_WINDOW_KIMI;
  }
  return DEFAULT_CONTEXT_WINDOW_OPENAI_COMPATIBLE;
}

interface TomlOverrides {
  enabled?: boolean;
  profile?: ContextCompressionProfile;
  contextWindowTokens?: number;
  reservedOutputTokens?: number;
  safetyMarginTokens?: number;
  autoCompactTokenLimit?: number;
  proactiveRatio?: number;
  forcedRatio?: number;
  hardRatio?: number;
  reactiveMaxRetries?: number;
  ptlMaxRetries?: number;
  circuitBreakerFailures?: number;
  reactiveOnPromptTooLong?: boolean;
  lineageEnabled?: boolean;
  lineageMaxRows?: number;
  lineageMaxCommits?: number;
  lineageCacheTtlMs?: number;
  workspaceSignalsEnabled?: boolean;
  workspaceSignalsMaxRows?: number;
  workspaceSignalsIncludeUntracked?: boolean;
  workspaceSignalsCacheTtlMs?: number;
  semanticPrefetchEnabled?: boolean;
  semanticPrefetchTimeoutMs?: number;
  semanticPrefetchMaxEvidence?: number;
  dependencyGraphEnabled?: boolean;
  dependencyGraphMaxRows?: number;
  symbolGraphEnabled?: boolean;
  symbolGraphMaxRows?: number;
  promptQualityLowQualityThreshold?: number;
  promptQualityDegradeOverallThreshold?: number;
  promptQualityDegradeLowQualityRateThreshold?: number;
  promptQualityDegradeMinEntries?: number;
  promptQualityGuardEnabled?: boolean;
  promptQualityGuardAdaptiveEnabled?: boolean;
  promptQualityGuardAdaptiveModeAllowlist?: ContextPromptQualityGuardAdaptiveMode[];
  promptQualityGuardPromoteStreak?: number;
  promptQualityGuardSeverePromoteStreak?: number;
  promptQualityGuardReleaseStreak?: number;
  promptQualityGuardHoldTurns?: number;
  promptQualityGuardMaxFloorStage?: PromptCompactionStage;
  promptQualityGuardSevereOverallThreshold?: number;
  promptQualityGuardSevereLowQualityRateThreshold?: number;
}

function readTomlOverrides(projectTomlPath?: string): TomlOverrides {
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
    const key = kvMatch[1];
    const valueRaw = kvMatch[2];
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
  return overrides;
}

export function resolveContextEngineConfig(input: {
  projectTomlPath?: string;
  runtimeModelConfig?: RuntimeModelConfig;
}): ContextEngineConfig {
  const fromToml = readTomlOverrides(input.projectTomlPath);
  const profile = normalizeProfile(
    process.env.GROBOT_CONTEXT_ENGINE_PROFILE ?? fromToml.profile,
  );
  const profileThresholds = PROFILE_THRESHOLDS[profile];

  const enabledByEnv = parseEnvBoolean(process.env.GROBOT_CONTEXT_ENGINE_ENABLED);
  const enabled = enabledByEnv ?? fromToml.enabled ?? true;
  const contextWindowTokens = clampPositiveInt(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_WINDOW)
      ?? fromToml.contextWindowTokens
      ?? resolveDefaultContextWindow(input.runtimeModelConfig),
    resolveDefaultContextWindow(input.runtimeModelConfig),
  );
  const reservedOutputTokens = clampPositiveInt(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_RESERVED_OUTPUT_TOKENS)
      ?? fromToml.reservedOutputTokens
      ?? DEFAULT_RESERVED_OUTPUT_TOKENS,
    DEFAULT_RESERVED_OUTPUT_TOKENS,
  );
  const safetyMarginTokens = clampPositiveInt(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_SAFETY_MARGIN_TOKENS)
      ?? fromToml.safetyMarginTokens
      ?? DEFAULT_SAFETY_MARGIN_TOKENS,
    DEFAULT_SAFETY_MARGIN_TOKENS,
  );
  const effectiveWindowTokens = Math.max(
    1_024,
    contextWindowTokens - reservedOutputTokens - safetyMarginTokens,
  );
  const defaultAutoCompactTokenLimit = Math.max(
    1,
    Math.floor(contextWindowTokens * DEFAULT_AUTO_COMPACT_RATIO),
  );
  const autoCompactTokenLimit = Math.max(
    1,
    Math.min(
      effectiveWindowTokens,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_AUTO_COMPACT_TOKEN_LIMIT)
          ?? fromToml.autoCompactTokenLimit
          ?? defaultAutoCompactTokenLimit,
        defaultAutoCompactTokenLimit,
      ),
    ),
  );
  const proactiveRatio = clampRatio(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROACTIVE_RATIO)
      ?? fromToml.proactiveRatio
      ?? profileThresholds.proactive,
    profileThresholds.proactive,
  );
  const forcedRatio = clampRatio(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_FORCED_RATIO)
      ?? fromToml.forcedRatio
      ?? profileThresholds.forced,
    profileThresholds.forced,
  );
  const hardRatio = clampRatio(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_HARD_RATIO)
      ?? fromToml.hardRatio
      ?? profileThresholds.hard,
    profileThresholds.hard,
  );
  const reactiveMaxRetries = clampPositiveInt(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_REACTIVE_MAX_RETRIES)
      ?? fromToml.reactiveMaxRetries
      ?? 1,
    1,
  );
  const ptlMaxRetries = clampPositiveInt(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PTL_MAX_RETRIES)
      ?? fromToml.ptlMaxRetries
      ?? 3,
    3,
  );
  const circuitBreakerFailures = clampPositiveInt(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_CIRCUIT_BREAKER_FAILURES)
      ?? fromToml.circuitBreakerFailures
      ?? 3,
    3,
  );
  const reactiveOnPromptTooLong =
    parseEnvBoolean(process.env.GROBOT_CONTEXT_ENGINE_REACTIVE_ON_PTL)
    ?? fromToml.reactiveOnPromptTooLong
    ?? true;
  const promptQualityLowQualityThreshold = clampUnitRatio(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_LOW_QUALITY_THRESHOLD)
      ?? fromToml.promptQualityLowQualityThreshold
      ?? DEFAULT_PROMPT_QUALITY_LOW_QUALITY_THRESHOLD,
    DEFAULT_PROMPT_QUALITY_LOW_QUALITY_THRESHOLD,
  );
  const promptQualityDegradeOverallThreshold = clampUnitRatio(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_DEGRADE_OVERALL_THRESHOLD)
      ?? fromToml.promptQualityDegradeOverallThreshold
      ?? DEFAULT_PROMPT_QUALITY_DEGRADE_OVERALL_THRESHOLD,
    DEFAULT_PROMPT_QUALITY_DEGRADE_OVERALL_THRESHOLD,
  );
  const promptQualityDegradeLowQualityRateThreshold = clampUnitRatio(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_DEGRADE_LOW_QUALITY_RATE_THRESHOLD)
      ?? fromToml.promptQualityDegradeLowQualityRateThreshold
      ?? DEFAULT_PROMPT_QUALITY_DEGRADE_LOW_RATE_THRESHOLD,
    DEFAULT_PROMPT_QUALITY_DEGRADE_LOW_RATE_THRESHOLD,
  );
  const promptQualityDegradeMinEntries = Math.max(
    1,
    Math.min(
      512,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_DEGRADE_MIN_ENTRIES)
          ?? fromToml.promptQualityDegradeMinEntries
          ?? DEFAULT_PROMPT_QUALITY_DEGRADE_MIN_ENTRIES,
        DEFAULT_PROMPT_QUALITY_DEGRADE_MIN_ENTRIES,
      ),
    ),
  );
  const promptQualityGuardEnabled =
    parseEnvBoolean(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_ENABLED)
    ?? fromToml.promptQualityGuardEnabled
    ?? DEFAULT_PROMPT_QUALITY_GUARD_ENABLED;
  const promptQualityGuardAdaptiveEnabled =
    parseEnvBoolean(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_ADAPTIVE_ENABLED)
    ?? fromToml.promptQualityGuardAdaptiveEnabled
    ?? DEFAULT_PROMPT_QUALITY_GUARD_ADAPTIVE_ENABLED;
  const promptQualityGuardAdaptiveModeAllowlist =
    normalizePromptQualityGuardAdaptiveModeAllowlist(
      parseEnvStringList(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST)
      ?? fromToml.promptQualityGuardAdaptiveModeAllowlist
      ?? DEFAULT_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST,
    );
  const promptQualityGuardPromoteStreak = Math.max(
    1,
    Math.min(
      32,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_PROMOTE_STREAK)
          ?? fromToml.promptQualityGuardPromoteStreak
          ?? DEFAULT_PROMPT_QUALITY_GUARD_PROMOTE_STREAK,
        DEFAULT_PROMPT_QUALITY_GUARD_PROMOTE_STREAK,
      ),
    ),
  );
  const promptQualityGuardSeverePromoteStreak = Math.max(
    1,
    Math.min(
      32,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_SEVERE_PROMOTE_STREAK)
          ?? fromToml.promptQualityGuardSeverePromoteStreak
          ?? DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_PROMOTE_STREAK,
        DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_PROMOTE_STREAK,
      ),
    ),
  );
  const promptQualityGuardReleaseStreak = Math.max(
    1,
    Math.min(
      64,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_RELEASE_STREAK)
          ?? fromToml.promptQualityGuardReleaseStreak
          ?? DEFAULT_PROMPT_QUALITY_GUARD_RELEASE_STREAK,
        DEFAULT_PROMPT_QUALITY_GUARD_RELEASE_STREAK,
      ),
    ),
  );
  const promptQualityGuardHoldTurnsRaw =
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_HOLD_TURNS)
    ?? fromToml.promptQualityGuardHoldTurns
    ?? DEFAULT_PROMPT_QUALITY_GUARD_HOLD_TURNS;
  const promptQualityGuardHoldTurns =
    Number.isFinite(promptQualityGuardHoldTurnsRaw)
      ? Math.max(0, Math.min(64, Math.floor(promptQualityGuardHoldTurnsRaw)))
      : DEFAULT_PROMPT_QUALITY_GUARD_HOLD_TURNS;
  const promptQualityGuardMaxFloorStage = normalizePromptQualityGuardMaxFloorStage(
    process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_MAX_FLOOR_STAGE
      ?? fromToml.promptQualityGuardMaxFloorStage,
  );
  const promptQualityGuardSevereOverallThreshold = clampUnitRatio(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_SEVERE_OVERALL_THRESHOLD)
      ?? fromToml.promptQualityGuardSevereOverallThreshold
      ?? DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_OVERALL_THRESHOLD,
    DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_OVERALL_THRESHOLD,
  );
  const promptQualityGuardSevereLowQualityRateThreshold = clampUnitRatio(
    parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_SEVERE_LOW_QUALITY_RATE_THRESHOLD)
      ?? fromToml.promptQualityGuardSevereLowQualityRateThreshold
      ?? DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_LOW_RATE_THRESHOLD,
    DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_LOW_RATE_THRESHOLD,
  );
  const lineageEnabled =
    parseEnvBoolean(process.env.GROBOT_CONTEXT_ENGINE_LINEAGE_ENABLED)
    ?? fromToml.lineageEnabled
    ?? true;
  const lineageMaxRows = Math.min(
    16,
    clampPositiveInt(
      parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_LINEAGE_MAX_ROWS)
      ?? fromToml.lineageMaxRows
      ?? DEFAULT_LINEAGE_MAX_ROWS,
      DEFAULT_LINEAGE_MAX_ROWS,
    ),
  );
  const lineageMaxCommits = Math.min(
    500,
    clampPositiveInt(
      parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_LINEAGE_MAX_COMMITS)
      ?? fromToml.lineageMaxCommits
      ?? DEFAULT_LINEAGE_MAX_COMMITS,
      DEFAULT_LINEAGE_MAX_COMMITS,
    ),
  );
  const lineageCacheTtlMs = Math.max(
    1_000,
    Math.min(
      600_000,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_LINEAGE_CACHE_TTL_MS)
        ?? fromToml.lineageCacheTtlMs
        ?? DEFAULT_LINEAGE_CACHE_TTL_MS,
        DEFAULT_LINEAGE_CACHE_TTL_MS,
      ),
    ),
  );
  const workspaceSignalsEnabled =
    parseEnvBoolean(process.env.GROBOT_CONTEXT_ENGINE_WORKSPACE_SIGNALS_ENABLED)
    ?? fromToml.workspaceSignalsEnabled
    ?? true;
  const workspaceSignalsMaxRows = Math.min(
    20,
    clampPositiveInt(
      parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_WORKSPACE_SIGNALS_MAX_ROWS)
      ?? fromToml.workspaceSignalsMaxRows
      ?? DEFAULT_WORKSPACE_SIGNALS_MAX_ROWS,
      DEFAULT_WORKSPACE_SIGNALS_MAX_ROWS,
    ),
  );
  const workspaceSignalsIncludeUntracked =
    parseEnvBoolean(process.env.GROBOT_CONTEXT_ENGINE_WORKSPACE_SIGNALS_INCLUDE_UNTRACKED)
    ?? fromToml.workspaceSignalsIncludeUntracked
    ?? true;
  const workspaceSignalsCacheTtlMs = Math.max(
    200,
    Math.min(
      60_000,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_WORKSPACE_SIGNALS_CACHE_TTL_MS)
        ?? fromToml.workspaceSignalsCacheTtlMs
        ?? DEFAULT_WORKSPACE_SIGNALS_CACHE_TTL_MS,
        DEFAULT_WORKSPACE_SIGNALS_CACHE_TTL_MS,
      ),
    ),
  );
  const semanticPrefetchEnabled =
    parseEnvBoolean(process.env.GROBOT_CONTEXT_ENGINE_SEMANTIC_PREFETCH_ENABLED)
    ?? fromToml.semanticPrefetchEnabled
    ?? false;
  const semanticPrefetchTimeoutMs = Math.max(
    300,
    Math.min(
      15_000,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_SEMANTIC_PREFETCH_TIMEOUT_MS)
        ?? fromToml.semanticPrefetchTimeoutMs
        ?? DEFAULT_SEMANTIC_PREFETCH_TIMEOUT_MS,
        DEFAULT_SEMANTIC_PREFETCH_TIMEOUT_MS,
      ),
    ),
  );
  const semanticPrefetchMaxEvidence = Math.max(
    1,
    Math.min(
      24,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_SEMANTIC_PREFETCH_MAX_EVIDENCE)
        ?? fromToml.semanticPrefetchMaxEvidence
        ?? DEFAULT_SEMANTIC_PREFETCH_MAX_EVIDENCE,
        DEFAULT_SEMANTIC_PREFETCH_MAX_EVIDENCE,
      ),
    ),
  );
  const dependencyGraphEnabled =
    parseEnvBoolean(process.env.GROBOT_CONTEXT_ENGINE_DEPENDENCY_GRAPH_ENABLED)
    ?? fromToml.dependencyGraphEnabled
    ?? true;
  const dependencyGraphMaxRows = Math.max(
    1,
    Math.min(
      20,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_DEPENDENCY_GRAPH_MAX_ROWS)
        ?? fromToml.dependencyGraphMaxRows
        ?? DEFAULT_DEPENDENCY_GRAPH_MAX_ROWS,
        DEFAULT_DEPENDENCY_GRAPH_MAX_ROWS,
      ),
    ),
  );
  const symbolGraphEnabled =
    parseEnvBoolean(process.env.GROBOT_CONTEXT_ENGINE_SYMBOL_GRAPH_ENABLED)
    ?? fromToml.symbolGraphEnabled
    ?? true;
  const symbolGraphMaxRows = Math.max(
    1,
    Math.min(
      20,
      clampPositiveInt(
        parseEnvNumber(process.env.GROBOT_CONTEXT_ENGINE_SYMBOL_GRAPH_MAX_ROWS)
        ?? fromToml.symbolGraphMaxRows
        ?? DEFAULT_SYMBOL_GRAPH_MAX_ROWS,
        DEFAULT_SYMBOL_GRAPH_MAX_ROWS,
      ),
    ),
  );

  return {
    enabled,
    profile,
    contextWindowTokens,
    reservedOutputTokens,
    safetyMarginTokens,
    autoCompactTokenLimit,
    thresholds: {
      proactiveRatio: proactiveRatio,
      forcedRatio: Math.max(forcedRatio, proactiveRatio + 0.01),
      hardRatio: Math.max(hardRatio, forcedRatio + 0.01),
    },
    recovery: {
      reactiveMaxRetries,
      ptlMaxRetries,
      circuitBreakerFailures,
    },
    promptQuality: {
      lowQualityThreshold: promptQualityLowQualityThreshold,
      degradeOverallThreshold: promptQualityDegradeOverallThreshold,
      degradeLowQualityRateThreshold: promptQualityDegradeLowQualityRateThreshold,
      degradeMinEntries: promptQualityDegradeMinEntries,
      guardEnabled: promptQualityGuardEnabled,
      guardAdaptiveEnabled: promptQualityGuardAdaptiveEnabled,
      guardAdaptiveModeAllowlist: promptQualityGuardAdaptiveModeAllowlist,
      guardPromoteStreak: promptQualityGuardPromoteStreak,
      guardSeverePromoteStreak: promptQualityGuardSeverePromoteStreak,
      guardReleaseStreak: promptQualityGuardReleaseStreak,
      guardHoldTurns: promptQualityGuardHoldTurns,
      guardMaxFloorStage: promptQualityGuardMaxFloorStage,
      guardSevereOverallThreshold: promptQualityGuardSevereOverallThreshold,
      guardSevereLowQualityRateThreshold: promptQualityGuardSevereLowQualityRateThreshold,
    },
    lineage: {
      enabled: lineageEnabled,
      maxRows: lineageMaxRows,
      maxCommits: lineageMaxCommits,
      cacheTtlMs: lineageCacheTtlMs,
    },
    workspaceSignals: {
      enabled: workspaceSignalsEnabled,
      maxRows: workspaceSignalsMaxRows,
      includeUntracked: workspaceSignalsIncludeUntracked,
      cacheTtlMs: workspaceSignalsCacheTtlMs,
    },
    semanticPrefetch: {
      enabled: semanticPrefetchEnabled,
      timeoutMs: semanticPrefetchTimeoutMs,
      maxEvidence: semanticPrefetchMaxEvidence,
    },
    dependencyGraph: {
      enabled: dependencyGraphEnabled,
      maxRows: dependencyGraphMaxRows,
    },
    symbolGraph: {
      enabled: symbolGraphEnabled,
      maxRows: symbolGraphMaxRows,
    },
    reactiveOnPromptTooLong,
  };
}
