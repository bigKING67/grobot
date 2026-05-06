import { createCliUiRenderer } from "../../cli/tui/kernel/renderer";
import { measureDisplayWidth } from "../../cli/tui/terminal/display-width";
import {
  askUserMenuInput,
  compactVerticalMenuInput,
  directLargeMenuInput,
  directLargeModelPickerInput,
  emptyFilteredMenuInput,
  emptyPlanApprovalMenuInput,
  expandedMenuInput,
  filteredMenuInput,
  filteredModelPickerInput,
  highlightedFilteredMenuInput,
  highlightedFilteredModelPickerInput,
  hideIndexInlineMenuInput,
  longMenuInput,
  longModelPickerInput,
  menuInput,
  modelPickerInput,
  planApprovalMenuInput,
  startupBrandSymbolViewModel,
  startupViewModel,
  unsafeDefaultMenuInput,
  viewportMenuInput,
} from "./cli-ui-renderer-contract/fixtures";
import {
  extractRightPanelSegment,
  extractStartupBodyLines,
  hasAnsi,
  renderedLinesWithinColumns,
  renderedMenuRows,
  renderSelectAtColumns,
  renderStartupAtColumns,
  stripAnsi,
} from "./cli-ui-renderer-contract/render-utils";

const interactiveRenderer = createCliUiRenderer({
  stdinIsTTY: true,
  stdoutIsTTY: true,
  env: {
    TERM: "xterm-256color",
  },
});
const plainRenderer = createCliUiRenderer({
  stdinIsTTY: true,
  stdoutIsTTY: true,
  env: {
    TERM: "dumb",
  },
});
const nonTtyRenderer = createCliUiRenderer({
  stdinIsTTY: false,
  stdoutIsTTY: false,
  env: {
    TERM: "xterm-256color",
  },
});

