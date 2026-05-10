import { readFileSync } from "node:fs";
import {
  type KimiWebSearchMode,
  type RuntimeModelConfig,
  type RuntimePromptCacheCapability,
  type RuntimePromptCacheStrategy,
} from "../../../models/types";
import {
  readEnvOptionalNonEmptyString,
  readExplicitOptionalNonEmptyString,
  readOptionString,
  type OptionValue,
} from "../../cli-args";
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
import { resolveProviderCandidateControls } from "./runtime-provider-controls";

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
  configErrors?: RuntimeProviderConfigFieldError[];
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

interface RuntimeProviderConfigFieldError {
  field: string;
  detail: string;
}

interface RuntimeProviderConfigContext {
  providerName: string;
  source: string;
}

export class RuntimeModelConfigInputError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(field: string, detail: string) {
    super(detail);
    this.name = "RuntimeModelConfigInputError";
    this.code = `invalid_${field.replace(/-/g, "_")}`;
    this.field = field;
  }
}

export function isRuntimeModelConfigInputError(
  error: unknown,
): error is RuntimeModelConfigInputError {
  return error instanceof RuntimeModelConfigInputError;
}

function throwProviderConfigError(
  field: string,
  detail: string,
  context: RuntimeProviderConfigContext,
): never {
  throw new RuntimeModelConfigInputError(
    field,
    `${detail} (provider=${context.providerName} source=${context.source})`,
  );
}

function throwRuntimeModelConfigError(
  field: string,
  detail: string,
  source: string,
): never {
  throw new RuntimeModelConfigInputError(field, `${detail} (source=${source})`);
}

function assertProviderConfigParseErrors(input: {
  provider: RuntimeProviderPoolProvider | undefined;
  context: RuntimeProviderConfigContext;
}): void {
  const errors = input.provider?.configErrors ?? [];
  if (errors.length === 0) {
    return;
  }
  const first = errors[0];
  throwProviderConfigError(
    first?.field ?? "provider-config",
    first?.detail ?? "provider config is invalid",
    input.context,
  );
}

function normalizeProviderKind(
  rawKind: string | undefined,
  providerName?: string,
  baseUrl?: string,
  context?: RuntimeProviderConfigContext,
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
  if (normalizedKind !== undefined && normalizedKind.length > 0) {
    if (context) {
      throwProviderConfigError(
        "provider-kind",
        "provider-kind must be kimi, openai_compatible, or openai-compatible",
        context,
      );
    }
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

function normalizeKimiWebSearchMode(
  raw: string | undefined,
  context: RuntimeProviderConfigContext,
): KimiWebSearchMode {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === undefined || normalized.length === 0) {
    return "builtin_preferred";
  }
  if (
    normalized === "builtin_preferred" ||
    normalized === "builtin_only" ||
    normalized === "official_only" ||
    normalized === "off"
  ) {
    return normalized;
  }
  throwProviderConfigError(
    "kimi-web-search-mode",
    "kimi-web-search-mode must be builtin_preferred, builtin_only, official_only, or off",
    context,
  );
}

function normalizePositiveInt(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  if (!Number.isInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function normalizeKimiMaxTokens(
  raw: number | undefined,
  context: RuntimeProviderConfigContext,
): number {
  if (raw === undefined) {
    return DEFAULT_KIMI_MAX_TOKENS;
  }
  const normalized = normalizePositiveInt(raw);
  if (
    typeof normalized !== "number" ||
    normalized < 1_024 ||
    normalized > DEFAULT_KIMI_MAX_TOKENS
  ) {
    throwProviderConfigError(
      "kimi-max-tokens",
      `kimi-max-tokens must be an integer between 1024 and ${String(DEFAULT_KIMI_MAX_TOKENS)}`,
      context,
    );
  }
  return normalized;
}

function normalizeKimiTemperature(
  raw: number | undefined,
  context: RuntimeProviderConfigContext,
): number {
  if (raw === undefined) {
    return DEFAULT_KIMI_TEMPERATURE;
  }
  if (!Number.isFinite(raw) || raw < 0 || raw > 2) {
    throwProviderConfigError(
      "kimi-temperature",
      "kimi-temperature must be a number between 0 and 2",
      context,
    );
  }
  return raw;
}

function normalizeKimiTopP(
  raw: number | undefined,
  context: RuntimeProviderConfigContext,
): number {
  if (raw === undefined) {
    return DEFAULT_KIMI_TOP_P;
  }
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) {
    throwProviderConfigError(
      "kimi-top-p",
      "kimi-top-p must be a number between 0 and 1",
      context,
    );
  }
  return raw;
}

function normalizeKimiAllowlist(
  raw: string[] | undefined,
  context: RuntimeProviderConfigContext,
): string[] {
  if (raw === undefined) {
    return [...DEFAULT_KIMI_OFFICIAL_TOOLS_ALLOWLIST];
  }
  const values = raw.map((item) => item.trim());
  if (values.length === 0 || values.some((item) => item.length === 0)) {
    throwProviderConfigError(
      "kimi-official-tools-allowlist",
      "kimi-official-tools-allowlist must be a non-empty array of strings",
      context,
    );
  }
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throwProviderConfigError(
        "kimi-official-tools-allowlist",
        "kimi-official-tools-allowlist values must be unique",
        context,
      );
    }
    seen.add(value);
  }
  return values;
}

