import {
  PLAN_INTERRUPT_NOT_PLAN_MODE_CODE,
  PLAN_INTERRUPT_NOT_RUNNING_CODE,
  PLAN_INTERRUPT_OK_CODE,
} from "./constants";
import type { SessionPlanMeta, SessionPlanMode } from "../session-registry";

export type PlanInterruptSource = "command" | "cli_esc";
export type PlanTurnPhase = "idle" | "planning" | "applying";

export interface PlanStablePoint {
  planMode: SessionPlanMode;
  planMeta: SessionPlanMeta | undefined;
}

export interface PlanReadyApprovalRequest {
  workDir: string;
  planPath: string;
  planContent: string;
}

export type PlanReadyApprovalDecision =
  | "approve"
  | "keep_planning"
  | "exit_plan_mode"
  | "unavailable"
  | {
      action: "exit_plan_mode";
      planContent?: string;
      silent?: boolean;
    }
  | {
      action: "approve";
      feedback?: string;
      planContent?: string;
    }
  | {
      action: "keep_planning";
      feedback?: string;
      planContent?: string;
      silent?: boolean;
    }
  | {
      action: "unavailable";
    };

export interface NormalizedPlanReadyApprovalDecision {
  action: "approve" | "keep_planning" | "exit_plan_mode" | "unavailable";
  feedback?: string;
  planContent?: string;
  silent?: boolean;
}

export interface RunStartPlanTurnOptions {
  writeStdout?: (message: string) => void;
  writeStderr?: (message: string) => void;
  skipExecution?: boolean;
  diagnosticsMode?: "compact" | "verbose" | "trace";
  showWorkingNotice?: boolean;
  suppressOpenPlanEditorNotice?: boolean;
  requestReadyPlanApproval?: (
    request: PlanReadyApprovalRequest,
  ) => Promise<PlanReadyApprovalDecision>;
}

export interface PlanInterruptResult {
  code:
    | typeof PLAN_INTERRUPT_OK_CODE
    | typeof PLAN_INTERRUPT_NOT_RUNNING_CODE
    | typeof PLAN_INTERRUPT_NOT_PLAN_MODE_CODE;
  accepted: boolean;
  phase: PlanTurnPhase;
}

export interface PlanMessageHandleResult {
  handled: boolean;
  code: number;
}

export interface RunStartPlanMode {
  isPlanMode(): boolean;
  getActivePlanPath(): string | undefined;
  enterPlan(goal: string, options?: RunStartPlanTurnOptions): Promise<number>;
  showPlanStatus(): Promise<number>;
  runPlanTurn(note: string, options?: RunStartPlanTurnOptions): Promise<number>;
  applyPlan(extra: string, options?: RunStartPlanTurnOptions): Promise<number>;
  cancelPlan(): Promise<number>;
  requestPlanInterrupt(
    source: PlanInterruptSource,
  ): Promise<PlanInterruptResult>;
  handleMessageInput(
    message: string,
    options?: {
      messageMode?: boolean;
    },
  ): Promise<PlanMessageHandleResult>;
}

export function normalizePlanReadyApprovalDecision(
  decision: PlanReadyApprovalDecision | undefined,
): NormalizedPlanReadyApprovalDecision {
  if (!decision) {
    return { action: "unavailable" };
  }
  if (typeof decision === "string") {
    return { action: decision };
  }
  if (decision.action === "exit_plan_mode") {
    return {
      action: "exit_plan_mode",
      planContent: decision.planContent,
      silent: decision.silent,
    };
  }
  if (decision.action === "approve") {
    return {
      action: "approve",
      feedback: decision.feedback,
      planContent: decision.planContent,
    };
  }
  if (decision.action === "keep_planning") {
    return {
      action: "keep_planning",
      feedback: decision.feedback,
      planContent: decision.planContent,
      silent: decision.silent,
    };
  }
  return { action: "unavailable" };
}
