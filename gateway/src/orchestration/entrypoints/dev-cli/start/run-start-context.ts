import { readFileSync } from "node:fs";
import { resolveExecutionPlaneConfig } from "../../../execution-plane";
import {
  type KimiWebSearchMode,
  type RuntimeModelConfig,
  type RuntimePromptCacheCapability,
  type RuntimePromptCacheStrategy,
  type RuntimeToolContext,
} from "../../../../models/types";
import { buildSessionKey } from "../../../../models/session-key";
import { hasFlag, OptionValue, readOptionString } from "../cli-args";
import { readProviderPoolFromToml } from "../provider-probe";
import {
  resolveRuntimeBinaryPath,
  runRuntimeToolsDescribe,
} from "../runtime-health";
import {
  basenameFromPath,
  resolveConfigTomlPath,
  resolveExperiencePoolPath,
  resolveLegacyExperiencePoolPath,
  resolveHomeDir,
  resolveInterruptStorePath,
  resolveProjectStateRoot,
  resolveProjectRoot,
  resolveProjectTomlPath,
  resolveWorkDir,
} from "../services/runtime-paths";
import { buildDefaultRuntimeEnabledTools } from "../../../../tools/runtime/default-enabled-tools";
import { resolveMcpInstructionRuntime } from "../services/mcp-instruction-pack";
import { resolveContextEngineConfig, type ContextEngineConfig } from "../../../../tools/context";
import { createRunStartSessionStore } from "./run-start-session-store";
import { sessionRegistryFilePath } from "./session-registry";
import {
  parsePlatform,
  parseScope,
  resolveHandoffAutoOnExit,
  resolveHandoffRecentTurns,
  resolveHistoryTurns,
  resolveSessionPlatformOption,
  resolveSessionScopeOption,
  resolveSessionSubjectOption,
} from "./session-options";
import { buildHandoffPath } from "./run-start-io";
import { type StatusLineConfigInput } from "../ui/screens/status-line-screen";

interface ResolvedRuntimeModelConfig {
  modelConfig?: RuntimeModelConfig;
  providerChain: RuntimeProviderCandidate[];
  failoverConfig: RuntimeFailoverConfig;
  modelConfigSource: {
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs: string;
    providerKind: string;
  };
}

const DEFAULT_RUNTIME_HTTP_TIMEOUT_MS_OPENAI_COMPATIBLE = 10_000;
const DEFAULT_RUNTIME_HTTP_TIMEOUT_MS_KIMI = 45_000;
const DEFAULT_KIMI_MAX_TOKENS = 262_144;
const DEFAULT_KIMI_STREAM = true;
const DEFAULT_KIMI_TEMPERATURE = 1.0;
const DEFAULT_KIMI_TOP_P = 0.95;
const DEFAULT_PROMPT_CACHE_STRATEGY: RuntimePromptCacheStrategy = "user_last_n";
const DEFAULT_PROMPT_CACHE_USER_LAST_N = 2;
const DEFAULT_PROMPT_CACHE_CAPABILITY: RuntimePromptCacheCapability = "unsupported";

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

function parseTomlStringArray(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }
  const content = trimmed.slice(1, -1).trim();
  if (!content) {
    return [];
  }
  const values: string[] = [];
  for (const token of content.split(",")) {
    const part = token.trim();
    if (!part.startsWith("\"") || !part.endsWith("\"")) {
      continue;
    }
    const value = part.slice(1, -1).trim();
    if (!value) {
      continue;
    }
    values.push(value);
  }
  return values;
}

function parseTomlString(raw: string): string | undefined {
  const trimmed = raw.trim();
  const match = trimmed.match(/^"([^"]*)"$/);
  if (!match || typeof match[1] !== "string") {
    return undefined;
  }
  return match[1].trim();
}

function parseTomlStringRaw(raw: string): string | undefined {
  const trimmed = raw.trim();
  const match = trimmed.match(/^"([^"]*)"$/);
  if (!match || typeof match[1] !== "string") {
    return undefined;
  }
  return match[1];
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

