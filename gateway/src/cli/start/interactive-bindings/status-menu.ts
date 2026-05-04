import { runTerminalSelectMenu } from "../../tui/components/select-menu/controller";
import type {
  StatusLineConfig,
  StatusLineConfigInput,
} from "../../tui/screens/status-line-screen";
import { buildCompactNotice } from "./notice-surface";
import {
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
      [
        "● 状态栏操作",
        "- /status current                       查看当前状态栏配置",
        "- /status theme <plain|nerd|ccline>     设置状态栏主题",
        "- /status layout <adaptive|full|compact> 设置状态栏布局模式",
        "- /status segment <id> <on|off>         开关状态段 (model/project/context/tokens/session)",
        "",
      ].join("\n"),
    );
    return;
  }
  const actionMenu = await input.withInputPaused(() =>
    input.runSelectMenu({
      title: "状态栏",
      subtitle: `会话: ${input.sessionKey}`,
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
          description: "选择主题: plain / ccline / nerd_font。",
        },
        {
          id: "layout",
          label: "设置状态布局",
          description: "选择布局模式: adaptive / full / compact。",
        },
        {
          id: "segment",
          label: "开关状态 segment",
          description:
            "启用或关闭 segment: model/project/context/tokens/session。",
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
      subtitle: `当前: ${current}`,
      hint: "↑/↓ 选择 · Enter 应用 · Esc 返回",
      items: [
        {
          id: "plain",
          label: "plain",
          description: "极简 ANSI 样式。",
          current: current === "plain",
        },
        {
          id: "ccline",
          label: "ccline",
          description: "Cometix 风格状态栏主题。",
          current: current === "ccline",
        },
        {
          id: "nerd_font",
          label: "nerd_font",
          description: "Nerd-font 字形增强主题。",
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
      "无效状态主题；用法: /status theme <plain|nerd|ccline>\n\n",
    );
    return;
  }
  input.updateStatusLineConfig({ theme });
  input.writeStdout(buildCompactNotice("已更新状态栏主题", [`主题: ${theme}`]));
}

async function openLayoutMenu(input: OpenStatusMenuInput): Promise<void> {
  const current = input.getStatusLineConfig().layoutMode;
  const pickedLayout = await input.withInputPaused(() =>
    input.runSelectMenu({
      title: "状态布局",
      subtitle: `当前: ${current}`,
      hint: "↑/↓ 选择 · Enter 应用 · Esc 返回",
      items: [
        {
          id: "adaptive",
          label: "adaptive",
          description: "根据终端宽度自动选择。",
          current: current === "adaptive",
        },
        {
          id: "full",
          label: "full",
          description: "始终显示完整状态细节。",
          current: current === "full",
        },
        {
          id: "compact",
          label: "compact",
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
      "无效状态布局；用法: /status layout <adaptive|full|compact>\n\n",
    );
    return;
  }
  input.updateStatusLineConfig({ layoutMode });
  input.writeStdout(
    buildCompactNotice("已更新状态栏布局", [`布局: ${layoutMode}`]),
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
        label: segmentId,
        description: `当前: ${config.segments[segmentId] ? "开启" : "关闭"}`,
      })),
    }),
  );
  if (pickedSegment.kind === "cancelled") {
    return;
  }
  const segmentId = normalizeStatusSegmentId(pickedSegment.item.id);
  if (!segmentId) {
    input.writeStdout(
      "无效状态段；用法: /status segment <model|project|context|tokens|session> <on|off>\n\n",
    );
    return;
  }
  const currentEnabled = input.getStatusLineConfig().segments[segmentId];
  const pickedState = await input.withInputPaused(() =>
    input.runSelectMenu({
      title: `状态段: ${segmentId}`,
      subtitle: `当前: ${currentEnabled ? "开启" : "关闭"}`,
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
      `状态段: ${segmentId}`,
      `状态: ${enabled ? "已开启" : "已关闭"}`,
    ]),
  );
}
