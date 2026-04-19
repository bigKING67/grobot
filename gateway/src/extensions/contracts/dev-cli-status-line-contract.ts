import {
  measureDisplayWidth,
  renderStatusLinePrompt,
} from "../../orchestration/entrypoints/dev-cli/ui/screens/status-line-screen";

const sessionId = "019d8b75-8bdf-78e2-a056-1f98a38774bd";
const sessionShortId = "019d8b75";

const wide = renderStatusLinePrompt({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.643,
  estimatedTokens: 3214,
  targetTokenLimit: 5120,
  sessionId,
  sessionTopic: "login regression follow-up",
  terminalColumns: 160,
  promptLabel: "› ",
});

const narrow = renderStatusLinePrompt({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.643,
  estimatedTokens: 3214,
  targetTokenLimit: 5120,
  sessionId,
  sessionTopic: "login regression follow-up",
  terminalColumns: 64,
  promptLabel: "› ",
});

const cjkNarrow = renderStatusLinePrompt({
  model: "硅基流动/Qwen3-Embedding-4B-长名称验证",
  projectFolder: "通用智能体工程",
  contextWindowUsageRatio: 0.714,
  estimatedTokens: 18120,
  targetTokenLimit: 262144,
  sessionId,
  sessionTopic: "状态栏宽度与上下文策略联合回归",
  terminalColumns: 48,
  promptLabel: "› ",
});

const warningPrompt = renderStatusLinePrompt({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.944,
  estimatedTokens: 4820,
  targetTokenLimit: 5120,
  sessionId,
  sessionTopic: "high pressure",
  terminalColumns: 120,
  promptLabel: "› ",
});

const segmentTogglePrompt = renderStatusLinePrompt({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.643,
  estimatedTokens: 3214,
  targetTokenLimit: 5120,
  sessionId,
  sessionTopic: "login regression follow-up",
  terminalColumns: 120,
  promptLabel: "› ",
  config: {
    segments: {
      tokens: false,
    },
  },
});

const wideLines = wide.split("\n");
const narrowLines = narrow.split("\n");
const cjkLines = cjkNarrow.split("\n");
const warningLines = warningPrompt.split("\n");
const segmentToggleLines = segmentTogglePrompt.split("\n");
const wideStatusLine = wideLines[0] ?? "";
const narrowStatusLine = narrowLines[0] ?? "";
const cjkStatusLine = cjkLines[0] ?? "";
const warningStatusLine = warningLines[0] ?? "";
const warningLine = warningLines[1] ?? "";
const segmentToggleStatusLine = segmentToggleLines[0] ?? "";
const widePromptFrameTop = wideLines[1] ?? "";
const widePromptLine = wideLines[2] ?? "";

const payload = {
  wide_has_model: wideStatusLine.includes("kimi/kimi-k2-2026-04"),
  wide_has_project: wideStatusLine.includes("grobot"),
  wide_has_ctx_percent: wideStatusLine.includes("Context 37% left"),
  wide_has_token_counter: wideStatusLine.includes("5K window"),
  wide_has_short_session_id: wideStatusLine.includes(sessionShortId),
  wide_has_no_s_colon_prefix: wideStatusLine.includes(`s:${sessionShortId}`) === false,
  wide_has_session_topic: wideStatusLine.includes("login regression follow-up"),
  wide_has_session_topic_parenthesized:
    wideStatusLine.includes(`(${String("login regression follow-up")})`),
  prompt_frame_top_present: widePromptFrameTop.includes("╭"),
  prompt_frame_left_border_present: widePromptLine.startsWith("\u001B[90m│\u001B[0m "),
  prompt_line_matches:
    widePromptLine.includes("› ")
    && widePromptLine.includes("\u001B[90m│\u001B[0m")
    && /\u001B\[[0-9]+D$/.test(widePromptLine),
  narrow_line_within_width: measureDisplayWidth(narrowStatusLine) <= 64,
  narrow_has_short_session_id: narrowStatusLine.includes(sessionShortId),
  cjk_line_within_width: measureDisplayWidth(cjkStatusLine) <= 48,
  warning_has_separate_line: warningLines.length >= 4,
  warning_line_contains_critical: warningLine.includes("critical"),
  warning_status_line_unchanged: warningStatusLine.includes("context 94%") === false,
  tokens_segment_toggle_effective:
    segmentToggleStatusLine.includes("5K window") === false
    && segmentToggleStatusLine.includes("5k window") === false,
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
