import { AskUserEnvelope } from "./schema";

export function buildAskUserResolutionPrompt(input: {
  envelope: AskUserEnvelope;
  answer: string;
}): string {
  return [
    "[AskUser Resolution]",
    `question_id=${input.envelope.questionId}`,
    `blocking_node_id=${input.envelope.blockingNodeId}`,
    `resume_token=${input.envelope.resumeToken}`,
    `user_answer=${input.answer}`,
  ].join("\n");
}
