import { renderInfoPanel } from "../../tui/components/info-panel/render";
import type { InfoPanelRow } from "../../tui/components/info-panel/contract";
import { type UserCommandRecord } from "./contract";

const COMMAND_PROMPT_PREVIEW_LINE_LIMIT = 4;

function formatCommandDescription(value: string): string {
  return value.trim().length > 0 ? value.trim() : "No description";
}

function buildPromptPreviewLines(prompt: string): string[] {
  const lines = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return ["No template content"];
  }
  const visible = lines.slice(0, COMMAND_PROMPT_PREVIEW_LINE_LIMIT);
  const hiddenCount = lines.length - visible.length;
  if (hiddenCount > 0) {
    visible.push(`... ${String(hiddenCount)} more lines`);
  }
  return visible;
}

export function buildCommandsSurface(input: {
  title: string;
  details?: readonly string[];
}): string {
  const normalized = (input.details ?? [])
    .map((detail) => detail.trim())
    .filter((detail) => detail.length > 0);
  const [primary, ...detailLines] = normalized;
  return renderInfoPanel({
    title: input.title,
    sections: [{
      rows: [{
        title: primary ?? "No more information",
        detailLines,
      }],
    }],
  });
}

export function buildCommandsUsageSurface(usage: string): string {
  return buildCommandsSurface({
    title: "Command needs more arguments",
    details: [
      usage,
      "Add the missing arguments and try again.",
    ],
  });
}

export function formatCommandList(records: readonly UserCommandRecord[], commandsDir: string): string {
  const rows: InfoPanelRow[] = [{
    title: `Commands directory ${commandsDir}`,
    detailLines: [`${String(records.length)} commands`],
  }];
  if (records.length === 0) {
    rows.push({
      title: "No user commands yet",
      detailLines: ['Use "/commands new <name> [prompt]" to create one.'],
    });
  } else {
    for (const record of records) {
      const summary = formatCommandDescription(record.description);
      rows.push({
        title: `/${record.name} · ${record.enabled ? "enabled" : "disabled"}`,
        tone: record.enabled ? "brand" : "muted",
        detailLines: [
          `description ${summary}`,
        ],
      });
    }
  }
  rows.push({
    title: "Common commands",
    detailLines: [
      "/commands list",
      "/commands new <name> [prompt]",
      "/commands set <name> <prompt>",
      "/commands show <name>",
      "/commands delete <name>",
      "/commands enable <name>",
      "/commands disable <name>",
    ],
  });
  return renderInfoPanel({
    title: "User commands",
    sections: [{ rows }],
  });
}

export function formatCommandDetails(record: UserCommandRecord): string {
  return renderInfoPanel({
    title: `/${record.name}`,
    subtitle: "User command",
    sections: [{
      rows: [
        {
          title: record.enabled ? "Enabled" : "Disabled",
          tone: record.enabled ? "brand" : "muted",
          detailLines: [
            `description ${formatCommandDescription(record.description)}`,
            `saved at ${record.path}`,
          ],
        },
        {
          title: "Prompt template",
          detailLines: buildPromptPreviewLines(record.prompt),
        },
      ],
    }],
    footerLines: [
      `Use /commands set ${record.name} <prompt> to update the template`,
    ],
  });
}
