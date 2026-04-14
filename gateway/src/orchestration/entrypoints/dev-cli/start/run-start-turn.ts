import { type ExecutionPlaneConfig } from "../../../execution-plane";
import { runGatewayTurn } from "../../../main";
import { type RuntimeModelConfig, type RuntimeToolContext } from "../../../../models/types";
import { consumeInterruptFlag } from "../services/interrupt-store";
import {
  buildPromptWithHistory,
  compactSingleLine,
  trimHistoryMessages,
  type ChatHistoryMessage,
} from "./session-history";
import { parseSessionKeyPartsLoose, type SessionProviderRuntimeState } from "./session-registry";
import { parsePlatform, parseScope } from "./session-options";

export interface RuntimeProviderCandidate {
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

export interface RuntimeFailoverConfig {
  circuitFailures: number;
  circuitCooldownSecs: number;
  stickyMode: "session_key";
}

export type KimiSearchRoutingPolicy =
  | "mcp_first_fallback_builtin"
  | "builtin_only"
  | "mcp_only";

interface CreateRunStartTurnRunnerInput {
  interruptStorePath: string;
  historyTurns: number;
  projectName: string;
  subject: string;
  executionPlane: ExecutionPlaneConfig;
  runtimeModelConfig?: RuntimeModelConfig;
  runtimeProviderChain: RuntimeProviderCandidate[];
  runtimeFailoverConfig: RuntimeFailoverConfig;
  runtimeModelConfigSource: {
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs: string;
    providerKind: string;
  };
  runtimeToolContext?: RuntimeToolContext;
  kimiSearchRoutingPolicy: KimiSearchRoutingPolicy;
  mcpInstructionPromptPrefix?: string;
  mcpInstructionServerNames: string[];
  getSessionKey(): string;
  getHistoryMessages(): ChatHistoryMessage[];
  setHistoryMessages(rows: ChatHistoryMessage[]): void;
  getStickyProvider(): string | undefined;
  setStickyProvider(value: string | undefined): void;
  getProviderRuntimeStates(): SessionProviderRuntimeState[];
  setProviderRuntimeStates(rows: SessionProviderRuntimeState[]): void;
  onHistoryCompacted(): void;
  onVerificationFailure(): void;
  touchActiveSession(userText: string): void;
  updateActiveSessionProviderRuntime(
    stickyProvider: string | undefined,
    providerRuntimeStates: readonly SessionProviderRuntimeState[],
  ): void;
  persistHistoryState(): Promise<void>;
  persistSessionRegistryState(): Promise<void>;
  writeStdout(message: string): void;
  writeStderr(message: string): void;
}

interface ProviderAttemptFailure {
  providerName: string;
  errorClass: string;
  errorMessage: string;
}

interface ProviderFlowState {
  inflight: number;
  tokenBucketRemaining?: number;
  tokenBucketUpdatedAtMs?: number;
}

const EWMA_ALPHA = 0.25;
const KIMI_SEARCH_TURN_TIMEOUT_MS = 120_000;
const PROVIDER_UPSTREAM_429_RETRY_LIMIT = 1;

function nowIso(): string {
  return new Date().toISOString();
}

function resolveErrorClass(message: string): string {
  const classMatch = message.match(/\bclass=([a-zA-Z0-9_]+)/);
  if (classMatch && typeof classMatch[1] === "string" && classMatch[1].length > 0) {
    return classMatch[1];
  }
  if (message.includes("timeout")) {
    return "upstream_timeout";
  }
  return "runtime_error";
}

function createDefaultProviderState(providerName: string): SessionProviderRuntimeState {
  return {
    provider_name: providerName,
    consecutive_failures: 0,
    circuit_open_until_ms: 0,
  };
}

function normalizeErrorRate(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function updateProviderEwmaState(input: {
  state: SessionProviderRuntimeState;
  latencyMs: number;
  isError: boolean;
}): void {
  const latencyMs = Number.isFinite(input.latencyMs) && input.latencyMs >= 0 ? input.latencyMs : 0;
  const previousLatency = input.state.ewma_latency_ms;
  input.state.ewma_latency_ms = typeof previousLatency === "number" && Number.isFinite(previousLatency)
    ? previousLatency * (1 - EWMA_ALPHA) + latencyMs * EWMA_ALPHA
    : latencyMs;
  const previousErrorRate = normalizeErrorRate(input.state.ewma_error_rate);
  const currentError = input.isError ? 1 : 0;
  input.state.ewma_error_rate = previousErrorRate * (1 - EWMA_ALPHA) + currentError * EWMA_ALPHA;
}

function normalizeProviderStateMap(
  providerNames: readonly string[],
  existingStates: readonly SessionProviderRuntimeState[],
): Map<string, SessionProviderRuntimeState> {
  const stateMap = new Map<string, SessionProviderRuntimeState>();
  for (const state of existingStates) {
    if (!state.provider_name || state.provider_name.trim().length === 0) {
      continue;
    }
    stateMap.set(state.provider_name, { ...state });
  }
  for (const providerName of providerNames) {
    if (!stateMap.has(providerName)) {
      stateMap.set(providerName, createDefaultProviderState(providerName));
    }
  }
  return stateMap;
}

function hashText(raw: string): number {
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function resolveCandidateScore(input: {
  provider: RuntimeProviderCandidate;
  providerState: SessionProviderRuntimeState | undefined;
  fallbackPriority: number;
  sessionKey: string;
}): number {
  const priority = typeof input.provider.priority === "number"
    ? input.provider.priority
    : input.fallbackPriority;
  const failurePenalty = (input.providerState?.consecutive_failures ?? 0) * 100;
  const costPenalty = typeof input.provider.unitCost === "number"
    ? input.provider.unitCost * 10
    : 0;
  const latencyPenalty = typeof input.providerState?.ewma_latency_ms === "number"
    ? Math.min(input.providerState.ewma_latency_ms, 10_000) / 40
    : 0;
  const errorPenalty = normalizeErrorRate(input.providerState?.ewma_error_rate) * 600;
  const weightBonus = typeof input.provider.weight === "number" && input.provider.weight > 0
    ? -Math.log10(1 + input.provider.weight) * 20
    : 0;
  const jitter = (hashText(`${input.sessionKey}:${input.provider.name}`) % 100) / 1000;
  return priority * 1000 + failurePenalty + costPenalty + latencyPenalty + errorPenalty + weightBonus + jitter;
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

function resolveProviderBurst(provider: RuntimeProviderCandidate): number | undefined {
  const rpm = normalizePositiveInt(provider.requestsPerMinute);
  if (!rpm) {
    return undefined;
  }
  return normalizePositiveInt(provider.burst) ?? rpm;
}

function getOrCreateProviderFlowState(
  stateMap: Map<string, ProviderFlowState>,
  providerName: string,
): ProviderFlowState {
  const found = stateMap.get(providerName);
  if (found) {
    return found;
  }
  const created: ProviderFlowState = {
    inflight: 0,
  };
  stateMap.set(providerName, created);
  return created;
}

function refillTokenBucket(
  state: ProviderFlowState,
  provider: RuntimeProviderCandidate,
  nowMs: number,
): void {
  const rpm = normalizePositiveInt(provider.requestsPerMinute);
  const burst = resolveProviderBurst(provider);
  if (!rpm || !burst) {
    return;
  }
  const previousTokens =
    typeof state.tokenBucketRemaining === "number" && Number.isFinite(state.tokenBucketRemaining)
      ? state.tokenBucketRemaining
      : burst;
  const previousUpdatedAt =
    typeof state.tokenBucketUpdatedAtMs === "number" && Number.isFinite(state.tokenBucketUpdatedAtMs)
      ? state.tokenBucketUpdatedAtMs
      : nowMs;
  const elapsedMs = Math.max(0, nowMs - previousUpdatedAt);
  const refill = (elapsedMs / 60_000) * rpm;
  state.tokenBucketRemaining = Math.min(burst, previousTokens + refill);
  state.tokenBucketUpdatedAtMs = nowMs;
}

function tryAcquireProviderCapacity(input: {
  provider: RuntimeProviderCandidate;
  stateMap: Map<string, ProviderFlowState>;
  nowMs: number;
}): {
  ok: true;
} | {
  ok: false;
  errorClass: string;
  errorMessage: string;
} {
  const state = getOrCreateProviderFlowState(input.stateMap, input.provider.name);
  const maxInFlight = normalizePositiveInt(input.provider.maxInFlight);
  if (maxInFlight && state.inflight >= maxInFlight) {
    return {
      ok: false,
      errorClass: "provider_inflight_limited",
      errorMessage: `provider inflight limit reached (${String(state.inflight)}/${String(maxInFlight)})`,
    };
  }
  const rpm = normalizePositiveInt(input.provider.requestsPerMinute);
  const burst = resolveProviderBurst(input.provider);
  if (rpm && burst) {
    refillTokenBucket(state, input.provider, input.nowMs);
    const remaining = typeof state.tokenBucketRemaining === "number" ? state.tokenBucketRemaining : burst;
    if (remaining < 1) {
      const deficit = Math.max(0, 1 - remaining);
      const retryAfterMs = Math.ceil((deficit / rpm) * 60_000);
      return {
        ok: false,
        errorClass: "provider_rate_limited",
        errorMessage: `provider bucket exhausted (rpm=${String(rpm)} burst=${String(burst)} retry_after_ms=${String(retryAfterMs)})`,
      };
    }
    state.tokenBucketRemaining = Math.max(0, remaining - 1);
    state.tokenBucketUpdatedAtMs = input.nowMs;
  }
  state.inflight += 1;
  return { ok: true };
}

function releaseProviderCapacity(
  stateMap: Map<string, ProviderFlowState>,
  providerName: string,
): void {
  const state = stateMap.get(providerName);
  if (!state) {
    return;
  }
  state.inflight = Math.max(0, state.inflight - 1);
}

function resolvePrimaryProviderKind(input: CreateRunStartTurnRunnerInput): string {
  const directKind = input.runtimeModelConfig?.providerKind;
  if (typeof directKind === "string" && directKind.trim().length > 0) {
    return directKind.trim().toLowerCase();
  }
  for (const provider of input.runtimeProviderChain) {
    const providerKind = provider.modelConfig.providerKind;
    if (typeof providerKind === "string" && providerKind.trim().length > 0) {
      return providerKind.trim().toLowerCase();
    }
  }
  return "openai_compatible";
}

function hasExplicitMcpIntent(userText: string): boolean {
  const normalized = userText.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  if (/(^|[\s/])(mcp|mcp_call|\/mcp)([\s:.,;]|$)/i.test(normalized)) {
    return true;
  }
  if (normalized.includes("grok-search") || normalized.includes("grok_search")) {
    return true;
  }
  if (normalized.includes("联网mcp") || normalized.includes("mcp联网")) {
    return true;
  }
  return false;
}

function hasSearchIntent(userText: string): boolean {
  const normalized = userText.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  const patterns = [
    "联网",
    "搜索",
    "检索",
    "最新",
    "新闻",
    "来源",
    "链接",
    "source",
    "search",
    "latest",
    "today",
    "news",
    "citation",
  ];
  return patterns.some((pattern) => normalized.includes(pattern));
}

function hasGrokSearchServer(serverNames: readonly string[]): boolean {
  return serverNames.some((name) => name.trim().toLowerCase() === "grok-search");
}

function shouldUseKimiMcpFirstRoute(input: {
  policy: KimiSearchRoutingPolicy;
  providerKind: string;
  userText: string;
  mcpServerNames: readonly string[];
}): boolean {
  if (input.policy === "builtin_only") {
    return false;
  }
  if (input.providerKind !== "kimi") {
    return false;
  }
  if (!hasSearchIntent(input.userText)) {
    return false;
  }
  return hasGrokSearchServer(input.mcpServerNames);
}

function buildKimiSearchRoutingPrefix(input: {
  policy: KimiSearchRoutingPolicy;
  providerKind: string;
  userText: string;
  mcpServerNames: readonly string[];
}): string {
  if (input.providerKind !== "kimi") {
    return "";
  }
  if (!hasSearchIntent(input.userText)) {
    return "";
  }
  if (input.policy === "builtin_only") {
    return [
      "[Kimi Search Routing]",
      "Use Kimi built-in $web_search directly for web lookup.",
      "Do not call MCP tools in this turn.",
    ].join("\n");
  }
  if (!hasGrokSearchServer(input.mcpServerNames)) {
    return [
      "[Kimi Search Routing]",
      "grok-search MCP is currently unavailable in this session.",
      input.policy === "mcp_only"
        ? "Return an explicit tool_unavailable note without using built-in web search."
        : "For web lookup requests, use Kimi built-in $web_search directly.",
    ].join("\n");
  }
  if (input.policy === "mcp_only") {
    return [
      "[Kimi Search Routing]",
      "When web lookup is needed, only use local MCP tool via mcp_call(server=\"grok-search\", tool=\"web_search\").",
      "Do not fallback to Kimi built-in $web_search in this turn.",
      "If MCP call fails or returns empty content, return an explicit tool_unavailable note.",
    ].join("\n");
  }
  return [
    "[Kimi Search Routing]",
    "When web lookup is needed, execute search in this order:",
    "1) First use local MCP tool via mcp_call(server=\"grok-search\", tool=\"web_search\").",
    "2) If MCP call fails, times out, returns tool_unavailable, or returns empty content, fallback to Kimi built-in $web_search.",
    "3) After successful search, answer with concise facts and include source URLs.",
  ].join("\n");
}

function buildKimiBuiltinFallbackPrompt(basePrompt: string): string {
  const fallbackPrefix = [
    "[Kimi Search Fallback]",
    "This retry is fallback mode.",
    "Do not call MCP tools in this turn.",
    "Use Kimi built-in $web_search directly and return concise facts with source URLs.",
  ].join("\n");
  return `${fallbackPrefix}\n\n${basePrompt}`;
}

function isKimiModelConfig(modelConfig: RuntimeModelConfig): boolean {
  const providerKind = modelConfig.providerKind?.trim().toLowerCase() ?? "";
  if (providerKind === "kimi") {
    return true;
  }
  const baseUrl = modelConfig.baseUrl?.trim().toLowerCase() ?? "";
  if (baseUrl.includes("moonshot.cn")) {
    return true;
  }
  const model = modelConfig.model?.trim().toLowerCase() ?? "";
  return model.startsWith("kimi") || model.startsWith("moonshot");
}

function resolveTurnModelConfig(
  modelConfig: RuntimeModelConfig,
  userText: string,
): {
  modelConfig: RuntimeModelConfig;
  timeoutBoosted: boolean;
} {
  if (!isKimiModelConfig(modelConfig) || !hasSearchIntent(userText)) {
    return {
      modelConfig,
      timeoutBoosted: false,
    };
  }
  const currentTimeout = normalizePositiveInt(modelConfig.timeoutMs);
  const targetTimeout = Math.max(currentTimeout ?? 0, KIMI_SEARCH_TURN_TIMEOUT_MS);
  if (currentTimeout === targetTimeout) {
    return {
      modelConfig,
      timeoutBoosted: false,
    };
  }
  return {
    modelConfig: {
      ...modelConfig,
      timeoutMs: targetTimeout,
    },
    timeoutBoosted: true,
  };
}

function shouldInjectMcpInstructionPrefix(
  input: CreateRunStartTurnRunnerInput,
  userText: string,
): {
  inject: boolean;
  reason: string;
} {
  const providerKind = resolvePrimaryProviderKind(input);
  if (providerKind === "kimi") {
    return {
      inject: false,
      reason: hasExplicitMcpIntent(userText) ? "kimi_skip_mcp_pack_explicit" : "kimi_skip_mcp_pack_default",
    };
  }
  return {
    inject: true,
    reason: "provider_non_kimi",
  };
}

function shouldRetryProviderRequest(
  errorClass: string,
  errorMessage: string,
  retryCount: number,
): boolean {
  if (retryCount >= PROVIDER_UPSTREAM_429_RETRY_LIMIT) {
    return false;
  }
  if (errorClass !== "upstream_http_error") {
    return false;
  }
  return errorMessage.includes("status=429");
}

function shouldRetryWithKimiBuiltinFallback(input: {
  provider: RuntimeProviderCandidate;
  retryCount: number;
  mcpFirstRouteEnabled: boolean;
  policy: KimiSearchRoutingPolicy;
}): boolean {
  if (input.policy !== "mcp_first_fallback_builtin") {
    return false;
  }
  if (!input.mcpFirstRouteEnabled) {
    return false;
  }
  if (input.retryCount >= 1) {
    return false;
  }
  if (!isKimiModelConfig(input.provider.modelConfig)) {
    return false;
  }
  return true;
}

function sleepAsync(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function resolveProviderOrder(input: {
  providers: readonly RuntimeProviderCandidate[];
  stickyProvider: string | undefined;
  sessionKey: string;
  stateMap: Map<string, SessionProviderRuntimeState>;
}): RuntimeProviderCandidate[] {
  const ordered: RuntimeProviderCandidate[] = [];
  const openProviders: RuntimeProviderCandidate[] = [];
  const nowMs = Date.now();
  const pushOpenProvider = (provider: RuntimeProviderCandidate): void => {
    if (openProviders.some((item) => item.name === provider.name)) {
      return;
    }
    openProviders.push(provider);
  };
  if (input.stickyProvider) {
    const sticky = input.providers.find((item) => item.name === input.stickyProvider);
    if (sticky) {
      const stickyState = input.stateMap.get(sticky.name);
      if (!stickyState || stickyState.circuit_open_until_ms <= nowMs) {
        ordered.push(sticky);
      } else {
        pushOpenProvider(sticky);
      }
    }
  }
  for (const provider of input.providers) {
    if (ordered.some((item) => item.name === provider.name)) {
      continue;
    }
    const state = input.stateMap.get(provider.name);
    if (state && state.circuit_open_until_ms > nowMs) {
      pushOpenProvider(provider);
      continue;
    }
    ordered.push(provider);
  }
  if (ordered.length === 0 && openProviders.length > 0) {
    const probe = openProviders
      .map((provider, index) => ({
        provider,
        reopenAt: input.stateMap.get(provider.name)?.circuit_open_until_ms ?? 0,
        score: resolveCandidateScore({
          provider,
          providerState: input.stateMap.get(provider.name),
          fallbackPriority: index + 1,
          sessionKey: input.sessionKey,
        }),
      }))
      .sort((left, right) => {
        if (left.reopenAt !== right.reopenAt) {
          return left.reopenAt - right.reopenAt;
        }
        return left.score - right.score;
      })[0]?.provider;
    if (probe) {
      ordered.push(probe);
    }
  }
  if (ordered.length <= 1) {
    return ordered;
  }
  const stickyName = input.stickyProvider;
  const head = stickyName ? ordered.filter((item) => item.name === stickyName) : [];
  const tail = ordered
    .filter((item) => item.name !== stickyName)
    .map((provider, index) => ({
      provider,
      score: resolveCandidateScore({
        provider,
        providerState: input.stateMap.get(provider.name),
        fallbackPriority: index + 1,
        sessionKey: input.sessionKey,
      }),
    }))
    .sort((left, right) => left.score - right.score)
    .map((item) => item.provider);
  return [...head, ...tail];
}

export function createRunStartTurnRunner(input: CreateRunStartTurnRunnerInput) {
  const providerFlowStateMap = new Map<string, ProviderFlowState>();

  const recordTurn = async (
    userText: string,
    assistantText: string,
    stickyProvider: string | undefined,
    providerRuntimeStates: readonly SessionProviderRuntimeState[],
  ): Promise<void> => {
    const historyMessages = input.getHistoryMessages();
    const nextHistory = [
      ...historyMessages,
      { role: "user", content: userText } as ChatHistoryMessage,
      { role: "assistant", content: assistantText } as ChatHistoryMessage,
    ];
    const trimmed = trimHistoryMessages(nextHistory, input.historyTurns);
    if (trimmed.length < nextHistory.length) {
      input.onHistoryCompacted();
    }
    input.setHistoryMessages(trimmed);
    await input.persistHistoryState();
    input.updateActiveSessionProviderRuntime(stickyProvider, providerRuntimeStates);
    input.touchActiveSession(userText);
    await input.persistSessionRegistryState();
  };

  return async (userText: string, interactiveMode: boolean): Promise<number> => {
    const sessionKey = input.getSessionKey();
    if (consumeInterruptFlag(input.interruptStorePath, sessionKey)) {
      if (interactiveMode) {
        input.writeStdout("Session interrupted by management API. Current input skipped.\n\n");
      } else {
        input.writeStdout("Session interrupted by management API. Current request skipped.\n");
      }
    return 0;
  }

    const historyMessages = input.getHistoryMessages();
    const basePrompt = buildPromptWithHistory(userText, historyMessages, Math.min(input.historyTurns, 6));
    const mcpInstructionPrefix = input.mcpInstructionPromptPrefix?.trim() ?? "";
    const mcpInstructionDecision = shouldInjectMcpInstructionPrefix(input, userText);
    const providerKind = resolvePrimaryProviderKind(input);
    const kimiMcpFirstRouteEnabled = shouldUseKimiMcpFirstRoute({
      policy: input.kimiSearchRoutingPolicy,
      providerKind,
      userText,
      mcpServerNames: input.mcpInstructionServerNames,
    });
    const kimiSearchRoutingPrefix = buildKimiSearchRoutingPrefix({
      policy: input.kimiSearchRoutingPolicy,
      providerKind,
      userText,
      mcpServerNames: input.mcpInstructionServerNames,
    });
    const kimiBuiltinFallbackPrompt = kimiMcpFirstRouteEnabled
      ? buildKimiBuiltinFallbackPrompt(basePrompt)
      : basePrompt;
    const promptParts: string[] = [];
    if (mcpInstructionPrefix.length > 0 && mcpInstructionDecision.inject) {
      promptParts.push(mcpInstructionPrefix);
    }
    if (kimiSearchRoutingPrefix.length > 0) {
      promptParts.push(kimiSearchRoutingPrefix);
    }
    promptParts.push(basePrompt);
    const prompt = promptParts.join("\n\n");
    if (kimiSearchRoutingPrefix.length > 0) {
      input.writeStderr(
        `[governance:search-route] event=policy_injected provider=${providerKind} policy=${input.kimiSearchRoutingPolicy} has_grok_search=${hasGrokSearchServer(input.mcpInstructionServerNames) ? "true" : "false"} chars=${String(kimiSearchRoutingPrefix.length)}\n`,
      );
    }
    if (mcpInstructionPrefix.length > 0) {
      const serversSummary = input.mcpInstructionServerNames.length > 0
        ? input.mcpInstructionServerNames.join(",")
        : "<none>";
      if (mcpInstructionDecision.inject) {
        input.writeStderr(
          `[governance:mcp-instruction] event=prompt_injected servers=${serversSummary} chars=${String(mcpInstructionPrefix.length)} reason=${mcpInstructionDecision.reason}\n`,
        );
      } else {
        input.writeStderr(
          `[governance:mcp-instruction] event=prompt_skipped servers=${serversSummary} reason=${mcpInstructionDecision.reason}\n`,
        );
      }
    }
    const parsedSession = parseSessionKeyPartsLoose(sessionKey);
    if (!parsedSession) {
      input.writeStderr(`error: invalid active session key: ${sessionKey}\n`);
      return 1;
    }

    const providers = input.runtimeProviderChain.length > 0
      ? input.runtimeProviderChain
      : [{
        name: "default",
        modelConfig: input.runtimeModelConfig ?? {},
        source: "runtime-model",
        priority: 1,
        weight: 1,
      }];
    const providerNames = providers.map((item) => item.name);
    const providerStateMap = normalizeProviderStateMap(providerNames, input.getProviderRuntimeStates());
    const currentStickyProvider = input.runtimeFailoverConfig.stickyMode === "session_key"
      ? input.getStickyProvider()
      : undefined;
    const orderedProviders = resolveProviderOrder({
      providers,
      stickyProvider: currentStickyProvider,
      sessionKey,
      stateMap: providerStateMap,
    });
    if (orderedProviders.length === 0) {
      input.writeStderr("[runtime-route] all provider circuits are OPEN; no attempt executed\n");
      return 1;
    }

      const failures: ProviderAttemptFailure[] = [];
        for (const provider of orderedProviders) {
          const startedAtMs = Date.now();
          const turnModelConfig = resolveTurnModelConfig(provider.modelConfig, userText);
          if (turnModelConfig.timeoutBoosted) {
            input.writeStderr(
              `[runtime-model] timeout_boost provider=${provider.name} reason=search_intent timeout_ms=${String(turnModelConfig.modelConfig.timeoutMs)}\n`,
            );
          }
          const capacity = tryAcquireProviderCapacity({
            provider,
            stateMap: providerFlowStateMap,
          nowMs: startedAtMs,
        });
        if (!capacity.ok) {
          failures.push({
            providerName: provider.name,
            errorClass: capacity.errorClass,
            errorMessage: capacity.errorMessage,
          });
          continue;
        }
          try {
              let providerRetryCount = 0;
              let kimiBuiltinFallbackRetryCount = 0;
              let turnPrompt = prompt;
              let report;
              while (true) {
                try {
                  report = await runGatewayTurn(
                    turnPrompt,
                    {
                      platform: parsePlatform(parsedSession[0]),
                      tenant: parsedSession[1],
                    scope: parseScope(parsedSession[2]),
                    subject: parsedSession[3],
                  },
                  {
                    actorId: process.env.USER ?? input.subject,
                    projectId: input.projectName,
                  },
                  {
                    gatewayImpl: input.executionPlane.gatewayImpl,
                    runtimeImpl: input.executionPlane.runtimeImpl,
                    shadowMode: input.executionPlane.shadowMode,
                  },
                  {
                    modelConfig: turnModelConfig.modelConfig,
                    toolContext: input.runtimeToolContext,
                  },
                );
                break;
                } catch (error) {
                  const retryMessage = String(error);
                  const retryErrorClass = resolveErrorClass(retryMessage);
                  if (shouldRetryWithKimiBuiltinFallback({
                    provider,
                    retryCount: kimiBuiltinFallbackRetryCount,
                    mcpFirstRouteEnabled: kimiMcpFirstRouteEnabled,
                    policy: input.kimiSearchRoutingPolicy,
                  })) {
                    kimiBuiltinFallbackRetryCount += 1;
                    turnPrompt = kimiBuiltinFallbackPrompt;
                    input.writeStderr(
                      `[runtime-route] provider_retry provider=${provider.name} reason=kimi_mcp_unavailable fallback=builtin_web_search retry=${String(kimiBuiltinFallbackRetryCount)}\n`,
                    );
                    continue;
                  }
                  if (!shouldRetryProviderRequest(retryErrorClass, retryMessage, providerRetryCount)) {
                    throw error;
                  }
                providerRetryCount += 1;
                const backoffMs = providerRetryCount * 1_500;
                input.writeStderr(
                  `[runtime-route] provider_retry provider=${provider.name} reason=upstream_429 retry=${String(providerRetryCount)} backoff_ms=${String(backoffMs)}\n`,
                );
                await sleepAsync(backoffMs);
              }
            }
            if (!report) {
              throw new Error("provider response missing after retry");
            }
            const state = providerStateMap.get(provider.name) ?? createDefaultProviderState(provider.name);
            updateProviderEwmaState({
              state,
            latencyMs: Date.now() - startedAtMs,
            isError: false,
          });
          state.consecutive_failures = 0;
          state.circuit_open_until_ms = 0;
          state.last_error_class = undefined;
          state.last_error_message = undefined;
          state.last_failed_at = undefined;
        state.last_succeeded_at = nowIso();
        providerStateMap.set(provider.name, state);
        const stickyProvider = input.runtimeFailoverConfig.stickyMode === "session_key"
          ? provider.name
          : undefined;
        input.setStickyProvider(stickyProvider);
        const providerStates = Array.from(providerStateMap.values());
        input.setProviderRuntimeStates(providerStates);

        await recordTurn(userText, report.assistantMessage, stickyProvider, providerStates);
        input.writeStdout(`${report.assistantMessage}\n`);
        if (interactiveMode) {
          input.writeStdout("\n");
        }
        input.writeStderr(
          `[execution] gateway=${input.executionPlane.gatewayImpl}(${input.executionPlane.gatewayImplSource}) runtime=${input.executionPlane.runtimeImpl}(${input.executionPlane.runtimeImplSource}) shadow=${input.executionPlane.shadowMode ? "on" : "off"}(${input.executionPlane.shadowModeSource})\n`,
        );
        input.writeStderr(
          `[runtime-model] base_url=${input.runtimeModelConfigSource.baseUrl} model=${input.runtimeModelConfigSource.model} provider_kind=${input.runtimeModelConfigSource.providerKind} api_key=${input.runtimeModelConfigSource.apiKey} timeout_ms=${input.runtimeModelConfigSource.timeoutMs}\n`,
        );
        input.writeStderr(
          `[runtime-route] provider=${provider.name} attempts=${String(failures.length + 1)} failovers=${String(failures.length)} sticky=${stickyProvider ?? "<none>"} strategy=sticky+score\n`,
        );
        input.writeStderr(
          `[governance] plane=${report.governance.plane} decision=${report.governance.decision} score=${report.governance.score.toFixed(4)} gate=${report.governance.gatePassed ? "pass" : "fail"} action=${report.governance.suggestedAction}\n`,
        );
          if (!report.verification.pass) {
            input.onVerificationFailure();
          }
          return report.verification.pass ? 0 : 1;
        } catch (error) {
        const rawMessage = String(error);
        const compactMessage = compactSingleLine(rawMessage, 240);
        const errorClass = resolveErrorClass(rawMessage);
          failures.push({
            providerName: provider.name,
            errorClass,
            errorMessage: compactMessage,
          });
          const state = providerStateMap.get(provider.name) ?? createDefaultProviderState(provider.name);
          updateProviderEwmaState({
            state,
            latencyMs: Date.now() - startedAtMs,
            isError: true,
          });
          state.consecutive_failures += 1;
          state.last_error_class = errorClass;
          state.last_error_message = compactMessage;
          state.last_failed_at = nowIso();
          if (state.consecutive_failures >= input.runtimeFailoverConfig.circuitFailures) {
            state.circuit_open_until_ms = Date.now() + input.runtimeFailoverConfig.circuitCooldownSecs * 1_000;
          }
          providerStateMap.set(provider.name, state);
        } finally {
          releaseProviderCapacity(providerFlowStateMap, provider.name);
        }
      }

    const providerStates = Array.from(providerStateMap.values());
    input.setProviderRuntimeStates(providerStates);
    input.updateActiveSessionProviderRuntime(input.getStickyProvider(), providerStates);
    await input.persistSessionRegistryState();
    const failureSummary = failures
      .map((item) => `${item.providerName}:${item.errorClass}`)
      .join(", ");
    const attemptedProviders = orderedProviders.map((item) => item.name).join(" -> ");
    input.writeStderr(
      `[runtime-route] failed attempts=${String(failures.length)} providers=${attemptedProviders || "<none>"} errors=${failureSummary || "<none>"}\n`,
    );
    if (failures.length > 0) {
      const last = failures[failures.length - 1];
      input.writeStderr(`runtime failed: provider=${last.providerName} ${last.errorMessage}\n`);
    }
    return 1;
  };
}