function parseTomlNumber(raw: string): number | undefined {
  const normalized = raw.trim();
  if (!normalized || !/^-?\d+(\.\d+)?$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function parseTomlInteger(raw: string): number | undefined {
  const normalized = raw.trim();
  if (!normalized || !/^-?\d+$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function parsePercentageAsRatio(raw: string): number | undefined {
  const parsed = parseTomlNumber(raw);
  if (typeof parsed !== "number") {
    return undefined;
  }
  return parsed / 100;
}

function readStatusLineConfigFromProjectToml(
  projectTomlPath?: string,
): StatusLineConfigInput | undefined {
  if (!projectTomlPath) {
    return undefined;
  }
  let raw = "";
  try {
    raw = readFileSync(projectTomlPath, "utf8");
  } catch {
    return undefined;
  }
  const lines = raw.split(/\r?\n/);
  const statusLineConfig: StatusLineConfigInput = {};
  const statusLineSegments: Partial<
    Record<"model" | "project" | "context" | "tokens" | "session", boolean>
  > = {};
  let activeSection = "";
  let hasSignal = false;
  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      activeSection = sectionMatch[1];
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kvMatch) {
      continue;
    }
    const key = kvMatch[1];
    const rawValue = kvMatch[2];
    if (activeSection === "statusline") {
      if (key === "enabled") {
        const parsed = parseTomlBoolean(rawValue);
        if (typeof parsed === "boolean") {
          statusLineConfig.enabled = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "layout_mode" || key === "layout") {
        const parsed = parseTomlString(rawValue);
        if (typeof parsed === "string" && parsed.length > 0) {
          statusLineConfig.layoutMode = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "theme") {
        const parsed = parseTomlString(rawValue);
        if (typeof parsed === "string" && parsed.length > 0) {
          statusLineConfig.theme = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "separator") {
        const parsed = parseTomlStringRaw(rawValue);
        if (typeof parsed === "string" && parsed.length > 0) {
          statusLineConfig.separator = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "segment_order") {
        const parsed = parseTomlStringArray(rawValue);
        if (parsed.length > 0) {
          statusLineConfig.segmentOrder = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "warning_threshold_ratio") {
        const parsed = parseTomlNumber(rawValue);
        if (typeof parsed === "number") {
          statusLineConfig.warningThresholdRatio = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "critical_threshold_ratio") {
        const parsed = parseTomlNumber(rawValue);
        if (typeof parsed === "number") {
          statusLineConfig.criticalThresholdRatio = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "warning_threshold_percent") {
        const parsed = parsePercentageAsRatio(rawValue);
        if (typeof parsed === "number") {
          statusLineConfig.warningThresholdRatio = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "critical_threshold_percent") {
        const parsed = parsePercentageAsRatio(rawValue);
        if (typeof parsed === "number") {
          statusLineConfig.criticalThresholdRatio = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "budget_snapshot_cache_ttl_ms") {
        const parsed = parseTomlInteger(rawValue);
        if (typeof parsed === "number") {
          statusLineConfig.budgetSnapshotCacheTtlMs = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "session_topic_cache_ttl_ms") {
        const parsed = parseTomlInteger(rawValue);
        if (typeof parsed === "number") {
          statusLineConfig.sessionTopicCacheTtlMs = parsed;
          hasSignal = true;
        }
        continue;
      }
      if (key === "session_topic_max_width") {
        const parsed = parseTomlInteger(rawValue);
        if (typeof parsed === "number") {
          statusLineConfig.sessionTopicMaxWidth = parsed;
          hasSignal = true;
        }
        continue;
      }
      continue;
    }
    if (activeSection === "statusline.segments") {
      const parsed = parseTomlBoolean(rawValue);
      if (typeof parsed !== "boolean") {
        continue;
      }
      if (
        key === "model"
        || key === "project"
        || key === "context"
        || key === "tokens"
        || key === "session"
      ) {
        statusLineSegments[key] = parsed;
        hasSignal = true;
      }
    }
  }
  if (!hasSignal) {
    return undefined;
  }
  if (Object.keys(statusLineSegments).length > 0) {
    statusLineConfig.segments = statusLineSegments;
  }
  return statusLineConfig;
}

function readToolsAllowlistFromProjectToml(projectTomlPath?: string): string[] {
  if (!projectTomlPath) {
    return [];
  }
  let raw = "";
  try {
    raw = readFileSync(projectTomlPath, "utf8");
  } catch {
    return [];
  }
  const lines = raw.split(/\r?\n/);
  let inToolsSection = false;
  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      inToolsSection = sectionMatch[1] === "tools";
      continue;
    }
    if (!inToolsSection) {
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kvMatch) {
      continue;
    }
    if (kvMatch[1] !== "allow") {
      continue;
    }
    return parseTomlStringArray(kvMatch[2]);
  }
  return [];
}

function resolveRuntimeDefaultEnabledTools(): string[] | undefined {
  const runtimeBinaryPath = resolveRuntimeBinaryPath();
  const described = runRuntimeToolsDescribe(runtimeBinaryPath);
  if (described.ok && described.defaultEnabledTools.length > 0) {
    return [...described.defaultEnabledTools];
  }
  return undefined;
}

function resolveRuntimeToolContext(workDir: string, projectTomlPath?: string): RuntimeToolContext {
  const bashAllowlist = readToolsAllowlistFromProjectToml(projectTomlPath);
  const maxToolRoundsRaw = process.env.GROBOT_MAX_TOOL_ROUNDS;
  const parsedMaxToolRounds =
    typeof maxToolRoundsRaw === "string" && /^\d+$/.test(maxToolRoundsRaw.trim())
      ? Number.parseInt(maxToolRoundsRaw.trim(), 10)
      : undefined;
  const maxToolRounds =
    typeof parsedMaxToolRounds === "number" && Number.isFinite(parsedMaxToolRounds)
      ? Math.min(Math.max(parsedMaxToolRounds, 1), 32)
      : 8;
  const noToolFallbackModeRaw = process.env.GROBOT_NO_TOOL_FALLBACK_MODE?.trim().toLowerCase();
  const noToolFallbackMode = noToolFallbackModeRaw === "off"
    || noToolFallbackModeRaw === "safe"
    || noToolFallbackModeRaw === "strict"
    ? noToolFallbackModeRaw
    : "safe";
  const maxRecoveryRoundsRaw = process.env.GROBOT_MAX_RECOVERY_ROUNDS;
  const parsedMaxRecoveryRounds =
    typeof maxRecoveryRoundsRaw === "string" && /^\d+$/.test(maxRecoveryRoundsRaw.trim())
      ? Number.parseInt(maxRecoveryRoundsRaw.trim(), 10)
      : undefined;
  const maxRecoveryRounds =
    typeof parsedMaxRecoveryRounds === "number" && Number.isFinite(parsedMaxRecoveryRounds)
      ? Math.min(Math.max(parsedMaxRecoveryRounds, 0), 8)
      : 2;
  const enabledTools = resolveRuntimeDefaultEnabledTools() ?? buildDefaultRuntimeEnabledTools();
  return {
    workDir,
    enabledTools,
    bashAllowlist,
    maxToolRounds,
    noToolFallbackMode,
    maxRecoveryRounds,
  };
}

function resolveExperiencePublishMode(): "auto" | "off" {
  const raw = process.env.GROBOT_EXPERIENCE_PUBLISH_MODE?.trim().toLowerCase();
  if (raw === "off") {
    return "off";
  }
  return "auto";
}

function resolveExperienceRecallLimit(): number {
  const raw = process.env.GROBOT_EXPERIENCE_RECALL_LIMIT?.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    return 2;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return 2;
  }
  return Math.min(Math.max(parsed, 1), 6);
}

function resolveExperienceTeam(options: Record<string, OptionValue>): string {
  const fromOption = readOptionString(options, "team");
  if (typeof fromOption === "string" && fromOption.trim().length > 0) {
    return fromOption.trim();
  }
  const fromEnv = process.env.GROBOT_TEAM;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  return "default";
}

interface RuntimeProviderCandidate {
  name: string;
  modelConfig: RuntimeModelConfig;
  source: string;
  priority?: number;
  weight?: number;
  unitCost?: number;
  maxInFlight?: number;
  requestsPerMinute?: number;
  burst?: number;
}

interface RuntimeFailoverConfig {
  circuitFailures: number;
  circuitCooldownSecs: number;
  stickyMode: "session_key";
}

type KimiSearchRoutingPolicy =
  | "mcp_first_fallback_builtin"
  | "builtin_only"
  | "mcp_only";

const DEFAULT_KIMI_OFFICIAL_TOOLS_ALLOWLIST = [
  "web-search",
  "date",
  "fetch",
  "rethink",
  "code_runner",
];
const DEFAULT_KIMI_SEARCH_ROUTING_POLICY: KimiSearchRoutingPolicy = "mcp_first_fallback_builtin";

function normalizeProviderKind(rawKind: string | undefined, providerName?: string, baseUrl?: string): "openai_compatible" | "kimi" {
  const normalizedKind = rawKind?.trim().toLowerCase();
  if (normalizedKind === "kimi") {
    return "kimi";
  }
  if (normalizedKind === "openai_compatible" || normalizedKind === "openai-compatible") {
    return "openai_compatible";
  }
  const normalizedProviderName = providerName?.trim().toLowerCase() ?? "";
  if (normalizedProviderName === "kimi") {
    return "kimi";
  }
  const normalizedBaseUrl = baseUrl?.trim().toLowerCase() ?? "";
  if (normalizedBaseUrl.includes("moonshot.cn")) {
    return "kimi";
  }
  return "openai_compatible";
}

function normalizeKimiAllowlist(raw: string[] | undefined): string[] {
  const fromConfig = Array.isArray(raw)
    ? raw
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
    : [];
  if (fromConfig.length > 0) {
    return fromConfig;
  }
  return [...DEFAULT_KIMI_OFFICIAL_TOOLS_ALLOWLIST];
}

function normalizeKimiWebSearchMode(raw: string | undefined): KimiWebSearchMode {
  const normalized = raw?.trim().toLowerCase();
  if (
    normalized === "builtin_preferred" ||
    normalized === "builtin_only" ||
    normalized === "official_only" ||
    normalized === "off"
  ) {
    return normalized;
  }
  return "builtin_preferred";
}

function normalizeKimiMaxTokens(raw: number | undefined): number {
  const normalized = normalizePositiveInt(raw);
  if (typeof normalized !== "number") {
    return DEFAULT_KIMI_MAX_TOKENS;
  }
  return Math.min(Math.max(normalized, 1_024), DEFAULT_KIMI_MAX_TOKENS);
}

function normalizeKimiTemperature(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_KIMI_TEMPERATURE;
  }
  return Math.min(Math.max(raw, 0), 2);
}

function normalizeKimiTopP(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_KIMI_TOP_P;
  }
  return Math.min(Math.max(raw, 0), 1);
}

function normalizePromptCacheStrategy(raw: string | undefined): RuntimePromptCacheStrategy {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "user_last_n") {
    return "user_last_n";
  }
  return DEFAULT_PROMPT_CACHE_STRATEGY;
}

function normalizePromptCacheUserLastN(raw: number | undefined): number {
  const normalized = normalizePositiveInt(raw);
  if (typeof normalized !== "number") {
    return DEFAULT_PROMPT_CACHE_USER_LAST_N;
  }
  return Math.min(Math.max(normalized, 1), 12);
}

function normalizePromptCacheCapability(raw: string | undefined): RuntimePromptCacheCapability {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "anthropic_compatible" || normalized === "anthropic-compatible") {
    return "anthropic_compatible";
  }
  if (normalized === "unsupported" || normalized === "off" || normalized === "none") {
    return "unsupported";
  }
  return DEFAULT_PROMPT_CACHE_CAPABILITY;
}

function resolvePromptCacheOptions(input: {
  enabled?: boolean;
  strategy?: string;
  userLastN?: number;
  capability?: string;
}): {
  enabled: boolean;
  strategy: RuntimePromptCacheStrategy;
  userLastN: number;
  capability: RuntimePromptCacheCapability;
} | undefined {
  const hasConfigSignal =
    typeof input.enabled === "boolean"
    || typeof input.strategy === "string"
    || typeof input.userLastN === "number"
    || typeof input.capability === "string";
  if (!hasConfigSignal) {
    return undefined;
  }
  return {
    enabled: input.enabled ?? false,
    strategy: normalizePromptCacheStrategy(input.strategy),
    userLastN: normalizePromptCacheUserLastN(input.userLastN),
    capability: normalizePromptCacheCapability(input.capability),
  };
}

function normalizeKimiSearchRoutingPolicy(raw: string | undefined): KimiSearchRoutingPolicy | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (
    normalized === "mcp_first_fallback_builtin"
    || normalized === "builtin_only"
    || normalized === "mcp_only"
  ) {
    return normalized;
  }
  return undefined;
}

function readKimiSearchRoutingPolicyFromProjectToml(projectTomlPath?: string): KimiSearchRoutingPolicy {
  if (!projectTomlPath) {
    return DEFAULT_KIMI_SEARCH_ROUTING_POLICY;
  }
  let raw = "";
  try {
    raw = readFileSync(projectTomlPath, "utf8");
  } catch {
    return DEFAULT_KIMI_SEARCH_ROUTING_POLICY;
  }
  const lines = raw.split(/\r?\n/);
  let inSearchRoutingSection = false;
  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      inSearchRoutingSection = sectionMatch[1] === "search.routing";
      continue;
    }
    if (!inSearchRoutingSection) {
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kvMatch) {
      continue;
    }
    const key = kvMatch[1];
    if (key !== "kimi" && key !== "kimi_route") {
      continue;
    }
    const parsedValue = parseTomlString(kvMatch[2]);
    const policy = normalizeKimiSearchRoutingPolicy(parsedValue);
    if (policy) {
      return policy;
    }
  }
  return DEFAULT_KIMI_SEARCH_ROUTING_POLICY;
}

function resolveDefaultRuntimeHttpTimeoutMs(providerKind: "openai_compatible" | "kimi"): number {
  if (providerKind === "kimi") {
    return DEFAULT_RUNTIME_HTTP_TIMEOUT_MS_KIMI;
  }
  return DEFAULT_RUNTIME_HTTP_TIMEOUT_MS_OPENAI_COMPATIBLE;
}

function parseRequiredPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = parseOptionalPositiveInt(value);
  if (typeof parsed !== "number") {
    return fallback;
  }
  return parsed;
}

function parseOptionalPositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function normalizePositiveInt(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return undefined;
  }
  return normalized;
}