function normalizePromptCacheStrategy(
  raw: string | undefined,
  context: RuntimeProviderConfigContext,
): RuntimePromptCacheStrategy {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === undefined || normalized.length === 0) {
    return DEFAULT_PROMPT_CACHE_STRATEGY;
  }
  if (normalized === "user_last_n") {
    return "user_last_n";
  }
  throwProviderConfigError(
    "prompt-cache-strategy",
    "prompt-cache-strategy must be user_last_n",
    context,
  );
}

function normalizePromptCacheUserLastN(
  raw: number | undefined,
  context: RuntimeProviderConfigContext,
): number {
  if (raw === undefined) {
    return DEFAULT_PROMPT_CACHE_USER_LAST_N;
  }
  const normalized = normalizePositiveInt(raw);
  if (typeof normalized !== "number" || normalized < 1 || normalized > 12) {
    throwProviderConfigError(
      "prompt-cache-user-last-n",
      "prompt-cache-user-last-n must be an integer between 1 and 12",
      context,
    );
  }
  return normalized;
}

function normalizePromptCacheCapability(
  raw: string | undefined,
  context: RuntimeProviderConfigContext,
): RuntimePromptCacheCapability {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === undefined || normalized.length === 0) {
    return DEFAULT_PROMPT_CACHE_CAPABILITY;
  }
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
  throwProviderConfigError(
    "prompt-cache-capability",
    "prompt-cache-capability must be anthropic_compatible or unsupported",
    context,
  );
}

function resolvePromptCacheOptions(input: {
  enabled?: boolean;
  strategy?: string;
  userLastN?: number;
  capability?: string;
  context: RuntimeProviderConfigContext;
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
    strategy: normalizePromptCacheStrategy(input.strategy, input.context),
    userLastN: normalizePromptCacheUserLastN(input.userLastN, input.context),
    capability: normalizePromptCacheCapability(input.capability, input.context),
  };
}

