import {
  decodeMenuInput,
  hasMenuDigitsContinuation,
  isHistorySearchShortcut,
  resolveCoalescedSubmitChunk,
  resolveFirstMenuPrefixMatchIndex,
  resolveInputShortcutAction,
  resolveMenuIndexFromDigits,
  resolveSlashSuggestionApplyResult,
  resolveSlashSuggestionKeyAction,
  shouldHighlightSlashInputToken,
  resolveSubmitKeyAction,
} from "../../orchestration/entrypoints/dev-cli/start/run-start-io";
import { formatSlashSuggestionPanel } from "../../orchestration/entrypoints/dev-cli/ui/interactive/slash-overlay";

async function main(): Promise<void> {
  const menuItemsLength = 12;
  const enterAction = decodeMenuInput("\r", menuItemsLength);
  const lfEnterAction = decodeMenuInput("\n", menuItemsLength);
  const crlfEnterAction = decodeMenuInput("\r\n", menuItemsLength);
  const spaceAction = decodeMenuInput(" ", menuItemsLength);
  const ctrlPAction = decodeMenuInput("\u0010", menuItemsLength);
  const ctrlNAction = decodeMenuInput("\u000e", menuItemsLength);
  const escapeAction = decodeMenuInput("\u001b", menuItemsLength);
  const arrowUpAction = decodeMenuInput("\u001b[A", menuItemsLength);
  const arrowDownAction = decodeMenuInput("\u001b[B", menuItemsLength);
  const directIndexAction = decodeMenuInput("12", menuItemsLength);
  const directIndexCrlfAction = decodeMenuInput("2\r\n", menuItemsLength);

  const slashMenu = resolveSlashSuggestionApplyResult("/model");
  const slashCommandsMenu = resolveSlashSuggestionApplyResult("/commands");
  const slashPlanMenu = resolveSlashSuggestionApplyResult("/plan");
  const slashSkillCreatorMenu = resolveSlashSuggestionApplyResult("/skill-creator <需求>");
  const slashOverlayPartial = formatSlashSuggestionPanel(
    [{ command: "/exit", description: "Exit interactive mode" }],
    "/e",
    0,
    96,
  );
  const slashOverlayExact = formatSlashSuggestionPanel(
    [{ command: "/exit", description: "Exit interactive mode" }],
    "/exit",
    0,
    96,
  );
  const slashOverlayWithArgs = formatSlashSuggestionPanel(
    [{ command: "/plan", description: "Enter plan mode" }],
    "/plan 帮我写一份抖音直播规划",
    0,
    96,
  );
  const slashInputPartialHighlight = shouldHighlightSlashInputToken({
    activeLineInput: "/e",
    suggestions: [{ command: "/exit", description: "Exit interactive mode" }],
  });
  const slashInputExactHighlight = shouldHighlightSlashInputToken({
    activeLineInput: "/exit",
    suggestions: [{ command: "/exit", description: "Exit interactive mode" }],
  });

  const enterMenuAction = resolveSlashSuggestionKeyAction({
    key: "enter",
    hasActiveSuggestions: true,
    selectedCommand: "/model",
    activeLineInput: "/mo",
  });
  const enterPlanGoalAction = resolveSlashSuggestionKeyAction({
    key: "enter",
    hasActiveSuggestions: true,
    selectedCommand: "/plan",
    activeLineInput: "/plan 我要一份抖音直播间规划",
  });
  const tabCommandsNewAction = resolveSlashSuggestionKeyAction({
    key: "tab",
    hasActiveSuggestions: true,
    selectedCommand: "/commands",
    activeLineInput: "/co",
  });
  const tabPlanGoalAction = resolveSlashSuggestionKeyAction({
    key: "tab",
    hasActiveSuggestions: true,
    selectedCommand: "/plan",
    activeLineInput: "/plan 我要一份抖音直播间规划",
  });
  const escapeActionForSlash = resolveSlashSuggestionKeyAction({
    key: "escape",
    hasActiveSuggestions: true,
    selectedCommand: "/model",
    activeLineInput: "/model",
  });
  const noopAction = resolveSlashSuggestionKeyAction({
    key: "enter",
    hasActiveSuggestions: false,
    selectedCommand: "/model",
  });

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
  const coalescedWithBackslash = resolveCoalescedSubmitChunk("\\\r");
  const coalescedEscapeSequence = resolveCoalescedSubmitChunk("\u001b\r");
  const submitChunkOnlyLf = resolveSubmitKeyAction({
    chunk: "\n",
    key: {},
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

  const payload = {
    menu_enter_is_confirm: enterAction.kind === "enter",
    menu_lf_is_confirm: lfEnterAction.kind === "enter",
    menu_crlf_is_confirm: crlfEnterAction.kind === "enter",
    menu_space_is_confirm: spaceAction.kind === "enter",
    menu_ctrl_p_is_up: ctrlPAction.kind === "up",
    menu_ctrl_n_is_down: ctrlNAction.kind === "down",
    menu_escape_is_cancel: escapeAction.kind === "cancel",
    menu_arrow_up_is_up: arrowUpAction.kind === "up",
    menu_arrow_down_is_down: arrowDownAction.kind === "down",
    menu_multi_digits_direct_index:
      directIndexAction.kind === "select_index" && directIndexAction.index === 11,
    menu_digit_coalesced_crlf_direct_index:
      directIndexCrlfAction.kind === "select_index" && directIndexCrlfAction.index === 1,
    menu_digit_prefix_has_continuation:
      hasMenuDigitsContinuation("1", menuItemsLength),
    menu_digit_suffix_no_continuation:
      !hasMenuDigitsContinuation("12", menuItemsLength),
    menu_digit_prefix_first_match_index:
      resolveFirstMenuPrefixMatchIndex("1", menuItemsLength) === 0,
    menu_digits_to_index_10:
      resolveMenuIndexFromDigits("10", menuItemsLength) === 9,
    menu_digits_reject_leading_zero:
      typeof resolveMenuIndexFromDigits("01", menuItemsLength) === "undefined",
    slash_apply_menu_command:
      slashMenu.command === "/model" && slashMenu.submitImmediately,
    slash_apply_commands_menu_submit:
      slashCommandsMenu.command === "/commands" && slashCommandsMenu.submitImmediately,
    slash_apply_plan_menu_submit:
      slashPlanMenu.command === "/plan" && slashPlanMenu.submitImmediately,
    slash_apply_skill_creator_requires_input:
      slashSkillCreatorMenu.command === "/skill-creator " && !slashSkillCreatorMenu.submitImmediately,
    slash_key_enter_applies_and_submits:
      enterMenuAction.kind === "apply"
      && enterMenuAction.appliedCommand === "/model"
      && enterMenuAction.submitImmediately,
    slash_key_tab_applies_without_submit:
      tabCommandsNewAction.kind === "apply"
      && tabCommandsNewAction.appliedCommand === "/commands"
      && !tabCommandsNewAction.submitImmediately,
    slash_key_enter_with_args_keeps_user_input:
      enterPlanGoalAction.kind === "noop",
    slash_key_tab_with_args_keeps_user_input:
      tabPlanGoalAction.kind === "noop",
    slash_key_escape_hides_panel:
      escapeActionForSlash.kind === "hide_panel"
      && escapeActionForSlash.hiddenLineInput === "/model",
    slash_key_no_suggestions_noop:
      noopAction.kind === "noop",
    slash_overlay_partial_selected_highlighted:
      slashOverlayPartial.includes("\u001B[96m"),
    slash_overlay_exact_selected_highlighted:
      slashOverlayExact.includes("\u001B[96m"),
    slash_overlay_hidden_when_has_args:
      slashOverlayWithArgs.length === 0,
    slash_input_partial_not_highlighted:
      !slashInputPartialHighlight,
    slash_input_exact_highlighted:
      slashInputExactHighlight,
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
    submit_coalesced_backslash_ignored:
      !coalescedWithBackslash.shouldSubmit
      && coalescedWithBackslash.normalizedChunk === "\\\r",
    submit_coalesced_escape_ignored:
      !coalescedEscapeSequence.shouldSubmit
      && coalescedEscapeSequence.normalizedChunk === "\u001b\r",
    submit_chunk_only_lf_detected: submitChunkOnlyLf === "submit",
    shortcut_history_ctrl_r_detected: historyShortcutCtrlR,
    shortcut_history_raw_ctrl_r_detected: historyShortcutRawCtrlR,
    shortcut_ctrl_c_sigint: shortcutCtrlC === "sigint",
    shortcut_ctrl_r_history_search: shortcutCtrlR === "history_search",
    shortcut_non_matching_none: shortcutOther === "none",
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

void main();
