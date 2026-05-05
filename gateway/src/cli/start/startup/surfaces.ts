import { renderInfoPanel } from "../../tui/components/info-panel/render";
import type {
  InfoPanelRow,
  InfoPanelTone,
} from "../../tui/components/info-panel/contract";

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

function compactSurface(input: {
  title: string;
  titleTone?: InfoPanelTone;
  rows: readonly InfoPanelRow[];
  footerLines?: readonly string[];
}): string {
  return renderInfoPanel({
    title: input.title,
    titleTone: input.titleTone ?? "brand",
    sections: [{ rows: input.rows }],
    footerLines: input.footerLines,
  });
}

function reasonDetailLine(reason: string | undefined): string[] {
  if (!reason || reason.trim().length === 0) {
    return [];
  }
  return [`原因 ${formatDiagnosticToken(reason)}`];
}

export function buildRuntimeInterruptSurface(input: {
  code: string;
  kind: "requested" | "not_running";
  source: "command" | "cli_esc";
}): string {
  const sourceLabel = humanizeInterruptSource(input.source);
  if (input.kind === "requested") {
    return compactSurface({
      title: "已请求中断当前回合",
      rows: [{
        title: `来源 ${sourceLabel}`,
        detailLines: [
          "正在尝试安全停止。",
          `诊断 ${input.code}`,
        ],
      }],
    });
  }
  return compactSurface({
    title: "当前没有运行中的回合",
    rows: [{
      title: `${sourceLabel} 只会中断正在运行的回合。`,
      detailLines: [`诊断 ${input.code}`],
    }],
  });
}

export function buildRuntimeInterruptIgnoredSurface(input: {
  source: "command" | "cli_esc";
}): string {
  const sourceLabel = humanizeInterruptSource(input.source);
  return compactSurface({
    title: "中断请求未生效",
    rows: [{
      title: `${sourceLabel} 请求已跳过。`,
      detailLines: ["当前回合已完成或已过安全中断点。"],
    }],
  });
}

export function buildRuntimeToolsFallbackSurface(input: {
  reason: string | undefined;
  source: string;
}): string {
  return compactSurface({
    title: "运行时工具描述不可用",
    rows: [{
      title: "已使用内置工具 schema 启动。",
      detailLines: [
        `来源 ${input.source}`,
        ...reasonDetailLine(input.reason),
        "如需完整诊断，可运行 grobot status --json。",
      ],
    }],
  });
}

export function buildMcpInstructionStrictFailureSurface(
  reason: string | undefined,
): string {
  return compactSurface({
    title: "MCP 指令加载失败",
    rows: [{
      title: "strict 模式要求所有启用的 MCP 都有指令包。",
      detailLines: [
        ...reasonDetailLine(reason),
        "请补齐 .grobot/rules/mcp/<server>.md，或关闭 mcp.instructions.strict。",
      ],
    }],
  });
}

export function buildExperienceSchedulerTickErrorSurface(
  error: string | undefined,
): string {
  return compactSurface({
    title: "经验任务调度失败",
    rows: [{
      title: "后台任务本轮已跳过，不影响当前输入。",
      detailLines: [
        ...reasonDetailLine(error),
        "如需完整诊断，可设置 GROBOT_STARTUP_DIAGNOSTICS=1 后重试。",
      ],
    }],
  });
}

export function buildExperienceSchedulerTaskFailedSurface(input: {
  taskId: string;
  error: string | undefined;
}): string {
  return compactSurface({
    title: "经验任务执行失败",
    rows: [{
      title: `任务 ${input.taskId || "未知任务"}`,
      detailLines: [
        "本轮调度已记录失败，不影响继续输入。",
        ...reasonDetailLine(input.error),
      ],
    }],
  });
}

export function buildMemoryMaintenanceFailedSurface(input: {
  reason: string;
  error: string | undefined;
}): string {
  return compactSurface({
    title: "记忆维护失败",
    rows: [{
      title: `阶段 ${input.reason || "unknown"}`,
      detailLines: [
        "本轮对话会继续，后台记忆清理将在后续回合重试。",
        ...reasonDetailLine(input.error),
        "如需完整诊断，可设置 GROBOT_STARTUP_DIAGNOSTICS=1 后重试。",
      ],
    }],
  });
}

export function buildRewindCaptureFailedSurface(
  error: string | undefined,
): string {
  return compactSurface({
    title: "检查点保存失败",
    rows: [{
      title: "本轮对话已继续。",
      detailLines: [
        "这一步无法用于 /rewind 回退。",
        ...reasonDetailLine(error),
      ],
    }],
  });
}