function resolveRuntimeModelConfig(
  options: Record<string, OptionValue>,
  fallbackPool: {
    source: string;
      providers: Array<{
        name: string;
        baseUrl?: string;
        apiKey?: string;
        model?: string;
        providerKind?: string;
        kimiWebSearchMode?: string;
        kimiDisableThinkingOnBuiltinWebSearch?: boolean;
        kimiOfficialToolsAllowlist?: string[];
        kimiMaxTokens?: number;
        kimiStream?: boolean;
        kimiTemperature?: number;
        kimiTopP?: number;
        kimiFilesEnabled?: boolean;
        kimiAllowFileAdmin?: boolean;
        promptCacheEnabled?: boolean;
        promptCacheStrategy?: string;
        promptCacheUserLastN?: number;
        promptCacheCapability?: string;
        priority?: number;
        weight?: number;
        unitCost?: number;
        maxInFlight?: number;
        requestsPerMinute?: number;
        burst?: number;
      }>;
    } | undefined,
): ResolvedRuntimeModelConfig {
  const baseUrlFromCli = readOptionString(options, "base-url");
  const apiKeyFromCli = readOptionString(options, "api-key");
  const modelFromCli = readOptionString(options, "model");
  const timeoutFromCli = readOptionString(options, "runtime-http-timeout-ms");
  const circuitFailuresFromCli = readOptionString(options, "circuit-failures");
  const circuitCooldownFromCli = readOptionString(options, "circuit-cooldown-secs");
  const providerMaxInFlightFromCli = readOptionString(options, "provider-max-inflight");
  const providerRequestsPerMinuteFromCli = readOptionString(options, "provider-requests-per-minute");
  const providerBurstFromCli = readOptionString(options, "provider-burst");

  const fallback = fallbackPool?.providers[0];
  const baseUrlFromEnv = process.env.GROBOT_BASE_URL;
  const apiKeyFromEnv = process.env.GROBOT_API_KEY;
  const modelFromEnv = process.env.GROBOT_MODEL;
  const timeoutFromEnv = process.env.GROBOT_RUNTIME_HTTP_TIMEOUT_MS;
  const providerMaxInFlightFromEnv = process.env.GROBOT_PROVIDER_MAX_INFLIGHT;
  const providerRequestsPerMinuteFromEnv = process.env.GROBOT_PROVIDER_REQUESTS_PER_MINUTE;
  const providerBurstFromEnv = process.env.GROBOT_PROVIDER_BURST;

  const hasDirectRuntimeOverride =
    Boolean(baseUrlFromCli) ||
    Boolean(apiKeyFromCli) ||
    Boolean(modelFromCli) ||
    Boolean(baseUrlFromEnv) ||
    Boolean(apiKeyFromEnv) ||
    Boolean(modelFromEnv);

  const baseUrl = baseUrlFromCli ?? baseUrlFromEnv ?? fallback?.baseUrl;
  const apiKey = apiKeyFromCli ?? apiKeyFromEnv ?? fallback?.apiKey;
  const model = modelFromCli ?? modelFromEnv ?? fallback?.model;
  const defaultProviderKind = normalizeProviderKind(
    hasDirectRuntimeOverride ? undefined : fallback?.providerKind,
    fallback?.name,
    baseUrl,
  );
  const timeoutMs = parseOptionalPositiveInt(
    timeoutFromCli ?? timeoutFromEnv,
  );
  const defaultTimeoutMs = resolveDefaultRuntimeHttpTimeoutMs(defaultProviderKind);
  const resolvedTimeoutMs = timeoutMs ?? defaultTimeoutMs;
  const providerMaxInFlightDefault = parseOptionalPositiveInt(
    providerMaxInFlightFromCli ?? providerMaxInFlightFromEnv,
  );
  const providerRequestsPerMinuteDefault = parseOptionalPositiveInt(
    providerRequestsPerMinuteFromCli ?? providerRequestsPerMinuteFromEnv,
  );
  const providerBurstDefault = parseOptionalPositiveInt(
    providerBurstFromCli ?? providerBurstFromEnv,
  );
  const circuitFailures = parseRequiredPositiveInt(circuitFailuresFromCli, 2);
  const circuitCooldownSecs = parseRequiredPositiveInt(circuitCooldownFromCli, 30);

  const source = {
    baseUrl: baseUrlFromCli ? "cli:base-url" : baseUrlFromEnv ? "env:GROBOT_BASE_URL" : fallback?.baseUrl ? "config_toml:provider.base_url" : "unset",
    apiKey: apiKeyFromCli ? "cli:api-key" : apiKeyFromEnv ? "env:GROBOT_API_KEY" : fallback?.apiKey ? "config_toml:provider.api_key" : "unset",
    model: modelFromCli ? "cli:model" : modelFromEnv ? "env:GROBOT_MODEL" : fallback?.model ? "config_toml:provider.model" : "unset",
      timeoutMs: timeoutFromCli
        ? "cli:runtime-http-timeout-ms"
        : timeoutFromEnv
          ? "env:GROBOT_RUNTIME_HTTP_TIMEOUT_MS"
          : `default:${String(defaultTimeoutMs)}`,
      providerKind: "derived",
    };

  const modelConfig: RuntimeModelConfig = {};
  if (typeof baseUrl === "string" && baseUrl.trim().length > 0) {
    modelConfig.baseUrl = baseUrl.trim();
  }
  if (typeof apiKey === "string" && apiKey.trim().length > 0) {
    modelConfig.apiKey = apiKey.trim();
  }
  if (typeof model === "string" && model.trim().length > 0) {
    modelConfig.model = model.trim();
  }
  if (typeof timeoutMs === "number") {
    modelConfig.timeoutMs = timeoutMs;
  } else {
    modelConfig.timeoutMs = resolvedTimeoutMs;
  }
    modelConfig.providerKind = defaultProviderKind;
  if (defaultProviderKind === "kimi") {
    modelConfig.providerOptions = {
      kimi: {
        webSearchMode: normalizeKimiWebSearchMode(fallback?.kimiWebSearchMode),
        disableThinkingOnBuiltinWebSearch:
          fallback?.kimiDisableThinkingOnBuiltinWebSearch ?? true,
        officialToolsAllowlist: normalizeKimiAllowlist(fallback?.kimiOfficialToolsAllowlist),
        promptCache: resolvePromptCacheOptions({
          enabled: fallback?.promptCacheEnabled,
          strategy: fallback?.promptCacheStrategy,
          userLastN: fallback?.promptCacheUserLastN,
          capability: fallback?.promptCacheCapability,
        }),
        maxTokens: normalizeKimiMaxTokens(fallback?.kimiMaxTokens),
        stream: fallback?.kimiStream ?? DEFAULT_KIMI_STREAM,
        temperature: normalizeKimiTemperature(fallback?.kimiTemperature),
        topP: normalizeKimiTopP(fallback?.kimiTopP),
        filesEnabled: fallback?.kimiFilesEnabled ?? true,
        allowFileAdmin: fallback?.kimiAllowFileAdmin ?? false,
      },
    };
  }
  source.providerKind = defaultProviderKind === "kimi"
    ? "derived:kimi"
    : "derived:openai_compatible";

  const providerChain: RuntimeProviderCandidate[] = [];
  if (!hasDirectRuntimeOverride && fallbackPool && fallbackPool.providers.length > 0) {
    for (const provider of fallbackPool.providers) {
      const providerBaseUrl = provider.baseUrl?.trim();
      const providerApiKey = provider.apiKey?.trim();
      const providerModel = provider.model?.trim();
      if (!providerBaseUrl || !providerApiKey || !providerModel) {
        continue;
      }
      const candidateModelConfig: RuntimeModelConfig = {
        baseUrl: providerBaseUrl,
        apiKey: providerApiKey,
        model: providerModel,
      };
        const providerKind = normalizeProviderKind(provider.providerKind, provider.name, providerBaseUrl);
        candidateModelConfig.providerKind = providerKind;
        candidateModelConfig.timeoutMs = typeof timeoutMs === "number"
          ? timeoutMs
          : resolveDefaultRuntimeHttpTimeoutMs(providerKind);
        if (providerKind === "kimi") {
        candidateModelConfig.providerOptions = {
          kimi: {
            webSearchMode: normalizeKimiWebSearchMode(provider.kimiWebSearchMode),
            disableThinkingOnBuiltinWebSearch:
              provider.kimiDisableThinkingOnBuiltinWebSearch ?? true,
            officialToolsAllowlist: normalizeKimiAllowlist(provider.kimiOfficialToolsAllowlist),
            promptCache: resolvePromptCacheOptions({
              enabled: provider.promptCacheEnabled,
              strategy: provider.promptCacheStrategy,
              userLastN: provider.promptCacheUserLastN,
              capability: provider.promptCacheCapability,
            }),
            maxTokens: normalizeKimiMaxTokens(provider.kimiMaxTokens),
            stream: provider.kimiStream ?? DEFAULT_KIMI_STREAM,
            temperature: normalizeKimiTemperature(provider.kimiTemperature),
            topP: normalizeKimiTopP(provider.kimiTopP),
            filesEnabled: provider.kimiFilesEnabled ?? true,
            allowFileAdmin: provider.kimiAllowFileAdmin ?? false,
          },
        };
      }
        providerChain.push({
          name: provider.name.trim(),
          modelConfig: candidateModelConfig,
          source: fallbackPool.source,
          priority: typeof provider.priority === "number" ? provider.priority : undefined,
          weight: typeof provider.weight === "number" ? provider.weight : undefined,
          unitCost: typeof provider.unitCost === "number" ? provider.unitCost : undefined,
          maxInFlight: normalizePositiveInt(provider.maxInFlight) ?? providerMaxInFlightDefault,
          requestsPerMinute: normalizePositiveInt(provider.requestsPerMinute) ?? providerRequestsPerMinuteDefault,
          burst: normalizePositiveInt(provider.burst)
            ?? providerBurstDefault
            ?? normalizePositiveInt(provider.requestsPerMinute)
            ?? providerRequestsPerMinuteDefault,
        });
      }
    }
    if (providerChain.length === 0 && Object.keys(modelConfig).length > 0) {
      const directRequestsPerMinute = providerRequestsPerMinuteDefault;
      providerChain.push({
        name: hasDirectRuntimeOverride ? "direct-override" : (fallback?.name?.trim() || "direct"),
        modelConfig,
        source: hasDirectRuntimeOverride ? "direct-runtime-override" : fallbackPool?.source ?? "runtime-model",
        maxInFlight: providerMaxInFlightDefault,
        requestsPerMinute: directRequestsPerMinute,
        burst: providerBurstDefault ?? directRequestsPerMinute,
      });
    }

  return {
    modelConfig: Object.keys(modelConfig).length > 0 ? modelConfig : undefined,
    providerChain,
    failoverConfig: {
      circuitFailures,
      circuitCooldownSecs,
      stickyMode: "session_key",
    },
    modelConfigSource: source,
  };
}

