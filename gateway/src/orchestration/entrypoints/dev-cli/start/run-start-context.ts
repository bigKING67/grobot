import { readFileSync } from "node:fs";
import { resolveExecutionPlaneConfig } from "../../../execution-plane";
import { type KimiWebSearchMode, type RuntimeModelConfig, type RuntimeToolContext } from "../../../../models/types";
import { buildSessionKey } from "../../../../models/session-key";
import { hasFlag, OptionValue, readOptionString } from "../cli-args";
import { readProviderPoolFromToml } from "../provider-probe";
import {
  basenameFromPath,
  resolveConfigTomlPath,
  resolveHomeDir,
  resolveInterruptStorePath,
  resolveProjectRoot,
  resolveProjectTomlPath,
  resolveWorkDir,
} from "../services/runtime-paths";
import { resolveMcpInstructionRuntime } from "../services/mcp-instruction-pack";
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
  return {
    workDir,
    enabledTools: ["list", "glob", "search", "read", "write", "edit", "bash", "mcp_servers", "mcp_call"],
    bashAllowlist,
    maxToolRounds,
  };
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
  const historyTurns = resolveHistoryTurns(options);
  const handoffRecentTurns = resolveHandoffRecentTurns(options);
  const handoffAutoOnExit = resolveHandoffAutoOnExit(options);
  const handoffPath = buildHandoffPath(projectRoot);
  const interruptStorePath = resolveInterruptStorePath(homeDir);
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
  const sessionNamespaceKey = buildSessionKey(sessionNamespace);
  const sessionRegistryFilePathValue = sessionRegistryFilePath(homeDir, sessionNamespaceKey);
  const sessionStore = createRunStartSessionStore({
    options,
    projectTomlPath,
    homeDir,
    sessionNamespaceKey,
    historyTurns,
  });
  const kimiSearchRoutingPolicy = readKimiSearchRoutingPolicyFromProjectToml(projectTomlPath);
  const mcpInstructionRuntime = resolveMcpInstructionRuntime({
    homeDir,
    workDir,
    projectTomlPath,
  });

  return {
    homeDir,
    projectRoot,
    workDir,
    projectName,
    historyTurns,
    handoffRecentTurns,
    handoffAutoOnExit,
    handoffPath,
    interruptStorePath,
    subject,
    executionPlane,
    sessionNamespaceKey,
    sessionRegistryFilePathValue,
    sessionStore,
    runtimeModelConfig: runtimeModelConfig.modelConfig,
    runtimeProviderChain: runtimeModelConfig.providerChain,
    runtimeFailoverConfig: runtimeModelConfig.failoverConfig,
    runtimeModelConfigSource: runtimeModelConfig.modelConfigSource,
    runtimeToolContext: resolveRuntimeToolContext(workDir, projectTomlPath),
    kimiSearchRoutingPolicy,
    mcpInstructionPromptPrefix: mcpInstructionRuntime.promptPrefix,
    mcpInstructionServerNames: mcpInstructionRuntime.loadedServerNames,
    mcpInstructionEvents: mcpInstructionRuntime.events,
    mcpInstructionStrictFailure: mcpInstructionRuntime.strictFailure,
  };
}
