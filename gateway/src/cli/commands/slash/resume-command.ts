import { resolveResumeQueryMatches } from "../../start/session/resume-search";
import { type SessionInteractiveAction } from "../../start/session-interactive";
import { renderInfoPanel } from "../../tui/components/info-panel/render";
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

function formatResumeUpdatedAt(value: string): string {
  const normalized = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(normalized);
  if (isoMatch) {
    const [, year, month, day, hour, minute] = isoMatch;
    return `${year}-${month}-${day} ${hour}:${minute}`;
  }
  return normalized.length > 0 ? normalized : "unknown";
}

function buildResumeNoMatchMessage(query: string): string {
  return buildSlashNotice("No matching sessions", [
    `query ${query}`,
    "Use /resume to open the menu.",
    'Hint: matches ID, title, summary, or updated time; compact query ignores spaces, "_", and "-".',
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
      `${parsed.reason ?? "Invalid resume command"}\n\n`,
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
        .map((session) => ({
          title: `${formatSingleLinePreview(session.title || session.id, 44)}${session.active ? " (current)" : ""}`,
          detailLines: [
            `session ${session.id} · updated ${formatResumeUpdatedAt(session.updatedAt)}`,
            `summary ${formatSingleLinePreview(session.summary, 44)}`,
          ],
        }));
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
        renderInfoPanel({
          title: "Multiple sessions found",
          subtitle: `query ${query} · matches ${String(matches.length)}`,
          sections: [{
            rows,
          }],
          footerLines: [
            ...disambiguationBlock,
            "Use /resume to choose one explicitly.",
          ],
        }),
      );
    }
    const target = matches[0];
    if (target.active) {
      return writeMenuHintAndMaybeOpen(
        input,
        "resume",
        buildSlashNotice("Session already current", [
          `session ${target.id}`,
          "Use /resume to open the menu.",
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
