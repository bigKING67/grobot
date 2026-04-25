import {
  decodeMenuInput,
  hasMenuDigitsContinuation,
  isHistorySearchShortcut,
  resolveCoalescedSubmitChunk,
  resolveDraftAwareFooterLines,
  resolveFirstMenuPrefixMatchIndex,
  resolveInputShortcutAction,
  resolveInteractiveInputBodyWidth,
  renderInteractiveInputChromeLines,
  resolveInteractiveEnterDataAction,
  resolveInteractiveInputCursorColumn,
  resolveMenuSearchMatchedIndices,
  resolveMenuIndexFromDigits,
  resolveSlashSuggestionApplyResult,
  resolveSlashSuggestionKeyAction,
  resolveShortcutOverlayKeyAction,
  resolveTerminalSelectMenuViewport,
  shouldHighlightSlashInputToken,
  resolveSubmitKeyAction,
} from "../../orchestration/entrypoints/dev-cli/start/run-start-io";
import { formatSlashSuggestionPanel } from "../../orchestration/entrypoints/dev-cli/ui/interactive/slash-overlay";
import { measureDisplayWidth } from "../../orchestration/entrypoints/dev-cli/ui/interactive/display-width";

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

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
  const menuSearchMatches = resolveMenuSearchMatchedIndices("legacy session", [
    {
      id: "main",
      label: "Main Session",
      description: "current context",
      current: true,
    },
    {
      id: "session_legacy",
      label: "Legacy-Session",
      description: "historical context",
    },
    {
      id: "archive",
      label: "Archive",
      description: "created 2026-04-24",
    },
  ]);
  const menuSearchDigitMatches = resolveMenuSearchMatchedIndices("20260424", [
    {
      id: "main",
      label: "Main Session",
      description: "current context",
      current: true,
    },
    {
      id: "session_legacy",
      label: "Legacy-Session",
      description: "historical context",
    },
    {
      id: "archive",
      label: "Archive",
      description: "created 2026-04-24",
    },
  ]);
  const menuSearchEmptyMatches = resolveMenuSearchMatchedIndices("", [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ]);

  const slashMenu = resolveSlashSuggestionApplyResult("/model");
  const slashCommandsMenu = resolveSlashSuggestionApplyResult("/commands");
  const slashPlanMenu = resolveSlashSuggestionApplyResult("/plan");
  const slashSkillCreatorMenu = resolveSlashSuggestionApplyResult("/skill-creator");
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
  const slashOverlayScrolled = formatSlashSuggestionPanel(
    [
      { command: "/sessions", description: "Open session picker" },
      { command: "/resume", description: "Resume a previous session" },
      { command: "/rewind", description: "Rewind to a checkpoint" },
      { command: "/commands", description: "Browse command menu" },
      { command: "/skill-creator", description: "Create a skill" },
      { command: "/init", description: "Initialize project instructions" },
      { command: "/context", description: "Inspect context state" },
      { command: "/memory", description: "Open memory tools" },
      { command: "/model", description: "Switch model" },
      { command: "/help", description: "Show help" },
    ],
    "/",
    8,
    96,
  );
  const slashOverlayScrolledLines = slashOverlayScrolled
    .split("\n")
    .filter((line) => line.length > 0);
  const slashOverlayScrolledModelLine =
    slashOverlayScrolledLines.find((line) => line.includes("/model")) ?? "";
  const slashOverlayScrolledSessionsLine =
    slashOverlayScrolledLines.find((line) => line.includes("/sessions")) ?? "";
  const slashOverlayScrolledFirstLinePlain = stripAnsi(slashOverlayScrolledLines[0] ?? "");
  const slashOverlayDownMarker = formatSlashSuggestionPanel(
    [
      { command: "/one", description: "one" },
      { command: "/two", description: "two" },
      { command: "/three", description: "three" },
      { command: "/four", description: "four" },
      { command: "/five", description: "five" },
      { command: "/six", description: "six" },
      { command: "/seven", description: "seven" },
      { command: "/eight", description: "eight" },
      { command: "/nine", description: "nine" },
      { command: "/ten", description: "ten" },
    ],
    "/",
    1,
    96,
  );
  const slashOverlayDownMarkerLines = slashOverlayDownMarker
    .split("\n")
    .filter((line) => line.length > 0);
  const slashOverlayDownMarkerLastLinePlain =
    stripAnsi(slashOverlayDownMarkerLines[slashOverlayDownMarkerLines.length - 1] ?? "");
  const slashOverlayNarrow = formatSlashSuggestionPanel(
    [
      { command: "/model", description: "Open interactive model picker" },
      { command: "/commands", description: "Manage user-defined slash commands" },
    ],
    "/",
    0,
    52,
  );
  const slashOverlayNarrowLines = slashOverlayNarrow
    .split("\n")
    .filter((line) => line.length > 0);
  const slashOverlayCentered = formatSlashSuggestionPanel(
    [
      { command: "/one", description: "one" },
      { command: "/two", description: "two" },
      { command: "/three", description: "three" },
      { command: "/four", description: "four" },
      { command: "/five", description: "five" },
      { command: "/six", description: "six" },
      { command: "/seven", description: "seven" },
      { command: "/eight", description: "eight" },
      { command: "/nine", description: "nine" },
      { command: "/ten", description: "ten" },
      { command: "/eleven", description: "eleven" },
      { command: "/twelve", description: "twelve" },
    ],
    "/",
    6,
    96,
  );
  const slashOverlayCenteredLines = slashOverlayCentered
    .split("\n")
    .filter((line) => line.length > 0);
  const slashOverlayCenteredSelectedRow = slashOverlayCenteredLines.findIndex((line) =>
    line.includes("/seven"),
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
  const slashInputWithArgsHighlight = shouldHighlightSlashInputToken({
    activeLineInput: "/plan 帮我写一份抖音直播规划",
    suggestions: [{ command: "/plan", description: "Enter plan mode" }],
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
  const draftFooterLines = resolveDraftAwareFooterLines({
    footerLines: ["? for shortcuts · grobot · ctx 42%"],
    inputGraphemeLength: 3,
  });
  const styledDraftFooterLines = resolveDraftAwareFooterLines({
    footerLines: ["\u001B[90m\u001B[96m? for shortcuts\u001B[0m\u001B[90m · grobot · ctx 42%\u001B[0m"],
    inputGraphemeLength: 3,
  });
  const emptyFooterLines = resolveDraftAwareFooterLines({
    footerLines: ["? for shortcuts · grobot · ctx 42%"],
    inputGraphemeLength: 0,
  });
  const draftHintOnlyFooterLines = resolveDraftAwareFooterLines({
    footerLines: ["? for shortcuts"],
    inputGraphemeLength: 1,
  });
  const inputChromeLines = renderInteractiveInputChromeLines({
    bodyLines: ["❯ hello"],
    inputBodyWidth: 20,
  });
  const inputChromeTopLinePlain = stripAnsi(inputChromeLines[0] ?? "");
  const inputChromeBodyLine = inputChromeLines[1] ?? "";
  const inputChromeBodyLinePlain = stripAnsi(inputChromeBodyLine);
  const inputChromeBottomLinePlain = stripAnsi(inputChromeLines[2] ?? "");
  const inputChromeLeftPadding =
    inputChromeBodyLinePlain.match(/^ */)?.[0]?.length ?? 0;
  const inputChromeTopWidth = measureDisplayWidth(inputChromeTopLinePlain);
  const inputChromeBodyWidth = measureDisplayWidth(inputChromeBodyLinePlain);
  const inputChromeBottomWidth = measureDisplayWidth(inputChromeBottomLinePlain);
  const inputChromeCursorColumn = resolveInteractiveInputCursorColumn({
    promptRelativeCursorColumn: 4,
  });
  const inputChromeFullTerminalWidth = resolveInteractiveInputBodyWidth({
    terminalColumns: 80,
    promptLabelWidth: 2,
  });
  const inputChromeSmallTerminalWidth = resolveInteractiveInputBodyWidth({
    terminalColumns: 8,
    promptLabelWidth: 4,
  });
  const initialMenuViewport = resolveTerminalSelectMenuViewport({
    itemsLength: 12,
    activeIndex: 8,
    visibleOptionCount: 5,
  });
  const nextMenuViewport = resolveTerminalSelectMenuViewport({
    itemsLength: 12,
    activeIndex: 9,
    visibleOptionCount: 5,
    previousStartIndex: initialMenuViewport.startIndex,
  });
  const previousMenuViewport = resolveTerminalSelectMenuViewport({
    itemsLength: 12,
    activeIndex: 4,
    visibleOptionCount: 5,
    previousStartIndex: nextMenuViewport.startIndex,
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
    menu_search_compact_prefers_relevant_item:
      menuSearchMatches.length > 0 && menuSearchMatches[0] === 1,
    menu_search_digits_match_timestamp_description:
      menuSearchDigitMatches.length > 0 && menuSearchDigitMatches[0] === 2,
    menu_search_empty_returns_all:
      menuSearchEmptyMatches.length === 2
      && menuSearchEmptyMatches[0] === 0
      && menuSearchEmptyMatches[1] === 1,
    slash_apply_menu_command:
      slashMenu.command === "/model" && slashMenu.submitImmediately,
    slash_apply_commands_menu_submit:
      slashCommandsMenu.command === "/commands" && slashCommandsMenu.submitImmediately,
    slash_apply_plan_submit:
      slashPlanMenu.command === "/plan" && slashPlanMenu.submitImmediately,
    slash_apply_skill_creator_requires_input:
      slashSkillCreatorMenu.command === "/skill-creator" && slashSkillCreatorMenu.submitImmediately,
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
    slash_overlay_scroll_window_keeps_selected_visible:
      slashOverlayScrolled.includes("/model"),
    slash_overlay_scroll_window_highlights_selected:
      slashOverlayScrolledModelLine.includes("\u001B[96m/model"),
    slash_overlay_scroll_window_uses_restraint_not_bold:
      !slashOverlayScrolledModelLine.includes("\u001B[1m\u001B[96m/model"),
    slash_overlay_selected_has_pointer:
      stripAnsi(slashOverlayScrolledModelLine).startsWith("› /model"),
    slash_overlay_scroll_window_does_not_wrap_to_first:
      slashOverlayScrolledSessionsLine.length === 0,
    slash_overlay_scroll_window_has_no_row_up_marker:
      !slashOverlayScrolledFirstLinePlain.startsWith("↑ "),
    slash_overlay_scroll_window_has_no_row_down_marker:
      !slashOverlayDownMarkerLastLinePlain.startsWith("↓ "),
    slash_overlay_scroll_window_keeps_compact_height:
      slashOverlayScrolledLines.length === 5,
    slash_overlay_scroll_window_centers_selected_when_possible:
      slashOverlayCenteredSelectedRow >= 2 && slashOverlayCenteredSelectedRow <= 5,
    slash_overlay_narrow_hides_description:
      !stripAnsi(slashOverlayNarrow).includes("Open interactive model picker"),
    slash_overlay_narrow_lines_within_width:
      slashOverlayNarrowLines.every((line) => measureDisplayWidth(line) <= 52),
    slash_overlay_hidden_when_has_args:
      slashOverlayWithArgs.length === 0,
    slash_input_partial_not_highlighted:
      !slashInputPartialHighlight,
    slash_input_exact_highlighted:
      slashInputExactHighlight,
    slash_input_with_args_highlighted:
      slashInputWithArgsHighlight,
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
    footer_draft_hides_shortcut_hint:
      draftFooterLines.length === 1
      && draftFooterLines[0] === "grobot · ctx 42%",
    footer_draft_hides_styled_shortcut_hint:
      styledDraftFooterLines.length === 1
      && styledDraftFooterLines[0] === "grobot · ctx 42%",
    footer_empty_keeps_shortcut_hint:
      emptyFooterLines.length === 1
      && emptyFooterLines[0]?.startsWith("? for shortcuts") === true,
    footer_draft_removes_hint_only_line:
      draftHintOnlyFooterLines.length === 0,
    input_chrome_has_open_horizontal_rails:
      /^─+$/.test(inputChromeTopLinePlain)
      && /^─+$/.test(inputChromeBottomLinePlain),
    input_chrome_has_no_corner_caps:
      !/[╭╮╰╯]/.test(inputChromeTopLinePlain)
      && !/[╭╮╰╯]/.test(inputChromeBottomLinePlain),
    input_chrome_has_no_vertical_body_rails:
      !inputChromeBodyLine.includes("│"),
    input_chrome_prompt_uses_claude_chevron:
      inputChromeBodyLine.startsWith("❯"),
    input_chrome_prompt_avoids_thin_chevron:
      !inputChromeBodyLine.startsWith("›"),
    input_chrome_has_no_left_gutter:
      inputChromeLeftPadding === 0,
    input_chrome_border_tracks_body_width:
      inputChromeTopWidth === inputChromeBodyWidth
      && inputChromeBottomWidth === inputChromeTopWidth,
    input_chrome_cursor_column_matches_open_rails:
      inputChromeCursorColumn === 4,
    input_chrome_cursor_uses_left_padding:
      inputChromeCursorColumn === inputChromeLeftPadding + 4,
    input_chrome_uses_full_terminal_width:
      inputChromeFullTerminalWidth === 80,
    input_chrome_respects_prompt_minimum_width:
      inputChromeSmallTerminalWidth === 12,
    menu_viewport_keeps_active_visible:
      initialMenuViewport.startIndex > 0
      && initialMenuViewport.endIndex === 9
      && initialMenuViewport.activeIndex === 8,
    menu_viewport_scrolls_one_row_down:
      nextMenuViewport.startIndex === initialMenuViewport.startIndex + 1
      && nextMenuViewport.endIndex === 10,
    menu_viewport_scrolls_one_row_up:
      previousMenuViewport.startIndex === nextMenuViewport.startIndex - 1
      && previousMenuViewport.endIndex === 9,
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

void main();
