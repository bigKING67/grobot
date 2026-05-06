import {
  compactSpaces,
  getGraphemeDisplayWidth,
  measureDisplayWidth,
  splitGraphemes,
  truncateDisplayWidth,
} from "../../terminal/display-width";
import { TERMINAL_ANSI, TERMINAL_RGB, TERMINAL_SYMBOL, terminalStyle } from "../../theme/terminal-style";

export type StatusIndicatorMode =
  | "requesting"
  | "responding"
  | "tool-input"
  | "tool-use"
  | "thinking";

export interface StatusIndicatorInput {
  message?: string;
  startedAtMs: number;
  nowMs?: number;
  tick?: number;
  terminalColumns?: number;
  reducedMotion?: boolean;
  spinnerFrames?: readonly string[];
  interruptHint?: string;
  mode?: StatusIndicatorMode;
  tokenCount?: number;
  tokenText?: string;
  verbose?: boolean;
  showTokensAfterMs?: number;
  stalledIntensity?: number;
  thinkingStatus?: "thinking" | number | null;
  effortSuffix?: string;
  thinkingText?: string;
}

export interface StatusIndicatorPartsInput {
  terminalColumns?: number;
  spinner: string;
  message: string;
  elapsedText: string;
  interruptHint?: string;
  tokenText?: string;
  thinkingText?: string;
}

export interface StatusIndicatorParts {
  messageWidth: number;
  suffix: string;
  showElapsed: boolean;
  showInterruptHint: boolean;
  showTokens: boolean;
  showThinking: boolean;
}

export interface StatusIndicatorStallState {
  mountedAtMs: number;
  lastTokenLength: number;
  lastTokenAtMs: number;
  lastSmoothAtMs: number;
  stalledIntensity: number;
}

export interface StatusIndicatorStallInput {
  previousState?: StatusIndicatorStallState;
  nowMs: number;
  tokenLength?: number;
  hasActiveTools?: boolean;
  reducedMotion?: boolean;
}

export interface StatusIndicatorStallResolution {
  state: StatusIndicatorStallState;
  isStalled: boolean;
  stalledIntensity: number;
}

const STATUS_SPINNER_DARWIN_CHARACTERS = ["·", "✢", "✳", "✶", "✻", "✽"] as const;
const STATUS_SPINNER_GHOSTTY_CHARACTERS = ["·", "✢", "✳", "✶", "✻", "*"] as const;
const STATUS_SPINNER_GENERIC_CHARACTERS = ["·", "✢", "*", "✶", "✻", "✽"] as const;
const STATUS_REDUCED_MOTION_SPINNER = "●";
const GLIMMER_PADDING_WIDTH = 20;
const GLIMMER_HOTSPOT_RADIUS = 1;
export const STATUS_INDICATOR_SHOW_TOKENS_AFTER_MS = 30_000;
const STATUS_REDUCED_MOTION_CYCLE_MS = 2_000;
const STALLED_AFTER_MS = 3_000;
const STALLED_FADE_MS = 2_000;
const STALLED_SMOOTH_STEP_MS = 50;
const STALLED_SMOOTH_FACTOR = 0.1;
const STATUS_STALLED_ERROR_RGB = { r: 171, g: 43, b: 63 } as const;

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function getDefaultStatusSpinnerCharacters(): readonly string[] {
  if (process.env.TERM === "xterm-ghostty") {
    return STATUS_SPINNER_GHOSTTY_CHARACTERS;
  }
  return process.platform === "darwin"
    ? STATUS_SPINNER_DARWIN_CHARACTERS
    : STATUS_SPINNER_GENERIC_CHARACTERS;
}

function buildMirroredStatusSpinnerFrames(characters: readonly string[]): string[] {
  return [...characters, ...[...characters].reverse()];
}

const DEFAULT_STATUS_SPINNER_FRAMES = buildMirroredStatusSpinnerFrames(
  getDefaultStatusSpinnerCharacters(),
);

