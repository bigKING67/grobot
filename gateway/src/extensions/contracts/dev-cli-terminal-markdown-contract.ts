import { renderTerminalMarkdown } from "../../orchestration/entrypoints/dev-cli/ui/interactive/terminal-markdown";

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

const rendered = renderTerminalMarkdown({
  text: [
    "我是 **Grobot**，由 **Moonshot AI** 开发。",
    "可以输入 `grobot status --json` 查看状态。",
    "",
    "```ts",
    "const raw = \"**not bold**\";",
    "```",
    "",
    "## 下一步",
  ].join("\n"),
});

const disabled = renderTerminalMarkdown({
  text: "保持 **raw**",
  enabled: false,
});

const payload = {
  strong_renders_bold:
    rendered.includes("\u001B[1mGrobot\u001B[0m")
    && rendered.includes("\u001B[1mMoonshot AI\u001B[0m"),
  inline_code_renders_dim:
    rendered.includes("\u001B[90mgrobot status --json\u001B[0m"),
  fenced_code_preserves_markdown_markers:
    rendered.includes("const raw = \"**not bold**\";"),
  heading_renders_without_hash_marker:
    rendered.includes("\u001B[1m下一步\u001B[0m") && !stripAnsi(rendered).includes("## 下一步"),
  plain_text_preserved:
    stripAnsi(rendered).includes("我是 Grobot，由 Moonshot AI 开发。"),
  disabled_preserves_raw_markdown:
    disabled === "保持 **raw**",
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
