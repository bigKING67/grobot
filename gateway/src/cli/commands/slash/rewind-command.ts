import { resolveRewindQueryMatches } from "../../start/session/rewind-search";
import {
  type SessionInteractiveAction,
  type SessionInteractiveRewindCheckpointSummary,
} from "../../start/session-interactive";
import { renderInfoPanel } from "../../tui/components/info-panel/render";
import { parseRewindCommand } from "./parsers";
import {
  buildSlashNotice,
  formatSingleLinePreview,
  writeMenuHintAndMaybeOpen,
} from "./shared";
import { type SlashCommandExecutionInput } from "./types";

const MATCH_LIST_LIMIT = 5;
const QUICK_PICK_HINT_LIMIT = 3;

function formatRewindCreatedAt(value: string): string {
  const normalized = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(normalized);
  if (isoMatch) {
    const [, year, month, day, hour, minute] = isoMatch;
    return `${year}-${month}-${day} ${hour}:${minute}`;
  }
  return normalized.length > 0 ? normalized : "unknown";
}

function formatMatchOverflow(totalCount: number, listedCount: number): string {
  if (totalCount <= listedCount) {
    return "";
  }
  return `... ${String(totalCount - listedCount)} more`;
}

function formatFileCount(count: number): string {
  return `${String(count)} ${count === 1 ? "file" : "files"}`;
}

export function formatDisambiguationBlock(
  totalCount: number,
  listedCount: number,
  quickPickHints: readonly string[],
): readonly string[] {
  const lines: string[] = [];
  const overflow = formatMatchOverflow(totalCount, listedCount);
  if (overflow) {
    lines.push(overflow);
  }
  if (quickPickHints.length > 0) {
    lines.push(
      "Quick picks",
      ...quickPickHints,
    );
  }
  return lines;
}

function buildRewindNoMatchMessage(
  query: string,
  command: "/rewind" | "/checkpoint",
  activeSessionId: string,
): string {
  return renderInfoPanel({
    title: "No matching checkpoints",
    sections: [{
      rows: [{
        title: `session ${activeSessionId}`,
        detailLines: [
          `query ${query}`,
          `Use ${command} to open the menu.`,
          'Hint: matches checkpoint ID, created time, user text, or assistant reply; compact query ignores spaces, "_", and "-".',
        ],
      }],
    }],
    terminalColumns: 132,
  });
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
      buildSlashNotice(`${command} command unavailable`, [
        parsed.reason ?? `Invalid ${command} command`,
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
      buildSlashNotice("Current session cannot rewind", [
        `Use ${command} to open the menu.`,
      ]),
    );
  }
  if (!input.handlers.rewindSession) {
    return writeMenuHintAndMaybeOpen(
      input,
      "rewind",
      buildSlashNotice("Rewind quick path unavailable", [`Use ${command} to open the menu.`]),
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
        ({
          title: checkpoint.checkpointId,
          details: [
            `${formatRewindCreatedAt(checkpoint.createdAt)} · ${formatFileCount(checkpoint.changedFilesCount)}`,
            `user ${formatSingleLinePreview(checkpoint.userText, 44)}`,
            `assistant ${formatSingleLinePreview(checkpoint.assistantText, 44)}`,
          ],
        }),
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
      renderInfoPanel(
        {
          title: "Multiple matching checkpoints found",
          subtitle: `session ${activeSessionId} · query ${query}`,
          sections: [{
            rows: rows.map((row) => ({
              title: row.title,
              detailLines: row.details,
            })),
          }],
          footerLines: [
            ...disambiguationBlock,
            `Use ${command} to choose one explicitly.`,
          ],
          terminalColumns: 132,
        },
      ),
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
