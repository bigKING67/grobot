import { runTerminalSelectMenu } from "../../tui/components/select-menu/controller";
import { renderInfoPanel } from "../../tui/components/info-panel/render";
import type {
  StatusLineConfig,
  StatusLineConfigInput,
} from "../../tui/components/status-line/contract";
import { buildCompactNotice } from "./notice-surface";
import {
  buildStatusLayoutUsageSurface,
  buildStatusSegmentUsageSurface,
  buildStatusThemeUsageSurface,
  formatStatusSegmentLabel,
  formatStatusSegmentStateLine,
  formatStatusLayoutModeLabel,
  formatStatusThemeLabel,
  formatStatusLineCurrentSnapshot,
  normalizeStatusSegmentId,
  resolveStatusLayoutMode,
  resolveStatusTheme,
} from "./status-line-settings";

export interface OpenStatusMenuInput {
  sessionKey: string;
  runSelectMenu: typeof runTerminalSelectMenu;
  withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>;
  getStatusLineConfig(): StatusLineConfig;
  updateStatusLineConfig(partial: StatusLineConfigInput): void;
  writeStdout(message: string): void;
}

export async function openStatusMenu(
  input: OpenStatusMenuInput,
): Promise<void> {
  const showCurrent = (): void => {
    input.writeStdout(
      formatStatusLineCurrentSnapshot(input.getStatusLineConfig()),
    );
  };
  if (!process.stdin.isTTY) {
    input.writeStdout(
      renderInfoPanel({
        title: "状态栏操作",
        sections: [{
          rows: [
            {
              title: "/status 当前",
              detailLines: ["查看当前状态栏配置。"],
            },
            {
              title: "/status 主题 <主题>",
              detailLines: ["设置状态栏主题。可用 极简、双行、图标增强。"],
            },
            {
              title: "/status 布局 <布局>",
              detailLines: ["设置状态栏布局。可用 自适应、完整、紧凑。"],
            },
            {
              title: "/status 状态段 <名称> <开启|关闭>",
              detailLines: ["开关状态段 模型、项目、上下文、Token、会话。"],
            },
          ],
        }],
      }),
    );
    return;
  }
  const actionMenu = await input.withInputPaused(() =>
    input.runSelectMenu({
      title: "状态栏",
      subtitle: `会话 ${input.sessionKey}`,
      hint: "↑/↓ 选择 · Enter 确认 · Esc 返回",
      items: [
        {
          id: "current",
          label: "查看当前状态快照",
          description: "输出当前状态栏配置。",
        },
        {
          id: "theme",
          label: "设置状态主题",
          description: "选择状态栏的视觉主题。",
        },
        {
          id: "layout",
          label: "设置状态布局",
          description: "选择状态栏的信息密度。",
        },
        {
          id: "segment",
          label: "开关状态段",
          description: "启用或关闭模型、项目、上下文、Token、会话等状态段。",
        },
      ],
    }),
  );
  if (actionMenu.kind === "cancelled") {
    return;
  }
  if (actionMenu.item.id === "current") {
    showCurrent();
    return;
  }
  if (actionMenu.item.id === "theme") {
    await openThemeMenu(input);
    return;
  }
  if (actionMenu.item.id === "layout") {
    await openLayoutMenu(input);
    return;
  }
  await openSegmentMenu(input);
}

async function openThemeMenu(input: OpenStatusMenuInput): Promise<void> {
  const current = input.getStatusLineConfig().theme;
  const pickedTheme = await input.withInputPaused(() =>
    input.runSelectMenu({
      title: "状态主题",
      subtitle: `当前 ${formatStatusThemeLabel(current)}`,
      hint: "↑/↓ 选择 · Enter 应用 · Esc 返回",
      items: [
        {
          id: "plain",
          label: "极简",
          description: "极简 ANSI 样式。",
          current: current === "plain",
        },
        {
          id: "ccline",
          label: "双行",
          description: "低噪声双行状态栏主题。",
          current: current === "ccline",
        },
        {
          id: "nerd_font",
          label: "图标增强",
          description: "使用 Nerd Font 字形增强状态识别。",
          current: current === "nerd_font",
        },
      ],
    }),
  );
  if (pickedTheme.kind === "cancelled") {
    return;
  }
  const theme = resolveStatusTheme(pickedTheme.item.id);
  if (!theme) {
    input.writeStdout(
      buildStatusThemeUsageSurface("无效状态主题"),
    );
    return;
  }
  input.updateStatusLineConfig({ theme });
  input.writeStdout(buildCompactNotice("已更新状态栏主题", [`主题 ${formatStatusThemeLabel(theme)}`]));
}

