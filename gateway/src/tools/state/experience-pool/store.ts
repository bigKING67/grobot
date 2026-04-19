import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  type ExperienceAttemptOutcome,
  type ExperienceAttemptRecord,
  type ExperienceAttemptStage,
  type ExperienceFeedbackFailureInput,
  type ExperienceEvidence,
  type ExperienceEvidenceRef,
  type ExperienceFailureResult,
  type ExperiencePoolSnapshot,
  type ExperienceRecord,
  type ExperienceRecordState,
  type ExperienceSearchInput,
  type ExperienceSearchMatch,
  type ExperienceUpsertResult,
  type ExperienceUpsertSuccessInput,
} from "./types";

const EXPERIENCE_POOL_VERSION = "v1";
const MAX_KEYWORDS = 32;
const MAX_SOP_STEPS = 8;
const MAX_FAILURE_SIGNALS = 6;
const MAX_GUARDRAILS = 8;
const MAX_SCENARIO_TAGS = 8;
const MAX_CONFLICT_SIGNALS = 6;
const MAX_ATTEMPT_HISTORY = 20;
const MAX_EVIDENCE = 24;

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "then",
  "than",
  "need",
  "have",
  "has",
  "was",
  "were",
  "are",
  "you",
  "your",
  "please",
  "just",
  "about",
  "这里",
  "这个",
  "那个",
  "然后",
  "继续",
  "一下",
  "就是",
  "主要",
  "已经",
  "需要",
  "还是",
  "我们",
  "你们",
  "他们",
  "以及",
  "并且",
  "相关",
  "好的",
]);

const TASK_TYPE_RULES: ReadonlyArray<{
  taskType: string;
  pattern: RegExp;
}> = [
  {
    taskType: "debug_fix",
    pattern: /(debug|bug|fix|error|exception|fail|failure|报错|错误|异常|失败|修复|排查|故障)/i,
  },
  {
    taskType: "feature_build",
    pattern: /(implement|feature|build|add|create|新增|实现|开发|接入|落地|打磨)/i,
  },
  {
    taskType: "architecture_refactor",
    pattern: /(refactor|rework|optimi[sz]e|architecture|重构|优化|机制|架构|治理)/i,
  },
  {
    taskType: "verification_testing",
    pattern: /(test|verify|contract|assert|check|验收|验证|测试|评测|合约)/i,
  },
  {
    taskType: "deployment_ops",
    pattern: /(deploy|release|rollout|infra|operation|上线|部署|发布|运维|环境)/i,
  },
  {
    taskType: "documentation",
    pattern: /(docs?|readme|spec|guide|report|文档|说明|报告|总结)/i,
  },
];

