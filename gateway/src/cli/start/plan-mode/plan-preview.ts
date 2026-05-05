import {
  PLAN_APPROVAL_DIALOG_MAX_WIDTH,
  PLAN_APPROVAL_DIALOG_MIN_WIDTH,
  PLAN_STATUS_PREVIEW_MAX_CHARS,
  PLAN_STATUS_PREVIEW_MAX_LINES,
} from "./constants";
import { formatHumanPlanFilePath } from "./path";
import {
  compactSpaces,
  measureDisplayWidth,
} from "../../tui/terminal/display-width";
import { renderInfoPanel } from "../../tui/components/info-panel/render";
import { renderPlanSurface } from "./info-surface";
import { terminalStyle } from "../../tui/theme/terminal-style";

export function compactPlanStatusLine(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= PLAN_STATUS_PREVIEW_MAX_CHARS) {
    return normalized;
  }
  if (PLAN_STATUS_PREVIEW_MAX_CHARS <= 1) {
    return normalized.slice(0, Math.max(0, PLAN_STATUS_PREVIEW_MAX_CHARS));
  }
  return `${normalized.slice(0, PLAN_STATUS_PREVIEW_MAX_CHARS - 1)}…`;
}

export function buildPlanStatusPreviewLines(content: string): string[] {
  if (!content.trim()) {
    return [];
  }
  const lines = content
    .split(/\r?\n/)
    .map((line) => compactPlanStatusLine(line))
    .filter((line) => line.length > 0);
  return lines.slice(0, PLAN_STATUS_PREVIEW_MAX_LINES);
}

function isInternalPlanMetadataLine(line: string): boolean {
  return /^[-*]\s*(?:session_id|plan_id|seq|status|created_at|updated_at)\s*:/i.test(line.trim());
}

export function stripInternalPlanMetadata(content: string): string {
  const lines = content.split(/\r?\n/);
  const kept: string[] = [];
  let beforeFirstSection = true;
  let previousWasDropped = false;
  for (const line of lines) {
    if (/^##\s+/.test(line.trim())) {
      beforeFirstSection = false;
    }
    if (beforeFirstSection && isInternalPlanMetadataLine(line)) {
      previousWasDropped = true;
      continue;
    }
    if (previousWasDropped && beforeFirstSection && line.trim().length === 0) {
      previousWasDropped = false;
      continue;
    }
    previousWasDropped = false;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

export function isUnwrittenPlanSkeleton(content: string): boolean {
  const normalized = content.trim();
  return normalized.length === 0 || normalized.includes("__REQUIRED__");
}

export function buildPlanDraftStatusDisplay(input: {
  workDir: string;
  planPath?: string;
}): string {
  const displayPath = input.planPath
    ? formatHumanPlanFilePath({
      workDir: input.workDir,
      planPath: input.planPath,
    })
    : undefined;
  const detailLines = [
    ...(displayPath ? [displayPath] : []),
    "Grobot 正在整理实现计划。",
    "确认最终计划前，计划模式只会读取和规划。",
    '直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。',
  ];
  return renderPlanSurface({
    title: "计划草稿",
    rows: [
      {
        title: "草稿已创建",
        detailLines,
      },
    ],
  });
}

export function buildCurrentPlanDisplay(input: {
  workDir: string;
  planPath: string;
  planContent: string;
  editorName?: string;
  statusLabel?: string;
  statusDetailLines?: readonly string[];
}): string {
  const displayPath = formatHumanPlanFilePath({
    workDir: input.workDir,
    planPath: input.planPath,
  });
  const planContent = stripInternalPlanMetadata(input.planContent);
  if (isUnwrittenPlanSkeleton(input.planContent)) {
    return buildPlanDraftStatusDisplay({
      workDir: input.workDir,
      planPath: input.planPath,
    });
  }
  const editorName = compactSpaces(input.editorName ?? "");
  const editHint = editorName.length > 0
    ? `使用 "/plan open" 在 ${editorName} 中编辑此计划`
    : '使用 "/plan open" 编辑此计划';
  const planFileDetailLines = [
    ...(input.statusLabel ? [`状态 ${input.statusLabel}`] : []),
    ...(input.statusDetailLines ?? []),
  ];
  return [
    renderInfoPanel({
      title: "当前计划",
      titleTone: "planMode",
      sections: [{
        rows: [{
          title: `计划文件 ${displayPath}`,
          detailLines: planFileDetailLines.length > 0 ? planFileDetailLines : undefined,
        }],
      }],
    }),
    "",
    planContent,
    "",
    editHint,
    "",
  ].join("\n");
}

function buildPlanApprovalDivider(planContent: string): string {
  const maxPlanLineWidth = planContent
    .split(/\r?\n/)
    .map((line) => measureDisplayWidth(line.trimEnd()))
    .reduce((max, width) => Math.max(max, width), 0);
  const width = Math.min(
    PLAN_APPROVAL_DIALOG_MAX_WIDTH,
    Math.max(PLAN_APPROVAL_DIALOG_MIN_WIDTH, maxPlanLineWidth),
  );
  return "┄".repeat(width);
}

export function buildPlanSavedToHint(input: {
  workDir: string;
  planPath?: string;
}): string | undefined {
  if (!input.planPath) {
    return undefined;
  }
  return `计划已保存: ${formatHumanPlanFilePath({
    workDir: input.workDir,
    planPath: input.planPath,
  })} · /plan open 编辑`;
}

function buildExitPlanModeSurface(input: {
  workDir: string;
  planPath: string;
}): string {
  const displayPath = formatHumanPlanFilePath({
    workDir: input.workDir,
    planPath: input.planPath,
  });
  return [
    renderInfoPanel({
      title: "退出计划模式?",
      titleTone: "planMode",
      sections: [{
        rows: [{
          title: `计划文件 ${displayPath}`,
          detailLines: ["Grobot 将退出计划模式"],
        }],
      }],
    }),
    "",
    "❯ 是，退出",
    "  否，继续规划",
    "",
    `编辑: /plan open · ${displayPath}`,
    "",
  ].join("\n");
}

export function buildReadyToCodeSurface(input: {
  workDir: string;
  planPath: string;
  planContent: string;
}): string {
  const displayPath = formatHumanPlanFilePath({
    workDir: input.workDir,
    planPath: input.planPath,
  });
  const planContent = stripInternalPlanMetadata(input.planContent);
  if (isUnwrittenPlanSkeleton(input.planContent) || planContent.trim().length === 0) {
    return buildExitPlanModeSurface({
      workDir: input.workDir,
      planPath: input.planPath,
    });
  }
  const divider = buildPlanApprovalDivider(planContent);
  return [
    renderInfoPanel({
      title: "准备开始实现？",
      titleTone: "planMode",
      sections: [{
        rows: [{
          title: `计划文件 ${displayPath}`,
          detailLines: ["执行前请确认计划。"],
        }],
      }],
    }),
    "",
    divider,
    "Grobot 的计划：",
    "",
    planContent,
    divider,
    "",
    "─".repeat(Math.max(24, measureDisplayWidth(divider))),
    "是否开始执行？",
    "",
    "❯ 确认，开始实现计划",
    "  继续完善计划",
    "",
    `编辑: /plan open · ${displayPath}`,
    "",
  ].join("\n");
}
