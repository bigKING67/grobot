import type {
  InputShortcutAction,
  KeypressPayload,
  RunningInputAction,
  SessionSlashSuggestion,
  ShortcutOverlayKeyAction,
  SlashSuggestionApplyResult,
  SlashSuggestionKey,
  SlashSuggestionKeyAction,
  SubmitKeyAction,
} from "./contract";

export function resolveSlashSuggestionApplyResult(
  commandRaw: string,
): SlashSuggestionApplyResult {
  const trimmed = commandRaw.trim();
  if (!trimmed) {
    return {
      command: commandRaw,
      submitImmediately: false,
    };
  }
  const tokens = trimmed.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return {
      command: trimmed,
      submitImmediately: false,
    };
  }
  const firstRequiredIndex = tokens.findIndex((token) => /^<[^>]+>$/.test(token));
  const firstOptionalIndex = tokens.findIndex((token) => /^\[[^\]]+\]$/.test(token));
  const firstPlaceholderIndex = [firstRequiredIndex, firstOptionalIndex]
    .filter((index) => index >= 0)
    .reduce((current, index) => Math.min(current, index), tokens.length);
  const baseTokens = firstPlaceholderIndex > 0
    ? tokens.slice(0, firstPlaceholderIndex)
    : [tokens[0]];
  const hasRequiredPlaceholder = firstRequiredIndex >= 0;
  const hasPlaceholder = firstPlaceholderIndex < tokens.length;
  const baseCommand = baseTokens.join(" ");
  return {
    command: hasPlaceholder ? `${baseCommand} ` : baseCommand,
    submitImmediately: !hasRequiredPlaceholder,
  };
}

function hasSlashCommandArguments(activeLineInputRaw: string | undefined): boolean {
  const activeLineInput = (activeLineInputRaw ?? "").trim();
  if (!activeLineInput.startsWith("/")) {
    return false;
  }
  const firstSpace = activeLineInput.indexOf(" ");
  if (firstSpace < 0) {
    return false;
  }
  return activeLineInput.slice(firstSpace + 1).trim().length > 0;
}

function resolveSlashCommandInputToken(activeLineInputRaw: string | undefined): string | undefined {
  const activeLineInput = (activeLineInputRaw ?? "").trim();
  const inputToken = activeLineInput.split(/\s+/, 1)[0] ?? "";
  if (!inputToken.startsWith("/")) {
    return undefined;
  }
  return inputToken;
}

export function resolveSlashSuggestionKeyAction(input: {
  key: SlashSuggestionKey;
  hasActiveSuggestions: boolean;
  selectedCommand?: string;
  activeLineInput?: string;
}): SlashSuggestionKeyAction {
  if (!input.hasActiveSuggestions) {
    return { kind: "noop" };
  }
  if (input.key === "escape") {
    return {
      kind: "hide_panel",
      hiddenLineInput: input.activeLineInput ?? "",
    };
  }
  if (hasSlashCommandArguments(input.activeLineInput)) {
    // Keep explicit user arguments intact (for example `/plan <goal>`), instead
    // of replacing the whole line with the selected slash command.
    return { kind: "noop" };
  }
  const selectedCommand = input.selectedCommand?.trim();
  if (!selectedCommand) {
    return { kind: "noop" };
  }
  const applied = resolveSlashSuggestionApplyResult(selectedCommand);
  return {
    kind: "apply",
    appliedCommand: applied.command,
    submitImmediately: input.key === "enter" ? applied.submitImmediately : false,
  };
}

function parseCsiUKeypressSequence(
  sequenceRaw: string,
): { codepoint: number; shift: boolean; meta: boolean; ctrl: boolean } | undefined {
  const sequence = sequenceRaw.trim();
  const match = sequence.match(/^\u001b\[(\d+)(?:;(\d+))?u$/);
  if (!match) {
    return undefined;
  }
  const codepoint = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(codepoint) || codepoint <= 0) {
    return undefined;
  }
  const encodedModifiers = Number.parseInt(match[2] ?? "1", 10);
  const modifierMask = Number.isFinite(encodedModifiers) && encodedModifiers > 0
    ? Math.max(0, encodedModifiers - 1)
    : 0;
  return {
    codepoint,
    shift: (modifierMask & 0b0001) !== 0,
    meta: (modifierMask & 0b0010) !== 0 || (modifierMask & 0b1000) !== 0,
    ctrl: (modifierMask & 0b0100) !== 0,
  };
}

function isLegacyEnterSequence(sequence: string): boolean {
  return sequence === "\u001bOM" || sequence === "\u001b[13~";
}

