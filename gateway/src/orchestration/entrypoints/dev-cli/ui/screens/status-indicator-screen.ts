import {
  compactSpaces,
  getGraphemeDisplayWidth,
  measureDisplayWidth,
  splitGraphemes,
  truncateDisplayWidth,
} from "../interactive/display-width";
import { TERMINAL_ANSI, terminalStyle } from "../theme/terminal-style";

export interface StatusIndicatorInput {
  message?: string;
  startedAtMs: number;
  nowMs?: number;
  tick?: number;
  terminalColumns?: number;
  reducedMotion?: boolean;
  spinnerFrames?: readonly string[];
  interruptHint?: string;
}

const DEFAULT_STATUS_SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;
const GLIMMER_PADDING_WIDTH = 20;
const GLIMMER_HOTSPOT_RADIUS = 1;

function resolveTerminalColumns(columns: number | undefined): number {
  if (typeof columns !== "number" || !Number.isFinite(columns)) {
    return 0;
  }
  return Math.max(0, Math.floor(columns));
}

export function formatStatusIndicatorElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours)}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  if (minutes > 0) {
    return `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${String(seconds)}s`;
}

function resolveSpinnerFrame(input: StatusIndicatorInput): string {
  const frames = input.spinnerFrames && input.spinnerFrames.length > 0
    ? input.spinnerFrames
    : DEFAULT_STATUS_SPINNER_FRAMES;
  const tick = typeof input.tick === "number" && Number.isFinite(input.tick)
    ? Math.max(0, Math.floor(input.tick))
    : 0;
  return frames[tick % frames.length] ?? "-";
}

function shouldHighlightGrapheme(input: {
  startWidth: number;
  graphemeWidth: number;
  glimmerIndex: number;
}): boolean {
  if (input.glimmerIndex < -1) {
    return false;
  }
  const endWidth = input.startWidth + Math.max(1, input.graphemeWidth);
  const shimmerStart = input.glimmerIndex - GLIMMER_HOTSPOT_RADIUS;
  const shimmerEnd = input.glimmerIndex + GLIMMER_HOTSPOT_RADIUS;
  return endWidth > shimmerStart && input.startWidth < shimmerEnd;
}

export function renderStatusIndicatorMessage(input: {
  message: string;
  tick?: number;
  reducedMotion?: boolean;
}): string {
  const message = input.message;
  if (!message) {
    return "";
  }
  if (input.reducedMotion) {
    return terminalStyle.muted(message);
  }
  const messageWidth = measureDisplayWidth(message);
  const cycleLength = Math.max(1, messageWidth + GLIMMER_PADDING_WIDTH);
  const tick = typeof input.tick === "number" && Number.isFinite(input.tick)
    ? Math.max(0, Math.floor(input.tick))
    : 0;
  const glimmerIndex = (tick % cycleLength) - Math.floor(GLIMMER_PADDING_WIDTH / 2);
  let currentWidth = 0;
  let output = "";
  for (const grapheme of splitGraphemes(message)) {
    const graphemeWidth = getGraphemeDisplayWidth(grapheme);
    const highlighted = shouldHighlightGrapheme({
      startWidth: currentWidth,
      graphemeWidth,
      glimmerIndex,
    });
    output += highlighted
      ? `${TERMINAL_ANSI.brand}${grapheme}${TERMINAL_ANSI.reset}`
      : `${TERMINAL_ANSI.muted}${grapheme}${TERMINAL_ANSI.reset}`;
    currentWidth += graphemeWidth;
  }
  return output;
}

export function renderStatusIndicatorLine(input: StatusIndicatorInput): string {
  const nowMs = typeof input.nowMs === "number" && Number.isFinite(input.nowMs)
    ? input.nowMs
    : Date.now();
  const elapsed = formatStatusIndicatorElapsed(nowMs - input.startedAtMs);
  const interruptHint = compactSpaces(input.interruptHint ?? "esc to interrupt");
  const suffix = ` (${elapsed} • ${interruptHint})`;
  const rawMessage = compactSpaces(input.message ?? "正在执行");
  const terminalColumns = resolveTerminalColumns(input.terminalColumns);
  const spinner = resolveSpinnerFrame(input);
  const spinnerWidth = measureDisplayWidth(spinner);
  const suffixWidth = measureDisplayWidth(suffix);
  const gapWidth = 1;
  const reserveWidth = spinnerWidth + gapWidth + suffixWidth;
  const messageWidth = terminalColumns > 0
    ? Math.max(1, terminalColumns - reserveWidth)
    : measureDisplayWidth(rawMessage);
  const message = terminalColumns > 0
    ? truncateDisplayWidth(rawMessage, messageWidth, { compact: true })
    : rawMessage;
  const styledMessage = renderStatusIndicatorMessage({
    message,
    tick: input.tick,
    reducedMotion: input.reducedMotion,
  });
  const line = `${terminalStyle.brand(spinner)} ${styledMessage}${terminalStyle.muted(suffix)}`;
  if (terminalColumns <= 0 || measureDisplayWidth(line) <= terminalColumns) {
    return line;
  }
  const fallback = `${spinner} ${message}${suffix}`;
  return terminalStyle.muted(truncateDisplayWidth(fallback, terminalColumns, { compact: true }));
}
