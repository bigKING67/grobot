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
    return "<missing>";
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
    lines.push(`Goal ${goal}`);
  }
  const scope = firstMeaningfulPlanSectionLine(
    extractPlanSectionBody(input.planContent, "Scope In"),
  );
  if (scope) {
    lines.push(`Scope ${scope}`);
  }
  const validation = firstMeaningfulPlanSectionLine(
    extractPlanSectionBody(input.planContent, "Validation"),
  );
  if (validation) {
    lines.push(`Validation ${validation}`);
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
      return "No executable plan in this session; create or open a plan first.";
    case "PLAN_APPLY_INVALID_STATUS":
      return "Plan status cannot be executed; replan or choose a plan still awaiting confirmation.";
    case "PLAN_ENTER_ACTIVE_PLAN_MISSING":
      return "Plan mode did not create an active plan; start planning again.";
    case "PLAN_PROGRESS_APPEND_FAILED":
      return "Plan progress was not written; open the plan file and check status.";
    case "PLAN_REVIEW_ACTIVE_PLAN_MISSING":
      return "No active plan after update; reopen the current plan.";
    case "PLAN_REVIEW_ENTRY_MISSING":
      return "Plan record missing; regenerate the plan before review.";
    case "PLAN_APPROVAL_FAILED":
      return "Plan approval metadata was not written; confirm the plan again.";
    case "PLAN_APPLY_STATUS_UPDATE_FAILED":
      return "Plan status could not switch to applying; confirm the plan file is writable.";
    case "PLAN_APPLY_APPROVAL_METADATA_MISSING":
      return "Approval ticket or plan snapshot missing; confirm the plan again before execution.";
    default:
      return "Plan execution preparation did not finish; enable verbose plan logs for full fields.";
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
  let title = "Plan execution preparation failed";
  let primary = "Plan status was not updated.";
  switch (input.kind) {
    case "no_active":
      title = "No executable plan";
      primary = 'Use "/plan <goal>" to write a plan first.';
      break;
    case "lock_recovered":
      title = "Plan execution lock recovered";
      primary = "Execution lock recovered";
      break;
    case "already_applying":
      title = "Plan is already applying";
      primary = "Wait for the current execution to finish; press Esc to stop.";
      break;
    case "invalid_status":
      title = "Current plan cannot execute";
      primary = `status ${input.statusLabel ?? "unknown"}`;
      break;
    case "internal_failure":
      title = "Plan execution preparation failed";
      primary = input.detail ?? "Plan status was not updated.";
      break;
  }
  if (input.workDir && input.planPath) {
    detailLines.push(
      `plan file ${formatHumanPlanFilePath({
        workDir: input.workDir,
        planPath: input.planPath,
      })}`,
    );
  }
  if (input.kind === "lock_recovered") {
    const staleText = Number.isFinite(input.staleMs) ? ` · stale ${String(input.staleMs)}ms` : "";
    detailLines.push(`Previous execution lock expired and was safely recovered${staleText}.`);
  } else if (input.kind === "invalid_status") {
    detailLines.push('To replan, use "/plan <goal>" to start a new plan.');
  }
  if (input.diagnostic) {
    detailLines.push(`details ${formatPlanApplyDiagnosticHint(input.diagnostic)}`);
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
  const bodyLines = previewLines.length > 0 ? previewLines : ["Plan confirmed"];
  const footer = `approved ${compactPlanApprovalFingerprint(input.ticketId)} · sha256 ${compactPlanApprovalFingerprint(input.approvedHash)}`;
  const titleLabel = "Plan to implement";
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
      title: "Plan confirmed",
      rows: [{
        title: savedToHint ? `confirmed · ${savedToHint}` : "confirmed",
      }],
    }),
    ...renderApprovedPlanCard(input),
    "Starting implementation from the approved snapshot...",
    "",
  ].join("\n");
}