export function resolveSubmitKeyAction(input: {
  chunk: string;
  key: KeypressPayload;
}): SubmitKeyAction {
  const rawChunk = String(input.chunk ?? "");
  const sequence = String(input.key.sequence ?? rawChunk);
  const normalizedName = (input.key.name ?? "").trim().toLowerCase();
  const csiInfo = parseCsiUKeypressSequence(sequence)
    ?? parseCsiUKeypressSequence(rawChunk);
  const keyIndicatesEnter =
    normalizedName === "return"
    || normalizedName === "enter";
  const rawIndicatesEnter =
    sequence === "\r"
    || sequence === "\n"
    || rawChunk === "\r"
    || rawChunk === "\n"
    || isLegacyEnterSequence(sequence)
    || isLegacyEnterSequence(rawChunk);
  const csiIndicatesEnter = csiInfo?.codepoint === 13 || csiInfo?.codepoint === 10;
  if (!keyIndicatesEnter && !rawIndicatesEnter && !csiIndicatesEnter) {
    return "none";
  }
  const shift = Boolean(input.key.shift || csiInfo?.shift);
  const meta = Boolean(input.key.meta || csiInfo?.meta);
  if (shift || meta) {
    return "newline";
  }
  return "submit";
}

export function isHistorySearchShortcut(input: {
  chunk: string;
  key: KeypressPayload;
}): boolean {
  const chunk = String(input.chunk ?? "");
  const sequence = String(input.key.sequence ?? chunk);
  const name = (input.key.name ?? "").trim().toLowerCase();
  if (input.key.ctrl && name === "r") {
    return true;
  }
  return sequence === "\u0012" || chunk === "\u0012";
}

export function resolveInputShortcutAction(input: {
  chunk: string;
  key: KeypressPayload;
}): InputShortcutAction {
  const chunk = String(input.chunk ?? "");
  const sequence = String(input.key.sequence ?? chunk);
  const name = (input.key.name ?? "").trim().toLowerCase();
  if (
    (input.key.ctrl && name === "c")
    || sequence === "\u0003"
    || chunk === "\u0003"
  ) {
    return "sigint";
  }
  if (isHistorySearchShortcut(input)) {
    return "history_search";
  }
  return "none";
}

export function resolveShortcutOverlayKeyAction(input: {
  chunk: string;
  key: KeypressPayload;
  inputGraphemeLength: number;
  hasActiveSlashSuggestions?: boolean;
}): ShortcutOverlayKeyAction {
  const chunk = String(input.chunk ?? "");
  const sequence = String(input.key.sequence ?? chunk);
  const name = (input.key.name ?? "").trim().toLowerCase();
  const isQuestionMark = chunk === "?" || sequence === "?" || name === "?";
  if (!isQuestionMark || input.key.ctrl || input.key.meta) {
    return "none";
  }
  if ((input.hasActiveSlashSuggestions ?? false) || input.inputGraphemeLength > 0) {
    return "insert_text";
  }
  return "toggle_overlay";
}

export function resolveRunningInputAction(rawInput: string): RunningInputAction {
  const raw = String(rawInput ?? "");
  if (raw.length === 0) {
    return { kind: "none" };
  }
  if (raw === "\u001b" || raw === "\u0003") {
    return { kind: "interrupt" };
  }
  if (raw === "\r" || raw === "\n" || raw === "\r\n") {
    return { kind: "submit_queue" };
  }
  if (raw === "\u007f" || raw === "\b") {
    return { kind: "backspace" };
  }
  if (/^[^\u0000-\u001F\u007F]+$/u.test(raw)) {
    return { kind: "append", value: raw };
  }
  return { kind: "none" };
}

export function resolveRunningInputActions(rawInput: string): readonly RunningInputAction[] {
  const raw = String(rawInput ?? "");
  if (raw.length === 0) {
    return [{ kind: "none" }];
  }

  const direct = resolveRunningInputAction(raw);
  if (direct.kind !== "none") {
    return [direct];
  }

  const coalescedSubmit = raw.match(/^([^\u0000-\u001F\u007F]+)(\r\n|\r|\n)$/u);
  if (coalescedSubmit) {
    return [
      { kind: "append", value: coalescedSubmit[1] ?? "" },
      { kind: "submit_queue" },
    ];
  }

  return [{ kind: "none" }];
}

export function shouldHighlightSlashInputToken(input: {
  activeLineInput: string;
  suggestions: readonly SessionSlashSuggestion[];
}): boolean {
  const inputToken = resolveSlashCommandInputToken(input.activeLineInput);
  if (!inputToken) {
    return false;
  }
  return input.suggestions.some((suggestion) => {
    const suggestionToken = suggestion.command.trim().split(/\s+/, 1)[0] ?? "";
    if (!suggestionToken) {
      return false;
    }
    return suggestionToken === inputToken;
  });
}

export function resolveSlashInputHighlightSuggestions(input: {
  activeLineInput: string;
  suggestions: readonly SessionSlashSuggestion[];
  getSlashSuggestions?: (input: string) => readonly SessionSlashSuggestion[];
}): readonly SessionSlashSuggestion[] {
  if (input.suggestions.length > 0) {
    return input.suggestions;
  }
  if (!hasSlashCommandArguments(input.activeLineInput)) {
    return input.suggestions;
  }
  const inputToken = resolveSlashCommandInputToken(input.activeLineInput);
  if (!inputToken || typeof input.getSlashSuggestions !== "function") {
    return input.suggestions;
  }
  return input.getSlashSuggestions(inputToken);
}
