export function buildPlanApplyPrompt(input: {
  approvedPlanContent: string;
  approvedHash: string;
  ticketId: string;
  extra?: string;
}): string {
  const lines = [
    "[Approved Plan Execution]",
    "",
    "Plan approval:",
    `- ticket: ${input.ticketId}`,
    `- sha256: ${input.approvedHash}`,
    "",
    "Execution contract:",
    "- Implement only the approved plan below.",
    "- Treat the approved snapshot as the source of truth.",
    "- Do not silently expand scope beyond Scope In or ignore Scope Out.",
    "- If current files conflict with the approved plan, stop and return to plan mode with the conflict.",
    "- Keep implementation and validation aligned with the plan's Milestones and Validation sections.",
    "- After implementation, report changed files, validation commands, results, and unresolved risks.",
    "",
    "Plan to implement:",
    "<approved_plan>",
    input.approvedPlanContent.trim(),
    "</approved_plan>",
  ];
  const extraText = input.extra?.trim();
  if (extraText) {
    lines.push("");
    lines.push("Additional user instruction:");
    lines.push(extraText);
  }
  return lines.join("\n");
}
