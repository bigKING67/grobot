import {
  decodeAskUserPanelInput,
} from "../../../cli/tui/components/ask-user-panel/reducer";
import { createInitialPromptInputTurnState } from "../../../cli/tui/components/prompt-input/turn-state";
import {
  isHistorySearchShortcut,
  resolveInputShortcutAction,
  resolveRunningInputAction,
  resolveRunningInputActions,
  resolveShortcutOverlayKeyAction,
  resolveSubmitKeyAction,
} from "../../../cli/tui/components/prompt-input/reducer";
import {
  isPlanApprovalInlineFeedbackApproveShortcut,
  normalizeTerminalSelectMenuTextInput,
  shouldAllowTerminalSelectMenuItemSelection,
  shouldRouteTerminalSelectMenuInlineInputBeforeMode,
  shouldEnableTerminalSelectMenuSelection,
  shouldEnableTerminalSelectMenuNumericSelection,
} from "../../../cli/tui/components/select-menu/controller";
import {
  reduceTerminalSelectMenuInlineInput,
} from "../../../cli/tui/components/select-menu/reducer";
import {
  resolveCoalescedSubmitChunk,
  resolveInteractiveEnterDataAction,
} from "../../../cli/tui/terminal/keyboard";
import type { ContractPayload } from "./helpers";

