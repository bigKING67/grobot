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
    lines.push(`目标: ${goal}`);
  }
  const scope = firstMeaningfulPlanSectionLine(
    extractPlanSectionBody(input.planContent, "Scope In"),
  );
  if (scope) {
    lines.push(`范围: ${scope}`);
  }
  const validation = firstMeaningfulPlanSectionLine(
    extractPlanSectionBody(input.planContent, "Validation"),
  );
  if (validation) {
    lines.push(`验证: ${validation}`);
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
  const lines: string[] = [];
  switch (input.kind) {
    case "no_active":
      lines.push(`${terminalStyle.planMode("●")} 当前没有可执行的计划`);
      break;
    case "lock_recovered":
      lines.push(`${terminalStyle.planMode("●")} 已恢复计划执行锁`);
      break;
    case "already_applying":
      lines.push(`${terminalStyle.planMode("●")} 计划正在执行中`);
      break;
    case "invalid_status":
      lines.push(`${terminalStyle.planMode("●")} 当前计划不能执行`);
      break;
    case "internal_failure":
      lines.push(`${terminalStyle.planMode("●")} 计划执行准备失败`);
      break;
  }
  if (input.workDir && input.planPath) {
    lines.push(
      `  ${terminalStyle.muted(`计划文件: ${formatHumanPlanFilePath({
        workDir: input.workDir,
        planPath: input.planPath,
      })}`)}`,
    );
  }
  if (input.kind === "no_active") {
    lines.push(`  ${terminalStyle.muted('请先使用 "/plan <goal>" 写出计划。')}`);
  } else if (input.kind === "lock_recovered") {
    const staleText = Number.isFinite(input.staleMs) ? ` · stale ${String(input.staleMs)}ms` : "";
    lines.push(`  ${terminalStyle.muted(`上次执行锁已过期，已安全恢复${staleText}。`)}`);
  } else if (input.kind === "already_applying") {
    lines.push(`  ${terminalStyle.muted("请等待当前执行完成；需要停止时按 Esc。")}`);
  } else if (input.kind === "invalid_status") {
    lines.push(`  ${terminalStyle.muted(`状态: ${input.statusLabel ?? "未知"}`)}`);
    lines.push(`  ${terminalStyle.muted('如需重新规划，请使用 "/plan <goal>" 开始新计划。')}`);
  } else {
    lines.push(`  ${terminalStyle.muted(input.detail ?? "计划状态未更新。")}`);
  }
  if (input.diagnostic) {
    lines.push(`  ${terminalStyle.muted(`诊断: ${input.diagnostic}`)}`);
  }
  lines.push("");
  return lines.join("\n");
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
    `${terminalStyle.planMode("●")} 计划已确认`,
    savedToHint
      ? `  ${terminalStyle.muted(`已确认 · ${savedToHint}`)}`
      : `  ${terminalStyle.muted("已确认")}`,
    ...renderApprovedPlanCard(input),
    "开始按已确认快照实现...",
    "",
  ].join("\n");
}
