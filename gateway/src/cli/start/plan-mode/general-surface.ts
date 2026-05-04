import { formatHumanPlanFilePath } from "./path";
import { compactSpaces, truncateDisplayWidth } from "../../tui/terminal/display-width";
import { terminalStyle } from "../../tui/theme/terminal-style";

export function buildExitedPlanModeSurface(): string {
  return [
    `${terminalStyle.planMode("●")} 已退出 plan mode`,
    "",
  ].join("\n");
}

export function buildPlanCancelSurface(input: {
  kind: "cancelled" | "empty" | "failed";
  workDir?: string;
  planPath?: string;
  detail?: string;
}): string {
  const lines: string[] = [];
  if (input.kind === "cancelled") {
    lines.push(`${terminalStyle.planMode("●")} 已取消计划`);
  } else if (input.kind === "empty") {
    lines.push(`${terminalStyle.planMode("●")} 当前没有可取消的计划`);
  } else {
    lines.push(`${terminalStyle.planMode("●")} 取消计划失败`);
  }
  if (input.workDir && input.planPath) {
    lines.push(
      `  ${terminalStyle.muted(`计划文件: ${formatHumanPlanFilePath({
        workDir: input.workDir,
        planPath: input.planPath,
      })}`)}`,
    );
  }
  if (input.kind === "cancelled") {
    lines.push(`  ${terminalStyle.muted("计划已丢弃，plan mode 已退出。")}`);
  } else if (input.kind === "empty") {
    lines.push(`  ${terminalStyle.muted('plan mode 已退出；使用 "/plan <goal>" 开始新计划。')}`);
  } else {
    lines.push(`  ${terminalStyle.muted(input.detail ?? "计划状态未更新。")}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function buildPlanModeEnteredSurface(input?: {
  workDir?: string;
  planPath?: string;
  goal?: string;
}): string {
  const displayPath = input?.planPath
    ? formatHumanPlanFilePath({
      workDir: input.workDir ?? "",
      planPath: input.planPath,
    })
    : undefined;
  const compactGoal = compactSpaces(input?.goal ?? "");
  const lines = [
    `${terminalStyle.planMode("●")} 已进入 plan mode`,
  ];
  if (displayPath) {
    lines.push(`  ${terminalStyle.muted(`计划文件: ${displayPath}`)}`);
  }
  if (compactGoal) {
    lines.push(`  ${terminalStyle.muted(`目标: ${truncateDisplayWidth(compactGoal, 88)}`)}`);
  }
  lines.push(
    `  ${terminalStyle.muted("Grobot 正在探索并设计实现方案。")}`,
    `  ${terminalStyle.muted("确认计划前，plan mode 只会读取和规划。")}`,
    "",
    "",
  );
  return lines.join("\n");
}

export function buildPlanKeptInPlanningSurface(): string {
  return [
    `${terminalStyle.planMode("●")} 已继续留在 plan mode`,
    `  ${terminalStyle.muted('直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。')}`,
    "",
  ].join("\n");
}

export function buildPlanNeedsRefinementSurface(detail: string): string {
  return [
    `${terminalStyle.planMode("●")} 计划需要继续完善`,
    `  ${terminalStyle.muted(detail)}`,
    `  ${terminalStyle.muted('直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。')}`,
    "",
  ].join("\n");
}

export function buildPlanUpdatedSurface(input: {
  phase: string;
  nextAction: string;
}): string {
  return [
    `${terminalStyle.planMode("●")} 计划已更新`,
    `  ${terminalStyle.muted(`状态: ${input.phase}`)}`,
    `  ${terminalStyle.muted(`下一步: ${input.nextAction}`)}`,
    "",
  ].join("\n");
}

export function buildPlanCommandErrorSurface(reason: string): string {
  return [
    `${terminalStyle.planMode("●")} Plan`,
    `  ${terminalStyle.muted(reason)}`,
    "",
  ].join("\n");
}