const SCENARIO_TAG_RULES: ReadonlyArray<{
  tag: string;
  pattern: RegExp;
}> = [
  { tag: "auth_session", pattern: /(auth|login|session|token|cookie|401|403|登录|鉴权|会话|权限)/i },
  { tag: "context_engine", pattern: /(context|compression|budget|utilization|auto-limit|semantic|上下文|压缩|预算)/i },
  { tag: "memory_orchestrator", pattern: /(memory orchestrator|memory|lineage|recall|inject|记忆|回忆|注入)/i },
  { tag: "experience_pool", pattern: /(experience|sop|attempt|复用|经验池|经验)/i },
  { tag: "scheduler", pattern: /(scheduler|cron|schedule|定时|调度)/i },
  { tag: "runtime_provider", pattern: /(provider|model|runtime|timeout|429|upstream|模型|路由|超时)/i },
  { tag: "mcp_tooling", pattern: /(mcp|tool call|tool|插件|工具链)/i },
  { tag: "frontend_ui", pattern: /(frontend|ui|ux|页面|样式|组件|交互)/i },
  { tag: "backend_api", pattern: /(backend|api|server|gateway|接口|后端)/i },
  { tag: "database_state", pattern: /(database|db|postgres|redis|schema|migration|数据库|表|迁移)/i },
  { tag: "git_workflow", pattern: /(git|commit|rebase|stash|branch|提交|分支)/i },
  { tag: "ci_quality", pattern: /(ci|lint|typecheck|pipeline|check|质量门禁|构建)/i },
];

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function compactWhitespace(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function parentDirectory(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const match = normalized.match(/^(.*)[\\/][^\\/]+$/);
  if (match && typeof match[1] === "string" && match[1].length > 0) {
    return match[1];
  }
  return ".";
}

function normalizeTokenSource(raw: string): string {
  return compactWhitespace(raw.toLowerCase());
}

function normalizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function normalizeTaskType(raw: string): string {
  const normalized = normalizeTag(raw);
  return normalized || "general_task";
}

function uniqueTrimmed(rows: readonly string[], limit: number): string[] {
  const unique = new Set<string>();
  const result: string[] = [];
  for (const row of rows) {
    const normalized = compactWhitespace(row);
    if (!normalized || unique.has(normalized)) {
      continue;
    }
    unique.add(normalized);
    result.push(normalized);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function parseFiniteInt(raw: unknown, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(0, Math.floor(raw));
}

function parseFiniteFloat(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  return clamp(raw, min, max);
}

function extractTokens(raw: string): string[] {
  const source = normalizeTokenSource(raw);
  if (!source) {
    return [];
  }
  const unique = new Set<string>();
  for (const token of source.match(/[a-z0-9_]{2,}/g) ?? []) {
    if (STOPWORDS.has(token)) {
      continue;
    }
    unique.add(token);
    if (unique.size >= 64) {
      break;
    }
  }
  for (const token of source.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    if (STOPWORDS.has(token)) {
      continue;
    }
    unique.add(token);
    if (unique.size >= 64) {
      break;
    }
  }
  return Array.from(unique);
}

function deriveSignature(userText: string): string {
  const tokens = extractTokens(userText).slice(0, 8);
  if (tokens.length > 0) {
    return tokens.join(" ");
  }
  return compactWhitespace(userText).slice(0, 96);
}

function deriveTaskType(raw: string): string {
  const compact = compactWhitespace(raw);
  if (!compact) {
    return "general_task";
  }
  for (const rule of TASK_TYPE_RULES) {
    if (rule.pattern.test(compact)) {
      return rule.taskType;
    }
  }
  return "general_task";
}

function deriveScenarioTags(raw: string): string[] {
  const compact = compactWhitespace(raw);
  if (!compact) {
    return [];
  }
  const tags: string[] = [];
  for (const rule of SCENARIO_TAG_RULES) {
    if (rule.pattern.test(compact)) {
      tags.push(rule.tag);
    }
  }
  return uniqueTrimmed(tags.map((tag) => normalizeTag(tag)), MAX_SCENARIO_TAGS);
}

function deriveTaskSignature(userText: string, assistantText: string): string {
  const merged = compactWhitespace(`${userText} ${assistantText}`);
  if (!merged) {
    return "general_task";
  }
  const taskType = deriveTaskType(merged);
  const scenarioTags = deriveScenarioTags(merged).slice(0, 3);
  const focusTokens = extractTokens(userText).slice(0, 6);
  const fallbackTokens = focusTokens.length > 0 ? focusTokens : extractTokens(merged).slice(0, 6);
  const components = uniqueTrimmed([taskType, ...scenarioTags, ...fallbackTokens], 10);
  if (components.length === 0) {
    return normalizeTaskType(taskType);
  }
  return components.join(" | ").slice(0, 180);
}

function deriveSummary(userText: string): string {
  const summary = compactWhitespace(userText);
  if (!summary) {
    return "unspecified task";
  }
  return summary.length <= 120 ? summary : `${summary.slice(0, 120)}...`;
}

function extractSopSteps(assistantText: string): string[] {
  const rawLines = assistantText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const bulletLines = rawLines
    .filter((line) => /^([-*]\s+|\d+\.\s+)/.test(line))
    .map((line) => line.replace(/^([-*]\s+|\d+\.\s+)/, "").trim())
    .filter((line) => line.length > 0);
  if (bulletLines.length > 0) {
    return uniqueTrimmed(bulletLines, MAX_SOP_STEPS);
  }
  const sentenceLines = compactWhitespace(assistantText)
    .split(/[。！？.!?]/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 6);
  return uniqueTrimmed(sentenceLines, Math.min(MAX_SOP_STEPS, 6));
}

function extractFailureSignals(text: string): string[] {
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => compactWhitespace(line))
    .filter((line) => line.length > 0);
  const candidates = rawLines.filter((line) =>
    /(失败|报错|错误|异常|超时|登录|冲突|不一致|forbidden|unauthorized|denied|error|timeout|conflict|mismatch|regression|429|403|401)/i
      .test(line),
  );
  if (candidates.length === 0) {
    return [];
  }
  return uniqueTrimmed(candidates, MAX_FAILURE_SIGNALS);
}

function deriveSuccessStrategy(assistantText: string, sop: readonly string[]): string | undefined {
  if (sop.length > 0) {
    return sop[0];
  }
  const lines = assistantText
    .split(/\r?\n/)
    .map((line) => compactWhitespace(line))
    .filter((line) => line.length >= 8);
  if (lines.length === 0) {
    return undefined;
  }
  return lines[0].slice(0, 180);
}

function parseAttemptStage(raw: unknown): ExperienceAttemptStage {
  if (
    raw === "planning"
    || raw === "implementation"
    || raw === "verification"
    || raw === "runtime"
    || raw === "unknown"
  ) {
    return raw;
  }
  return "unknown";
}

function parseOptionalAttemptStage(raw: unknown): ExperienceAttemptStage | undefined {
  if (
    raw === "planning"
    || raw === "implementation"
    || raw === "verification"
    || raw === "runtime"
    || raw === "unknown"
  ) {
    return raw;
  }
  return undefined;
}

function parseAttemptOutcome(raw: unknown): ExperienceAttemptOutcome {
  return raw === "failure" ? "failure" : "success";
}

function deriveFailureStage(
  errorClass: string,
  errorMessage: string,
  rawStage?: ExperienceAttemptStage,
): ExperienceAttemptStage {
  if (
    rawStage === "planning"
    || rawStage === "implementation"
    || rawStage === "verification"
    || rawStage === "runtime"
    || rawStage === "unknown"
  ) {
    return rawStage;
  }
  const merged = compactWhitespace(`${errorClass} ${errorMessage}`).toLowerCase();
  if (!merged) {
    return "unknown";
  }
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

function deriveConflictSignal(errorClass: string, errorMessage: string): string | undefined {
  const normalizedClass = compactWhitespace(errorClass).toLowerCase();
  const normalizedMessage = compactWhitespace(errorMessage).toLowerCase();
  const merged = `${normalizedClass} ${normalizedMessage}`.trim();
  if (!merged) {
    return undefined;
  }
  const patterns = [
    /conflict/,
    /contradict/,
    /mismatch/,
    /incompatible/,
    /regression/,
    /冲突/,
    /不一致/,
    /矛盾/,
    /回归/,
  ];
  const matched = patterns.some((pattern) => pattern.test(merged));
  if (!matched) {
    return undefined;
  }
  const raw = compactWhitespace(`${errorClass}: ${errorMessage}`);
  if (!raw) {
    return "conflict_signal";
  }
  return raw.slice(0, 180);
}

function deriveGuardrailForSignal(signal: string): string | undefined {
  const lower = signal.toLowerCase();
  if (/(429|limit|throttle|rate)/.test(lower)) {
    return "遇到限流先降低并发并增加退避重试，避免立即重复提交。";
  }
  if (/(401|403|unauthorized|forbidden|auth|token|session|权限|鉴权)/.test(lower)) {
    return "重试前先确认鉴权态（token/session/权限）有效，再继续执行。";
  }
  if (/(timeout|socket|network|连接|超时)/.test(lower)) {
    return "先缩小任务范围并检查网络/超时参数，再进入下一轮重试。";
  }
  if (/(schema|contract|mismatch|incompatible|不一致|冲突|回归)/.test(lower)) {
    return "跨层改动前先对齐 contract 与 schema，避免同名字段语义漂移。";
  }
  if (/(path|not found|enoent|目录|文件不存在)/.test(lower)) {
    return "执行前先校验工作目录与目标路径，避免在错误路径反复重试。";
  }
  if (/(permission|denied|eacces|权限)/.test(lower)) {
    return "先确认权限与执行上下文，再继续写入或执行命令。";
  }
  return undefined;
}

function deriveReuseGuardrails(
  failureSignals: readonly string[],
  conflictSignals: readonly string[],
): string[] {
  const rows: string[] = [];
  for (const signal of [...failureSignals, ...conflictSignals]) {
    const guardrail = deriveGuardrailForSignal(signal);
    if (guardrail) {
      rows.push(guardrail);
    }
  }
  if (rows.length === 0) {
    return [];
  }
  return uniqueTrimmed(rows, MAX_GUARDRAILS);
}

function signatureHash(tenant: string, team: string, user: string, signature: string): string {
  return createHash("sha1")
    .update(`${tenant}::${team}::${user}::${signature}`)
    .digest("hex")
    .slice(0, 20);
}

function parseRecordState(raw: unknown): ExperienceRecordState {
  if (raw === "active" || raw === "quarantined" || raw === "disabled") {
    return raw;
  }
  return "active";
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const rows: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = compactWhitespace(item);
    if (normalized) {
      rows.push(normalized);
    }
  }
  return rows;
}

function normalizeEvidenceRef(raw: ExperienceEvidenceRef | undefined): ExperienceEvidenceRef | undefined {
  if (!raw) {
    return undefined;
  }
  const traceId = typeof raw.traceId === "string" ? raw.traceId.trim() : "";
  const runId = typeof raw.runId === "string" ? raw.runId.trim() : "";
  const toolCallId = typeof raw.toolCallId === "string" ? raw.toolCallId.trim() : "";
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  const sourceType = typeof raw.sourceType === "string" ? raw.sourceType.trim() : "";
  const capturedAt = typeof raw.capturedAt === "string" ? raw.capturedAt.trim() : "";
  if (!traceId && !runId && !toolCallId && !url && !sourceType && !capturedAt) {
    return undefined;
  }
  return {
    traceId: traceId || undefined,
    runId: runId || undefined,
    toolCallId: toolCallId || undefined,
    url: url || undefined,
    sourceType: sourceType || undefined,
    capturedAt: capturedAt || undefined,
  };
}

function parseEvidenceRef(raw: unknown): ExperienceEvidenceRef | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  return normalizeEvidenceRef({
    traceId: typeof record.traceId === "string" ? record.traceId : undefined,
    runId: typeof record.runId === "string" ? record.runId : undefined,
    toolCallId: typeof record.toolCallId === "string" ? record.toolCallId : undefined,
    url: typeof record.url === "string" ? record.url : undefined,
    sourceType: typeof record.sourceType === "string" ? record.sourceType : undefined,
    capturedAt: typeof record.capturedAt === "string" ? record.capturedAt : undefined,
  });
}

function deriveLegacyEvidenceRef(input: {
  traceId?: string;
  sourceType: string;
  capturedAt: string;
}): ExperienceEvidenceRef | undefined {
  const traceId = typeof input.traceId === "string" ? input.traceId.trim() : "";
  if (!traceId) {
    return undefined;
  }
  return {
    traceId,
    sourceType: input.sourceType,
    capturedAt: input.capturedAt,
  };
}

function parseAttemptRecord(raw: unknown): ExperienceAttemptRecord | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const capturedAt = typeof record.capturedAt === "string" && record.capturedAt.trim().length > 0
    ? record.capturedAt
    : nowIso();
  const outcome = parseAttemptOutcome(record.outcome);
  const stage = parseAttemptStage(record.stage);
  return {
    capturedAt,
    outcome,
    stage,
    providerName: typeof record.providerName === "string" ? compactWhitespace(record.providerName).slice(0, 64) : undefined,
    verificationPass: typeof record.verificationPass === "boolean" ? record.verificationPass : undefined,
    traceId: typeof record.traceId === "string" ? compactWhitespace(record.traceId).slice(0, 128) : undefined,
    strategy: typeof record.strategy === "string" ? compactWhitespace(record.strategy).slice(0, 220) : undefined,
    errorClass: typeof record.errorClass === "string" ? compactWhitespace(record.errorClass).slice(0, 120) : undefined,
    errorMessage: typeof record.errorMessage === "string" ? compactWhitespace(record.errorMessage).slice(0, 220) : undefined,
    toolContext: typeof record.toolContext === "string" ? compactWhitespace(record.toolContext).slice(0, 160) : undefined,
  };
}