const startupInteractive = interactiveRenderer.renderStartupScreen(startupViewModel);
const startupVariants = [96, 110, 120].map((columns) =>
  renderStartupAtColumns(interactiveRenderer, startupViewModel, columns)
);
const startupVariantBodies = startupVariants.map((rendered) => extractStartupBodyLines(rendered));
const startupNoJoinArtifact = startupVariants.every((rendered) => {
  const plain = stripAnsi(rendered);
  return plain.includes("┤ │") === false;
});
const startupNoTeeGlyph = startupVariantBodies.every((lines) =>
  lines.every((line) => line.includes("├") === false && line.includes("┤") === false)
);
const startupLinesWithinTerminal = startupVariants.every((rendered, index) =>
  renderedLinesWithinColumns(rendered, [96, 110, 120][index] ?? 120)
);
const startupHasNoOuterRoundFrame = startupVariants.every((rendered) => {
  const plain = stripAnsi(rendered);
  return !plain.includes("╭")
    && !plain.includes("╰")
    && plain.split("\n").every((line) =>
      !line.startsWith("│ ") && !line.endsWith(" │")
    );
});
const startupDividerCountExpected = startupVariantBodies.every((lines) => {
  const dividerCount = lines.filter((line) => {
    const rightPanelSegment = extractRightPanelSegment(line);
    return typeof rightPanelSegment === "string" && /^─+$/.test(rightPanelSegment);
  }).length;
  return dividerCount === 1;
});
const startupBrandSymbolVariants = [96, 110, 120].map((columns) =>
  renderStartupAtColumns(interactiveRenderer, startupBrandSymbolViewModel, columns)
);
const startupBrandSymbolInteractive = startupBrandSymbolVariants[1] ?? "";
const startupBrandSymbolBodies = startupBrandSymbolVariants.map((rendered) =>
  extractStartupBodyLines(rendered)
);
const startupBrandSymbolLinesWithinTerminal = startupBrandSymbolVariants.every((rendered, index) =>
  renderedLinesWithinColumns(rendered, [96, 110, 120][index] ?? 120)
);
const startupBrandSymbolHasClaudeLikeHeight = startupBrandSymbolBodies.every((lines) =>
  lines.length >= 8
);
const startupRegisteredSymbolSingleWidth = measureDisplayWidth("®") === 1;
const menuInteractive = interactiveRenderer.renderSelectMenu(menuInput, 0);
const menuPlain = plainRenderer.renderSelectMenu(menuInput, 0);
const menuNonTty = nonTtyRenderer.renderSelectMenu(menuInput, 0);
const filteredMenuInteractive = interactiveRenderer.renderSelectMenu(filteredMenuInput, 0);
const filteredMenuPlainText = stripAnsi(plainRenderer.renderSelectMenu(filteredMenuInput, 0));
const highlightedFilteredMenuInteractive = interactiveRenderer.renderSelectMenu(highlightedFilteredMenuInput, 0);
const highlightedFilteredMenuPlainText = stripAnsi(plainRenderer.renderSelectMenu(highlightedFilteredMenuInput, 0));
const emptyFilteredMenuInteractive = interactiveRenderer.renderSelectMenu(emptyFilteredMenuInput, 0);
const emptyFilteredMenuPlainText = stripAnsi(plainRenderer.renderSelectMenu(emptyFilteredMenuInput, 0));
const modelPickerInteractive = interactiveRenderer.renderSelectMenu(modelPickerInput, 0);
const modelPickerPlain = plainRenderer.renderSelectMenu(modelPickerInput, 0);
const filteredModelPickerPlainText = stripAnsi(plainRenderer.renderSelectMenu(filteredModelPickerInput, 0));
const highlightedFilteredModelPickerInteractive = interactiveRenderer.renderSelectMenu(highlightedFilteredModelPickerInput, 0);
const highlightedFilteredModelPickerPlainText = stripAnsi(plainRenderer.renderSelectMenu(highlightedFilteredModelPickerInput, 0));
const askUserMenuInteractive = interactiveRenderer.renderSelectMenu(askUserMenuInput, 0);
const askUserMenuPlain = plainRenderer.renderSelectMenu(askUserMenuInput, 0);
const planApprovalMenuInteractive = interactiveRenderer.renderSelectMenu(planApprovalMenuInput, 0);
const planApprovalMenuPlain = plainRenderer.renderSelectMenu(planApprovalMenuInput, 0);
const planApprovalKeepPlanningPlain = plainRenderer.renderSelectMenu(planApprovalMenuInput, 1);
const emptyPlanApprovalPlain = plainRenderer.renderSelectMenu(emptyPlanApprovalMenuInput, 0);
const emptyPlanApprovalPlainText = stripAnsi(emptyPlanApprovalPlain);
const planApprovalDraftFeedbackPlain = plainRenderer.renderSelectMenu({
  ...planApprovalMenuInput,
  items: planApprovalMenuInput.items.map((item) =>
    item.id === "keep_planning"
      ? {
        ...item,
        input: {
          ...(item.input ?? {}),
          initialValue: "tighten validation",
        },
      }
      : item
  ),
}, 1);
const planApprovalEditedPlain = plainRenderer.renderSelectMenu({
  ...planApprovalMenuInput,
  planApprovalMeta: {
    ...(planApprovalMenuInput.planApprovalMeta ?? {
      planContent: "",
    }),
    planEdited: true,
  },
}, 0);
const planApprovalMenuPlainText = stripAnsi(planApprovalMenuPlain);
const planApprovalMenuPlainLines = planApprovalMenuPlainText.split("\n");
const planApprovalDividerRows = planApprovalMenuPlainLines.filter((line) =>
  /^┄+$/.test(line.trim())
);
const viewportMenuPlain = plainRenderer.renderSelectMenu(viewportMenuInput, 1);
const directLargeMenuPlain = plainRenderer.renderSelectMenu(directLargeMenuInput, 0);
const directLargeModelPickerPlain = plainRenderer.renderSelectMenu(directLargeModelPickerInput, 0);
const longModelPickerPlain = renderSelectAtColumns(plainRenderer, longModelPickerInput, 0, 72);
const narrowModelPickerPlain = renderSelectAtColumns(plainRenderer, longModelPickerInput, 0, 52);
const longMenuPlain = renderSelectAtColumns(plainRenderer, longMenuInput, 0, 72);
const hideIndexInlineMenuPlain = plainRenderer.renderSelectMenu(hideIndexInlineMenuInput, 0);
const compactVerticalMenuPlain = plainRenderer.renderSelectMenu(compactVerticalMenuInput, 0);
const expandedMenuPlain = plainRenderer.renderSelectMenu(expandedMenuInput, 0);
const unsafeDefaultMenuPlain = plainRenderer.renderSelectMenu(unsafeDefaultMenuInput, 0);
const unsafeDefaultMenuPlainText = stripAnsi(unsafeDefaultMenuPlain);

