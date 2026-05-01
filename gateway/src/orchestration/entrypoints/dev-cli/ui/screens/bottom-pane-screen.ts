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

interface ShortcutHelpEntry {
  keyLabel: string;
  description: string;
}

type ShortcutHelpColumn = readonly ShortcutHelpEntry[];

const SHORTCUT_HELP_DISCOVERY_ROWS: ShortcutHelpColumn = [
  ["/", "for commands"],
  ["/model", "model picker"],
  ["/plan", "plan mode"],
  ["/status", "status panel"],
  ["/history", "history list"],
].map(([keyLabel, description]) => ({ keyLabel, description }));

const SHORTCUT_HELP_EDITING_ROWS: ShortcutHelpColumn = [
  ["Shift+Enter", "for newline"],
  ["Esc", "back / clear"],
  ["Tab", "apply suggestion"],
  ["Ctrl+R", "history search"],
  ["Ctrl+V", "paste image"],
].map(([keyLabel, description]) => ({ keyLabel, description }));

const SHORTCUT_HELP_SESSION_ROWS: ShortcutHelpColumn = [
  ["Enter", "submit"],
  ["Up/Down", "move selection"],
  ["Left/Right", "move cursor"],
  ["Ctrl+C", "exit"],
  ["?", "hide"],
].map(([keyLabel, description]) => ({ keyLabel, description }));

const SHORTCUT_OVERLAY_MEDIUM_ROWS: ShortcutHelpColumn = [
  ["/", "for commands"],
  ["Shift+Enter", "for newline"],
  ["/model", "model picker"],
  ["Esc", "back / clear"],
  ["/plan", "plan mode"],
  ["Tab", "apply suggestion"],
  ["Ctrl+R", "history search"],
  ["Ctrl+V", "paste image"],
  ["Ctrl+C", "exit"],
  ["?", "hide"],
].map(([keyLabel, description]) => ({ keyLabel, description }));

const SHORTCUT_OVERLAY_COMPACT_ROWS: ShortcutHelpColumn = [
  ["/", "for commands"],
  ["Shift+Enter", "for newline"],
  ["Esc", "back"],
  ["Tab", "apply"],
  ["Ctrl+R", "history"],
  ["Ctrl+C", "exit"],
  ["?", "hide"],
].map(([keyLabel, description]) => ({ keyLabel, description }));

const FOOTER_HINT_MIN_COLUMNS = 64;
const FOOTER_SECONDARY_STATUS_MIN_COLUMNS = 64;
const FOOTER_MIN_STATUS_AFTER_HINT_WIDTH = 16;
const FOOTER_SEPARATOR = " · ";
const SHORTCUT_OVERLAY_WIDE_MIN_COLUMNS = 96;
const SHORTCUT_OVERLAY_TWO_COLUMN_MIN_COLUMNS = 72;
const SHORTCUT_OVERLAY_COMPACT_MAX_COLUMNS = 56;
const SHORTCUT_OVERLAY_KEY_COLUMN_WIDTH = 11;
const SHORTCUT_OVERLAY_KEY_GAP = "  ";
const SHORTCUT_OVERLAY_COLUMN_GAP = "  ";
const SHORTCUT_OVERLAY_FALLBACK_COLUMN_WIDTH = 27;
const PENDING_ASK_DEFAULT_ACTION_HINT = "Enter 打开选择";

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
  const actionHint = resolvePendingAskActionHint(summary);
  const baseLine = `需要确认 ${String(pendingAskCount)} 项 · ${actionHint}`;
  const terminalColumns = resolveTerminalColumns(input.terminalColumns);
  if (terminalColumns > 0) {
    return truncateDisplayWidth(baseLine, terminalColumns);
  }
  return baseLine;
}

function resolvePendingAskActionHint(summary: string): string {
  if (!summary) {
    return PENDING_ASK_DEFAULT_ACTION_HINT;
  }
  const normalized = summary.toLowerCase();
  const looksLikeDiagnostic =
    normalized.includes("question=")
    || normalized.includes("options_")
    || normalized.includes("output_mode")
    || normalized.includes("followups")
    || normalized.includes("[ask-user]");
  const looksLikeActionHint =
    normalized.includes("enter/?")
    || normalized.includes("enter 打开")
    || normalized.startsWith("enter ")
    || summary.startsWith("输入回复");
  const looksLikeQuestion = !looksLikeActionHint && /[?？]/.test(summary);
  if (looksLikeDiagnostic || looksLikeQuestion) {
    return PENDING_ASK_DEFAULT_ACTION_HINT;
  }
  return summary;
}

function buildInputHintLine(input: {
  statusLine?: string;
}): string | undefined {
  const statusLine = compactSpaces(input.statusLine ?? "");
  if (statusLine.length > 0) {
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
  if (input.planMode) {
    return true;
  }
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
    return `${TERMINAL_ANSI.muted}${line}${TERMINAL_ANSI.reset}`;
  },
  activityLine(line: string): string {
    if (!line || terminalStyle.hasAnsi(line)) {
      return line;
    }
    if (line.startsWith("~")) {
      return `${terminalStyle.brand("~")}${terminalStyle.muted(line.slice(1))}`;
    }
    return terminalStyle.muted(line);
  },
  shortcutEntry(entry: string, keyLabel: string): string {
    if (!entry) {
      return entry;
    }
    if (!entry.startsWith(keyLabel)) {
      return `${TERMINAL_ANSI.muted}${entry}${TERMINAL_ANSI.reset}`;
    }
    return `${TERMINAL_ANSI.brand}${keyLabel}`
      + `${TERMINAL_ANSI.reset}${TERMINAL_ANSI.muted}`
      + `${entry.slice(keyLabel.length)}${TERMINAL_ANSI.reset}`;
  },
} as const;

