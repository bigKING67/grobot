import { AskUserEnvelope, ResolvedAskUser } from "./schema";

export function buildAskUserResolutionPrompt(input: {
  envelope: AskUserEnvelope;
  answer: string;
}): string {
  return [
    "[AskUser Resolution]",
    `ask_id=${input.envelope.askId}`,
    `blocking_node_id=${input.envelope.blockingNodeId}`,
    `resume_token=${input.envelope.resumeToken}`,
    `user_answer=${input.answer}`,
  ].join("\n");
}

export function buildAskUserResolutionPromptBatch(input: {
  resolvedAsks: readonly ResolvedAskUser[];
}): string {
  const resolvedRows = input.resolvedAsks.filter((row) =>
    typeof row?.answer === "string"
    && row.answer.trim().length > 0
    && typeof row.envelope?.askId === "string"
    && row.envelope.askId.trim().length > 0);
  if (resolvedRows.length <= 0) {
    return "";
  }
  const lines: string[] = [
    "[AskUser Resolution]",
    `question_count=${String(resolvedRows.length)}`,
  ];
  for (let index = 0; index < resolvedRows.length; index += 1) {
    const row = resolvedRows[index];
    const order = index + 1;
    lines.push(`ask_${String(order)}_id=${row.envelope.askId}`);
    lines.push(`ask_${String(order)}_node=${row.envelope.blockingNodeId}`);
    lines.push(`ask_${String(order)}_resume_token=${row.envelope.resumeToken}`);
    if (row.envelope.questionKey) {
      lines.push(`ask_${String(order)}_key=${row.envelope.questionKey}`);
    }
    if (row.envelope.header) {
      lines.push(`ask_${String(order)}_header=${row.envelope.header}`);
    }
    lines.push(`ask_${String(order)}_answer=${row.answer}`);
  }
  return lines.join("\n");
}
