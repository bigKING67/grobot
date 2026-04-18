import { renderStatusLinePrompt } from "../../orchestration/entrypoints/dev-cli/ui/screens/status-line-screen";

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
  promptLabel: "grobot> ",
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
  promptLabel: "grobot> ",
});

const wideLines = wide.split("\n");
const narrowLines = narrow.split("\n");
const wideStatusLine = wideLines[0] ?? "";
const narrowStatusLine = narrowLines[0] ?? "";

const payload = {
  wide_has_model: wideStatusLine.includes("model kimi/kimi-k2-2026-04"),
  wide_has_project: wideStatusLine.includes("project grobot"),
  wide_has_ctx_percent: wideStatusLine.includes("ctx 64%"),
  wide_has_token_counter: wideStatusLine.includes("tok 3.2k/5.1k"),
  wide_has_short_session_id: wideStatusLine.includes(sessionShortId),
  wide_has_no_s_colon_prefix: wideStatusLine.includes(`s:${sessionShortId}`) === false,
  wide_has_session_topic: wideStatusLine.includes("login regression follow-up"),
  prompt_line_matches: wideLines[1] === "grobot> ",
  narrow_line_within_width: narrowStatusLine.length <= 64,
  narrow_has_short_session_id: narrowStatusLine.includes(sessionShortId),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
