import { createHash } from "node:crypto";
import {
  MAX_CONFLICT_SIGNALS,
  MAX_FAILURE_SIGNALS,
  MAX_GUARDRAILS,
  MAX_SCENARIO_TAGS,
  MAX_SOP_STEPS,
  SCENARIO_TAG_RULES,
  TASK_TYPE_RULES,
} from "./constants";
import {
  type ExperienceAttemptStage,
} from "../types";
import {
  compactWhitespace,
  extractTokens,
  normalizeTag,
  normalizeTaskType,
  uniqueTrimmed,
} from "./utils";

export function deriveSignature(userText: string): string {
  const tokens = extractTokens(userText).slice(0, 8);
  if (tokens.length > 0) {
    return tokens.join(" ");
  }
  return compactWhitespace(userText).slice(0, 96);
}

export function deriveTaskType(raw: string): string {
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

export function deriveScenarioTags(raw: string): string[] {
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

export function deriveTaskSignature(userText: string, assistantText: string): string {
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

export function deriveSummary(userText: string): string {
  const summary = compactWhitespace(userText);
  if (!summary) {
    return "unspecified task";
  }
  return summary.length <= 120 ? summary : `${summary.slice(0, 120)}...`;
}

export function extractSopSteps(assistantText: string): string[] {
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

export function extractFailureSignals(text: string): string[] {
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

export function deriveSuccessStrategy(assistantText: string, sop: readonly string[]): string | undefined {
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

export function deriveFailureStage(
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

export function deriveConflictSignal(errorClass: string, errorMessage: string): string | undefined {
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

export function deriveReuseGuardrails(
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

export function signatureHash(tenant: string, team: string, user: string, signature: string): string {
  return createHash("sha1")
    .update(`${tenant}::${team}::${user}::${signature}`)
    .digest("hex")
    .slice(0, 20);
}

export function buildFailureSignal(input: {
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
