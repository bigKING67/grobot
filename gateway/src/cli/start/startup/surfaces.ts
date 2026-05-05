import { renderInfoPanel } from "../../tui/components/info-panel/render";
import type {
  InfoPanelRow,
  InfoPanelTone,
} from "../../tui/components/info-panel/contract";

export function formatDiagnosticToken(
  value: string | undefined,
  fallback = "<none>",
): string {
  const normalized = (value ?? fallback)
    .replace(/[^\x20-\x7E]+/g, "_")
    .replace(/\s+/g, "_")
    .trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, 360);
}

function humanizeInterruptSource(source: "command" | "cli_esc"): string {
  return source === "cli_esc" ? "Esc" : "/interrupt";
}

function compactSurface(input: {
  title: string;
  titleTone?: InfoPanelTone;
  rows: readonly InfoPanelRow[];
  footerLines?: readonly string[];
}): string {
  return renderInfoPanel({
    title: input.title,
    titleTone: input.titleTone ?? "brand",
    sections: [{ rows: input.rows }],
    footerLines: input.footerLines,
  });
}

function reasonDetailLine(reason: string | undefined): string[] {
  if (!reason || reason.trim().length === 0) {
    return [];
  }
  return [`reason ${formatDiagnosticToken(reason)}`];
}

export function buildRuntimeInterruptSurface(input: {
  code: string;
  kind: "requested" | "not_running";
  source: "command" | "cli_esc";
}): string {
  const sourceLabel = humanizeInterruptSource(input.source);
  if (input.kind === "requested") {
    return compactSurface({
      title: "Runtime interrupt requested",
      rows: [{
        title: `source ${sourceLabel}`,
        detailLines: [
          "Trying to stop safely.",
          `diagnostic ${input.code}`,
        ],
      }],
    });
  }
  return compactSurface({
    title: "No running turn",
    rows: [{
      title: `${sourceLabel} only interrupts a running turn.`,
      detailLines: [`diagnostic ${input.code}`],
    }],
  });
}

export function buildRuntimeInterruptIgnoredSurface(input: {
  source: "command" | "cli_esc";
}): string {
  const sourceLabel = humanizeInterruptSource(input.source);
  return compactSurface({
    title: "Interrupt request ignored",
    rows: [{
      title: `${sourceLabel} request was skipped.`,
      detailLines: ["Current turn completed or passed the safe interrupt point."],
    }],
  });
}

export function buildRuntimeToolsFallbackSurface(input: {
  reason: string | undefined;
  source: string;
}): string {
  return compactSurface({
    title: "Runtime tool description unavailable",
    rows: [{
      title: "Started with built-in tool schema.",
      detailLines: [
        `source ${input.source}`,
        ...reasonDetailLine(input.reason),
        "For full diagnostics, run grobot status --json.",
      ],
    }],
  });
}

export function buildMcpInstructionStrictFailureSurface(
  reason: string | undefined,
): string {
  return compactSurface({
    title: "MCP instruction load failed",
    rows: [{
      title: "Strict mode requires instruction packs for all enabled MCP servers.",
      detailLines: [
        ...reasonDetailLine(reason),
        "Add .grobot/rules/mcp/<server>.md or disable mcp.instructions.strict.",
      ],
    }],
  });
}

export function buildExperienceSchedulerTickErrorSurface(
  error: string | undefined,
): string {
  return compactSurface({
    title: "Experience scheduler tick failed",
    rows: [{
      title: "Background task skipped this turn; current input is unaffected.",
      detailLines: [
        ...reasonDetailLine(error),
        "For full diagnostics, retry with GROBOT_STARTUP_DIAGNOSTICS=1.",
      ],
    }],
  });
}

export function buildExperienceSchedulerTaskFailedSurface(input: {
  taskId: string;
  error: string | undefined;
}): string {
  return compactSurface({
    title: "Experience task failed",
    rows: [{
      title: `task ${input.taskId || "unknown task"}`,
      detailLines: [
        "The failure was recorded; input can continue.",
        ...reasonDetailLine(input.error),
      ],
    }],
  });
}

export function buildMemoryMaintenanceFailedSurface(input: {
  reason: string;
  error: string | undefined;
}): string {
  return compactSurface({
    title: "Memory maintenance failed",
    rows: [{
      title: `stage ${input.reason || "unknown"}`,
      detailLines: [
        "This conversation will continue; background memory cleanup will retry later.",
        ...reasonDetailLine(input.error),
        "For full diagnostics, retry with GROBOT_STARTUP_DIAGNOSTICS=1.",
      ],
    }],
  });
}

export function buildRewindCaptureFailedSurface(
  error: string | undefined,
): string {
  return compactSurface({
    title: "Checkpoint capture failed",
    rows: [{
      title: "This turn continued.",
      detailLines: [
        "This step cannot be used for /rewind.",
        ...reasonDetailLine(error),
      ],
    }],
  });
}
