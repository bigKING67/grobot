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
const display = runtime.buildAskUserDisplay(nextEnvelope);
const resolutionPrompt = buildAskUserResolutionPrompt({
  envelope: pendingEnvelope,
  answer: "fast",
});

const payload = {
  protocol_prefix_removed: promptContext.promptParts.every((part) => part.includes("[AskUser Resolution]")),
  resolution_prompt_injected: promptContext.promptParts.some((part) => part.includes("[AskUser Resolution]")),
  resolution_prompt_builder_works: resolutionPrompt.includes("question_id=ask_q_001"),
  resolved_answer: promptContext.resolvedAsk.answer,
  resolved_event_has_question_id: formatAskUserResolvedEvent(promptContext.resolvedAsk).includes("question_id=ask_q_001"),
  issued_registered: sessionStore.get(sessionKey)?.questionId === "ask_q_002",
  issued_display_has_reply_hint: display.includes("reply with your choice"),
  issued_event_has_question_id: formatAskUserIssuedEvent(nextEnvelope).includes("question_id=ask_q_002"),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
