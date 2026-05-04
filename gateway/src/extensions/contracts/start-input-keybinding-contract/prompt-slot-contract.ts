import {
  resolveSessionInputFooterLines,
} from "../../../cli/tui/components/prompt-input/render";
import {
  resolvePromptSlotState,
} from "../../../cli/tui/interactive/prompt-slot-state";
import { stripAnsi, type ContractPayload } from "./helpers";

export function runPromptSlotChecks(): ContractPayload {
  const promptSlotSelectMenu = resolvePromptSlotState({
    selectMenuOpen: true,
    hasStatusLine: true,
  });
  const promptSlotSuggestions = resolvePromptSlotState({
    hasSuggestions: true,
    hasStatusLine: true,
  });
  const promptSlotHistorySearch = resolvePromptSlotState({
    historySearchOpen: true,
    hasSuggestions: true,
  });
  const promptSlotPendingAsk = resolvePromptSlotState({
    pendingAskCount: 2,
    hasStatusLine: true,
  });
  const promptSlotRunning = resolvePromptSlotState({
    running: true,
    pendingAskCount: 0,
    hasStatusLine: true,
  });
  const promptSlotStatus = resolvePromptSlotState({
    hasStatusLine: true,
    hasDraft: false,
  });
  const promptSlotIdleHint = resolvePromptSlotState({
    hasDraft: false,
  });
  const promptSlotDraft = resolvePromptSlotState({
    hasStatusLine: false,
    hasDraft: true,
  });
  const promptSlotShortFullscreen = resolvePromptSlotState({
    hasStatusLine: true,
    terminalRows: 18,
    fullscreen: true,
  });
  const promptSlotHiddenInput = resolvePromptSlotState({
    inputVisible: false,
    hasStatusLine: true,
    running: true,
  });
  const runtimeFooterStatus = resolveSessionInputFooterLines({
    footerLines: ["status line"],
    inputGraphemeLength: 0,
    promptSlot: {
      hasStatusLine: true,
    },
  });
  const runtimeFooterSuggestions = resolveSessionInputFooterLines({
    footerLines: ["status line"],
    inputGraphemeLength: 0,
    hasSuggestions: true,
    promptSlot: {
      hasStatusLine: true,
    },
  });
  const runtimeFooterShortcutOverlay = resolveSessionInputFooterLines({
    footerLines: ["status line"],
    inputGraphemeLength: 0,
    shortcutOverlayVisible: true,
    promptSlot: {
      hasStatusLine: true,
    },
  });
  const runtimeFooterPendingAsk = resolveSessionInputFooterLines({
    footerLines: ["ask 1 pending"],
    inputGraphemeLength: 0,
    promptSlot: {
      pendingAskCount: 1,
      hasStatusLine: true,
    },
  });
  const runtimeFooterDraftNoStatus = resolveSessionInputFooterLines({
    footerLines: ["? 快捷键"],
    inputGraphemeLength: 2,
    promptSlot: {
      hasStatusLine: false,
    },
  });
  const runtimeFooterShortFullscreen = resolveSessionInputFooterLines({
    footerLines: ["status line"],
    inputGraphemeLength: 0,
    promptSlot: {
      hasStatusLine: true,
      terminalRows: 18,
      fullscreen: true,
    },
  });
  const runtimeFooterShortFullscreenDraft = resolveSessionInputFooterLines({
    footerLines: ["status line"],
    inputGraphemeLength: 2,
    promptSlot: {
      hasStatusLine: true,
      terminalRows: 18,
      fullscreen: true,
    },
  });

  return {
    prompt_slot_select_menu_owns_focus_without_footer:
      promptSlotSelectMenu.focusOwner === "select_menu"
      && promptSlotSelectMenu.bottomSlot.kind === "select_menu"
      && !promptSlotSelectMenu.bottomSlot.renderFooter
      && !promptSlotSelectMenu.bottomSlot.renderStatus,
    prompt_slot_suggestions_suppress_status:
      promptSlotSuggestions.focusOwner === "slash_suggestions"
      && promptSlotSuggestions.bottomSlot.kind === "suggestions"
      && promptSlotSuggestions.bottomSlot.renderFooter
      && !promptSlotSuggestions.bottomSlot.renderStatus,
    prompt_slot_history_preempts_suggestions:
      promptSlotHistorySearch.focusOwner === "history_search"
      && promptSlotHistorySearch.bottomSlot.kind === "history_search",
    prompt_slot_pending_ask_preempts_status:
      promptSlotPendingAsk.focusOwner === "pending_ask"
      && promptSlotPendingAsk.bottomSlot.kind === "pending_ask"
      && !promptSlotPendingAsk.bottomSlot.renderStatus,
    prompt_slot_running_preempts_status:
      promptSlotRunning.focusOwner === "running_activity"
      && promptSlotRunning.bottomSlot.kind === "running_activity"
      && !promptSlotRunning.bottomSlot.renderStatus,
    prompt_slot_status_when_input_idle:
      promptSlotStatus.focusOwner === "input"
      && promptSlotStatus.bottomSlot.kind === "status"
      && promptSlotStatus.bottomSlot.renderStatus,
    prompt_slot_idle_hint_hidden_for_draft:
      promptSlotIdleHint.bottomSlot.kind === "idle_hint"
      && promptSlotIdleHint.bottomSlot.renderIdleHint
      && promptSlotDraft.bottomSlot.kind === "none",
    prompt_slot_short_fullscreen_drops_status_first:
      promptSlotShortFullscreen.bottomSlot.kind === "idle_hint"
      && !promptSlotShortFullscreen.bottomSlot.renderStatus,
    prompt_slot_hidden_input_renders_no_footer:
      promptSlotHiddenInput.bottomSlot.kind === "none"
      && !promptSlotHiddenInput.bottomSlot.renderFooter,
    prompt_slot_runtime_status_footer_renders:
      runtimeFooterStatus.promptSlotState.bottomSlot.kind === "status"
      && runtimeFooterStatus.footerLines.length === 1
      && runtimeFooterStatus.footerLines[0] === "status line",
    prompt_slot_runtime_suggestions_suppress_status_footer:
      runtimeFooterSuggestions.promptSlotState.bottomSlot.kind === "suggestions"
      && runtimeFooterSuggestions.footerLines.length === 0,
    prompt_slot_runtime_shortcut_overlay_suppresses_status_footer:
      runtimeFooterShortcutOverlay.promptSlotState.bottomSlot.kind === "shortcut_overlay"
      && runtimeFooterShortcutOverlay.footerLines.length === 0,
    prompt_slot_runtime_pending_ask_renders_footer:
      runtimeFooterPendingAsk.promptSlotState.bottomSlot.kind === "pending_ask"
      && runtimeFooterPendingAsk.footerLines.length === 1
      && runtimeFooterPendingAsk.footerLines[0] === "ask 1 pending",
    prompt_slot_runtime_draft_without_status_hides_footer:
      runtimeFooterDraftNoStatus.promptSlotState.bottomSlot.kind === "none"
      && runtimeFooterDraftNoStatus.footerLines.length === 0,
    prompt_slot_runtime_short_fullscreen_replaces_status_with_hint:
      runtimeFooterShortFullscreen.promptSlotState.bottomSlot.kind === "idle_hint"
      && runtimeFooterShortFullscreen.footerLines.length === 1
      && stripAnsi(runtimeFooterShortFullscreen.footerLines[0] ?? "") === "? 快捷键",
    prompt_slot_runtime_short_fullscreen_draft_hides_footer:
      runtimeFooterShortFullscreenDraft.promptSlotState.bottomSlot.kind === "none"
      && runtimeFooterShortFullscreenDraft.footerLines.length === 0,
  };
}
