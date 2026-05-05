import { PLAN_PROGRESS_SECTION } from "./constants";
import { nowIsoUtc, removeDangerousChars } from "./fs-utils";
import type { PlanArtifactEntry, PlanArtifactIndex } from "./types";

export function buildPlanId(): string {
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

export function buildApprovalTicketId(): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((item) => item.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function nextPlanSeq(index: PlanArtifactIndex): number {
  let maxSeq = 0;
  for (const item of index.entries) {
    if (item.seq > maxSeq) {
      maxSeq = item.seq;
    }
  }
  return maxSeq + 1;
}

export function buildPlanMarkdown(args: {
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
    "- __REQUIRED__: concrete change scope (modules/files).",
    "",
    "## Scope Out",
    "",
    "- __REQUIRED__: explicit out-of-scope boundaries.",
    "",
    "## Context Snapshot",
    "",
    "- __REQUIRED__: current implementation state, key constraints, dependencies.",
    "",
    "## Milestones",
    "",
    "1. [ ] __REQUIRED__: milestone name",
    "   - Done when: __REQUIRED__",
    "   - Validation: __REQUIRED__",
    "   - Rollback: __REQUIRED__",
    "",
    "## Validation",
    "",
    "- __REQUIRED__: validation command and expected result.",
    "",
    "## Risk & Rollback",
    "",
    "- Risk: __REQUIRED__",
    "- Rollback: __REQUIRED__",
    "",
    "## Decision Log",
    "",
    `- ${createdAt} initialized plan.`,
    "",
    PLAN_PROGRESS_SECTION,
    "",
    `- ${createdAt} created plan artifact.`,
    "",
  ].join("\n");
}

export function clearPlanApprovalFields(entry: PlanArtifactEntry): PlanArtifactEntry {
  return {
    ...entry,
    approved_hash: undefined,
    approval_ticket_id: undefined,
    approved_snapshot_path: undefined,
    approved_by: undefined,
  };
}
