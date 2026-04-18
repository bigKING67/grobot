interface RuntimeFailureEntry {
  providerName: string;
  errorClass: string;
  errorMessage: string;
}

interface RuntimeFailureSummaryInput {
  failures: readonly RuntimeFailureEntry[];
  orderedProviders: readonly { name: string }[];
}

export function renderManagementInterruptNotice(interactiveMode: boolean): string {
  if (interactiveMode) {
    return "Session interrupted by management API. Current input skipped.\n\n";
  }
  return "Session interrupted by management API. Current request skipped.\n";
}

export function renderTurnInterruptedNotice(interactiveMode: boolean): string {
  if (interactiveMode) {
    return "[interrupt] turn interrupted. You can send a new instruction.\n\n";
  }
  return "[interrupt] turn interrupted.\n";
}

export function renderRuntimeFailureSummary(input: RuntimeFailureSummaryInput): string {
  const failureSummary = input.failures
    .map((item) => `${item.providerName}:${item.errorClass}`)
    .join(", ");
  const attemptedProviders = input.orderedProviders.map((item) => item.name).join(" -> ");
  const lines: string[] = [];
  lines.push(
    `[runtime-route] failed attempts=${String(input.failures.length)} providers=${attemptedProviders || "<none>"} errors=${failureSummary || "<none>"}`,
  );
  if (input.failures.length > 0) {
    const last = input.failures[input.failures.length - 1];
    lines.push(`runtime failed: provider=${last.providerName} ${last.errorMessage}`);
  }
  return `${lines.join("\n")}\n`;
}
