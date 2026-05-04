import type { MigrationOptions, SessionKeyParts } from "../../models/types";
import type {
  PlanLifecycleStatus,
  SessionPlanPhase,
} from "../../cli/start/plan-state";

export const PLAN_GUARD_CODE = "PLAN_GUARD_DENIED";
export const PLAN_ERROR_NO_ACTIVE = "PLAN_NO_ACTIVE";
export const PLAN_ERROR_APPLY_BLOCKED = "PLAN_APPLY_STATUS_BLOCKED";
export const PLAN_ERROR_REVIEW_PLAN_NOT_FOUND = "PLAN_REVIEW_PLAN_NOT_FOUND";
export const PLAN_ERROR_REVIEW_FAILED = "PLAN_REVIEW_FAILED";
export const PLAN_ERROR_REVIEW_BLOCKED = "PLAN_REVIEW_BLOCKED";
export const PLAN_ERROR_QUALITY_GUARD_BLOCKED = "PLAN_QUALITY_GUARD_BLOCKED";
export const PLAN_ERROR_APPROVAL_FAILED = "PLAN_APPROVAL_FAILED";
export const PLAN_ERROR_SET_APPLYING_FAILED = "PLAN_SET_APPLYING_FAILED";
export const PLAN_ERROR_APPLY_EXEC_FAILED = "PLAN_APPLY_EXEC_FAILED";
export const PLAN_ERROR_APPEND_NOTE_FAILED = "PLAN_APPEND_NOTE_FAILED";
export const BRIDGE_FATAL_ERROR = "BRIDGE_FATAL";

export type BridgePlanStatus = PlanLifecycleStatus;
export type BridgePlanPhase = SessionPlanPhase;

export interface BridgeInput {
  userMessage: string;
  session: SessionKeyParts;
  context: {
    actorId: string;
    projectId: string;
  };
  workDir?: string;
  migration?: Partial<MigrationOptions>;
}

export type BridgePayloadResult = {
  code: number;
  payload: Record<string, unknown>;
};
