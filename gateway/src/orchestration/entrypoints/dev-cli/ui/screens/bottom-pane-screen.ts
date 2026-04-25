import {
  compactSpaces,
  measureDisplayWidth,
  padToDisplayWidth,
  truncateDisplayWidth,
} from "../interactive/display-width";
import {
  resolveStatusLinePromptParts,
  type StatusLinePromptInput,
} from "./status-line-screen";
import { TERMINAL_ANSI, terminalStyle } from "../theme/terminal-style";

export interface BottomPanePromptInput extends StatusLinePromptInput {
  pendingAskCount?: number;
  pendingAskSummary?: string;
  running?: boolean;
}

type BottomPaneFooterMode = "idle" | "pending" | "running";

const SHORTCUT_OVERLAY_ROWS: Array<[string, string]> = [
  ["/", "for commands"],
  ["Shift+Enter", "for newline"],
  ["Esc", "back"],
  ["Tab", "apply"],
  ["Ctrl+R", "history"],
  ["Ctrl+V", "paste image"],
  ["Ctrl+C", "exit"],
  ["?", "hide"],
];

const SHORTCUT_OVERLAY_COMPACT_ROWS: Array<[string, string]> = [
  ["/", "for commands"],
  ["Shift+Enter", "for newline"],
  ["Esc", "back"],
  ["Tab", "apply"],
  ["Ctrl+C", "exit"],
  ["?", "hide"],
];

const FOOTER_HINT_MIN_COLUMNS = 64;
const FOOTER_SECONDARY_STATUS_MIN_COLUMNS = 64;
const FOOTER_MIN_STATUS_AFTER_HINT_WIDTH = 16;
const FOOTER_SEPARATOR = " · ";
const SHORTCUT_OVERLAY_TWO_COLUMN_MIN_COLUMNS = 72;
const SHORTCUT_OVERLAY_COMPACT_MAX_COLUMNS = 56;
const SHORTCUT_OVERLAY_KEY_COLUMN_WIDTH = 11;
const SHORTCUT_OVERLAY_KEY_GAP = "  ";
const SHORTCUT_OVERLAY_COLUMN_GAP = "  ";
const SHORTCUT_OVERLAY_FALLBACK_COLUMN_WIDTH = 27;

function resolveTerminalColumns(columns: number | undefined): number {
  if (typeof columns !== "number" || !Number.isFinite(columns)) {
    return 0;
  }
  return Math.max(0, Math.floor(columns));
}

function resolvePendingAskCount(input: BottomPanePromptInput): number {
  return typeof input.pendingAskCount === "number" && Number.isFinite(input.pendingAskCount)
    ? Math.max(0, Math.floor(input.pendingAskCount))
    : 0;
}

function resolveBottomPaneFooterMode(input: BottomPanePromptInput): BottomPaneFooterMode {
  if (input.running) {
    return "running";
  }
  if (resolvePendingAskCount(input) > 0) {
    return "pending";
  }
  return "idle";
}

function buildPendingAskLine(input: BottomPanePromptInput): string | undefined {
  const pendingAskCount = resolvePendingAskCount(input);
  if (pendingAskCount <= 0) {
    return undefined;
  }
  const summary = compactSpaces(input.pendingAskSummary ?? "");
  const baseLine = summary.length > 0
    ? `待确认 ${String(pendingAskCount)} 项 · ${summary}`
    : `待确认 ${String(pendingAskCount)} 项 · 回复继续`;
  const terminalColumns = resolveTerminalColumns(input.terminalColumns);
  if (terminalColumns > 0) {
    return truncateDisplayWidth(baseLine, terminalColumns);
  }
  return baseLine;
}

function buildInputHintLine(input: BottomPanePromptInput): string | undefined {
  if (resolveBottomPaneFooterMode(input) !== "idle") {
    return undefined;
  }
  return "? for shortcuts";
}

function fitFooterLine(input: {
  line: string;
  terminalColumns?: number;
}): string {
  const terminalColumns = resolveTerminalColumns(input.terminalColumns);
  if (terminalColumns > 0) {
    return truncateDisplayWidth(input.line, terminalColumns);
  }
  return input.line;
}