function buildRuntimeKimiOptions(input: {
  provider: RuntimeProviderPoolProvider | undefined;
  context: RuntimeProviderConfigContext;
}): NonNullable<RuntimeModelConfig["providerOptions"]>["kimi"] {
  assertProviderConfigParseErrors(input);
  const provider = input.provider;
  return {
    webSearchMode: normalizeKimiWebSearchMode(
      provider?.kimiWebSearchMode,
      input.context,
    ),
    disableThinkingOnBuiltinWebSearch:
      provider?.kimiDisableThinkingOnBuiltinWebSearch ?? true,
    officialToolsAllowlist: normalizeKimiAllowlist(
      provider?.kimiOfficialToolsAllowlist,
      input.context,
    ),
    promptCache: resolvePromptCacheOptions({
      enabled: provider?.promptCacheEnabled,
      strategy: provider?.promptCacheStrategy,
      userLastN: provider?.promptCacheUserLastN,
      capability: provider?.promptCacheCapability,
      context: input.context,
    }),
    maxTokens: normalizeKimiMaxTokens(provider?.kimiMaxTokens, input.context),
    stream: provider?.kimiStream ?? DEFAULT_KIMI_STREAM,
    temperature: normalizeKimiTemperature(provider?.kimiTemperature, input.context),
    topP: normalizeKimiTopP(provider?.kimiTopP, input.context),
    filesEnabled: provider?.kimiFilesEnabled ?? true,
    allowFileAdmin: provider?.kimiAllowFileAdmin ?? false,
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

function readKimiSearchRoutingPolicy(raw: string): KimiSearchRoutingPolicy {
  const parsedValue = parseTomlString(raw);
  const policy = normalizeKimiSearchRoutingPolicy(parsedValue);
  if (policy) {
    return policy;
  }
  throwRuntimeModelConfigError(
    "search-routing-kimi",
    "search-routing-kimi must be mcp_first_fallback_builtin, builtin_only, or mcp_only",
    "project_toml",
  );
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
    return readKimiSearchRoutingPolicy(kvMatch[2]);
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
  const baseUrlFromCli = readExplicitOptionalNonEmptyString(options, "base-url");
  const apiKeyFromCli = readExplicitOptionalNonEmptyString(options, "api-key");
  const modelFromCli = readExplicitOptionalNonEmptyString(options, "model");
  const timeoutFromCli = readOptionString(options, "runtime-http-timeout-ms");

  const fallback = fallbackPool?.providers[0];
  const baseUrlFromEnv = readEnvOptionalNonEmptyString(process.env, "GROBOT_BASE_URL", "base-url");
  const apiKeyFromEnv = readEnvOptionalNonEmptyString(process.env, "GROBOT_API_KEY", "api-key");
  const modelFromEnv = readEnvOptionalNonEmptyString(process.env, "GROBOT_MODEL", "model");
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
  const defaultProviderConfigContext = {
    providerName: fallback?.name?.trim() || "direct",
    source: fallbackPool?.source ?? "runtime-model",
  };
  if (defaultProviderKind === "kimi") {
    modelConfig.providerOptions = {
      kimi: buildRuntimeKimiOptions({
        provider: fallback,
        context: defaultProviderConfigContext,
      }),
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
      const providerConfigContext = {
        providerName: provider.name.trim(),
        source: fallbackPool.source,
      };
      assertProviderConfigParseErrors({
        provider,
        context: providerConfigContext,
      });
      const providerKind = normalizeProviderKind(
        provider.providerKind,
        provider.name,
        providerBaseUrl,
        providerConfigContext,
      );
      candidateModelConfig.providerKind = providerKind;
      const providerControls = resolveProviderCandidateControls({
        provider,
        providerMaxInFlightDefault,
        providerRequestsPerMinuteDefault,
        providerBurstDefault,
        context: providerConfigContext,
        throwConfigError: throwProviderConfigError,
      });
      candidateModelConfig.timeoutMs =
        typeof timeoutMs === "number"
          ? timeoutMs
          : resolveDefaultRuntimeHttpTimeoutMs(providerKind);
      if (providerKind === "kimi") {
        candidateModelConfig.providerOptions = {
          kimi: buildRuntimeKimiOptions({
            provider,
            context: providerConfigContext,
          }),
        };
      }
      providerChain.push({
        name: provider.name.trim(),
        modelConfig: candidateModelConfig,
        source: fallbackPool.source,
        ...providerControls,
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
