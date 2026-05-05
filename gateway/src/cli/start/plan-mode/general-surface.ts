import { formatHumanPlanFilePath } from "./path";
import { compactSpaces, truncateDisplayWidth } from "../../tui/terminal/display-width";
import { renderPlanSurface } from "./info-surface";

export function buildExitedPlanModeSurface(): string {
  return renderPlanSurface({
    title: "Exited plan mode",
    rows: [
      {
        title: "Back to normal execution mode",
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
    detailLines.push("Plan discarded and plan mode exited.");
  } else if (input.kind === "empty") {
    detailLines.push('Plan mode exited; use "/plan <goal>" to start a new plan.');
  } else {
    detailLines.push(input.detail ?? "Plan status was not updated.");
  }
  if (input.workDir && input.planPath) {
    detailLines.unshift(
      `plan file ${formatHumanPlanFilePath({
        workDir: input.workDir,
        planPath: input.planPath,
      })}`,
    );
  }
  return renderPlanSurface({
    title: input.kind === "cancelled"
      ? "Plan cancelled"
      : input.kind === "empty"
        ? "No plan to cancel"
        : "Plan cancel failed",
    rows: [
      {
        title: input.kind === "cancelled"
          ? "Plan cancelled"
          : input.kind === "empty"
            ? "No active plan"
            : "Plan status was not updated",
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
    detailLines.push(`plan file ${displayPath}`);
  }
  if (compactGoal) {
    detailLines.push(`goal ${truncateDisplayWidth(compactGoal, 88)}`);
  }
  detailLines.push(
    "Grobot is exploring and designing the implementation plan.",
    "Before confirmation, plan mode only reads and plans.",
  );
  return `${renderPlanSurface({
    title: "Entered plan mode",
    rows: [
      {
        title: "Planning started",
        detailLines,
      },
    ],
  })}\n`;
}

export function buildPlanKeptInPlanningSurface(): string {
  return renderPlanSurface({
    title: "Still in plan mode",
    rows: [
      {
        title: "Keep planning",
        detailLines: [
          'Type more details to refine it, or use "/plan open" to edit the draft.',
        ],
      },
    ],
  });
}

export function buildPlanNeedsRefinementSurface(detail: string): string {
  return renderPlanSurface({
    title: "Plan needs refinement",
    rows: [
      {
        title: detail,
        detailLines: [
          'Type more details to refine it, or use "/plan open" to edit the draft.',
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
    title: "Plan updated",
    rows: [
      {
        title: `status ${input.phase}`,
        detailLines: [
          `next ${input.nextAction}`,
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
