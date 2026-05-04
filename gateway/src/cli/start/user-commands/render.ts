import { terminalStyle } from "../../tui/theme/terminal-style";
import { type UserCommandRecord } from "./contract";

export function buildCommandsSurface(input: {
  title: string;
  details?: readonly string[];
}): string {
  const lines = [`${terminalStyle.accent("●")} ${input.title}`];
  for (const detail of input.details ?? []) {
    if (detail.length === 0) {
      lines.push("");
    } else {
      lines.push(`  ${terminalStyle.muted(detail)}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function buildCommandsUsageSurface(usage: string): string {
  return buildCommandsSurface({
    title: "用法不完整",
    details: [`用法: ${usage}`],
  });
}

export function formatCommandList(records: readonly UserCommandRecord[], commandsDir: string): string {
  const rows: string[] = [];
  rows.push(`${terminalStyle.accent("●")} 用户自定义命令`);
  rows.push(`  ${terminalStyle.muted(`目录: ${commandsDir}`)}`);
  rows.push(`  ${terminalStyle.muted(`总数: ${String(records.length)}`)}`);
  if (records.length === 0) {
    rows.push(`  ${terminalStyle.muted("状态: 尚未创建用户命令")}`);
    rows.push(`  ${terminalStyle.muted('使用 "/commands new <name> [prompt]" 创建。')}`);
  } else {
    for (const record of records) {
      const summary = record.description.length > 0 ? record.description : "(无描述)";
      rows.push(`  /${record.name}  ${record.enabled ? "启用" : "停用"}  ${summary}`);
    }
  }
  rows.push("");
  rows.push("入口");
  rows.push("  /commands");
  rows.push("");
  rows.push("二级动作");
  rows.push("  /commands list");
  rows.push("  /commands new <name> [prompt]");
  rows.push("  /commands set <name> <prompt>");
  rows.push("  /commands show <name>");
  rows.push("  /commands delete <name>");
  rows.push("  /commands enable <name>");
  rows.push("  /commands disable <name>");
  rows.push("");
  return `${rows.join("\n")}\n`;
}

export function formatCommandDetails(record: UserCommandRecord): string {
  const rows = [
    `${terminalStyle.accent("●")} /${record.name}`,
    `  ${terminalStyle.muted(`状态: ${record.enabled ? "启用" : "停用"}`)}`,
    `  ${terminalStyle.muted(`文件: ${record.path}`)}`,
    `  ${terminalStyle.muted(`描述: ${record.description || "(无描述)"}`)}`,
    "  prompt:",
    record.prompt,
    "",
  ];
  return `${rows.join("\n")}\n`;
}
