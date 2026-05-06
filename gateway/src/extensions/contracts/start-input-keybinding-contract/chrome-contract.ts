import {
  buildPromptInputRenderSnapshot,
  renderSlashCommandTokenHighlight,
  renderInteractiveInputChromeLines,
  renderSubmittedInputTranscriptLines,
  resolveDraftAwareFooterLines,
  resolveInteractiveInputBodyWidth,
  resolveInteractiveInputCursorColumn,
} from "../../../cli/tui/components/prompt-input/render";
import { measureDisplayWidth, splitGraphemes } from "../../../cli/tui/terminal/display-width";
import { stripAnsi, type ContractPayload } from "./helpers";

export function runInputChromeChecks(): ContractPayload {
  const draftFooterLines = resolveDraftAwareFooterLines({
    footerLines: ["? shortcuts · grobot · ctx 42%"],
    inputGraphemeLength: 3,
  });
  const styledDraftFooterLines = resolveDraftAwareFooterLines({
    footerLines: ["\u001B[90m\u001B[38;2;202;124;94m? shortcuts\u001B[0m\u001B[90m · grobot · ctx 42%\u001B[0m"],
    inputGraphemeLength: 3,
  });
  const emptyFooterLines = resolveDraftAwareFooterLines({
    footerLines: ["? shortcuts · grobot · ctx 42%"],
    inputGraphemeLength: 0,
  });
  const draftHintOnlyFooterLines = resolveDraftAwareFooterLines({
    footerLines: ["? shortcuts"],
    inputGraphemeLength: 1,
  });
  const inputChromeLines = renderInteractiveInputChromeLines({
    bodyLines: ["❯ hello"],
    inputBodyWidth: 20,
  });
  const liveUnsafeValue = "hello\u001B[31m red\u001B[0m\u202E\tworld";
  const liveUnsafeSnapshot = buildPromptInputRenderSnapshot({
    resolvedPrompt: {
      prefix: "",
      inlinePrompt: "❯ ",
    },
    footerLines: [],
    promptLabelWidth: 2,
    continuationPrefix: "  ",
    graphemes: splitGraphemes(liveUnsafeValue),
    cursor: splitGraphemes(liveUnsafeValue).length,
    historySearchInFlight: false,
    shortcutOverlayVisible: false,
    activeSlashSuggestionIndex: 0,
    lastSlashLineInput: "",
    slashSuggestionsHiddenForLine: "",
    terminalColumns: 96,
    inlineImageTheme: "ccline",
  }).snapshot;
  const submittedTranscriptLines = renderSubmittedInputTranscriptLines({
    value: "你是啥模型",
    promptLabel: "❯ ",
    terminalColumns: 96,
    theme: "ccline",
  });
  const submittedPlanTranscriptLines = renderSubmittedInputTranscriptLines({
    value: "/plan 帮我规划计划模式交互",
    promptLabel: "❯ ",
    terminalColumns: 96,
    theme: "ccline",
    getSlashSuggestions: (input) =>
      input === "/plan"
        ? [{ command: "/plan", description: "Enter plan mode" }]
        : [],
  });
  const unsafeSubmittedTranscriptLines = renderSubmittedInputTranscriptLines({
    value: "hello\u001B[31m red\u001B[0m\u202E\r\n\tworld",
    promptLabel: "❯ ",
    terminalColumns: 96,
    theme: "ccline",
  });
  const submittedTranscriptPlain = submittedTranscriptLines
    .map(stripAnsi)
    .join("\n");
  const submittedPlanTranscriptPlain = submittedPlanTranscriptLines
    .map(stripAnsi)
    .join("\n");
  const submittedPlanTranscriptRaw = submittedPlanTranscriptLines.join("\n");
  const unsafeSubmittedTranscriptPlain = unsafeSubmittedTranscriptLines
    .map(stripAnsi)
    .join("\n");
  const unsafeSubmittedTranscriptRaw = unsafeSubmittedTranscriptLines.join("\n");
  const expectedPlanHighlight = renderSlashCommandTokenHighlight("/plan");
  const inputChromeTopLinePlain = stripAnsi(inputChromeLines[0] ?? "");
  const inputChromeBodyLine = inputChromeLines[1] ?? "";
  const inputChromeBodyLinePlain = stripAnsi(inputChromeBodyLine);
  const liveUnsafePromptPlain = liveUnsafeSnapshot.renderedLines
    .map(stripAnsi)
    .join("\n");
  const liveUnsafePromptRaw = liveUnsafeSnapshot.renderedLines.join("\n");
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

  return {
    footer_draft_hides_shortcut_hint:
      draftFooterLines.length === 1
      && draftFooterLines[0] === "grobot · ctx 42%",
    footer_draft_hides_styled_shortcut_hint:
      styledDraftFooterLines.length === 1
      && styledDraftFooterLines[0] === "grobot · ctx 42%",
    footer_empty_keeps_shortcut_hint:
      emptyFooterLines.length === 1
      && emptyFooterLines[0]?.startsWith("? shortcuts") === true,
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
    input_live_prompt_sanitizes_render_text:
      liveUnsafePromptPlain.includes("❯ hello red    world")
      && !liveUnsafePromptRaw.includes("\u001B[31m")
      && !liveUnsafePromptPlain.includes("\u202E")
      && liveUnsafeSnapshot.renderedLines.every((line) => measureDisplayWidth(line) <= 96),
    input_live_prompt_keeps_raw_state_for_submission:
      liveUnsafeSnapshot.activeLineInput === liveUnsafeValue,
    input_chrome_uses_full_terminal_width:
      inputChromeFullTerminalWidth === 80,
    input_chrome_respects_prompt_minimum_width:
      inputChromeSmallTerminalWidth === 12,
    submitted_transcript_keeps_user_text:
      submittedTranscriptPlain.includes("❯ 你是啥模型"),
    submitted_transcript_omits_status_footer:
      !submittedTranscriptPlain.includes("? shortcuts")
      && !submittedTranscriptPlain.includes("window")
      && !submittedTranscriptPlain.includes("kimi/"),
    submitted_transcript_is_input_frame_only:
      submittedTranscriptLines.length === 3
      && submittedTranscriptPlain.split("\n").filter((line) => /^─+$/.test(line)).length === 2,
    submitted_transcript_lines_within_width:
      submittedTranscriptLines.every((line) => measureDisplayWidth(line) <= 96),
    submitted_transcript_sanitizes_render_text:
      unsafeSubmittedTranscriptPlain.includes("❯ hello red")
      && unsafeSubmittedTranscriptPlain.includes("  world")
      && !unsafeSubmittedTranscriptRaw.includes("\u001B[31m")
      && !unsafeSubmittedTranscriptPlain.includes("\u202E")
      && !unsafeSubmittedTranscriptPlain.includes("\r")
      && unsafeSubmittedTranscriptLines.every((line) => measureDisplayWidth(line) <= 96),
    submitted_slash_transcript_preserves_command_highlight:
      submittedPlanTranscriptPlain.includes("❯ /plan 帮我规划计划模式交互")
      && submittedPlanTranscriptRaw.includes(expectedPlanHighlight)
      && !submittedPlanTranscriptPlain.includes("plan mode"),
  };
}