const payload = {
  interactive_mode: interactiveRenderer.mode,
  plain_mode: plainRenderer.mode,
  non_tty_mode: nonTtyRenderer.mode,
  startup_has_title: startupInteractive.includes("Grobot v0.1.0"),
  startup_has_brand_label: startupInteractive.includes("Grobot"),
  startup_has_logo_headline: startupInteractive.includes("Grobot CLI v0.1.0"),
  startup_has_logo_runtime_line: startupInteractive.includes("alpha/model · 200k ctx budget · API Usage"),
  startup_has_session_line: startupInteractive.includes("session_id:session-main"),
  startup_has_no_command_hint:
    !startupInteractive.includes("Enter message")
    && !startupInteractive.includes("/ for commands")
    && !startupInteractive.includes("? for shortcuts"),
  startup_has_tips_title: startupInteractive.includes("Get started"),
  startup_has_recent_activity_title: startupInteractive.includes("Recent activity"),
  startup_has_recent_activity_empty_or_items:
    startupInteractive.includes("No recent activity")
    || startupInteractive.includes("2h ago  Session planning update"),
  startup_has_developed_by_67:
    stripAnsi(startupBrandSymbolInteractive).includes("Grobot 0.1.0 developed by 67"),
  startup_has_no_dev_label:
    !/\bdev\b/i.test(stripAnsi(startupBrandSymbolInteractive)),
  startup_interactive_title_has_brand_color:
    startupBrandSymbolInteractive.includes("\x1b[38;2;202;124;94mGrobot\x1b[0m"),
  startup_interactive_title_has_muted_version_color:
    startupBrandSymbolInteractive.includes("\x1b[90m 0.1.0 developed by 67\x1b[0m"),
  startup_feed_title_uses_brand_color:
    startupBrandSymbolInteractive.includes("\x1b[38;2;202;124;94mGet started"),
  startup_feed_title_avoids_accent_color:
    !startupBrandSymbolInteractive.includes("\x1b[92mGet started"),
  startup_feed_footer_uses_muted_color:
    startupBrandSymbolInteractive.includes("\x1b[90m/sessions for more"),
  startup_feed_footer_avoids_info_color:
    !startupBrandSymbolInteractive.includes("\x1b[96m/sessions for more"),
  startup_has_no_join_artifact: startupNoJoinArtifact,
  startup_has_no_tee_glyph: startupNoTeeGlyph,
  startup_has_no_outer_round_frame: startupHasNoOuterRoundFrame,
  startup_lines_within_terminal: startupLinesWithinTerminal,
  startup_feed_divider_count_expected: startupDividerCountExpected,
  startup_brand_symbol_lines_within_terminal: startupBrandSymbolLinesWithinTerminal,
  startup_brand_symbol_has_claude_like_height: startupBrandSymbolHasClaudeLikeHeight,
  startup_registered_symbol_single_width: startupRegisteredSymbolSingleWidth,
  menu_interactive_has_ansi: hasAnsi(menuInteractive),
  menu_plain_has_ansi: hasAnsi(menuPlain),
  menu_non_tty_has_ansi: hasAnsi(menuNonTty),
  menu_plain_has_pointer: menuPlain.includes("❯"),
  menu_plain_has_no_thin_pointer: !menuPlain.includes("›"),
  menu_interactive_has_current_check: menuInteractive.includes("✓"),
  menu_plain_has_secondary_description: menuPlain.includes("Current active model"),
  menu_hint_is_compact: menuPlain.includes("·"),
  menu_hint_has_escape_back: menuPlain.includes("Esc back"),
  menu_hint_has_enter_action: menuPlain.includes("Enter confirm"),
  menu_hint_has_navigation_hint: menuPlain.includes("↑/↓ select"),
  menu_hint_omits_secondary_key_chords:
    !menuPlain.includes("j/k")
    && !menuPlain.includes("Ctrl+n/p")
    && !menuPlain.includes("1-9 jump")
    && !menuPlain.includes("Enter/Space"),
  menu_viewport_has_full_ordinal:
    stripAnsi(viewportMenuPlain).includes("8.")
    && stripAnsi(viewportMenuPlain).includes("9.")
    && stripAnsi(viewportMenuPlain).includes("10."),
  menu_viewport_hides_reset_ordinal:
    !stripAnsi(viewportMenuPlain).includes("1. /context"),
  menu_viewport_has_scroll_markers:
    renderedMenuRows(viewportMenuPlain).some((line) => line.trimStart().startsWith("↑"))
    && renderedMenuRows(viewportMenuPlain).some((line) => line.trimStart().startsWith("↓")),
  menu_viewport_has_no_more_text:
    !stripAnsi(viewportMenuPlain).toLowerCase().includes("more"),
  menu_direct_render_uses_default_visible_count:
    stripAnsi(directLargeMenuPlain).includes("5.")
    && !stripAnsi(directLargeMenuPlain).includes("6."),
  menu_direct_render_has_row_scroll_marker:
    renderedMenuRows(directLargeMenuPlain).some((line) => line.trimStart().startsWith("↓")),
  menu_filter_has_compact_status_row:
    filteredMenuPlainText.includes("Filter: mod  matched 1/4"),
  menu_filter_status_not_in_subtitle:
    filteredMenuPlainText.includes("Command palette")
    && !filteredMenuPlainText.includes("Command palette · Filter"),
  menu_filter_footer_is_compact:
    filteredMenuPlainText.includes("Type to filter · Ctrl-U clear · Esc back")
    && !filteredMenuPlainText.includes("Ctrl+f or / toggle filter"),
  menu_filter_has_no_match_row:
    emptyFilteredMenuPlainText.includes('No matches for "zzz"'),
  menu_filter_no_match_row_is_muted:
    emptyFilteredMenuInteractive.includes('\x1b[90mNo matches for "zzz"\x1b[0m'),
  menu_filter_status_is_muted:
    filteredMenuInteractive.includes("\x1b[90mFilter: mod  matched 1/4\x1b[0m"),
  menu_filter_highlights_label_match:
    highlightedFilteredMenuInteractive.includes("\x1b[38;2;202;124;94m\x1b[1mmod\x1b[0m\x1b[0m"),
  menu_filter_highlight_keeps_plain_text_copy:
    highlightedFilteredMenuPlainText.includes("/model routes ✓"),
  menu_filter_highlight_keeps_current_suffix:
    highlightedFilteredMenuInteractive.includes("\x1b[38;2;202;124;94m ✓\x1b[0m"),
  model_picker_has_claude_pointer: stripAnsi(modelPickerPlain).includes("❯"),
  model_picker_has_no_thin_pointer: !stripAnsi(modelPickerPlain).includes("›"),
  model_picker_has_pane_divider:
    /^─+$/.test(stripAnsi(modelPickerPlain).split("\n").find((line) =>
      line.trim().length > 0
    ) ?? ""),
  model_picker_interactive_uses_warm_brand_color:
    modelPickerInteractive.includes("\x1b[38;2;202;124;94m")
    && !modelPickerInteractive.includes("\x1b[38;2;166;170;255m"),
  model_picker_has_decimal_index: stripAnsi(modelPickerPlain).includes("1."),
  model_picker_has_no_bracket_index: !stripAnsi(modelPickerPlain).includes("[1]"),
  model_picker_current_uses_check: stripAnsi(modelPickerPlain).includes("model-a ✓"),
  model_picker_current_not_parenthesized: !stripAnsi(modelPickerPlain).includes("(current)"),
  model_picker_has_default_suffix: stripAnsi(modelPickerPlain).includes("model-b (default)"),
  model_picker_has_footer_hint: stripAnsi(modelPickerPlain).includes("Enter confirm · Esc exit"),
  model_picker_has_config_scope_subtitle:
    stripAnsi(modelPickerPlain).includes("Switch the configured model for future sessions"),
  model_picker_has_effort_line:
    stripAnsi(modelPickerPlain).includes("● High effort (default)")
    && stripAnsi(modelPickerPlain).includes("← → to adjust"),
  model_picker_avoids_stale_session_only_copy:
    !stripAnsi(modelPickerPlain).includes("Switch the current session model"),
  model_picker_has_config_scope_context:
    stripAnsi(modelPickerPlain).includes("provider alpha · 2 models · writes current config"),
  model_picker_active_description_is_muted:
    modelPickerInteractive.includes("\x1b[90mCurrent active model\x1b[0m")
    && !modelPickerInteractive.includes("\x1b[38;2;202;124;94mCurrent active model"),
  model_picker_has_no_provider_card: !stripAnsi(modelPickerPlain).includes("Provider"),
  model_picker_has_no_startup_badge: !stripAnsi(modelPickerPlain).includes("STARTUP"),
  model_picker_has_no_current_badge: !stripAnsi(modelPickerPlain).includes("CURRENT"),
  model_picker_has_no_reset_badge: !stripAnsi(modelPickerPlain).includes("RESET"),
  model_picker_has_no_frame: !stripAnsi(modelPickerPlain).includes("╭"),
  model_picker_interactive_has_no_current_badge: !modelPickerInteractive.includes("CURRENT"),
  model_picker_filter_preserves_pane_divider:
    /^─+$/.test(filteredModelPickerPlainText.split("\n").find((line) =>
      line.trim().length > 0
    ) ?? ""),
  model_picker_filter_has_compact_status_row:
    filteredModelPickerPlainText.includes("Filter: model-a  matched 1/2"),
  model_picker_filter_hides_original_hidden_count:
    !filteredModelPickerPlainText.includes("and 1 more..."),
  model_picker_filter_highlights_label_match:
    highlightedFilteredModelPickerInteractive.includes("\x1b[38;2;202;124;94m\x1b[1mmodel\x1b[0m\x1b[0m"),
  model_picker_filter_highlight_keeps_default_suffix:
    highlightedFilteredModelPickerPlainText.includes("model-b (default)")
    && highlightedFilteredModelPickerInteractive.includes("\x1b[90m (default)\x1b[0m"),
  ask_user_menu_uses_panel_divider: /^─+$/.test(stripAnsi(askUserMenuPlain).split("\n")[0] ?? ""),
  ask_user_menu_uses_warm_brand_color:
    askUserMenuInteractive.includes("\x1b[38;2;202;124;94m"),
  ask_user_menu_has_progress_title:
    stripAnsi(askUserMenuPlain).includes("Confirmation needed · Scope · 1/2"),
  ask_user_menu_has_input_return_hint:
    stripAnsi(askUserMenuPlain).includes("Esc back to input"),
  ask_user_menu_preserves_option_descriptions:
    stripAnsi(askUserMenuPlain).includes("Run checks before continuing"),
  ask_user_menu_uses_claude_pointer:
    stripAnsi(askUserMenuPlain).includes("❯"),
  plan_approval_menu_has_ready_title:
    planApprovalMenuPlainText.includes("Ready to implement?"),
  plan_approval_menu_has_planning_path_header:
    planApprovalMenuPlainText.includes("Plan file .grobot/plans/demo/001-contract-plan.md")
    && planApprovalMenuPlainText.indexOf("Plan file .grobot/plans/demo/001-contract-plan.md")
      < planApprovalMenuPlainText.indexOf("Ready to implement?"),
  plan_approval_menu_title_is_not_plan_color_flooded:
    !planApprovalMenuInteractive.includes("\x1b[38;2;72;150;140m\x1b[1mReady to implement?"),
  plan_approval_menu_has_subtitle:
    planApprovalMenuPlainText.includes("Confirm the plan before execution."),
  plan_approval_menu_embeds_plan_markdown:
    planApprovalMenuPlainText.includes("# Contract Plan")
    && planApprovalMenuPlainText.includes("## Validation"),
  plan_approval_menu_separates_plan_actions_and_footer:
    planApprovalDividerRows.length >= 2,
  plan_approval_menu_has_reference_prompt:
    planApprovalMenuPlainText.includes("Start execution?"),
  plan_approval_menu_uses_sticky_footer_order:
    planApprovalMenuPlainText.indexOf("Start execution?")
      > planApprovalMenuPlainText.indexOf("## Validation")
    && planApprovalMenuPlainText.indexOf("Ctrl-G edit plan")
      > planApprovalMenuPlainText.indexOf("Refine plan"),
  plan_approval_menu_has_yes_no_options:
    planApprovalMenuPlainText.includes("❯ Confirm, implement plan")
    && planApprovalMenuPlainText.includes("Refine plan"),
  plan_approval_menu_has_ctrl_g_edit_hint:
    planApprovalMenuPlainText.includes("Ctrl-G edit plan · vim")
    && planApprovalMenuPlainText.includes(".grobot/plans/demo/001-contract-plan.md"),
  plan_approval_menu_shows_saved_after_external_edit:
    stripAnsi(planApprovalEditedPlain).includes("✓ Plan saved"),
  plan_approval_menu_shows_keep_planning_feedback_hint:
    stripAnsi(planApprovalKeepPlanningPlain).includes("Shift+Tab approves with feedback"),
  plan_approval_menu_shows_inline_feedback_input:
    stripAnsi(planApprovalKeepPlanningPlain).includes("Refine plan: Tell Grobot what to adjust"),
  plan_approval_menu_shows_inline_feedback_cursor:
    stripAnsi(planApprovalKeepPlanningPlain).includes("Tell Grobot what to adjust▌"),
  plan_approval_menu_preserves_feedback_after_reopen:
    stripAnsi(planApprovalDraftFeedbackPlain).includes("Refine plan: tighten validation▌"),
  plan_approval_menu_uses_plan_mode_color:
    planApprovalMenuInteractive.includes("\x1b[38;2;72;150;140m"),
  plan_approval_menu_has_no_default_thin_pointer:
    !planApprovalMenuPlainText.includes("›"),
  plan_approval_empty_uses_exit_title:
    emptyPlanApprovalPlainText.includes("Exit plan mode?"),
  plan_approval_empty_uses_reference_copy:
    emptyPlanApprovalPlainText.includes("Grobot will exit plan mode"),
  plan_approval_empty_has_yes_no_only:
    emptyPlanApprovalPlainText.includes("❯ Yes, exit")
    && emptyPlanApprovalPlainText.includes("  No, keep planning")
    && !emptyPlanApprovalPlainText.includes("Implement the plan")
    && !emptyPlanApprovalPlainText.includes("Confirm, implement plan"),
  plan_approval_empty_omits_plan_markdown:
    !emptyPlanApprovalPlainText.includes("Grobot's plan:")
    && !emptyPlanApprovalPlainText.includes("Plan not found.")
    && !emptyPlanApprovalPlainText.includes("Start execution?")
    && !emptyPlanApprovalPlainText.includes("ctrl-g to edit"),
  model_picker_direct_render_uses_model_visible_count:
    stripAnsi(directLargeModelPickerPlain).includes("10.")
    && !stripAnsi(directLargeModelPickerPlain).includes("11."),
  model_picker_direct_render_shows_hidden_count:
    stripAnsi(directLargeModelPickerPlain).includes("and 2 more..."),
  model_picker_direct_render_uses_reference_hidden_count:
    !stripAnsi(directLargeModelPickerPlain).includes("2 more models..."),
  model_picker_direct_render_shows_non_default_effort:
    stripAnsi(directLargeModelPickerPlain).includes("● High effort  ← → to adjust"),
  model_picker_direct_render_has_config_scope_context:
    stripAnsi(directLargeModelPickerPlain).includes("provider alpha · 12 models · writes current config"),
  model_picker_direct_render_has_row_scroll_marker:
    renderedMenuRows(directLargeModelPickerPlain).some((line) => line.trimStart().startsWith("↓")),
  model_picker_long_rows_within_width:
    renderedLinesWithinColumns(longModelPickerPlain, 72),
  model_picker_long_descriptions_do_not_wrap:
    !stripAnsi(longModelPickerPlain)
      .split("\n")
      .some((line) =>
        line.trimStart().startsWith("with long context notes")
        || line.trimStart().startsWith("routing metadata")
        || line.trimStart().startsWith("ng provider detail")
      ),
  model_picker_long_current_suffix_preserved:
    stripAnsi(longModelPickerPlain).includes("✓"),
  model_picker_long_default_suffix_preserved:
    stripAnsi(longModelPickerPlain).includes("(default)"),
  model_picker_long_effort_unsupported_line:
    stripAnsi(longModelPickerPlain).includes("○ Effort not supported for"),
  model_picker_narrow_rows_within_width:
    renderedLinesWithinColumns(narrowModelPickerPlain, 52),
  model_picker_narrow_hides_description:
    !stripAnsi(narrowModelPickerPlain).includes("Provider available"),
  menu_long_rows_within_width:
    renderedLinesWithinColumns(longMenuPlain, 72),
  menu_long_current_suffix_preserved:
    stripAnsi(longMenuPlain).includes("✓"),
  menu_hide_indexes_omits_numeric_indexes:
    !/\b1\.\s+Apply\b/.test(stripAnsi(hideIndexInlineMenuPlain))
    && !/\b2\.\s+Cancel\b/.test(stripAnsi(hideIndexInlineMenuPlain)),
  menu_hide_indexes_keeps_pointer:
    stripAnsi(hideIndexInlineMenuPlain).includes("❯ Apply Run the selected action"),
  menu_inline_descriptions_render_same_row:
    stripAnsi(hideIndexInlineMenuPlain).includes("Apply Run the selected action"),
  menu_compact_vertical_renders_description_below_label:
    stripAnsi(compactVerticalMenuPlain).includes("❯ 1. Apply changes\n     Review the plan"),
  menu_expanded_adds_blank_line_between_options:
    stripAnsi(expandedMenuPlain).includes("Run all verification before applying.\n\n  Fast path"),
  menu_default_sanitizes_render_text:
    unsafeDefaultMenuPlainText.includes("Select command")
    && unsafeDefaultMenuPlainText.includes("Command palette")
    && unsafeDefaultMenuPlainText.includes("/unsafe")
    && unsafeDefaultMenuPlainText.includes("Open hidden command")
    && unsafeDefaultMenuPlainText.includes("Enter confirm")
    && !unsafeDefaultMenuPlain.includes("\u001B[31m")
    && !unsafeDefaultMenuPlainText.includes("\u202E")
    && renderedLinesWithinColumns(unsafeDefaultMenuPlain, 80),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
