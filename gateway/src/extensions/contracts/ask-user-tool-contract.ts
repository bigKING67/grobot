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
  question_id: "ask_q_001",
  blocking_node_id: "node.runtime.route",
  question: "Choose execution mode",
  options: ["safe", "fast"],
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
  question_id: "ask_q_002",
  blocking_node_id: "node.confirm.scope",
  question: "Need project scope?",
  options: ["core", "all"],
  default_on_timeout: "core",
  resume_token: "resume_002",
});
if (!nextEnvelope) {
  throw new Error("failed to normalize next ask_user payload");
}
runtime.registerPendingAsk(sessionKey, nextEnvelope);
const thirdEnvelope = normalizeAskUserEnvelopeFromPayload({
  question_id: "ask_q_003",
  blocking_node_id: "node.confirm.risk",
  question: "Need risk review?",
  options: ["yes", "no"],
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
const resolutionPrompt = buildAskUserResolutionPrompt({
  envelope: pendingEnvelope,
  answer: "fast",
});
const issuedRegistered = sessionStore.get(sessionKey)?.questionId === "ask_q_002";
const queueSizeAfterEnqueue = sessionStore.size(sessionKey);
const dismissed = sessionStore.dismissCurrent(sessionKey);
const queueNextAfterDismissIsQ3 = sessionStore.get(sessionKey)?.questionId === "ask_q_003";
const queueListSizeAfterDismiss = sessionStore.list(sessionKey).length;
const removedByClear = sessionStore.clear(sessionKey);
const optionEnvelope = normalizeAskUserEnvelopeFromPayload({
  question_id: "ask_q_004",
  blocking_node_id: "node.answer.by_index",
  question: "Select execution profile",
  options: ["safe", "fast"],
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
const parkEnvelopeFirst = normalizeAskUserEnvelopeFromPayload({
  question_id: "ask_q_007",
  blocking_node_id: "node.park.first",
  question: "First park question",
  options: ["yes", "no"],
  default_on_timeout: "no",
  resume_token: "resume_007",
});
const parkEnvelopeSecond = normalizeAskUserEnvelopeFromPayload({
  question_id: "ask_q_008",
  blocking_node_id: "node.park.second",
  question: "Second park question",
  options: ["yes", "no"],
  default_on_timeout: "yes",
  resume_token: "resume_008",
});
if (!parkEnvelopeFirst || !parkEnvelopeSecond) {
  throw new Error("failed to normalize park ask_user payload");
}
sessionStore.set(sessionKey, parkEnvelopeFirst);
sessionStore.set(sessionKey, parkEnvelopeSecond);
const parkedCurrent = sessionStore.parkCurrent(sessionKey);
const queueAfterPark = sessionStore.list(sessionKey);
sessionStore.clear(sessionKey);
const expiredEnvelope = normalizeAskUserEnvelopeFromPayload({
  question_id: "ask_q_005",
  blocking_node_id: "node.expired",
  question: "Expired question",
  options: ["yes", "no"],
  default_on_timeout: "no",
  resume_token: "resume_005",
  createdAt: "2026-01-01T00:00:00.000Z",
});
const freshEnvelope = normalizeAskUserEnvelopeFromPayload({
  question_id: "ask_q_006",
  blocking_node_id: "node.fresh",
  question: "Fresh question",
  options: ["yes", "no"],
  default_on_timeout: "yes",
  resume_token: "resume_006",
  createdAt: "2026-01-01T00:00:12.000Z",
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
sessionStore.clear(sessionKey);

const payload = {
  protocol_prefix_removed: promptContext.promptParts.every((part) => part.includes("[AskUser Resolution]")),
  resolution_prompt_injected: promptContext.promptParts.some((part) => part.includes("[AskUser Resolution]")),
  resolution_prompt_builder_works: resolutionPrompt.includes("question_id=ask_q_001"),
  resolved_answer: promptContext.resolvedAsk.answer,
  resolved_event_has_question_id: formatAskUserResolvedEvent(promptContext.resolvedAsk).includes("question_id=ask_q_001"),
  issued_registered: issuedRegistered,
  queue_size_after_enqueue: queueSizeAfterEnqueue,
  queue_dedupe_keeps_size: queueSizeAfterEnqueue === 2,
  queue_dismiss_first_matches_q2: dismissed?.questionId === "ask_q_002",
  queue_next_after_dismiss_is_q3: queueNextAfterDismissIsQ3,
  queue_list_size_after_dismiss: queueListSizeAfterDismiss,
  queue_clear_removed_count: removedByClear,
  queue_empty_after_clear: sessionStore.size(sessionKey) === 0,
  answer_numeric_index_maps_option: resolvedByIndex?.answer === "fast",
  answer_full_width_index_maps_option: resolvedByFullWidthIndex?.answer === "fast",
  answer_case_insensitive_option_maps_canonical: resolvedByOptionText?.answer === "fast",
  answer_blank_falls_back_default: resolvedByBlank?.answer === "safe",
  queue_park_rotates_active: parkedCurrent?.questionId === "ask_q_007",
  queue_park_next_is_second: queueAfterPark[0]?.questionId === "ask_q_008",
  queue_park_tail_is_first: queueAfterPark[1]?.questionId === "ask_q_007",
  queue_ttl_prune_removed_expired: expiredByTtl.length === 1 && expiredByTtl[0]?.questionId === "ask_q_005",
  queue_ttl_prune_keeps_fresh: remainingAfterTtlPrune.length === 1 && remainingAfterTtlPrune[0]?.questionId === "ask_q_006",
  issued_display_has_reply_hint: display.includes("reply directly or use /ask answer"),
  issued_display_hides_resume_token: !display.includes("resume_token"),
  issued_event_has_question_id: formatAskUserIssuedEvent(nextEnvelope).includes("question_id=ask_q_002"),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
