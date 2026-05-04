import {
  renderInteractiveInputChromeLines,
  renderSubmittedInputTranscriptLines,
  resolveDraftAwareFooterLines,
  resolveInteractiveInputBodyWidth,
  resolveInteractiveInputCursorColumn,
} from "../../../cli/tui/components/prompt-input/render";
import { measureDisplayWidth } from "../../../cli/tui/terminal/display-width";
import { stripAnsi, type ContractPayload } from "./helpers";

export function runInputChromeChecks(): ContractPayload {
  const draftFooterLines = resolveDraftAwareFooterLines({
    footerLines: ["? 快捷键 · grobot · ctx 42%"],
    inputGraphemeLength: 3,
  });
  const styledDraftFooterLines = resolveDraftAwareFooterLines({
    footerLines: ["\u001B[90m\u001B[38;2;202;124;94m? 快捷键\u001B[0m\u001B[90m · grobot · ctx 42%\u001B[0m"],
    inputGraphemeLength: 3,
  });
  const emptyFooterLines = resolveDraftAwareFooterLines({
    footerLines: ["? 快捷键 · grobot · ctx 42%"],
    inputGraphemeLength: 0,
  });
  const draftHintOnlyFooterLines = resolveDraftAwareFooterLines({
    footerLines: ["? 快捷键"],
    inputGraphemeLength: 1,
  });
  const inputChromeLines = renderInteractiveInputChromeLines({
    bodyLines: ["❯ hello"],
    inputBodyWidth: 20,
  });
  const submittedTranscriptLines = renderSubmittedInputTranscriptLines({
    value: "你是啥模型",
    promptLabel: "❯ ",
    terminalColumns: 96,
    theme: "ccline",
  });
  const submittedPlanTranscriptLines = renderSubmittedInputTranscriptLines({
    value: "/plan 帮我规划 plan mode 交互",
    promptLabel: "❯ ",
    terminalColumns: 96,
    theme: "ccline",
    getSlashSuggestions: (input) =>
      input === "/plan"
        ? [{ command: "/plan", description: "进入 plan mode" }]
        : [],
  });
  const submittedTranscriptPlain = submittedTranscriptLines
    .map(stripAnsi)
    .join("\n");
  const submittedPlanTranscriptPlain = submittedPlanTranscriptLines
    .map(stripAnsi)
    .join("\n");
  const submittedPlanTranscriptRaw = submittedPlanTranscriptLines.join("\n");
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

  return {
    footer_draft_hides_shortcut_hint:
      draftFooterLines.length === 1
      && draftFooterLines[0] === "grobot · ctx 42%",
    footer_draft_hides_styled_shortcut_hint:
      styledDraftFooterLines.length === 1
      && styledDraftFooterLines[0] === "grobot · ctx 42%",
    footer_empty_keeps_shortcut_hint:
      emptyFooterLines.length === 1
      && emptyFooterLines[0]?.startsWith("? 快捷键") === true,
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
    submitted_transcript_keeps_user_text:
      submittedTranscriptPlain.includes("❯ 你是啥模型"),
    submitted_transcript_omits_status_footer:
      !submittedTranscriptPlain.includes("? 快捷键")
      && !submittedTranscriptPlain.includes("window")
      && !submittedTranscriptPlain.includes("kimi/"),
    submitted_transcript_is_input_frame_only:
      submittedTranscriptLines.length === 3
      && submittedTranscriptPlain.split("\n").filter((line) => /^─+$/.test(line)).length === 2,
    submitted_transcript_lines_within_width:
      submittedTranscriptLines.every((line) => measureDisplayWidth(line) <= 96),
    submitted_slash_transcript_preserves_command_highlight:
      submittedPlanTranscriptPlain.includes("❯ /plan 帮我规划 plan mode 交互")
      && submittedPlanTranscriptRaw.includes("\u001B[1m\u001B[38;2;202;124;94m/plan\u001B[0m"),
  };
}
