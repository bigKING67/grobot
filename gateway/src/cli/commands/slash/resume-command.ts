import { resolveResumeQueryMatches } from "../../start/session-resume-search";
import { type SessionInteractiveAction } from "../../start/session-interactive";
import { parseResumeCommand } from "./parsers";
import {
  buildSlashNotice,
  formatSingleLinePreview,
  writeMenuHintAndMaybeOpen,
} from "./shared";
import { formatDisambiguationBlock } from "./rewind-command";
import { type SlashCommandExecutionInput } from "./types";

const MATCH_LIST_LIMIT = 5;
const QUICK_PICK_HINT_LIMIT = 3;

function buildResumeNoMatchMessage(query: string): string {
  return buildSlashNotice("没有匹配的会话", [
    `查询: ${query}`,
    "使用 /resume 打开菜单。",
    '提示：可匹配 ID、标题、摘要或更新时间；紧凑查询会忽略空格、"_" 和 "-"。',
  ]);
}

export async function executeResumeSlashCommand(
  input: SlashCommandExecutionInput,
): Promise<SessionInteractiveAction> {
  const { userInput, controls, handlers } = input;
  const parsed = parseResumeCommand(userInput);
  if (parsed.kind === "invalid") {
    return writeMenuHintAndMaybeOpen(
      input,
      "resume",
      `${parsed.reason ?? "无效 resume 命令"}\n\n`,
    );
  }
  if (parsed.kind === "query") {
    const query = parsed.query?.trim() ?? "";
    const matches = resolveResumeQueryMatches(
      query,
      handlers.listSessionSummaries?.() ?? [],
    );
    if (matches.length <= 0) {
      return writeMenuHintAndMaybeOpen(
        input,
        "resume",
        buildResumeNoMatchMessage(query),
      );
    }
    if (matches.length > 1) {
      const rows = matches
        .slice(0, MATCH_LIST_LIMIT)
        .map(
          (session) =>
            `- ${session.id}${session.active ? "（当前）" : ""} | ${session.updatedAt} | 标题=${formatSingleLinePreview(session.title, 40)} | 摘要=${formatSingleLinePreview(session.summary, 40)}`,
        );
      const quickPickHints = matches
        .slice(0, QUICK_PICK_HINT_LIMIT)
        .map((session) => `- /resume ${session.id}`);
      const disambiguationBlock = formatDisambiguationBlock(
        matches.length,
        rows.length,
        quickPickHints,
      );
      return writeMenuHintAndMaybeOpen(
        input,
        "resume",
        `● 找到多个会话\n  查询: ${query}\n  匹配: ${String(matches.length)}\n${rows.join("\n")}${disambiguationBlock}\n使用 /resume 明确选择一个。\n\n`,
      );
    }
    const target = matches[0];
    if (target.active) {
      return writeMenuHintAndMaybeOpen(
        input,
        "resume",
        buildSlashNotice("会话已是当前会话", [
          `会话: ${target.id}`,
          "使用 /resume 打开菜单。",
        ]),
      );
    }
    await handlers.switchSession(target.id);
    return "continue";
  }
  if (parsed.kind === "legacy_with_id") {
    handlers.writeStdout(`${parsed.reason}\n\n`);
    if (parsed.sessionId && parsed.sessionId.length > 0) {
      await handlers.switchSession(parsed.sessionId);
      return "continue";
    }
  }
  await handlers.openSessionMenu("resume", controls.withInputPaused);
  return "continue";
}
