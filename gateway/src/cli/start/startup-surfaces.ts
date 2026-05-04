import { terminalStyle } from "../tui/theme/terminal-style";

export function formatDiagnosticToken(
  value: string | undefined,
  fallback = "<none>",
): string {
  const normalized = (value ?? fallback)
    .replace(/[^\x20-\x7E]+/g, "_")
    .replace(/\s+/g, "_")
    .trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, 360);
}

function humanizeInterruptSource(source: "command" | "cli_esc"): string {
  return source === "cli_esc" ? "Esc" : "/interrupt";
}

export function buildRuntimeInterruptSurface(input: {
  code: string;
  kind: "requested" | "not_running";
  source: "command" | "cli_esc";
}): string {
  const sourceLabel = humanizeInterruptSource(input.source);
  const lines: string[] = [];
  if (input.kind === "requested") {
    lines.push(
      `${terminalStyle.accent("●")} 已请求中断当前回合`,
      `  ${terminalStyle.muted(`来源: ${sourceLabel} · 正在尝试安全停止。`)}`,
    );
  } else {
    lines.push(
      `${terminalStyle.accent("●")} 当前没有运行中的回合`,
      `  ${terminalStyle.muted(`${sourceLabel} 只会中断正在运行的回合。`)}`,
    );
  }
  lines.push(`  ${terminalStyle.muted(`诊断: ${input.code}`)}`, "");
  return lines.join("\n");
}

export function buildRuntimeInterruptIgnoredSurface(input: {
  source: "command" | "cli_esc";
}): string {
  const sourceLabel = humanizeInterruptSource(input.source);
  return [
    `${terminalStyle.accent("●")} 中断请求未生效`,
    `  ${terminalStyle.muted(`${sourceLabel} 请求发出时，当前回合已完成或已过安全中断点。`)}`,
    "",
  ].join("\n");
}

export function buildRuntimeToolsFallbackSurface(input: {
  reason: string | undefined;
  source: string;
}): string {
  const details = ["已使用内置工具 schema 启动。", `来源: ${input.source}`];
  if (input.reason && input.reason.trim().length > 0) {
    details.push(`原因: ${formatDiagnosticToken(input.reason)}`);
  }
  details.push("如需完整诊断，可运行 grobot status --json。");
  const lines = [`${terminalStyle.accent("●")} 运行时工具描述不可用`];
  for (const detail of details) {
    lines.push(`  ${terminalStyle.muted(detail)}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function buildMcpInstructionStrictFailureSurface(
  reason: string | undefined,
): string {
  const lines = [`${terminalStyle.accent("●")} MCP 指令加载失败`];
  lines.push(
    `  ${terminalStyle.muted("strict 模式要求所有启用的 MCP 都有指令包。")}`,
  );
  if (reason && reason.trim().length > 0) {
    lines.push(
      `  ${terminalStyle.muted(`原因: ${formatDiagnosticToken(reason)}`)}`,
    );
  }
  lines.push(
    `  ${terminalStyle.muted("请补齐 .grobot/rules/mcp/<server>.md，或关闭 mcp.instructions.strict。")}`,
  );
  lines.push("");
  return lines.join("\n");
}

export function buildExperienceSchedulerTickErrorSurface(
  error: string | undefined,
): string {
  const lines = [`${terminalStyle.accent("●")} 经验任务调度失败`];
  lines.push(
    `  ${terminalStyle.muted("后台任务本轮已跳过，不影响当前输入。")}`,
  );
  if (error && error.trim().length > 0) {
    lines.push(
      `  ${terminalStyle.muted(`原因: ${formatDiagnosticToken(error)}`)}`,
    );
  }
  lines.push(
    `  ${terminalStyle.muted("如需完整诊断，可设置 GROBOT_STARTUP_DIAGNOSTICS=1 后重试。")}`,
  );
  lines.push("");
  return lines.join("\n");
}

export function buildExperienceSchedulerTaskFailedSurface(input: {
  taskId: string;
  error: string | undefined;
}): string {
  const lines = [`${terminalStyle.accent("●")} 经验任务执行失败`];
  lines.push(`  ${terminalStyle.muted(`任务: ${input.taskId || "未知任务"}`)}`);
  lines.push(
    `  ${terminalStyle.muted("本轮调度已记录失败，不影响继续输入。")}`,
  );
  if (input.error && input.error.trim().length > 0) {
    lines.push(
      `  ${terminalStyle.muted(`原因: ${formatDiagnosticToken(input.error)}`)}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function buildMemoryMaintenanceFailedSurface(input: {
  reason: string;
  error: string | undefined;
}): string {
  const lines = [`${terminalStyle.accent("●")} 记忆维护失败`];
  lines.push(`  ${terminalStyle.muted(`阶段: ${input.reason || "unknown"}`)}`);
  lines.push(
    `  ${terminalStyle.muted("本轮对话会继续，后台记忆清理将在后续回合重试。")}`,
  );
  if (input.error && input.error.trim().length > 0) {
    lines.push(
      `  ${terminalStyle.muted(`原因: ${formatDiagnosticToken(input.error)}`)}`,
    );
  }
  lines.push(
    `  ${terminalStyle.muted("如需完整诊断，可设置 GROBOT_STARTUP_DIAGNOSTICS=1 后重试。")}`,
  );
  lines.push("");
  return lines.join("\n");
}

export function buildRewindCaptureFailedSurface(
  error: string | undefined,
): string {
  const lines = [`${terminalStyle.accent("●")} 检查点保存失败`];
  lines.push(
    `  ${terminalStyle.muted("本轮对话已继续，但这一步无法用于 /rewind 回退。")}`,
  );
  if (error && error.trim().length > 0) {
    lines.push(
      `  ${terminalStyle.muted(`原因: ${formatDiagnosticToken(error)}`)}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
