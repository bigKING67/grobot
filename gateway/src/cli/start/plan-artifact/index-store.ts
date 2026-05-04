import { PLAN_ARTIFACT_INDEX_VERSION } from "./constants";
import { nowIsoUtc, readJsonObject, writeFileAtomic } from "./fs-utils";
import { activePlanPath, planIndexPath } from "./paths";
import type {
  PlanArtifactEntry,
  PlanArtifactIndex,
  PlanArtifactStatus,
} from "./types";

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
  return Math.max(0, Math.floor(value));
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

export function loadPlanArtifactIndex(workDir: string, sessionId: string): PlanArtifactIndex {
  const raw = readJsonObject(planIndexPath(workDir, sessionId));
  return normalizeIndex(raw, sessionId);
}

export function writePlanArtifactIndex(
  workDir: string,
  sessionId: string,
  index: PlanArtifactIndex,
): void {
  const normalized: PlanArtifactIndex = {
    ...index,
    version: PLAN_ARTIFACT_INDEX_VERSION,
    updated_at: nowIsoUtc(),
  };
  writeFileAtomic(planIndexPath(workDir, sessionId), `${JSON.stringify(normalized, undefined, 2)}\n`);
}

export function syncActivePlanFile(workDir: string, sessionId: string, content: string): void {
  writeFileAtomic(activePlanPath(workDir, sessionId), content);
}
