import { isEnvTruthy } from "./env";
import { renderPlanSurface } from "./info-surface";

export function humanizePlanTurnPhase(phase: "idle" | "planning" | "applying"): string {
  switch (phase) {
    case "planning":
      return "正在规划";
    case "applying":
      return "正在执行";
    case "idle":
    default:
      return "空闲";
  }
}

function humanizePlanInterruptStage(stage: string): string {
  const normalized = stage.trim();
  switch (normalized) {
    case "before_plan_turn":
    case "before_plan_create":
      return "计划回合开始前";
    case "before_plan_progress_append":
      return "写入计划备注前";
    case "after_plan_progress_append":
      return "写入计划备注后";
    case "after_plan_state_persist":
      return "保存计划状态后";
    case "before_apply_start":
      return "执行计划前";
    case "plan_turn_finalize":
      return "计划回合结束时";
    case "apply_finalize":
      return "执行回合结束时";
    default:
      return normalized.replace(/[_-]+/g, " ") || "未知阶段";
  }
}

function humanizePlanInterruptReason(reason: string): string {
  const normalized = reason.trim();
  switch (normalized) {
    case "turn_completed_before_abort":
      return "回合已完成，无法再回退";
    case "no_active_turn":
      return "当前没有运行中的回合";
    case "pending_ask":
      return "正在等待人工确认";
    case "budget_or_no_signal":
      return "预算不足或没有足够中断信号";
    default:
      return normalized.replace(/[_-]+/g, " ") || "未知原因";
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
  let title = "已请求中断计划回合";
  let primary = `阶段 ${humanizePlanTurnPhase(input.phase ?? "idle")}`;
  const detailLines: string[] = [];
  switch (input.kind) {
    case "applied":
      title = "已中断计划回合";
      primary = "已恢复到安全状态";
      detailLines.push(`阶段 ${humanizePlanInterruptStage(input.stage ?? "")}`);
      break;
    case "ignored":
      title = "中断请求未生效";
      primary = "回合已完成或已过安全中断点";
      detailLines.push(`阶段 ${humanizePlanInterruptStage(input.stage ?? "")}`);
      if (input.reason) {
        detailLines.push(`原因 ${humanizePlanInterruptReason(input.reason)}`);
      }
      break;
    case "not_plan_mode":
      title = "当前不在计划模式";
      primary = "没有可中断的计划回合。";
      break;
    case "not_running":
      title = "当前没有运行中的计划回合";
      primary = "如果想退出计划模式，可按 Esc 或使用 /exit。";
      break;
    case "requested":
      title = "已请求中断计划回合";
      primary = `阶段 ${humanizePlanTurnPhase(input.phase ?? "idle")}`;
      if (typeof input.runtimeInterrupted === "boolean") {
        detailLines.push(`运行时中断 ${input.runtimeInterrupted ? "已发送" : "未运行"}`);
      }
      break;
  }
  if (isEnvTruthy(process.env.GROBOT_PLAN_STATUS_VERBOSE)) {
    detailLines.push(`诊断 ${input.code}`);
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
