import {
  resolveInteractivePromptLayout,
} from "../../orchestration/entrypoints/dev-cli/ui/interactive/interactive-frame";
import {
  renderStatusLinePrompt,
} from "../../orchestration/entrypoints/dev-cli/ui/screens/status-line-screen";

const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

const renderedPrompt = renderStatusLinePrompt({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.652,
  estimatedTokens: 3580,
  targetTokenLimit: 5120,
  sessionId: "019d8b75-8bdf-78e2-a056-1f98a38774bd",
  sessionTopic: "interactive frame closure validation",
  activityText: "正在整理上下文窗口",
  terminalColumns: 120,
  promptLabel: "› ",
});

const layout = resolveInteractivePromptLayout({
  promptText: renderedPrompt,
  fallbackPrompt: "› ",
});

const prefixLines = layout.prefix.split("\n");
const topBorder = prefixLines[prefixLines.length - 1] ?? "";
const topBorderPlain = stripAnsi(topBorder);
const suffixPlain = stripAnsi(layout.suffix ?? "");

const payload = {
  prefix_has_status_line: layout.prefix.includes("kimi/kimi-k2-2026-04"),
  prefix_has_activity_line: layout.prefix.includes("正在整理上下文窗口"),
  inline_prompt_has_left_border: layout.inlinePrompt.startsWith("\u001B[90m│\u001B[0m "),
  suffix_has_bottom_border: suffixPlain.startsWith("╰") && suffixPlain.endsWith("╯"),
  suffix_width_matches_top: suffixPlain.length === topBorderPlain.length,
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
