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

export function renderRuntimeOpenCircuitNotice(interactiveMode: boolean): string {
  const lines = [
    `${terminalStyle.accent("●")} 所有模型通道暂不可用`,
    `  ${terminalStyle.muted("当前没有可尝试的模型通道。")}`,
  ];
  if (interactiveMode) {
    lines.push(`  ${terminalStyle.muted("可以稍后重试，或使用 /model 切换模型。")}`, "", "");
  } else {
    lines.push(`  ${terminalStyle.muted("可以稍后重试，或切换模型后再执行。")}`, "");
  }
  return lines.join("\n");
}

export function renderRuntimeFailureSummary(input: RuntimeFailureSummaryInput): string {
  const failureSummary = input.failures
    .map((item) => `${item.providerName} · ${item.errorClass}`)
    .join(", ");
  const attemptedProviders = input.orderedProviders.map((item) => item.name).join(" -> ");
  const lines: string[] = [];
  lines.push(`${terminalStyle.accent("●")} 回合执行失败`);
  lines.push(
    `  ${terminalStyle.muted(`已尝试: ${attemptedProviders || "无可用运行方"}`)}`,
  );
  lines.push(
    `  ${terminalStyle.muted(`失败: ${failureSummary || "无错误明细"}`)}`,
  );
  if (input.failures.length > 0) {
    const last = input.failures[input.failures.length - 1];
    lines.push(`  ${terminalStyle.muted(`最后错误: ${last.providerName} · ${last.errorClass}`)}`);
    lines.push(`  ${terminalStyle.muted(last.errorMessage)}`);
  }
  return `${lines.join("\n")}\n`;
}
