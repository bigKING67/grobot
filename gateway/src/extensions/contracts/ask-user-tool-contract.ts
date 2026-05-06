import {
  AskUserSessionStore,
  ASK_USER_SECRET_DISPLAY_VALUE,
  ASK_USER_SECRET_PERSISTENCE_VALUE,
  buildAskUserBatchAnswerText,
  buildAskUserQueueDisplay,
  buildAskUserDisplay,
  buildAskUserOptionsPreview,
  buildAskUserReviewMenuDescriptor,
  buildAskUserSelectMenuDescriptor,
  buildAskUserResolutionPrompt,
  buildAskUserQuestionnaireView,
  buildAskUserSafeUserText,
  createAskUserQuestionnaireState,
  createAskUserTurnPromptContext,
  formatAskUserResolvedAnswerForPersistence,
  formatAskUserIssuedEvent,
  formatAskUserResolvedEvent,
  normalizeAskUserEnvelopeFromPayload,
  normalizeAskUserEnvelopesFromPayload,
  reduceAskUserQuestionnaire,
  resolveAskUserAnswerFromSelection,
  type AskUserRuntimeAdapter,
} from "../../tools/ask-user";

const sessionStore = new AskUserSessionStore();
const runtime: AskUserRuntimeAdapter = {
  buildAskUserDisplay,
  registerPendingAsk(sessionKey, envelope) {
    sessionStore.set(sessionKey, envelope);
  },
  resolvePendingAsk(sessionKey, answer) {
    return sessionStore.resolve(sessionKey, answer);
  },
};

const sessionKey = "feishu:grobot:dm:ask-user-contract";
const pendingEnvelope = normalizeAskUserEnvelopeFromPayload({
  blocking_node_id: "node.runtime.route",
  questions: [{
    id: "ask_q_001",
    header: "Execution Mode",
    question: "Choose execution mode",
    options: ["safe", "fast"],
  }],
  default_on_timeout: "safe",
  resume_token: "resume_001",
});
if (!pendingEnvelope) {
  throw new Error("failed to normalize pending ask_user payload");
}
runtime.registerPendingAsk(sessionKey, pendingEnvelope);

const promptContext = createAskUserTurnPromptContext({
  runtime,
  sessionKey,
  userText: "  fast  ",
});
if (!promptContext.resolvedAsk) {
  throw new Error("expected resolved ask_user context");
}