function normalizeAttemptHistory(rows: readonly ExperienceAttemptRecord[]): ExperienceAttemptRecord[] {
  const normalized = rows
    .map((row) => ({
      ...row,
      capturedAt: typeof row.capturedAt === "string" && row.capturedAt.trim().length > 0
        ? row.capturedAt
        : nowIso(),
      outcome: (row.outcome === "failure" ? "failure" : "success") as ExperienceAttemptOutcome,
      stage: parseAttemptStage(row.stage),
      providerName: row.providerName ? compactWhitespace(row.providerName).slice(0, 64) : undefined,
      verificationPass: typeof row.verificationPass === "boolean" ? row.verificationPass : undefined,
      traceId: row.traceId ? compactWhitespace(row.traceId).slice(0, 128) : undefined,
      strategy: row.strategy ? compactWhitespace(row.strategy).slice(0, 220) : undefined,
      errorClass: row.errorClass ? compactWhitespace(row.errorClass).slice(0, 120) : undefined,
      errorMessage: row.errorMessage ? compactWhitespace(row.errorMessage).slice(0, 220) : undefined,
      toolContext: row.toolContext ? compactWhitespace(row.toolContext).slice(0, 160) : undefined,
    }))
    .filter((row) => Boolean(row.capturedAt))
    .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt))
    .slice(0, MAX_ATTEMPT_HISTORY);
  return normalized;
}