async function openLayoutMenu(input: OpenStatusMenuInput): Promise<void> {
  const current = input.getStatusLineConfig().layoutMode;
  const pickedLayout = await input.withInputPaused(() =>
    input.runSelectMenu({
      title: "状态布局",
      subtitle: `当前 ${formatStatusLayoutModeLabel(current)}`,
      hint: "↑/↓ 选择 · Enter 应用 · Esc 返回",
      items: [
        {
          id: "adaptive",
          label: "自适应",
          description: "根据终端宽度自动选择。",
          current: current === "adaptive",
        },
        {
          id: "full",
          label: "完整",
          description: "始终显示完整状态细节。",
          current: current === "full",
        },
        {
          id: "compact",
          label: "紧凑",
          description: "使用紧凑状态栏布局。",
          current: current === "compact",
        },
      ],
    }),
  );
  if (pickedLayout.kind === "cancelled") {
    return;
  }
  const layoutMode = resolveStatusLayoutMode(pickedLayout.item.id);
  if (!layoutMode) {
    input.writeStdout(
      buildStatusLayoutUsageSurface("无效状态布局"),
    );
    return;
  }
  input.updateStatusLineConfig({ layoutMode });
  input.writeStdout(
    buildCompactNotice("已更新状态栏布局", [`布局 ${formatStatusLayoutModeLabel(layoutMode)}`]),
  );
}

async function openSegmentMenu(input: OpenStatusMenuInput): Promise<void> {
  const config = input.getStatusLineConfig();
  const pickedSegment = await input.withInputPaused(() =>
    input.runSelectMenu({
      title: "状态段",
      subtitle: "选择要调整的状态段",
      hint: "↑/↓ 选择 · Enter 继续 · Esc 返回",
      items: config.segmentOrder.map((segmentId) => ({
        id: segmentId,
        label: formatStatusSegmentLabel(segmentId),
        description: formatStatusSegmentStateLine(segmentId, config.segments[segmentId]),
      })),
    }),
  );
  if (pickedSegment.kind === "cancelled") {
    return;
  }
  const segmentId = normalizeStatusSegmentId(pickedSegment.item.id);
  if (!segmentId) {
    input.writeStdout(
      buildStatusSegmentUsageSurface("无效状态段"),
    );
    return;
  }
  const currentEnabled = input.getStatusLineConfig().segments[segmentId];
  const segmentLabel = formatStatusSegmentLabel(segmentId);
  const pickedState = await input.withInputPaused(() =>
    input.runSelectMenu({
      title: `状态段 ${segmentLabel}`,
      subtitle: `当前 ${currentEnabled ? "开启" : "关闭"}`,
      hint: "↑/↓ 选择 · Enter 应用 · Esc 返回",
      items: [
        {
          id: "on",
          label: "开启",
          description: "在状态栏中启用该段。",
          current: currentEnabled,
        },
        {
          id: "off",
          label: "关闭",
          description: "在状态栏中关闭该段。",
          current: !currentEnabled,
        },
      ],
    }),
  );
  if (pickedState.kind === "cancelled") {
    return;
  }
  const enabled = pickedState.item.id === "on";
  input.updateStatusLineConfig({
    segments: {
      [segmentId]: enabled,
    },
  });
  input.writeStdout(
    buildCompactNotice("已更新状态栏状态段", [
      `状态段 ${segmentLabel}`,
      enabled ? "已开启" : "已关闭",
    ]),
  );
}
