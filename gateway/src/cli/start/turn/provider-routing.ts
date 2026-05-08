import { type RuntimeModelConfig } from "../../../models/types";
import { type SessionProviderRuntimeState } from "../session-registry";
import {
  type CreateRunStartTurnRunnerInput,
  type KimiSearchRoutingPolicy,
  type RuntimeProviderCandidate,
} from "./contract";

const EWMA_ALPHA = 0.25;
const KIMI_SEARCH_TURN_TIMEOUT_MS = 120_000;
const PROVIDER_UPSTREAM_429_RETRY_LIMIT = 1;
const PROVIDER_UPSTREAM_TRANSIENT_HTTP_RETRY_LIMIT = 1;
const PROVIDER_UPSTREAM_READ_RETRY_LIMIT = 1;
const PROVIDER_UPSTREAM_CONNECT_RETRY_LIMIT = 1;
const PROVIDER_UPSTREAM_TIMEOUT_RETRY_LIMIT = 1;

export interface ProviderRetryRequest {
  errorClass: string;
  errorMessage: string;
  retryCount: number;
  errorData?: Record<string, unknown> | undefined;
}

export interface ProviderAttemptFailure {
  providerName: string;
  errorClass: string;
  errorMessage: string;
}

export interface ProviderFlowState {
  inflight: number;
  tokenBucketRemaining?: number;
  tokenBucketUpdatedAtMs?: number;
}

export interface RouteDecisionTrace {
  stickyProvider: string | undefined;
  stickyHit: boolean;
  stickyReason: "none" | "applied" | "not_found" | "circuit_open";
  scoreOrder: Array<{
    name: string;
    score: number;
  }>;
  circuitSkipped: Array<{
    name: string;
    reopenAtMs: number;
  }>;
  probeProvider?: string;
}

