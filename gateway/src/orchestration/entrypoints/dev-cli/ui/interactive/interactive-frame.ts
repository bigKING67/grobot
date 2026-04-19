export interface SessionPromptLayout {
  prefix: string;
  inlinePrompt: string;
  suffix?: string;
}

function deriveBottomBorder(topBorder: string): string | undefined {
  const leftIndex = topBorder.indexOf("╭");
  const rightIndex = topBorder.lastIndexOf("╮");
  if (leftIndex < 0 || rightIndex <= leftIndex) {
    return undefined;
  }
  return `${topBorder.slice(0, leftIndex)}╰${"─".repeat(rightIndex - leftIndex - 1)}╯${topBorder.slice(rightIndex + 1)}`;
}

export function resolveInteractivePromptLayout(input: {
  promptText: string | SessionPromptLayout;
  fallbackPrompt: string;
}): SessionPromptLayout {
  if (typeof input.promptText !== "string") {
    const inlinePrompt = input.promptText.inlinePrompt.length > 0
      ? input.promptText.inlinePrompt
      : input.fallbackPrompt;
    return {
      prefix: input.promptText.prefix,
      inlinePrompt,
      suffix: input.promptText.suffix,
    };
  }
  const promptText = input.promptText;
  if (!promptText.includes("\n")) {
    return {
      prefix: "",
      inlinePrompt: promptText.length > 0 ? promptText : input.fallbackPrompt,
      suffix: "",
    };
  }
  const lines = promptText.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  if (lines.length === 0) {
    return {
      prefix: "",
      inlinePrompt: input.fallbackPrompt,
      suffix: "",
    };
  }
  const inlinePrompt = lines.pop() ?? input.fallbackPrompt;
  const prefix = lines.join("\n");
  const topBorder = lines[lines.length - 1] ?? "";
  const derivedBottomBorder = deriveBottomBorder(topBorder);
  return {
    prefix,
    inlinePrompt: inlinePrompt.length > 0 ? inlinePrompt : input.fallbackPrompt,
    suffix: derivedBottomBorder ?? "",
  };
}