function joinFooterSummary(input: {
  left?: string;
  right?: string;
  terminalColumns?: number;
}): string | undefined {
  const left = compactSpaces(input.left ?? "");
  const right = compactSpaces(input.right ?? "");
  if (!left) {
    return right ? fitFooterLine({ line: right, terminalColumns: input.terminalColumns }) : undefined;
  }
  if (!right) {
    return fitFooterLine({ line: left, terminalColumns: input.terminalColumns });
  }
  const combined = `${left}${FOOTER_SEPARATOR}${right}`;
  const terminalColumns = resolveTerminalColumns(input.terminalColumns);
  if (terminalColumns <= 0 || measureDisplayWidth(combined) <= terminalColumns) {
    return combined;
  }

  if (terminalColumns < FOOTER_HINT_MIN_COLUMNS) {
    return fitFooterLine({ line: right, terminalColumns: input.terminalColumns });
  }

  const rightWidth =
    terminalColumns - measureDisplayWidth(left) - measureDisplayWidth(FOOTER_SEPARATOR);
  if (rightWidth >= FOOTER_MIN_STATUS_AFTER_HINT_WIDTH) {
    return `${left}${FOOTER_SEPARATOR}${truncateDisplayWidth(right, rightWidth)}`;
  }

  return fitFooterLine({ line: right, terminalColumns: input.terminalColumns });
}

function shouldRenderSecondaryStatus(input: BottomPanePromptInput): boolean {
  const terminalColumns = resolveTerminalColumns(input.terminalColumns);
  return terminalColumns <= 0 || terminalColumns >= FOOTER_SECONDARY_STATUS_MIN_COLUMNS;
}

