import { type ExecutionPlaneConfig } from "../../../execution-plane";
import { runGatewayTurn } from "../../../main";
import {
  type RuntimeAskUserInterrupt,
  type RuntimeAttachment,
  type RuntimeEvent,
  type RuntimeModelConfig,
  type RuntimeToolContext,
} from "../../../../models/types";
import { consumeInterruptFlag } from "../services/interrupt-store";
import { resolveAgentsInstructionBlock } from "../services/agents-instructions";
import { loadGrobotSystemPrompt } from "../system/gro-system-prompt";
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
  renderManagementInterruptNotice,
  renderRuntimeFailureSummary,
  renderRuntimeOpenCircuitNotice,
  renderTurnInterruptedNotice,
} from "../ui/screens/turn-screen";
import {
  renderTerminalMarkdown,
  resolveTerminalMarkdownMode,
  type TerminalMarkdownMode,
} from "../ui/interactive/terminal-markdown";
import {
  renderRuntimeActivityFeed,
  resolveRuntimeActivityFeedDetailMode,
} from "../ui/screens/activity-feed-screen";
import {
  type AskUserEnvelope,
  createAskUserTurnPromptContext,
  formatAskUserResolvedAnswerForPersistence,
  formatAskUserIssuedEvent,
} from "../../../../tools/ask-user";
import {
  adaptRuntimeToolContextForRecovery,
  buildRuntimeToolContextForMessage,
} from "../../../../tools/runtime/default-enabled-tools";
import { type MemoryOrchestrator } from "../../../../tools/memory";
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
  deriveGraphQualitySignals,
  derivePromptQualityGuardAdaptivePolicy,
  evaluatePromptQualityGuard,
  estimateTokensFromText,
  escalatePromptVariant,
  assessGraphCacheWindowDegradation,
  assessPersistentGraphWindowDegradation,
  readGraphQualityAutotuneState,
  prepareTurnPrompt,
  readContextGraphCacheStats,
  readGraphCacheWindowSummary,
  readPromptQualityGuardState,
  readPromptQualityWindowSummary,
  shouldTriggerDownshiftPrecompact,
  summarizeGraphHintQualityFromPrompt,
  trimPromptRecentTurnsForBudget,
  trimPromptSnapshotSectionsForBudget,
  truncatePromptHeadForPtlRetry,
  writeGraphQualityAutotuneState,
  writePromptQualityGuardState,
  type ContextEngineConfig,
  type GraphCacheWindowDegradation,
  type GraphQualitySignalsSummary,
  type GraphQualityAutotuneState,
  type PersistentGraphWindowDegradation,
  type PromptCompactionStage,
  type PromptVariant,
} from "../../../../tools/context";
import { readPersistentGraphIndexStatus } from "../../../../tools/context/graph/persistent-index";
import {
  readRuntimeToolSurfaceMetrics,
  recordRuntimeToolSurfaceMetrics,
  summarizeRuntimeToolEvents,
} from "../../../../tools/runtime/tool-events";
import { buildRuntimeToolRecoveryDecision } from "../../../../tools/runtime/tool-recovery-decision";
import { formatRuntimeToolRecoveryGateFields } from "../../../../tools/runtime/tool-recovery-readiness-gate";
import {
  applyRuntimeToolSurfaceAdaptationGuard,
  readRuntimeToolSurfaceAdaptationState,
  recordRuntimeToolSuccessfulRecoveryConsumption,
  recordRuntimeToolSurfaceAdaptationOutcome,
} from "../../../../tools/runtime/tool-surface-adaptation-state";
import { applyRuntimeToolRecoveryPromptFlow } from "../../../../tools/runtime/recovery-prompt-flow";
import { extractRuntimeErrorEvents } from "../../../../tools/runtime/runtime-error";

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

export interface TurnTerminalOutputSegments {
  activityFeed: string;
  assistantOutput: string;
}

export const TURN_INTERRUPTED_ERROR_CLASS = "turn_interrupted";
export const TURN_INTERRUPTED_EXIT_CODE = 130;

export function resolveRuntimeActivityFeedTranscriptEnabled(valueRaw?: string): boolean {
  const value = (valueRaw ?? "").trim().toLowerCase();
  return value === "1"
    || value === "true"
    || value === "yes"
    || value === "on"
    || value === "transcript";
}

export function buildTurnTerminalOutputSegments(input: {
  assistantMessage: string;
  interactiveMode: boolean;
  runtimeAskUser?: boolean;
  events?: readonly RuntimeEvent[];
  terminalColumns?: number;
  terminalMarkdownMode?: TerminalMarkdownMode;
  activityFeedDetailValue?: string;
  activityFeedTranscriptValue?: string;
}): TurnTerminalOutputSegments {
  const assistantMessageForTerminal = input.interactiveMode
    ? renderTerminalMarkdown({
      text: input.assistantMessage,
      mode: input.terminalMarkdownMode ?? resolveTerminalMarkdownMode(undefined),
    })
    : input.assistantMessage;
  const assistantOutput = input.interactiveMode
    ? `${assistantMessageForTerminal}\n\n`
    : `${assistantMessageForTerminal}\n`;
  if (
    !input.interactiveMode
    || input.runtimeAskUser
    || !resolveRuntimeActivityFeedTranscriptEnabled(input.activityFeedTranscriptValue)
  ) {
    return {
      activityFeed: "",
      assistantOutput,
    };
  }
  const activityFeedDetailMode = resolveRuntimeActivityFeedDetailMode(input.activityFeedDetailValue);
  const activityFeed = renderRuntimeActivityFeed({
    events: input.events ?? [],
    terminalColumns: input.terminalColumns ?? resolveInteractiveTerminalColumns(),
    detailMode: activityFeedDetailMode,
  });
  return {
    activityFeed,
    assistantOutput,
  };
}

export interface RunStartTurnExecuteOptions {
  signal?: AbortSignal;
  attachments?: RuntimeAttachment[];
  promptPrelude?: string;
  autoOpenAskUserPanel?: boolean;
  emitDiagnostics?: boolean;
  writeStdout?: (message: string) => void;
  writeStderr?: (message: string) => void;
  onTurnRecorded?(input: {
    userText: string;
    assistantText: string;
    historyAfter: ChatHistoryMessage[];
  }): Promise<void> | void;
}

export interface RunStartTurnPromptBudgetSnapshot {
  contextWindowUsageRatio?: number;
  estimatedTokens?: number;
  targetTokenLimit?: number;
}