function shouldUseWideShortcutOverlay(terminalColumns: number): boolean {
  return terminalColumns >= SHORTCUT_OVERLAY_WIDE_MIN_COLUMNS;
}

function shouldUseTwoColumnShortcutOverlay(terminalColumns: number): boolean {
  return terminalColumns <= 0 || terminalColumns >= SHORTCUT_OVERLAY_TWO_COLUMN_MIN_COLUMNS;
}

function resolveShortcutOverlayRows(terminalColumns: number): ShortcutHelpColumn {
  if (terminalColumns > 0 && terminalColumns <= SHORTCUT_OVERLAY_COMPACT_MAX_COLUMNS) {
    return SHORTCUT_OVERLAY_COMPACT_ROWS;
  }
  return SHORTCUT_OVERLAY_MEDIUM_ROWS;
}

function renderShortcutEntry(input: {
  entry: ShortcutHelpEntry;
  width: number;
  pad?: boolean;
}): string {
  const plainEntry = formatShortcutEntry({
    keyLabel: input.entry.keyLabel,
    description: input.entry.description,
    alignKey: true,
  });
  const fitted = truncateDisplayWidth(plainEntry, input.width);
  const padded = input.pad ? padToDisplayWidth(fitted, input.width) : fitted;
  return BOTTOM_PANE_STYLE.shortcutEntry(padded, input.entry.keyLabel);
}

function renderShortcutOverlayColumns(input: {
  terminalColumns: number;
  columns: readonly ShortcutHelpColumn[];
}): string[] {
  const columnCount = Math.max(1, input.columns.length);
  const columnGapWidth = measureDisplayWidth(SHORTCUT_OVERLAY_COLUMN_GAP);
  const totalGapWidth = columnGapWidth * Math.max(0, columnCount - 1);
  const entryWidth = input.terminalColumns > 0
    ? Math.max(1, Math.floor((input.terminalColumns - totalGapWidth) / columnCount))
    : SHORTCUT_OVERLAY_FALLBACK_COLUMN_WIDTH;
  const maxRows = input.columns.reduce(
    (max, column) => Math.max(max, column.length),
    0,
  );
  const lines: string[] = [];

  for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
    const rowEntries = input.columns.map((column) => column[rowIndex]);
    if (!rowEntries.some(Boolean)) {
      continue;
    }
    const renderedColumns = rowEntries.map((entry, columnIndex) => {
      const shouldPad = columnIndex < rowEntries.length - 1;
      if (!entry) {
        return shouldPad ? " ".repeat(entryWidth) : "";
      }
      return renderShortcutEntry({
        entry,
        width: entryWidth,
        pad: shouldPad,
      });
    });
    const line = renderedColumns.join(`${TERMINAL_ANSI.muted}${SHORTCUT_OVERLAY_COLUMN_GAP}`);
    lines.push(line.trimEnd());
  }

  return lines;
}

function renderShortcutOverlaySingleColumn(input: {
  terminalColumns: number;
  rows: ShortcutHelpColumn;
}): string[] {
  return input.rows.map((row) => {
    const entry = formatShortcutEntry({
      keyLabel: row.keyLabel,
      description: row.description,
      alignKey: true,
    });
    const line = input.terminalColumns > 0
      ? truncateDisplayWidth(entry, input.terminalColumns)
      : entry;
    return BOTTOM_PANE_STYLE.shortcutEntry(line, row.keyLabel);
  });
}

export function renderShortcutOverlayFooter(input: {
  terminalColumns?: number;
} = {}): string {
  const terminalColumns = resolveTerminalColumns(input.terminalColumns);
  if (shouldUseWideShortcutOverlay(terminalColumns)) {
    return renderShortcutOverlayColumns({
      terminalColumns,
      columns: [
        SHORTCUT_HELP_DISCOVERY_ROWS,
        SHORTCUT_HELP_EDITING_ROWS,
        SHORTCUT_HELP_SESSION_ROWS,
      ],
    }).join("\n");
  }

  const rows = resolveShortcutOverlayRows(terminalColumns);
  if (!shouldUseTwoColumnShortcutOverlay(terminalColumns)) {
    return renderShortcutOverlaySingleColumn({ terminalColumns, rows }).join("\n");
  }
  const leftColumn = rows.filter((_row, index) => index % 2 === 0);
  const rightColumn = rows.filter((_row, index) => index % 2 === 1);
  return renderShortcutOverlayColumns({
    terminalColumns,
    columns: [leftColumn, rightColumn],
  }).join("\n");
}

export function renderBottomPaneFooter(input: BottomPanePromptInput): string {
  const parts = resolveStatusLinePromptParts(input);
  const mode = resolveBottomPaneFooterMode(input);
  const pendingAskLine = buildPendingAskLine(input);
  const inputHintLine = buildInputHintLine({
    statusLine: parts.statusLine,
  });
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
      line: parts.activityLine ?? (input.planMode ? "~ 正在规划" : "~ 正在处理"),
      terminalColumns: input.terminalColumns,
    })));
    if (renderSecondaryStatus) {
      pushLine(BOTTOM_PANE_STYLE.dimLine(parts.statusLine));
    }
    pushLine(pendingAskLine);
    pushLine(parts.warningLine);
  } else if (mode === "pending") {
    if (renderSecondaryStatus) {
      pushLine(BOTTOM_PANE_STYLE.dimLine(parts.statusLine));
    }
    pushLine(pendingAskLine ? BOTTOM_PANE_STYLE.dimLine(pendingAskLine) : undefined);
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
