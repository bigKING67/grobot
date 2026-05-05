import { renderInfoPanel } from "../../tui/components/info-panel/render";
import type { InfoPanelRow } from "../../tui/components/info-panel/contract";
import { type UserCommandRecord } from "./contract";

const COMMAND_PROMPT_PREVIEW_LINE_LIMIT = 4;

function formatCommandDescription(value: string): string {
  return value.trim().length > 0 ? value.trim() : "未填写说明";
}

function buildPromptPreviewLines(prompt: string): string[] {
  const lines = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return ["未设置模板内容"];
  }
  const visible = lines.slice(0, COMMAND_PROMPT_PREVIEW_LINE_LIMIT);
  const hiddenCount = lines.length - visible.length;
  if (hiddenCount > 0) {
    visible.push(`… 还有 ${String(hiddenCount)} 行`);
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
        title: primary ?? "无更多信息",
        detailLines,
      }],
    }],
  });
}

export function buildCommandsUsageSurface(usage: string): string {
  return buildCommandsSurface({
    title: "命令还缺参数",
    details: [
      usage,
      "补齐参数后再执行。",
    ],
  });
}

export function formatCommandList(records: readonly UserCommandRecord[], commandsDir: string): string {
  const rows: InfoPanelRow[] = [{
    title: `命令目录 ${commandsDir}`,
    detailLines: [`共 ${String(records.length)} 个命令`],
  }];
  if (records.length === 0) {
    rows.push({
      title: "还没有用户命令",
      detailLines: ['使用 "/commands new <name> [prompt]" 创建。'],
    });
  } else {
    for (const record of records) {
      const summary = formatCommandDescription(record.description);
      rows.push({
        title: `/${record.name} · ${record.enabled ? "启用" : "停用"}`,
        tone: record.enabled ? "brand" : "muted",
        detailLines: [
          `说明 ${summary}`,
        ],
      });
    }
  }
  rows.push({
    title: "常用入口",
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
    title: "用户自定义命令",
    sections: [{ rows }],
  });
}

export function formatCommandDetails(record: UserCommandRecord): string {
  return renderInfoPanel({
    title: `/${record.name}`,
    subtitle: "用户自定义命令",
    sections: [{
      rows: [
        {
          title: record.enabled ? "已启用" : "已停用",
          tone: record.enabled ? "brand" : "muted",
          detailLines: [
            `说明 ${formatCommandDescription(record.description)}`,
            `保存位置 ${record.path}`,
          ],
        },
        {
          title: "提示词模板",
          detailLines: buildPromptPreviewLines(record.prompt),
        },
      ],
    }],
    footerLines: [
      `使用 /commands set ${record.name} <prompt> 更新模板`,
    ],
  });
}