const nextEnvelope = normalizeAskUserEnvelopeFromPayload({
  blocking_node_id: "node.confirm.scope",
  questions: [{
    id: "ask_q_002",
    header: "Scope",
    question: "Need project scope?",
    options: ["core", "all"],
  }],
  default_on_timeout: "core",
  resume_token: "resume_002",
});
if (!nextEnvelope) {
  throw new Error("failed to normalize next ask_user payload");
}
runtime.registerPendingAsk(sessionKey, nextEnvelope);
const thirdEnvelope = normalizeAskUserEnvelopeFromPayload({
  blocking_node_id: "node.confirm.risk",
  questions: [{
    id: "ask_q_003",
    header: "Risk Review",
    question: "Need risk review?",
    options: ["yes", "no"],
  }],
  default_on_timeout: "no",
  resume_token: "resume_003",
});
if (!thirdEnvelope) {
  throw new Error("failed to normalize third ask_user payload");
}
runtime.registerPendingAsk(sessionKey, thirdEnvelope);
runtime.registerPendingAsk(sessionKey, {
  ...thirdEnvelope,
  question: "Need risk review now?",
});
const display = runtime.buildAskUserDisplay(nextEnvelope);
const describedEnvelope = {
  ...nextEnvelope,
  questionIndex: 1,
  questionTotal: 2,
  options: ["safe", "fast"],
  optionsDetailed: [
    {
      label: "safe",
      value: "safe",
      description: "Run checks before continuing",
    },
    {
      label: "fast",
      value: "fast",
      description: "Skip optional checks",
    },
  ],
};
const describedDisplay = runtime.buildAskUserDisplay({
  ...describedEnvelope,
});
const overflowEnvelope = normalizeAskUserEnvelopeFromPayload({
  blocking_node_id: "node.overflow.options",
  questions: [{
    id: "ask_q_009",
    header: "Options",
    question: "Pick one from many options",
    options: [
      "option-1",
      "option-2",
      "option-3",
      "option-4",
      "option-5",
      "option-6",
    ],
  }],
  default_on_timeout: "option-1",
  resume_token: "resume_009",
});
if (!overflowEnvelope) {
  throw new Error("failed to normalize overflow ask_user payload");
}
const overflowDisplay = runtime.buildAskUserDisplay(overflowEnvelope);
const unsafeEnvelope = normalizeAskUserEnvelopeFromPayload({
  blocking_node_id: "node.unsafe.display",
  questions: [{
    id: "ask_q_unsafe",
    header: "\u001B[31mScope\u001B[0m\u202E",
    question: "Choose\u001B[31m mode\u001B[0m\u202E\tbefore continuing",
    options: [{
      label: "\u001B[31m1. safe\u001B[0m\u202E",
      value: "safe",
      description: "Run\u001B[31m checks\u001B[0m\u202E before continuing",
    }, {
      label: "fast\u001B]0;pwnd\u0007",
      value: "fast",
      description: "Skip\u0000 optional\r\nchecks",
    }],
  }],
  default_on_timeout: "safe\u001B[31m now\u001B[0m\u202E",
  resume_token: "resume_unsafe",
}, {
  cleanText: (value) => value,
});
if (!unsafeEnvelope) {
  throw new Error("failed to normalize unsafe ask_user payload");
}
const unsafeDisplay = runtime.buildAskUserDisplay(unsafeEnvelope);
const unsafeOptionsPreview = buildAskUserOptionsPreview(unsafeEnvelope.options);
const resolutionPrompt = buildAskUserResolutionPrompt({
  envelope: pendingEnvelope,
  answer: "fast",
});
const issuedRegistered = sessionStore.get(sessionKey)?.askId === "ask_q_002";
const queueSizeAfterEnqueue = sessionStore.size(sessionKey);
const queuedStepOne = createAskUserTurnPromptContext({
  runtime,
  sessionKey,
  userText: "all",
});
const queueNextAfterResolveIsQ3 = queuedStepOne.pendingNextAsk?.askId === "ask_q_003";
const queueSizeAfterResolve = queuedStepOne.queueSizeAfterResolve;
const queuedStepTwo = createAskUserTurnPromptContext({
  runtime,
  sessionKey,
  userText: "yes",
});
const queueEmptyAfterBatchResolved = sessionStore.size(sessionKey) === 0;
const optionEnvelope = normalizeAskUserEnvelopeFromPayload({
  blocking_node_id: "node.answer.by_index",
  questions: [{
    id: "ask_q_004",
    header: "Execution Profile",
    question: "Select execution profile",
    options: ["safe", "fast"],
  }],
  default_on_timeout: "safe",
  resume_token: "resume_004",
});
if (!optionEnvelope) {
  throw new Error("failed to normalize option ask_user payload");
}
runtime.registerPendingAsk(sessionKey, optionEnvelope);
const resolvedByIndex = sessionStore.resolve(sessionKey, "2");
runtime.registerPendingAsk(sessionKey, optionEnvelope);
const resolvedByFullWidthIndex = sessionStore.resolve(sessionKey, "２");
runtime.registerPendingAsk(sessionKey, optionEnvelope);
const resolvedByOptionText = sessionStore.resolve(sessionKey, "FAST");
runtime.registerPendingAsk(sessionKey, optionEnvelope);
const resolvedByOtherLiteral = sessionStore.resolve(sessionKey, "Other");
runtime.registerPendingAsk(sessionKey, optionEnvelope);
const resolvedByOtherIdLiteral = sessionStore.resolve(sessionKey, "__other__");
runtime.registerPendingAsk(sessionKey, optionEnvelope);
const resolvedByOutOfRangeIndex = sessionStore.resolve(sessionKey, "3");
runtime.registerPendingAsk(sessionKey, optionEnvelope);
const resolvedByBlank = sessionStore.resolve(sessionKey, "   ");
const expiredEnvelope = normalizeAskUserEnvelopeFromPayload({
  blocking_node_id: "node.expired",
  questions: [{
    id: "ask_q_005",
    header: "TTL",
    question: "Expired question",
    options: ["yes", "no"],
  }],
  default_on_timeout: "no",
  resume_token: "resume_005",
  created_at: "2026-01-01T00:00:00.000Z",
});
const freshEnvelope = normalizeAskUserEnvelopeFromPayload({
  blocking_node_id: "node.fresh",
  questions: [{
    id: "ask_q_006",
    header: "TTL",
    question: "Fresh question",
    options: ["yes", "no"],
  }],
  default_on_timeout: "yes",
  resume_token: "resume_006",
  created_at: "2026-01-01T00:00:12.000Z",
});
if (!expiredEnvelope || !freshEnvelope) {
  throw new Error("failed to normalize ttl ask_user payload");
}
sessionStore.set(sessionKey, expiredEnvelope);
sessionStore.set(sessionKey, freshEnvelope);
const expiredByTtl = sessionStore.pruneExpired(sessionKey, {
  maxAgeMs: 10_000,
  nowMs: Date.parse("2026-01-01T00:00:20.000Z"),
});
const remainingAfterTtlPrune = sessionStore.list(sessionKey);
sessionStore.delete(sessionKey);

