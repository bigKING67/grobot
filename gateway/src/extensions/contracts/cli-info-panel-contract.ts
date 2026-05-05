import { readFileSync } from "node:fs";
import { measureDisplayWidth } from "../../cli/tui/terminal/display-width";
import { renderInfoPanel } from "../../cli/tui/components/info-panel/render";

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

function linesWithinWidth(value: string, width: number): boolean {
  return stripAnsi(value)
    .split(/\r?\n/)
    .every((line) => measureDisplayWidth(line) <= width);
}

const interactive = renderInfoPanel({
  title: "上下文",
  titleTone: "planMode",
  subtitle: "每轮发送前组装的上下文窗口",
  sections: [
    {
      rows: [
        {
          title: "系统提示 · SYSTEM.md 内置",
        },
        {
          title: "上下文引擎 · 开启 · 档位 default",
          detailLines: [
            "窗口 200000",
            "自动压缩 自动 · 历史 24 条",
          ],
        },
        {
          title: "关系",
          detailLines: [
            "记忆是可检索素材，不等同于当前上下文窗口",
          ],
        },
      ],
    },
  ],
  footerLines: [
    "/memory 查看持久素材层",
  ],
}, {
  terminalColumns: 80,
  interactiveMode: true,
});
const plain = renderInfoPanel({
  title: "状态栏",
  subtitle: "当前底部状态配置",
  sections: [
    {
      rows: [
        {
          title: "状态 · 开启",
          detailLines: [
            "布局 紧凑 · 主题 图标增强",
            "提醒阈值 80% · 危险阈值 95%",
          ],
        },
      ],
    },
  ],
}, {
  terminalColumns: 52,
  interactiveMode: false,
});
const plainText = stripAnsi(plain);
const renderSource = readFileSync(
  "gateway/src/cli/tui/components/info-panel/render.ts",
  "utf8",
);

const payload = {
  interactive_has_ansi: /\u001B\[[0-9;]*m/.test(interactive),
  interactive_title_supports_plan_tone: /\u001B\[[0-9;]*m上下文/.test(interactive),
  interactive_uses_human_context_copy:
    stripAnsi(interactive).includes("每轮发送前组装的上下文窗口")
    && stripAnsi(interactive).includes("档位 default")
    && stripAnsi(interactive).includes("窗口 200000")
    && !stripAnsi(interactive).includes("bounded context window assembled before each turn")
    && !stripAnsi(interactive).includes("profile default")
    && !stripAnsi(interactive).includes("上下文窗口 tokens:")
    && !stripAnsi(interactive).includes("Token 窗口:")
    && !stripAnsi(interactive).includes("历史消息"),
  has_title: plainText.includes("状态栏"),
  has_subtitle: plainText.includes("当前底部状态配置"),
  uses_reference_row_bullets: plainText.includes("• 状态 · 开启"),
  uses_reference_detail_rows: plainText.includes("  ⎿  布局 紧凑 · 主题 图标增强"),
  avoids_legacy_title_bullet: !plainText.includes("● 状态栏"),
  avoids_machine_prefix:
    !plainText.includes("[status]")
    && !plainText.includes("layout_mode")
    && !plainText.includes("theme:")
    && !plainText.includes("布局:")
    && !plainText.includes("主题:")
    && !plainText.includes("布局: compact")
    && !plainText.includes("主题: nerd_font"),
  narrow_lines_within_width: linesWithinWidth(plain, 52),
  ends_with_newline: plain.endsWith("\n"),
  render_keeps_terminal_width_explicit:
    !renderSource.includes("process.stdout")
    && renderSource.includes("DEFAULT_INFO_PANEL_COLUMNS")
    && renderSource.includes("options.terminalColumns ?? viewModel.terminalColumns"),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
