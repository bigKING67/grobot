import {
  ASK_USER_SECRET_DISPLAY_VALUE,
  buildAskUserQuestionnaireView,
  createAskUserQuestionnaireState,
  normalizeAskUserEnvelopeFromPayload,
} from "../../tools/ask-user";
import {
  measureDisplayWidth,
  stripAnsi,
} from "../../cli/tui/terminal/display-width";
import {
  renderAskUserPanelScreen,
} from "../../cli/tui/components/ask-user-panel/render";

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
const secretTextEnvelope = normalizeAskUserEnvelopeFromPayload({
  blocking_node_id: "node.confirm.secret",
  questions: [{
    id: "ask_q_secret",
    header: "Secret",
    question: "Paste API token",
    is_secret: true,
  }],
  resume_token: "resume_secret",
});

if (!scopeEnvelope || !riskEnvelope || !freeTextEnvelope || !secretTextEnvelope) {
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
const secretTextInputView = buildAskUserQuestionnaireView({
  queue: [secretTextEnvelope],
  state: createAskUserQuestionnaireState({
    textInputValue: "sk-live-secret",
  }),
});

const initialRendered = renderAskUserPanelScreen({
  view: initialView,
  terminalColumns: 88,
  planMode: true,
  planFilePath: ".grobot/plans/session/ACTIVE.md",
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
const secretTextInputRendered = renderAskUserPanelScreen({
  view: secretTextInputView,
  terminalColumns: 88,
  textInputValue: "sk-live-secret",
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
const secretTextInputPlain = stripAnsi(secretTextInputRendered);
const narrowPlain = stripAnsi(narrowRendered);

const payload = {
  panel_has_brand_divider: /^─+$/.test(initialPlain.split("\n")[0] ?? ""),
  panel_omits_raw_ask_user_label: !initialPlain.includes("ask-user")
    && !initialPlain.includes("[ask-user]"),
  panel_has_codex_like_progress:
    initialPlain.includes("问题 1/2")
    && initialPlain.includes("(2 项未回答)"),
  panel_plan_mode_shows_planning_path:
    initialPlain.includes("计划文件 .grobot/plans/session/ACTIVE.md"),
  panel_planning_context_near_top:
    initialPlain.indexOf("计划文件 .grobot/plans/session/ACTIVE.md") > 0
    && initialPlain.indexOf("计划文件 .grobot/plans/session/ACTIVE.md") < initialPlain.indexOf("←"),
  panel_has_claude_like_question_tabs:
    initialPlain.includes("[□ Scope]")
    && initialPlain.includes("□ Risk Review")
    && initialPlain.includes("✓ 提交"),
  panel_question_separate_from_options:
    initialRendered.includes("\x1b[1mChoose execution mode")
    && initialPlain.includes("Choose execution mode\n  问题 1/2")
    && initialPlain.includes("问题 1/2 (2 项未回答)\n\n")
    && initialPlain.includes("❯ 1. safe"),
  panel_title_is_prominent_and_not_repeated:
    initialRendered.includes("\x1b[1mChoose execution mode")
    && (initialPlain.match(/Choose execution mode/g) ?? []).length === 1,
  panel_preserves_option_descriptions:
    initialPlain.includes("Run checks before continuing")
    && initialPlain.includes("Skip optional checks"),
  panel_has_other_type_something_row:
    initialPlain.includes("3. 自定义")
    && initialPlain.includes("输入自定义回复"),
  panel_has_direct_keyboard_hints:
    initialPlain.includes("Enter 确认")
    && initialPlain.includes("↑/↓ 选择")
    && initialPlain.includes("n 添加备注")
    && initialPlain.includes("Esc 返回输入框")
    && initialPlain.includes("1-2 直选")
    && initialPlain.includes("自定义输入"),
  panel_has_notes_affordance:
    initialPlain.includes("备注:")
    && initialPlain.includes("按 n 添加备注"),
  panel_has_chat_about_this_row:
    initialPlain.includes("4. 继续对话补充")
    && !initialPlain.includes("\nc. 继续对话补充"),
  panel_has_plan_skip_affordance:
    initialPlain.includes("5. 跳过访谈，直接进入计划")
    && !initialPlain.includes("\ns. 跳过访谈，直接进入计划")
    && initialPlain.includes("s 跳过"),
  panel_footer_actions_separated:
    initialPlain.includes("按 n 添加备注\n\n  ─")
    && initialPlain.includes("─\n  4. 继续对话补充"),
  panel_hints_are_muted:
    initialRendered.includes("\x1b[90mEnter 确认")
    && initialRendered.includes("\x1b[90m↑/↓ 选择"),
  panel_review_hint_uses_reference_byline:
    reviewPlain.includes("↑/↓ 选择 · Enter 确认 · ←/→ 切换问题 · Esc 返回输入框")
    && !reviewPlain.includes("↑/↓ 选择 | Enter 确认 | ←/→ 切换问题 | Esc 返回输入框"),
  panel_review_has_submit_edit_cancel:
    reviewPlain.includes("提交答案")
    && reviewPlain.includes("修改 1.")
    && reviewPlain.includes("取消"),
  panel_review_submit_tab_is_single_active:
    reviewPlain.includes("✓ Scope")
    && reviewPlain.includes("✓ Risk Review")
    && reviewPlain.includes("[✓ 提交]")
    && !reviewPlain.includes("[Risk Review] [提交]"),
  panel_review_title_is_prominent:
    reviewRendered.includes("\x1b[1m检查答案"),
  panel_review_has_answer_summary:
    reviewPlain.includes("已回答 2/2")
    && reviewPlain.includes("safe"),
  panel_text_input_renders_value:
    textInputPlain.includes("Add optional constraints")
    && textInputPlain.includes("Only touch gateway TUI"),
  panel_secret_text_input_masks_value:
    secretTextInputPlain.includes("Paste API token")
    && secretTextInputPlain.includes(ASK_USER_SECRET_DISPLAY_VALUE)
    && !secretTextInputPlain.includes("sk-live-secret"),
  panel_narrow_keeps_lines_within_width: linesWithinColumns(narrowRendered, 52),
  panel_wide_keeps_lines_within_width: linesWithinColumns(initialRendered, 88),
  panel_interactive_uses_warm_brand_color:
    initialRendered.includes("\x1b[38;2;202;124;94m"),
  panel_no_box_frame:
    !initialPlain.includes("╭")
    && !initialPlain.includes("╰")
    && !initialPlain.includes("│"),
  panel_narrow_keeps_progress:
    narrowPlain.includes("问题 1/2")
    && narrowPlain.includes("Choose execution mode"),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