export function createDefaultProviderState(providerName: string): SessionProviderRuntimeState {
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

export function updateProviderEwmaState(input: {
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

export function normalizeProviderStateMap(
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

function recordBooleanField(
  value: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const raw = value?.[key];
  return typeof raw === "boolean" ? raw : undefined;
}

function recordFiniteNumberField(
  value: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const raw = value?.[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return undefined;
  }
  return raw;
}

function hasAttemptsExhausted(errorData: Record<string, unknown> | undefined): boolean {
  const attempt = recordFiniteNumberField(errorData, "attempt");
  const maxAttempts = recordFiniteNumberField(errorData, "max_attempts");
  if (typeof attempt !== "number" || typeof maxAttempts !== "number") {
    return false;
  }
  return maxAttempts > 0 && attempt >= maxAttempts;
}

function isTransientProviderHttpStatus(status: number | undefined): boolean {
  if (typeof status !== "number") {
    return false;
  }
  const normalized = Math.trunc(status);
  return normalized === 408
    || normalized === 425
    || normalized === 429
    || normalized === 500
    || normalized === 502
    || normalized === 503
    || normalized === 504;
}

function normalizeProviderRetryRequest(
  inputOrErrorClass: string | ProviderRetryRequest,
  errorMessage?: string,
  retryCount?: number,
): ProviderRetryRequest {
  if (typeof inputOrErrorClass !== "string") {
    return inputOrErrorClass;
  }
  return {
    errorClass: inputOrErrorClass,
    errorMessage: errorMessage ?? "",
    retryCount: typeof retryCount === "number" && Number.isFinite(retryCount)
      ? retryCount
      : 0,
  };
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

export function tryAcquireProviderCapacity(input: {
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

export function releaseProviderCapacity(
  stateMap: Map<string, ProviderFlowState>,
  providerName: string,
): void {
  const state = stateMap.get(providerName);
  if (!state) {
    return;
  }
  state.inflight = Math.max(0, state.inflight - 1);
}

export function resolvePrimaryProviderKind(input: CreateRunStartTurnRunnerInput): string {
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
  const keywordPatterns = [
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
  if (keywordPatterns.some((pattern) => normalized.includes(pattern))) {
    return true;
  }
  if (/(搜|查|找)(一下|下|一搜|一查|一找)?/.test(normalized)) {
    return true;
  }
  const weatherTopicMatched = /(天气|气温|温度|风力|降雨|降水|空气质量|aqi|weather|forecast)/.test(normalized);
  const timeAnchorMatched = /(今天|明天|后天|本周|下周|today|tomorrow|this week|next week)/.test(normalized);
  if (weatherTopicMatched && timeAnchorMatched) {
    return true;
  }
  return false;
}

export function hasGrokSearchServer(serverNames: readonly string[]): boolean {
  return serverNames.some((name) => name.trim().toLowerCase() === "grok-search");
}

export function shouldUseKimiMcpFirstRoute(input: {
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

export function buildKimiSearchRoutingPrefix(input: {
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

export function buildKimiBuiltinFallbackPrompt(basePrompt: string): string {
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

export function resolveTurnModelConfig(
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

export function shouldInjectMcpInstructionPrefix(
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

export function shouldRetryProviderRequest(
  errorClass: string,
  errorMessage: string,
  retryCount: number,
): boolean;
export function shouldRetryProviderRequest(input: ProviderRetryRequest): boolean;
export function shouldRetryProviderRequest(
  inputOrErrorClass: string | ProviderRetryRequest,
  errorMessage?: string,
  retryCount?: number,
): boolean {
  const input = normalizeProviderRetryRequest(
    inputOrErrorClass,
    errorMessage,
    retryCount,
  );
  const retryable = recordBooleanField(input.errorData, "retryable");
  if (retryable === false || hasAttemptsExhausted(input.errorData)) {
    return false;
  }
  const httpStatus = recordFiniteNumberField(input.errorData, "http_status");
  const allowStructuredRetry = retryable === true;

  if (input.errorClass === "upstream_http_error") {
    if (httpStatus === 429) {
      return input.retryCount < PROVIDER_UPSTREAM_429_RETRY_LIMIT;
    }
    if (allowStructuredRetry && isTransientProviderHttpStatus(httpStatus)) {
      return input.retryCount < PROVIDER_UPSTREAM_TRANSIENT_HTTP_RETRY_LIMIT;
    }
    if (input.retryCount >= PROVIDER_UPSTREAM_429_RETRY_LIMIT) {
      return false;
    }
    return input.errorMessage.includes("status=429");
  }
  if (input.errorClass === "upstream_response_read_failed") {
    return input.retryCount < PROVIDER_UPSTREAM_READ_RETRY_LIMIT;
  }
  if (input.errorClass === "upstream_connect_failed") {
    return allowStructuredRetry && input.retryCount < PROVIDER_UPSTREAM_CONNECT_RETRY_LIMIT;
  }
  if (input.errorClass === "upstream_timeout") {
    return allowStructuredRetry && input.retryCount < PROVIDER_UPSTREAM_TIMEOUT_RETRY_LIMIT;
  }
  return false;
}

export function resolveProviderRetryReason(input: {
  errorClass: string;
  errorMessage: string;
  errorData?: Record<string, unknown> | undefined;
}): string {
  if (input.errorClass === "upstream_http_error") {
    const httpStatus = recordFiniteNumberField(input.errorData, "http_status");
    if (typeof httpStatus === "number") {
      return `upstream_http_${String(Math.trunc(httpStatus))}`;
    }
    if (input.errorMessage.includes("status=429")) {
      return "upstream_429";
    }
  }
  return input.errorClass;
}

export function shouldRetryWithKimiBuiltinFallback(input: {
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

export function resolveProviderOrder(input: {
  providers: readonly RuntimeProviderCandidate[];
  stickyProvider: string | undefined;
  sessionKey: string;
  stateMap: Map<string, SessionProviderRuntimeState>;
}): {
  orderedProviders: RuntimeProviderCandidate[];
  trace: RouteDecisionTrace;
} {
  const ordered: RuntimeProviderCandidate[] = [];
  const openProviders: RuntimeProviderCandidate[] = [];
  const circuitSkipped: Array<{ name: string; reopenAtMs: number }> = [];
  const nowMs = Date.now();
  let stickyHit = false;
  let stickyReason: RouteDecisionTrace["stickyReason"] = "none";
  const pushOpenProvider = (provider: RuntimeProviderCandidate): void => {
    if (openProviders.some((item) => item.name === provider.name)) {
      return;
    }
    const reopenAtMs = input.stateMap.get(provider.name)?.circuit_open_until_ms ?? 0;
    circuitSkipped.push({
      name: provider.name,
      reopenAtMs,
    });
    openProviders.push(provider);
  };
  if (input.stickyProvider) {
    const sticky = input.providers.find((item) => item.name === input.stickyProvider);
    if (sticky) {
      const stickyState = input.stateMap.get(sticky.name);
      if (!stickyState || stickyState.circuit_open_until_ms <= nowMs) {
        stickyHit = true;
        stickyReason = "applied";
        ordered.push(sticky);
      } else {
        stickyReason = "circuit_open";
        pushOpenProvider(sticky);
      }
    } else {
      stickyReason = "not_found";
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
  let probeProvider: string | undefined;
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
      probeProvider = probe.name;
      ordered.push(probe);
    }
  }
  const scoreOrder = ordered
    .map((provider, index) => ({
      name: provider.name,
      score: resolveCandidateScore({
        provider,
        providerState: input.stateMap.get(provider.name),
        fallbackPriority: index + 1,
        sessionKey: input.sessionKey,
      }),
    }))
    .sort((left, right) => left.score - right.score);
  if (ordered.length <= 1) {
    return {
      orderedProviders: ordered,
      trace: {
        stickyProvider: input.stickyProvider,
        stickyHit,
        stickyReason,
        scoreOrder,
        circuitSkipped,
        probeProvider,
      },
    };
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
  return {
    orderedProviders: [...head, ...tail],
    trace: {
      stickyProvider: input.stickyProvider,
      stickyHit,
      stickyReason,
      scoreOrder,
      circuitSkipped,
      probeProvider,
    },
  };
}
