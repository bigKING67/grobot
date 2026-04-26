import {
  renderTerminalMarkdown,
  resolveTerminalMarkdownMode,
} from "../../orchestration/entrypoints/dev-cli/ui/interactive/terminal-markdown";

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

const offMode = renderTerminalMarkdown({
  text: "保持 **raw**",
  mode: "off",
});

const richMode = renderTerminalMarkdown({
  text: "**rich**",
  mode: "rich",
});

const payload = {
  strong_renders_bold:
    rendered.includes("\u001B[1mGrobot\u001B[0m")
    && rendered.includes("\u001B[1mMoonshot AI\u001B[0m"),
  inline_code_renders_dim:
    rendered.includes("\u001B[90mgrobot status --json\u001B[0m"),
  fenced_code_preserves_markdown_markers:
    rendered.includes("const raw = \"**not bold**\";"),
  heading_preserves_hash_marker:
    rendered.includes("\u001B[1m## 下一步\u001B[0m") && stripAnsi(rendered).includes("## 下一步"),
  plain_text_preserved:
    stripAnsi(rendered).includes("我是 Grobot，由 Moonshot AI 开发。"),
  disabled_preserves_raw_markdown:
    disabled === "保持 **raw**",
  off_mode_preserves_raw_markdown:
    offMode === "保持 **raw**",
  rich_mode_currently_uses_basic_renderer:
    richMode === "\u001B[1mrich\u001B[0m",
  env_off_resolves_off:
    resolveTerminalMarkdownMode("off") === "off"
    && resolveTerminalMarkdownMode("0") === "off",
  env_basic_default:
    resolveTerminalMarkdownMode(undefined) === "basic"
    && resolveTerminalMarkdownMode("basic") === "basic",
  env_rich_resolves_rich:
    resolveTerminalMarkdownMode("rich") === "rich",
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
