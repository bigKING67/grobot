export interface StatusLinePromptInput {
  model: string;
  projectFolder: string;
  contextWindowUsageRatio?: number;
  estimatedTokens?: number;
  targetTokenLimit?: number;
  sessionId: string;
  sessionTopic?: string;
  terminalColumns?: number;
  promptLabel?: string;
}

const DEFAULT_PROMPT_LABEL = "grobot> ";
const SESSION_SHORT_ID_LEN = 8;

function clampRatio(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function compactSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toChars(value: string): string[] {
  return Array.from(value);
}

function truncateText(value: string, maxChars: number): string {
  const normalized = compactSpaces(value);
  if (maxChars <= 0) {
    return "";
  }
  const chars = toChars(normalized);
  if (chars.length <= maxChars) {
    return normalized;
  }
  if (maxChars <= 3) {
    return chars.slice(0, maxChars).join("");
  }
  return `${chars.slice(0, maxChars - 3).join("")}...`;
}

function formatTokenCount(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "n/a";
  }
  const normalized = Math.round(value);
  if (normalized >= 1000) {
    return `${(normalized / 1000).toFixed(1)}k`;
  }
  return String(normalized);
}

function formatContextUsage(value: number | undefined): string {
  const ratio = clampRatio(value);
  if (typeof ratio !== "number") {
    return "n/a";
  }
  return `${Math.round(ratio * 100)}%`;
}

function formatSessionShortId(sessionId: string): string {
  const normalized = compactSpaces(sessionId);
  if (normalized.length === 0) {
    return "<none>";
  }
  const chars = toChars(normalized);
  if (chars.length <= SESSION_SHORT_ID_LEN) {
    return normalized;
  }
  return chars.slice(0, SESSION_SHORT_ID_LEN).join("");
}

function buildStatusSegments(input: StatusLinePromptInput): {
  left: string[];
  sessionShortId: string;
  sessionTopic: string;
} {
  const model = truncateText(input.model, 28) || "<unset>";
  const projectFolder = truncateText(input.projectFolder, 20) || "<none>";
  const sessionShortId = formatSessionShortId(input.sessionId);
  const sessionTopic = truncateText(input.sessionTopic ?? "", 36);
  return {
    left: [
      `model ${model}`,
      `project ${projectFolder}`,
      `ctx ${formatContextUsage(input.contextWindowUsageRatio)}`,
      `tok ${formatTokenCount(input.estimatedTokens)}/${formatTokenCount(input.targetTokenLimit)}`,
    ],
    sessionShortId,
    sessionTopic,
  };
}

function fitStatusLine(input: StatusLinePromptInput): string {
  const { left, sessionShortId, sessionTopic } = buildStatusSegments(input);
  const leftJoined = left.join(" | ");
  const sessionWithTopic = sessionTopic.length > 0
    ? `${sessionShortId} ${sessionTopic}`
    : sessionShortId;
  const wideLine = `${leftJoined} | ${sessionWithTopic}`;
  const terminalColumns =
    typeof input.terminalColumns === "number" && Number.isFinite(input.terminalColumns)
      ? Math.floor(input.terminalColumns)
      : 0;
  if (terminalColumns <= 0 || wideLine.length <= terminalColumns) {
    return wideLine;
  }

  const shortLine = `${leftJoined} | ${sessionShortId}`;
  if (shortLine.length <= terminalColumns) {
    return shortLine;
  }

  const compactLeft = [
    `m ${truncateText(input.model, 14) || "<unset>"}`,
    `p ${truncateText(input.projectFolder, 10) || "<none>"}`,
    `ctx ${formatContextUsage(input.contextWindowUsageRatio)}`,
    `tok ${formatTokenCount(input.estimatedTokens)}/${formatTokenCount(input.targetTokenLimit)}`,
  ].join(" | ");
  const compactLine = `${compactLeft} | ${sessionShortId}`;
  if (compactLine.length <= terminalColumns) {
    return compactLine;
  }

  const minimalLine = `ctx ${formatContextUsage(input.contextWindowUsageRatio)} | tok ${formatTokenCount(input.estimatedTokens)}/${formatTokenCount(input.targetTokenLimit)} | ${sessionShortId}`;
  if (minimalLine.length <= terminalColumns) {
    return minimalLine;
  }

  if (sessionShortId.length <= terminalColumns) {
    return sessionShortId;
  }

  if (leftJoined.length + 3 <= terminalColumns) {
    const sessionBudget = Math.max(0, terminalColumns - leftJoined.length - 3);
    const sessionText = truncateText(sessionWithTopic, sessionBudget);
    return `${leftJoined} | ${sessionText}`;
  }

  return truncateText(wideLine, terminalColumns);
}

export function renderStatusLinePrompt(input: StatusLinePromptInput): string {
  const promptLabel = input.promptLabel ?? DEFAULT_PROMPT_LABEL;
  const statusLine = fitStatusLine(input);
  return `${statusLine}\n${promptLabel}`;
}
