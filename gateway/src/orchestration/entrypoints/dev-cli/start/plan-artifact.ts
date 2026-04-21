import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { removeTrailingSlashes } from "../services/runtime-paths";

export type PlanArtifactStatus =
  | "draft"
  | "blocked"
  | "review_failed"
  | "ready"
  | "approved"
  | "applying"
  | "apply_failed"
  | "applied"
  | "discarded";

export interface PlanArtifactEntry {
  plan_id: string;
  seq: number;
  title: string;
  task_slug: string;
  filename: string;
  status: PlanArtifactStatus;
  created_at: string;
  updated_at: string;
  reviewed_at?: string;
  review_fail_count?: number;
  blocked_count?: number;
  apply_started_at?: string;
  approved_at?: string;
  approved_hash?: string;
  approval_ticket_id?: string;
  approved_snapshot_path?: string;
  approved_by?: string;
  apply_failed_at?: string;
  applied_at?: string;
  discarded_at?: string;
}

export interface PlanArtifactIndex {
  version: number;
  session_id: string;
  active_plan_id?: string;
  updated_at: string;
  entries: PlanArtifactEntry[];
}

export interface CreatedPlanArtifact {
  index: PlanArtifactIndex;
  entry: PlanArtifactEntry;
  planPath: string;
  sessionPlanDir: string;
}

export interface ActivePlanArtifact {
  index: PlanArtifactIndex;
  entry: PlanArtifactEntry;
  planPath: string;
  content: string;
  sessionPlanDir: string;
}

export interface PlanArtifactEvent {
  at: string;
  event: string;
  session_id: string;
  plan_id?: string;
  source?: "cli" | "bridge" | "system";
  detail?: string;
  status_from?: PlanArtifactStatus;
  status_to?: PlanArtifactStatus;
}

export interface PlanReviewFinding {
  code: string;
  section?: string;
  message: string;
}

export interface PlanReviewResult {
  ok: boolean;
  blocked: boolean;
  findings: PlanReviewFinding[];
  checked_at: string;
}

export interface PlanApprovalResult {
  approved: boolean;
  entry?: PlanArtifactEntry;
  planHash?: string;
  ticketId?: string;
  snapshotPath?: string;
}

const PLAN_ARTIFACT_INDEX_VERSION = 2;
const PLAN_PROGRESS_SECTION = "## Progress Log";
const PLAN_LOCK_WAIT_MS = 20;
const PLAN_LOCK_TIMEOUT_MS = 4_000;
const PLAN_LOCK_STALE_MS = 30_000;
const PLAN_EVENTS_DEFAULT_MAX_BYTES = 1_048_576;
const PLAN_EVENTS_DEFAULT_ROTATE_KEEP = 5;
const PLAN_APPLY_STALE_DEFAULT_MS = 10 * 60 * 1000;
const SLEEP_SIGNAL = new Int32Array(new SharedArrayBuffer(4));
const PROPOSED_PLAN_OPEN_TAG = "<proposed_plan>";
const PROPOSED_PLAN_CLOSE_TAG = "</proposed_plan>";
const REQUIRED_PLAN_SECTIONS = [
  "Goal",
  "Scope In",
  "Scope Out",
  "Milestones",
  "Validation",
  "Risk & Rollback",
] as const;

function nowIsoUtc(): string {
  return new Date().toISOString();
}

