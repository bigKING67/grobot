import { readFileSync } from "node:fs";
import {
  type KimiWebSearchMode,
  type RuntimeModelConfig,
  type RuntimePromptCacheCapability,
  type RuntimePromptCacheStrategy,
} from "../../../models/types";
import { readOptionString, type OptionValue } from "../../cli-args";
import {
  parseExplicitPositiveIntOption,
  parseExplicitRequiredPositiveIntOption,
} from "../../status/option-parsing";
import {
  type KimiSearchRoutingPolicy,
  type RuntimeFailoverConfig,
  type RuntimeProviderCandidate,
} from "../turn/contract";
import {
  parseTomlString,
  stripInlineComment,
} from "./toml";

interface RuntimeProviderPoolProvider {
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
}

interface RuntimeProviderPoolSnapshot {
  source: string;
  providers: RuntimeProviderPoolProvider[];
}

export interface ResolvedRuntimeModelConfig {
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
const DEFAULT_PROMPT_CACHE_STRATEGY: RuntimePromptCacheStrategy =
  "user_last_n";
const DEFAULT_PROMPT_CACHE_USER_LAST_N = 2;
const DEFAULT_PROMPT_CACHE_CAPABILITY: RuntimePromptCacheCapability =
  "unsupported";

const DEFAULT_KIMI_OFFICIAL_TOOLS_ALLOWLIST = [
  "web-search",
  "date",
  "fetch",
  "rethink",
  "code_runner",
];
const DEFAULT_KIMI_SEARCH_ROUTING_POLICY: KimiSearchRoutingPolicy =
  "mcp_first_fallback_builtin";

function normalizeProviderKind(
  rawKind: string | undefined,
  providerName?: string,
  baseUrl?: string,
): "openai_compatible" | "kimi" {
  const normalizedKind = rawKind?.trim().toLowerCase();
  if (normalizedKind === "kimi") {
    return "kimi";
  }
  if (
    normalizedKind === "openai_compatible" ||
    normalizedKind === "openai-compatible"
  ) {
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
    ? raw.map((item) => item.trim()).filter((item) => item.length > 0)
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

function normalizePromptCacheStrategy(
  raw: string | undefined,
): RuntimePromptCacheStrategy {
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

function normalizePromptCacheCapability(
  raw: string | undefined,
): RuntimePromptCacheCapability {
  const normalized = raw?.trim().toLowerCase();
  if (
    normalized === "anthropic_compatible" ||
    normalized === "anthropic-compatible"
  ) {
    return "anthropic_compatible";
  }
  if (
    normalized === "unsupported" ||
    normalized === "off" ||
    normalized === "none"
  ) {
    return "unsupported";
  }
  return DEFAULT_PROMPT_CACHE_CAPABILITY;
}

function resolvePromptCacheOptions(input: {
  enabled?: boolean;
  strategy?: string;
  userLastN?: number;
  capability?: string;
}):
  | {
      enabled: boolean;
      strategy: RuntimePromptCacheStrategy;
      userLastN: number;
      capability: RuntimePromptCacheCapability;
    }
  | undefined {
  const hasConfigSignal =
    typeof input.enabled === "boolean" ||
    typeof input.strategy === "string" ||
    typeof input.userLastN === "number" ||
    typeof input.capability === "string";
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

function normalizeKimiSearchRoutingPolicy(
  raw: string | undefined,
): KimiSearchRoutingPolicy | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (
    normalized === "mcp_first_fallback_builtin" ||
    normalized === "builtin_only" ||
    normalized === "mcp_only"
  ) {
    return normalized;
  }
  return undefined;
}

export function readKimiSearchRoutingPolicyFromProjectToml(
  projectTomlPath?: string,
): KimiSearchRoutingPolicy {
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

function resolveDefaultRuntimeHttpTimeoutMs(
  providerKind: "openai_compatible" | "kimi",
): number {
  if (providerKind === "kimi") {
    return DEFAULT_RUNTIME_HTTP_TIMEOUT_MS_KIMI;
  }
  return DEFAULT_RUNTIME_HTTP_TIMEOUT_MS_OPENAI_COMPATIBLE;
}

export function resolveRuntimeModelConfig(
  options: Record<string, OptionValue>,
  fallbackPool: RuntimeProviderPoolSnapshot | undefined,
): ResolvedRuntimeModelConfig {
  const baseUrlFromCli = readOptionString(options, "base-url");
  const apiKeyFromCli = readOptionString(options, "api-key");
  const modelFromCli = readOptionString(options, "model");
  const timeoutFromCli = readOptionString(options, "runtime-http-timeout-ms");

  const fallback = fallbackPool?.providers[0];
  const baseUrlFromEnv = process.env.GROBOT_BASE_URL;
  const apiKeyFromEnv = process.env.GROBOT_API_KEY;
  const modelFromEnv = process.env.GROBOT_MODEL;
  const timeoutFromEnv = process.env.GROBOT_RUNTIME_HTTP_TIMEOUT_MS;
  const providerMaxInFlightFromEnv =
    process.env.GROBOT_PROVIDER_MAX_INFLIGHT;
  const providerRequestsPerMinuteFromEnv =
    process.env.GROBOT_PROVIDER_REQUESTS_PER_MINUTE;
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
  const timeoutMs = parseExplicitPositiveIntOption({
    options,
    key: "runtime-http-timeout-ms",
    fallback: timeoutFromEnv,
  });
  const defaultTimeoutMs =
    resolveDefaultRuntimeHttpTimeoutMs(defaultProviderKind);
  const resolvedTimeoutMs = timeoutMs ?? defaultTimeoutMs;
  const providerMaxInFlightDefault = parseExplicitPositiveIntOption({
    options,
    key: "provider-max-inflight",
    fallback: providerMaxInFlightFromEnv,
  });
  const providerRequestsPerMinuteDefault = parseExplicitPositiveIntOption({
    options,
    key: "provider-requests-per-minute",
    fallback: providerRequestsPerMinuteFromEnv,
  });
  const providerBurstDefault = parseExplicitPositiveIntOption({
    options,
    key: "provider-burst",
    fallback: providerBurstFromEnv,
  });
  const circuitFailures = parseExplicitRequiredPositiveIntOption({
    options,
    key: "circuit-failures",
    fallbackValue: 2,
  });
  const circuitCooldownSecs = parseExplicitRequiredPositiveIntOption({
    options,
    key: "circuit-cooldown-secs",
    fallbackValue: 30,
  });

  const source = {
    baseUrl: baseUrlFromCli
      ? "cli:base-url"
      : baseUrlFromEnv
        ? "env:GROBOT_BASE_URL"
        : fallback?.baseUrl
          ? "config_toml:provider.base_url"
          : "unset",
    apiKey: apiKeyFromCli
      ? "cli:api-key"
      : apiKeyFromEnv
        ? "env:GROBOT_API_KEY"
        : fallback?.apiKey
          ? "config_toml:provider.api_key"
          : "unset",
    model: modelFromCli
      ? "cli:model"
      : modelFromEnv
        ? "env:GROBOT_MODEL"
        : fallback?.model
          ? "config_toml:provider.model"
          : "unset",
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
        officialToolsAllowlist: normalizeKimiAllowlist(
          fallback?.kimiOfficialToolsAllowlist,
        ),
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
  source.providerKind =
    defaultProviderKind === "kimi"
      ? "derived:kimi"
      : "derived:openai_compatible";

  const providerChain: RuntimeProviderCandidate[] = [];
  if (
    !hasDirectRuntimeOverride &&
    fallbackPool &&
    fallbackPool.providers.length > 0
  ) {
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
      const providerKind = normalizeProviderKind(
        provider.providerKind,
        provider.name,
        providerBaseUrl,
      );
      candidateModelConfig.providerKind = providerKind;
      candidateModelConfig.timeoutMs =
        typeof timeoutMs === "number"
          ? timeoutMs
          : resolveDefaultRuntimeHttpTimeoutMs(providerKind);
      if (providerKind === "kimi") {
        candidateModelConfig.providerOptions = {
          kimi: {
            webSearchMode: normalizeKimiWebSearchMode(provider.kimiWebSearchMode),
            disableThinkingOnBuiltinWebSearch:
              provider.kimiDisableThinkingOnBuiltinWebSearch ?? true,
            officialToolsAllowlist: normalizeKimiAllowlist(
              provider.kimiOfficialToolsAllowlist,
            ),
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
        priority:
          typeof provider.priority === "number" ? provider.priority : undefined,
        weight: typeof provider.weight === "number" ? provider.weight : undefined,
        unitCost:
          typeof provider.unitCost === "number" ? provider.unitCost : undefined,
        maxInFlight:
          normalizePositiveInt(provider.maxInFlight) ??
          providerMaxInFlightDefault,
        requestsPerMinute:
          normalizePositiveInt(provider.requestsPerMinute) ??
          providerRequestsPerMinuteDefault,
        burst:
          normalizePositiveInt(provider.burst) ??
          providerBurstDefault ??
          normalizePositiveInt(provider.requestsPerMinute) ??
          providerRequestsPerMinuteDefault,
      });
    }
  }
  if (providerChain.length === 0 && Object.keys(modelConfig).length > 0) {
    const directRequestsPerMinute = providerRequestsPerMinuteDefault;
    providerChain.push({
      name: hasDirectRuntimeOverride
        ? "direct-override"
        : fallback?.name?.trim() || "direct",
      modelConfig,
      source: hasDirectRuntimeOverride
        ? "direct-runtime-override"
        : fallbackPool?.source ?? "runtime-model",
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