function formatShortcutEntry(input: {
  keyLabel: string;
  description: string;
  alignKey?: boolean;
}): string {
  if (input.alignKey) {
    return `${padToDisplayWidth(
      input.keyLabel,
      SHORTCUT_OVERLAY_KEY_COLUMN_WIDTH,
    )}${SHORTCUT_OVERLAY_KEY_GAP}${input.description}`;
  }
  return `${input.keyLabel} ${input.description}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BOTTOM_PANE_STYLE = {
  dimLine(line: string): string {
    if (!line || terminalStyle.hasAnsi(line)) {
      return line;
    }
    return terminalStyle.muted(line);
  },
  idleFooterLine(line: string | undefined): string | undefined {
    if (!line || terminalStyle.hasAnsi(line)) {
      return line;
    }
    const highlightedHint =
      `${TERMINAL_ANSI.info}? for shortcuts${TERMINAL_ANSI.reset}${TERMINAL_ANSI.muted}`;
    return `${TERMINAL_ANSI.muted}${line.replace(
      "? for shortcuts",
      highlightedHint,
    )}${TERMINAL_ANSI.reset}`;
  },
  activityLine(line: string): string {
    if (!line || terminalStyle.hasAnsi(line)) {
      return line;
    }
    if (line.startsWith("~")) {
      return `${terminalStyle.info("~")}${line.slice(1)}`;
    }
    return line;
  },
  shortcutOverlayLine(line: string): string {
    if (!line) {
      return line;
    }
    let rendered = line;
    for (const [keyLabel] of [...SHORTCUT_OVERLAY_ROWS].sort((a, b) =>
      b[0].length - a[0].length
    )) {
      const highlightedKey =
        `${TERMINAL_ANSI.reset}${TERMINAL_ANSI.info}${keyLabel}`
        + `${TERMINAL_ANSI.reset}${TERMINAL_ANSI.muted}`;
      rendered = rendered.replace(
        new RegExp(escapeRegExp(keyLabel), "g"),
        highlightedKey,
      );
    }
    return `${TERMINAL_ANSI.muted}${rendered}${TERMINAL_ANSI.reset}`;
  },
} as const;

function shouldUseTwoColumnShortcutOverlay(terminalColumns: number): boolean {
  return terminalColumns <= 0 || terminalColumns >= SHORTCUT_OVERLAY_TWO_COLUMN_MIN_COLUMNS;
}

function resolveShortcutOverlayRows(terminalColumns: number): Array<[string, string]> {
  if (terminalColumns > 0 && terminalColumns <= SHORTCUT_OVERLAY_COMPACT_MAX_COLUMNS) {
    return SHORTCUT_OVERLAY_COMPACT_ROWS;
  }
  return SHORTCUT_OVERLAY_ROWS;
}

function renderShortcutOverlaySingleColumn(input: {
  terminalColumns: number;
  rows: Array<[string, string]>;
}): string[] {
  return input.rows.map(([keyLabel, description]) => {
    const entry = formatShortcutEntry({
      keyLabel,
      description,
      alignKey: true,
    });
    const line = input.terminalColumns > 0
      ? truncateDisplayWidth(entry, input.terminalColumns)
      : entry;
    return BOTTOM_PANE_STYLE.shortcutOverlayLine(line);
  });
}

export function renderShortcutOverlayFooter(input: {
  terminalColumns?: number;
} = {}): string {
  const terminalColumns = resolveTerminalColumns(input.terminalColumns);
  const rows = resolveShortcutOverlayRows(terminalColumns);
  if (!shouldUseTwoColumnShortcutOverlay(terminalColumns)) {
    return renderShortcutOverlaySingleColumn({ terminalColumns, rows }).join("\n");
  }

  const columnGapWidth = measureDisplayWidth(SHORTCUT_OVERLAY_COLUMN_GAP);
  const entryWidth = terminalColumns > 0
    ? Math.max(
      1,
      Math.floor((terminalColumns - columnGapWidth) / 2),
    )
    : SHORTCUT_OVERLAY_FALLBACK_COLUMN_WIDTH;
  const lines: string[] = [];
  for (let index = 0; index < rows.length; index += 2) {
    const left = rows[index];
    const right = rows[index + 1];
    if (!left) {
      continue;
    }
    const leftEntry = formatShortcutEntry({
      keyLabel: left[0],
      description: left[1],
      alignKey: true,
    });
    const rightEntry = right
      ? formatShortcutEntry({
        keyLabel: right[0],
        description: right[1],
        alignKey: true,
      })
      : "";
    const leftFitted = truncateDisplayWidth(leftEntry, entryWidth);
    const rightFitted = rightEntry.length > 0
      ? truncateDisplayWidth(rightEntry, entryWidth)
      : "";
    const line = rightFitted.length > 0
      ? `${padToDisplayWidth(
        leftFitted,
        entryWidth,
      )}${SHORTCUT_OVERLAY_COLUMN_GAP}${rightFitted}`
      : leftFitted;
    const fittedLine = terminalColumns > 0 ? truncateDisplayWidth(line, terminalColumns) : line;
    lines.push(BOTTOM_PANE_STYLE.shortcutOverlayLine(fittedLine));
  }
  return lines.join("\n");
}

export function renderBottomPaneFooter(input: BottomPanePromptInput): string {
  const parts = resolveStatusLinePromptParts(input);
  const mode = resolveBottomPaneFooterMode(input);
  const pendingAskLine = buildPendingAskLine(input);
  const inputHintLine = buildInputHintLine(input);
  const renderSecondaryStatus = shouldRenderSecondaryStatus(input);
  const lines: string[] = [];
  const pushLine = (line: string | undefined): void => {
    if (!line || line.length === 0 || lines.includes(line)) {
      return;
    }
    lines.push(line);
  };

  if (mode === "running") {
    pushLine(BOTTOM_PANE_STYLE.activityLine(fitFooterLine({
      line: parts.activityLine ?? "~ 正在处理",
      terminalColumns: input.terminalColumns,
    })));
    if (renderSecondaryStatus) {
      pushLine(BOTTOM_PANE_STYLE.dimLine(parts.statusLine));
    }
    pushLine(pendingAskLine);
    pushLine(parts.warningLine);
  } else if (mode === "pending") {
    pushLine(pendingAskLine);
    if (renderSecondaryStatus) {
      pushLine(BOTTOM_PANE_STYLE.dimLine(parts.statusLine));
    }
    pushLine(parts.warningLine);
  } else {
    pushLine(BOTTOM_PANE_STYLE.idleFooterLine(joinFooterSummary({
      left: inputHintLine,
      right: parts.statusLine,
      terminalColumns: input.terminalColumns,
    })));
    pushLine(parts.warningLine);
    if (!pendingAskLine && parts.warningLine) {
      pushLine(parts.activityLine);
    }
  }

  if (lines.length === 0) {
    return "";
  }
  return lines.join("\n");
}
