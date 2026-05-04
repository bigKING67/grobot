export type PromptFocusOwner =
  | "input"
  | "slash_suggestions"
  | "shortcut_overlay"
  | "history_search"
  | "select_menu"
  | "pending_ask"
  | "running_activity";

export type PromptBottomSlotKind =
  | "none"
  | "suggestions"
  | "shortcut_overlay"
  | "history_search"
  | "select_menu"
  | "pending_ask"
  | "running_activity"
  | "status"
  | "idle_hint";

export interface PromptSlotState {
  focusOwner: PromptFocusOwner;
  bottomSlot: {
    kind: PromptBottomSlotKind;
    renderFooter: boolean;
    renderStatus: boolean;
    renderIdleHint: boolean;
  };
}

export interface PromptSlotStateInput {
  inputVisible?: boolean;
  hasSuggestions?: boolean;
  shortcutOverlayVisible?: boolean;
  historySearchOpen?: boolean;
  selectMenuOpen?: boolean;
  pendingAskCount?: number;
  running?: boolean;
  hasStatusLine?: boolean;
  hasDraft?: boolean;
  terminalRows?: number;
  fullscreen?: boolean;
}

const FULLSCREEN_SHORT_ROW_THRESHOLD = 24;

function normalizeCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function isShortFullscreen(input: PromptSlotStateInput): boolean {
  const terminalRows = normalizeCount(input.terminalRows);
  return input.fullscreen === true
    && terminalRows > 0
    && terminalRows < FULLSCREEN_SHORT_ROW_THRESHOLD;
}

function buildSlot(input: {
  focusOwner: PromptFocusOwner;
  kind: PromptBottomSlotKind;
  renderFooter?: boolean;
  renderStatus?: boolean;
  renderIdleHint?: boolean;
}): PromptSlotState {
  return {
    focusOwner: input.focusOwner,
    bottomSlot: {
      kind: input.kind,
      renderFooter: input.renderFooter === true,
      renderStatus: input.renderStatus === true,
      renderIdleHint: input.renderIdleHint === true,
    },
  };
}

export function resolvePromptSlotState(input: PromptSlotStateInput): PromptSlotState {
  if (input.inputVisible === false) {
    return buildSlot({ focusOwner: "input", kind: "none" });
  }
  if (input.selectMenuOpen) {
    return buildSlot({ focusOwner: "select_menu", kind: "select_menu" });
  }
  if (input.historySearchOpen) {
    return buildSlot({ focusOwner: "history_search", kind: "history_search", renderFooter: true });
  }
  if (input.hasSuggestions) {
    return buildSlot({ focusOwner: "slash_suggestions", kind: "suggestions", renderFooter: true });
  }
  if (input.shortcutOverlayVisible) {
    return buildSlot({ focusOwner: "shortcut_overlay", kind: "shortcut_overlay", renderFooter: true });
  }
  if (normalizeCount(input.pendingAskCount) > 0) {
    return buildSlot({ focusOwner: "pending_ask", kind: "pending_ask", renderFooter: true });
  }
  if (input.running) {
    return buildSlot({ focusOwner: "running_activity", kind: "running_activity", renderFooter: true });
  }
  if (input.hasStatusLine && !isShortFullscreen(input)) {
    return buildSlot({
      focusOwner: "input",
      kind: "status",
      renderFooter: true,
      renderStatus: true,
    });
  }
  if (!input.hasDraft) {
    return buildSlot({
      focusOwner: "input",
      kind: "idle_hint",
      renderFooter: true,
      renderIdleHint: true,
    });
  }
  return buildSlot({ focusOwner: "input", kind: "none" });
}
