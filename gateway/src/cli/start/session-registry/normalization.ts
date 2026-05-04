import type { SessionPlanPhase } from "../plan-state";
import {
  parseNonNegativeInt,
  parseOptionalNonNegativeInt,
  parseOptionalNonNegativeNumber,
  parseOptionalPositiveInt,
  parseOptionalString,
} from "./scalars";
import type {
  SessionPlanMeta,
  SessionPlanMode,
  SessionProviderRuntimeState,
} from "./types";

export function parsePlanMode(value: unknown): SessionPlanMode {
  if (value === "plan_only") {
    return "plan_only";
  }
  return "normal";
}

function parsePlanStatus(value: unknown): SessionPlanMeta["active_plan_status"] {
  if (value === "blocked") {
    return "blocked";
  }
  if (value === "review_failed") {
    return "review_failed";
  }
  if (value === "ready") {
    return "ready";
  }
  if (value === "approved") {
    return "approved";
  }
  if (value === "applying") {
    return "applying";
  }
  if (value === "apply_failed") {
    return "apply_failed";
  }
  if (value === "applied") {
    return "applied";
  }
  if (value === "discarded") {
    return "discarded";
  }
  if (value === "draft") {
    return "draft";
  }
  return undefined;
}

function parsePlanPhase(value: unknown): SessionPlanPhase | undefined {
  if (value === "drafting") {
    return "drafting";
  }
  if (value === "awaiting_decision") {
    return "awaiting_decision";
  }
  if (value === "applying") {
    return "applying";
  }
  return undefined;
}

export function normalizePlanMeta(raw: unknown): SessionPlanMeta | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const activePlanId = parseOptionalString(record.active_plan_id);
  const activePlanStatus = parsePlanStatus(record.active_plan_status);
  const activePlanPath = parseOptionalString(record.active_plan_path);
  const activePlanSeq = parseOptionalPositiveInt(record.active_plan_seq);
  const activePlanTitle = parseOptionalString(record.active_plan_title);
  const reviewStatus = parsePlanStatus(record.review_status);
  const blockedCount = parseOptionalNonNegativeInt(record.blocked_count);
  const reviewFailCount = parseOptionalNonNegativeInt(record.review_fail_count);
  const approvedHash = parseOptionalString(record.approved_hash);
  const approvalTicketId = parseOptionalString(record.approval_ticket_id);
  const approvedSnapshotPath = parseOptionalString(record.approved_snapshot_path);
  const activePlanPhase = parsePlanPhase(record.active_plan_phase);
  const updatedAt = parseOptionalString(record.updated_at);
  const normalizedReviewStatus =
    reviewStatus === "ready" || reviewStatus === "blocked" || reviewStatus === "review_failed"
      ? reviewStatus
      : undefined;
  if (
    !activePlanId
    && !activePlanPath
    && !activePlanSeq
    && !activePlanTitle
    && !activePlanStatus
    && !normalizedReviewStatus
    && typeof blockedCount !== "number"
    && typeof reviewFailCount !== "number"
    && !approvedHash
    && !approvalTicketId
    && !approvedSnapshotPath
    && !activePlanPhase
    && !updatedAt
  ) {
    return undefined;
  }
  return {
    active_plan_id: activePlanId,
    active_plan_status: activePlanStatus,
    active_plan_path: activePlanPath,
    active_plan_seq: activePlanSeq,
    active_plan_title: activePlanTitle,
    review_status: normalizedReviewStatus,
    blocked_count: blockedCount,
    review_fail_count: reviewFailCount,
    approved_hash: approvedHash,
    approval_ticket_id: approvalTicketId,
    approved_snapshot_path: approvedSnapshotPath,
    active_plan_phase: activePlanPhase,
    updated_at: updatedAt,
  };
}

export function normalizeProviderRuntimeStates(raw: unknown): SessionProviderRuntimeState[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const states: SessionProviderRuntimeState[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const providerName = parseOptionalString(record.provider_name);
    if (!providerName) {
      continue;
    }
    states.push({
      provider_name: providerName,
      consecutive_failures: parseNonNegativeInt(record.consecutive_failures),
      circuit_open_until_ms: parseNonNegativeInt(record.circuit_open_until_ms),
      last_error_class: parseOptionalString(record.last_error_class),
      last_error_message: parseOptionalString(record.last_error_message),
      last_failed_at: parseOptionalString(record.last_failed_at),
      last_succeeded_at: parseOptionalString(record.last_succeeded_at),
      ewma_latency_ms: parseOptionalNonNegativeNumber(record.ewma_latency_ms),
      ewma_error_rate: parseOptionalNonNegativeNumber(record.ewma_error_rate),
    });
  }
  if (!states.length) {
    return undefined;
  }
  return states;
}

export { parseOptionalString };