function removeDangerousChars(value: string): string {
  return value
    .replace(/[`*_#<>{}\[\]()|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeSegment(raw: string, fallback: string, maxLen = 64): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/g, "")
    .replace(/-+$/g, "");
  const finalValue = normalized.length > 0 ? normalized : fallback;
  return finalValue.slice(0, Math.max(1, maxLen));
}

function compactSingleLine(raw: string, maxLen: number): string {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLen) {
    return compact;
  }
  return `${compact.slice(0, Math.max(1, maxLen)).trimEnd()}…`;
}

function dirname(path: string): string {
  const normalized = removeTrailingSlashes(path);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function writeFileAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now().toString(36)}-${Math.floor(Math.random() * 65_536).toString(16)}`;
  writeFileSync(tempPath, content, "utf8");
  try {
    renameSync(tempPath, path);
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // ignore temp cleanup errors
    }
    throw error;
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (typeof raw !== "string") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function sessionPlanDir(workDir: string, sessionId: string): string {
  const root = removeTrailingSlashes(workDir);
  const safeSessionId = sanitizeSegment(sessionId, "main", 64);
  return `${root}/.grobot/plans/${safeSessionId}`;
}

function planLockPath(workDir: string, sessionId: string): string {
  return `${sessionPlanDir(workDir, sessionId)}/.plan-artifact.lock`;
}

function sleepBlocking(ms: number): void {
  Atomics.wait(SLEEP_SIGNAL, 0, 0, ms);
}

function lockAgeMs(lockPath: string, nowMs: number): number | undefined {
  try {
    const stats = statSync(lockPath);
    return nowMs - stats.mtimeMs;
  } catch {
    return undefined;
  }
}

function withSessionPlanLock<T>(workDir: string, sessionId: string, task: () => T): T {
  mkdirSync(sessionPlanDir(workDir, sessionId), { recursive: true });
  const lockPath = planLockPath(workDir, sessionId);
  const deadline = Date.now() + PLAN_LOCK_TIMEOUT_MS;
  while (true) {
    try {
      mkdirSync(lockPath, { recursive: false });
      break;
    } catch (error) {
      const errno = error as Error & { code?: string };
      if (errno.code !== "EEXIST") {
        throw error;
      }
      const nowMs = Date.now();
      const age = lockAgeMs(lockPath, nowMs);
      if (typeof age === "number" && age > PLAN_LOCK_STALE_MS) {
        try {
          rmSync(lockPath, { recursive: true, force: true });
        } catch {
          // ignore stale-lock cleanup errors; retry acquisition
        }
      }
      if (nowMs >= deadline) {
        throw new Error(`plan artifact lock timeout: ${lockPath}`);
      }
      sleepBlocking(PLAN_LOCK_WAIT_MS);
    }
  }
  try {
    return task();
  } finally {
    try {
      rmSync(lockPath, { recursive: true, force: true });
    } catch {
      // ignore lock cleanup errors
    }
  }
}

function planIndexPath(workDir: string, sessionId: string): string {
  return `${sessionPlanDir(workDir, sessionId)}/index.json`;
}

function activePlanPath(workDir: string, sessionId: string): string {
  return `${sessionPlanDir(workDir, sessionId)}/ACTIVE.md`;
}

function planEventsPath(workDir: string, sessionId: string): string {
  return `${sessionPlanDir(workDir, sessionId)}/events.jsonl`;
}

function rotatePlanEventsIfNeeded(path: string): void {
  const maxBytes = parsePositiveInt(process.env.GROBOT_PLAN_EVENTS_MAX_BYTES, PLAN_EVENTS_DEFAULT_MAX_BYTES);
  const rotateKeep = Math.max(1, parsePositiveInt(process.env.GROBOT_PLAN_EVENTS_ROTATE_KEEP, PLAN_EVENTS_DEFAULT_ROTATE_KEEP));
  if (!existsSync(path)) {
    return;
  }
  let size = 0;
  try {
    const stats = statSync(path) as unknown as { size?: number };
    size = typeof stats.size === "number" ? stats.size : 0;
  } catch {
    return;
  }
  if (size < maxBytes) {
    return;
  }
  for (let index = rotateKeep - 1; index >= 1; index -= 1) {
    const source = `${path}.${String(index)}`;
    const target = `${path}.${String(index + 1)}`;
    if (!existsSync(source)) {
      continue;
    }
    try {
      renameSync(source, target);
    } catch {
      // ignore best-effort rotation failures
    }
  }
  try {
    renameSync(path, `${path}.1`);
  } catch {
    // ignore rotation failures and continue writing current file
  }
}

function appendPlanEventUnlocked(
  workDir: string,
  sessionId: string,
  event: Omit<PlanArtifactEvent, "at" | "session_id"> & {
    at?: string;
    session_id?: string;
  },
): PlanArtifactEvent {
  const record: PlanArtifactEvent = {
    at: event.at ?? nowIsoUtc(),
    event: event.event,
    session_id: event.session_id ?? sessionId,
    plan_id: event.plan_id,
    source: event.source,
    detail: event.detail,
    status_from: event.status_from,
    status_to: event.status_to,
  };
  const path = planEventsPath(workDir, sessionId);
  const serialized = `${JSON.stringify(record)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  rotatePlanEventsIfNeeded(path);
  const appendWrite = writeFileSync as unknown as (
    path: string,
    data: string,
    options: { encoding: "utf8"; flag: string },
  ) => void;
  appendWrite(path, serialized, { encoding: "utf8", flag: "a" });
  return record;
}

export function appendPlanEvent(
  workDir: string,
  sessionId: string,
  event: Omit<PlanArtifactEvent, "at" | "session_id"> & {
    at?: string;
    session_id?: string;
  },
): PlanArtifactEvent {
  return withSessionPlanLock(workDir, sessionId, () =>
    appendPlanEventUnlocked(workDir, sessionId, event));
}

function buildDefaultIndex(sessionId: string): PlanArtifactIndex {
  return {
    version: PLAN_ARTIFACT_INDEX_VERSION,
    session_id: sessionId,
    updated_at: nowIsoUtc(),
    entries: [],
  };
}

function normalizeStatus(raw: unknown): PlanArtifactStatus {
  if (raw === "blocked") {
    return "blocked";
  }
  if (raw === "review_failed") {
    return "review_failed";
  }
  if (raw === "ready") {
    return "ready";
  }
  if (raw === "approved") {
    return "approved";
  }
  if (raw === "applying") {
    return "applying";
  }
  if (raw === "apply_failed") {
    return "apply_failed";
  }
  if (raw === "applied") {
    return "applied";
  }
  if (raw === "discarded") {
    return "discarded";
  }
  return "draft";
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.max(0, Math.floor(value));
  return normalized;
}

function normalizeEntry(raw: Record<string, unknown>): PlanArtifactEntry | undefined {
  const planId = typeof raw.plan_id === "string" ? raw.plan_id.trim() : "";
  const seq = typeof raw.seq === "number" && Number.isFinite(raw.seq) ? Math.max(1, Math.floor(raw.seq)) : 0;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const taskSlug = typeof raw.task_slug === "string" ? raw.task_slug.trim() : "";
  const filename = typeof raw.filename === "string" ? raw.filename.trim() : "";
  if (!planId || seq <= 0 || !title || !taskSlug || !filename) {
    return undefined;
  }
  const createdAt = normalizeOptionalString(raw.created_at) ?? nowIsoUtc();
  const updatedAt = normalizeOptionalString(raw.updated_at) ?? createdAt;
  return {
    plan_id: planId,
    seq,
    title,
    task_slug: taskSlug,
    filename,
    status: normalizeStatus(raw.status),
    created_at: createdAt,
    updated_at: updatedAt,
    reviewed_at: normalizeOptionalString(raw.reviewed_at),
    review_fail_count: normalizeOptionalCount(raw.review_fail_count),
    blocked_count: normalizeOptionalCount(raw.blocked_count),
    apply_started_at: normalizeOptionalString(raw.apply_started_at),
    approved_at: normalizeOptionalString(raw.approved_at),
    approved_hash: normalizeOptionalString(raw.approved_hash),
    approval_ticket_id: normalizeOptionalString(raw.approval_ticket_id),
    approved_snapshot_path: normalizeOptionalString(raw.approved_snapshot_path),
    approved_by: normalizeOptionalString(raw.approved_by),
    apply_failed_at: normalizeOptionalString(raw.apply_failed_at),
    applied_at: normalizeOptionalString(raw.applied_at),
    discarded_at: normalizeOptionalString(raw.discarded_at),
  };
}

function normalizeIndex(raw: Record<string, unknown> | undefined, sessionId: string): PlanArtifactIndex {
  if (!raw) {
    return buildDefaultIndex(sessionId);
  }
  const entriesRaw = Array.isArray(raw.entries) ? raw.entries : [];
  const entries: PlanArtifactEntry[] = [];
  for (const item of entriesRaw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }
    const normalized = normalizeEntry(item as Record<string, unknown>);
    if (normalized) {
      entries.push(normalized);
    }
  }
  const activePlanIdRaw = typeof raw.active_plan_id === "string" ? raw.active_plan_id.trim() : "";
  const activePlanId = activePlanIdRaw.length > 0 ? activePlanIdRaw : undefined;
  const updatedAt = normalizeOptionalString(raw.updated_at) ?? nowIsoUtc();
  return {
    version: PLAN_ARTIFACT_INDEX_VERSION,
    session_id: sessionId,
    active_plan_id: activePlanId,
    updated_at: updatedAt,
    entries,
  };
}

function writeIndex(workDir: string, sessionId: string, index: PlanArtifactIndex): void {
  const normalized: PlanArtifactIndex = {
    ...index,
    version: PLAN_ARTIFACT_INDEX_VERSION,
    updated_at: nowIsoUtc(),
  };
  writeFileAtomic(planIndexPath(workDir, sessionId), `${JSON.stringify(normalized, undefined, 2)}\n`);
}

function planPathFromEntry(workDir: string, sessionId: string, entry: PlanArtifactEntry): string {
  return `${sessionPlanDir(workDir, sessionId)}/${entry.filename}`;
}

function syncActiveFile(workDir: string, sessionId: string, content: string): void {
  writeFileAtomic(activePlanPath(workDir, sessionId), content);
}

function buildPlanId(): string {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear().toString().padStart(4, "0"),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ].join("");
  const random = Math.floor(Math.random() * 65536).toString(16).padStart(4, "0");
  return `p${stamp}-${random}`;
}

function buildApprovalTicketId(): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((item) => item.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function nextSeq(index: PlanArtifactIndex): number {
  let maxSeq = 0;
  for (const item of index.entries) {
    if (item.seq > maxSeq) {
      maxSeq = item.seq;
    }
  }
  return maxSeq + 1;
}

function buildPlanMarkdown(args: {
  title: string;
  goal: string;
  sessionId: string;
  planId: string;
  seq: number;
}): string {
  const createdAt = nowIsoUtc();
  const safeGoal = removeDangerousChars(args.goal);
  return [
    `# ${removeDangerousChars(args.title)}`,
    "",
    `- session_id: ${args.sessionId}`,
    `- plan_id: ${args.planId}`,
    `- seq: ${String(args.seq)}`,
    `- status: draft`,
    `- created_at: ${createdAt}`,
    `- updated_at: ${createdAt}`,
    "",
    "## Goal",
    "",
    safeGoal,
    "",
    "## Scope In",
    "",
    "- __REQUIRED__: 具体改动范围（模块/文件）。",
    "",
    "## Scope Out",
    "",
    "- __REQUIRED__: 明确不改动范围。",
    "",
    "## Context Snapshot",
    "",
    "- __REQUIRED__: 当前实现现状、关键约束、依赖。",
    "",
    "## Milestones",
    "",
    "1. [ ] __REQUIRED__: 里程碑名称",
    "   - 完成判据: __REQUIRED__",
    "   - 验证: __REQUIRED__",
    "   - 回退: __REQUIRED__",
    "",
    "## Validation",
    "",
    "- __REQUIRED__: 验证命令与预期结果。",
    "",
    "## Risk & Rollback",
    "",
    "- 风险: __REQUIRED__",
    "- 回退: __REQUIRED__",
    "",
    "## Decision Log",
    "",
    `- ${createdAt} 初始化计划。`,
    "",
    PLAN_PROGRESS_SECTION,
    "",
    `- ${createdAt} 创建计划工件。`,
    "",
  ].join("\n");
}

function stripMarkdownNoise(sectionBody: string): string[] {
  return sectionBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter((line) => line.length > 0);
}

function extractSection(markdown: string, sectionTitle: string): string | undefined {
  const escaped = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexp = new RegExp(`(^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "m");
  const match = regexp.exec(markdown);
  if (!match) {
    return undefined;
  }
  return match[2] ?? "";
}

function findPlaceholder(text: string): string | undefined {
  const placeholders = [
    "__REQUIRED__",
    "待补充",
    "TBD",
    "TODO",
    "请补充",
    "to be filled",
  ];
  for (const token of placeholders) {
    if (text.toLowerCase().includes(token.toLowerCase())) {
      return token;
    }
  }
  return undefined;
}

function hasUnresolvedQuestion(text: string): boolean {
  return (
    /\[ASK\]/i.test(text) ||
    /待确认|待决定/i.test(text) ||
    /\?\?/g.test(text)
  );
}

export function extractLatestProposedPlanBlock(markdown: string): string | undefined {
  const lines = markdown.split(/\r?\n/);
  const blocks: string[] = [];
  let activeBlockLines: string[] | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === PROPOSED_PLAN_OPEN_TAG) {
      activeBlockLines = [];
      continue;
    }
    if (trimmed === PROPOSED_PLAN_CLOSE_TAG) {
      const candidate = activeBlockLines?.join("\n").trim();
      if (candidate) {
        blocks.push(candidate);
      }
      activeBlockLines = undefined;
      continue;
    }
    if (activeBlockLines) {
      activeBlockLines.push(line);
    }
  }
  const unterminatedCandidate = activeBlockLines?.join("\n").trim();
  if (unterminatedCandidate) {
    blocks.push(unterminatedCandidate);
  }
  if (blocks.length === 0) {
    return undefined;
  }
  return blocks[blocks.length - 1];
}

function hasSectionHeading(markdown: string, matcher: RegExp): boolean {
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trimStart().startsWith("##")) {
      continue;
    }
    if (matcher.test(line)) {
      return true;
    }
  }
  return false;
}

function reviewProposedPlanContent(proposedPlanContent: string): PlanReviewResult {
  const findings: PlanReviewFinding[] = [];
  const checkedAt = nowIsoUtc();
  const normalized = proposedPlanContent.trim();
  if (!normalized) {
    findings.push({
      code: "proposed_plan_empty",
      section: "proposed_plan",
      message: "提取到的 <proposed_plan> 为空。",
    });
  }
  const placeholder = findPlaceholder(normalized);
  if (placeholder) {
    findings.push({
      code: "placeholder_detected",
      section: "proposed_plan",
      message: `计划仍含占位词(${placeholder})。`,
    });
  }
  if (hasUnresolvedQuestion(normalized)) {
    findings.push({
      code: "unresolved_question",
      section: "proposed_plan",
      message: "计划存在未决问题，需先澄清。",
    });
  }
  if (normalized.length > 0 && normalized.length < 120) {
    findings.push({
      code: "proposed_plan_too_short",
      section: "proposed_plan",
      message: "计划内容过短，无法支撑可执行实现。",
    });
  }
  const hasSummary = hasSectionHeading(normalized, /^##\s*(summary|概要|概述|摘要)\b/i);
  const hasKeyChanges = hasSectionHeading(
    normalized,
    /^##\s*(key changes?|implementation changes?|重要变更|实现变更)\b/i,
  );
  const hasTestPlan = hasSectionHeading(
    normalized,
    /^##\s*(test plan|tests?|test cases?|验证计划|测试计划|测试用例)\b/i,
  );
  const hasAssumptions = hasSectionHeading(
    normalized,
    /^##\s*(assumptions?|默认假设|假设)\b/i,
  );
  if (!hasSummary) {
    findings.push({
      code: "proposed_plan_missing_section",
      section: "Summary",
      message: "缺少 Summary 章节。",
    });
  }
  if (!hasKeyChanges) {
    findings.push({
      code: "proposed_plan_missing_section",
      section: "Key Changes",
      message: "缺少 Key Changes/Implementation Changes 章节。",
    });
  }
  if (!hasTestPlan) {
    findings.push({
      code: "proposed_plan_missing_section",
      section: "Test Plan",
      message: "缺少 Test Plan/Tests 章节。",
    });
  }
  if (!hasAssumptions) {
    findings.push({
      code: "proposed_plan_missing_section",
      section: "Assumptions",
      message: "缺少 Assumptions 章节。",
    });
  }
  const blocked = findings.some((item) => item.code === "unresolved_question");
  const ok = findings.length === 0;
  return {
    ok,
    blocked,
    findings,
    checked_at: checkedAt,
  };
}

export function reviewPlanContent(planContent: string): PlanReviewResult {
  const proposedPlan = extractLatestProposedPlanBlock(planContent);
  if (proposedPlan) {
    return reviewProposedPlanContent(proposedPlan);
  }
  const findings: PlanReviewFinding[] = [];
  const checkedAt = nowIsoUtc();
  const sectionMap = new Map<string, string>();

  for (const sectionName of REQUIRED_PLAN_SECTIONS) {
    const body = extractSection(planContent, sectionName);
    if (typeof body !== "string") {
      findings.push({
        code: "missing_section",
        section: sectionName,
        message: `缺少必填章节: ${sectionName}`,
      });
      continue;
    }
    sectionMap.set(sectionName, body);
    const normalizedLines = stripMarkdownNoise(body);
    if (normalizedLines.length === 0) {
      findings.push({
        code: "empty_section",
        section: sectionName,
        message: `章节内容为空: ${sectionName}`,
      });
      continue;
    }
    const placeholder = findPlaceholder(normalizedLines.join("\n"));
    if (placeholder) {
      findings.push({
        code: "placeholder_detected",
        section: sectionName,
        message: `章节仍含占位词(${placeholder}): ${sectionName}`,
      });
    }
    if (hasUnresolvedQuestion(normalizedLines.join("\n"))) {
      findings.push({
        code: "unresolved_question",
        section: sectionName,
        message: `章节存在未决问题，需先澄清: ${sectionName}`,
      });
    }
  }

  const milestones = sectionMap.get("Milestones");
  if (typeof milestones === "string") {
    const milestoneLines = milestones.split("\n").filter((line) => /^\s*\d+\.\s+/.test(line));
    if (milestoneLines.length === 0) {
      findings.push({
        code: "milestones_missing_items",
        section: "Milestones",
        message: "Milestones 至少需要 1 条编号里程碑。",
      });
    }
    if (!/完成判据/.test(milestones)) {
      findings.push({
        code: "milestones_missing_done_criteria",
        section: "Milestones",
        message: "Milestones 缺少“完成判据”。",
      });
    }
    if (!/验证/.test(milestones)) {
      findings.push({
        code: "milestones_missing_validation",
        section: "Milestones",
        message: "Milestones 缺少“验证”。",
      });
    }
    if (!/回退/.test(milestones)) {
      findings.push({
        code: "milestones_missing_rollback",
        section: "Milestones",
        message: "Milestones 缺少“回退”。",
      });
    }
  }

  const validation = sectionMap.get("Validation");
  if (typeof validation === "string") {
    const hasValidationItems = validation
      .split("\n")
      .some((line) => /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line));
    if (!hasValidationItems) {
      findings.push({
        code: "validation_missing_items",
        section: "Validation",
        message: "Validation 至少需要 1 条可执行验证项。",
      });
    }
  }

  const blocked = findings.some((item) => item.code === "unresolved_question");
  const ok = findings.length === 0;
  return {
    ok,
    blocked,
    findings,
    checked_at: checkedAt,
  };
}

function clearApprovalFields(entry: PlanArtifactEntry): PlanArtifactEntry {
  return {
    ...entry,
    approved_hash: undefined,
    approval_ticket_id: undefined,
    approved_snapshot_path: undefined,
    approved_by: undefined,
  };
}

export function loadPlanArtifactIndex(workDir: string, sessionId: string): PlanArtifactIndex {
  const raw = readJsonObject(planIndexPath(workDir, sessionId));
  return normalizeIndex(raw, sessionId);
}

export function createPlanArtifact(workDir: string, sessionId: string, goal: string): CreatedPlanArtifact {
  return withSessionPlanLock(workDir, sessionId, () => {
    const index = loadPlanArtifactIndex(workDir, sessionId);
    const seq = nextSeq(index);
    const planId = buildPlanId();
    const title = compactSingleLine(goal, 96);
    const taskSlug = sanitizeSegment(goal, "plan-task", 48);
    const filename = `${String(seq).padStart(3, "0")}-${taskSlug}--${planId}.md`;
    const entry: PlanArtifactEntry = {
      plan_id: planId,
      seq,
      title,
      task_slug: taskSlug,
      filename,
      status: "draft",
      created_at: nowIsoUtc(),
      updated_at: nowIsoUtc(),
    };
    const planPath = planPathFromEntry(workDir, sessionId, entry);
    const markdown = buildPlanMarkdown({
      title,
      goal,
      sessionId,
      planId,
      seq,
    });
    writeFileAtomic(planPath, markdown);
    syncActiveFile(workDir, sessionId, markdown);
    const nextIndex: PlanArtifactIndex = {
      ...index,
      active_plan_id: planId,
      entries: [...index.entries, entry],
      updated_at: nowIsoUtc(),
    };
    writeIndex(workDir, sessionId, nextIndex);
    appendPlanEventUnlocked(workDir, sessionId, {
      event: "plan_created",
      plan_id: planId,
      source: "system",
      status_to: "draft",
      detail: "plan artifact created",
    });
    return {
      index: nextIndex,
      entry,
      planPath,
      sessionPlanDir: sessionPlanDir(workDir, sessionId),
    };
  });
}

export function loadActivePlanArtifact(workDir: string, sessionId: string): ActivePlanArtifact | undefined {
  const index = loadPlanArtifactIndex(workDir, sessionId);
  const activePlanId = index.active_plan_id;
  if (!activePlanId) {
    return undefined;
  }
  const entry = index.entries.find((item) => item.plan_id === activePlanId);
  if (!entry) {
    return undefined;
  }
  const planPath = planPathFromEntry(workDir, sessionId, entry);
  const content = readText(planPath);
  if (typeof content !== "string") {
    return undefined;
  }
  syncActiveFile(workDir, sessionId, content);
  return {
    index,
    entry,
    planPath,
    content,
    sessionPlanDir: sessionPlanDir(workDir, sessionId),
  };
}

export function appendPlanProgressNote(workDir: string, sessionId: string, planId: string, note: string): {
  updated: boolean;
  planPath?: string;
} {
  return withSessionPlanLock(workDir, sessionId, () => {
    const index = loadPlanArtifactIndex(workDir, sessionId);
    const entryIndex = index.entries.findIndex((item) => item.plan_id === planId);
    if (entryIndex < 0) {
      return { updated: false };
    }
    const entry = index.entries[entryIndex];
    const planPath = planPathFromEntry(workDir, sessionId, entry);
    const current = readText(planPath);
    if (typeof current !== "string") {
      return { updated: false };
    }
    const timestamp = nowIsoUtc();
    const safeNote = removeDangerousChars(note);
    const progressLine = `- ${timestamp} ${safeNote}`;
    let updatedContent = current;
    if (current.includes(PLAN_PROGRESS_SECTION)) {
      updatedContent = `${current.trimEnd()}\n${progressLine}\n`;
    } else {
      updatedContent = `${current.trimEnd()}\n\n${PLAN_PROGRESS_SECTION}\n\n${progressLine}\n`;
    }
    writeFileAtomic(planPath, updatedContent);
    syncActiveFile(workDir, sessionId, updatedContent);

    const nextStatus: PlanArtifactStatus =
      entry.status === "applied" || entry.status === "discarded"
        ? entry.status
        : "draft";
    const invalidatedApproval = Boolean(entry.approved_hash || entry.approval_ticket_id);
    const updatedEntry: PlanArtifactEntry = clearApprovalFields({
      ...entry,
      status: nextStatus,
      updated_at: timestamp,
    });
    const nextEntries = [...index.entries];
    nextEntries[entryIndex] = updatedEntry;
    writeIndex(workDir, sessionId, {
      ...index,
      entries: nextEntries,
      active_plan_id: planId,
      updated_at: timestamp,
    });
    appendPlanEventUnlocked(workDir, sessionId, {
      event: "plan_progress_appended",
      plan_id: planId,
      source: "system",
      detail: safeNote,
    });
    if (invalidatedApproval) {
      appendPlanEventUnlocked(workDir, sessionId, {
        event: "plan_approval_invalidated",
        plan_id: planId,
        source: "system",
        detail: "plan content changed after approval metadata existed",
      });
    }
    return { updated: true, planPath };
  });
}

export function replacePlanArtifactContent(
  workDir: string,
  sessionId: string,
  planId: string,
  nextContentRaw: string,
  options?: {
    source?: "cli" | "bridge" | "system";
    detail?: string;
  },
): {
  updated: boolean;
  replaced: boolean;
  planPath?: string;
} {
  return withSessionPlanLock(workDir, sessionId, () => {
    const index = loadPlanArtifactIndex(workDir, sessionId);
    const entryIndex = index.entries.findIndex((item) => item.plan_id === planId);
    if (entryIndex < 0) {
      return { updated: false, replaced: false };
    }
    const entry = index.entries[entryIndex];
    const planPath = planPathFromEntry(workDir, sessionId, entry);
    const nextContent = nextContentRaw.trim();
    if (!nextContent) {
      return { updated: false, replaced: false, planPath };
    }
    const currentContent = readText(planPath);
    if (typeof currentContent !== "string") {
      return { updated: false, replaced: false, planPath };
    }
    if (currentContent.trim() === nextContent) {
      syncActiveFile(workDir, sessionId, currentContent);
      return { updated: true, replaced: false, planPath };
    }

    const timestamp = nowIsoUtc();
    const persistedContent = `${nextContent}\n`;
    writeFileAtomic(planPath, persistedContent);
    syncActiveFile(workDir, sessionId, persistedContent);

    const invalidatedApproval = Boolean(
      entry.approved_hash || entry.approval_ticket_id || entry.approved_snapshot_path,
    );
    const nextStatus: PlanArtifactStatus =
      entry.status === "applied" || entry.status === "discarded"
        ? entry.status
        : "draft";
    const updatedEntry: PlanArtifactEntry = clearApprovalFields({
      ...entry,
      status: nextStatus,
      updated_at: timestamp,
    });
    const nextEntries = [...index.entries];
    nextEntries[entryIndex] = updatedEntry;
    writeIndex(workDir, sessionId, {
      ...index,
      entries: nextEntries,
      active_plan_id: planId,
      updated_at: timestamp,
    });
    appendPlanEventUnlocked(workDir, sessionId, {
      event: "plan_content_replaced",
      plan_id: planId,
      source: options?.source ?? "system",
      detail:
        options?.detail ??
        `replaced plan content chars=${String(nextContent.length)}`,
    });
    if (invalidatedApproval) {
      appendPlanEventUnlocked(workDir, sessionId, {
        event: "plan_approval_invalidated",
        plan_id: planId,
        source: options?.source ?? "system",
        detail: "plan content replaced after approval metadata existed",
      });
    }
    return { updated: true, replaced: true, planPath };
  });
}

export function recordPlanReviewResult(
  workDir: string,
  sessionId: string,
  planId: string,
  review: PlanReviewResult,
  source: "cli" | "bridge" | "system" = "system",
): PlanArtifactEntry | undefined {
  return withSessionPlanLock(workDir, sessionId, () => {
    const index = loadPlanArtifactIndex(workDir, sessionId);
    const entryIndex = index.entries.findIndex((item) => item.plan_id === planId);
    if (entryIndex < 0) {
      return undefined;
    }
    const current = index.entries[entryIndex];
    const timestamp = nowIsoUtc();
    const nextStatus: PlanArtifactStatus = review.ok
      ? "ready"
      : review.blocked
        ? "blocked"
        : "review_failed";
    const nextEntry: PlanArtifactEntry = clearApprovalFields({
      ...current,
      status: nextStatus,
      reviewed_at: timestamp,
      review_fail_count: review.ok ? current.review_fail_count : (current.review_fail_count ?? 0) + 1,
      blocked_count: review.blocked ? (current.blocked_count ?? 0) + 1 : current.blocked_count,
      updated_at: timestamp,
    });
    const nextEntries = [...index.entries];
    nextEntries[entryIndex] = nextEntry;
    writeIndex(workDir, sessionId, {
      ...index,
      entries: nextEntries,
      active_plan_id: planId,
      updated_at: timestamp,
    });
    appendPlanEventUnlocked(workDir, sessionId, {
      event: review.ok ? "plan_review_passed" : "plan_review_failed",
      plan_id: planId,
      source,
      status_from: current.status,
      status_to: nextStatus,
      detail: review.ok
        ? "plan review passed"
        : review.findings.map((item) => `${item.code}:${item.section ?? "global"}`).join(","),
    });
    return nextEntry;
  });
}

export function approvePlanArtifact(
  workDir: string,
  sessionId: string,
  planId: string,
  options?: {
    approvedBy?: string;
    source?: "cli" | "bridge" | "system";
  },
): PlanApprovalResult {
  return withSessionPlanLock(workDir, sessionId, () => {
    const index = loadPlanArtifactIndex(workDir, sessionId);
    const entryIndex = index.entries.findIndex((item) => item.plan_id === planId);
    if (entryIndex < 0) {
      return { approved: false };
    }
    const current = index.entries[entryIndex];
    const planPath = planPathFromEntry(workDir, sessionId, current);
    const content = readText(planPath);
    if (typeof content !== "string") {
      return { approved: false };
    }
    const timestamp = nowIsoUtc();
    const planHash = createHash("sha256").update(content).digest("hex");
      const ticketId = buildApprovalTicketId();
    const snapshotName = `${String(current.seq).padStart(3, "0")}-approved-${current.plan_id}-${ticketId.slice(0, 8)}.md`;
    const snapshotPath = `${sessionPlanDir(workDir, sessionId)}/${snapshotName}`;
    writeFileAtomic(snapshotPath, content);

    const nextEntry: PlanArtifactEntry = {
      ...current,
      status: "approved",
      approved_at: timestamp,
      approved_hash: planHash,
      approval_ticket_id: ticketId,
      approved_snapshot_path: snapshotPath,
      approved_by: options?.approvedBy?.trim() || "system",
      updated_at: timestamp,
    };
    const nextEntries = [...index.entries];
    nextEntries[entryIndex] = nextEntry;
    writeIndex(workDir, sessionId, {
      ...index,
      entries: nextEntries,
      active_plan_id: planId,
      updated_at: timestamp,
    });
    appendPlanEventUnlocked(workDir, sessionId, {
      event: "plan_approved",
      plan_id: planId,
      source: options?.source ?? "system",
      status_from: current.status,
      status_to: "approved",
      detail: `ticket=${ticketId} hash=${planHash.slice(0, 12)}`,
    });
    return {
      approved: true,
      entry: nextEntry,
      planHash,
      ticketId,
      snapshotPath,
    };
  });
}

export function updatePlanArtifactStatus(
  workDir: string,
  sessionId: string,
  planId: string,
  status: PlanArtifactStatus,
): PlanArtifactEntry | undefined {
  return withSessionPlanLock(workDir, sessionId, () => {
    const index = loadPlanArtifactIndex(workDir, sessionId);
    const entryIndex = index.entries.findIndex((item) => item.plan_id === planId);
    if (entryIndex < 0) {
      return undefined;
    }
    const timestamp = nowIsoUtc();
    const current = index.entries[entryIndex];
    const nextEntry: PlanArtifactEntry = {
      ...current,
      status,
      updated_at: timestamp,
      reviewed_at:
        status === "ready" || status === "blocked" || status === "review_failed"
          ? timestamp
          : current.reviewed_at,
      apply_started_at: status === "applying" ? timestamp : current.apply_started_at,
      approved_at: status === "approved" ? timestamp : current.approved_at,
      apply_failed_at: status === "apply_failed" ? timestamp : current.apply_failed_at,
      applied_at: status === "applied" ? timestamp : current.applied_at,
      discarded_at: status === "discarded" ? timestamp : current.discarded_at,
    };
    const nextEntries = [...index.entries];
    nextEntries[entryIndex] = nextEntry;
    const nextIndex: PlanArtifactIndex = {
      ...index,
      entries: nextEntries,
      active_plan_id: status === "applied" || status === "discarded" ? undefined : planId,
      updated_at: timestamp,
    };
    writeIndex(workDir, sessionId, nextIndex);
    appendPlanEventUnlocked(workDir, sessionId, {
      event: "plan_status_changed",
      plan_id: planId,
      source: "system",
      status_from: current.status,
      status_to: status,
      detail: `transition ${current.status}->${status}`,
    });
    return nextEntry;
  });
}

export function recoverStaleApprovedPlan(
  workDir: string,
  sessionId: string,
  options?: {
    source?: "cli" | "bridge" | "system";
    staleAfterMs?: number;
    expectedPlanId?: string;
  },
): {
  recovered: boolean;
  entry?: PlanArtifactEntry;
  stale_ms?: number;
} {
  return withSessionPlanLock(workDir, sessionId, () => {
    const index = loadPlanArtifactIndex(workDir, sessionId);
    const targetPlanId = options?.expectedPlanId ?? index.active_plan_id;
    if (!targetPlanId) {
      return { recovered: false };
    }
    const entryIndex = index.entries.findIndex((item) => item.plan_id === targetPlanId);
    if (entryIndex < 0) {
      return { recovered: false };
    }
    const current = index.entries[entryIndex];
    if (current.status !== "approved" && current.status !== "applying") {
      return { recovered: false };
    }
    const staleAfterMs = Math.max(
      1_000,
      options?.staleAfterMs ??
        parsePositiveInt(process.env.GROBOT_PLAN_APPLY_STALE_MS, PLAN_APPLY_STALE_DEFAULT_MS),
    );
    const startedAt = current.apply_started_at ?? current.approved_at ?? current.updated_at;
    const startedAtMs = Date.parse(startedAt);
    if (!Number.isFinite(startedAtMs)) {
      return { recovered: false };
    }
    const staleMs = Date.now() - startedAtMs;
    if (staleMs < staleAfterMs) {
      return { recovered: false };
    }
    const timestamp = nowIsoUtc();
    const nextEntry: PlanArtifactEntry = {
      ...current,
      status: "apply_failed",
      updated_at: timestamp,
      apply_failed_at: timestamp,
    };
    const nextEntries = [...index.entries];
    nextEntries[entryIndex] = nextEntry;
    const nextIndex: PlanArtifactIndex = {
      ...index,
      entries: nextEntries,
      active_plan_id: targetPlanId,
      updated_at: timestamp,
    };
    writeIndex(workDir, sessionId, nextIndex);
    appendPlanEventUnlocked(workDir, sessionId, {
      event: "plan_recovered_stale_apply",
      plan_id: targetPlanId,
      source: options?.source ?? "system",
      status_from: current.status,
      status_to: "apply_failed",
      detail: `stale_ms=${String(staleMs)}`,
    });
    appendPlanEventUnlocked(workDir, sessionId, {
      event: "plan_status_changed",
      plan_id: targetPlanId,
      source: options?.source ?? "system",
      status_from: current.status,
      status_to: "apply_failed",
      detail: `transition ${current.status}->apply_failed stale_recovery stale_ms=${String(staleMs)}`,
    });
    return {
      recovered: true,
      entry: nextEntry,
      stale_ms: staleMs,
    };
  });
}

export function buildPlanApplyPrompt(input: {
  approvedPlanContent: string;
  approvedHash: string;
  ticketId: string;
  extra?: string;
}): string {
  const lines = [
    "Implement the following approved plan exactly.",
    "",
    `Approval ticket: ${input.ticketId}`,
    `Approved hash (sha256): ${input.approvedHash}`,
    "",
    "If you discover a conflict with the approved plan, STOP and return to planning mode instead of silently deviating.",
    "",
    input.approvedPlanContent.trim(),
  ];
  const extraText = input.extra?.trim();
  if (extraText) {
    lines.push("");
    lines.push("Additional user instruction:");
    lines.push(extraText);
  }
  return lines.join("\n");
}
