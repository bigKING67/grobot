import { isEnvTruthy } from "./env";
import { renderPlanSurface } from "./info-surface";

export function humanizePlanTurnPhase(phase: "idle" | "planning" | "applying"): string {
  switch (phase) {
    case "planning":
      return "planning";
    case "applying":
      return "applying";
    case "idle":
    default:
      return "idle";
  }
}

function humanizePlanInterruptStage(stage: string): string {
  const normalized = stage.trim();
  switch (normalized) {
    case "before_plan_turn":
    case "before_plan_create":
      return "before plan turn";
    case "before_plan_progress_append":
      return "before plan progress append";
    case "after_plan_progress_append":
      return "after plan progress append";
    case "after_plan_state_persist":
      return "after plan state persist";
    case "before_apply_start":
      return "before apply start";
    case "plan_turn_finalize":
      return "plan turn finalize";
    case "apply_finalize":
      return "apply finalize";
    default:
      return normalized.replace(/[_-]+/g, " ") || "unknown stage";
  }
}

function humanizePlanInterruptReason(reason: string): string {
  const normalized = reason.trim();
  switch (normalized) {
    case "turn_completed_before_abort":
      return "turn already completed";
    case "no_active_turn":
      return "no active turn";
    case "pending_ask":
      return "waiting for user confirmation";
    case "budget_or_no_signal":
      return "insufficient budget or signal";
    default:
      return normalized.replace(/[_-]+/g, " ") || "unknown reason";
  }
}

export function buildPlanInterruptSurface(input: {
  code: string;
  kind: "applied" | "ignored" | "not_plan_mode" | "not_running" | "requested";
  phase?: "idle" | "planning" | "applying";
  stage?: string;
  reason?: string;
  runtimeInterrupted?: boolean;
}): string {
  let title = "Plan turn interrupt requested";
  let primary = `phase ${humanizePlanTurnPhase(input.phase ?? "idle")}`;
  const detailLines: string[] = [];
  switch (input.kind) {
    case "applied":
      title = "Plan turn interrupted";
      primary = "Restored to a safe state";
      detailLines.push(`stage ${humanizePlanInterruptStage(input.stage ?? "")}`);
      break;
    case "ignored":
      title = "Interrupt request ignored";
      primary = "Turn completed or passed the safe interrupt point";
      detailLines.push(`stage ${humanizePlanInterruptStage(input.stage ?? "")}`);
      if (input.reason) {
        detailLines.push(`reason ${humanizePlanInterruptReason(input.reason)}`);
      }
      break;
    case "not_plan_mode":
      title = "Not in plan mode";
      primary = "No plan turn to interrupt.";
      break;
    case "not_running":
      title = "No running plan turn";
      primary = "To exit plan mode, press Esc or use /exit.";
      break;
    case "requested":
      title = "Plan turn interrupt requested";
      primary = `phase ${humanizePlanTurnPhase(input.phase ?? "idle")}`;
      if (typeof input.runtimeInterrupted === "boolean") {
        detailLines.push(`runtime interrupt ${input.runtimeInterrupted ? "sent" : "not running"}`);
      }
      break;
  }
  if (isEnvTruthy(process.env.GROBOT_PLAN_STATUS_VERBOSE)) {
    detailLines.push(`diagnostic ${input.code}`);
  }
  return renderPlanSurface({
    title,
    rows: [
      {
        title: primary,
        detailLines,
      },
    ],
  });
}
