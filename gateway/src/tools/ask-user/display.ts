import { AskUserEnvelope } from "./schema";

const ASK_USER_LINE_CHAR_LIMIT = 220;
const ASK_USER_DEFAULT_OPTION_PREVIEW_LIMIT = 5;
const ASK_USER_OPTION_ITEM_CHAR_LIMIT = 48;
const ASK_USER_DEFAULT_ANSWER_CHAR_LIMIT = 120;

function compactSingleLine(value: string, maxChars: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxChars) {
    return normalized;
  }
  if (maxChars <= 1) {
    return normalized.slice(0, Math.max(0, maxChars));
  }
  return `${normalized.slice(0, maxChars - 1)}…`;
}

export function buildAskUserOptionsPreview(
  options: readonly string[],
  maxItems: number = ASK_USER_DEFAULT_OPTION_PREVIEW_LIMIT,
): {
  preview: string;
  hiddenCount: number;
} {
  if (options.length <= 0) {
    return {
      preview: "<free-text>",
      hiddenCount: 0,
    };
  }
  const safeMaxItems = Number.isFinite(maxItems)
    ? Math.max(0, Math.floor(maxItems))
    : ASK_USER_DEFAULT_OPTION_PREVIEW_LIMIT;
  const visibleCount = Math.min(options.length, safeMaxItems);
  const visible: string[] = [];
  for (let index = 0; index < visibleCount; index += 1) {
    const option = options[index];
    const normalizedOption = compactSingleLine(option, ASK_USER_OPTION_ITEM_CHAR_LIMIT);
    visible.push(`${String(index + 1)}:${normalizedOption}`);
  }
  const hiddenCount = Math.max(0, options.length - visible.length);
  if (hiddenCount > 0) {
    visible.push(`... +${String(hiddenCount)} more`);
  }
  return {
    preview: compactSingleLine(visible.join(" | "), ASK_USER_LINE_CHAR_LIMIT),
    hiddenCount,
  };
}

export function buildAskUserDisplay(envelope: AskUserEnvelope): string {
  const optionsPreview = buildAskUserOptionsPreview(envelope.options);
  const question = compactSingleLine(envelope.question, ASK_USER_LINE_CHAR_LIMIT);
  const defaultOnTimeout = compactSingleLine(
    envelope.defaultOnTimeout,
    ASK_USER_DEFAULT_ANSWER_CHAR_LIMIT,
  );
  const lines = [
    `[ask-user] ${question}`,
    `options_preview: ${optionsPreview.preview}`,
    defaultOnTimeout ? `default: ${defaultOnTimeout}` : undefined,
  ].filter((line): line is string => typeof line === "string" && line.length > 0);
  lines.push("hint: reply directly with number / option label / free text");
  return `${lines.join("\n")}\n`;
}
