import { terminalStyle } from "../theme/terminal-style";

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
    return "会话被 management API 中断。当前输入已跳过。\n\n";
  }
  return "会话被 management API 中断。当前请求已跳过。\n";
}

export function renderTurnInterruptedNotice(interactiveMode: boolean): string {
  if (interactiveMode) {
    return [
      `${terminalStyle.accent("●")} 回合已中断`,
      `  ${terminalStyle.muted("可以继续输入新指令。")}`,
      "",
      "",
    ].join("\n");
  }
  return `${terminalStyle.accent("●")} 回合已中断\n`;
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
