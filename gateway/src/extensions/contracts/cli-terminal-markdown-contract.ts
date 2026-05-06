import {
  renderTerminalMarkdown,
  resolveTerminalMarkdownMode,
} from "../../cli/tui/interactive/terminal-markdown";

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

const rendered = renderTerminalMarkdown({
  text: [
    "I am **Grobot**, developed by **Moonshot AI**.",
    "Run `grobot status --json` to inspect status.",
    "",
    "```ts",
    "const raw = \"**not bold**\";",
    "```",
    "",
    "## Next step",
  ].join("\n"),
});

const disabled = renderTerminalMarkdown({
  text: "Keep **raw**",
  enabled: false,
});

const offMode = renderTerminalMarkdown({
  text: "Keep **raw**",
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
    rendered.includes("\u001B[1m## Next step\u001B[0m") && stripAnsi(rendered).includes("## Next step"),
  plain_text_preserved:
    stripAnsi(rendered).includes("I am Grobot, developed by Moonshot AI."),
  disabled_preserves_raw_markdown:
    disabled === "Keep **raw**",
  off_mode_preserves_raw_markdown:
    offMode === "Keep **raw**",
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
