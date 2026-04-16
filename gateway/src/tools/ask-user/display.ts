import { AskUserEnvelope } from "./schema";

export function buildAskUserDisplay(envelope: AskUserEnvelope): string {
  const lines = [
    `[ask-user] question_id=${envelope.questionId} blocking_node_id=${envelope.blockingNodeId}`,
    envelope.question,
  ];
  if (envelope.options.length > 0) {
    lines.push("options:");
    for (let index = 0; index < envelope.options.length; index += 1) {
      lines.push(`${String(index + 1)}. ${envelope.options[index]}`);
    }
  }
  lines.push(`default_on_timeout: ${envelope.defaultOnTimeout}`);
  lines.push(`resume_token: ${envelope.resumeToken}`);
  lines.push("reply with your choice or direct answer to continue.");
  return `${lines.join("\n")}\n`;
}