export function runInputKeybindingChecks(): ContractPayload {
  const submitReturn = resolveSubmitKeyAction({
    chunk: "\r",
    key: { name: "return", sequence: "\r" },
  });
  const submitEnter = resolveSubmitKeyAction({
    chunk: "\n",
    key: { name: "enter", sequence: "\n" },
  });
  const submitLegacySequence = resolveSubmitKeyAction({
    chunk: "\u001bOM",
    key: { sequence: "\u001bOM" },
  });
  const submitCsiU = resolveSubmitKeyAction({
    chunk: "\u001b[13u",
    key: { sequence: "\u001b[13u" },
  });
  const newlineShift = resolveSubmitKeyAction({
    chunk: "\r",
    key: { name: "return", sequence: "\r", shift: true },
  });
  const newlineMeta = resolveSubmitKeyAction({
    chunk: "\r",
    key: { name: "return", sequence: "\r", meta: true },
  });
  const newlineCsiUShift = resolveSubmitKeyAction({
    chunk: "\u001b[13;2u",
    key: { sequence: "\u001b[13;2u" },
  });
  const submitNone = resolveSubmitKeyAction({
    chunk: "a",
    key: { name: "a", sequence: "a" },
  });
  const coalescedSubmit = resolveCoalescedSubmitChunk("hello\r");
  const coalescedSubmitCrLf = resolveCoalescedSubmitChunk("hello\r\n");
  const coalescedSubmitLf = resolveCoalescedSubmitChunk("hello\n");
  const askUserPanelOtherSubmit = decodeAskUserPanelInput("hello\r", 3, true);
  const askUserPanelOtherSubmitCrLf = decodeAskUserPanelInput("hello\r\n", 3, true);
  const askUserPanelOtherSubmitCjk = decodeAskUserPanelInput("补充说明\r", 3, true);
  const askUserPanelNumericSubmit = decodeAskUserPanelInput("2\r", 3, false);
  const askUserPanelOtherIndexSubmit = decodeAskUserPanelInput("3\r", 3, false);
  const askUserPanelFooterChatIndexSubmit = decodeAskUserPanelInput("4\r", 3, false, true, {
    chatIndex: 4,
    skipIndex: 5,
  });
  const askUserPanelFooterSkipIndexSubmit = decodeAskUserPanelInput("5\r", 3, false, true, {
    chatIndex: 4,
    skipIndex: 5,
  });
  const askUserPanelOtherPrintable = decodeAskUserPanelInput("补", 3, true);
  const askUserPanelOtherBackspace = decodeAskUserPanelInput("\u007f", 3, true);
  const askUserPanelNotesShortcut = decodeAskUserPanelInput("n", 3, false);
  const askUserPanelNotesPrintable = decodeAskUserPanelInput("n", 3, true);
  const askUserPanelChatShortcut = decodeAskUserPanelInput("c", 3, false);
  const askUserPanelSkipShortcut = decodeAskUserPanelInput("s", 3, false, true);
  const askUserPanelSkipWithoutPlanTypesOther = decodeAskUserPanelInput("s", 3, false, false);
  const coalescedWithBackslash = resolveCoalescedSubmitChunk("\\\r");
  const coalescedEscapeSequence = resolveCoalescedSubmitChunk("\u001b\r");
  const inlineInputOption = {
    id: "keep_planning",
    label: "Refine plan",
    input: {
      placeholder: "Tell Grobot what to adjust",
      showLabelWithValue: true,
      labelValueSeparator: ": ",
    },
  };
  const inlineInputEmptyEnter = reduceTerminalSelectMenuInlineInput({
    rawInput: "\r",
    item: inlineInputOption,
    currentValue: "",
    inputMode: false,
    variant: "plan_approval",
  });
  const inlineInputPrintable = reduceTerminalSelectMenuInlineInput({
    rawInput: "补",
    item: inlineInputOption,
    currentValue: "",
    inputMode: true,
    variant: "plan_approval",
  });
  const inlineInputBackspace = reduceTerminalSelectMenuInlineInput({
    rawInput: "\u007f",
    item: inlineInputOption,
    currentValue: "abc",
    inputMode: true,
    variant: "plan_approval",
  });
  const inlineInputBackspaceBeforeMode = reduceTerminalSelectMenuInlineInput({
    rawInput: "\u007f",
    item: inlineInputOption,
    currentValue: "abc",
    inputMode: false,
    variant: "plan_approval",
  });
  const inlineInputClear = reduceTerminalSelectMenuInlineInput({
    rawInput: "\u0015",
    item: inlineInputOption,
    currentValue: "abc",
    inputMode: true,
    variant: "plan_approval",
  });
  const inlineInputCoalescedSubmit = reduceTerminalSelectMenuInlineInput({
    rawInput: "please revise\r\n",
    item: inlineInputOption,
    currentValue: "",
    inputMode: true,
    variant: "plan_approval",
  });
  const inlineInputTab = reduceTerminalSelectMenuInlineInput({
    rawInput: "\t",
    item: inlineInputOption,
    currentValue: "step",
    inputMode: true,
    variant: "plan_approval",
  });
  const inlineInputTabBeforeMode = reduceTerminalSelectMenuInlineInput({
    rawInput: "\t",
    item: inlineInputOption,
    currentValue: "step",
    inputMode: false,
    variant: "plan_approval",
  });
  const inlineInputUnsafePaste = reduceTerminalSelectMenuInlineInput({
    rawInput: "Run\tchecks\u001B[31m now\u001B[0m\u202E!",
    item: inlineInputOption,
    currentValue: "",
    inputMode: true,
    variant: "plan_approval",
  });
  const inlineInputUnsafeCoalescedSubmit = reduceTerminalSelectMenuInlineInput({
    rawInput: "Line 1\t\u001B[31mred\u001B[0m\u202E\nLine 2\r\n",
    item: inlineInputOption,
    currentValue: "",
    inputMode: true,
    variant: "plan_approval",
  });
  const normalizedInlineInputText = normalizeTerminalSelectMenuTextInput(
    "A\tB\u001B]0;pwnd\u0007\u202EC\nD",
  );
  const inlineInputEscExitsInput = reduceTerminalSelectMenuInlineInput({
    rawInput: "\u001b",
    item: inlineInputOption,
    currentValue: "abc",
    inputMode: true,
    variant: "plan_approval",
  });
  const inlineInputEscWithoutInputIgnored = reduceTerminalSelectMenuInlineInput({
    rawInput: "\u001b",
    item: inlineInputOption,
    currentValue: "abc",
    inputMode: false,
    variant: "plan_approval",
  });
  const inlineInputCtrlGEditPlan = reduceTerminalSelectMenuInlineInput({
    rawInput: "\u0007",
    item: inlineInputOption,
    currentValue: "abc",
    inputMode: true,
    variant: "plan_approval",
  });
  const inlineInputShiftTabApproveFeedback =
    isPlanApprovalInlineFeedbackApproveShortcut("\u001b[Z");
  const inlineInputTabRoutesBeforeMode =
    shouldRouteTerminalSelectMenuInlineInputBeforeMode({
      rawInput: "\t",
      hasActiveInputItem: true,
    });
  const inlineInputDigitDoesNotRouteBeforeMode =
    shouldRouteTerminalSelectMenuInlineInputBeforeMode({
      rawInput: "1",
      hasActiveInputItem: true,
    });
  const inlineInputTabDoesNotRouteDuringSearch =
    shouldRouteTerminalSelectMenuInlineInputBeforeMode({
      rawInput: "\t",
      hasActiveInputItem: true,
      menuSearchMode: true,
    });
  const numericSelectionDefaultEnabled = shouldEnableTerminalSelectMenuNumericSelection({});
  const numericSelectionHiddenIndexDisabled = shouldEnableTerminalSelectMenuNumericSelection({
    hideIndexes: true,
  });
  const numericSelectionDisableSelectionDisabled = shouldEnableTerminalSelectMenuNumericSelection({
    disableSelection: true,
  });
  const numericSelectionNumericModeDisabled = shouldEnableTerminalSelectMenuNumericSelection({
    disableSelection: "numeric",
  });
  const enterSelectionDefaultEnabled = shouldEnableTerminalSelectMenuSelection({
    source: "enter",
  });
  const enterSelectionDisableSelectionDisabled = shouldEnableTerminalSelectMenuSelection({
    disableSelection: true,
    source: "enter",
  });
  const enterSelectionNumericModeAllowed = shouldEnableTerminalSelectMenuSelection({
    disableSelection: "numeric",
    source: "enter",
  });
  const numericSelectionNumericModeRejected = shouldEnableTerminalSelectMenuSelection({
    disableSelection: "numeric",
    source: "numeric",
  });
  const disabledMenuOption = {
    id: "deploy",
    label: "Deploy",
    disabled: true,
  };
  const enabledMenuOption = {
    id: "run",
    label: "Run",
  };
  const disabledItemEnterRejected = shouldAllowTerminalSelectMenuItemSelection({
    item: disabledMenuOption,
    source: "enter",
  });
  const disabledItemNumericRejected = shouldAllowTerminalSelectMenuItemSelection({
    item: disabledMenuOption,
    source: "numeric",
  });
  const enabledItemEnterAllowed = shouldAllowTerminalSelectMenuItemSelection({
    item: enabledMenuOption,
    source: "enter",
  });
  const enabledItemDisableSelectionRejected = shouldAllowTerminalSelectMenuItemSelection({
    item: enabledMenuOption,
    disableSelection: true,
    source: "enter",
  });
  const enabledItemNumericModeEnterAllowed = shouldAllowTerminalSelectMenuItemSelection({
    item: enabledMenuOption,
    disableSelection: "numeric",
    source: "enter",
  });
  const enabledItemNumericModeNumericRejected = shouldAllowTerminalSelectMenuItemSelection({
    item: enabledMenuOption,
    disableSelection: "numeric",
    source: "numeric",
  });
  const submitChunkOnlyLf = resolveSubmitKeyAction({
    chunk: "\n",
    key: {},
  });
  const interactivePlainEnterDefersToKeypress = resolveInteractiveEnterDataAction({
    chunk: "\r",
    keypressSupported: true,
  });
  const interactivePlainEnterRecentKeypressIgnored = resolveInteractiveEnterDataAction({
    chunk: "\r",
    keypressSupported: true,
    keypressHandledRecently: true,
  });
  const interactivePlainEnterFallbackSubmits = resolveInteractiveEnterDataAction({
    chunk: "\r",
    keypressSupported: false,
  });
  const interactiveTextSubmitChunkIgnored = resolveInteractiveEnterDataAction({
    chunk: "hello\r",
    keypressSupported: true,
  });
  const historyShortcutCtrlR = isHistorySearchShortcut({
    chunk: "\u0012",
    key: { ctrl: true, name: "r", sequence: "\u0012" },
  });
  const historyShortcutRawCtrlR = isHistorySearchShortcut({
    chunk: "\u0012",
    key: {},
  });
  const shortcutCtrlC = resolveInputShortcutAction({
    chunk: "\u0003",
    key: { ctrl: true, name: "c", sequence: "\u0003" },
  });
  const shortcutCtrlR = resolveInputShortcutAction({
    chunk: "\u0012",
    key: { ctrl: true, name: "r", sequence: "\u0012" },
  });
  const shortcutOther = resolveInputShortcutAction({
    chunk: "a",
    key: { name: "a", sequence: "a" },
  });
  const shortcutOverlayEmptyQuestion = resolveShortcutOverlayKeyAction({
    chunk: "?",
    key: { name: "?", sequence: "?" },
    inputGraphemeLength: 0,
  });
  const shortcutOverlayDraftQuestion = resolveShortcutOverlayKeyAction({
    chunk: "?",
    key: { name: "?", sequence: "?" },
    inputGraphemeLength: 1,
  });
  const shortcutOverlaySlashQuestion = resolveShortcutOverlayKeyAction({
    chunk: "?",
    key: { name: "?", sequence: "?" },
    inputGraphemeLength: 1,
    hasActiveSlashSuggestions: true,
  });
  const shortcutOverlayCtrlQuestionIgnored = resolveShortcutOverlayKeyAction({
    chunk: "?",
    key: { ctrl: true, name: "?", sequence: "?" },
    inputGraphemeLength: 0,
  });
  const runningAppend = resolveRunningInputAction("继续处理");
  const runningEmojiAppend = resolveRunningInputAction("A");
  const runningBackspace = resolveRunningInputAction("\u007f");
  const runningSubmit = resolveRunningInputAction("\r");
  const runningEscInterrupt = resolveRunningInputAction("\u001b");
  const runningCtrlCInterrupt = resolveRunningInputAction("\u0003");
  const runningControlIgnored = resolveRunningInputAction("\u0012");
  const runningCoalescedSubmit = resolveRunningInputActions("继续处理\r");
  const draftCarryState = createInitialPromptInputTurnState("未提交草稿");

  return {
    submit_return_detected: submitReturn === "submit",
    submit_enter_detected: submitEnter === "submit",
    submit_legacy_sequence_detected: submitLegacySequence === "submit",
    submit_csiu_detected: submitCsiU === "submit",
    submit_shift_newline: newlineShift === "newline",
    submit_meta_newline: newlineMeta === "newline",
    submit_csiu_shift_newline: newlineCsiUShift === "newline",
    submit_non_enter_ignored: submitNone === "none",
    submit_coalesced_detected:
      coalescedSubmit.shouldSubmit
      && coalescedSubmit.normalizedChunk === "hello",
    submit_coalesced_crlf_detected:
      coalescedSubmitCrLf.shouldSubmit
      && coalescedSubmitCrLf.normalizedChunk === "hello",
    submit_coalesced_lf_detected:
      coalescedSubmitLf.shouldSubmit
      && coalescedSubmitLf.normalizedChunk === "hello",
    ask_user_panel_other_submit_text:
      askUserPanelOtherSubmit.kind === "submit_text"
      && askUserPanelOtherSubmit.value === "hello",
    ask_user_panel_other_submit_crlf_text:
      askUserPanelOtherSubmitCrLf.kind === "submit_text"
      && askUserPanelOtherSubmitCrLf.value === "hello",
    ask_user_panel_other_submit_cjk_text:
      askUserPanelOtherSubmitCjk.kind === "submit_text"
      && askUserPanelOtherSubmitCjk.value === "补充说明",
    ask_user_panel_numeric_submit_selects_standard_option:
      askUserPanelNumericSubmit.kind === "select_index"
      && askUserPanelNumericSubmit.index === 1,
    ask_user_panel_other_numeric_submit_focuses_other:
      askUserPanelOtherIndexSubmit.kind === "select_index"
      && askUserPanelOtherIndexSubmit.index === 2,
    ask_user_panel_footer_chat_numeric_submit:
      askUserPanelFooterChatIndexSubmit.kind === "chat",
    ask_user_panel_footer_skip_numeric_submit:
      askUserPanelFooterSkipIndexSubmit.kind === "skip",
    ask_user_panel_other_printable_text:
      askUserPanelOtherPrintable.kind === "text"
      && askUserPanelOtherPrintable.value === "补",
    ask_user_panel_other_backspace:
      askUserPanelOtherBackspace.kind === "backspace",
    ask_user_panel_notes_shortcut:
      askUserPanelNotesShortcut.kind === "notes",
    ask_user_panel_notes_mode_printable_text:
      askUserPanelNotesPrintable.kind === "text"
      && askUserPanelNotesPrintable.value === "n",
    ask_user_panel_chat_shortcut:
      askUserPanelChatShortcut.kind === "chat",
    ask_user_panel_skip_shortcut_plan_only:
      askUserPanelSkipShortcut.kind === "skip",
    ask_user_panel_skip_without_plan_keeps_other_typing:
      askUserPanelSkipWithoutPlanTypesOther.kind === "text"
      && askUserPanelSkipWithoutPlanTypesOther.value === "s",
    submit_coalesced_backslash_ignored:
      !coalescedWithBackslash.shouldSubmit
      && coalescedWithBackslash.normalizedChunk === "\\\r",
    submit_coalesced_escape_ignored:
      !coalescedEscapeSequence.shouldSubmit
      && coalescedEscapeSequence.normalizedChunk === "\u001b\r",
    menu_inline_input_empty_enter_activates:
      inlineInputEmptyEnter.kind === "activate"
      && inlineInputEmptyEnter.value === "",
    menu_inline_input_printable_updates:
      inlineInputPrintable.kind === "update"
      && inlineInputPrintable.value === "补",
    menu_inline_input_backspace_updates_in_input_mode:
      inlineInputBackspace.kind === "update"
      && inlineInputBackspace.value === "ab",
    menu_inline_input_backspace_ignored_before_mode:
      inlineInputBackspaceBeforeMode.kind === "ignored",
    menu_inline_input_ctrl_u_clears:
      inlineInputClear.kind === "update"
      && inlineInputClear.value === "",
    menu_inline_input_coalesced_submit:
      inlineInputCoalescedSubmit.kind === "submit"
      && inlineInputCoalescedSubmit.value === "please revise",
    menu_inline_input_tab_toggles_input_mode:
      inlineInputTab.kind === "toggle_input"
      && inlineInputTab.value === "step",
    menu_inline_input_tab_toggles_before_mode:
      inlineInputTabBeforeMode.kind === "toggle_input"
      && inlineInputTabBeforeMode.value === "step",
    menu_inline_input_sanitizes_unsafe_text:
      inlineInputUnsafePaste.kind === "update"
      && inlineInputUnsafePaste.value === "Run    checks now!",
    menu_inline_input_sanitizes_coalesced_submit:
      inlineInputUnsafeCoalescedSubmit.kind === "submit"
      && inlineInputUnsafeCoalescedSubmit.value === "Line 1    red Line 2",
    menu_inline_input_text_normalizer_removes_terminal_controls:
      normalizedInlineInputText === "A    BC D",
    menu_inline_input_esc_exits_input_first:
      inlineInputEscExitsInput.kind === "exit_input"
      && inlineInputEscExitsInput.value === "abc",
    menu_inline_input_esc_without_input_falls_through:
      inlineInputEscWithoutInputIgnored.kind === "ignored",
    menu_inline_input_ctrl_g_keeps_plan_editor:
      inlineInputCtrlGEditPlan.kind === "edit_plan"
      && inlineInputCtrlGEditPlan.value === "abc",
    menu_inline_input_shift_tab_approves_feedback:
      inlineInputShiftTabApproveFeedback,
    menu_inline_input_tab_routes_before_mode:
      inlineInputTabRoutesBeforeMode,
    menu_inline_input_digit_does_not_route_before_mode:
      !inlineInputDigitDoesNotRouteBeforeMode,
    menu_inline_input_tab_does_not_route_during_search:
      !inlineInputTabDoesNotRouteDuringSearch,
    menu_numeric_selection_default_enabled: numericSelectionDefaultEnabled,
    menu_numeric_selection_hidden_indexes_disabled: !numericSelectionHiddenIndexDisabled,
    menu_numeric_selection_disable_selection_disabled: !numericSelectionDisableSelectionDisabled,
    menu_numeric_selection_numeric_mode_disabled: !numericSelectionNumericModeDisabled,
    menu_enter_selection_default_enabled: enterSelectionDefaultEnabled,
    menu_enter_selection_disable_selection_disabled: !enterSelectionDisableSelectionDisabled,
    menu_enter_selection_numeric_mode_allowed: enterSelectionNumericModeAllowed,
    menu_numeric_selection_numeric_mode_rejected: !numericSelectionNumericModeRejected,
    menu_disabled_item_enter_rejected: !disabledItemEnterRejected,
    menu_disabled_item_numeric_rejected: !disabledItemNumericRejected,
    menu_enabled_item_enter_allowed: enabledItemEnterAllowed,
    menu_enabled_item_disable_selection_rejected: !enabledItemDisableSelectionRejected,
    menu_enabled_item_numeric_mode_enter_allowed: enabledItemNumericModeEnterAllowed,
    menu_enabled_item_numeric_mode_numeric_rejected: !enabledItemNumericModeNumericRejected,
    submit_chunk_only_lf_detected: submitChunkOnlyLf === "submit",
    interactive_plain_enter_defers_to_keypress:
      interactivePlainEnterDefersToKeypress === "defer_to_keypress",
    interactive_plain_enter_recent_keypress_ignored:
      interactivePlainEnterRecentKeypressIgnored === "none",
    interactive_plain_enter_fallback_submits:
      interactivePlainEnterFallbackSubmits === "submit",
    interactive_text_submit_chunk_ignored:
      interactiveTextSubmitChunkIgnored === "none",
    shortcut_history_ctrl_r_detected: historyShortcutCtrlR,
    shortcut_history_raw_ctrl_r_detected: historyShortcutRawCtrlR,
    shortcut_ctrl_c_sigint: shortcutCtrlC === "sigint",
    shortcut_ctrl_r_history_search: shortcutCtrlR === "history_search",
    shortcut_non_matching_none: shortcutOther === "none",
    shortcut_overlay_empty_question_toggles:
      shortcutOverlayEmptyQuestion === "toggle_overlay",
    shortcut_overlay_draft_question_inserts:
      shortcutOverlayDraftQuestion === "insert_text",
    shortcut_overlay_slash_question_inserts:
      shortcutOverlaySlashQuestion === "insert_text",
    shortcut_overlay_ctrl_question_ignored:
      shortcutOverlayCtrlQuestionIgnored === "none",
    running_input_appends_printable:
      runningAppend.kind === "append"
      && runningAppend.value === "继续处理",
    running_input_appends_ascii_printable:
      runningEmojiAppend.kind === "append"
      && runningEmojiAppend.value === "A",
    running_input_backspace:
      runningBackspace.kind === "backspace",
    running_input_enter_submits_queue:
      runningSubmit.kind === "submit_queue",
    running_input_esc_interrupts:
      runningEscInterrupt.kind === "interrupt",
    running_input_ctrl_c_interrupts:
      runningCtrlCInterrupt.kind === "interrupt",
    running_input_ignores_other_control:
      runningControlIgnored.kind === "none",
    running_input_coalesced_text_enter_submits_queue:
      runningCoalescedSubmit.length === 2
      && runningCoalescedSubmit[0]?.kind === "append"
      && runningCoalescedSubmit[0]?.value === "继续处理"
      && runningCoalescedSubmit[1]?.kind === "submit_queue",
    running_input_draft_can_seed_next_prompt:
      draftCarryState.graphemes.join("") === "未提交草稿"
      && draftCarryState.cursor === draftCarryState.graphemes.length,
  };
}
