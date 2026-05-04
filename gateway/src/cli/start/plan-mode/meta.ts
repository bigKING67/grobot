import type { PlanArtifactEntry } from "../plan-artifact";
import {
  derivePlanPhaseFromStatus,
  type SessionPlanPhase,
} from "../plan-state";
import type { SessionPlanMeta } from "../session-registry";

export function buildPlanMeta(entry: PlanArtifactEntry, planPath: string): SessionPlanMeta {
  const activePlanPhase = derivePlanPhaseFromStatus(entry.status);
  return {
    active_plan_id: entry.plan_id,
    active_plan_status: entry.status,
    active_plan_path: planPath,
    active_plan_seq: entry.seq,
    active_plan_title: entry.title,
    review_status:
      entry.status === "ready"
      || entry.status === "blocked"
      || entry.status === "review_failed"
        ? entry.status
        : undefined,
    blocked_count: entry.blocked_count,
    review_fail_count: entry.review_fail_count,
    approved_hash: entry.approved_hash,
    approval_ticket_id: entry.approval_ticket_id,
    approved_snapshot_path: entry.approved_snapshot_path,
    active_plan_phase: activePlanPhase,
    updated_at: entry.updated_at,
  };
}

export function humanizePlanStatus(status: string | undefined): string {
  switch (status) {
    case "draft":
      return "草稿";
    case "ready":
      return "待确认";
    case "blocked":
      return "已阻止";
    case "review_failed":
      return "需完善";
    case "approved":
      return "已确认";
    case "applying":
      return "执行中";
    case "applied":
      return "已执行";
    case "apply_failed":
      return "执行失败";
    case "discarded":
      return "已取消";
    default:
      return status && status.trim().length > 0 ? status : "未知";
  }
}

export function humanizePlanPhase(phase: SessionPlanPhase | string | undefined): string {
  switch (phase) {
    case "drafting":
      return "草稿";
    case "awaiting_decision":
      return "待确认";
    case "applying":
      return "执行中";
    default:
      return phase && phase.trim().length > 0 ? phase : "未知";
  }
}
