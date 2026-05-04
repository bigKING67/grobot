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

export function clearPlanApprovalFields(entry: PlanArtifactEntry): PlanArtifactEntry {
  return {
    ...entry,
    approved_hash: undefined,
    approval_ticket_id: undefined,
    approved_snapshot_path: undefined,
    approved_by: undefined,
  };
}
