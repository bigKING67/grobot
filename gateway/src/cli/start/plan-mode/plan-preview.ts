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
    "Grobot is drafting the implementation plan.",
    "Before final confirmation, plan mode only reads and plans.",
    'Type more details to refine it, or use "/plan open" to edit the draft.',
  ];
  return renderPlanSurface({
    title: "Plan draft",
    rows: [
      {
        title: "Draft created",
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
    ? `Use "/plan open" to edit this plan in ${editorName}`
    : 'Use "/plan open" to edit this plan';
  const planFileDetailLines = [
    ...(input.statusLabel ? [`status ${input.statusLabel}`] : []),
    ...(input.statusDetailLines ?? []),
  ];
  return [
    renderInfoPanel({
      title: "Current plan",
      titleTone: "planMode",
      sections: [{
        rows: [{
          title: `plan file ${displayPath}`,
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
  return `Plan saved: ${formatHumanPlanFilePath({
    workDir: input.workDir,
    planPath: input.planPath,
  })} · /plan open to edit`;
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
      title: "Exit plan mode?",
      titleTone: "planMode",
      sections: [{
        rows: [{
          title: `plan file ${displayPath}`,
          detailLines: ["Grobot will exit plan mode"],
        }],
      }],
    }),
    "",
    "❯ Yes, exit",
    "  No, keep planning",
    "",
    `Edit: /plan open · ${displayPath}`,
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
      title: "Ready to implement?",
      titleTone: "planMode",
      sections: [{
        rows: [{
          title: `plan file ${displayPath}`,
          detailLines: ["Confirm the plan before execution."],
        }],
      }],
    }),
    "",
    divider,
    "Grobot plan:",
    "",
    planContent,
    divider,
    "",
    "─".repeat(Math.max(24, measureDisplayWidth(divider))),
    "Start implementation?",
    "",
    "❯ Confirm, implement plan",
    "  Refine plan",
    "",
    `Edit: /plan open · ${displayPath}`,
    "",
  ].join("\n");
}