interface CreateRunStartTurnRunnerInput {
  interruptStorePath: string;
  historyTurns: number;
  projectName: string;
  projectRoot: string;
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
  memoryOrchestrator: MemoryOrchestrator;
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
  onPromptBudgetSnapshot?(snapshot: RunStartTurnPromptBudgetSnapshot): void;
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
const PROVIDER_UPSTREAM_READ_RETRY_LIMIT = 1;
const GRAPH_AUTOTUNE_MAX_ROWS = 20;
const GRAPH_AUTOTUNE_FLIP_HOLD_TURNS = 2;
const GRAPH_AUTOTUNE_DOWNSHIFT_WARMUP_TURNS = 2;
const GRAPH_AUTOTUNE_DEFAULT_CACHE_DEGRADE_QUERY_HIT_RATE = 0.3;
const GRAPH_AUTOTUNE_DEFAULT_PERSISTENT_DEGRADE_PARSED_PER_SCANNED_MAX = 0.35;
const GRAPH_AUTOTUNE_DEFAULT_PERSISTENT_DEGRADE_REUSED_PER_SCANNED_MIN = 0.55;
const GRAPH_AUTOTUNE_DEFAULT_PERSISTENT_DEGRADE_REMOVED_PER_SCANNED_MAX = 0.2;
const GRAPH_AUTOTUNE_DEFAULT_ACTION_SCALE = 1.0;
const GRAPH_AUTOTUNE_PERSISTENT_MIN_SCANNED_FILES = 40;

interface GraphQualityAutotuneDecision {
  adjustedConfig: ContextEngineConfig;
  changed: boolean;
  action: "none" | "upshift" | "downshift" | "mixed";
  reason: string;
  suppressedBy: "none" | "flip_hold" | "downshift_warmup";
  dependencyRowsFrom: number;
  dependencyRowsTo: number;
  symbolRowsFrom: number;
  symbolRowsTo: number;
  evidenceEntries: number;
  evidenceQualityEntries: number;
  evidencePersistentEntries: number;
  graphQualitySignals: GraphQualitySignalsSummary;
  stateBefore: GraphQualityAutotuneState;
  stateAfter: GraphQualityAutotuneState;
  metrics: {
    dependencyDepth: number | null;
    dependencyMultiHopRate: number | null;
    symbolBridgeCoverageRate: number | null;
    symbolBreadthCoverageRate: number | null;
    pressureUtilization: number | null;
    pressureAutoLimitRate: number | null;
    pressureSemanticRate: number | null;
    graphCacheDegraded: boolean;
    graphCacheReason: string;
    graphCacheQueryHitRate: number | null;
    persistentDegraded: boolean;
    persistentReason: string;
    persistentParsedPerScanned: number | null;
    persistentReusedPerScanned: number | null;
    persistentRemovedPerScanned: number | null;
    adaptiveCacheThreshold: number;
    adaptiveParsedMaxThreshold: number;
    adaptiveReusedMinThreshold: number;
    adaptiveRemovedMaxThreshold: number;
    adaptiveAlpha: number;
    adaptiveSource: string;
    adaptiveUpdated: boolean;
    adaptiveUpdates: number;
    adaptiveActionScale: number;
    adaptiveActionSource: string;
    adaptiveActionUpdated: boolean;
    adaptiveActionUpdates: number;
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export function buildAskUserQueueContinuationHint(queuedExtra: number): string {
  if (queuedExtra <= 0) {
    return "";
  }
  return `还有 ${String(queuedExtra)} 个后续确认，继续选择或直接回复即可。\n`;
}

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function payloadNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveInteractiveTerminalColumns(): number | undefined {
  const stdout = process.stdout as unknown as {
    isTTY?: boolean;
    columns?: number;
  };
  if (
    stdout.isTTY
    && typeof stdout.columns === "number"
    && Number.isFinite(stdout.columns)
    && stdout.columns > 0
  ) {
    return Math.floor(stdout.columns);
  }
  return undefined;
}

function summarizeToolOutput(payload: Record<string, unknown>): string {
  const outputSummary = payload.output_summary;
  if (!outputSummary || typeof outputSummary !== "object" || Array.isArray(outputSummary)) {
    return "";
  }
  const summary = outputSummary as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of [
    "tool",
    "count",
    "limit_reached",
    "engine",
    "preferred_engine",
    "exit_code",
    "matches_count",
    "entries_count",
    "stdout_chars",
    "stderr_chars",
    "tool_content_chars",
    "error_class",
  ]) {
    const value = summary[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      parts.push(`${key}=${String(value)}`);
    }
  }
  return parts.slice(0, 8).join(" ");
}

function buildRuntimeToolTraceMemory(input: {
  events: readonly RuntimeEvent[];
  userText: string;
}): { text: string; toolCount: number; failedCount: number; deferredCount: number; turnId?: string } | undefined {
  const toolEndEvents = input.events.filter((event) => event.eventType === "tool_end");
  if (toolEndEvents.length === 0) {
    return undefined;
  }
  const failedCount = toolEndEvents.filter((event) => payloadString(event.payload, "status") === "failed").length;
  const deferredCount = toolEndEvents.filter((event) => payloadString(event.payload, "status") === "deferred").length;
  const rows = toolEndEvents.slice(0, 6).map((event) => {
    const payload = event.payload;
    const durationMs = payloadNumber(payload, "duration_ms");
    const durationLabel = typeof durationMs === "number" ? String(durationMs) : "n/a";
    const summary = summarizeToolOutput(payload);
    return [
      `tool=${payloadString(payload, "tool_name") || "unknown_tool"}`,
      `status=${payloadString(payload, "status") || "unknown"}`,
      `risk=${payloadString(payload, "risk_class") || "unknown"}`,
      `duration_ms=${durationLabel}`,
      summary ? `summary=${summary}` : "",
    ].filter(Boolean).join(" ");
  });
  const userHash = hashText(input.userText).toString(16);
  const overflow = toolEndEvents.length > rows.length
    ? `\n- omitted=${String(toolEndEvents.length - rows.length)}`
    : "";
  return {
    text: [
      `[runtime-tool-trace] user_hash=${userHash} total=${String(toolEndEvents.length)} failed=${String(failedCount)} deferred=${String(deferredCount)}`,
      ...rows.map((row) => `- ${row}`),
    ].join("\n") + overflow,
    toolCount: toolEndEvents.length,
    failedCount,
    deferredCount,
    turnId: toolEndEvents[0]?.turnId,
  };
}

function recordRuntimeToolMetricsForEvents(input: {
  workDir: string;
  events: readonly RuntimeEvent[];
  source: "runtime_turn" | "runtime_failure";
  writeStderr(message: string): void;
}): void {
  const toolEventSummary = summarizeRuntimeToolEvents(input.events);
  if (toolEventSummary.callsTotal === 0) {
    return;
  }
  const metrics = recordRuntimeToolSurfaceMetrics({
    workDir: input.workDir,
    events: input.events,
  });
  input.writeStderr(
    `[tool-metrics] event=recorded source=${input.source} calls=${String(toolEventSummary.callsTotal)} failed=${String(toolEventSummary.failedTotal)} deferred=${String(toolEventSummary.deferredTotal)} total_calls=${String(metrics.callsTotal)}\n`,
  );
  if (toolEventSummary.latestRecovery) {
    input.writeStderr(
      `[tool-recovery] stage=${toolEventSummary.latestRecovery.stage} reason=${toolEventSummary.latestRecovery.reason} action=${toolEventSummary.latestRecovery.recommendedNextAction} tool=${toolEventSummary.latestRecovery.toolName ?? "<none>"} error_class=${toolEventSummary.latestRecovery.errorClass ?? "<none>"}\n`,
    );
  }
}

function writeRuntimeToolSurfaceAdaptationOutcome(input: {
  workDir: string;
  adaptation: ReturnType<typeof adaptRuntimeToolContextForRecovery>["adaptation"];
  events: readonly RuntimeEvent[];
  verificationPass?: boolean;
  traceId?: string;
  startedAtIso?: string;
  recoveryObservedAt?: string | null;
  writeStderr(message: string): void;
}): void {
  const outcome = recordRuntimeToolSurfaceAdaptationOutcome({
    workDir: input.workDir,
    adaptation: input.adaptation,
    events: input.events,
    verificationPass: input.verificationPass,
    traceId: input.traceId,
    startedAtIso: input.startedAtIso,
    recoveryObservedAt: input.recoveryObservedAt,
  });
  if (!outcome.recorded || !outcome.record) {
    return;
  }
  input.writeStderr(
    `[tool-surface] event=adaptation_outcome profile=${outcome.record.appliedProfile} outcome=${outcome.record.outcome} reason=${outcome.record.outcomeReason} calls=${String(outcome.record.callsTotal)} failed=${String(outcome.record.failedTotal)} deferred=${String(outcome.record.deferredTotal)}\n`,
  );
}

function normalizeRuntimeAskUserId(input: {
  askId: string;
  questionKey: string;
  index: number;
  total: number;
}): string {
  const normalizedBaseId = input.askId.trim() || `askq_${Date.now().toString(36)}`;
  const normalizedQuestionKey = input.questionKey.trim();
  if (input.total <= 1) {
    return normalizedQuestionKey || normalizedBaseId;
  }
  const suffix = normalizedQuestionKey || `q${String(input.index + 1)}`;
  if (suffix === normalizedBaseId) {
    return `${normalizedBaseId}:q${String(input.index + 1)}`;
  }
  return `${normalizedBaseId}:${suffix}`;
}

function toAskUserEnvelopes(runtimeAskUser: RuntimeAskUserInterrupt): AskUserEnvelope[] {
  type NormalizedAskQuestion = {
    key: string;
    header: string;
    question: string;
    optionsDetailed: Array<{ label: string; description?: string; value: string }>;
  };
  const structuredQuestions: NormalizedAskQuestion[] = [];
  for (let index = 0; index < runtimeAskUser.questions.length; index += 1) {
    const question = runtimeAskUser.questions[index];
    if (!question) {
      continue;
    }
    const text = question.question.trim();
    if (!text) {
      continue;
    }
    const optionsDetailed: NormalizedAskQuestion["optionsDetailed"] = [];
    for (const option of question.options) {
      const label = option.label.trim();
      if (!label) {
        continue;
      }
      const description = option.description?.trim() || undefined;
      const value = (option.value ?? label).trim() || label;
      optionsDetailed.push({
        label,
        description,
        value,
      });
    }
    structuredQuestions.push({
      key: question.id.trim() || `q${String(index + 1)}`,
      header: question.header.trim() || `Question ${String(index + 1)}`,
      question: text,
      optionsDetailed,
    });
  }
  if (structuredQuestions.length === 0) {
    return [];
  }
  const normalizedResumeToken = runtimeAskUser.resumeToken
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const baseAskId = normalizedResumeToken
    ? `askq_${normalizedResumeToken}`
    : (structuredQuestions[0]?.key || `askq_${Date.now().toString(36)}`);
  const questionTotal = structuredQuestions.length;
  const envelopes: AskUserEnvelope[] = [];
  for (let index = 0; index < structuredQuestions.length; index += 1) {
    const question = structuredQuestions[index];
    if (!question) {
      continue;
    }
    envelopes.push({
      askId: normalizeRuntimeAskUserId({
        askId: baseAskId,
        questionKey: question.key,
        index,
        total: questionTotal,
      }),
      blockingNodeId: runtimeAskUser.blockingNodeId || "node.unknown",
      question: question.question,
      options: question.optionsDetailed.map((option) => option.label),
      optionsDetailed: question.optionsDetailed,
      questionKey: question.key,
      header: question.header,
      questionIndex: questionTotal > 1 ? index + 1 : undefined,
      questionTotal: questionTotal > 1 ? questionTotal : undefined,
      defaultOnTimeout: runtimeAskUser.defaultOnTimeout || "continue_with_best_effort",
      resumeToken: runtimeAskUser.resumeToken || `resume_${Date.now().toString(36)}`,
      createdAt: runtimeAskUser.createdAt || nowIso(),
    });
  }
  return envelopes;
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

function deriveFailureStageFromError(
  errorClass: string,
  message: string,
): "planning" | "implementation" | "verification" | "runtime" | "unknown" {
  const merged = `${errorClass} ${message}`.toLowerCase();
  if (/(verify|verification|assert|contract|schema|lint|typecheck|测试|验证|验收)/.test(merged)) {
    return "verification";
  }
  if (/(timeout|429|503|upstream|provider|network|socket|连接|超时|限流)/.test(merged)) {
    return "runtime";
  }
  if (/(parse|invalid|argument|option|input|prompt|intent|参数|解析|输入)/.test(merged)) {
    return "planning";
  }
  if (/(tool|shell|write|read|path|permission|command|fs|文件|目录|权限)/.test(merged)) {
    return "implementation";
  }
  return "unknown";
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

function clampGraphRows(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.min(GRAPH_AUTOTUNE_MAX_ROWS, Math.floor(value)));
}

function clampRatio(value: number, min: number, max: number, fallback = min): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function clampNumber(value: number, min: number, max: number, fallback = min): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function resolveAdaptiveLearnAlpha(args: {
  evidenceEntries: number;
  persistentEntries: number;
  pressureUtilization: number | null;
  previousAlpha: number;
}): number {
  const evidenceScore = clampRatio((args.evidenceEntries + args.persistentEntries) / 48, 0, 1);
  const pressurePenalty = typeof args.pressureUtilization === "number"
    ? clampRatio((args.pressureUtilization - 0.72) / 0.3, 0, 1)
    : 0;
  const targetAlpha = 0.12 + evidenceScore * 0.2 - pressurePenalty * 0.07;
  const blended = args.previousAlpha * 0.55 + targetAlpha * 0.45;
  return clampRatio(blended, 0.06, 0.32);
}

function blendThreshold(previous: number, observed: number, alpha: number): number {
  return previous * (1 - alpha) + observed * alpha;
}

interface GraphAdaptiveThresholdProfile {
  cacheQueryHitRateThreshold: number;
  persistentParsedPerScannedMaxThreshold: number;
  persistentReusedPerScannedMinThreshold: number;
  persistentRemovedPerScannedMaxThreshold: number;
  learnAlpha: number;
  updated: boolean;
  source: string;
  updates: number;
}

interface GraphAdaptiveActionProfile {
  scale: number;
  source: string;
  updated: boolean;
  updates: number;
}

function deriveAdaptiveGraphThresholdProfile(input: {
  state: GraphQualityAutotuneState;
  graphWindowSummary: ReturnType<typeof readGraphCacheWindowSummary>;
  persistentStatus: ReturnType<typeof readPersistentGraphIndexStatus>;
  persistentSignalsActive: boolean;
  minEvidenceEntries: number;
  pressureUtilization: number | null;
}): GraphAdaptiveThresholdProfile {
  const previousCacheThreshold = clampRatio(
    input.state.cacheDegradeQueryHitRateThreshold,
    0.08,
    0.8,
    GRAPH_AUTOTUNE_DEFAULT_CACHE_DEGRADE_QUERY_HIT_RATE,
  );
  const previousParsedMax = clampRatio(
    input.state.persistentDegradeParsedPerScannedMax,
    0.1,
    0.9,
    GRAPH_AUTOTUNE_DEFAULT_PERSISTENT_DEGRADE_PARSED_PER_SCANNED_MAX,
  );
  const previousReusedMin = clampRatio(
    input.state.persistentDegradeReusedPerScannedMin,
    0.05,
    0.95,
    GRAPH_AUTOTUNE_DEFAULT_PERSISTENT_DEGRADE_REUSED_PER_SCANNED_MIN,
  );
  const previousRemovedMax = clampRatio(
    input.state.persistentDegradeRemovedPerScannedMax,
    0.01,
    0.6,
    GRAPH_AUTOTUNE_DEFAULT_PERSISTENT_DEGRADE_REMOVED_PER_SCANNED_MAX,
  );
  const previousAlpha = clampRatio(input.state.adaptiveLearnAlpha, 0.06, 0.32);
  const persistentWindow = input.persistentStatus.window;
  const persistentEntries = persistentWindow?.entries ?? 0;
  const learnAlpha = resolveAdaptiveLearnAlpha({
    evidenceEntries: input.graphWindowSummary.entries,
    persistentEntries,
    pressureUtilization: input.pressureUtilization,
    previousAlpha,
  });
  let cacheThreshold = previousCacheThreshold;
  let parsedMaxThreshold = previousParsedMax;
  let reusedMinThreshold = previousReusedMin;
  let removedMaxThreshold = previousRemovedMax;
  let updated = false;

  const observedCacheHitRate = input.graphWindowSummary.queryHitRate;
  if (
    typeof observedCacheHitRate === "number"
    && input.graphWindowSummary.entries >= input.minEvidenceEntries
  ) {
    const observedTarget = clampRatio(observedCacheHitRate - 0.06, 0.08, 0.8);
    cacheThreshold = clampRatio(
      blendThreshold(previousCacheThreshold, observedTarget, learnAlpha),
      0.08,
      0.8,
    );
    updated = true;
  }

  const observedParsedRate = persistentWindow?.rates?.parsed_per_scanned;
  const observedReusedRate = persistentWindow?.rates?.reused_per_scanned;
  const observedRemovedRate = persistentWindow?.rates?.removed_per_scanned;
  const hasPersistentEvidence =
    input.persistentSignalsActive
    && persistentEntries >= input.minEvidenceEntries
    && (persistentWindow?.totals?.scanned_files ?? 0) >= GRAPH_AUTOTUNE_PERSISTENT_MIN_SCANNED_FILES;
  if (
    hasPersistentEvidence
    && typeof observedParsedRate === "number"
    && typeof observedReusedRate === "number"
    && typeof observedRemovedRate === "number"
  ) {
    const parsedTarget = clampRatio(observedParsedRate + 0.05, 0.1, 0.9);
    const reusedTarget = clampRatio(observedReusedRate - 0.08, 0.05, 0.95);
    const removedTarget = clampRatio(observedRemovedRate + 0.04, 0.01, 0.6);
    parsedMaxThreshold = clampRatio(
      blendThreshold(previousParsedMax, parsedTarget, learnAlpha),
      0.1,
      0.9,
    );
    reusedMinThreshold = clampRatio(
      blendThreshold(previousReusedMin, reusedTarget, learnAlpha),
      0.05,
      0.95,
    );
    removedMaxThreshold = clampRatio(
      blendThreshold(previousRemovedMax, removedTarget, learnAlpha),
      0.01,
      0.6,
    );
    updated = true;
  }

  const updates = updated ? input.state.adaptiveUpdates + 1 : input.state.adaptiveUpdates;
  return {
    cacheQueryHitRateThreshold: cacheThreshold,
    persistentParsedPerScannedMaxThreshold: parsedMaxThreshold,
    persistentReusedPerScannedMinThreshold: reusedMinThreshold,
    persistentRemovedPerScannedMaxThreshold: removedMaxThreshold,
    learnAlpha,
    updated,
    source: updated ? "adaptive_ewma" : "state_reuse",
    updates,
  };
}

function normalizeOptionalRatio(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return clampRatio(value, 0, 1, fallback);
}

function normalizeOptionalCenteredRatio(
  value: number | null | undefined,
  center: number,
  halfSpan: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || halfSpan <= 0) {
    return fallback;
  }
  const min = center - halfSpan;
  const max = center + halfSpan;
  return clampRatio((value - min) / (max - min), 0, 1, fallback);
}

function scaleGraphDelta(delta: number, scale: number): number {
  if (!Number.isFinite(delta) || delta === 0) {
    return 0;
  }
  const normalizedScale = clampRatio(scale, 0.5, 2.5, GRAPH_AUTOTUNE_DEFAULT_ACTION_SCALE);
  const sign = delta > 0 ? 1 : -1;
  const baseMagnitude = Math.abs(delta);
  const scaledRaw = baseMagnitude * normalizedScale;
  let scaledMagnitude = Math.round(scaledRaw);
  if (baseMagnitude === 1 && normalizedScale < 0.78) {
    scaledMagnitude = 0;
  }
  scaledMagnitude = Math.max(0, Math.min(3, scaledMagnitude));
  return sign * scaledMagnitude;
}

function deriveAdaptiveGraphActionProfile(input: {
  state: GraphQualityAutotuneState;
  graphWindowSummary: ReturnType<typeof readGraphCacheWindowSummary>;
  graphWindowDegradation: GraphCacheWindowDegradation;
  persistentWindowDegradation: PersistentGraphWindowDegradation;
  graphQualitySignals: GraphQualitySignalsSummary;
  promptQualityWindowSummary: ReturnType<typeof readPromptQualityWindowSummary>;
  minEvidenceEntries: number;
}): GraphAdaptiveActionProfile {
  const previousScale = clampRatio(
    input.state.adaptiveActionScale,
    0.5,
    2.5,
    GRAPH_AUTOTUNE_DEFAULT_ACTION_SCALE,
  );
  const evidenceEntries = input.graphWindowSummary.entries;
  const evidenceQualityEntries = input.graphWindowSummary.quality.entriesWithQuality;
  if (evidenceEntries < input.minEvidenceEntries || evidenceQualityEntries < input.minEvidenceEntries) {
    return {
      scale: previousScale,
      source: "state_reuse",
      updated: false,
      updates: input.state.adaptiveActionUpdates,
    };
  }

  const dependencyDepth = input.graphWindowSummary.quality.dependency.avgMaxChainDepth;
  const dependencyMultiHop = input.graphWindowSummary.quality.dependency.multiHopRate;
  const symbolBridge = input.graphWindowSummary.quality.symbol.bridgeCoverageRate;
  const symbolBreadth = input.graphWindowSummary.quality.symbol.breadthCoverageRate;
  const pressureUtilization = input.promptQualityWindowSummary.tokenBudget.averageUtilizationRatio;
  const pressureAutoLimitRate = input.promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate;
  const pressureSemanticRate =
    input.promptQualityWindowSummary.compressionActivity.snapshotSemanticCompressRate;
  const preSendOverflowRatio = input.promptQualityWindowSummary.signalAverages?.preSendOverflowRatio ?? null;
  const strategyOutcomes = input.promptQualityWindowSummary.strategyOutcomes;
  const hardBudgetRecoveryRate = strategyOutcomes.hardBudgetRecoveryRate;
  const qualityFirstImprovedRate = strategyOutcomes.qualityFirstImprovedRate;
  const hardBudgetFollowupDelta = strategyOutcomes.hardBudgetFollowupOverallDelta;
  const qualityFirstFollowupDelta = strategyOutcomes.qualityFirstFollowupOverallDelta;
  const strategyTransitionCount =
    (strategyOutcomes.hardBudgetTransitions ?? 0) + (strategyOutcomes.qualityFirstTransitions ?? 0);

  const dependencyScore = clampRatio(
    normalizeOptionalRatio(
      typeof dependencyDepth === "number"
        ? dependencyDepth / 4
        : null,
      0.5,
    ) * 0.45
    + normalizeOptionalRatio(dependencyMultiHop, 0.5) * 0.55,
    0,
    1,
    0.5,
  );
  const symbolScore = clampRatio(
    normalizeOptionalRatio(symbolBridge, 0.5) * 0.5
    + normalizeOptionalRatio(symbolBreadth, 0.5) * 0.5,
    0,
    1,
    0.5,
  );
  const qualityScore = clampRatio(dependencyScore * 0.55 + symbolScore * 0.45, 0, 1, 0.5);

  const utilizationPressure = normalizeOptionalRatio(
    typeof pressureUtilization === "number"
      ? (pressureUtilization - 0.62) / 0.34
      : null,
    0.5,
  );
  const pressureScore = clampRatio(
    utilizationPressure * 0.55
    + normalizeOptionalRatio(pressureAutoLimitRate, 0.35) * 0.25
    + normalizeOptionalRatio(pressureSemanticRate, 0.3) * 0.15
    + normalizeOptionalRatio(preSendOverflowRatio, 0.3) * 0.05,
    0,
    1,
    0.5,
  );
  const rewardBaseScore = clampRatio(
    normalizeOptionalRatio(input.promptQualityWindowSummary.averageScores?.overall ?? null, 0.5) * 0.4
    + (1 - normalizeOptionalRatio(input.promptQualityWindowSummary.lowQualityRate, 0.5)) * 0.24
    + normalizeOptionalRatio(hardBudgetRecoveryRate, 0.5) * 0.18
    + normalizeOptionalRatio(qualityFirstImprovedRate, 0.5) * 0.18,
    0,
    1,
    0.5,
  );
  const rewardTrendScore = clampRatio(
    normalizeOptionalCenteredRatio(hardBudgetFollowupDelta, 0, 0.2, 0.5) * 0.5
    + normalizeOptionalCenteredRatio(qualityFirstFollowupDelta, 0, 0.2, 0.5) * 0.5,
    0,
    1,
    0.5,
  );
  const rewardScore = clampRatio(rewardBaseScore * 0.72 + rewardTrendScore * 0.28, 0, 1, 0.5);
  const rewardReliability = clampRatio(0.25 + (strategyTransitionCount / 12) * 0.75, 0.25, 1, 0.25);

  let targetScale = GRAPH_AUTOTUNE_DEFAULT_ACTION_SCALE;
  if (input.graphQualitySignals.state === "degraded") {
    targetScale += 0.28;
  } else if (input.graphQualitySignals.state === "watch") {
    targetScale += 0.12;
  }
  if (input.graphWindowDegradation.degraded) {
    targetScale += 0.16;
  }
  if (input.persistentWindowDegradation.degraded) {
    targetScale -= 0.22;
  }
  if (qualityScore <= 0.42 && pressureScore <= 0.72) {
    targetScale += 0.12;
  }
  if (qualityScore >= 0.78 && pressureScore <= 0.55) {
    targetScale -= 0.08;
  }
  if (pressureScore >= 0.78) {
    targetScale -= (pressureScore - 0.78) * 0.9;
  }
  if (rewardReliability >= 0.45) {
    if (rewardScore <= 0.42) {
      targetScale += (0.42 - rewardScore) * 0.35;
    } else if (rewardScore >= 0.72) {
      targetScale -= (rewardScore - 0.72) * 0.28;
    }
  }
  if (rewardReliability >= 0.55) {
    if (rewardTrendScore <= 0.38) {
      targetScale += 0.08;
    } else if (rewardTrendScore >= 0.66 && pressureScore >= 0.7) {
      targetScale -= 0.06;
    }
  }
  targetScale = clampRatio(targetScale, 0.5, 2.5, GRAPH_AUTOTUNE_DEFAULT_ACTION_SCALE);

  const evidenceScore = clampRatio(
    (evidenceEntries + evidenceQualityEntries) / Math.max(24, input.minEvidenceEntries * 6),
    0,
    1,
  );
  const divergence = clampRatio(Math.abs(targetScale - previousScale), 0, 1.5) / 1.5;
  const learnAlpha = clampRatio(
    0.09 + evidenceScore * 0.17 + divergence * 0.11 - pressureScore * 0.07 + rewardReliability * 0.05,
    0.06,
    0.3,
    0.14,
  );
  const rawNextScale = clampRatio(
    blendThreshold(previousScale, targetScale, learnAlpha),
    0.5,
    2.5,
    GRAPH_AUTOTUNE_DEFAULT_ACTION_SCALE,
  );
  const maxDelta = clampNumber(
    0.09 + evidenceScore * 0.14 + rewardReliability * 0.07 - pressureScore * 0.05,
    0.08,
    0.28,
    0.14,
  );
  const boundedDelta = clampNumber(rawNextScale - previousScale, -maxDelta, maxDelta, 0);
  const nextScale = clampRatio(
    previousScale + boundedDelta,
    0.5,
    2.5,
    GRAPH_AUTOTUNE_DEFAULT_ACTION_SCALE,
  );
  const updated = Math.abs(nextScale - previousScale) >= 0.01;
  const boundedByGuard = Math.abs(rawNextScale - nextScale) >= 0.01;
  return {
    scale: nextScale,
    source: updated
      ? (boundedByGuard ? "adaptive_action_ewma_guarded" : "adaptive_action_ewma")
      : "state_reuse",
    updated,
    updates: updated ? input.state.adaptiveActionUpdates + 1 : input.state.adaptiveActionUpdates,
  };
}

function normalizePathForPrefix(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isWorkDirWithinRepoRoot(workDir: string, rootPath?: string): boolean {
  if (!rootPath || rootPath.trim().length === 0) {
    return false;
  }
  const normalizedRoot = normalizePathForPrefix(rootPath.trim());
  const normalizedWorkDir = normalizePathForPrefix(workDir.trim());
  if (!normalizedRoot || !normalizedWorkDir) {
    return false;
  }
  return normalizedWorkDir === normalizedRoot || normalizedWorkDir.startsWith(`${normalizedRoot}/`);
}

function formatOptionalMetric(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "<none>";
  }
  return value.toFixed(3);
}

function resolveGraphQualityAutotuneDecision(input: {
  baseConfig: ContextEngineConfig;
  allowProactiveCompaction: boolean;
  graphWindowSummary: ReturnType<typeof readGraphCacheWindowSummary>;
  graphWindowDegradation: GraphCacheWindowDegradation;
  persistentWindowDegradation: PersistentGraphWindowDegradation;
  graphQualitySignals: GraphQualitySignalsSummary;
  persistentSignalsActive: boolean;
  adaptiveThresholds: GraphAdaptiveThresholdProfile;
  adaptiveAction: GraphAdaptiveActionProfile;
  promptQualityWindowSummary: ReturnType<typeof readPromptQualityWindowSummary>;
  state: GraphQualityAutotuneState;
}): GraphQualityAutotuneDecision {
  const stateBefore: GraphQualityAutotuneState = {
    ...input.state,
  };
  let stateAfter: GraphQualityAutotuneState = {
    ...input.state,
  };
  const dependencyRowsFrom = clampGraphRows(input.baseConfig.dependencyGraph.maxRows);
  const symbolRowsFrom = clampGraphRows(input.baseConfig.symbolGraph.maxRows);
  const dependencyDepth = input.graphWindowSummary.quality.dependency.avgMaxChainDepth;
  const dependencyMultiHopRate = input.graphWindowSummary.quality.dependency.multiHopRate;
  const symbolBridgeCoverageRate = input.graphWindowSummary.quality.symbol.bridgeCoverageRate;
  const symbolBreadthCoverageRate = input.graphWindowSummary.quality.symbol.breadthCoverageRate;
  const pressureUtilization = input.promptQualityWindowSummary.tokenBudget.averageUtilizationRatio;
  const pressureAutoLimitRate = input.promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate;
  const pressureSemanticRate =
    input.promptQualityWindowSummary.compressionActivity.snapshotSemanticCompressRate;
  const baseDecision: GraphQualityAutotuneDecision = {
    adjustedConfig: input.baseConfig,
    changed: false,
    action: "none",
    reason: "stable",
    suppressedBy: "none",
    dependencyRowsFrom,
    dependencyRowsTo: dependencyRowsFrom,
    symbolRowsFrom,
    symbolRowsTo: symbolRowsFrom,
    evidenceEntries: input.graphWindowSummary.entries,
    evidenceQualityEntries: input.graphWindowSummary.quality.entriesWithQuality,
    evidencePersistentEntries: input.persistentWindowDegradation.observedEntries,
    graphQualitySignals: input.graphQualitySignals,
    stateBefore,
    stateAfter,
    metrics: {
      dependencyDepth,
      dependencyMultiHopRate,
      symbolBridgeCoverageRate,
      symbolBreadthCoverageRate,
      pressureUtilization,
      pressureAutoLimitRate,
      pressureSemanticRate,
      graphCacheDegraded: input.graphWindowDegradation.degraded,
      graphCacheReason: input.graphWindowDegradation.reason,
      graphCacheQueryHitRate: input.graphWindowDegradation.observedQueryHitRate,
      persistentDegraded: input.persistentWindowDegradation.degraded,
      persistentReason: input.persistentWindowDegradation.reason,
      persistentParsedPerScanned: input.persistentWindowDegradation.observedParsedPerScanned,
      persistentReusedPerScanned: input.persistentWindowDegradation.observedReusedPerScanned,
      persistentRemovedPerScanned: input.persistentWindowDegradation.observedRemovedPerScanned,
      adaptiveCacheThreshold: input.adaptiveThresholds.cacheQueryHitRateThreshold,
      adaptiveParsedMaxThreshold: input.adaptiveThresholds.persistentParsedPerScannedMaxThreshold,
      adaptiveReusedMinThreshold: input.adaptiveThresholds.persistentReusedPerScannedMinThreshold,
      adaptiveRemovedMaxThreshold: input.adaptiveThresholds.persistentRemovedPerScannedMaxThreshold,
      adaptiveAlpha: input.adaptiveThresholds.learnAlpha,
      adaptiveSource: input.adaptiveThresholds.source,
      adaptiveUpdated: input.adaptiveThresholds.updated,
      adaptiveUpdates: input.adaptiveThresholds.updates,
      adaptiveActionScale: input.adaptiveAction.scale,
      adaptiveActionSource: input.adaptiveAction.source,
      adaptiveActionUpdated: input.adaptiveAction.updated,
      adaptiveActionUpdates: input.adaptiveAction.updates,
    },
  };

  const applyStateNoAction = (reason: string): GraphQualityAutotuneDecision => {
    stateAfter = {
      ...stateAfter,
      holdTurnsRemaining: Math.max(0, stateAfter.holdTurnsRemaining - 1),
      downshiftWarmupStreak: 0,
      lastReason: reason,
      updatedAt: nowIso(),
    };
    return {
      ...baseDecision,
      reason,
      stateAfter,
    };
  };

  if (!input.allowProactiveCompaction || !input.baseConfig.enabled) {
    return applyStateNoAction("disabled");
  }
  if (!input.baseConfig.dependencyGraph.enabled && !input.baseConfig.symbolGraph.enabled) {
    return applyStateNoAction("graph_disabled");
  }
  const minEvidenceEntries = Math.max(
    2,
    Math.min(64, input.baseConfig.promptQuality?.degradeMinEntries ?? 8),
  );
  const hasGraphEvidence =
    input.graphWindowSummary.entries >= minEvidenceEntries
    && input.graphWindowSummary.quality.entriesWithQuality >= minEvidenceEntries;
  const hasPersistentEvidence =
    input.persistentSignalsActive
    && input.persistentWindowDegradation.observedEntries >= minEvidenceEntries
    && input.persistentWindowDegradation.observedScannedFiles
      >= input.persistentWindowDegradation.minScannedFiles;
  if (
    !hasGraphEvidence
    && !hasPersistentEvidence
  ) {
    return applyStateNoAction("insufficient_evidence");
  }

  const highPressure =
    (typeof pressureUtilization === "number" && pressureUtilization >= 0.92)
    || (typeof pressureAutoLimitRate === "number" && pressureAutoLimitRate >= 0.45)
    || (typeof pressureSemanticRate === "number" && pressureSemanticRate >= 0.55);
  const lowDependencyDepth = typeof dependencyDepth === "number" && dependencyDepth < 2.4;
  const veryLowDependencyDepth = typeof dependencyDepth === "number" && dependencyDepth < 1.8;
  const lowDependencyMultiHop =
    typeof dependencyMultiHopRate === "number" && dependencyMultiHopRate < 0.22;
  const veryLowDependencyMultiHop =
    typeof dependencyMultiHopRate === "number" && dependencyMultiHopRate < 0.10;
  const poorDependency = lowDependencyDepth || lowDependencyMultiHop;
  const severeDependency = veryLowDependencyDepth || veryLowDependencyMultiHop;
  const strongDependency =
    typeof dependencyDepth === "number"
    && dependencyDepth >= 3.2
    && typeof dependencyMultiHopRate === "number"
    && dependencyMultiHopRate >= 0.45;

  const lowSymbolBridge =
    typeof symbolBridgeCoverageRate === "number" && symbolBridgeCoverageRate < 0.58;
  const veryLowSymbolBridge =
    typeof symbolBridgeCoverageRate === "number" && symbolBridgeCoverageRate < 0.35;
  const lowSymbolBreadth =
    typeof symbolBreadthCoverageRate === "number" && symbolBreadthCoverageRate < 0.55;
  const veryLowSymbolBreadth =
    typeof symbolBreadthCoverageRate === "number" && symbolBreadthCoverageRate < 0.35;
  const poorSymbol = lowSymbolBridge || lowSymbolBreadth;
  const severeSymbol = veryLowSymbolBridge || veryLowSymbolBreadth;
  const strongSymbol =
    typeof symbolBridgeCoverageRate === "number"
    && symbolBridgeCoverageRate >= 0.78
    && typeof symbolBreadthCoverageRate === "number"
    && symbolBreadthCoverageRate >= 0.74;

  let dependencyDelta = 0;
  let symbolDelta = 0;
  const reasonParts: string[] = [];

  if (input.baseConfig.dependencyGraph.enabled && poorDependency) {
    dependencyDelta += severeDependency ? 2 : 1;
    reasonParts.push("dependency_low_quality");
  }
  if (input.baseConfig.symbolGraph.enabled && poorSymbol) {
    symbolDelta += severeSymbol ? 2 : 1;
    reasonParts.push("symbol_low_quality");
  }
  if (highPressure) {
    reasonParts.push("token_pressure");
    if (strongDependency && input.baseConfig.dependencyGraph.enabled) {
      dependencyDelta -= 1;
    }
    if (strongSymbol && input.baseConfig.symbolGraph.enabled) {
      symbolDelta -= 1;
    }
    dependencyDelta = Math.min(dependencyDelta, 1);
    symbolDelta = Math.min(symbolDelta, 1);
  }
  if (input.persistentSignalsActive) {
    if (input.persistentWindowDegradation.degraded) {
      reasonParts.push("persistent_churn");
      dependencyDelta = Math.min(dependencyDelta, 0);
      symbolDelta = Math.min(symbolDelta, 0);
      const parsedRate = input.persistentWindowDegradation.observedParsedPerScanned;
      const reusedRate = input.persistentWindowDegradation.observedReusedPerScanned;
      const removedRate = input.persistentWindowDegradation.observedRemovedPerScanned;
      const severePersistent =
        (typeof parsedRate === "number" && parsedRate >= 0.6)
        || (typeof reusedRate === "number" && reusedRate <= 0.4)
        || (typeof removedRate === "number" && removedRate >= 0.3);
      if (severePersistent) {
        dependencyDelta -= 1;
        symbolDelta -= 1;
      }
    } else {
      const lowPressure =
        (typeof pressureUtilization !== "number" || pressureUtilization <= 0.75)
        && (typeof pressureAutoLimitRate !== "number" || pressureAutoLimitRate <= 0.2)
        && (typeof pressureSemanticRate !== "number" || pressureSemanticRate <= 0.3);
      const persistentStrong =
        typeof input.persistentWindowDegradation.observedReusedPerScanned === "number"
        && input.persistentWindowDegradation.observedReusedPerScanned >= 0.75
        && typeof input.persistentWindowDegradation.observedParsedPerScanned === "number"
        && input.persistentWindowDegradation.observedParsedPerScanned <= 0.25
        && typeof input.persistentWindowDegradation.observedRemovedPerScanned === "number"
        && input.persistentWindowDegradation.observedRemovedPerScanned <= 0.08;
      if (lowPressure && persistentStrong && strongDependency && strongSymbol) {
        reasonParts.push("stable_quality_compact");
        dependencyDelta -= 1;
        symbolDelta -= 1;
      }
    }
  }
  if (input.graphQualitySignals.state === "degraded") {
    reasonParts.push("graph_signals_degraded");
    dependencyDelta = Math.min(dependencyDelta, 0) - (input.baseConfig.dependencyGraph.enabled ? 1 : 0);
    symbolDelta = Math.min(symbolDelta, 0) - (input.baseConfig.symbolGraph.enabled ? 1 : 0);
  } else if (input.graphQualitySignals.state === "watch") {
    reasonParts.push("graph_signals_watch");
    dependencyDelta = Math.min(dependencyDelta, 1);
    symbolDelta = Math.min(symbolDelta, 1);
  }

  if (Math.abs(input.adaptiveAction.scale - GRAPH_AUTOTUNE_DEFAULT_ACTION_SCALE) >= 0.08) {
    reasonParts.push(
      input.adaptiveAction.scale > GRAPH_AUTOTUNE_DEFAULT_ACTION_SCALE
        ? "adaptive_action_expand"
        : "adaptive_action_compact",
    );
  }

  dependencyDelta = scaleGraphDelta(dependencyDelta, input.adaptiveAction.scale);
  symbolDelta = scaleGraphDelta(symbolDelta, input.adaptiveAction.scale);

  const dependencyRowsTo = input.baseConfig.dependencyGraph.enabled
    ? clampGraphRows(dependencyRowsFrom + dependencyDelta)
    : dependencyRowsFrom;
  const symbolRowsTo = input.baseConfig.symbolGraph.enabled
    ? clampGraphRows(symbolRowsFrom + symbolDelta)
    : symbolRowsFrom;

  const candidateChanged = dependencyRowsTo !== dependencyRowsFrom || symbolRowsTo !== symbolRowsFrom;
  const candidateRaised = dependencyRowsTo > dependencyRowsFrom || symbolRowsTo > symbolRowsFrom;
  const candidateLowered = dependencyRowsTo < dependencyRowsFrom || symbolRowsTo < symbolRowsFrom;
  const candidateAction: GraphQualityAutotuneDecision["action"] = !candidateChanged
    ? "none"
    : candidateRaised && candidateLowered
      ? "mixed"
      : candidateRaised
        ? "upshift"
        : "downshift";
  const candidateDirection = candidateAction;

  let suppressedBy: GraphQualityAutotuneDecision["suppressedBy"] = "none";
  if (candidateChanged) {
    const reversal =
      (candidateDirection === "upshift" && stateAfter.lastDirection === "downshift")
      || (candidateDirection === "downshift" && stateAfter.lastDirection === "upshift");
    if (reversal && stateAfter.holdTurnsRemaining > 0) {
      suppressedBy = "flip_hold";
    } else if (candidateDirection === "downshift") {
      const nextWarmupStreak = stateAfter.downshiftWarmupStreak + 1;
      stateAfter.downshiftWarmupStreak = nextWarmupStreak;
      if (nextWarmupStreak < GRAPH_AUTOTUNE_DOWNSHIFT_WARMUP_TURNS) {
        suppressedBy = "downshift_warmup";
      }
    } else {
      stateAfter.downshiftWarmupStreak = 0;
    }
  } else {
    stateAfter.downshiftWarmupStreak = 0;
  }

  const changed = candidateChanged && suppressedBy === "none";
  const finalDependencyRowsTo = changed ? dependencyRowsTo : dependencyRowsFrom;
  const finalSymbolRowsTo = changed ? symbolRowsTo : symbolRowsFrom;
  const finalAction: GraphQualityAutotuneDecision["action"] = changed ? candidateAction : "none";
  const reason = reasonParts.length > 0 ? reasonParts.join("+") : "stable";
  const finalReason = suppressedBy === "none" ? reason : `${reason}+${suppressedBy}`;

  if (changed) {
    stateAfter = {
      ...stateAfter,
      lastDirection: candidateDirection,
      holdTurnsRemaining: GRAPH_AUTOTUNE_FLIP_HOLD_TURNS,
      downshiftWarmupStreak: 0,
      lastReason: finalReason,
      updatedAt: nowIso(),
    };
  } else {
    stateAfter = {
      ...stateAfter,
      holdTurnsRemaining: Math.max(0, stateAfter.holdTurnsRemaining - 1),
      lastReason: finalReason,
      updatedAt: nowIso(),
    };
  }

  const adjustedConfig: ContextEngineConfig = {
    ...input.baseConfig,
    dependencyGraph: {
      ...input.baseConfig.dependencyGraph,
      maxRows: finalDependencyRowsTo,
    },
    symbolGraph: {
      ...input.baseConfig.symbolGraph,
      maxRows: finalSymbolRowsTo,
    },
  };

  return {
    ...baseDecision,
    adjustedConfig,
    changed,
    action: finalAction,
    reason: finalReason,
    suppressedBy,
    dependencyRowsTo: finalDependencyRowsTo,
    symbolRowsTo: finalSymbolRowsTo,
    stateAfter,
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
  if (errorClass === "upstream_http_error") {
    if (retryCount >= PROVIDER_UPSTREAM_429_RETRY_LIMIT) {
      return false;
    }
    return errorMessage.includes("status=429");
  }
  if (errorClass === "upstream_response_read_failed") {
    return retryCount < PROVIDER_UPSTREAM_READ_RETRY_LIMIT;
  }
  return false;
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

export function createRunStartTurnRunner(baseInput: CreateRunStartTurnRunnerInput) {
  const providerFlowStateMap = new Map<string, ProviderFlowState>();
  const grobotSystemPrompt = loadGrobotSystemPrompt();
  let consecutiveCompactionFailures = 0;
  let previousTargetTokenLimit: number | undefined;

  const recordTurn = async (
    userText: string,
    assistantText: string,
    stickyProvider: string | undefined,
    providerRuntimeStates: readonly SessionProviderRuntimeState[],
    onTurnRecorded?: (input: {
      userText: string;
      assistantText: string;
      historyAfter: ChatHistoryMessage[];
    }) => Promise<void> | void,
  ): Promise<void> => {
    const historyMessages = baseInput.getHistoryMessages();
    const nextHistory = [
      ...historyMessages,
      { role: "user", content: userText } as ChatHistoryMessage,
      { role: "assistant", content: assistantText } as ChatHistoryMessage,
    ];
    const trimmed = trimHistoryMessages(nextHistory, baseInput.historyTurns);
    if (trimmed.length < nextHistory.length) {
      baseInput.onHistoryCompacted();
    }
    baseInput.setHistoryMessages(trimmed);
    await baseInput.persistHistoryState();
    if (onTurnRecorded) {
      await onTurnRecorded({
        userText,
        assistantText,
        historyAfter: [...trimmed],
      });
    }
    const gaState = baseInput.gaMechanismRuntime.snapshotSession(baseInput.getSessionKey());
    baseInput.setGaState(gaState);
    baseInput.updateActiveSessionProviderRuntime(stickyProvider, providerRuntimeStates);
    baseInput.updateActiveSessionGaState(gaState);
    baseInput.touchActiveSession(userText);
    await baseInput.persistSessionRegistryState();
  };

  return async (
    userText: string,
    interactiveMode: boolean,
    options?: RunStartTurnExecuteOptions,
  ): Promise<number> => {
    const input =
      typeof options?.writeStdout === "function"
      || typeof options?.writeStderr === "function"
        ? {
          ...baseInput,
          writeStdout: options.writeStdout ?? baseInput.writeStdout,
          writeStderr: options.writeStderr ?? baseInput.writeStderr,
        }
        : baseInput;
    const turnSignal = options?.signal;
    const runtimeAttachments = options?.attachments;
    const emitTerminalDiagnostics = interactiveMode || options?.emitDiagnostics === true;
    const writeTurnDiagnostic = (message: string): void => {
      if (emitTerminalDiagnostics) {
        input.writeStderr(message);
      }
    };
    const writeTurnDiagnosticEvents = (events: readonly string[]): void => {
      if (!emitTerminalDiagnostics) {
        return;
      }
      for (const event of events) {
        input.writeStderr(event);
      }
    };
    throwIfTurnInterrupted(turnSignal, "aborted_before_turn_start");
    const sessionKey = input.getSessionKey();
    input.gaMechanismRuntime.hydrateSession(sessionKey, input.getGaState());
    const parsedSession = parseSessionKeyPartsLoose(sessionKey);
    if (!parsedSession) {
      const gaState = input.gaMechanismRuntime.snapshotSession(sessionKey);
      input.setGaState(gaState);
      input.updateActiveSessionGaState(gaState);
      await input.persistSessionRegistryState();
      input.writeStderr(`error: invalid active session key: ${sessionKey}\n`);
      return 1;
    }
    const askUserTurnContext = createAskUserTurnPromptContext({
      runtime: input.gaMechanismRuntime,
      sessionKey,
      userText,
    });
    const turnUserText = askUserTurnContext.safeUserText;
    if (askUserTurnContext.hasSecretAnswers) {
      writeTurnDiagnostic(
        `[ask-user] event=secret_answer_redacted count=${String(askUserTurnContext.secretAnswerCount)} surfaces=history,memory,logs\n`,
      );
    }
    baseInput.touchActiveSession(turnUserText);
    const [sessionPlatformRaw, sessionTenant, sessionScopeRaw, sessionSubject] = parsedSession;
      if (consumeInterruptFlag(input.interruptStorePath, sessionKey)) {
        input.writeStdout(renderManagementInterruptNotice(interactiveMode));
        return 0;
      }
      if (askUserTurnContext.resolvedEvent.length > 0) {
        writeTurnDiagnostic(askUserTurnContext.resolvedEvent);
        for (const resolvedAsk of askUserTurnContext.resolvedAsks) {
          const safeAnswer = formatAskUserResolvedAnswerForPersistence(resolvedAsk);
          const ingestResult = input.memoryOrchestrator.ingest({
            eventType: "ask_user_resolved",
            sessionKey,
            text:
              `[ask-user-resolved] question=${resolvedAsk.envelope.question} answer=${safeAnswer} blocking_node=${resolvedAsk.envelope.blockingNodeId}`,
            executionVerified: true,
            evidenceRef: {
              source: `ask_user:${resolvedAsk.envelope.askId}`,
            },
            tags: ["ask_user", "clarification"],
            confidence: 0.82,
          });
          writeTurnDiagnosticEvents(ingestResult.stderrEvents);
        }
      }
      if (askUserTurnContext.pendingNextAsk) {
        const activeAskEnvelope = askUserTurnContext.pendingNextAsk;
        const queueDepth = askUserTurnContext.queueSizeAfterResolve;
        const askUserDisplay = interactiveMode
          ? options?.autoOpenAskUserPanel
            ? ""
            : "需要你的输入 · Enter 打开选择\n\n"
          : input.gaMechanismRuntime.buildAskUserDisplay(activeAskEnvelope);
        const turnStdout = askUserDisplay;
        await recordTurn(
          turnUserText,
          `需要确认：${activeAskEnvelope.question}`,
          input.getStickyProvider(),
          input.getProviderRuntimeStates(),
          options?.onTurnRecorded,
        );
        input.writeStdout(turnStdout);
        writeTurnDiagnostic(
          `[ask-user] event=awaiting_more_answers remaining=${String(queueDepth)} active_ask_id=${activeAskEnvelope.askId}\n`,
        );
        writeTurnDiagnostic("[experience] event=publish_skipped reason=ask_user_pending_followup\n");
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
      const promptQualityConfig = input.contextEngineConfig.promptQuality;
      const promptQualityWindowSummary = readPromptQualityWindowSummary({
        workDir: input.workDir,
        size: Math.max(
          20,
          Math.min(256, promptQualityConfig?.degradeMinEntries ?? 8),
        ),
        lowQualityThreshold: promptQualityConfig?.lowQualityThreshold,
      });
      const graphAutotuneWindowSize = Math.max(
        8,
        Math.min(128, (promptQualityConfig?.degradeMinEntries ?? 8) * 4),
      );
      const graphWindowSummary = readGraphCacheWindowSummary({
        workDir: input.workDir,
        size: graphAutotuneWindowSize,
      });
      const persistentGraphStatus = readPersistentGraphIndexStatus({
        workDir: input.workDir,
        windowSize: graphAutotuneWindowSize,
      });
      const persistentSignalsActive = isWorkDirWithinRepoRoot(
        input.workDir,
        typeof persistentGraphStatus.root_path === "string"
          ? persistentGraphStatus.root_path
          : undefined,
      );
      const minGraphEvidenceEntries = Math.max(2, promptQualityConfig?.degradeMinEntries ?? 8);
      const graphAutotuneState = readGraphQualityAutotuneState({
        workDir: input.workDir,
      });
      const adaptiveThresholds = deriveAdaptiveGraphThresholdProfile({
        state: graphAutotuneState,
        graphWindowSummary,
        persistentStatus: persistentSignalsActive ? persistentGraphStatus : { enabled: false },
        persistentSignalsActive,
        minEvidenceEntries: minGraphEvidenceEntries,
        pressureUtilization: promptQualityWindowSummary.tokenBudget.averageUtilizationRatio,
      });
      const graphWindowDegradation = assessGraphCacheWindowDegradation({
        summary: graphWindowSummary,
        thresholdQueryHitRate: adaptiveThresholds.cacheQueryHitRateThreshold,
        minEntries: minGraphEvidenceEntries,
      });
      const persistentWindowDegradation = assessPersistentGraphWindowDegradation({
        status: persistentSignalsActive ? persistentGraphStatus : { enabled: false },
        thresholdParsedPerScannedMax: adaptiveThresholds.persistentParsedPerScannedMaxThreshold,
        thresholdReusedPerScannedMin: adaptiveThresholds.persistentReusedPerScannedMinThreshold,
        thresholdRemovedPerScannedMax: adaptiveThresholds.persistentRemovedPerScannedMaxThreshold,
        minEntries: minGraphEvidenceEntries,
        minScannedFiles: GRAPH_AUTOTUNE_PERSISTENT_MIN_SCANNED_FILES,
      });
      const graphQualitySignals = deriveGraphQualitySignals({
        cacheWindow: graphWindowDegradation,
        persistentWindow: persistentWindowDegradation,
      });
      const adaptiveAction = deriveAdaptiveGraphActionProfile({
        state: graphAutotuneState,
        graphWindowSummary,
        graphWindowDegradation,
        persistentWindowDegradation,
        graphQualitySignals,
        promptQualityWindowSummary,
        minEvidenceEntries: minGraphEvidenceEntries,
      });
      const graphAutotuneDecision = resolveGraphQualityAutotuneDecision({
        baseConfig: input.contextEngineConfig,
        allowProactiveCompaction,
        graphWindowSummary,
        graphWindowDegradation,
        persistentWindowDegradation,
        graphQualitySignals,
        persistentSignalsActive,
        adaptiveThresholds,
        adaptiveAction,
        promptQualityWindowSummary,
        state: graphAutotuneState,
      });
      const graphAutotuneStatePersisted: GraphQualityAutotuneState = {
        ...graphAutotuneDecision.stateAfter,
        cacheDegradeQueryHitRateThreshold: adaptiveThresholds.cacheQueryHitRateThreshold,
        persistentDegradeParsedPerScannedMax:
          adaptiveThresholds.persistentParsedPerScannedMaxThreshold,
        persistentDegradeReusedPerScannedMin:
          adaptiveThresholds.persistentReusedPerScannedMinThreshold,
        persistentDegradeRemovedPerScannedMax:
          adaptiveThresholds.persistentRemovedPerScannedMaxThreshold,
        adaptiveLearnAlpha: adaptiveThresholds.learnAlpha,
        adaptiveUpdates: adaptiveThresholds.updates,
        adaptiveSource: adaptiveThresholds.source,
        adaptiveActionScale: adaptiveAction.scale,
        adaptiveActionUpdates: adaptiveAction.updates,
        adaptiveActionSource: adaptiveAction.source,
      };
      writeGraphQualityAutotuneState({
        workDir: input.workDir,
        state: graphAutotuneStatePersisted,
      });
      if (graphAutotuneDecision.changed || graphAutotuneDecision.suppressedBy !== "none") {
        input.writeStderr(
          `[context-engine] event=graph_quality_autotune action=${graphAutotuneDecision.action} reason=${graphAutotuneDecision.reason} suppressed=${graphAutotuneDecision.suppressedBy} dep_rows=${String(graphAutotuneDecision.dependencyRowsFrom)}->${String(graphAutotuneDecision.dependencyRowsTo)} symbol_rows=${String(graphAutotuneDecision.symbolRowsFrom)}->${String(graphAutotuneDecision.symbolRowsTo)} entries=${String(graphAutotuneDecision.evidenceEntries)} quality_entries=${String(graphAutotuneDecision.evidenceQualityEntries)} persistent_entries=${String(graphAutotuneDecision.evidencePersistentEntries)} hold=${String(graphAutotuneDecision.stateBefore.holdTurnsRemaining)}->${String(graphAutotuneDecision.stateAfter.holdTurnsRemaining)} direction=${graphAutotuneDecision.stateBefore.lastDirection}->${graphAutotuneDecision.stateAfter.lastDirection} downshift_warmup=${String(graphAutotuneDecision.stateBefore.downshiftWarmupStreak)}->${String(graphAutotuneDecision.stateAfter.downshiftWarmupStreak)} dep_depth=${formatOptionalMetric(graphAutotuneDecision.metrics.dependencyDepth)} dep_multi_hop=${formatOptionalMetric(graphAutotuneDecision.metrics.dependencyMultiHopRate)} symbol_bridge=${formatOptionalMetric(graphAutotuneDecision.metrics.symbolBridgeCoverageRate)} symbol_breadth=${formatOptionalMetric(graphAutotuneDecision.metrics.symbolBreadthCoverageRate)} pressure_utilization=${formatOptionalMetric(graphAutotuneDecision.metrics.pressureUtilization)} pressure_auto_limit=${formatOptionalMetric(graphAutotuneDecision.metrics.pressureAutoLimitRate)} pressure_semantic=${formatOptionalMetric(graphAutotuneDecision.metrics.pressureSemanticRate)} cache_guard=${graphAutotuneDecision.metrics.graphCacheDegraded ? "degraded" : "ok"}:${graphAutotuneDecision.metrics.graphCacheReason} cache_query_hit_rate=${formatOptionalMetric(graphAutotuneDecision.metrics.graphCacheQueryHitRate)} persistent_guard=${graphAutotuneDecision.metrics.persistentDegraded ? "degraded" : "ok"}:${graphAutotuneDecision.metrics.persistentReason} persistent_rates=${formatOptionalMetric(graphAutotuneDecision.metrics.persistentParsedPerScanned)}/${formatOptionalMetric(graphAutotuneDecision.metrics.persistentReusedPerScanned)}/${formatOptionalMetric(graphAutotuneDecision.metrics.persistentRemovedPerScanned)} graph_signal_state=${graphAutotuneDecision.graphQualitySignals.state} graph_signal_reason=${graphAutotuneDecision.graphQualitySignals.reason} adaptive_threshold_source=${graphAutotuneDecision.metrics.adaptiveSource} adaptive_updated=${graphAutotuneDecision.metrics.adaptiveUpdated ? "true" : "false"} adaptive_alpha=${graphAutotuneDecision.metrics.adaptiveAlpha.toFixed(3)} adaptive_updates=${String(graphAutotuneDecision.metrics.adaptiveUpdates)} adaptive_thresholds=${graphAutotuneDecision.metrics.adaptiveCacheThreshold.toFixed(3)}/${graphAutotuneDecision.metrics.adaptiveParsedMaxThreshold.toFixed(3)}/${graphAutotuneDecision.metrics.adaptiveReusedMinThreshold.toFixed(3)}/${graphAutotuneDecision.metrics.adaptiveRemovedMaxThreshold.toFixed(3)} adaptive_action_source=${graphAutotuneDecision.metrics.adaptiveActionSource} adaptive_action_updated=${graphAutotuneDecision.metrics.adaptiveActionUpdated ? "true" : "false"} adaptive_action_scale=${graphAutotuneDecision.metrics.adaptiveActionScale.toFixed(3)} adaptive_action_updates=${String(graphAutotuneDecision.metrics.adaptiveActionUpdates)}\n`,
        );
      }
      const graphCacheStatsBefore = readContextGraphCacheStats();
      const promptPreparation = prepareTurnPrompt({
        userText: turnUserText,
        historyMessages,
        historyTurns: input.historyTurns,
        workDir: input.workDir,
        config: {
          ...graphAutotuneDecision.adjustedConfig,
          enabled: allowProactiveCompaction,
        },
      });
      let selectedStage = promptPreparation.selected.stage;
      let basePrompt = promptPreparation.selected.prompt;
      let selectionReason: "threshold" | "budget_guard" = promptPreparation.selectionReason;
      const targetTokenLimit = promptPreparation.targetTokenLimit;
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
      const memoryInject = input.memoryOrchestrator.injectContext({
        sessionKey,
        userText: turnUserText,
        targetTokenLimit,
        tenant: sessionTenant,
        user: sessionSubject,
        includeLineage: input.contextEngineConfig.lineage.enabled,
        lineageMaxRows: input.contextEngineConfig.lineage.maxRows,
        lineageMaxCommits: input.contextEngineConfig.lineage.maxCommits,
        lineageCacheTtlMs: input.contextEngineConfig.lineage.cacheTtlMs,
        workDir: input.workDir,
      });
      writeTurnDiagnosticEvents(memoryInject.stderrEvents);
      const agentsInstructions = resolveAgentsInstructionBlock({
        projectRoot: input.projectRoot,
        workDir: input.workDir,
      });
      const promptPrelude = options?.promptPrelude?.trim();
      const promptParts = [
        ...(agentsInstructions.block ? [agentsInstructions.block] : []),
        ...(promptPrelude ? [promptPrelude] : []),
        ...askUserTurnContext.promptParts,
        ...memoryInject.promptParts,
      ];
      const runtimeToolSurfaceMetrics = readRuntimeToolSurfaceMetrics(input.workDir);
      const runtimeToolSurfaceAdaptationSnapshot = readRuntimeToolSurfaceAdaptationState(input.workDir);
      const runtimeToolSurfaceAdaptationStartedAtIso = nowIso();
      const runtimeToolRecoveryDecision = buildRuntimeToolRecoveryDecision({
        metrics: runtimeToolSurfaceMetrics,
        adaptationSnapshot: runtimeToolSurfaceAdaptationSnapshot,
        nowMs: Date.parse(runtimeToolSurfaceAdaptationStartedAtIso),
      });
      const runtimeToolRecoveryFeedback = runtimeToolRecoveryDecision.feedback;
      const runtimeToolRecoveryGate = runtimeToolRecoveryDecision.gate;
      const baseRuntimeToolContextForTurn = buildRuntimeToolContextForMessage(input.runtimeToolContext, turnUserText);
      const rawRuntimeToolContextForTurn = adaptRuntimeToolContextForRecovery({
        context: baseRuntimeToolContextForTurn,
        recoveryFeedback: runtimeToolRecoveryFeedback,
        recoveryGate: runtimeToolRecoveryGate,
        userMessage: turnUserText,
      });
      const runtimeToolContextForTurn = applyRuntimeToolSurfaceAdaptationGuard({
        baseContext: baseRuntimeToolContextForTurn,
        result: rawRuntimeToolContextForTurn,
        snapshot: runtimeToolSurfaceAdaptationSnapshot,
      });
      if (runtimeToolContextForTurn.adaptation.active) {
        input.writeStderr(
          `[tool-surface] event=adapted from=${runtimeToolContextForTurn.adaptation.fromProfile} to=${runtimeToolContextForTurn.adaptation.appliedProfile} source=${runtimeToolContextForTurn.adaptation.source ?? "<none>"} stage=${runtimeToolContextForTurn.adaptation.recoveryStage ?? "<none>"} tool=${runtimeToolContextForTurn.adaptation.recoveryToolName ?? "<none>"} error_class=${runtimeToolContextForTurn.adaptation.recoveryErrorClass ?? "<none>"} recoverable=${runtimeToolContextForTurn.adaptation.recoveryRecoverable === null ? "<unknown>" : String(runtimeToolContextForTurn.adaptation.recoveryRecoverable)} auto_adaptation_blocked=${runtimeToolContextForTurn.adaptation.autoAdaptationBlocked ? "true" : "false"}\n`,
        );
      } else if (runtimeToolContextForTurn.adaptation.autoAdaptationBlocked) {
        input.writeStderr(
          `[tool-surface] event=adaptation_blocked reason=${runtimeToolContextForTurn.adaptation.reason} from=${runtimeToolContextForTurn.adaptation.fromProfile} applied=${runtimeToolContextForTurn.adaptation.appliedProfile} recommended=${runtimeToolContextForTurn.adaptation.recommendedProfile ?? "<none>"} stage=${runtimeToolContextForTurn.adaptation.recoveryStage ?? "<none>"} tool=${runtimeToolContextForTurn.adaptation.recoveryToolName ?? "<none>"} error_class=${runtimeToolContextForTurn.adaptation.recoveryErrorClass ?? "<none>"} recoverable=${runtimeToolContextForTurn.adaptation.recoveryRecoverable === null ? "<unknown>" : String(runtimeToolContextForTurn.adaptation.recoveryRecoverable)} auto_adaptation_blocked=true\n`,
        );
        if (runtimeToolRecoveryGate.blocking) {
          input.writeStderr(
            `[tool-recovery-gate] event=blocked ${formatRuntimeToolRecoveryGateFields(runtimeToolRecoveryGate)} attention_tool=${runtimeToolRecoveryGate.attentionToolName ?? "<none>"} attention_error_class=${runtimeToolRecoveryGate.attentionErrorClass ?? "<none>"}\n`,
          );
        }
      } else if (runtimeToolContextForTurn.guard.active) {
        input.writeStderr(
          `[tool-surface] event=adaptation_guard reason=${runtimeToolContextForTurn.guard.reason} blocked_profile=${runtimeToolContextForTurn.guard.blockedProfile ?? "<none>"} matching_failures=${String(runtimeToolContextForTurn.guard.matchingFailureCount)} recent_profiles=${runtimeToolContextForTurn.guard.recentProfileSequence.join(",") || "<empty>"}\n`,
        );
      }
      const recoveryPromptFlow = applyRuntimeToolRecoveryPromptFlow({
        workDir: input.workDir,
        recoveryFeedback: runtimeToolRecoveryFeedback,
        guard: runtimeToolContextForTurn.guard,
        adaptation: runtimeToolContextForTurn.adaptation,
        nowIso: runtimeToolSurfaceAdaptationStartedAtIso,
      });
      promptParts.push(...recoveryPromptFlow.promptBlocks);
      for (const event of recoveryPromptFlow.stderrEvents) {
        input.writeStderr(event);
      }
      const mcpInstructionPrefix = input.mcpInstructionPromptPrefix?.trim() ?? "";
      const mcpInstructionDecision = shouldInjectMcpInstructionPrefix(input, turnUserText);
      const providerKind = resolvePrimaryProviderKind(input);
      const kimiMcpFirstRouteEnabled = shouldUseKimiMcpFirstRoute({
        policy: input.kimiSearchRoutingPolicy,
        providerKind,
        userText: turnUserText,
        mcpServerNames: input.mcpInstructionServerNames,
      });
      const kimiSearchRoutingPrefix = buildKimiSearchRoutingPrefix({
        policy: input.kimiSearchRoutingPolicy,
        providerKind,
        userText: turnUserText,
        mcpServerNames: input.mcpInstructionServerNames,
      });
      const askUserClarificationHint = input.gaMechanismRuntime.buildAskUserClarificationHint(
        sessionKey,
        turnUserText,
      );
      if (askUserClarificationHint.length > 0) {
        promptParts.push(askUserClarificationHint);
        writeTurnDiagnostic("[ask-user] event=clarification_hint_injected\n");
      }
      const semanticPrefetch = buildSemanticPrefetchBlock({
        enabled: input.contextEngineConfig.semanticPrefetch.enabled,
        workDir: input.workDir,
        userText: turnUserText,
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
              userText: turnUserText,
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
      const selectedUtilizationRatio = computeUtilization(
        selectedPrepared.estimatedTokens,
        promptPreparation.effectiveWindowTokens,
      );
      input.onPromptBudgetSnapshot?.({
        contextWindowUsageRatio: selectedUtilizationRatio,
        estimatedTokens: selectedPrepared.estimatedTokens,
        targetTokenLimit,
      });
      input.writeStderr(
        `[context-engine] event=prompt_prepared stage=${selectedStage} threshold_stage=${promptPreparation.thresholdStage} reason=${selectionReason} utilization=${promptPreparation.utilization.toFixed(3)} selected_utilization=${selectedUtilizationRatio.toFixed(3)} estimated_tokens=${String(selectedPrepared.estimatedTokens)} auto_compact_limit=${String(promptPreparation.autoCompactTokenLimit)} target_limit=${String(targetTokenLimit)} effective_window=${String(promptPreparation.effectiveWindowTokens)} auto_limit_triggered=${promptPreparation.autoCompactLimitTriggered ? "true" : "false"} downshift_guard=${downshiftGuardTriggered ? "true" : "false"} quality_guard=${qualityGuardActive ? "true" : "false"} pre_send_strategy=${preSendCompressionStrategy} pre_send_overflow_ratio=${preSendCompressionOverflowRatio.toFixed(3)} pre_send_pressure_score=${preSendCompressionPressureScore.toFixed(3)} pre_send_order=${preSendCompressionOrder} recent_trim_rows=${String(preSendRecentTrimRows)} snapshot_trim_sections=${String(preSendSnapshotTrimSections)} snapshot_semantic_compress_sections=${String(preSendSnapshotSemanticCompressSections)} pretrim_retries=${String(preSendHeadTrimRetries)}\n`,
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
      const graphHintQuality = summarizeGraphHintQualityFromPrompt(selectedPrepared.prompt);
      input.writeStderr(
        `[context-engine] event=graph_cache_stats delta_symbol_query=${symbolQueryDeltaStats.hit}/${symbolQueryDeltaStats.miss}/${symbolQueryDeltaStats.write}/${symbolQueryDeltaStats.evict} delta_symbol_decl=${symbolDeclarationDeltaStats.hit}/${symbolDeclarationDeltaStats.miss}/${symbolDeclarationDeltaStats.write}/${symbolDeclarationDeltaStats.evict} delta_dependency_query=${dependencyQueryDeltaStats.hit}/${dependencyQueryDeltaStats.miss}/${dependencyQueryDeltaStats.write}/${dependencyQueryDeltaStats.evict} delta_dependency_import=${dependencyImportDeltaStats.hit}/${dependencyImportDeltaStats.miss}/${dependencyImportDeltaStats.write}/${dependencyImportDeltaStats.evict} total_symbol_query=${symbolQueryStats.hit}/${symbolQueryStats.miss}/${symbolQueryStats.write}/${symbolQueryStats.evict} total_symbol_decl=${symbolDeclarationStats.hit}/${symbolDeclarationStats.miss}/${symbolDeclarationStats.write}/${symbolDeclarationStats.evict} total_dependency_query=${dependencyQueryStats.hit}/${dependencyQueryStats.miss}/${dependencyQueryStats.write}/${dependencyQueryStats.evict} total_dependency_import=${dependencyImportStats.hit}/${dependencyImportStats.miss}/${dependencyImportStats.write}/${dependencyImportStats.evict} quality_dependency_rows=${String(graphHintQuality.dependency.rows)} quality_dependency_max_depth=${String(graphHintQuality.dependency.maxChainDepth)} quality_dependency_multi_hop_rows=${String(graphHintQuality.dependency.multiHopRows)} quality_symbol_rows=${String(graphHintQuality.symbol.rows)} quality_symbol_bridge_rows=${String(graphHintQuality.symbol.rowsWithBridge)} quality_symbol_breadth_rows=${String(graphHintQuality.symbol.rowsWithBreadth)}\n`,
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
          quality: graphHintQuality,
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
        if (interactiveMode) {
          input.writeStderr("[runtime-route] all provider circuits are OPEN; no attempt executed\n");
        } else {
          input.writeStderr(renderRuntimeOpenCircuitNotice(false));
        }
        return 1;
      }

        const failures: ProviderAttemptFailure[] = [];
          for (const provider of orderedProviders) {
            throwIfTurnInterrupted(turnSignal, "aborted_before_provider_attempt");
            const startedAtMs = Date.now();
            const turnModelConfig = resolveTurnModelConfig(provider.modelConfig, turnUserText);
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
                      platform: parsePlatform(sessionPlatformRaw),
                      tenant: sessionTenant,
                    scope: parseScope(sessionScopeRaw),
                    subject: sessionSubject,
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
                      toolContext: runtimeToolContextForTurn.context,
                      attachments: runtimeAttachments,
                      abortSignal: turnSignal,
                      systemPrompt: grobotSystemPrompt,
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
                  const retryReason = retryErrorClass === "upstream_http_error"
                    ? "upstream_429"
                    : retryErrorClass;
                  const backoffBaseMs = retryErrorClass === "upstream_response_read_failed"
                    ? 600
                    : 1_500;
                  const backoffMs = providerRetryCount * backoffBaseMs;
                  input.writeStderr(
                    `[runtime-route] provider_retry provider=${provider.name} reason=${retryReason} retry=${String(providerRetryCount)} backoff_ms=${String(backoffMs)}\n`,
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
        const terminalOutputSegments = buildTurnTerminalOutputSegments({
          assistantMessage: report.assistantMessage,
          interactiveMode,
          runtimeAskUser: Boolean(runtimeAskUser),
          events: report.events,
          terminalMarkdownMode: resolveTerminalMarkdownMode(process.env.GROBOT_TERMINAL_MARKDOWN),
          activityFeedDetailValue: process.env.GROBOT_ACTIVITY_FEED_DETAIL,
          activityFeedTranscriptValue: process.env.GROBOT_ACTIVITY_FEED_TRANSCRIPT,
        });
        const activityFeedStdout = terminalOutputSegments.activityFeed;
        let turnStdout = terminalOutputSegments.assistantOutput;
        let askUserEvent = "";
        recordRuntimeToolMetricsForEvents({
          workDir: input.workDir,
          events: report.events,
          source: "runtime_turn",
          writeStderr: writeTurnDiagnostic,
        });
        writeRuntimeToolSurfaceAdaptationOutcome({
          workDir: input.workDir,
          adaptation: runtimeToolContextForTurn.adaptation,
          events: report.events,
          verificationPass: report.verification.pass,
          traceId: report.traceId,
          startedAtIso: runtimeToolSurfaceAdaptationStartedAtIso,
          recoveryObservedAt: runtimeToolRecoveryFeedback.observedAt,
          writeStderr: writeTurnDiagnostic,
        });
        if (!runtimeToolContextForTurn.adaptation.active && !runtimeToolContextForTurn.guard.active) {
          const successfulRecoveryConsumption = recordRuntimeToolSuccessfulRecoveryConsumption({
            workDir: input.workDir,
            recoveryFeedback: runtimeToolRecoveryFeedback,
            events: report.events,
            verificationPass: report.verification.pass,
            traceId: report.traceId,
            nowIso: nowIso(),
          });
          if (successfulRecoveryConsumption.recorded) {
            writeTurnDiagnostic(
              `[tool-recovery] event=successful_tool_call_consumed action=${runtimeToolRecoveryFeedback.recommendedNextAction ?? "<none>"} tool=${runtimeToolRecoveryFeedback.toolName ?? "<none>"} error_class=${runtimeToolRecoveryFeedback.errorClass ?? "<none>"} consumed_at=${successfulRecoveryConsumption.record?.consumedAt ?? "<none>"}\n`,
            );
          }
        }
        if (runtimeAskUser) {
          const askUserEnvelopes = toAskUserEnvelopes(runtimeAskUser);
          for (const askUserEnvelope of askUserEnvelopes) {
            input.gaMechanismRuntime.registerPendingAsk(sessionKey, askUserEnvelope);
          }
          const queueDepth = input.gaMechanismRuntime.getPendingAskQueueSize(sessionKey);
          const activeAskEnvelope = input.gaMechanismRuntime.getPendingAsk(sessionKey)
            ?? askUserEnvelopes[0];
          if (!activeAskEnvelope) {
            throw new Error("ask_user interrupt emitted empty question set");
          }
          assistantTextForHistory = `需要确认：${activeAskEnvelope.question}`;
          turnStdout = interactiveMode
            ? options?.autoOpenAskUserPanel
              ? ""
              : "需要你的输入 · Enter 打开选择\n\n"
            : input.gaMechanismRuntime.buildAskUserDisplay(activeAskEnvelope);
          askUserEvent = askUserEnvelopes
            .map((envelope) => formatAskUserIssuedEvent(envelope))
            .join("");
          const latestAskEnvelope = askUserEnvelopes[askUserEnvelopes.length - 1] ?? activeAskEnvelope;
          writeTurnDiagnostic(
            `[ask-user] event=interrupt_received ask_id=${activeAskEnvelope.askId} blocking_node_id=${activeAskEnvelope.blockingNodeId} ask_total=${String(askUserEnvelopes.length)}\n`,
          );
          if (queueDepth > 1) {
            writeTurnDiagnostic(
              `[ask-user] event=queued depth=${String(queueDepth)} active_ask_id=${activeAskEnvelope.askId} latest_ask_id=${latestAskEnvelope.askId}\n`,
            );
          }
          writeTurnDiagnostic("[experience] event=publish_skipped reason=ask_user_interrupt\n");
        } else {
          const toolTraceMemory = buildRuntimeToolTraceMemory({
            events: report.events,
            userText: turnUserText,
          });
          if (toolTraceMemory) {
            const ingestResult = input.memoryOrchestrator.ingest({
              eventType: "tool_success",
              sessionKey,
              text: toolTraceMemory.text,
              executionVerified: report.verification.pass && toolTraceMemory.failedCount === 0,
              evidenceRef: {
                traceId: report.traceId,
                turnId: toolTraceMemory.turnId,
                source: "runtime_tool_trace",
              },
              tags: [
                "runtime_tool_trace",
                toolTraceMemory.deferredCount > 0 ? "tool_deferred" : "tool_observed",
              ],
              confidence: toolTraceMemory.deferredCount > 0 ? 0.68 : 0.76,
            });
            writeTurnDiagnosticEvents(ingestResult.stderrEvents);
          }
          const feedback = input.memoryOrchestrator.feedback({
            type: "turn_success",
            sessionKey,
            userText: turnUserText,
            assistantText: report.assistantMessage,
            traceId: report.traceId,
            requestId: report.requestId,
            providerName: provider.name,
            verificationPass: report.verification.pass,
          });
          writeTurnDiagnosticEvents(feedback.stderrEvents);
        }
          await recordTurn(
            turnUserText,
            assistantTextForHistory,
            stickyProvider,
            providerStates,
            options?.onTurnRecorded,
          );
          if (activityFeedStdout.length > 0) {
            input.writeStdout(activityFeedStdout);
          }
          input.writeStdout(turnStdout);
          if (emitTerminalDiagnostics) {
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
          }
          if (!report.verification.pass) {
            input.onVerificationFailure();
            const feedback = input.memoryOrchestrator.feedback({
              type: "verification_failure",
              sessionKey,
              userText: turnUserText,
              providerName: provider.name,
              errorMessage: "turn verification failed",
            });
            writeTurnDiagnosticEvents(feedback.stderrEvents);
          }
          const reflections = input.gaMechanismRuntime.pullReflectionTasks(sessionKey);
          if (emitTerminalDiagnostics) {
            for (const task of reflections) {
              input.writeStderr(
                `[reflection] trigger=${task.triggerType} id=${task.id} next_action="${task.nextActionHint}"\n`,
              );
            }
          }
          return report.verification.pass ? 0 : 1;
        } catch (error) {
          const rawMessage = String(error);
          const compactMessage = compactSingleLine(rawMessage, 240);
          const errorClass = resolveErrorClass(rawMessage);
          const runtimeErrorEvents = extractRuntimeErrorEvents(error);
          recordRuntimeToolMetricsForEvents({
            workDir: input.workDir,
            events: runtimeErrorEvents,
            source: "runtime_failure",
            writeStderr: writeTurnDiagnostic,
          });
          writeRuntimeToolSurfaceAdaptationOutcome({
            workDir: input.workDir,
            adaptation: runtimeToolContextForTurn.adaptation,
            events: runtimeErrorEvents,
            verificationPass: false,
            startedAtIso: runtimeToolSurfaceAdaptationStartedAtIso,
            recoveryObservedAt: runtimeToolRecoveryFeedback.observedAt,
            writeStderr: writeTurnDiagnostic,
          });
            if (errorClass === TURN_INTERRUPTED_ERROR_CLASS) {
              const providerStates = Array.from(providerStateMap.values());
              input.setProviderRuntimeStates(providerStates);
              input.updateActiveSessionProviderRuntime(input.getStickyProvider(), providerStates);
              const gaState = input.gaMechanismRuntime.snapshotSession(sessionKey);
              input.setGaState(gaState);
              input.updateActiveSessionGaState(gaState);
              await input.persistSessionRegistryState();
              if (interactiveMode) {
                input.writeStdout(renderTurnInterruptedNotice(true));
              } else {
                input.writeStderr(renderTurnInterruptedNotice(false));
              }
              return TURN_INTERRUPTED_EXIT_CODE;
            }
          failures.push({
            providerName: provider.name,
            errorClass,
            errorMessage: compactMessage,
          });
          const feedback = input.memoryOrchestrator.feedback({
            type: "turn_failure",
            sessionKey,
            userText: turnUserText,
            providerName: provider.name,
            errorClass,
            errorMessage: compactMessage,
            failureStage: deriveFailureStageFromError(errorClass, compactMessage),
            toolContext: `provider=${provider.name}`,
          });
          writeTurnDiagnosticEvents(feedback.stderrEvents);
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
    input.writeStderr(
      renderRuntimeFailureSummary({
        failures,
        orderedProviders,
      }),
    );
    const reflections = input.gaMechanismRuntime.pullReflectionTasks(sessionKey);
    for (const task of reflections) {
      input.writeStderr(
        `[reflection] trigger=${task.triggerType} id=${task.id} next_action="${task.nextActionHint}"\n`,
      );
    }
    return 1;
  };
}
