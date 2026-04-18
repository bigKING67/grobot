import { type ExecutionPlaneConfig } from "../../../execution-plane";
import { runGatewayTurn } from "../../../main";
import { type RuntimeModelConfig, type RuntimeToolContext } from "../../../../models/types";
import { consumeInterruptFlag } from "../services/interrupt-store";
import {
  compactSingleLine,
  trimHistoryMessages,
  type ChatHistoryMessage,
} from "./session-history";
import { parseSessionKeyPartsLoose, type SessionProviderRuntimeState } from "./session-registry";
import { parsePlatform, parseScope } from "./session-options";
import { type GaMechanismRuntime, type GaSessionStateSnapshot } from "../services/ga-mechanism-runtime";
import { type ExperiencePoolRuntime } from "../services/experience-pool-runtime";
import {
  type AskUserEnvelope,
  createAskUserTurnPromptContext,
  formatAskUserIssuedEvent,
} from "../../../../tools/ask-user";
import { applyLearnedPromptContext } from "../../../../tools/ga-skill";
import {
  compressPromptSnapshotSectionsSemanticallyForBudget,
  applyPromptQualityGuardFloor,
  assessPromptQualityWindowDegradation,
  appendPromptQualityWindowEntry,
  appendGraphCacheWindowEntry,
  buildSemanticPrefetchBlock,
  classifyPromptOverflow,
  computePromptQualitySample,
  computeUtilization,
  derivePromptPreSendCompressionPlan,
  derivePromptQualityGuardAdaptivePolicy,
  evaluatePromptQualityGuard,
  estimateTokensFromText,
  escalatePromptVariant,
  prepareTurnPrompt,
  readContextGraphCacheStats,
  readPromptQualityGuardState,
  readPromptQualityWindowSummary,
  shouldTriggerDownshiftPrecompact,
  trimPromptRecentTurnsForBudget,
  trimPromptSnapshotSectionsForBudget,
  truncatePromptHeadForPtlRetry,
  writePromptQualityGuardState,
  type ContextEngineConfig,
  type PromptCompactionStage,
  type PromptVariant,
} from "../../../../tools/context";

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

export const TURN_INTERRUPTED_ERROR_CLASS = "turn_interrupted";
export const TURN_INTERRUPTED_EXIT_CODE = 130;

export interface RunStartTurnExecuteOptions {
  signal?: AbortSignal;
}

