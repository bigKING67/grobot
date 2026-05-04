import { resolveRewindQueryMatches } from "../../start/session-rewind-search";
import {
  type SessionInteractiveAction,
  type SessionInteractiveRewindCheckpointSummary,
} from "../../start/session-interactive";
import { terminalStyle } from "../../tui/theme/terminal-style";
import { parseRewindCommand } from "./parsers";
import {
  buildSlashNotice,
  formatSingleLinePreview,
  writeMenuHintAndMaybeOpen,
} from "./shared";
import { type SlashCommandExecutionInput } from "./types";

const MATCH_LIST_LIMIT = 5;
const QUICK_PICK_HINT_LIMIT = 3;

function formatMatchOverflow(totalCount: number, listedCount: number): string {
  if (totalCount <= listedCount) {
    return "";
  }
  return `\n- ... 还有 ${String(totalCount - listedCount)} 项`;
}

function formatQuickPickBlock(quickPickHints: readonly string[]): string {
  if (quickPickHints.length <= 0) {
    return "";
  }
  return `\n快速选择:\n${quickPickHints.join("\n")}`;
}

export function formatDisambiguationBlock(
  totalCount: number,
  listedCount: number,
  quickPickHints: readonly string[],
): string {
  return `${formatMatchOverflow(totalCount, listedCount)}${formatQuickPickBlock(quickPickHints)}`;
}

function buildRewindNoMatchMessage(
  query: string,
  command: "/rewind" | "/checkpoint",
  activeSessionId: string,
): string {
  return buildSlashNotice("没有匹配的检查点", [
    `会话: ${activeSessionId}`,
    `查询: ${query}`,
    `使用 ${command} 打开菜单。`,
    '提示：可匹配检查点 ID、创建时间、用户文本或助手回复；紧凑查询会忽略空格、"_" 和 "-"。',
  ]);
}

export async function executeRewindSlashCommand(
  input: SlashCommandExecutionInput,
  command: "/rewind" | "/checkpoint",
): Promise<SessionInteractiveAction> {
  const parsed = parseRewindCommand(input.userInput, command);
  if (parsed.kind === "invalid") {
    return writeMenuHintAndMaybeOpen(
      input,
      "rewind",
      buildSlashNotice(`${command} 命令不可用`, [
        parsed.reason ?? `${command} 命令无效`,
      ]),
    );
  }
  if (parsed.kind === "menu") {
    await input.handlers.openSessionMenu(
      "rewind",
      input.controls.withInputPaused,
    );
    return "continue";
  }
  const activeSessionId = input.handlers.getActiveSessionId?.().trim() ?? "";
  if (!activeSessionId) {
    return writeMenuHintAndMaybeOpen(
      input,
      "rewind",
      buildSlashNotice("当前会话不可用于回退", [
        `使用 ${command} 打开菜单。`,
      ]),
    );
  }
  if (!input.handlers.rewindSession) {
    return writeMenuHintAndMaybeOpen(
      input,
      "rewind",
      buildSlashNotice("回退快速路径不可用", [`使用 ${command} 打开菜单。`]),
    );
  }
  if (parsed.kind === "summarize") {
    await input.handlers.rewindSession({
      sessionId: activeSessionId,
      mode: "summarize",
      reason: `slash:${command.slice(1)}:summarize`,
    });
    return "continue";
  }
  const query = parsed.query?.trim() ?? "";
  const checkpoints =
    input.handlers.listRewindCheckpoints?.(activeSessionId, 64) ?? [];
  const matches = resolveRewindQueryMatches(query, checkpoints);
  if (matches.length <= 0) {
    return writeMenuHintAndMaybeOpen(
      input,
      "rewind",
      buildRewindNoMatchMessage(query, command, activeSessionId),
    );
  }
  if (matches.length > 1) {
    const rows = matches
      .slice(0, MATCH_LIST_LIMIT)
      .map((checkpoint: SessionInteractiveRewindCheckpointSummary) =>
        `- ${checkpoint.checkpointId} | ${checkpoint.createdAt} | 文件=${String(
          checkpoint.changedFilesCount,
        )} | 用户=${formatSingleLinePreview(checkpoint.userText, 44)} | 助手=${formatSingleLinePreview(checkpoint.assistantText, 44)}`,
      );
    const quickPickSuffix =
      parsed.mode && parsed.mode !== "both" ? ` ${parsed.mode}` : "";
    const quickPickHints = matches
      .slice(0, QUICK_PICK_HINT_LIMIT)
      .map(
        (checkpoint: SessionInteractiveRewindCheckpointSummary) =>
          `- ${command} ${checkpoint.checkpointId}${quickPickSuffix}`,
      );
    const disambiguationBlock = formatDisambiguationBlock(
      matches.length,
      rows.length,
      quickPickHints,
    );
    return writeMenuHintAndMaybeOpen(
      input,
      "rewind",
      [
        `${terminalStyle.accent("●")} 找到多个匹配的检查点`,
        `  ${terminalStyle.muted(`会话: ${activeSessionId}`)}`,
        `  ${terminalStyle.muted(`查询: ${query}`)}`,
        rows.join("\n"),
        `${disambiguationBlock}`,
        `${terminalStyle.muted(`使用 ${command} 明确选择一个。`)}`,
        "",
      ].join("\n"),
    );
  }
  const target = matches[0];
  await input.handlers.rewindSession({
    sessionId: activeSessionId,
    checkpointId: target.checkpointId,
    mode: parsed.mode ?? "both",
    reason: `slash:${command.slice(1)}:query`,
  });
  return "continue";
}
