import {
  PLAN_APPROVAL_CARD_MAX_INNER_WIDTH,
  PLAN_APPROVAL_CARD_MAX_LINES,
  PLAN_APPROVAL_CARD_MIN_INNER_WIDTH,
  PLAN_APPROVAL_FINGERPRINT_CHARS,
} from "./constants";
import { buildPlanSavedToHint, buildPlanStatusPreviewLines } from "./plan-preview";
import { formatHumanPlanFilePath } from "./path";
import {
  compactSpaces,
  measureDisplayWidth,
  padToDisplayWidth,
  truncateDisplayWidth,
} from "../../tui/terminal/display-width";
import { renderPlanSurface } from "./info-surface";
import { terminalStyle } from "../../tui/theme/terminal-style";

function compactPlanApprovalFingerprint(value: string | undefined): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return "<缺失>";
  }
  return normalized.slice(0, PLAN_APPROVAL_FINGERPRINT_CHARS);
}

function extractTopLevelPlanHeading(content: string): string | undefined {
  for (const line of content.split(/\r?\n/)) {
    const match = line.trim().match(/^#\s+(.+)$/);
    if (match?.[1]?.trim()) {
      return compactSpaces(match[1]);
    }
  }
  return undefined;
}

function extractPlanSectionBody(content: string, heading: string): string | undefined {
  const normalizedHeading = heading.trim().toLowerCase();
  const lines = content.split(/\r?\n/);
  const bodyLines: string[] = [];
  let collecting = false;
  for (const line of lines) {
    const headingMatch = line.trim().match(/^##\s+(.+)$/);
    if (headingMatch) {
      if (collecting) {
        break;
      }
      collecting = headingMatch[1]!.trim().toLowerCase() === normalizedHeading;
      continue;
    }
    if (collecting) {
      bodyLines.push(line);
    }
  }
  return collecting ? bodyLines.join("\n") : undefined;
}

function normalizePlanPreviewLine(line: string): string {
  const withoutMarkdown = line
    .replace(/^\s*[-*]\s+/, "")
    .replace(/^\s*\d+\.\s+/, "")
    .replace(/^\s*\[[ xX]\]\s+/, "")
    .replace(/^#+\s+/, "")
    .replace(/\b__REQUIRED__\b\s*[:：]?\s*/gi, "");
  return compactSpaces(withoutMarkdown);
}

function isPlanMetadataPreviewLine(line: string): boolean {
  return /^[-*]\s*(?:session_id|plan_id|seq|status)\s*:/i.test(line.trim());
}

function firstMeaningfulPlanSectionLine(body: string | undefined): string | undefined {
  if (!body) {
    return undefined;
  }
  for (const line of body.split(/\r?\n/)) {
    if (isPlanMetadataPreviewLine(line)) {
      continue;
    }
    const normalized = normalizePlanPreviewLine(line);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function buildHumanPlanPreviewLines(input: {
  title?: string;
  planContent: string;
}): string[] {
  const lines: string[] = [];
  const heading = extractTopLevelPlanHeading(input.planContent);
  const title = heading ?? input.title?.trim();
  if (title) {
    lines.push(compactSpaces(title));
  }

  const goal = firstMeaningfulPlanSectionLine(
    extractPlanSectionBody(input.planContent, "Goal"),
  );
  if (goal) {
    lines.push(`目标 ${goal}`);
  }
  const scope = firstMeaningfulPlanSectionLine(
    extractPlanSectionBody(input.planContent, "Scope In"),
  );
  if (scope) {
    lines.push(`范围 ${scope}`);
  }
  const validation = firstMeaningfulPlanSectionLine(
    extractPlanSectionBody(input.planContent, "Validation"),
  );
  if (validation) {
    lines.push(`验证 ${validation}`);
  }

  if (lines.length <= 1) {
    for (const fallbackLine of buildPlanStatusPreviewLines(input.planContent)) {
      if (!isPlanMetadataPreviewLine(fallbackLine)) {
        lines.push(fallbackLine);
      }
      if (lines.length >= PLAN_APPROVAL_CARD_MAX_LINES) {
        break;
      }
    }
  }

  return [...new Set(lines)].slice(0, PLAN_APPROVAL_CARD_MAX_LINES);
}

function formatPlanApplyDiagnosticHint(diagnostic: string): string {
  switch (diagnostic.trim()) {
    case "PLAN_APPLY_NO_ACTIVE_PLAN":
      return "当前会话还没有可执行计划；先创建或打开计划后再执行。";
    case "PLAN_APPLY_INVALID_STATUS":
      return "计划状态不允许执行；需要重新规划或选择仍待确认的计划。";
    case "PLAN_ENTER_ACTIVE_PLAN_MISSING":
      return "进入计划模式后未生成活动计划；请重新发起计划。";
    case "PLAN_PROGRESS_APPEND_FAILED":
      return "计划备注没有写入成功；请打开计划文件确认状态。";
    case "PLAN_REVIEW_ACTIVE_PLAN_MISSING":
      return "计划更新后未找到活动计划；请重新打开当前计划。";
    case "PLAN_REVIEW_ENTRY_MISSING":
      return "计划记录缺失，无法完成评审；请重新生成计划。";
    case "PLAN_APPROVAL_FAILED":
      return "计划确认元数据未写入成功；请重新确认计划。";
    case "PLAN_APPLY_STATUS_UPDATE_FAILED":
      return "计划状态未能切换到执行中；请确认计划文件可写。";
    case "PLAN_APPLY_APPROVAL_METADATA_MISSING":
      return "缺少确认票据或计划快照；请重新确认计划后再执行。";
    default:
      return "计划执行准备未完成；开启详细 plan 日志可查看完整字段。";
  }
}

export function buildPlanApplyStateSurface(input: {
  kind:
    | "no_active"
    | "lock_recovered"
    | "already_applying"
    | "invalid_status"
    | "internal_failure";
  workDir?: string;
  planPath?: string;
  statusLabel?: string;
  staleMs?: number;
  detail?: string;
  diagnostic?: string;
}): string {
  const detailLines: string[] = [];
  let title = "计划执行准备失败";
  let primary = "计划状态未更新。";
  switch (input.kind) {
    case "no_active":
      title = "当前没有可执行的计划";
      primary = '请先使用 "/plan <goal>" 写出计划。';
      break;
    case "lock_recovered":
      title = "已恢复计划执行锁";
      primary = "执行锁已恢复";
      break;
    case "already_applying":
      title = "计划正在执行中";
      primary = "请等待当前执行完成；需要停止时按 Esc。";
      break;
    case "invalid_status":
      title = "当前计划不能执行";
      primary = `状态 ${input.statusLabel ?? "未知"}`;
      break;
    case "internal_failure":
      title = "计划执行准备失败";
      primary = input.detail ?? "计划状态未更新。";
      break;
  }
  if (input.workDir && input.planPath) {
    detailLines.push(
      `计划文件 ${formatHumanPlanFilePath({
        workDir: input.workDir,
        planPath: input.planPath,
      })}`,
    );
  }
  if (input.kind === "lock_recovered") {
    const staleText = Number.isFinite(input.staleMs) ? ` · stale ${String(input.staleMs)}ms` : "";
    detailLines.push(`上次执行锁已过期，已安全恢复${staleText}。`);
  } else if (input.kind === "invalid_status") {
    detailLines.push('如需重新规划，请使用 "/plan <goal>" 开始新计划。');
  }
  if (input.diagnostic) {
    detailLines.push(`详情 ${formatPlanApplyDiagnosticHint(input.diagnostic)}`);
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

function renderPlanCardBorderLine(input: {
  left: string;
  right: string;
  label: string;
  innerWidth: number;
}): string {
  const safeLabel = truncateDisplayWidth(input.label, Math.max(0, input.innerWidth - 4), {
    compact: true,
  });
  const prefix = `─ ${safeLabel} `;
  const fillWidth = Math.max(0, input.innerWidth - measureDisplayWidth(prefix));
  return `${input.left}${prefix}${"─".repeat(fillWidth)}${input.right}`;
}

function renderPlanCardBodyLine(line: string, innerWidth: number): string {
  const bodyWidth = Math.max(0, innerWidth - 2);
  const fitted = padToDisplayWidth(
    truncateDisplayWidth(line, bodyWidth, { compact: true }),
    bodyWidth,
  );
  return `│ ${fitted} │`;
}

function renderApprovedPlanCard(input: {
  title?: string;
  approvedHash: string;
  ticketId: string;
  approvedPlanContent: string;
}): string[] {
  const previewLines = buildHumanPlanPreviewLines({
    title: input.title,
    planContent: input.approvedPlanContent,
  });
  const bodyLines = previewLines.length > 0 ? previewLines : ["已确认计划"];
  const footer = `确认 ${compactPlanApprovalFingerprint(input.ticketId)} · sha256 ${compactPlanApprovalFingerprint(input.approvedHash)}`;
  const titleLabel = "将要实现的计划";
  const innerWidth = Math.min(
    PLAN_APPROVAL_CARD_MAX_INNER_WIDTH,
    Math.max(
      PLAN_APPROVAL_CARD_MIN_INNER_WIDTH,
      measureDisplayWidth(titleLabel) + 4,
      measureDisplayWidth(footer) + 4,
      ...bodyLines.map((line) => measureDisplayWidth(compactSpaces(line)) + 2),
    ),
  );
  return [
    renderPlanCardBorderLine({
      left: "╭",
      right: "╮",
      label: titleLabel,
      innerWidth,
    }),
    ...bodyLines.map((line) => renderPlanCardBodyLine(line, innerWidth)),
    renderPlanCardBorderLine({
      left: "╰",
      right: "╯",
      label: footer,
      innerWidth,
    }),
  ];
}

export function buildApprovedPlanExecutionSurface(input: {
  workDir: string;
  planPath?: string;
  title?: string;
  approvedHash: string;
  ticketId: string;
  approvedPlanContent: string;
}): string {
  const savedToHint = buildPlanSavedToHint({
    workDir: input.workDir,
    planPath: input.planPath,
  });
  return [
    renderPlanSurface({
      title: "计划已确认",
      rows: [{
        title: savedToHint ? `已确认 · ${savedToHint}` : "已确认",
      }],
    }),
    ...renderApprovedPlanCard(input),
    "开始按已确认快照实现...",
    "",
  ].join("\n");
}