function appendAttempt(
  history: readonly ExperienceAttemptRecord[],
  attempt: ExperienceAttemptRecord,
): ExperienceAttemptRecord[] {
  return normalizeAttemptHistory([attempt, ...history]);
}

function computeRecoverySuccessCount(history: readonly ExperienceAttemptRecord[]): number {
  if (history.length <= 1) {
    return 0;
  }
  const timeline = [...history].reverse();
  let previous: ExperienceAttemptOutcome | undefined;
  let recovered = 0;
  for (const row of timeline) {
    if (previous === "failure" && row.outcome === "success") {
      recovered += 1;
    }
    previous = row.outcome;
  }
  return recovered;
}

function computeConsecutiveFailureCount(history: readonly ExperienceAttemptRecord[]): number {
  let count = 0;
  for (const row of history) {
    if (row.outcome !== "failure") {
      break;
    }
    count += 1;
  }
  return count;
}

function parseRecord(raw: unknown): ExperienceRecord | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const tenant = typeof record.tenant === "string" ? record.tenant.trim() : "";
  const team = typeof record.team === "string" ? record.team.trim() : "default";
  const user = typeof record.user === "string" ? record.user.trim() : "default";
  const signature = typeof record.signature === "string" ? compactWhitespace(record.signature) : "";
  if (!id || !tenant || !team || !user || !signature) {
    return undefined;
  }
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : nowIso();
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : createdAt;
  const lastUsedAt = typeof record.lastUsedAt === "string" ? record.lastUsedAt : updatedAt;
  const summaryRaw = typeof record.summary === "string" ? compactWhitespace(record.summary) : "";
  const summary = summaryRaw || signature;
  const taskSignatureRaw = typeof record.taskSignature === "string"
    ? compactWhitespace(record.taskSignature)
    : "";
  const taskTypeRaw = typeof record.taskType === "string" ? compactWhitespace(record.taskType) : "";
  const scenarioTagsRaw = parseStringArray(record.scenarioTags).map(normalizeTag);
  const keywords = uniqueTrimmed(parseStringArray(record.keywords), MAX_KEYWORDS);
  const sop = uniqueTrimmed(parseStringArray(record.sop), MAX_SOP_STEPS);
  const failureSignals = uniqueTrimmed(parseStringArray(record.failureSignals), MAX_FAILURE_SIGNALS);
  const conflictSignals = uniqueTrimmed(parseStringArray(record.conflictSignals), MAX_CONFLICT_SIGNALS);
  const evidenceRaw = Array.isArray(record.evidence) ? record.evidence : [];
  const evidence: ExperienceEvidence[] = [];
  for (const item of evidenceRaw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const row = item as Record<string, unknown>;
    const sourceRaw = row.source;
    const source =
      sourceRaw === "turn_success" || sourceRaw === "turn_failure" || sourceRaw === "manual"
        ? sourceRaw
        : "manual";
    evidence.push({
      source,
      traceId: typeof row.traceId === "string" ? row.traceId : undefined,
      providerName: typeof row.providerName === "string" ? row.providerName : undefined,
      errorClass: typeof row.errorClass === "string" ? row.errorClass : undefined,
      capturedAt: typeof row.capturedAt === "string" ? row.capturedAt : nowIso(),
      evidenceRef:
        parseEvidenceRef(row.evidenceRef)
        ?? deriveLegacyEvidenceRef({
          traceId: typeof row.traceId === "string" ? row.traceId : undefined,
          sourceType: source,
          capturedAt: typeof row.capturedAt === "string" ? row.capturedAt : nowIso(),
        }),
    });
  }
  const attemptHistoryRaw = Array.isArray(record.attemptHistory) ? record.attemptHistory : [];
  let attemptHistory = normalizeAttemptHistory(
    attemptHistoryRaw
      .map((item) => parseAttemptRecord(item))
      .filter((item): item is ExperienceAttemptRecord => Boolean(item)),
  );
  if (attemptHistory.length === 0) {
    const synthesizedOutcome = record.lastOutcome === "failure" ? "failure" : "success";
    if (parseFiniteInt(record.successCount, 0) > 0 || parseFiniteInt(record.failureCount, 0) > 0) {
      attemptHistory = [
        {
          capturedAt: lastUsedAt,
          outcome: synthesizedOutcome,
          stage: synthesizedOutcome === "success"
            ? "verification"
            : deriveFailureStage(
              typeof record.lastFailureClass === "string" ? record.lastFailureClass : "",
              failureSignals[0] ?? "",
            ),
          strategy: synthesizedOutcome === "success" ? sop[0] : undefined,
          errorClass: synthesizedOutcome === "failure"
            ? (typeof record.lastFailureClass === "string" ? compactWhitespace(record.lastFailureClass) : undefined)
            : undefined,
          errorMessage: synthesizedOutcome === "failure" ? failureSignals[0] : undefined,
          verificationPass: synthesizedOutcome === "success" ? parseFiniteInt(record.verificationPassCount, 0) > 0 : undefined,
        },
      ];
    }
  }
  const taskSeed = `${signature} ${summary}`;
  const taskSignature = taskSignatureRaw || deriveTaskSignature(taskSeed, "");
  const taskType = taskTypeRaw ? normalizeTaskType(taskTypeRaw) : normalizeTaskType(deriveTaskType(taskSeed));
  const scenarioTags = scenarioTagsRaw.length > 0
    ? uniqueTrimmed(scenarioTagsRaw, MAX_SCENARIO_TAGS)
    : deriveScenarioTags(taskSeed);
  const reuseGuardrailsRaw = uniqueTrimmed(parseStringArray(record.reuseGuardrails), MAX_GUARDRAILS);
  const reuseGuardrails = reuseGuardrailsRaw.length > 0
    ? reuseGuardrailsRaw
    : deriveReuseGuardrails(failureSignals, conflictSignals);
  const lastFailureClassRaw = typeof record.lastFailureClass === "string"
    ? compactWhitespace(record.lastFailureClass)
    : "";
  const inferredLastFailureClass = lastFailureClassRaw
    || (failureSignals[0]?.split(":")[0] ?? "").trim()
    || undefined;
  const lastFailureStage = parseOptionalAttemptStage(record.lastFailureStage)
    ?? deriveFailureStage(inferredLastFailureClass ?? "", failureSignals[0] ?? "");
  const recoverySuccessCount = typeof record.recoverySuccessCount === "number"
    ? parseFiniteInt(record.recoverySuccessCount, 0)
    : computeRecoverySuccessCount(attemptHistory);
  const consecutiveFailureCount = typeof record.consecutiveFailureCount === "number"
    ? parseFiniteInt(record.consecutiveFailureCount, 0)
    : computeConsecutiveFailureCount(attemptHistory);

  return {
    id,
    tenant,
    team,
    user,
    signature,
    taskSignature,
    taskType,
    scenarioTags,
    summary,
    keywords,
    sop,
    failureSignals,
    reuseGuardrails,
    attemptHistory,
    confidence: parseFiniteFloat(record.confidence, 0.55, 0.01, 0.99),
    successCount: parseFiniteInt(record.successCount, 0),
    failureCount: parseFiniteInt(record.failureCount, 0),
    recoverySuccessCount,
    consecutiveFailureCount,
    conflictCount: parseFiniteInt(record.conflictCount, 0),
    verificationPassCount: parseFiniteInt(record.verificationPassCount, 0),
    lastOutcome: record.lastOutcome === "failure" ? "failure" : "success",
    lastFailureClass: inferredLastFailureClass,
    lastFailureStage,
    lastSuccessStrategy: typeof record.lastSuccessStrategy === "string"
      ? compactWhitespace(record.lastSuccessStrategy).slice(0, 220)
      : sop[0],
    state: parseRecordState(record.state),
    createdAt,
    updatedAt,
    lastUsedAt,
    lastConflictAt: typeof record.lastConflictAt === "string" ? record.lastConflictAt : undefined,
    conflictSignals,
    evidence: evidence.slice(0, MAX_EVIDENCE),
  };
}

