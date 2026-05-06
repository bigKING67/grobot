import {
  resolveInteractivePromptLayout,
} from "../../cli/tui/interactive/interactive-frame";
import {
  renderStatusLinePrompt,
} from "../../cli/tui/components/status-line/render";

const renderedPrompt = renderStatusLinePrompt({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.652,
  estimatedTokens: 3580,
  targetTokenLimit: 5120,
  sessionId: "019d8b75-8bdf-78e2-a056-1f98a38774bd",
  sessionTopic: "interactive frame closure validation",
  activityText: "organizing context window",
  terminalColumns: 120,
  promptLabel: "❯ ",
});

const layout = resolveInteractivePromptLayout({
  promptText: {
    prefix: "",
    inlinePrompt: "❯ ",
    suffix: renderedPrompt,
    renderSuffixWhileTyping: true,
  },
  fallbackPrompt: "❯ ",
});
const suffix = layout.suffix ?? "";

const payload = {
  prefix_empty: layout.prefix.length === 0,
  inline_prompt_matches: layout.inlinePrompt === "❯ ",
  suffix_has_status_line: suffix.includes("kimi/kimi-k2-2026-04"),
  suffix_has_activity_line: suffix.includes("organizing context window"),
  suffix_has_no_prompt_frame:
    suffix.includes("╭") === false
    && suffix.includes("╰") === false
    && suffix.includes("│") === false,
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
