import { createHash } from "node:crypto";
import { PLAN_PROGRESS_SECTION } from "./constants";
import {
  buildApprovalTicketId,
  buildPlanId,
  buildPlanMarkdown,
  clearPlanApprovalFields,
  nextPlanSeq,
} from "./content";
import { resolvePlanArtifactEnvControls } from "./env-controls";
import { appendPlanEventUnlocked } from "./events";
import {
  compactSingleLine,
  nowIsoUtc,
  readText,
  removeDangerousChars,
  sanitizeSegment,
  writeFileAtomic,
} from "./fs-utils";
import {
  loadPlanArtifactIndex,
  syncActivePlanFile,
  writePlanArtifactIndex,
} from "./index-store";
import { withSessionPlanLock } from "./lock";
import { planPathFromEntry, sessionPlanDir } from "./paths";
import type {
  ActivePlanArtifact,
  CreatedPlanArtifact,
  PlanApprovalResult,
  PlanArtifactEntry,
  PlanArtifactIndex,
  PlanArtifactStatus,
  PlanReviewResult,
} from "./types";

export { loadPlanArtifactIndex } from "./index-store";

export function createPlanArtifact(workDir: string, sessionId: string, goal: string): CreatedPlanArtifact {
  return withSessionPlanLock(workDir, sessionId, () => {
    const index = loadPlanArtifactIndex(workDir, sessionId);
    const seq = nextPlanSeq(index);
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
    syncActivePlanFile(workDir, sessionId, markdown);
    const nextIndex: PlanArtifactIndex = {
      ...index,
      active_plan_id: planId,
      entries: [...index.entries, entry],
      updated_at: nowIsoUtc(),
    };
    writePlanArtifactIndex(workDir, sessionId, nextIndex);
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
  syncActivePlanFile(workDir, sessionId, content);
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
    syncActivePlanFile(workDir, sessionId, updatedContent);

    const nextStatus: PlanArtifactStatus =
      entry.status === "applied" || entry.status === "discarded"
        ? entry.status
        : "draft";
    const invalidatedApproval = Boolean(entry.approved_hash || entry.approval_ticket_id);
    const updatedEntry: PlanArtifactEntry = clearPlanApprovalFields({
      ...entry,
      status: nextStatus,
      updated_at: timestamp,
    });
    const nextEntries = [...index.entries];
    nextEntries[entryIndex] = updatedEntry;
    writePlanArtifactIndex(workDir, sessionId, {
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
      syncActivePlanFile(workDir, sessionId, currentContent);
      return { updated: true, replaced: false, planPath };
    }

    const timestamp = nowIsoUtc();
    const persistedContent = `${nextContent}\n`;
    writeFileAtomic(planPath, persistedContent);
    syncActivePlanFile(workDir, sessionId, persistedContent);

    const invalidatedApproval = Boolean(
      entry.approved_hash || entry.approval_ticket_id || entry.approved_snapshot_path,
    );
    const nextStatus: PlanArtifactStatus =
      entry.status === "applied" || entry.status === "discarded"
        ? entry.status
        : "draft";
    const updatedEntry: PlanArtifactEntry = clearPlanApprovalFields({
      ...entry,
      status: nextStatus,
      updated_at: timestamp,
    });
    const nextEntries = [...index.entries];
    nextEntries[entryIndex] = updatedEntry;
    writePlanArtifactIndex(workDir, sessionId, {
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
    const nextEntry: PlanArtifactEntry = clearPlanApprovalFields({
      ...current,
      status: nextStatus,
      reviewed_at: timestamp,
      review_fail_count: review.ok ? current.review_fail_count : (current.review_fail_count ?? 0) + 1,
      blocked_count: review.blocked ? (current.blocked_count ?? 0) + 1 : current.blocked_count,
      updated_at: timestamp,
    });
    const nextEntries = [...index.entries];
    nextEntries[entryIndex] = nextEntry;
    writePlanArtifactIndex(workDir, sessionId, {
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
        : [
          `review_blocked=${review.blocked ? "yes" : "no"}`,
          `findings_count=${String(review.findings.length)}`,
          `findings=${review.findings.map((item) => `${item.code}:${item.section ?? "global"}`).join(",")}`,
        ].join(" "),
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
    writePlanArtifactIndex(workDir, sessionId, {
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
    writePlanArtifactIndex(workDir, sessionId, nextIndex);
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
      options?.staleAfterMs ?? resolvePlanArtifactEnvControls().applyStaleMs,
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
    writePlanArtifactIndex(workDir, sessionId, nextIndex);
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