function resolveTerminalColumns(columns: number | undefined): number {
  if (typeof columns !== "number" || !Number.isFinite(columns)) {
    return 0;
  }
  return Math.max(0, Math.floor(columns));
}

function normalizeTimestamp(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeTick(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function clampUnit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function interpolateRgb(left: RgbColor, right: RgbColor, amount: number): RgbColor {
  const normalized = clampUnit(amount);
  return {
    r: Math.round(left.r + (right.r - left.r) * normalized),
    g: Math.round(left.g + (right.g - left.g) * normalized),
    b: Math.round(left.b + (right.b - left.b) * normalized),
  };
}

function styleRgb(value: string, color: RgbColor): string {
  return `\x1b[38;2;${color.r};${color.g};${color.b}m${value}${TERMINAL_ANSI.reset}`;
}

function normalizeTokenLength(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
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

function normalizeTokenCount(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.max(1, Math.round(value));
}

function formatStatusTokenCount(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function normalizeEffortSuffix(value: string | undefined): string {
  const suffix = compactSpaces(value ?? "");
  if (!suffix) {
    return "";
  }
  return suffix.startsWith(" ") ? suffix : ` ${suffix}`;
}

export function resolveStatusIndicatorModeGlyph(
  mode: StatusIndicatorMode | undefined,
): string {
  switch (mode) {
    case "requesting":
      return TERMINAL_SYMBOL.scrollUp;
    case "responding":
    case "tool-input":
    case "tool-use":
    case "thinking":
      return TERMINAL_SYMBOL.scrollDown;
    default:
      return "";
  }
}

export function formatStatusIndicatorThinkingText(input: {
  status?: "thinking" | number | null;
  effortSuffix?: string;
}): string {
  if (input.status === "thinking") {
    return `thinking${normalizeEffortSuffix(input.effortSuffix)}`;
  }
  if (typeof input.status === "number" && Number.isFinite(input.status)) {
    const seconds = Math.max(1, Math.round(input.status / 1000));
    return `thought for ${String(seconds)}s`;
  }
  return "";
}

export function formatStatusIndicatorTokenText(input: {
  tokenText?: string;
  tokenCount?: number;
  elapsedMs?: number;
  verbose?: boolean;
  showTokensAfterMs?: number;
  mode?: StatusIndicatorMode;
}): string {
  const explicitTokenText = compactSpaces(input.tokenText ?? "");
  const glyph = resolveStatusIndicatorModeGlyph(input.mode);
  if (explicitTokenText) {
    if (!glyph || /^[↑↓]/u.test(explicitTokenText)) {
      return explicitTokenText;
    }
    return `${glyph} ${explicitTokenText}`;
  }

  const tokenCount = normalizeTokenCount(input.tokenCount);
  if (!tokenCount) {
    return "";
  }
  const showTokensAfterMs =
    typeof input.showTokensAfterMs === "number" && Number.isFinite(input.showTokensAfterMs)
      ? Math.max(0, Math.floor(input.showTokensAfterMs))
      : STATUS_INDICATOR_SHOW_TOKENS_AFTER_MS;
  const elapsedMs =
    typeof input.elapsedMs === "number" && Number.isFinite(input.elapsedMs)
      ? Math.max(0, Math.floor(input.elapsedMs))
      : 0;
  if (!input.verbose && elapsedMs < showTokensAfterMs) {
    return "";
  }

  const tokenText = `${formatStatusTokenCount(tokenCount)} tokens`;
  return glyph ? `${glyph} ${tokenText}` : tokenText;
}

export function resolveStatusIndicatorStallState(
  input: StatusIndicatorStallInput,
): StatusIndicatorStallResolution {
  const nowMs = normalizeTimestamp(input.nowMs, 0);
  const tokenLength = normalizeTokenLength(input.tokenLength);
  const hasActiveTools = input.hasActiveTools === true;
  const previousState = input.previousState;
  const mountedAtMs = previousState?.mountedAtMs ?? nowMs;
  let lastTokenLength = previousState?.lastTokenLength ?? tokenLength;
  let lastTokenAtMs = previousState?.lastTokenAtMs ?? nowMs;
  let lastSmoothAtMs = previousState?.lastSmoothAtMs ?? nowMs;
  let stalledIntensity = previousState?.stalledIntensity ?? 0;

  if (tokenLength > lastTokenLength) {
    lastTokenLength = tokenLength;
    lastTokenAtMs = nowMs;
    lastSmoothAtMs = nowMs;
    stalledIntensity = 0;
  }

  const timeSinceLastToken = (() => {
    if (hasActiveTools) {
      lastTokenAtMs = nowMs;
      return 0;
    }
    if (tokenLength > 0) {
      return Math.max(0, nowMs - lastTokenAtMs);
    }
    return Math.max(0, nowMs - mountedAtMs);
  })();
  const isStalled = timeSinceLastToken > STALLED_AFTER_MS && !hasActiveTools;
  const rawIntensity = isStalled
    ? Math.min((timeSinceLastToken - STALLED_AFTER_MS) / STALLED_FADE_MS, 1)
    : 0;

  if (input.reducedMotion) {
    stalledIntensity = rawIntensity;
    lastSmoothAtMs = nowMs;
  } else if (rawIntensity > 0 || stalledIntensity > 0) {
    const deltaMs = Math.max(0, nowMs - lastSmoothAtMs);
    if (deltaMs >= STALLED_SMOOTH_STEP_MS) {
      const steps = Math.floor(deltaMs / STALLED_SMOOTH_STEP_MS);
      for (let index = 0; index < steps; index += 1) {
        const diff = rawIntensity - stalledIntensity;
        if (Math.abs(diff) < 0.01) {
          stalledIntensity = rawIntensity;
          break;
        }
        stalledIntensity += diff * STALLED_SMOOTH_FACTOR;
      }
      lastSmoothAtMs = nowMs;
    }
  } else {
    lastSmoothAtMs = nowMs;
  }

  return {
    state: {
      mountedAtMs,
      lastTokenLength,
      lastTokenAtMs,
      lastSmoothAtMs,
      stalledIntensity,
    },
    isStalled,
    stalledIntensity,
  };
}

function resolveSpinnerFrame(input: StatusIndicatorInput): string {
  if (input.reducedMotion && (!input.spinnerFrames || input.spinnerFrames.length <= 0)) {
    return STATUS_REDUCED_MOTION_SPINNER;
  }
  const frames = input.spinnerFrames && input.spinnerFrames.length > 0
    ? input.spinnerFrames
    : DEFAULT_STATUS_SPINNER_FRAMES;
  const tick = normalizeTick(input.tick);
  return frames[tick % frames.length] ?? "-";
}

function renderStatusIndicatorSpinner(input: {
  spinner: string;
  tick?: number;
  reducedMotion?: boolean;
  stalledIntensity?: number;
}): string {
  const stalledIntensity = clampUnit(input.stalledIntensity);
  if (stalledIntensity > 0) {
    return styleRgb(
      input.spinner,
      interpolateRgb(TERMINAL_RGB.brand, STATUS_STALLED_ERROR_RGB, stalledIntensity),
    );
  }
  if (input.reducedMotion) {
    const tickMs = normalizeTick(input.tick) * 120;
    const isDim = Math.floor(tickMs / (STATUS_REDUCED_MOTION_CYCLE_MS / 2)) % 2 === 1;
    return isDim ? terminalStyle.muted(input.spinner) : terminalStyle.brand(input.spinner);
  }
  return terminalStyle.brand(input.spinner);
}

function normalizeOptionalPart(value: string | undefined): string {
  return compactSpaces(value ?? "");
}

function formatStatusIndicatorDetailText(value: string): string {
  const normalized = normalizeOptionalPart(value);
  if (!normalized) {
    return "";
  }
  const keyValueMatch = normalized.match(/^([A-Za-z][A-Za-z0-9_-]{1,32})=(.+)$/);
  if (!keyValueMatch) {
    return normalized;
  }
  const key = keyValueMatch[1] ?? "";
  const rawValue = compactSpaces(keyValueMatch[2] ?? "");
  if (!rawValue) {
    return "";
  }
  const keyLabel = key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  return `${keyLabel} ${rawValue}`;
}

function buildStatusSuffix(input: {
  elapsedText?: string;
  interruptHint?: string;
  tokenText?: string;
  thinkingText?: string;
}): string {
  const leadingParts = [
    input.elapsedText,
    input.tokenText,
    input.thinkingText,
  ].filter((part): part is string => typeof part === "string" && part.length > 0);
  const interruptHint = input.interruptHint ?? "";
  const body = [
    ...leadingParts,
    ...(interruptHint ? [interruptHint] : []),
  ].join(" · ");
  return body ? ` (${body})` : "";
}

function resolveMinimumStatusMessageWidth(terminalColumns: number): number {
  if (terminalColumns <= 0) {
    return 0;
  }
  if (terminalColumns < 24) {
    return 1;
  }
  if (terminalColumns < 32) {
    return 3;
  }
  return 6;
}

export function resolveStatusIndicatorParts(
  input: StatusIndicatorPartsInput,
): StatusIndicatorParts {
  const terminalColumns = resolveTerminalColumns(input.terminalColumns);
  const spinnerWidth = measureDisplayWidth(input.spinner);
  const gapWidth = input.spinner ? 1 : 0;
  const elapsedText = normalizeOptionalPart(input.elapsedText);
  const interruptHint = normalizeOptionalPart(input.interruptHint);
  const tokenText = normalizeOptionalPart(input.tokenText);
  const rawThinkingText = formatStatusIndicatorDetailText(input.thinkingText ?? "");
  const thinkingText = rawThinkingText.length > 0
    ? rawThinkingText
    : "";
  const compactThinkingText =
    thinkingText.startsWith("thinking ") ? "thinking" : thinkingText;

  const candidates = [
    {
      elapsedText,
      interruptHint,
      tokenText,
      thinkingText,
    },
    {
      elapsedText,
      interruptHint,
      tokenText,
      thinkingText: compactThinkingText !== thinkingText ? compactThinkingText : "",
    },
    {
      elapsedText,
      interruptHint,
      tokenText: "",
      thinkingText: compactThinkingText,
    },
    {
      elapsedText,
      interruptHint,
      tokenText: "",
      thinkingText: "",
    },
    {
      elapsedText: "",
      interruptHint,
      tokenText: "",
      thinkingText: "",
    },
    {
      elapsedText,
      interruptHint: "",
      tokenText: "",
      thinkingText: "",
    },
    {
      elapsedText: "",
      interruptHint: "",
      tokenText: "",
      thinkingText: "",
    },
  ].map((candidate) => ({
    ...candidate,
    suffix: buildStatusSuffix(candidate),
  }));

  const minMessageWidth = resolveMinimumStatusMessageWidth(terminalColumns);
  const resolved = terminalColumns <= 0
    ? candidates[0]
    : candidates.find((candidate) => {
      const suffixWidth = measureDisplayWidth(candidate.suffix);
      return terminalColumns - spinnerWidth - gapWidth - suffixWidth >= minMessageWidth;
    }) ?? candidates[candidates.length - 1];
  const suffix = resolved?.suffix ?? "";
  const fallbackMessageWidth = measureDisplayWidth(input.message);
  const messageWidth = terminalColumns > 0
    ? Math.max(
      1,
      terminalColumns - spinnerWidth - gapWidth - measureDisplayWidth(suffix),
    )
    : fallbackMessageWidth;

  return {
    messageWidth,
    suffix,
    showElapsed: (resolved?.elapsedText ?? "").length > 0,
    showInterruptHint: (resolved?.interruptHint ?? "").length > 0,
    showTokens: (resolved?.tokenText ?? "").length > 0,
    showThinking: (resolved?.thinkingText ?? "").length > 0,
  };
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
  mode?: StatusIndicatorMode;
  stalledIntensity?: number;
}): string {
  const message = input.message;
  if (!message) {
    return "";
  }
  const stalledIntensity = clampUnit(input.stalledIntensity);
  if (stalledIntensity > 0) {
    return styleRgb(
      message,
      interpolateRgb(TERMINAL_RGB.brand, STATUS_STALLED_ERROR_RGB, stalledIntensity),
    );
  }
  if (input.reducedMotion) {
    return terminalStyle.muted(message);
  }
  if (input.mode === "tool-use") {
    const tickMs = normalizeTick(input.tick) * 120;
    const flashOpacity = (Math.sin((tickMs / 1000) * Math.PI) + 1) / 2;
    return styleRgb(
      message,
      interpolateRgb(TERMINAL_RGB.muted, TERMINAL_RGB.brand, flashOpacity),
    );
  }
  const messageWidth = measureDisplayWidth(message);
  const cycleLength = Math.max(1, messageWidth + GLIMMER_PADDING_WIDTH);
  const tick = normalizeTick(input.tick);
  const cyclePosition = tick % cycleLength;
  const glimmerIndex = input.mode === "requesting"
    ? cyclePosition - Math.floor(GLIMMER_PADDING_WIDTH / 2)
    : messageWidth + Math.floor(GLIMMER_PADDING_WIDTH / 2) - cyclePosition;
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
  const elapsedMs = Math.max(0, nowMs - input.startedAtMs);
  const elapsed = formatStatusIndicatorElapsed(elapsedMs);
  const interruptHint = compactSpaces(input.interruptHint ?? "esc to interrupt");
  const rawMessage = compactSpaces(input.message ?? "Working");
  const terminalColumns = resolveTerminalColumns(input.terminalColumns);
  const spinner = resolveSpinnerFrame(input);
  const tokenText = formatStatusIndicatorTokenText({
    tokenText: input.tokenText,
    tokenCount: input.tokenCount,
    elapsedMs,
    verbose: input.verbose,
    showTokensAfterMs: input.showTokensAfterMs,
    mode: input.mode,
  });
  const thinkingText = formatStatusIndicatorDetailText(input.thinkingText ?? "").length > 0
    ? formatStatusIndicatorDetailText(input.thinkingText ?? "")
    : formatStatusIndicatorThinkingText({
      status: input.thinkingStatus,
      effortSuffix: input.effortSuffix,
    });
  const statusParts = resolveStatusIndicatorParts({
    terminalColumns: input.terminalColumns,
    spinner,
    message: rawMessage,
    elapsedText: elapsed,
    interruptHint,
    tokenText,
    thinkingText,
  });
  const message = terminalColumns > 0
    ? truncateDisplayWidth(rawMessage, statusParts.messageWidth, { compact: true })
    : rawMessage;
  const styledMessage = renderStatusIndicatorMessage({
    message,
    tick: input.tick,
    reducedMotion: input.reducedMotion,
    mode: input.mode,
    stalledIntensity: input.stalledIntensity,
  });
  const styledSpinner = renderStatusIndicatorSpinner({
    spinner,
    tick: input.tick,
    reducedMotion: input.reducedMotion,
    stalledIntensity: input.stalledIntensity,
  });
  const line = `${styledSpinner} ${styledMessage}${terminalStyle.muted(statusParts.suffix)}`;
  if (terminalColumns <= 0 || measureDisplayWidth(line) <= terminalColumns) {
    return line;
  }
  const fallback = `${spinner} ${message}${statusParts.suffix}`;
  return terminalStyle.muted(truncateDisplayWidth(fallback, terminalColumns, { compact: true }));
}