const questionnaireInitialState = createAskUserQuestionnaireState({
  focusedOptionIndex: 0,
});
const questionnaireNextState = reduceAskUserQuestionnaire(questionnaireInitialState, {
  type: "next_option",
  optionCount: describedEnvelope.optionsDetailed.length,
});
const questionnairePreviousQuestionState = reduceAskUserQuestionnaire(questionnaireInitialState, {
  type: "previous_question",
  totalCount: 2,
});
const questionnaireAnsweredState = reduceAskUserQuestionnaire(questionnaireNextState, {
  type: "set_answer",
  askId: describedEnvelope.askId,
  answer: "fast",
  totalCount: 2,
});
const questionnaireReviewState = reduceAskUserQuestionnaire(questionnaireAnsweredState, {
  type: "go_review",
});
const questionnaireView = buildAskUserQuestionnaireView({
  queue: [describedEnvelope, thirdEnvelope],
  state: questionnaireInitialState,
});
const questionnaireReviewView = buildAskUserQuestionnaireView({
  queue: [describedEnvelope, thirdEnvelope],
  state: questionnaireReviewState,
});
const askUserMenuDescriptor = buildAskUserSelectMenuDescriptor({
  queue: [describedEnvelope, thirdEnvelope],
  state: questionnaireInitialState,
});
const askUserQueueDisplay = buildAskUserQueueDisplay({
  queue: [describedEnvelope, thirdEnvelope],
  state: questionnaireInitialState,
});
const unsafeQuestionnaireState = createAskUserQuestionnaireState({
  answers: {
    [unsafeEnvelope.askId]: "safe\u001B[31m answer\u001B[0m\u202E",
  },
  notes: {
    [unsafeEnvelope.askId]: "note\u001B[31m red\u001B[0m\u202E",
  },
  textInputValue: "custom\u001B[31m value\u001B[0m\u202E",
});
const unsafeMenuDescriptor = buildAskUserSelectMenuDescriptor({
  queue: [unsafeEnvelope],
  state: unsafeQuestionnaireState,
});
const unsafeQueueDisplay = buildAskUserQueueDisplay({
  queue: [unsafeEnvelope],
  state: unsafeQuestionnaireState,
});
const unsafeReviewMenuDescriptor = buildAskUserReviewMenuDescriptor({
  queue: [unsafeEnvelope],
  answers: unsafeQuestionnaireState.answers,
});
const unsafeReviewView = buildAskUserQuestionnaireView({
  queue: [unsafeEnvelope],
  state: {
    ...unsafeQuestionnaireState,
    mode: "review",
  },
});
const selectedAnswerFromInteraction = resolveAskUserAnswerFromSelection(describedEnvelope, 1);
runtime.registerPendingAsk(sessionKey, nextEnvelope);
runtime.registerPendingAsk(sessionKey, thirdEnvelope);
const batchAnswerText = buildAskUserBatchAnswerText({
  queue: [nextEnvelope, thirdEnvelope],
  answers: {
    [nextEnvelope.askId]: "all",
    [thirdEnvelope.askId]: "yes",
  },
});
const batchAnswerTextWithNotes = buildAskUserBatchAnswerText({
  queue: [nextEnvelope, thirdEnvelope],
  answers: {
    [nextEnvelope.askId]: "all",
    [thirdEnvelope.askId]: "yes",
  },
  notes: {
    [nextEnvelope.askId]: "limit to gateway TUI",
  },
});
const reviewMenuDescriptor = buildAskUserReviewMenuDescriptor({
  queue: [nextEnvelope, thirdEnvelope],
  answers: {
    [nextEnvelope.askId]: "all",
    [thirdEnvelope.askId]: "yes",
  },
});
const batchPromptContext = createAskUserTurnPromptContext({
  runtime,
  sessionKey,
  userText: batchAnswerText,
});
const batchQueueEmptyAfterResolve = sessionStore.size(sessionKey) === 0;
runtime.registerPendingAsk(sessionKey, nextEnvelope);
runtime.registerPendingAsk(sessionKey, thirdEnvelope);
const legacyBatchPromptContext = createAskUserTurnPromptContext({
  runtime,
  sessionKey,
  userText: "1. all\n2. yes",
});
const legacyBatchQueueEmptyAfterResolve = sessionStore.size(sessionKey) === 0;
runtime.registerPendingAsk(sessionKey, nextEnvelope);
runtime.registerPendingAsk(sessionKey, thirdEnvelope);
const partialBatchPromptContext = createAskUserTurnPromptContext({
  runtime,
  sessionKey,
  userText: "1. all",
});
const partialBatchLeavesOnePending = sessionStore.size(sessionKey) === 1;
sessionStore.delete(sessionKey);
runtime.registerPendingAsk(sessionKey, nextEnvelope);
runtime.registerPendingAsk(sessionKey, thirdEnvelope);
const invalidBatchPromptContext = createAskUserTurnPromptContext({
  runtime,
  sessionKey,
  userText: "1. all\n3. yes",
});
const invalidBatchLeavesOnePending = sessionStore.size(sessionKey) === 1;
sessionStore.delete(sessionKey);
runtime.registerPendingAsk(sessionKey, nextEnvelope);
runtime.registerPendingAsk(sessionKey, thirdEnvelope);
const jsonEncodedBatchPromptContext = createAskUserTurnPromptContext({
  runtime,
  sessionKey,
  userText: `1. ${JSON.stringify("1. draft\n2. confirm")}\n2. ${JSON.stringify("yes")}`,
});
const jsonEncodedBatchQueueEmptyAfterResolve = sessionStore.size(sessionKey) === 0;
runtime.registerPendingAsk(sessionKey, nextEnvelope);
runtime.registerPendingAsk(sessionKey, thirdEnvelope);
const notesBatchPromptContext = createAskUserTurnPromptContext({
  runtime,
  sessionKey,
  userText: batchAnswerTextWithNotes,
});
const notesBatchQueueEmptyAfterResolve = sessionStore.size(sessionKey) === 0;
const secretSessionKey = `${sessionKey}:secret`;
const secretEnvelope = normalizeAskUserEnvelopeFromPayload({
  blocking_node_id: "node.secret",
  questions: [{
    id: "ask_secret_token",
    header: "Secret",
    question: "Paste API token",
    is_secret: true,
  }],
  resume_token: "resume_secret",
});
if (!secretEnvelope) {
  throw new Error("failed to normalize secret ask_user payload");
}
const secretState = createAskUserQuestionnaireState({
  answers: {
    [secretEnvelope.askId]: "sk-live-secret",
  },
  textInputValue: "sk-live-secret",
});
const secretReviewView = buildAskUserQuestionnaireView({
  queue: [secretEnvelope],
  state: {
    ...secretState,
    mode: "review",
  },
});
const secretQuestionView = buildAskUserQuestionnaireView({
  queue: [secretEnvelope],
  state: secretState,
});
const secretReviewMenuDescriptor = buildAskUserReviewMenuDescriptor({
  queue: [secretEnvelope],
  answers: {
    [secretEnvelope.askId]: "sk-live-secret",
  },
});
const secretBatchAnswerText = buildAskUserBatchAnswerText({
  queue: [secretEnvelope],
  answers: {
    [secretEnvelope.askId]: "sk-live-secret",
  },
});
runtime.registerPendingAsk(secretSessionKey, secretEnvelope);
const secretPromptContext = createAskUserTurnPromptContext({
  runtime,
  sessionKey: secretSessionKey,
  userText: "sk-live-secret",
});
if (!secretPromptContext.resolvedAsk) {
  throw new Error("expected secret ask_user context");
}
const normalizedBatchEnvelopes = normalizeAskUserEnvelopesFromPayload({
  blocking_node_id: "node.multi",
  question_total: 2,
  questions: [{
    id: "ask_multi_scope",
    header: "Scope",
    question: "Pick scope",
    question_index: 1,
    options: ["gateway", "all"],
  }, {
    id: "ask_multi_notes",
    header: "Notes",
    question: "Need private notes?",
    question_index: 2,
    is_secret: "true",
    options: [{
      label: "yes",
      value: "yes",
      is_other: false,
    }],
  }],
  default_on_timeout: "gateway",
  resume_token: "resume_multi",
  created_at: "2026-04-27T00:00:00.000Z",
});

