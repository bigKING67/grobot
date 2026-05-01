import { AskUserEnvelope } from "./schema";

const ASK_USER_LINE_CHAR_LIMIT = 220;
const ASK_USER_DEFAULT_OPTION_PREVIEW_LIMIT = 5;
const ASK_USER_OPTION_ITEM_CHAR_LIMIT = 48;
const ASK_USER_DEFAULT_ANSWER_CHAR_LIMIT = 120;
const ASK_USER_DISPLAY_OPTION_LIMIT = 6;
const ASK_USER_PENDING_SUMMARY_LIMIT = 96;
const ASK_USER_OTHER_OPTION_LABEL = "自定义";
const ASK_USER_OTHER_OPTION_PLACEHOLDER = "输入自定义回复";

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

function stripLeadingOptionOrdinal(value: string): string {
  return value
    .trim()
    .replace(/^\s*(?:\d+|[０-９]+)(?:[\uFE0F\u20E3]|[.)、:：-])*\s*/u, "")
    .trim();
}

export function buildAskUserOptionDisplayLabel(value: string, index: number): string {
  const stripped = stripLeadingOptionOrdinal(value);
  const normalized = compactSingleLine(
    stripped.length > 0 ? stripped : value,
    ASK_USER_OPTION_ITEM_CHAR_LIMIT,
  );
  return normalized.length > 0 ? normalized : `Option ${String(index + 1)}`;
}

function buildAskUserOptionDisplayText(envelope: AskUserEnvelope, index: number): string {
  const label = buildAskUserOptionDisplayLabel(envelope.options[index] ?? "", index);
  const description = compactSingleLine(
    envelope.optionsDetailed[index]?.description ?? "",
    ASK_USER_OPTION_ITEM_CHAR_LIMIT,
  );
  if (!description) {
    return label;
  }
  return compactSingleLine(`${label} — ${description}`, ASK_USER_LINE_CHAR_LIMIT);
}

function buildAskUserDisplayHeader(envelope: AskUserEnvelope): string {
  const header = compactSingleLine(envelope.header ?? "需要你选择", 72);
  if (
    typeof envelope.questionIndex === "number"
    && Number.isFinite(envelope.questionIndex)
    && typeof envelope.questionTotal === "number"
    && Number.isFinite(envelope.questionTotal)
    && envelope.questionTotal > 1
  ) {
    return compactSingleLine(
      `${header} · ${String(envelope.questionIndex)}/${String(envelope.questionTotal)}`,
      72,
    );
  }
  return header;
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
  const header = buildAskUserDisplayHeader(envelope);
  const question = compactSingleLine(envelope.question, ASK_USER_LINE_CHAR_LIMIT);
  const lines = [`需要确认 · ${header}`, `  ${question}`, ""];
  if (envelope.options.length > 0) {
    const visibleStandardLimit = Math.max(0, ASK_USER_DISPLAY_OPTION_LIMIT - 1);
    const visibleOptions = envelope.options.slice(0, visibleStandardLimit);
    visibleOptions.forEach((_option, index) => {
      const marker = index === 0 ? "❯" : " ";
      lines.push(
        `  ${marker} ${String(index + 1)}  ${buildAskUserOptionDisplayText(envelope, index)}`,
      );
    });
    lines.push(
      `    ${ASK_USER_OTHER_OPTION_LABEL}  ${ASK_USER_OTHER_OPTION_PLACEHOLDER}`,
    );
    const hiddenCount = Math.max(0, envelope.options.length - visibleOptions.length);
    if (hiddenCount > 0) {
      lines.push(`    ... 还有 ${String(hiddenCount)} 项`);
    }
    lines.push("");
    lines.push("  Enter 打开选择菜单 · 数字直接回复 · 自定义输入。");
  } else {
    const defaultOnTimeout = compactSingleLine(
      envelope.defaultOnTimeout,
      ASK_USER_DEFAULT_ANSWER_CHAR_LIMIT,
    );
    lines.push("  请输入你的回复。");
    if (defaultOnTimeout) {
      lines.push(`  默认：${defaultOnTimeout}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function buildAskUserPendingSummary(envelope: AskUserEnvelope): string {
  if (envelope.options.length <= 0) {
    return "直接输入回复";
  }
  const standardMaxOption = Math.min(envelope.options.length, 9);
  const numericHint = standardMaxOption > 1 ? `1-${String(standardMaxOption)}` : "1";
  return compactSingleLine(
    `Enter 打开选择 · ${numericHint} 直选 · 自定义输入`,
    ASK_USER_PENDING_SUMMARY_LIMIT,
  );
}