interface CreateRunStartTurnRunnerInput {
  interruptStorePath: string;
  historyTurns: number;
  projectName: string;
  workDir: string;
  subject: string;
  executionPlane: ExecutionPlaneConfig;
  runtimeModelConfig?: RuntimeModelConfig;
  runtimeProviderChain: RuntimeProviderCandidate[];
  runtimeFailoverConfig: RuntimeFailoverConfig;
  contextEngineConfig: ContextEngineConfig;
  runtimeModelConfigSource: {
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs: string;
    providerKind: string;
  };
  runtimeToolContext?: RuntimeToolContext;
  gaMechanismRuntime: GaMechanismRuntime;
  kimiSearchRoutingPolicy: KimiSearchRoutingPolicy;
  mcpInstructionPromptPrefix?: string;
  mcpInstructionServerNames: string[];
  experiencePoolRuntime: ExperiencePoolRuntime;
  getSessionKey(): string;
  getHistoryMessages(): ChatHistoryMessage[];
  setHistoryMessages(rows: ChatHistoryMessage[]): void;
  getStickyProvider(): string | undefined;
  setStickyProvider(value: string | undefined): void;
  getProviderRuntimeStates(): SessionProviderRuntimeState[];
  setProviderRuntimeStates(rows: SessionProviderRuntimeState[]): void;
  getGaState(): GaSessionStateSnapshot | undefined;
  setGaState(value: GaSessionStateSnapshot | undefined): void;
  onHistoryCompacted(): void;
  onVerificationFailure(): void;
  touchActiveSession(userText: string): void;
  updateActiveSessionProviderRuntime(
    stickyProvider: string | undefined,
    providerRuntimeStates: readonly SessionProviderRuntimeState[],
  ): void;
  updateActiveSessionGaState(gaState: GaSessionStateSnapshot | undefined): void;
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

function readGraphCacheCounter(
  stats: Record<string, { hit?: number; miss?: number; write?: number; evict?: number }>,
  bucket: string,
): {
  hit: number;
  miss: number;
  write: number;
  evict: number;
} {
  const row = stats[bucket];
  return {
    hit: Number.isFinite(row?.hit) ? Number(row?.hit) : 0,
    miss: Number.isFinite(row?.miss) ? Number(row?.miss) : 0,
    write: Number.isFinite(row?.write) ? Number(row?.write) : 0,
    evict: Number.isFinite(row?.evict) ? Number(row?.evict) : 0,
  };
}

function diffGraphCacheCounter(
  before: {
    hit: number;
    miss: number;
    write: number;
    evict: number;
  },
  after: {
    hit: number;
    miss: number;
    write: number;
    evict: number;
  },
): {
  hit: number;
  miss: number;
  write: number;
  evict: number;
} {
  return {
    hit: Math.max(0, after.hit - before.hit),
    miss: Math.max(0, after.miss - before.miss),
    write: Math.max(0, after.write - before.write),
    evict: Math.max(0, after.evict - before.evict),
  };
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

  // Cover colloquial Chinese queries, e.g. "帮我搜一下明天上海天气".
  if (/(搜|查|找)(一下|下|一搜|一查|一找)?/.test(normalized)) {
    return true;
  }

  // Treat weather-forecast style questions as search intent when time anchor exists.
  const weatherTopicMatched = /(天气|气温|温度|风力|降雨|降水|空气质量|aqi|weather|forecast)/.test(normalized);
  const timeAnchorMatched = /(今天|明天|后天|本周|下周|today|tomorrow|this week|next week)/.test(normalized);
  if (weatherTopicMatched && timeAnchorMatched) {
    return true;
  }

  return false;
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

function extractFirstUrl(raw: string): string | undefined {
  const match = raw.match(/https?:\/\/[^\s)]+/i);
  if (!match || typeof match[0] !== "string") {
    return undefined;
  }
  const normalized = match[0].trim();
  return normalized.length > 0 ? normalized : undefined;
}

function sleepAsync(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return Promise.resolve();
  }
  if (signal?.aborted) {
    return Promise.reject(
      new Error(`turn interrupted class=${TURN_INTERRUPTED_ERROR_CLASS} detail=aborted_before_backoff_sleep`),
    );
  }
  return new Promise((resolve, reject) => {
    let onAbort: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve();
    }, delayMs);
    onAbort = (): void => {
      clearTimeout(timer);
      reject(
        new Error(`turn interrupted class=${TURN_INTERRUPTED_ERROR_CLASS} detail=aborted_during_backoff_sleep`),
      );
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function throwIfTurnInterrupted(signal: AbortSignal | undefined, detail: string): void {
  if (signal?.aborted) {
    throw new Error(`turn interrupted class=${TURN_INTERRUPTED_ERROR_CLASS} detail=${detail}`);
  }
}

interface RouteDecisionTrace {
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

function resolveProviderOrder(input: {
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

export function createRunStartTurnRunner(input: CreateRunStartTurnRunnerInput) {
  const providerFlowStateMap = new Map<string, ProviderFlowState>();
  let consecutiveCompactionFailures = 0;
  let previousTargetTokenLimit: number | undefined;

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
      const gaState = input.gaMechanismRuntime.snapshotSession(input.getSessionKey());
      input.setGaState(gaState);
      input.updateActiveSessionProviderRuntime(stickyProvider, providerRuntimeStates);
      input.updateActiveSessionGaState(gaState);
      input.touchActiveSession(userText);
      await input.persistSessionRegistryState();
    };

    return async (
      userText: string,
      interactiveMode: boolean,
      options?: RunStartTurnExecuteOptions,
    ): Promise<number> => {
      const turnSignal = options?.signal;
      throwIfTurnInterrupted(turnSignal, "aborted_before_turn_start");
      const sessionKey = input.getSessionKey();
      input.gaMechanismRuntime.hydrateSession(sessionKey, input.getGaState());
      if (consumeInterruptFlag(input.interruptStorePath, sessionKey)) {
      if (interactiveMode) {
        input.writeStdout("Session interrupted by management API. Current input skipped.\n\n");
      } else {
        input.writeStdout("Session interrupted by management API. Current request skipped.\n");
      }
    return 0;
  }

      const historyMessages = input.getHistoryMessages();
      const allowProactiveCompaction =
        input.contextEngineConfig.enabled &&
        consecutiveCompactionFailures < input.contextEngineConfig.recovery.circuitBreakerFailures;
      if (
        input.contextEngineConfig.enabled &&
        !allowProactiveCompaction &&
        consecutiveCompactionFailures >= input.contextEngineConfig.recovery.circuitBreakerFailures
      ) {
        input.writeStderr(
          `[context-engine] event=circuit_open failures=${String(consecutiveCompactionFailures)} limit=${String(input.contextEngineConfig.recovery.circuitBreakerFailures)}\n`,
        );
      }
      const graphCacheStatsBefore = readContextGraphCacheStats();
      const promptPreparation = prepareTurnPrompt({
        userText,
        historyMessages,
        historyTurns: input.historyTurns,
        workDir: input.workDir,
        config: {
          ...input.contextEngineConfig,
          enabled: allowProactiveCompaction,
        },
      });
      let selectedStage = promptPreparation.selected.stage;
      let basePrompt = promptPreparation.selected.prompt;
      let selectionReason: "threshold" | "budget_guard" = promptPreparation.selectionReason;
      const targetTokenLimit = promptPreparation.targetTokenLimit;
      const promptQualityConfig = input.contextEngineConfig.promptQuality;
      const promptQualityWindowSummary = readPromptQualityWindowSummary({
        workDir: input.workDir,
        size: Math.max(
          20,
          Math.min(256, promptQualityConfig?.degradeMinEntries ?? 8),
        ),
        lowQualityThreshold: promptQualityConfig?.lowQualityThreshold,
      });
      const promptQualityWindowDegradation = assessPromptQualityWindowDegradation({
        summary: promptQualityWindowSummary,
        thresholdOverall: promptQualityConfig?.degradeOverallThreshold ?? 0.62,
        thresholdLowQualityRate:
          promptQualityConfig?.degradeLowQualityRateThreshold ?? 0.4,
        minEntries: promptQualityConfig?.degradeMinEntries ?? 8,
      });
      const qualityGuardState = readPromptQualityGuardState({
        workDir: input.workDir,
      });
      const baseGuardPolicy = {
        enabled: allowProactiveCompaction && (promptQualityConfig?.guardEnabled ?? true),
        promoteStreak: promptQualityConfig?.guardPromoteStreak ?? 2,
        severePromoteStreak: promptQualityConfig?.guardSeverePromoteStreak ?? 2,
        releaseStreak: promptQualityConfig?.guardReleaseStreak ?? 3,
        holdTurns: promptQualityConfig?.guardHoldTurns ?? 2,
        maxFloorStage: promptQualityConfig?.guardMaxFloorStage ?? "minimal",
        severeOverallThreshold: promptQualityConfig?.guardSevereOverallThreshold ?? 0.45,
        severeLowQualityRateThreshold:
          promptQualityConfig?.guardSevereLowQualityRateThreshold ?? 0.7,
      };
      const adaptiveGuardPolicyDecision = derivePromptQualityGuardAdaptivePolicy({
        basePolicy: baseGuardPolicy,
        adaptiveEnabled: promptQualityConfig?.guardAdaptiveEnabled ?? true,
        adaptiveModeAllowlist: promptQualityConfig?.guardAdaptiveModeAllowlist,
        currentState: qualityGuardState,
        window: {
          degraded: promptQualityWindowDegradation.degraded,
          reason: promptQualityWindowDegradation.reason,
          lowQualityRate: promptQualityWindowSummary.lowQualityRate,
          averageOverall: promptQualityWindowSummary.averageScores?.overall ?? null,
          observedOverall: promptQualityWindowDegradation.observedOverall,
          observedLowQualityRate: promptQualityWindowDegradation.observedLowQualityRate,
          snapshotSemanticCompressRate:
            promptQualityWindowSummary.compressionActivity.snapshotSemanticCompressRate,
          autoLimitTriggeredRate:
            promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate,
          averageUtilizationRatio:
            promptQualityWindowSummary.tokenBudget.averageUtilizationRatio,
          shortSnapshotSemanticCompressRate:
            promptQualityWindowSummary.pressureTrends.short.snapshotSemanticCompressRate,
          mediumSnapshotSemanticCompressRate:
            promptQualityWindowSummary.pressureTrends.medium.snapshotSemanticCompressRate,
          shortAutoLimitTriggeredRate:
            promptQualityWindowSummary.pressureTrends.short.autoLimitTriggeredRate,
          mediumAutoLimitTriggeredRate:
            promptQualityWindowSummary.pressureTrends.medium.autoLimitTriggeredRate,
          shortAverageUtilizationRatio:
            promptQualityWindowSummary.pressureTrends.short.averageUtilizationRatio,
          mediumAverageUtilizationRatio:
            promptQualityWindowSummary.pressureTrends.medium.averageUtilizationRatio,
          hardBudgetStrategyRate:
            promptQualityWindowSummary.strategyActivity.hardBudgetRate,
          qualityFirstStrategyRate:
            promptQualityWindowSummary.strategyActivity.qualityFirstRate,
          averagePreSendOverflowRatio:
            promptQualityWindowSummary.signalAverages?.preSendOverflowRatio ?? null,
          averagePreSendPressureScore:
            promptQualityWindowSummary.signalAverages?.preSendPressureScore ?? null,
          shortHardBudgetStrategyRate:
            promptQualityWindowSummary.strategyTrends.short.hardBudgetRate,
          mediumHardBudgetStrategyRate:
            promptQualityWindowSummary.strategyTrends.medium.hardBudgetRate,
          shortAveragePreSendOverflowRatio:
            promptQualityWindowSummary.strategyTrends.short.averageOverflowRatio,
          mediumAveragePreSendOverflowRatio:
            promptQualityWindowSummary.strategyTrends.medium.averageOverflowRatio,
          shortAveragePreSendPressureScore:
            promptQualityWindowSummary.strategyTrends.short.averagePressureScore,
          mediumAveragePreSendPressureScore:
            promptQualityWindowSummary.strategyTrends.medium.averagePressureScore,
          hardBudgetFollowupOverallDelta:
            promptQualityWindowSummary.strategyOutcomes.hardBudgetFollowupOverallDelta,
          qualityFirstFollowupOverallDelta:
            promptQualityWindowSummary.strategyOutcomes.qualityFirstFollowupOverallDelta,
          hardBudgetRecoveryRate:
            promptQualityWindowSummary.strategyOutcomes.hardBudgetRecoveryRate,
          qualityFirstImprovedRate:
            promptQualityWindowSummary.strategyOutcomes.qualityFirstImprovedRate,
          hardBudgetTransitionCount:
            promptQualityWindowSummary.strategyOutcomes.hardBudgetTransitions,
          qualityFirstTransitionCount:
            promptQualityWindowSummary.strategyOutcomes.qualityFirstTransitions,
        },
      });
      if (adaptiveGuardPolicyDecision.mode !== "stable" && adaptiveGuardPolicyDecision.mode !== "disabled") {
        input.writeStderr(
          `[context-engine] event=quality_guard_policy_adaptive mode=${adaptiveGuardPolicyDecision.mode} reason=${adaptiveGuardPolicyDecision.reason} allowlist=${adaptiveGuardPolicyDecision.allowlist.join(",")} mode_blocked=${adaptiveGuardPolicyDecision.modeBlocked ? "true" : "false"} blocked_mode=${adaptiveGuardPolicyDecision.blockedMode ?? "<none>"} promote_streak=${String(adaptiveGuardPolicyDecision.effectivePolicy.promoteStreak)} severe_promote_streak=${String(adaptiveGuardPolicyDecision.effectivePolicy.severePromoteStreak)} release_streak=${String(adaptiveGuardPolicyDecision.effectivePolicy.releaseStreak)} hold_turns=${String(adaptiveGuardPolicyDecision.effectivePolicy.holdTurns)} pressure_source=${adaptiveGuardPolicyDecision.pressurePolicy.source} pressure_updated=${adaptiveGuardPolicyDecision.pressurePolicy.updated ? "true" : "false"} pressure_alpha=${adaptiveGuardPolicyDecision.pressurePolicy.learnAlpha.toFixed(3)} pressure_thresholds=${adaptiveGuardPolicyDecision.pressurePolicy.utilizationThreshold.toFixed(3)}/${adaptiveGuardPolicyDecision.pressurePolicy.semanticRateThreshold.toFixed(3)}/${adaptiveGuardPolicyDecision.pressurePolicy.autoLimitRateThreshold.toFixed(3)}/${adaptiveGuardPolicyDecision.pressurePolicy.jointRateThreshold.toFixed(3)} semantic_rate=${typeof promptQualityWindowSummary.compressionActivity.snapshotSemanticCompressRate === "number" ? promptQualityWindowSummary.compressionActivity.snapshotSemanticCompressRate.toFixed(3) : "<none>"} auto_limit_rate=${typeof promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate === "number" ? promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate.toFixed(3) : "<none>"} avg_utilization=${typeof promptQualityWindowSummary.tokenBudget.averageUtilizationRatio === "number" ? promptQualityWindowSummary.tokenBudget.averageUtilizationRatio.toFixed(3) : "<none>"} hard_budget_rate=${typeof promptQualityWindowSummary.strategyActivity.hardBudgetRate === "number" ? promptQualityWindowSummary.strategyActivity.hardBudgetRate.toFixed(3) : "<none>"} quality_first_rate=${typeof promptQualityWindowSummary.strategyActivity.qualityFirstRate === "number" ? promptQualityWindowSummary.strategyActivity.qualityFirstRate.toFixed(3) : "<none>"} pre_send_overflow=${typeof promptQualityWindowSummary.signalAverages?.preSendOverflowRatio === "number" ? promptQualityWindowSummary.signalAverages.preSendOverflowRatio.toFixed(3) : "<none>"} pre_send_pressure=${typeof promptQualityWindowSummary.signalAverages?.preSendPressureScore === "number" ? promptQualityWindowSummary.signalAverages.preSendPressureScore.toFixed(3) : "<none>"} trend_delta_utilization=${typeof promptQualityWindowSummary.pressureTrends.delta.averageUtilizationRatio === "number" ? promptQualityWindowSummary.pressureTrends.delta.averageUtilizationRatio.toFixed(3) : "<none>"} trend_delta_semantic=${typeof promptQualityWindowSummary.pressureTrends.delta.snapshotSemanticCompressRate === "number" ? promptQualityWindowSummary.pressureTrends.delta.snapshotSemanticCompressRate.toFixed(3) : "<none>"} trend_delta_auto_limit=${typeof promptQualityWindowSummary.pressureTrends.delta.autoLimitTriggeredRate === "number" ? promptQualityWindowSummary.pressureTrends.delta.autoLimitTriggeredRate.toFixed(3) : "<none>"} strategy_trend_delta_hard_budget=${typeof promptQualityWindowSummary.strategyTrends.delta.hardBudgetRate === "number" ? promptQualityWindowSummary.strategyTrends.delta.hardBudgetRate.toFixed(3) : "<none>"} strategy_trend_delta_overflow=${typeof promptQualityWindowSummary.strategyTrends.delta.averageOverflowRatio === "number" ? promptQualityWindowSummary.strategyTrends.delta.averageOverflowRatio.toFixed(3) : "<none>"} strategy_trend_delta_pressure=${typeof promptQualityWindowSummary.strategyTrends.delta.averagePressureScore === "number" ? promptQualityWindowSummary.strategyTrends.delta.averagePressureScore.toFixed(3) : "<none>"} outcome_reliability=${String(adaptiveGuardPolicyDecision.outcomeReliability.requiredTransitions)}->${String(adaptiveGuardPolicyDecision.outcomeReliability.nextRequiredTransitions)}/${String(adaptiveGuardPolicyDecision.outcomeReliability.hardBudgetTransitions)}/${String(adaptiveGuardPolicyDecision.outcomeReliability.qualityFirstTransitions)}/${adaptiveGuardPolicyDecision.outcomeReliability.combinedEvidenceScore.toFixed(3)} hard_budget_reliable=${adaptiveGuardPolicyDecision.outcomeReliability.hardBudgetReliable ? "true" : "false"} quality_first_reliable=${adaptiveGuardPolicyDecision.outcomeReliability.qualityFirstReliable ? "true" : "false"} drift_guard=${adaptiveGuardPolicyDecision.outcomeDriftGuard.highEvidenceTurns}/${adaptiveGuardPolicyDecision.outcomeDriftGuard.highEvidenceHardenTurns}/${adaptiveGuardPolicyDecision.outcomeDriftGuard.highEvidenceHardenRate.toFixed(3)}/${adaptiveGuardPolicyDecision.outcomeDriftGuard.highEvidenceHardenBias ? "bias" : "ok"}/${adaptiveGuardPolicyDecision.outcomeDriftGuard.autoActionLevel}/${adaptiveGuardPolicyDecision.outcomeDriftGuard.windowSummary.alertLevel}/${String(adaptiveGuardPolicyDecision.outcomeDriftGuard.windowSummary.entries)}/${adaptiveGuardPolicyDecision.outcomeDriftGuard.windowSummary.latest}/${adaptiveGuardPolicyDecision.outcomeDriftGuard.windowSummary.dominant}/${adaptiveGuardPolicyDecision.outcomeDriftGuard.windowSummary.activeRate.toFixed(3)}/${adaptiveGuardPolicyDecision.outcomeDriftGuard.windowSummary.mediumOrHardRate.toFixed(3)}/${adaptiveGuardPolicyDecision.outcomeDriftGuard.windowSummary.hardRate.toFixed(3)}/${String(adaptiveGuardPolicyDecision.outcomeDriftGuard.windowSummary.transitionCount)}\n`,
        );
      }
      if (adaptiveGuardPolicyDecision.outcomeDriftGuard.highEvidenceHardenBias) {
        input.writeStderr(
          `[context-engine] event=quality_guard_policy_drift_guard reason=${adaptiveGuardPolicyDecision.outcomeDriftGuard.reason} recommendation=${adaptiveGuardPolicyDecision.outcomeDriftGuard.recommendation} auto_action_level=${adaptiveGuardPolicyDecision.outcomeDriftGuard.autoActionLevel} window_alert=${adaptiveGuardPolicyDecision.outcomeDriftGuard.windowSummary.alertLevel} high_evidence_turns=${String(adaptiveGuardPolicyDecision.outcomeDriftGuard.highEvidenceTurns)} high_evidence_harden_turns=${String(adaptiveGuardPolicyDecision.outcomeDriftGuard.highEvidenceHardenTurns)} high_evidence_harden_rate=${adaptiveGuardPolicyDecision.outcomeDriftGuard.highEvidenceHardenRate.toFixed(3)}\n`,
        );
      }
      const qualityGuardDecision = evaluatePromptQualityGuard({
        policy: adaptiveGuardPolicyDecision.effectivePolicy,
        currentState: qualityGuardState,
        observation: {
          degraded: promptQualityWindowDegradation.degraded,
          reason: promptQualityWindowDegradation.reason,
          observedOverall: promptQualityWindowDegradation.observedOverall,
          observedLowQualityRate: promptQualityWindowDegradation.observedLowQualityRate,
        },
      });
      const persistedQualityGuardState = {
        ...qualityGuardDecision.state,
        pressureUtilizationThreshold:
          adaptiveGuardPolicyDecision.pressurePolicy.utilizationThreshold,
        pressureSemanticRateThreshold:
          adaptiveGuardPolicyDecision.pressurePolicy.semanticRateThreshold,
        pressureAutoLimitRateThreshold:
          adaptiveGuardPolicyDecision.pressurePolicy.autoLimitRateThreshold,
        pressureJointRateThreshold:
          adaptiveGuardPolicyDecision.pressurePolicy.jointRateThreshold,
        pressureTrendUtilizationDelta:
          adaptiveGuardPolicyDecision.pressurePolicy.trendUtilizationDelta,
        pressureTrendSemanticDelta:
          adaptiveGuardPolicyDecision.pressurePolicy.trendSemanticDelta,
        pressureTrendAutoLimitDelta:
          adaptiveGuardPolicyDecision.pressurePolicy.trendAutoLimitDelta,
        pressureTrendMomentum:
          adaptiveGuardPolicyDecision.pressurePolicy.trendMomentum,
        outcomeRequiredTransitions:
          adaptiveGuardPolicyDecision.outcomeReliability.nextRequiredTransitions,
        outcomeCombinedEvidenceScore:
          adaptiveGuardPolicyDecision.outcomeReliability.combinedEvidenceScore,
        outcomeHighEvidenceTurns:
          adaptiveGuardPolicyDecision.outcomeDriftGuard.highEvidenceTurns,
        outcomeHighEvidenceHardenTurns:
          adaptiveGuardPolicyDecision.outcomeDriftGuard.highEvidenceHardenTurns,
        outcomeDriftRecentAutoActionLevels:
          adaptiveGuardPolicyDecision.outcomeDriftGuard.recentAutoActionLevels,
      };
      writePromptQualityGuardState({
        workDir: input.workDir,
        state: persistedQualityGuardState,
      });
      const guardedStage = applyPromptQualityGuardFloor({
        selectedStage,
        floorStage: qualityGuardDecision.floorStage,
      });
      const qualityGuardActive = qualityGuardDecision.triggered;
      let qualityGuardEscalated = false;
      if (guardedStage !== selectedStage) {
        const guardedVariant = promptPreparation.variants.find((variant) => variant.stage === guardedStage);
        if (guardedVariant) {
          selectedStage = guardedVariant.stage;
          basePrompt = guardedVariant.prompt;
          selectionReason = "budget_guard";
          qualityGuardEscalated = true;
        }
      }
      if (
        qualityGuardEscalated
        || qualityGuardDecision.promoted
        || qualityGuardDecision.released
      ) {
        input.writeStderr(
          `[context-engine] event=quality_guard_precompact stage=${selectedStage} floor=${qualityGuardDecision.floorStage} reason=${promptQualityWindowDegradation.reason} severe=${qualityGuardDecision.severe ? "true" : "false"} promoted=${qualityGuardDecision.promoted ? "true" : "false"} released=${qualityGuardDecision.released ? "true" : "false"} degraded_streak=${String(qualityGuardDecision.state.degradedStreak)} healthy_streak=${String(qualityGuardDecision.state.healthyStreak)} hold_turns=${String(qualityGuardDecision.state.holdTurnsRemaining)} observed_overall=${typeof promptQualityWindowDegradation.observedOverall === "number" ? promptQualityWindowDegradation.observedOverall.toFixed(3) : "<none>"} observed_low_quality_rate=${typeof promptQualityWindowDegradation.observedLowQualityRate === "number" ? promptQualityWindowDegradation.observedLowQualityRate.toFixed(3) : "<none>"}\n`,
        );
      }
      const downshiftGuardTriggered = shouldTriggerDownshiftPrecompact({
        allowProactiveCompaction,
        previousTargetTokenLimit,
        currentTargetTokenLimit: targetTokenLimit,
        totalEstimatedTokens: promptPreparation.totalEstimatedTokens,
      });
      if (downshiftGuardTriggered) {
        const escalated = escalatePromptVariant(promptPreparation.variants, selectedStage);
        if (escalated) {
          selectedStage = escalated.stage;
          basePrompt = escalated.prompt;
          selectionReason = "budget_guard";
          input.writeStderr(
            `[context-engine] event=downshift_precompact stage=${selectedStage} previous_limit=${String(previousTargetTokenLimit)} current_limit=${String(targetTokenLimit)}\n`,
          );
        }
      }
      previousTargetTokenLimit = targetTokenLimit;
      const askUserTurnContext = createAskUserTurnPromptContext({
        runtime: input.gaMechanismRuntime,
        sessionKey,
        userText,
      });
      if (askUserTurnContext.resolvedEvent.length > 0) {
        input.writeStderr(askUserTurnContext.resolvedEvent);
      }
    const experienceRecall = input.experiencePoolRuntime.buildRecallPrompt({
      sessionKey,
      userText,
    });
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
      const promptContext = applyLearnedPromptContext({
        promptParts: askUserTurnContext.promptParts,
        userText,
        gaSkillCards: input.gaMechanismRuntime.listSkillCards(sessionKey),
        experienceRecall,
      });
      for (const event of promptContext.stderrEvents) {
        input.writeStderr(event);
      }
      const promptParts = promptContext.promptParts;
    const askUserClarificationHint = input.gaMechanismRuntime.buildAskUserClarificationHint(sessionKey, userText);
    if (askUserClarificationHint.length > 0) {
      promptParts.push(askUserClarificationHint);
      input.writeStderr("[ask-user] event=clarification_hint_injected\n");
    }
    const semanticPrefetch = buildSemanticPrefetchBlock({
      enabled: input.contextEngineConfig.semanticPrefetch.enabled,
      workDir: input.workDir,
      userText,
      timeoutMs: input.contextEngineConfig.semanticPrefetch.timeoutMs,
      maxEvidence: input.contextEngineConfig.semanticPrefetch.maxEvidence,
    });
    if (semanticPrefetch.block && semanticPrefetch.block.trim().length > 0) {
      promptParts.push(semanticPrefetch.block);
      input.writeStderr(
        `[context-engine] event=semantic_prefetch status=applied evidence=${String(semanticPrefetch.evidenceCount)} duration_ms=${String(semanticPrefetch.durationMs)}\n`,
      );
      if (semanticPrefetch.warning) {
        input.writeStderr(
          `[context-engine] event=semantic_prefetch status=warning message=${compactSingleLine(semanticPrefetch.warning, 140)}\n`,
        );
      }
    } else if (input.contextEngineConfig.semanticPrefetch.enabled) {
      if (semanticPrefetch.warning) {
        input.writeStderr(
          `[context-engine] event=semantic_prefetch status=degraded message=${compactSingleLine(semanticPrefetch.warning, 140)} duration_ms=${String(semanticPrefetch.durationMs)}\n`,
        );
      } else {
        input.writeStderr(
          `[context-engine] event=semantic_prefetch status=empty duration_ms=${String(semanticPrefetch.durationMs)}\n`,
        );
      }
    }
    if (mcpInstructionPrefix.length > 0 && mcpInstructionDecision.inject) {
      promptParts.push(mcpInstructionPrefix);
    }
    if (kimiSearchRoutingPrefix.length > 0) {
      promptParts.push(kimiSearchRoutingPrefix);
    }
      const composeTurnPrompt = (conversationPrompt: string): string => {
        const merged = [...promptParts, conversationPrompt];
        return merged.join("\n\n");
      };
      const preparedPromptVariants: PromptVariant[] = promptPreparation.variants.map((variant) => ({
        stage: variant.stage,
        prompt: composeTurnPrompt(variant.prompt),
        estimatedTokens: estimateTokensFromText(composeTurnPrompt(variant.prompt)),
      }));
      const findPreparedVariantByStage = (stage: PromptCompactionStage): PromptVariant => {
        const matched = preparedPromptVariants.find((item) => item.stage === stage);
        return matched ?? preparedPromptVariants[0] as PromptVariant;
      };
      let selectedPrepared = findPreparedVariantByStage(selectedStage);
      if (
        allowProactiveCompaction &&
        selectedPrepared.estimatedTokens > targetTokenLimit
      ) {
        let stageCursor = selectedPrepared.stage;
        let escalated = false;
        while (selectedPrepared.estimatedTokens > targetTokenLimit) {
          const next = escalatePromptVariant(preparedPromptVariants, stageCursor);
          if (!next) {
            break;
          }
          selectedPrepared = next;
          stageCursor = next.stage;
          escalated = true;
        }
        if (escalated) {
          selectedStage = selectedPrepared.stage;
          selectionReason = "budget_guard";
        }
      }
      let preSendHeadTrimRetries = 0;
      let preSendRecentTrimRows = 0;
      let preSendSnapshotTrimSections = 0;
      let preSendSnapshotSemanticCompressSections = 0;
      let preSendCompressionStrategy: "quality_first" | "hard_budget" = "quality_first";
      let preSendCompressionOverflowRatio = 0;
      let preSendCompressionPressureScore = 0;
      let preSendCompressionOrder = "recent_trim,snapshot_semantic_compress,snapshot_trim,head_trim";
      if (
        allowProactiveCompaction &&
        selectedPrepared.estimatedTokens > targetTokenLimit
      ) {
        const preSendCompressionPlan = derivePromptPreSendCompressionPlan({
          selectedStage,
          estimatedTokens: selectedPrepared.estimatedTokens,
          targetTokenLimit,
          qualityGuardActive,
          qualityGuardSevere: qualityGuardDecision.severe,
          pressureTrendMomentum: adaptiveGuardPolicyDecision.pressurePolicy.trendMomentum,
        });
        preSendCompressionStrategy = preSendCompressionPlan.strategy;
        preSendCompressionOverflowRatio = preSendCompressionPlan.overflowRatio;
        preSendCompressionPressureScore = preSendCompressionPlan.pressureScore;
        preSendCompressionOrder = preSendCompressionPlan.order.join(",");
        input.writeStderr(
          `[context-engine] event=pre_send_plan stage=${selectedStage} strategy=${preSendCompressionStrategy} overflow_ratio=${preSendCompressionOverflowRatio.toFixed(3)} pressure_score=${preSendCompressionPressureScore.toFixed(3)} order=${preSendCompressionOrder}\n`,
        );
        for (const step of preSendCompressionPlan.order) {
          if (selectedPrepared.estimatedTokens <= targetTokenLimit) {
            break;
          }
          if (step === "recent_trim") {
            const recentTrimmed = trimPromptRecentTurnsForBudget({
              prompt: selectedPrepared.prompt,
              targetTokenLimit,
              minRecentRows: 1,
            });
            if (recentTrimmed.removedRows > 0) {
              preSendRecentTrimRows = recentTrimmed.removedRows;
              selectedPrepared = {
                ...selectedPrepared,
                prompt: recentTrimmed.prompt,
                estimatedTokens: recentTrimmed.estimatedTokens,
              };
              selectionReason = "budget_guard";
              input.writeStderr(
                `[context-engine] event=pre_send_recent_trim stage=${selectedStage} removed_rows=${String(preSendRecentTrimRows)} estimated_tokens=${String(selectedPrepared.estimatedTokens)} target_limit=${String(targetTokenLimit)}\n`,
              );
            }
            continue;
          }
          if (step === "snapshot_semantic_compress") {
            const snapshotSemanticCompressed = compressPromptSnapshotSectionsSemanticallyForBudget({
              prompt: selectedPrepared.prompt,
              targetTokenLimit,
              workDir: input.workDir,
              userText,
              generativeTimeoutMs: input.contextEngineConfig.semanticPrefetch.timeoutMs,
              generativeMaxEvidence: input.contextEngineConfig.semanticPrefetch.maxEvidence,
            });
            if (snapshotSemanticCompressed.compressedSections.length > 0) {
              preSendSnapshotSemanticCompressSections =
                snapshotSemanticCompressed.compressedSections.length;
              selectedPrepared = {
                ...selectedPrepared,
                prompt: snapshotSemanticCompressed.prompt,
                estimatedTokens: snapshotSemanticCompressed.estimatedTokens,
              };
              selectionReason = "budget_guard";
              input.writeStderr(
                `[context-engine] event=pre_send_snapshot_semantic_compress stage=${selectedStage} compressed_sections=${String(preSendSnapshotSemanticCompressSections)} estimated_tokens=${String(selectedPrepared.estimatedTokens)} target_limit=${String(targetTokenLimit)}\n`,
              );
            }
            if (snapshotSemanticCompressed.generativeUsed) {
              input.writeStderr(
                `[context-engine] event=pre_send_snapshot_semantic_generate stage=${selectedStage} generated_sections=${String(snapshotSemanticCompressed.generativeSections.length)} estimated_tokens=${String(selectedPrepared.estimatedTokens)} target_limit=${String(targetTokenLimit)}\n`,
              );
            }
            if (snapshotSemanticCompressed.warnings.length > 0) {
              input.writeStderr(
                `[context-engine] event=pre_send_snapshot_semantic_generate status=degraded message=${compactSingleLine(snapshotSemanticCompressed.warnings.join("; "), 180)}\n`,
              );
            }
            continue;
          }
          if (step === "snapshot_trim") {
            const snapshotTrimmed = trimPromptSnapshotSectionsForBudget({
              prompt: selectedPrepared.prompt,
              targetTokenLimit,
            });
            if (snapshotTrimmed.removedSections.length > 0) {
              preSendSnapshotTrimSections = snapshotTrimmed.removedSections.length;
              selectedPrepared = {
                ...selectedPrepared,
                prompt: snapshotTrimmed.prompt,
                estimatedTokens: snapshotTrimmed.estimatedTokens,
              };
              selectionReason = "budget_guard";
              input.writeStderr(
                `[context-engine] event=pre_send_snapshot_trim stage=${selectedStage} removed_sections=${String(preSendSnapshotTrimSections)} estimated_tokens=${String(selectedPrepared.estimatedTokens)} target_limit=${String(targetTokenLimit)}\n`,
              );
            }
            continue;
          }
          while (
            selectedPrepared.estimatedTokens > targetTokenLimit &&
            preSendHeadTrimRetries < input.contextEngineConfig.recovery.ptlMaxRetries
          ) {
            const trimmedPrompt = truncatePromptHeadForPtlRetry(
              selectedPrepared.prompt,
              preSendHeadTrimRetries + 1,
            );
            if (trimmedPrompt === selectedPrepared.prompt) {
              break;
            }
            preSendHeadTrimRetries += 1;
            selectedPrepared = {
              ...selectedPrepared,
              prompt: trimmedPrompt,
              estimatedTokens: estimateTokensFromText(trimmedPrompt),
            };
            selectionReason = "budget_guard";
          }
        }
      }
      basePrompt = selectedPrepared.prompt;
      if (
        selectedStage !== "normal"
        || preSendRecentTrimRows > 0
        || preSendSnapshotTrimSections > 0
        || preSendSnapshotSemanticCompressSections > 0
        || preSendHeadTrimRetries > 0
      ) {
        input.onHistoryCompacted();
      }
      if (preSendHeadTrimRetries > 0) {
        input.writeStderr(
          `[context-engine] event=pre_send_head_trim stage=${selectedStage} retries=${String(preSendHeadTrimRetries)} estimated_tokens=${String(selectedPrepared.estimatedTokens)} effective_window=${String(promptPreparation.effectiveWindowTokens)} target_limit=${String(targetTokenLimit)}\n`,
        );
      }
      input.writeStderr(
        `[context-engine] event=prompt_prepared stage=${selectedStage} threshold_stage=${promptPreparation.thresholdStage} reason=${selectionReason} utilization=${promptPreparation.utilization.toFixed(3)} selected_utilization=${computeUtilization(selectedPrepared.estimatedTokens, promptPreparation.effectiveWindowTokens).toFixed(3)} estimated_tokens=${String(selectedPrepared.estimatedTokens)} auto_compact_limit=${String(promptPreparation.autoCompactTokenLimit)} target_limit=${String(targetTokenLimit)} effective_window=${String(promptPreparation.effectiveWindowTokens)} auto_limit_triggered=${promptPreparation.autoCompactLimitTriggered ? "true" : "false"} downshift_guard=${downshiftGuardTriggered ? "true" : "false"} quality_guard=${qualityGuardActive ? "true" : "false"} pre_send_strategy=${preSendCompressionStrategy} pre_send_overflow_ratio=${preSendCompressionOverflowRatio.toFixed(3)} pre_send_pressure_score=${preSendCompressionPressureScore.toFixed(3)} pre_send_order=${preSendCompressionOrder} recent_trim_rows=${String(preSendRecentTrimRows)} snapshot_trim_sections=${String(preSendSnapshotTrimSections)} snapshot_semantic_compress_sections=${String(preSendSnapshotSemanticCompressSections)} pretrim_retries=${String(preSendHeadTrimRetries)}\n`,
      );
      const promptQualitySample = computePromptQualitySample({
        prompt: selectedPrepared.prompt,
        stage: selectedStage,
        estimatedTokens: selectedPrepared.estimatedTokens,
        targetTokenLimit,
        recentTrimRows: preSendRecentTrimRows,
        snapshotTrimSections: preSendSnapshotTrimSections,
        snapshotSemanticCompressSections: preSendSnapshotSemanticCompressSections,
        headTrimRetries: preSendHeadTrimRetries,
        autoLimitTriggered: promptPreparation.autoCompactLimitTriggered,
        downshiftGuardTriggered,
        preSendStrategy: preSendCompressionStrategy,
        preSendOverflowRatio: preSendCompressionOverflowRatio,
        preSendPressureScore: preSendCompressionPressureScore,
      });
      input.writeStderr(
        `[context-engine] event=prompt_quality coverage=${promptQualitySample.scores.coverage.toFixed(3)} recency=${promptQualitySample.scores.recency.toFixed(3)} size=${promptQualitySample.scores.size.toFixed(3)} overall=${promptQualitySample.scores.overall.toFixed(3)} recent_rows=${String(promptQualitySample.signals.recentRows)} snapshot_sections=${String(promptQualitySample.signals.snapshotSections)} recent_trim_rows=${String(promptQualitySample.signals.recentTrimRows)} snapshot_trim_sections=${String(promptQualitySample.signals.snapshotTrimSections)} snapshot_semantic_compress_sections=${String(promptQualitySample.signals.snapshotSemanticCompressSections)} head_trim_retries=${String(promptQualitySample.signals.headTrimRetries)} pre_send_strategy=${promptQualitySample.signals.preSendStrategy} pre_send_overflow_ratio=${promptQualitySample.signals.preSendOverflowRatio.toFixed(3)} pre_send_pressure_score=${promptQualitySample.signals.preSendPressureScore.toFixed(3)}\n`,
      );
      appendPromptQualityWindowEntry({
        workDir: input.workDir,
        entry: {
          ts: nowIso(),
          sessionKey,
          stage: selectedStage,
          selectionReason,
          estimatedTokens: selectedPrepared.estimatedTokens,
          targetTokenLimit,
          scores: promptQualitySample.scores,
          signals: promptQualitySample.signals,
        },
      });
      const graphCacheStats = readContextGraphCacheStats();
      const symbolQueryStatsBefore = readGraphCacheCounter(graphCacheStatsBefore, "symbol_query");
      const symbolDeclarationStatsBefore = readGraphCacheCounter(graphCacheStatsBefore, "symbol_declaration");
      const dependencyQueryStatsBefore = readGraphCacheCounter(graphCacheStatsBefore, "dependency_query");
      const dependencyImportStatsBefore = readGraphCacheCounter(graphCacheStatsBefore, "dependency_import");
      const symbolQueryStats = readGraphCacheCounter(graphCacheStats, "symbol_query");
      const symbolDeclarationStats = readGraphCacheCounter(graphCacheStats, "symbol_declaration");
      const dependencyQueryStats = readGraphCacheCounter(graphCacheStats, "dependency_query");
      const dependencyImportStats = readGraphCacheCounter(graphCacheStats, "dependency_import");
      const symbolQueryDeltaStats = diffGraphCacheCounter(symbolQueryStatsBefore, symbolQueryStats);
      const symbolDeclarationDeltaStats = diffGraphCacheCounter(
        symbolDeclarationStatsBefore,
        symbolDeclarationStats,
      );
      const dependencyQueryDeltaStats = diffGraphCacheCounter(
        dependencyQueryStatsBefore,
        dependencyQueryStats,
      );
      const dependencyImportDeltaStats = diffGraphCacheCounter(
        dependencyImportStatsBefore,
        dependencyImportStats,
      );
      input.writeStderr(
        `[context-engine] event=graph_cache_stats delta_symbol_query=${symbolQueryDeltaStats.hit}/${symbolQueryDeltaStats.miss}/${symbolQueryDeltaStats.write}/${symbolQueryDeltaStats.evict} delta_symbol_decl=${symbolDeclarationDeltaStats.hit}/${symbolDeclarationDeltaStats.miss}/${symbolDeclarationDeltaStats.write}/${symbolDeclarationDeltaStats.evict} delta_dependency_query=${dependencyQueryDeltaStats.hit}/${dependencyQueryDeltaStats.miss}/${dependencyQueryDeltaStats.write}/${dependencyQueryDeltaStats.evict} delta_dependency_import=${dependencyImportDeltaStats.hit}/${dependencyImportDeltaStats.miss}/${dependencyImportDeltaStats.write}/${dependencyImportDeltaStats.evict} total_symbol_query=${symbolQueryStats.hit}/${symbolQueryStats.miss}/${symbolQueryStats.write}/${symbolQueryStats.evict} total_symbol_decl=${symbolDeclarationStats.hit}/${symbolDeclarationStats.miss}/${symbolDeclarationStats.write}/${symbolDeclarationStats.evict} total_dependency_query=${dependencyQueryStats.hit}/${dependencyQueryStats.miss}/${dependencyQueryStats.write}/${dependencyQueryStats.evict} total_dependency_import=${dependencyImportStats.hit}/${dependencyImportStats.miss}/${dependencyImportStats.write}/${dependencyImportStats.evict}\n`,
      );
      appendGraphCacheWindowEntry({
        workDir: input.workDir,
        entry: {
          ts: nowIso(),
          sessionKey,
          stage: selectedStage,
          selectionReason,
          delta: {
            symbolQuery: symbolQueryDeltaStats,
            symbolDeclaration: symbolDeclarationDeltaStats,
            dependencyQuery: dependencyQueryDeltaStats,
            dependencyImport: dependencyImportDeltaStats,
          },
          total: {
            symbolQuery: symbolQueryStats,
            symbolDeclaration: symbolDeclarationStats,
            dependencyQuery: dependencyQueryStats,
            dependencyImport: dependencyImportStats,
          },
        },
      });
      const selectedConversationVariant = promptPreparation.variants.find(
        (variant) => variant.stage === selectedStage,
      ) ?? promptPreparation.selected;
      const kimiBuiltinFallbackPrompt = kimiMcpFirstRouteEnabled
        ? composeTurnPrompt(buildKimiBuiltinFallbackPrompt(selectedConversationVariant.prompt))
        : basePrompt;
      const prompt = basePrompt;
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
        const gaState = input.gaMechanismRuntime.snapshotSession(sessionKey);
        input.setGaState(gaState);
        input.updateActiveSessionGaState(gaState);
        await input.persistSessionRegistryState();
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
    const routeDecision = resolveProviderOrder({
      providers,
      stickyProvider: currentStickyProvider,
      sessionKey,
      stateMap: providerStateMap,
    });
    const orderedProviders = routeDecision.orderedProviders;
    const routeScoreOrder = routeDecision.trace.scoreOrder
      .map((entry) => `${entry.name}:${entry.score.toFixed(2)}`)
      .join(",");
    const routeCircuitSkipped = routeDecision.trace.circuitSkipped
      .map((entry) => `${entry.name}@${String(entry.reopenAtMs)}`)
      .join(",");
    input.writeStderr(
      `[runtime-route] event=decision sticky=${routeDecision.trace.stickyProvider ?? "<none>"} sticky_hit=${routeDecision.trace.stickyHit ? "true" : "false"} sticky_reason=${routeDecision.trace.stickyReason} selected=${orderedProviders[0]?.name ?? "<none>"} score_order=${routeScoreOrder || "<none>"} circuit_skipped=${routeCircuitSkipped || "<none>"} probe=${routeDecision.trace.probeProvider ?? "<none>"} strategy=sticky+score\n`,
    );
      if (orderedProviders.length === 0) {
        const gaState = input.gaMechanismRuntime.snapshotSession(sessionKey);
        input.setGaState(gaState);
        input.updateActiveSessionGaState(gaState);
        await input.persistSessionRegistryState();
        input.writeStderr("[runtime-route] all provider circuits are OPEN; no attempt executed\n");
        return 1;
      }

        const failures: ProviderAttemptFailure[] = [];
          for (const provider of orderedProviders) {
            throwIfTurnInterrupted(turnSignal, "aborted_before_provider_attempt");
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
              let reactiveRetryCount = 0;
              let ptlRetryCount = 0;
              let activeCompactionStage: PromptCompactionStage = selectedStage;
              let turnPrompt = prompt;
                let report;
                while (true) {
                  throwIfTurnInterrupted(turnSignal, "aborted_before_gateway_turn");
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
                      abortSignal: turnSignal,
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
                  const overflow = classifyPromptOverflow(retryErrorClass, retryMessage);
                  const canUseReactiveCompaction =
                    consecutiveCompactionFailures < input.contextEngineConfig.recovery.circuitBreakerFailures;
                  if (
                    overflow.overflow &&
                    input.contextEngineConfig.reactiveOnPromptTooLong &&
                    canUseReactiveCompaction
                  ) {
                    if (reactiveRetryCount < input.contextEngineConfig.recovery.reactiveMaxRetries) {
                      const escalated = escalatePromptVariant(preparedPromptVariants, activeCompactionStage);
                      if (escalated && escalated.prompt !== turnPrompt) {
                        reactiveRetryCount += 1;
                        activeCompactionStage = escalated.stage;
                        turnPrompt = escalated.prompt;
                        input.onHistoryCompacted();
                        input.writeStderr(
                          `[context-engine] event=reactive_compact_retry provider=${provider.name} reason=${overflow.reason} stage=${activeCompactionStage} retry=${String(reactiveRetryCount)}\n`,
                        );
                        continue;
                      }
                    }
                    if (ptlRetryCount < input.contextEngineConfig.recovery.ptlMaxRetries) {
                      const truncatedPrompt = truncatePromptHeadForPtlRetry(
                        turnPrompt,
                        ptlRetryCount + 1,
                      );
                      if (truncatedPrompt !== turnPrompt) {
                        ptlRetryCount += 1;
                        turnPrompt = truncatedPrompt;
                        input.onHistoryCompacted();
                        input.writeStderr(
                          `[context-engine] event=ptl_retry provider=${provider.name} reason=${overflow.reason} retry=${String(ptlRetryCount)}\n`,
                        );
                        continue;
                      }
                    }
                    consecutiveCompactionFailures += 1;
                    input.writeStderr(
                      `[context-engine] event=reactive_compact_failed provider=${provider.name} failures=${String(consecutiveCompactionFailures)} reason=${overflow.reason}\n`,
                    );
                    if (
                      consecutiveCompactionFailures >=
                      input.contextEngineConfig.recovery.circuitBreakerFailures
                    ) {
                      input.writeStderr(
                        `[context-engine] event=circuit_open failures=${String(consecutiveCompactionFailures)} limit=${String(input.contextEngineConfig.recovery.circuitBreakerFailures)}\n`,
                      );
                    }
                  } else if (
                    overflow.overflow &&
                    input.contextEngineConfig.reactiveOnPromptTooLong &&
                    !canUseReactiveCompaction
                  ) {
                    input.writeStderr(
                      `[context-engine] event=reactive_compact_skipped reason=circuit_open failures=${String(consecutiveCompactionFailures)}\n`,
                    );
                  }
                  if (!shouldRetryProviderRequest(retryErrorClass, retryMessage, providerRetryCount)) {
                    throw error;
                  }
                  providerRetryCount += 1;
                  const backoffMs = providerRetryCount * 1_500;
                  input.writeStderr(
                    `[runtime-route] provider_retry provider=${provider.name} reason=upstream_429 retry=${String(providerRetryCount)} backoff_ms=${String(backoffMs)}\n`,
                  );
                  await sleepAsync(backoffMs, turnSignal);
                }
              }
            if (!report) {
              throw new Error("provider response missing after retry");
            }
            consecutiveCompactionFailures = 0;
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
        const runtimeAskUser = report.runtimeInterrupt?.kind === "ask_user"
          ? report.runtimeInterrupt.askUser
          : undefined;
        let assistantTextForHistory = report.assistantMessage;
        let turnStdout = interactiveMode
          ? `${report.assistantMessage}\n\n`
          : `${report.assistantMessage}\n`;
        let askUserEvent = "";
        if (runtimeAskUser) {
          const askUserEnvelope: AskUserEnvelope = {
            questionId: runtimeAskUser.questionId || `askq_${Date.now().toString(36)}`,
            blockingNodeId: runtimeAskUser.blockingNodeId || "node.unknown",
            question: runtimeAskUser.question,
            options: runtimeAskUser.options ?? [],
            defaultOnTimeout: runtimeAskUser.defaultOnTimeout || "continue_with_best_effort",
            resumeToken: runtimeAskUser.resumeToken || `resume_${Date.now().toString(36)}`,
            createdAt: runtimeAskUser.createdAt || nowIso(),
          };
          input.gaMechanismRuntime.registerPendingAsk(sessionKey, askUserEnvelope);
          assistantTextForHistory = `[ask-user] ${askUserEnvelope.question}`;
          const askUserDisplay = input.gaMechanismRuntime.buildAskUserDisplay(askUserEnvelope);
          turnStdout = interactiveMode ? `${askUserDisplay}\n` : askUserDisplay;
          askUserEvent = formatAskUserIssuedEvent(askUserEnvelope);
          input.writeStderr(
            `[ask-user] event=interrupt_received question_id=${askUserEnvelope.questionId} blocking_node_id=${askUserEnvelope.blockingNodeId}\n`,
          );
          input.writeStderr("[experience] event=publish_skipped reason=ask_user_interrupt\n");
        } else {
          input.gaMechanismRuntime.registerTurnSuccess({
            sessionKey,
            userText,
            assistantText: report.assistantMessage,
            traceId: report.traceId,
            providerName: provider.name,
            verificationPass: report.verification.pass,
          });
          const experienceEvidenceRef = {
            traceId: report.traceId,
            runId: report.requestId,
            url: extractFirstUrl(userText),
            sourceType: "turn_success",
            capturedAt: nowIso(),
          };
          const experiencePublish = input.experiencePoolRuntime.registerTurnSuccess({
            sessionKey,
            userText,
            assistantText: report.assistantMessage,
            traceId: report.traceId,
            providerName: provider.name,
            verificationPass: report.verification.pass,
            evidenceRef: experienceEvidenceRef,
          });
          if (experiencePublish.skipped) {
            input.writeStderr(
              `[experience] event=publish_skipped reason=${experiencePublish.reason ?? "unknown"} gate_verification=${experiencePublish.verificationPassed ? "pass" : "fail"} gate_evidence_ref=${experiencePublish.evidenceRefPassed ? "pass" : "fail"} gate_redaction=${experiencePublish.redactionPassed ? "pass" : "fail"}\n`,
            );
          } else {
            input.writeStderr(
              `[experience] event=published id=${experiencePublish.recordId ?? "<unknown>"} created=${experiencePublish.created ? "true" : "false"} confidence=${typeof experiencePublish.confidence === "number" ? experiencePublish.confidence.toFixed(2) : "n/a"} gate_verification=${experiencePublish.verificationPassed ? "pass" : "fail"} gate_evidence_ref=${experiencePublish.evidenceRefPassed ? "pass" : "fail"} gate_redaction=${experiencePublish.redactionPassed ? "pass" : "fail"}\n`,
            );
          }
        }
          await recordTurn(userText, assistantTextForHistory, stickyProvider, providerStates);
          input.writeStdout(turnStdout);
          if (askUserEvent.length > 0) {
            input.writeStderr(askUserEvent);
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
            const experienceFeedback = input.experiencePoolRuntime.registerTurnFailure({
              sessionKey,
              userText,
              providerName: provider.name,
              errorClass: "verification_failed",
              errorMessage: "turn verification failed",
            });
            if (experienceFeedback.matched) {
              input.writeStderr(
                `[experience] event=failure_feedback id=${experienceFeedback.recordId ?? "<unknown>"} score=${typeof experienceFeedback.score === "number" ? experienceFeedback.score.toFixed(2) : "n/a"} confidence=${typeof experienceFeedback.confidence === "number" ? experienceFeedback.confidence.toFixed(2) : "n/a"} quarantined=${experienceFeedback.quarantined ? "true" : "false"}\n`,
              );
            }
          }
          const reflections = input.gaMechanismRuntime.pullReflectionTasks(sessionKey);
          for (const task of reflections) {
            input.writeStderr(
              `[reflection] trigger=${task.triggerType} id=${task.id} next_action="${task.nextActionHint}"\n`,
            );
          }
          return report.verification.pass ? 0 : 1;
        } catch (error) {
          const rawMessage = String(error);
          const compactMessage = compactSingleLine(rawMessage, 240);
          const errorClass = resolveErrorClass(rawMessage);
            if (errorClass === TURN_INTERRUPTED_ERROR_CLASS) {
              const providerStates = Array.from(providerStateMap.values());
              input.setProviderRuntimeStates(providerStates);
              input.updateActiveSessionProviderRuntime(input.getStickyProvider(), providerStates);
              const gaState = input.gaMechanismRuntime.snapshotSession(sessionKey);
              input.setGaState(gaState);
              input.updateActiveSessionGaState(gaState);
              await input.persistSessionRegistryState();
              if (interactiveMode) {
                input.writeStdout("[interrupt] turn interrupted. You can send a new instruction.\n\n");
              } else {
                input.writeStderr("[interrupt] turn interrupted.\n");
              }
              return TURN_INTERRUPTED_EXIT_CODE;
            }
            failures.push({
              providerName: provider.name,
              errorClass,
            errorMessage: compactMessage,
          });
          input.gaMechanismRuntime.registerTurnFailure({
            sessionKey,
            providerName: provider.name,
            errorClass,
            errorMessage: compactMessage,
          });
          const experienceFeedback = input.experiencePoolRuntime.registerTurnFailure({
            sessionKey,
            userText,
            providerName: provider.name,
            errorClass,
            errorMessage: compactMessage,
          });
          if (experienceFeedback.matched) {
            input.writeStderr(
              `[experience] event=failure_feedback id=${experienceFeedback.recordId ?? "<unknown>"} score=${typeof experienceFeedback.score === "number" ? experienceFeedback.score.toFixed(2) : "n/a"} confidence=${typeof experienceFeedback.confidence === "number" ? experienceFeedback.confidence.toFixed(2) : "n/a"} quarantined=${experienceFeedback.quarantined ? "true" : "false"}\n`,
            );
          }
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
      const gaState = input.gaMechanismRuntime.snapshotSession(sessionKey);
      input.setGaState(gaState);
      input.updateActiveSessionGaState(gaState);
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
    const reflections = input.gaMechanismRuntime.pullReflectionTasks(sessionKey);
    for (const task of reflections) {
      input.writeStderr(
        `[reflection] trigger=${task.triggerType} id=${task.id} next_action="${task.nextActionHint}"\n`,
      );
    }
    return 1;
  };
}
