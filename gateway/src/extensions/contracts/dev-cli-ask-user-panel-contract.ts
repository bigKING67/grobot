import {
  buildAskUserQuestionnaireView,
  createAskUserQuestionnaireState,
  normalizeAskUserEnvelopeFromPayload,
} from "../../tools/ask-user";
import {
  measureDisplayWidth,
  stripAnsi,
} from "../../orchestration/entrypoints/dev-cli/ui/interactive/display-width";
import {
  renderAskUserPanelScreen,
} from "../../orchestration/entrypoints/dev-cli/ui/screens/ask-user-panel-screen";

const scopeEnvelope = normalizeAskUserEnvelopeFromPayload({
  blocking_node_id: "node.confirm.scope",
  questions: [{
    id: "ask_q_scope",
    header: "Scope",
    question: "Choose execution mode",
    options: [{
      label: "safe",
      value: "safe",
      description: "Run checks before continuing",
    }, {
      label: "fast",
      value: "fast",
      description: "Skip optional checks",
    }],
  }],
  default_on_timeout: "safe",
  resume_token: "resume_scope",
});
const riskEnvelope = normalizeAskUserEnvelopeFromPayload({
  blocking_node_id: "node.confirm.risk",
  questions: [{
    id: "ask_q_risk",
    header: "Risk Review",
    question: "Need risk review?",
    options: ["yes", "no"],
  }],
  default_on_timeout: "no",
  resume_token: "resume_risk",
});
const freeTextEnvelope = normalizeAskUserEnvelopeFromPayload({
  blocking_node_id: "node.confirm.notes",
  questions: [{
    id: "ask_q_notes",
    header: "Notes",
    question: "Add optional constraints",
  }],
  resume_token: "resume_notes",
});

if (!scopeEnvelope || !riskEnvelope || !freeTextEnvelope) {
  throw new Error("failed to normalize ask-user panel fixtures");
}

const queue = [scopeEnvelope, riskEnvelope];
const initialView = buildAskUserQuestionnaireView({
  queue,
  state: createAskUserQuestionnaireState(),
});
const answeredState = createAskUserQuestionnaireState({
  currentQuestionIndex: 1,
  answers: {
    [scopeEnvelope.askId]: "safe",
    [riskEnvelope.askId]: "yes",
  },
  mode: "review",
});
const reviewView = buildAskUserQuestionnaireView({
  queue,
  state: answeredState,
});
const textInputView = buildAskUserQuestionnaireView({
  queue: [freeTextEnvelope],
  state: createAskUserQuestionnaireState({
    textInputValue: "Only touch gateway TUI",
  }),
});

const initialRendered = renderAskUserPanelScreen({
  view: initialView,
  terminalColumns: 88,
});
const reviewRendered = renderAskUserPanelScreen({
  view: reviewView,
  terminalColumns: 88,
  activeReviewIndex: 1,
});
const textInputRendered = renderAskUserPanelScreen({
  view: textInputView,
  terminalColumns: 88,
  textInputValue: "Only touch gateway TUI",
});
const narrowRendered = renderAskUserPanelScreen({
  view: initialView,
  terminalColumns: 52,
});

function linesWithinColumns(rendered: string, columns: number): boolean {
  return stripAnsi(rendered)
    .split("\n")
    .every((line) => measureDisplayWidth(line) <= columns);
}

const initialPlain = stripAnsi(initialRendered);
const reviewPlain = stripAnsi(reviewRendered);
const textInputPlain = stripAnsi(textInputRendered);
const narrowPlain = stripAnsi(narrowRendered);

const payload = {
  panel_has_brand_divider: /^─+$/.test(initialPlain.split("\n")[0] ?? ""),
  panel_omits_raw_ask_user_label: !initialPlain.includes("ask-user")
    && !initialPlain.includes("[ask-user]"),
  panel_has_codex_like_progress:
    initialPlain.includes("Question 1/2")
    && initialPlain.includes("(2 unanswered)"),
  panel_has_claude_like_question_tabs:
    initialPlain.includes("[□ Scope]")
    && initialPlain.includes("□ Risk Review")
    && initialPlain.includes("✓ 提交"),
  panel_question_separate_from_options:
    initialPlain.includes("Choose execution mode\n\n")
    && initialPlain.includes("› 1. safe"),
  panel_preserves_option_descriptions:
    initialPlain.includes("Run checks before continuing")
    && initialPlain.includes("Skip optional checks"),
  panel_has_other_type_something_row:
    initialPlain.includes("3. Other")
    && initialPlain.includes("Type something."),
  panel_has_direct_keyboard_hints:
    initialPlain.includes("Enter 提交答案")
    && initialPlain.includes("1-2 直选")
    && initialPlain.includes("Other 输入")
    && initialPlain.includes("Esc 返回输入框"),
  panel_review_has_submit_edit_cancel:
    reviewPlain.includes("提交答案")
    && reviewPlain.includes("修改 1.")
    && reviewPlain.includes("取消"),
  panel_review_has_answer_summary:
    reviewPlain.includes("已回答 2/2")
    && reviewPlain.includes("safe"),
  panel_text_input_renders_value:
    textInputPlain.includes("Add optional constraints")
    && textInputPlain.includes("Only touch gateway TUI"),
  panel_narrow_keeps_lines_within_width: linesWithinColumns(narrowRendered, 52),
  panel_wide_keeps_lines_within_width: linesWithinColumns(initialRendered, 88),
  panel_interactive_uses_warm_brand_color:
    initialRendered.includes("\x1b[38;2;202;124;94m"),
  panel_no_box_frame:
    !initialPlain.includes("╭")
    && !initialPlain.includes("╰")
    && !initialPlain.includes("│"),
  panel_narrow_keeps_progress:
    narrowPlain.includes("Question 1/2")
    && narrowPlain.includes("Choose execution mode"),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
