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
  title: "Context",
  titleTone: "planMode",
  subtitle: "Context window assembled before each turn",
  sections: [
    {
      rows: [
        {
          title: "System prompt · built-in SYSTEM.md",
        },
        {
          title: "Context engine · on · profile default",
          detailLines: [
            "Window 200000",
            "Auto-compact auto · history 24 turns",
          ],
        },
        {
          title: "Relationship",
          detailLines: [
            "Memory is retrievable material, not the current context window",
          ],
        },
      ],
    },
  ],
  footerLines: [
    "/memory for persisted material",
  ],
}, {
  terminalColumns: 80,
  interactiveMode: true,
});
const plain = renderInfoPanel({
  title: "Status line",
  subtitle: "Current bottom status configuration",
  sections: [
    {
      rows: [
        {
          title: "Status · on",
          detailLines: [
            "Layout compact · theme icon-enhanced",
            "Warning threshold 80% · danger threshold 95%",
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
  interactive_title_supports_plan_tone: /\u001B\[[0-9;]*mContext/.test(interactive),
  interactive_uses_reference_context_copy:
    stripAnsi(interactive).includes("Context window assembled before each turn")
    && stripAnsi(interactive).includes("profile default")
    && stripAnsi(interactive).includes("Window 200000")
    && !stripAnsi(interactive).includes("上下文窗口 tokens:")
    && !stripAnsi(interactive).includes("Token 窗口:")
    && !stripAnsi(interactive).includes("历史消息"),
  has_title: plainText.includes("Status line"),
  has_subtitle: plainText.includes("Current bottom status configuration"),
  uses_reference_row_bullets: plainText.includes("• Status · on"),
  uses_reference_detail_rows: plainText.includes("  ⎿  Layout compact · theme icon-enhanced"),
  avoids_legacy_title_bullet: !plainText.includes("● Status line"),
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
