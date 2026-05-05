import { formatHumanPlanFilePath } from "./path";
import { compactSpaces, truncateDisplayWidth } from "../../tui/terminal/display-width";
import { renderPlanSurface } from "./info-surface";

export function buildExitedPlanModeSurface(): string {
  return renderPlanSurface({
    title: "已退出计划模式",
    rows: [
      {
        title: "回到普通执行模式",
        tone: "muted",
      },
    ],
  });
}

export function buildPlanCancelSurface(input: {
  kind: "cancelled" | "empty" | "failed";
  workDir?: string;
  planPath?: string;
  detail?: string;
}): string {
  const detailLines: string[] = [];
  if (input.kind === "cancelled") {
    detailLines.push("计划已丢弃，计划模式已退出。");
  } else if (input.kind === "empty") {
    detailLines.push('计划模式已退出；使用 "/plan <goal>" 开始新计划。');
  } else {
    detailLines.push(input.detail ?? "计划状态未更新。");
  }
  if (input.workDir && input.planPath) {
    detailLines.unshift(
      `计划文件 ${formatHumanPlanFilePath({
        workDir: input.workDir,
        planPath: input.planPath,
      })}`,
    );
  }
  return renderPlanSurface({
    title: input.kind === "cancelled"
      ? "已取消计划"
      : input.kind === "empty"
        ? "当前没有可取消的计划"
        : "取消计划失败",
    rows: [
      {
        title: input.kind === "cancelled"
          ? "计划已取消"
          : input.kind === "empty"
            ? "没有活跃计划"
            : "计划状态未更新",
        detailLines,
      },
    ],
  });
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
  const detailLines: string[] = [];
  if (displayPath) {
    detailLines.push(`计划文件 ${displayPath}`);
  }
  if (compactGoal) {
    detailLines.push(`目标 ${truncateDisplayWidth(compactGoal, 88)}`);
  }
  detailLines.push(
    "Grobot 正在探索并设计实现方案。",
    "确认计划前，计划模式只会读取和规划。",
  );
  return `${renderPlanSurface({
    title: "已进入计划模式",
    rows: [
      {
        title: "开始规划",
        detailLines,
      },
    ],
  })}\n`;
}

export function buildPlanKeptInPlanningSurface(): string {
  return renderPlanSurface({
    title: "已继续留在计划模式",
    rows: [
      {
        title: "继续规划",
        detailLines: [
          '直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。',
        ],
      },
    ],
  });
}

export function buildPlanNeedsRefinementSurface(detail: string): string {
  return renderPlanSurface({
    title: "计划需要继续完善",
    rows: [
      {
        title: detail,
        detailLines: [
          '直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。',
        ],
      },
    ],
  });
}

export function buildPlanUpdatedSurface(input: {
  phase: string;
  nextAction: string;
}): string {
  return renderPlanSurface({
    title: "计划已更新",
    rows: [
      {
        title: `状态 ${input.phase}`,
        detailLines: [
          `接下来 ${input.nextAction}`,
        ],
      },
    ],
  });
}

export function buildPlanCommandErrorSurface(reason: string): string {
  return renderPlanSurface({
    title: "Plan",
    rows: [
      {
        title: reason,
        tone: "muted",
      },
    ],
  });
}
