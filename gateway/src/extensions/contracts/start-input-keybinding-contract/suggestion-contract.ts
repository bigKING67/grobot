import {
  resolveSlashInputHighlightSuggestions,
  resolveSlashSuggestionApplyResult,
  resolveSlashSuggestionKeyAction,
  shouldHighlightSlashInputToken,
} from "../../../cli/tui/components/prompt-input/reducer";
import { formatSlashSuggestionPanel } from "../../../cli/tui/interactive/slash-overlay";
import {
  formatPromptSuggestionPanel,
  resolveVisibleSuggestionWindow,
  truncateDisplayWidthMiddle,
} from "../../../cli/tui/interactive/suggestion-window";
import { measureDisplayWidth } from "../../../cli/tui/terminal/display-width";
import { stripAnsi, type ContractPayload } from "./helpers";

export function runSuggestionKeybindingChecks(): ContractPayload {
  const slashMenu = resolveSlashSuggestionApplyResult("/model");
  const slashCommandsMenu = resolveSlashSuggestionApplyResult("/commands");
  const slashPlanMenu = resolveSlashSuggestionApplyResult("/plan");
  const slashSkillCreatorMenu = resolveSlashSuggestionApplyResult("/skill-creator");
  const slashOverlayPartial = formatSlashSuggestionPanel(
    [{ command: "/exit", description: "退出交互模式" }],
    "/e",
    0,
    96,
  );
  const slashOverlayExact = formatSlashSuggestionPanel(
    [{ command: "/exit", description: "退出交互模式" }],
    "/exit",
    0,
    96,
  );
  const slashOverlayBuiltinSource = formatSlashSuggestionPanel(
    [{ command: "/exit", description: "退出交互模式", source: "builtin" }],
    "/",
    0,
    96,
  );
  const slashOverlayUserSource = formatSlashSuggestionPanel(
    [{ command: "/shipit", description: "Ship current branch", source: "user" }],
    "/",
    0,
    96,
  );
  const slashOverlayScrolled = formatSlashSuggestionPanel(
    [
      { command: "/sessions", description: "打开会话选择器" },
      { command: "/resume", description: "恢复历史会话" },
      { command: "/rewind", description: "回退到检查点" },
      { command: "/commands", description: "浏览命令菜单" },
      { command: "/skill-creator", description: "创建技能" },
      { command: "/init", description: "初始化项目指令" },
      { command: "/context", description: "查看上下文状态" },
      { command: "/memory", description: "打开 memory 工具" },
      { command: "/model", description: "切换模型" },
      { command: "/help", description: "显示帮助" },
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
      { command: "/model", description: "打开模型选择器" },
      { command: "/commands", description: "管理用户自定义 slash 命令" },
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
  const genericSuggestionWindow = resolveVisibleSuggestionWindow({
    items: ["/one", "/two", "/three", "/four", "/five", "/six", "/seven"],
    selectedIndex: 5,
    visibleCount: 3,
  });
  const promptSuggestionOverlay = formatPromptSuggestionPanel({
    suggestions: [
      { id: "cmd-one", displayText: "/one", description: "one" },
      { id: "cmd-two", displayText: "/two", description: "two" },
      { id: "cmd-three", displayText: "/three", description: "three" },
      { id: "cmd-four", displayText: "/four", description: "four" },
      { id: "cmd-five", displayText: "/five", description: "five" },
      { id: "cmd-six", displayText: "/six", description: "six" },
      { id: "cmd-seven", displayText: "/seven", description: "seven" },
    ],
    selectedIndex: 5,
    terminalColumns: 80,
    terminalRows: 24,
    overlay: true,
  });
  const promptSuggestionOverlayLines = promptSuggestionOverlay
    .split("\n")
    .filter((line) => line.length > 0);
  const promptSuggestionOverlaySelectedRow = promptSuggestionOverlayLines.findIndex((line) =>
    line.includes("/six"),
  );
  const promptSuggestionInline = formatPromptSuggestionPanel({
    suggestions: [
      { id: "cmd-one", displayText: "/one", description: "one" },
      { id: "cmd-two", displayText: "/two", description: "two" },
      { id: "cmd-three", displayText: "/three", description: "three" },
      { id: "cmd-four", displayText: "/four", description: "four" },
      { id: "cmd-five", displayText: "/five", description: "five" },
      { id: "cmd-six", displayText: "/six", description: "six" },
    ],
    selectedIndex: 4,
    terminalColumns: 80,
    terminalRows: 6,
    overlay: false,
  });
  const promptSuggestionInlineLines = promptSuggestionInline
    .split("\n")
    .filter((line) => line.length > 0);
  const promptSuggestionFile = formatPromptSuggestionPanel({
    suggestions: [{
      id: "file-gateway/src/cli/tui/interactive/suggestion-window.ts",
      displayText: "gateway/src/cli/tui/interactive/suggestion-window.ts",
      description: "TypeScript source file",
      type: "file",
    }],
    selectedIndex: 0,
    terminalColumns: 72,
    overlay: true,
  });
  const promptSuggestionFilePlain = stripAnsi(promptSuggestionFile);
  const promptSuggestionIcons = formatPromptSuggestionPanel({
    suggestions: [
      {
        id: "mcp-resource-project-docs",
        displayText: "project://docs/architecture",
        description: "MCP resource",
        type: "mcp-resource",
      },
      {
        id: "agent-frontend-worker",
        displayText: "frontend_worker",
        description: "Worker agent",
        type: "agent",
      },
    ],
    selectedIndex: 1,
    terminalColumns: 72,
    overlay: true,
  });
  const promptSuggestionTagged = formatPromptSuggestionPanel({
    suggestions: [{
      id: "command-user-weekly",
      displayText: "/weekly-report",
      tag: "user",
      description: "Create\nweekly\toperator summary",
      type: "command",
    }],
    selectedIndex: 0,
    terminalColumns: 96,
    overlay: true,
  });
  const promptSuggestionTaggedPlain = stripAnsi(promptSuggestionTagged);
  const promptSuggestionPointer = formatPromptSuggestionPanel({
    suggestions: [
      { id: "command-model", displayText: "/model", description: "切换模型", type: "command" },
      { id: "command-plan", displayText: "/plan", description: "进入计划模式", type: "command" },
    ],
    selectedIndex: 1,
    terminalColumns: 64,
    overlay: true,
    showSelectionPointer: true,
  });
  const promptSuggestionPointerPlain = stripAnsi(promptSuggestionPointer);
  const promptSuggestionMiddleTruncate = truncateDisplayWidthMiddle(
    "gateway/src/cli/tui/interactive/suggestion-window.ts",
    32,
  );
  const slashOverlayWithArgs = formatSlashSuggestionPanel(
    [{ command: "/plan", description: "进入计划模式" }],
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
  const slashInputWithArgsFallbackSuggestions = resolveSlashInputHighlightSuggestions({
    activeLineInput: "/plan 帮我写一份抖音直播规划",
    suggestions: [],
    getSlashSuggestions: (input) =>
      input === "/plan"
        ? [{ command: "/plan", description: "Enter plan mode" }]
        : [],
  });
  const slashInputWithArgsFallbackHighlight = shouldHighlightSlashInputToken({
    activeLineInput: "/plan 帮我写一份抖音直播规划",
    suggestions: slashInputWithArgsFallbackSuggestions,
  });
  const slashInputPartialWithArgsFallbackSuggestions = resolveSlashInputHighlightSuggestions({
    activeLineInput: "/pl 帮我写一份抖音直播规划",
    suggestions: [],
    getSlashSuggestions: (input) =>
      input === "/pl"
        ? [{ command: "/plan", description: "Enter plan mode" }]
        : [],
  });
  const slashInputPartialWithArgsFallbackHighlight = shouldHighlightSlashInputToken({
    activeLineInput: "/pl 帮我写一份抖音直播规划",
    suggestions: slashInputPartialWithArgsFallbackSuggestions,
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

  return {
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
      slashOverlayPartial.includes("\u001B[38;2;202;124;94m"),
    slash_overlay_selected_description_is_muted:
      slashOverlayPartial.includes("\u001B[90m退出交互模式"),
    slash_overlay_selected_description_not_brand_flooded:
      !slashOverlayPartial.includes("\u001B[38;2;202;124;94m退出交互模式"),
    slash_overlay_exact_selected_highlighted:
      slashOverlayExact.includes("\u001B[38;2;202;124;94m"),
    slash_overlay_hides_builtin_source_tag:
      !stripAnsi(slashOverlayBuiltinSource).includes("[builtin]"),
    slash_overlay_keeps_user_source_tag:
      stripAnsi(slashOverlayUserSource).includes("[user]"),
    slash_overlay_scroll_window_keeps_selected_visible:
      slashOverlayScrolled.includes("/model"),
    slash_overlay_scroll_window_highlights_selected:
      slashOverlayScrolledModelLine.includes("\u001B[38;2;202;124;94m/model"),
    slash_overlay_scroll_window_uses_restraint_not_bold:
      !slashOverlayScrolledModelLine.includes("\u001B[1m\u001B[38;2;202;124;94m/model"),
    slash_overlay_selected_has_pointer:
      stripAnsi(slashOverlayScrolledModelLine).startsWith("❯ /model"),
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
    suggestion_window_reusable_selected_centered:
      genericSuggestionWindow.startIndex === 4
      && genericSuggestionWindow.endIndex === 7
      && genericSuggestionWindow.selectedVisibleIndex === 1
      && genericSuggestionWindow.visibleItems[1] === "/six",
    prompt_suggestions_overlay_caps_at_five:
      promptSuggestionOverlayLines.length === 5,
    prompt_suggestions_overlay_centers_selected:
      promptSuggestionOverlaySelectedRow >= 1 && promptSuggestionOverlaySelectedRow <= 3,
    prompt_suggestions_inline_uses_rows_minus_prompt_budget:
      promptSuggestionInlineLines.length === 3,
    prompt_suggestions_selected_uses_reference_color:
      promptSuggestionOverlay.includes("\u001B[38;2;202;124;94m/six"),
    prompt_suggestions_file_uses_icon_and_middle_truncation:
      promptSuggestionFilePlain.includes("+ ")
      && promptSuggestionFilePlain.includes("gateway/src")
      && promptSuggestionFilePlain.includes("suggestion-window.ts")
      && promptSuggestionFilePlain.includes("..."),
    prompt_suggestions_file_lines_within_width:
      promptSuggestionFile
        .split("\n")
        .filter((line) => line.length > 0)
        .every((line) => measureDisplayWidth(line) <= 72),
    prompt_suggestions_mcp_and_agent_icons:
      stripAnsi(promptSuggestionIcons).includes("◇ ")
      && stripAnsi(promptSuggestionIcons).includes("* frontend_worker"),
    prompt_suggestions_tags_and_description_flatten:
      promptSuggestionTaggedPlain.includes("[user]")
      && promptSuggestionTaggedPlain.includes("Create weekly operator summary"),
    prompt_suggestions_selection_pointer_optional:
      promptSuggestionPointerPlain
        .split("\n")
        .some((line) => line.startsWith("❯ /plan")),
    prompt_suggestions_middle_truncates_both_edges:
      promptSuggestionMiddleTruncate.startsWith("gateway/")
      && promptSuggestionMiddleTruncate.endsWith("window.ts")
      && promptSuggestionMiddleTruncate.includes("..."),
    slash_overlay_narrow_hides_description:
      !stripAnsi(slashOverlayNarrow).includes("打开模型选择器"),
    slash_overlay_narrow_lines_within_width:
      slashOverlayNarrowLines.every((line) => measureDisplayWidth(line) <= 52),
    slash_overlay_hidden_when_has_args:
      slashOverlayWithArgs.length === 0,
    slash_fixture_descriptions_avoid_plan_mode_copy:
      !promptSuggestionPointerPlain.includes("plan mode")
      && !slashOverlayWithArgs.includes("plan mode"),
    slash_input_partial_not_highlighted:
      !slashInputPartialHighlight,
    slash_input_exact_highlighted:
      slashInputExactHighlight,
    slash_input_with_args_highlighted:
      slashInputWithArgsHighlight,
    slash_input_with_args_fallback_highlighted:
      slashInputWithArgsFallbackHighlight,
    slash_input_partial_with_args_fallback_not_highlighted:
      !slashInputPartialWithArgsFallbackHighlight,
  };
}