export function resolveRunStartContext(options: Record<string, OptionValue>) {
  const homeDir = resolveHomeDir(options);
  const projectRoot = resolveProjectRoot(options, homeDir);
  const workDir = resolveWorkDir(options, projectRoot, homeDir);
  const projectStateRoot = resolveProjectStateRoot(workDir);
  const projectTomlPath = resolveProjectTomlPath(options, workDir, projectRoot, homeDir);
  const configTomlPath = resolveConfigTomlPath(options, homeDir, { workDir, projectRoot });
  const projectName = readOptionString(options, "project") ?? basenameFromPath(workDir);
  const providerOverride = readOptionString(options, "provider");
  const providerPoolSnapshot = readProviderPoolFromToml(
    configTomlPath,
    projectName,
    workDir,
    homeDir,
    providerOverride,
  );
  const runtimeModelConfig = resolveRuntimeModelConfig(options, providerPoolSnapshot ? {
    source: providerPoolSnapshot.source,
    providers: providerPoolSnapshot.providers,
  } : undefined);
  const contextEngineConfig: ContextEngineConfig = resolveContextEngineConfig({
    projectTomlPath,
    runtimeModelConfig: runtimeModelConfig.modelConfig,
  });
  const historyTurns = resolveHistoryTurns(options);
  const handoffRecentTurns = resolveHandoffRecentTurns(options);
  const handoffAutoOnExit = resolveHandoffAutoOnExit(options);
  const handoffPath = buildHandoffPath(projectRoot);
  const interruptStorePath = resolveInterruptStorePath(projectStateRoot);
  const experiencePoolPathRaw = process.env.GROBOT_EXPERIENCE_POOL_PATH?.trim();
  const experienceLegacyPoolPath = resolveLegacyExperiencePoolPath(homeDir);
  const experienceTeam = resolveExperienceTeam(options);
  const subject = resolveSessionSubjectOption(options) ?? process.env.USER ?? "user";
  const executionPlane = resolveExecutionPlaneConfig({
    gatewayImplArg: readOptionString(options, "gateway-impl"),
    runtimeImplArg: readOptionString(options, "runtime-impl"),
    shadowModeArg: hasFlag(options, "shadow-mode"),
    noShadowModeArg: hasFlag(options, "no-shadow-mode"),
    projectTomlPath,
  });

  const sessionNamespace = {
    platform: parsePlatform(resolveSessionPlatformOption(options)),
    tenant: readOptionString(options, "tenant") ?? projectName,
    scope: parseScope(resolveSessionScopeOption(options)),
    subject,
  } as const;
  const experiencePoolPath = experiencePoolPathRaw && experiencePoolPathRaw.length > 0
    ? experiencePoolPathRaw
    : resolveExperiencePoolPath(projectStateRoot, {
      tenant: sessionNamespace.tenant,
      team: experienceTeam,
      user: sessionNamespace.subject,
    });
  const sessionNamespaceKey = buildSessionKey(sessionNamespace);
  const sessionRegistryFilePathValue = sessionRegistryFilePath(projectStateRoot, sessionNamespaceKey);
  const sessionStore = createRunStartSessionStore({
    options,
    projectTomlPath,
    homeDir: projectStateRoot,
    sessionNamespaceKey,
    historyTurns,
  });
  const kimiSearchRoutingPolicy = readKimiSearchRoutingPolicyFromProjectToml(projectTomlPath);
  const statusLineConfig = readStatusLineConfigFromProjectToml(projectTomlPath);
  const mcpInstructionRuntime = resolveMcpInstructionRuntime({
    homeDir,
    workDir,
    projectTomlPath,
  });

  return {
    homeDir,
    projectRoot,
    workDir,
    projectTomlPath,
    projectName,
    historyTurns,
    handoffRecentTurns,
    handoffAutoOnExit,
    handoffPath,
    interruptStorePath,
    experiencePoolPath,
    experienceLegacyPoolPath,
    experienceTeam,
    experiencePublishMode: resolveExperiencePublishMode(),
    experienceRecallLimit: resolveExperienceRecallLimit(),
    subject,
    executionPlane,
    sessionNamespaceKey,
    sessionRegistryFilePathValue,
    sessionStore,
    runtimeModelConfig: runtimeModelConfig.modelConfig,
    runtimeProviderChain: runtimeModelConfig.providerChain,
    runtimeFailoverConfig: runtimeModelConfig.failoverConfig,
    runtimeModelConfigSource: runtimeModelConfig.modelConfigSource,
    contextEngineConfig,
    runtimeToolContext: resolveRuntimeToolContext(workDir, projectTomlPath),
    kimiSearchRoutingPolicy,
    statusLineConfig,
    mcpInstructionPromptPrefix: mcpInstructionRuntime.promptPrefix,
    mcpInstructionServerNames: mcpInstructionRuntime.loadedServerNames,
    mcpInstructionEvents: mcpInstructionRuntime.events,
    mcpInstructionStrictFailure: mcpInstructionRuntime.strictFailure,
  };
}
