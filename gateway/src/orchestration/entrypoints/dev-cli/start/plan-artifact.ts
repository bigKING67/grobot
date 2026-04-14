import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { removeTrailingSlashes } from "../services/runtime-paths";

export type PlanArtifactStatus = "draft" | "approved" | "apply_failed" | "applied" | "discarded";

export interface PlanArtifactEntry {
  plan_id: string;
  seq: number;
  title: string;
  task_slug: string;
  filename: string;
  status: PlanArtifactStatus;
  created_at: string;
  updated_at: string;
  apply_started_at?: string;
  approved_at?: string;
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

const PLAN_ARTIFACT_INDEX_VERSION = 1;
const PLAN_PROGRESS_SECTION = "## Progress Log";
const PLAN_LOCK_WAIT_MS = 20;
const PLAN_LOCK_TIMEOUT_MS = 4_000;
const PLAN_LOCK_STALE_MS = 30_000;
const PLAN_EVENTS_DEFAULT_MAX_BYTES = 1_048_576;
const PLAN_EVENTS_DEFAULT_ROTATE_KEEP = 5;
const PLAN_APPLY_STALE_DEFAULT_MS = 10 * 60 * 1000;
const SLEEP_SIGNAL = new Int32Array(new SharedArrayBuffer(4));

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
  if (raw === "approved") {
    return "approved";
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

function normalizeEntry(raw: Record<string, unknown>): PlanArtifactEntry | undefined {
  const planId = typeof raw.plan_id === "string" ? raw.plan_id.trim() : "";
  const seq = typeof raw.seq === "number" && Number.isFinite(raw.seq) ? Math.max(1, Math.floor(raw.seq)) : 0;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const taskSlug = typeof raw.task_slug === "string" ? raw.task_slug.trim() : "";
  const filename = typeof raw.filename === "string" ? raw.filename.trim() : "";
  if (!planId || seq <= 0 || !title || !taskSlug || !filename) {
    return undefined;
  }
  const createdAt = typeof raw.created_at === "string" && raw.created_at.trim().length > 0
    ? raw.created_at
    : nowIsoUtc();
  const updatedAt = typeof raw.updated_at === "string" && raw.updated_at.trim().length > 0
    ? raw.updated_at
    : createdAt;
  const appliedAt = typeof raw.applied_at === "string" && raw.applied_at.trim().length > 0
    ? raw.applied_at
    : undefined;
  const applyStartedAt = typeof raw.apply_started_at === "string" && raw.apply_started_at.trim().length > 0
    ? raw.apply_started_at
    : undefined;
  const approvedAt = typeof raw.approved_at === "string" && raw.approved_at.trim().length > 0
    ? raw.approved_at
    : undefined;
  const applyFailedAt = typeof raw.apply_failed_at === "string" && raw.apply_failed_at.trim().length > 0
    ? raw.apply_failed_at
    : undefined;
  const discardedAt = typeof raw.discarded_at === "string" && raw.discarded_at.trim().length > 0
    ? raw.discarded_at
    : undefined;
  return {
    plan_id: planId,
    seq,
    title,
    task_slug: taskSlug,
    filename,
    status: normalizeStatus(raw.status),
    created_at: createdAt,
    updated_at: updatedAt,
    apply_started_at: applyStartedAt,
    approved_at: approvedAt,
    apply_failed_at: applyFailedAt,
    applied_at: appliedAt,
    discarded_at: discardedAt,
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
  const updatedAt = typeof raw.updated_at === "string" && raw.updated_at.trim().length > 0
    ? raw.updated_at
    : nowIsoUtc();
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
    "- 待补充",
    "",
    "## Scope Out",
    "",
    "- 待补充",
    "",
    "## Context Snapshot",
    "",
    "- 待补充",
    "",
    "## Milestones",
    "",
    "1. 待补充",
    "",
    "## Validation",
    "",
    "- 待补充",
    "",
    "## Risk & Rollback",
    "",
    "- 风险: 待补充",
    "- 回退: 待补充",
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
    const updatedEntry: PlanArtifactEntry = {
      ...entry,
      updated_at: timestamp,
    };
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
    return { updated: true, planPath };
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
      apply_started_at: status === "approved" ? timestamp : current.apply_started_at,
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
    if (current.status !== "approved") {
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
      event: "plan_recovered_stale_approved",
      plan_id: targetPlanId,
      source: options?.source ?? "system",
      status_from: "approved",
      status_to: "apply_failed",
      detail: `stale_ms=${String(staleMs)}`,
    });
    appendPlanEventUnlocked(workDir, sessionId, {
      event: "plan_status_changed",
      plan_id: targetPlanId,
      source: options?.source ?? "system",
      status_from: "approved",
      status_to: "apply_failed",
      detail: `transition approved->apply_failed stale_recovery stale_ms=${String(staleMs)}`,
    });
    return {
      recovered: true,
      entry: nextEntry,
      stale_ms: staleMs,
    };
  });
}

export function buildPlanApplyPrompt(planContent: string, extra?: string): string {
  const lines = [
    "Implement the following approved plan exactly.",
    "",
    planContent.trim(),
  ];
  const extraText = extra?.trim();
  if (extraText) {
    lines.push("");
    lines.push("Additional user instruction:");
    lines.push(extraText);
  }
  return lines.join("\n");
}