function createEmptySnapshot(): ExperiencePoolSnapshot {
  return {
    version: EXPERIENCE_POOL_VERSION,
    updatedAt: nowIso(),
    records: [],
  };
}

function parseSnapshot(raw: unknown): ExperiencePoolSnapshot {
  if (typeof raw !== "object" || raw === null) {
    return createEmptySnapshot();
  }
  const record = raw as Record<string, unknown>;
  const rows = Array.isArray(record.records) ? record.records : [];
  const records = rows
    .map((item) => parseRecord(item))
    .filter((item): item is ExperienceRecord => Boolean(item));
  return {
    version: EXPERIENCE_POOL_VERSION,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : nowIso(),
    records,
  };
}

function cloneRecord(record: ExperienceRecord): ExperienceRecord {
  return {
    ...record,
    scenarioTags: [...record.scenarioTags],
    keywords: [...record.keywords],
    sop: [...record.sop],
    failureSignals: [...record.failureSignals],
    reuseGuardrails: [...record.reuseGuardrails],
    attemptHistory: record.attemptHistory.map((attempt) => ({ ...attempt })),
    conflictSignals: [...record.conflictSignals],
    evidence: record.evidence.map((item) => ({
      ...item,
      evidenceRef: item.evidenceRef ? { ...item.evidenceRef } : undefined,
    })),
  };
}

