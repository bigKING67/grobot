import { isEnvTruthy } from "./env";
import { terminalStyle } from "../../tui/theme/terminal-style";

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
      return normalized || "未知阶段";
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
  const lines: string[] = [];
  switch (input.kind) {
    case "applied":
      lines.push(
        `${terminalStyle.planMode("●")} 已中断 plan mode 回合`,
        `  ${terminalStyle.muted(`已恢复到安全状态 · 阶段: ${humanizePlanInterruptStage(input.stage ?? "")}`)}`,
      );
      break;
    case "ignored":
      lines.push(
        `${terminalStyle.planMode("●")} 中断请求未生效`,
        `  ${terminalStyle.muted(`回合已完成或已过安全中断点 · 阶段: ${humanizePlanInterruptStage(input.stage ?? "")}`)}`,
      );
      if (input.reason) {
        lines.push(`  ${terminalStyle.muted(`原因: ${input.reason}`)}`);
      }
      break;
    case "not_plan_mode":
      lines.push(
        `${terminalStyle.planMode("●")} 当前不在 plan mode`,
        `  ${terminalStyle.muted("没有可中断的计划回合。")}`,
      );
      break;
    case "not_running":
      lines.push(
        `${terminalStyle.planMode("●")} 当前没有运行中的 plan 回合`,
        `  ${terminalStyle.muted("如果想退出 plan mode，可按 Esc 或使用 /exit。")}`,
      );
      break;
    case "requested":
      lines.push(
        `${terminalStyle.planMode("●")} 已请求中断 plan mode 回合`,
        `  ${terminalStyle.muted(`阶段: ${humanizePlanTurnPhase(input.phase ?? "idle")}`)}`,
      );
      if (typeof input.runtimeInterrupted === "boolean") {
        lines.push(`  ${terminalStyle.muted(`运行时中断: ${input.runtimeInterrupted ? "已发送" : "未运行"}`)}`);
      }
      break;
  }
  if (isEnvTruthy(process.env.GROBOT_PLAN_STATUS_VERBOSE)) {
    lines.push(`  ${terminalStyle.muted(`诊断: ${input.code}`)}`);
  }
  lines.push("");
  return lines.join("\n");
}