const payload = {
  protocol_prefix_removed: promptContext.promptParts.every((part) => part.includes("[AskUser Resolution]")),
  resolution_prompt_injected: promptContext.promptParts.some((part) => part.includes("[AskUser Resolution]")),
  resolution_prompt_builder_works: resolutionPrompt.includes("ask_id=ask_q_001"),
  resolved_answer: promptContext.resolvedAsk.answer,
  resolved_event_has_ask_id: formatAskUserResolvedEvent(promptContext.resolvedAsk).includes("ask_id=ask_q_001"),
  issued_registered: issuedRegistered,
  queue_size_after_enqueue: queueSizeAfterEnqueue,
  queue_dedupe_keeps_size: queueSizeAfterEnqueue === 2,
  queue_resolve_first_matches_q2: queuedStepOne.resolvedAsk?.envelope.askId === "ask_q_002",
  queue_next_after_resolve_is_q3: queueNextAfterResolveIsQ3,
  queue_size_after_resolve: queueSizeAfterResolve,
  queue_midway_prompt_deferred: queuedStepOne.promptParts.length === 0,
  queue_final_prompt_released: queuedStepTwo.promptParts.some((part) =>
    part.includes("question_count=2")
    && part.includes("ask_1_id=ask_q_002")
    && part.includes("ask_2_id=ask_q_003")),
  queue_empty_after_batch_resolved: queueEmptyAfterBatchResolved,
  answer_numeric_index_maps_option: resolvedByIndex?.resolvedAsk.answer === "fast",
  answer_full_width_index_maps_option: resolvedByFullWidthIndex?.resolvedAsk.answer === "fast",
  answer_case_insensitive_option_maps_canonical: resolvedByOptionText?.resolvedAsk.answer === "fast",
  answer_other_literal_is_custom: resolvedByOtherLiteral?.resolvedAsk.answer === "Other",
  answer_other_id_literal_is_custom: resolvedByOtherIdLiteral?.resolvedAsk.answer === "__other__",
  answer_out_of_range_index_is_custom: resolvedByOutOfRangeIndex?.resolvedAsk.answer === "3",
  answer_blank_falls_back_default: resolvedByBlank?.resolvedAsk.answer === "safe",
  queue_ttl_prune_removed_expired: expiredByTtl.length === 1 && expiredByTtl[0]?.askId === "ask_q_005",
  queue_ttl_prune_keeps_fresh: remainingAfterTtlPrune.length === 1 && remainingAfterTtlPrune[0]?.askId === "ask_q_006",
  issued_display_has_reply_hint: display.includes("Enter open picker"),
  issued_display_has_reply_guide: display.includes("number direct reply"),
  issued_display_uses_prompt_chevron: display.includes("❯ 1"),
  issued_display_has_other_type_something:
    display.includes("Custom  Type custom reply")
    && display.includes("Custom"),
  issued_display_shows_question_progress: describedDisplay.includes("Scope · 1/2"),
  issued_display_shows_option_description:
    describedDisplay.includes("safe — Run checks before continuing"),
  issued_display_hides_resume_token: !display.includes("resume_token"),
  issued_display_compact_options: !display.includes("\noptions:\n"),
  issued_display_hides_log_prefix: !display.includes("[ask-user]"),
  issued_display_hides_options_preview: !display.includes("options_preview: "),
  issued_display_hides_raw_question_prefix: !display.includes("question="),
  issued_display_uses_confirmation_card: display.includes("Input needed ·"),
  issued_display_overflow_lists_sixth_option: overflowDisplay.includes("还有 0 项") === false
    && overflowDisplay.includes("Custom  Type custom reply")
    && overflowDisplay.includes("... 1 more"),
  issued_display_sanitizes_untrusted_text:
    unsafeDisplay.includes("Input needed · Scope")
    && unsafeDisplay.includes("Choose mode before continuing")
    && unsafeDisplay.includes("safe — Run checks before continuing")
    && unsafeDisplay.includes("fast — Skip optional checks")
    && !unsafeDisplay.includes("\u001B")
    && !unsafeDisplay.includes("\u202E")
    && !unsafeDisplay.includes("\u0000")
    && !unsafeDisplay.includes("]0;pwnd"),
  options_preview_sanitizes_untrusted_text:
    unsafeOptionsPreview.preview.includes("1:1. safe")
    && unsafeOptionsPreview.preview.includes("2:fast")
    && !unsafeOptionsPreview.preview.includes("\u001B")
    && !unsafeOptionsPreview.preview.includes("\u202E")
    && !unsafeOptionsPreview.preview.includes("]0;pwnd"),
  issued_event_has_ask_id: formatAskUserIssuedEvent(nextEnvelope).includes("ask_id=ask_q_002"),
  ask_user_menu_title_has_progress:
    askUserMenuDescriptor?.title.includes("Scope · 1/2") === true,
  ask_user_menu_hint_returns_to_input:
    askUserMenuDescriptor?.hint.includes("Esc back to input") === true,
  ask_user_menu_omits_noisy_default_descriptions:
    askUserMenuDescriptor?.items.every((item) =>
      item.description !== "选择后立即继续当前任务") === true,
  ask_user_menu_preserves_option_descriptions:
    askUserMenuDescriptor?.items[0]?.description === "Run checks before continuing",
  ask_user_queue_display_shows_progress:
    askUserQueueDisplay.includes("Input needed · Scope · 1/2")
    && askUserQueueDisplay.includes("[□ Scope]"),
  ask_user_queue_display_hides_raw_diagnostics:
    !askUserQueueDisplay.includes("[ask-user]")
    && !askUserQueueDisplay.includes("question=")
    && !askUserQueueDisplay.includes("resume_token"),
  ask_user_queue_display_sanitizes_untrusted_text:
    unsafeQueueDisplay.includes("Input needed · Scope")
    && unsafeQueueDisplay.includes("Choose mode before continuing")
    && unsafeQueueDisplay.includes("safe — Run checks before continuing")
    && unsafeQueueDisplay.includes("Custom — custom value")
    && !unsafeQueueDisplay.includes("\u001B")
    && !unsafeQueueDisplay.includes("\u202E")
    && !unsafeQueueDisplay.includes("\u0000")
    && !unsafeQueueDisplay.includes("]0;pwnd"),
  ask_user_menu_descriptor_sanitizes_untrusted_text:
    unsafeMenuDescriptor?.title.includes("Input needed · Scope") === true
    && unsafeMenuDescriptor?.subtitle.includes("Choose mode before continuing") === true
    && unsafeMenuDescriptor?.items.some((item) =>
      item.label === "safe"
      && item.description === "Run checks before continuing") === true
    && unsafeMenuDescriptor?.items.every((item) =>
      !JSON.stringify(item).includes("\u001B")
      && !JSON.stringify(item).includes("\u202E")
      && !JSON.stringify(item).includes("\u0000")
      && !JSON.stringify(item).includes("]0;pwnd")) === true,
  ask_user_review_surface_sanitizes_untrusted_text:
    unsafeReviewView.kind === "review"
    && unsafeReviewView.reviewItems.some((item) =>
      item.question === "Choose mode before continuing"
      && item.answer === "safe answer")
    && !JSON.stringify(unsafeReviewView).includes("\u001B")
    && !JSON.stringify(unsafeReviewView).includes("\u202E")
    && !JSON.stringify(unsafeReviewView).includes("\u0000")
    && !JSON.stringify(unsafeReviewMenuDescriptor).includes("\u001B")
    && !JSON.stringify(unsafeReviewMenuDescriptor).includes("\u202E")
    && !JSON.stringify(unsafeReviewMenuDescriptor).includes("\u0000"),
  questionnaire_navigation_prev_stays_in_bounds:
    questionnairePreviousQuestionState.currentQuestionIndex === 0,
  questionnaire_navigation_option_wraps:
    reduceAskUserQuestionnaire(questionnaireInitialState, {
      type: "previous_option",
      optionCount: describedEnvelope.optionsDetailed.length,
    }).focusedOptionIndex === describedEnvelope.optionsDetailed.length - 1,
  questionnaire_answer_focused_advances:
    questionnaireAnsweredState.currentQuestionIndex === 1
    && questionnaireAnsweredState.answers[describedEnvelope.askId] === "fast",
  questionnaire_view_has_question_tabs:
    questionnaireView.kind === "question"
    && questionnaireView.navigationText.includes("[□ Scope]")
    && questionnaireView.optionItems.length === 3,
  questionnaire_view_has_other_input_option:
    questionnaireView.kind === "question"
    && questionnaireView.optionItems.some((item) =>
      item.kind === "other"
      && item.label === "Custom"
      && item.placeholder === "Type custom reply"
      && item.id === "__other__"),
  questionnaire_review_available:
    questionnaireReviewView.kind === "review"
    && questionnaireReviewView.reviewItems.some((item) => item.answer === "fast"),
  questionnaire_selection_maps_canonical_value: selectedAnswerFromInteraction === "fast",
  questionnaire_batch_answer_text_is_numbered:
    batchAnswerText === "1. \"all\"\n2. \"yes\"",
  questionnaire_batch_answer_text_supports_notes:
    batchAnswerTextWithNotes === "1. {\"answer\":\"all\",\"notes\":\"limit to gateway TUI\"}\n2. \"yes\"",
  normalize_payload_returns_all_questions:
    normalizedBatchEnvelopes.length === 2
    && normalizedBatchEnvelopes[0]?.askId === "ask_multi_scope"
    && normalizedBatchEnvelopes[1]?.askId === "ask_multi_notes",
  normalize_payload_preserves_question_metadata:
    normalizedBatchEnvelopes[0]?.questionIndex === 1
    && normalizedBatchEnvelopes[0]?.questionTotal === 2
    && normalizedBatchEnvelopes[1]?.isSecret === true
    && normalizedBatchEnvelopes[1]?.optionsDetailed[0]?.isOther === false,
  secret_question_view_marks_secret:
    secretQuestionView.kind === "question"
    && secretQuestionView.isSecret === true,
  secret_review_view_masks_answer:
    secretReviewView.kind === "review"
    && secretReviewView.reviewItems[0]?.answer === ASK_USER_SECRET_DISPLAY_VALUE
    && !JSON.stringify(secretReviewView).includes("sk-live-secret"),
  secret_review_menu_masks_answer:
    secretReviewMenuDescriptor.items.some((item) => item.description === ASK_USER_SECRET_DISPLAY_VALUE)
    && !JSON.stringify(secretReviewMenuDescriptor).includes("sk-live-secret"),
  secret_batch_answer_text_keeps_current_prompt_value:
    secretBatchAnswerText.includes("sk-live-secret"),
  secret_prompt_context_marks_secret:
    secretPromptContext.hasSecretAnswers
    && secretPromptContext.secretAnswerCount === 1
    && secretPromptContext.promptParts.some((part) =>
      part.includes("ask_1_is_secret=true")
      && part.includes("ask_1_answer=sk-live-secret")),
  secret_safe_user_text_redacts_answer:
    secretPromptContext.safeUserText.includes(ASK_USER_SECRET_PERSISTENCE_VALUE)
    && !secretPromptContext.safeUserText.includes("sk-live-secret"),
  secret_persistence_answer_redacted:
    formatAskUserResolvedAnswerForPersistence(secretPromptContext.resolvedAsk) === ASK_USER_SECRET_PERSISTENCE_VALUE
    && buildAskUserSafeUserText({
      rawUserText: "sk-live-secret",
      resolvedAsks: secretPromptContext.resolvedAsks,
    }).includes(ASK_USER_SECRET_PERSISTENCE_VALUE),
  questionnaire_review_menu_has_submit_and_edit:
    reviewMenuDescriptor.items[0]?.id === "__submit"
    && reviewMenuDescriptor.items.some((item) => item.id === "edit:1")
    && reviewMenuDescriptor.items.some((item) => item.id === "__cancel"),
  batch_numbered_answers_release_prompt:
    batchPromptContext.promptParts.some((part) => part.includes("question_count=2")),
  batch_numbered_answers_resolve_all:
    batchPromptContext.resolvedAsks.length === 2
    && batchPromptContext.resolvedAsks[0]?.answer === "all"
    && batchPromptContext.resolvedAsks[1]?.answer === "yes"
    && batchQueueEmptyAfterResolve,
  batch_legacy_numbered_answers_still_resolve_all:
    legacyBatchPromptContext.resolvedAsks.length === 2
    && legacyBatchPromptContext.resolvedAsks[0]?.answer === "all"
    && legacyBatchPromptContext.resolvedAsks[1]?.answer === "yes"
    && legacyBatchQueueEmptyAfterResolve,
  batch_partial_numbered_answer_does_not_release_prompt:
    partialBatchPromptContext.resolvedAsks.length === 1
    && partialBatchPromptContext.promptParts.length === 0
    && partialBatchLeavesOnePending,
  batch_invalid_numbered_answer_does_not_release_prompt:
    invalidBatchPromptContext.resolvedAsks.length === 1
    && invalidBatchPromptContext.promptParts.length === 0
    && invalidBatchLeavesOnePending,
  batch_json_encoded_custom_answer_stays_single_answer:
    jsonEncodedBatchPromptContext.resolvedAsks.length === 2
    && jsonEncodedBatchPromptContext.resolvedAsks[0]?.answer === "1. draft 2. confirm"
    && jsonEncodedBatchPromptContext.resolvedAsks[1]?.answer === "yes"
    && jsonEncodedBatchQueueEmptyAfterResolve,
  batch_notes_payload_resolves_answers:
    notesBatchPromptContext.resolvedAsks.length === 2
    && notesBatchPromptContext.resolvedAsks[0]?.answer === "all"
    && notesBatchPromptContext.resolvedAsks[1]?.answer === "yes"
    && notesBatchQueueEmptyAfterResolve,
  batch_notes_payload_injects_notes_prompt:
    notesBatchPromptContext.promptParts.some((part) =>
      part.includes("[AskUser Notes]")
      && part.includes("ask_1_id=ask_q_002")
      && part.includes("ask_1_notes=limit to gateway TUI")),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