function sortRecordsInPlace(records: ExperienceRecord[]): void {
  records.sort((left, right) => {
    const confidenceDelta = right.confidence - left.confidence;
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }
    const recoveryDelta = right.recoverySuccessCount - left.recoverySuccessCount;
    if (recoveryDelta !== 0) {
      return recoveryDelta;
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

interface ExperienceQueryProfile {
  rawQuery: string;
  tokens: string[];
  taskType: string;
  scenarioTags: string[];
  taskSignature: string;
  taskTokens: string[];
}

function buildQueryProfile(rawQuery: string): ExperienceQueryProfile {
  const normalized = compactWhitespace(rawQuery);
  const tokens = extractTokens(normalized).slice(0, 24);
  const taskType = deriveTaskType(normalized);
  const scenarioTags = deriveScenarioTags(normalized);
  const taskSignature = deriveTaskSignature(normalized, "");
  const taskTokens = extractTokens(taskSignature);
  return {
    rawQuery: normalized,
    tokens,
    taskType,
    scenarioTags,
    taskSignature,
    taskTokens,
  };
}

function computeTokenOverlap(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const rightSet = new Set(right.map((item) => item.toLowerCase()));
  let overlap = 0;
  for (const token of left) {
    if (rightSet.has(token.toLowerCase())) {
      overlap += 1;
    }
  }
  return overlap;
}

function scoreRecordForQuery(
  record: ExperienceRecord,
  profile: ExperienceQueryProfile,
): ExperienceSearchMatch {
  const signatureText = `${record.signature} ${record.summary}`.toLowerCase();
  const keywordSet = new Set<string>(record.keywords.map((token) => token.toLowerCase()));
  const queryTokens = profile.tokens.map((token) => token.toLowerCase());
  const matchedTokens: string[] = [];
  let lexicalOverlap = 0;
  for (const token of queryTokens) {
    if (keywordSet.has(token) || signatureText.includes(token)) {
      lexicalOverlap += 1;
      matchedTokens.push(token);
    }
  }

  const recordTaskTokens = extractTokens(record.taskSignature).map((token) => token.toLowerCase());
  const taskTokenOverlap = computeTokenOverlap(queryTokens, recordTaskTokens);
  const matchedTaskSignals: string[] = [];
  if (profile.taskType === record.taskType && profile.taskType !== "general_task") {
    matchedTaskSignals.push(`task_type:${record.taskType}`);
  }
  if (taskTokenOverlap > 0) {
    matchedTaskSignals.push(...recordTaskTokens.slice(0, Math.min(3, taskTokenOverlap)).map((token) => `task:${token}`));
  }

  const queryScenarioSet = new Set(profile.scenarioTags.map((tag) => tag.toLowerCase()));
  const matchedScenarioTags = record.scenarioTags.filter((tag) => queryScenarioSet.has(tag.toLowerCase()));

  const lexicalScore = lexicalOverlap * 16;
  const taskScore = taskTokenOverlap * 22;
  const taskTypeScore = matchedTaskSignals.some((item) => item.startsWith("task_type:")) ? 14 : 0;
  const scenarioScore = matchedScenarioTags.length * 18;
  const confidenceScore = record.confidence * 42;
  const verificationRate = record.successCount > 0
    ? record.verificationPassCount / Math.max(1, record.successCount)
    : 0;
  const verificationScore = verificationRate * 18;
  const successScore = Math.min(22, Math.log2(record.successCount + 1) * 9);
  const recoveryScore = Math.min(18, record.recoverySuccessCount * 4.5);
  const freshnessHours = Math.max(0, (Date.now() - Date.parse(record.updatedAt)) / 3_600_000);
  const freshnessScore = Math.max(0, 28 - Math.min(28, freshnessHours)) * 0.45;

  const failurePenalty = Math.min(26, record.failureCount * 2.8);
  const consecutivePenalty = Math.min(24, record.consecutiveFailureCount * 7);
  const outcomePenalty = record.lastOutcome === "failure" ? 8 : 0;
  const statePenalty = record.state === "active" ? 0 : record.state === "quarantined" ? 20 : 80;

  const score = lexicalScore
    + taskScore
    + taskTypeScore
    + scenarioScore
    + confidenceScore
    + verificationScore
    + successScore
    + recoveryScore
    + freshnessScore
    - failurePenalty
    - consecutivePenalty
    - outcomePenalty
    - statePenalty;

  return {
    record,
    score: Number(score.toFixed(4)),
    matchedTokens: uniqueTrimmed(matchedTokens, 8),
    matchedTaskSignals: uniqueTrimmed(matchedTaskSignals, 6),
    matchedScenarioTags: uniqueTrimmed(matchedScenarioTags, 6),
  };
}

function buildFailureSignal(input: {
  stage: ExperienceAttemptStage;
  errorClass: string;
  errorMessage: string;
}): string {
  const normalizedClass = compactWhitespace(input.errorClass).slice(0, 80) || "unknown_error";
  const normalizedMessage = compactWhitespace(input.errorMessage).slice(0, 160);
  const prefix = `${input.stage}/${normalizedClass}`;
  if (!normalizedMessage) {
    return prefix;
  }
  return `${prefix}: ${normalizedMessage}`;
}

export class FileBackedExperiencePoolStore {
  private readonly path: string;

  private readonly legacyPath?: string;

  private snapshot: ExperiencePoolSnapshot;

  constructor(path: string, legacyPath?: string) {
    this.path = path;
    this.legacyPath = legacyPath;
    this.snapshot = this.readSnapshot();
  }

  public getPath(): string {
    return this.path;
  }

  public getRecordCount(): number {
    return this.snapshot.records.length;
  }

  public getUpdatedAt(): string {
    return this.snapshot.updatedAt;
  }

  public listRecords(tenant?: string, team?: string, user?: string): ExperienceRecord[] {
    const rows = this.snapshot.records.filter((record) => {
      if (tenant && record.tenant !== tenant) {
        return false;
      }
      if (team && record.team !== team) {
        return false;
      }
      if (user && record.user !== user) {
        return false;
      }
      return true;
    });
    return rows.map((record) => cloneRecord(record));
  }

  public getRecordById(id: string): ExperienceRecord | undefined {
    const found = this.snapshot.records.find((record) => record.id === id);
    if (!found) {
      return undefined;
    }
    return cloneRecord(found);
  }

  public setRecordState(id: string, state: ExperienceRecordState, reason?: string): ExperienceRecord | undefined {
    const found = this.snapshot.records.find((record) => record.id === id);
    if (!found) {
      return undefined;
    }
    found.state = state;
    found.updatedAt = nowIso();
    if (reason && reason.trim().length > 0) {
      found.failureSignals = uniqueTrimmed([reason.trim(), ...found.failureSignals], MAX_FAILURE_SIGNALS);
      found.reuseGuardrails = uniqueTrimmed(
        [...found.reuseGuardrails, ...deriveReuseGuardrails(found.failureSignals, found.conflictSignals)],
        MAX_GUARDRAILS,
      );
    }
    this.touchSnapshot();
    this.persist();
    return cloneRecord(found);
  }

  public search(input: ExperienceSearchInput): ExperienceSearchMatch[] {
    const profile = buildQueryProfile(input.query);
    if (!profile.rawQuery) {
      return [];
    }
    const states = input.includeStates ?? ["active"];
    const includeStates = new Set(states);
    const scored = this.snapshot.records
      .filter((record) => record.tenant === input.tenant)
      .filter((record) => !input.team || record.team === input.team)
      .filter((record) => !input.user || record.user === input.user)
      .filter((record) => includeStates.has(record.state))
      .map((record) => scoreRecordForQuery(record, profile))
      .filter((match) => match.score >= (profile.tokens.length <= 2 ? 22 : 30))
      .sort((left, right) => right.score - left.score);
    const limit = Math.min(Math.max(input.limit, 1), 20);
    return scored.slice(0, limit).map((match) => ({
      record: cloneRecord(match.record),
      score: match.score,
      matchedTokens: [...match.matchedTokens],
      matchedTaskSignals: match.matchedTaskSignals ? [...match.matchedTaskSignals] : undefined,
      matchedScenarioTags: match.matchedScenarioTags ? [...match.matchedScenarioTags] : undefined,
    }));
  }

  public upsertSuccess(input: ExperienceUpsertSuccessInput): ExperienceUpsertResult {
    const signature = deriveSignature(input.userText);
    const now = nowIso();
    const sop = extractSopSteps(input.assistantText);
    const successStrategy = deriveSuccessStrategy(input.assistantText, sop);
    const keywords = uniqueTrimmed(extractTokens(`${input.userText} ${input.assistantText}`), MAX_KEYWORDS);
    const taskSignature = deriveTaskSignature(input.userText, input.assistantText);
    const taskType = deriveTaskType(`${input.userText} ${input.assistantText}`);
    const normalizedTaskType = normalizeTaskType(taskType);
    const scenarioTags = deriveScenarioTags(`${input.userText} ${input.assistantText}`);
    const taskTokens = extractTokens(taskSignature);
    const fallbackRecordId = signatureHash(input.tenant, input.team, input.user, taskSignature || signature);
    const exactFound = this.snapshot.records.find((record) =>
      record.tenant === input.tenant
      && record.team === input.team
      && record.user === input.user
      && (record.taskSignature === taskSignature || record.signature === signature),
    );
    const found = exactFound
      ?? this.snapshot.records
        .filter((record) =>
          record.tenant === input.tenant
          && record.team === input.team
          && record.user === input.user,
        )
        .map((record) => {
          const taskOverlap = computeTokenOverlap(taskTokens, extractTokens(record.taskSignature));
          const scenarioOverlap = computeTokenOverlap(scenarioTags, record.scenarioTags);
          const taskTypeScore = record.taskType === normalizedTaskType ? 8 : 0;
          const signatureContainment = (
            record.taskSignature.includes(taskSignature)
            || taskSignature.includes(record.taskSignature)
          )
            ? 6
            : 0;
          const score = (taskOverlap * 12) + (scenarioOverlap * 9) + taskTypeScore + signatureContainment;
          return { record, score };
        })
        .filter((item) => item.score >= 30)
        .sort((left, right) => right.score - left.score)[0]?.record;
    const recordId = found?.id ?? fallbackRecordId;
    const evidence = {
      source: "turn_success" as const,
      traceId: input.traceId,
      providerName: input.providerName,
      capturedAt: now,
      evidenceRef:
        normalizeEvidenceRef(input.evidenceRef)
        ?? deriveLegacyEvidenceRef({
          traceId: input.traceId,
          sourceType: "turn_success",
          capturedAt: now,
        }),
    };
    const successAttempt: ExperienceAttemptRecord = {
      capturedAt: now,
      outcome: "success",
      stage: input.verificationPass ? "verification" : "implementation",
      providerName: input.providerName,
      verificationPass: input.verificationPass,
      traceId: input.traceId,
      strategy: successStrategy,
    };

    if (found) {
      const wasFailure = found.lastOutcome === "failure";
      found.signature = signature;
      found.taskSignature = taskSignature;
      found.taskType = normalizedTaskType;
      found.scenarioTags = uniqueTrimmed([...found.scenarioTags, ...scenarioTags], MAX_SCENARIO_TAGS);
      found.summary = deriveSummary(input.userText);
      found.keywords = uniqueTrimmed([...found.keywords, ...keywords], MAX_KEYWORDS);
      if (sop.length > 0) {
        found.sop = uniqueTrimmed([...found.sop, ...sop], MAX_SOP_STEPS);
      }
      found.successCount += 1;
      if (input.verificationPass) {
        found.verificationPassCount += 1;
      }
      if (wasFailure) {
        found.recoverySuccessCount += 1;
      }
      found.consecutiveFailureCount = 0;
      found.lastOutcome = "success";
      found.lastUsedAt = now;
      found.updatedAt = now;
      if (successStrategy) {
        found.lastSuccessStrategy = successStrategy;
      }
      const verificationBoost = input.verificationPass ? 0.08 : 0.03;
      const recoveryBoost = wasFailure ? 0.05 : 0;
      const recoveryRatio = found.recoverySuccessCount / Math.max(1, found.failureCount);
      const recoveryStabilityBoost = Math.min(0.08, recoveryRatio * 0.04);
      const longTailFailureDrag = Math.min(0.22, found.failureCount * 0.025);
      found.confidence = clamp(
        found.confidence + verificationBoost + recoveryBoost + recoveryStabilityBoost - longTailFailureDrag,
        0.05,
        0.99,
      );
      if (input.verificationPass && found.conflictCount > 0) {
        found.conflictCount = Math.max(0, found.conflictCount - 1);
      }
      if (
        found.state === "quarantined"
        && found.conflictCount === 0
        && found.consecutiveFailureCount === 0
        && found.confidence >= 0.56
      ) {
        found.state = "active";
        found.lastConflictAt = undefined;
      }
      found.reuseGuardrails = uniqueTrimmed(
        [...found.reuseGuardrails, ...deriveReuseGuardrails(found.failureSignals, found.conflictSignals)],
        MAX_GUARDRAILS,
      );
      found.attemptHistory = appendAttempt(found.attemptHistory, successAttempt);
      found.evidence = [evidence, ...found.evidence].slice(0, MAX_EVIDENCE);
      this.touchSnapshot();
      sortRecordsInPlace(this.snapshot.records);
      this.persist();
      return {
        record: cloneRecord(found),
        created: false,
      };
    }

    const initialFailureSignals = extractFailureSignals(input.assistantText);
    const initialGuardrails = deriveReuseGuardrails(initialFailureSignals, []);
    const next: ExperienceRecord = {
      id: recordId,
      tenant: input.tenant,
      team: input.team,
      user: input.user,
      signature,
      taskSignature,
      taskType: normalizeTaskType(taskType),
      scenarioTags,
      summary: deriveSummary(input.userText),
      keywords,
      sop,
      failureSignals: initialFailureSignals,
      reuseGuardrails: initialGuardrails,
      attemptHistory: [successAttempt],
      confidence: input.verificationPass ? 0.64 : 0.52,
      successCount: 1,
      failureCount: 0,
      recoverySuccessCount: 0,
      consecutiveFailureCount: 0,
      conflictCount: 0,
      verificationPassCount: input.verificationPass ? 1 : 0,
      lastOutcome: "success",
      lastFailureClass: undefined,
      lastFailureStage: undefined,
      lastSuccessStrategy: successStrategy,
      state: "active",
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
      conflictSignals: [],
      evidence: [evidence],
    };
    this.snapshot.records.push(next);
    this.touchSnapshot();
    sortRecordsInPlace(this.snapshot.records);
    this.persist();
    return {
      record: cloneRecord(next),
      created: true,
    };
  }

  public registerFailure(input: ExperienceFeedbackFailureInput): ExperienceFailureResult {
    const profile = buildQueryProfile(input.userText);
    const candidates = this.snapshot.records
      .filter((record) => record.tenant === input.tenant)
      .filter((record) => record.team === input.team)
      .filter((record) => record.user === input.user)
      .filter((record) => record.state === "active" || record.state === "quarantined")
      .map((record) => {
        const scored = scoreRecordForQuery(record, profile);
        const taskOverlap = computeTokenOverlap(profile.taskTokens, extractTokens(record.taskSignature));
        const scenarioOverlap = computeTokenOverlap(profile.scenarioTags, record.scenarioTags);
        const adjustedScore = scored.score + (taskOverlap * 8) + (scenarioOverlap * 6);
        return {
          ...scored,
          adjustedScore: Number(adjustedScore.toFixed(4)),
        };
      })
      .sort((left, right) => right.adjustedScore - left.adjustedScore);

    const best = candidates[0];
    if (!best || best.adjustedScore < 38) {
      return {
        quarantined: false,
      };
    }

    const found = this.snapshot.records.find((record) => record.id === best.record.id);
    if (!found) {
      return {
        quarantined: false,
      };
    }

    const now = nowIso();
    const failureStage = deriveFailureStage(input.errorClass, input.errorMessage, input.failureStage);
    const failureSignal = buildFailureSignal({
      stage: failureStage,
      errorClass: input.errorClass,
      errorMessage: input.errorMessage,
    });
    const conflictSignal = deriveConflictSignal(input.errorClass, input.errorMessage);
    const failureAttempt: ExperienceAttemptRecord = {
      capturedAt: now,
      outcome: "failure",
      stage: failureStage,
      providerName: input.providerName,
      errorClass: compactWhitespace(input.errorClass).slice(0, 120) || "unknown_error",
      errorMessage: compactWhitespace(input.errorMessage).slice(0, 220),
      toolContext: input.toolContext ? compactWhitespace(input.toolContext).slice(0, 160) : undefined,
    };
    found.failureCount += 1;
    found.lastOutcome = "failure";
    found.lastUsedAt = now;
    found.updatedAt = now;
    found.lastFailureClass = failureAttempt.errorClass;
    found.lastFailureStage = failureStage;
    found.scenarioTags = uniqueTrimmed(
      [...found.scenarioTags, ...deriveScenarioTags(`${input.userText} ${input.errorClass} ${input.errorMessage}`)],
      MAX_SCENARIO_TAGS,
    );
    if (found.taskType === "general_task" && profile.taskType !== "general_task") {
      found.taskType = profile.taskType;
    }
    if (!found.taskSignature || found.taskSignature === "general_task") {
      found.taskSignature = profile.taskSignature;
    }
    if (failureSignal) {
      found.failureSignals = uniqueTrimmed([failureSignal, ...found.failureSignals], MAX_FAILURE_SIGNALS);
    }
    found.attemptHistory = appendAttempt(found.attemptHistory, failureAttempt);
    found.consecutiveFailureCount = computeConsecutiveFailureCount(found.attemptHistory);
    found.confidence = clamp(
      found.confidence - (0.09 + Math.min(0.2, found.consecutiveFailureCount * 0.03)),
      0.01,
      0.99,
    );
    found.evidence = [
      {
        source: "turn_failure" as const,
        providerName: input.providerName,
        errorClass: failureAttempt.errorClass,
        capturedAt: now,
        evidenceRef: {
          sourceType: "turn_failure",
          capturedAt: now,
        },
      },
      ...found.evidence,
    ].slice(0, MAX_EVIDENCE);

    let conflictIsolated = false;
    if (conflictSignal) {
      found.conflictCount += 1;
      found.lastConflictAt = now;
      found.conflictSignals = uniqueTrimmed([conflictSignal, ...found.conflictSignals], MAX_CONFLICT_SIGNALS);
      if (found.state === "active") {
        found.state = "quarantined";
        conflictIsolated = true;
      }
    }

    found.reuseGuardrails = uniqueTrimmed(
      [...found.reuseGuardrails, ...deriveReuseGuardrails(found.failureSignals, found.conflictSignals)],
      MAX_GUARDRAILS,
    );

    let quarantined = false;
    if (
      found.state === "active"
      && (
        (found.consecutiveFailureCount >= 2 && found.confidence <= 0.45)
        || (found.failureCount >= 4 && found.confidence <= 0.34)
      )
    ) {
      found.state = "quarantined";
      quarantined = true;
    }
    if (conflictIsolated) {
      quarantined = true;
    }

    this.touchSnapshot();
    sortRecordsInPlace(this.snapshot.records);
    this.persist();
    return {
      matchedRecord: cloneRecord(found),
      score: best.adjustedScore,
      quarantined,
      conflictIsolated,
    };
  }

  private touchSnapshot(): void {
    this.snapshot.updatedAt = nowIso();
  }

  private readSnapshotFrom(path: string): ExperiencePoolSnapshot {
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return parseSnapshot(parsed);
    } catch {
      return createEmptySnapshot();
    }
  }

  private readSnapshot(): ExperiencePoolSnapshot {
    if (existsSync(this.path)) {
      return this.readSnapshotFrom(this.path);
    }
    if (this.legacyPath && existsSync(this.legacyPath)) {
      const migrated = this.readSnapshotFrom(this.legacyPath);
      if (migrated.records.length > 0) {
        this.snapshot = migrated;
        this.touchSnapshot();
        this.persist();
        return this.snapshot;
      }
    }
    return createEmptySnapshot();
  }

  private persist(): void {
    mkdirSync(parentDirectory(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(this.snapshot, undefined, 2)}\n`, "utf8");
  }
}
