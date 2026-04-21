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
  issued_display_has_reply_hint: display.includes("reply with your choice"),
  issued_event_has_question_id: formatAskUserIssuedEvent(nextEnvelope).includes("question_id=ask_q_002"),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
