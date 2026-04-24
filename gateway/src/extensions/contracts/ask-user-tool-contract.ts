import {
  AskUserSessionStore,
  buildAskUserDisplay,
  buildAskUserResolutionPrompt,
  createAskUserTurnPromptContext,
  formatAskUserIssuedEvent,
  formatAskUserResolvedEvent,
  normalizeAskUserEnvelopeFromPayload,
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
  answer_blank_falls_back_default: resolvedByBlank?.resolvedAsk.answer === "safe",
  queue_ttl_prune_removed_expired: expiredByTtl.length === 1 && expiredByTtl[0]?.askId === "ask_q_005",
  queue_ttl_prune_keeps_fresh: remainingAfterTtlPrune.length === 1 && remainingAfterTtlPrune[0]?.askId === "ask_q_006",
  issued_display_has_reply_hint: display.includes("hint: reply directly with number / option label / free text"),
  issued_display_has_reply_guide: display.includes("hint: reply directly with number / option label / free text"),
  issued_display_hides_resume_token: !display.includes("resume_token"),
  issued_display_compact_options: !display.includes("\noptions:\n"),
  issued_display_has_options_preview: display.includes("options_preview: "),
  issued_display_overflow_mentions_more: overflowDisplay.includes("... +1 more"),
  issued_event_has_ask_id: formatAskUserIssuedEvent(nextEnvelope).includes("ask_id=ask_q_002"),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
