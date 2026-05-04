import {
  formatStatusIndicatorElapsed,
  formatStatusIndicatorThinkingText,
  formatStatusIndicatorTokenText,
  renderStatusIndicatorLine,
  resolveStatusIndicatorModeGlyph,
  resolveStatusIndicatorParts,
  resolveStatusIndicatorStallState,
} from "../../cli/tui/screens/status-indicator-screen";
import { measureDisplayWidth } from "../../cli/tui/terminal/display-width";

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

const startedAtMs = 1_000_000;
const line = renderStatusIndicatorLine({
  message: "正在整理上下文窗口并准备工具调用",
  startedAtMs,
  nowMs: startedAtMs + 7_140,
  tick: 4,
  terminalColumns: 72,
});
const repeated = renderStatusIndicatorLine({
  message: "正在整理上下文窗口并准备工具调用",
  startedAtMs,
  nowMs: startedAtMs + 7_140,
  tick: 4,
  terminalColumns: 72,
});
const narrowLine = renderStatusIndicatorLine({
  message: "正在整理上下文窗口并准备工具调用",
  startedAtMs,
  nowMs: startedAtMs + 67_500,
  tick: 16,
  terminalColumns: 36,
});
const reducedMotionLine = renderStatusIndicatorLine({
  message: "正在整理上下文窗口",
  startedAtMs,
  nowMs: startedAtMs + 1_000,
  tick: 2,
  terminalColumns: 72,
  reducedMotion: true,
});
const richPartsWide = resolveStatusIndicatorParts({
  spinner: "⠼",
  message: "正在整理上下文窗口并准备工具调用",
  elapsedText: "31s",
  interruptHint: "Esc 中断",
  tokenText: "812 tokens",
  thinkingText: "thinking high",
  terminalColumns: 96,
});
const richLineWide = renderStatusIndicatorLine({
  message: "正在整理上下文窗口并准备工具调用",
  startedAtMs,
  nowMs: startedAtMs + 31_000,
  tick: 7,
  terminalColumns: 96,
  mode: "responding",
  tokenText: "812 tokens",
  thinkingText: "thinking high",
});
const tokenGateHiddenLine = renderStatusIndicatorLine({
  message: "正在读取任务并准备上下文",
  startedAtMs,
  nowMs: startedAtMs + 12_000,
  tick: 2,
  terminalColumns: 96,
  mode: "responding",
  tokenCount: 812,
});
const tokenGateVisibleLine = renderStatusIndicatorLine({
  message: "正在读取任务并准备上下文",
  startedAtMs,
  nowMs: startedAtMs + 31_000,
  tick: 2,
  terminalColumns: 96,
  mode: "responding",
  tokenCount: 812,
});
const requestingTokenGateLine = renderStatusIndicatorLine({
  message: "正在发送模型请求",
  startedAtMs,
  nowMs: startedAtMs + 31_000,
  tick: 2,
  terminalColumns: 96,
  mode: "requesting",
  tokenCount: 812,
});
const thinkingStatusLine = renderStatusIndicatorLine({
  message: "正在设计实现方案",
  startedAtMs,
  nowMs: startedAtMs + 4_200,
  tick: 2,
  terminalColumns: 80,
  mode: "thinking",
  thinkingStatus: "thinking",
  effortSuffix: "high",
});
const thoughtStatusLine = renderStatusIndicatorLine({
  message: "正在保存计划草稿",
  startedAtMs,
  nowMs: startedAtMs + 8_500,
  tick: 2,
  terminalColumns: 80,
  mode: "thinking",
  thinkingStatus: 2_400,
});
const activityDetailLine = renderStatusIndicatorLine({
  message: "正在选择模型路由",
  startedAtMs,
  nowMs: startedAtMs + 7_140,
  tick: 4,
  terminalColumns: 80,
  thinkingText: "selected=alpha",
});
const richPartsNarrow = resolveStatusIndicatorParts({
  spinner: "⠼",
  message: "正在整理上下文窗口并准备工具调用",
  elapsedText: "31s",
  interruptHint: "Esc 中断",
  tokenText: "812 tokens",
  thinkingText: "thinking high",
  terminalColumns: 34,
});
const richLineNarrow = renderStatusIndicatorLine({
  message: "正在整理上下文窗口并准备工具调用",
  startedAtMs,
  nowMs: startedAtMs + 31_000,
  tick: 7,
  terminalColumns: 34,
  tokenText: "812 tokens",
  thinkingText: "thinking high",
});
const richPartsTiny = resolveStatusIndicatorParts({
  spinner: "⠼",
  message: "正在整理上下文窗口并准备工具调用",
  elapsedText: "31s",
  interruptHint: "Esc 中断",
  tokenText: "812 tokens",
  thinkingText: "thinking high",
  terminalColumns: 22,
});
const stallInitial = resolveStatusIndicatorStallState({
  nowMs: 10_000,
  tokenLength: 12,
});
const stallAfterPause = resolveStatusIndicatorStallState({
  previousState: stallInitial.state,
  nowMs: 13_600,
  tokenLength: 12,
  reducedMotion: true,
});
const stallActiveTools = resolveStatusIndicatorStallState({
  previousState: stallAfterPause.state,
  nowMs: 14_000,
  tokenLength: 12,
  hasActiveTools: true,
  reducedMotion: true,
});
const stallTokenArrived = resolveStatusIndicatorStallState({
  previousState: stallAfterPause.state,
  nowMs: 14_200,
  tokenLength: 18,
  reducedMotion: true,
});
const stallSmoothed = resolveStatusIndicatorStallState({
  previousState: {
    ...stallInitial.state,
    lastTokenAtMs: 10_000,
    lastSmoothAtMs: 13_000,
    stalledIntensity: 0,
  },
  nowMs: 13_600,
  tokenLength: 12,
});

const payload = {
  line_contains_elapsed: stripAnsi(line).includes("(7s • Esc 中断)"),
  line_uses_braille_spinner: /^⠼ /.test(stripAnsi(line)),
  line_has_brand_shimmer: /\u001B\[38;2;202;124;94m/.test(line),
  line_has_muted_base: /\u001B\[90m/.test(line),
  deterministic_for_same_tick: line === repeated,
  narrow_keeps_interrupt_hint: stripAnsi(narrowLine).includes("Esc 中断"),
  narrow_width_within_columns: measureDisplayWidth(narrowLine) <= 36,
  wide_width_within_columns: measureDisplayWidth(line) <= 72,
  reduced_motion_no_brand_sweep:
    (reducedMotionLine.match(/\u001B\[38;2;202;124;94m/g) ?? []).length === 1,
  no_invalid_tokens:
    !line.includes("undefined") && !line.includes("NaN") && !line.includes("null"),
  elapsed_formats_minutes: formatStatusIndicatorElapsed(67_500) === "1m 07s",
  elapsed_formats_hours: formatStatusIndicatorElapsed(3_605_000) === "1h 00m 05s",
  mode_glyph_requesting_is_up:
    resolveStatusIndicatorModeGlyph("requesting") === "↑",
  mode_glyph_responding_is_down:
    resolveStatusIndicatorModeGlyph("responding") === "↓",
  thinking_status_formats_active:
    formatStatusIndicatorThinkingText({ status: "thinking", effortSuffix: "high" }) === "thinking high",
  thinking_status_formats_completed_duration:
    formatStatusIndicatorThinkingText({ status: 2_400 }) === "thought for 2s",
  token_count_formats_after_gate:
    formatStatusIndicatorTokenText({
      tokenCount: 1_234,
      elapsedMs: 31_000,
      mode: "responding",
    }) === "↓ 1,234 tokens",
  token_count_hidden_before_gate:
    formatStatusIndicatorTokenText({
      tokenCount: 812,
      elapsedMs: 12_000,
      mode: "responding",
    }) === "",
  rich_wide_shows_thinking_tokens_elapsed_interrupt:
    richPartsWide.showThinking
    && richPartsWide.showTokens
    && richPartsWide.showElapsed
    && richPartsWide.showInterruptHint
    && stripAnsi(richLineWide).includes("thinking high · ↓ 812 tokens · 31s • Esc 中断"),
  rich_wide_width_within_columns: measureDisplayWidth(richLineWide) <= 96,
  token_gate_hides_tokens_before_30s:
    !stripAnsi(tokenGateHiddenLine).includes("812 tokens"),
  token_gate_shows_down_tokens_after_30s:
    stripAnsi(tokenGateVisibleLine).includes("↓ 812 tokens"),
  requesting_mode_shows_up_token_glyph:
    stripAnsi(requestingTokenGateLine).includes("↑ 812 tokens"),
  thinking_status_line_shows_effort:
    stripAnsi(thinkingStatusLine).includes("thinking high"),
  thought_status_line_shows_duration:
    stripAnsi(thoughtStatusLine).includes("thought for 2s"),
  activity_detail_renders_before_elapsed:
    stripAnsi(activityDetailLine).includes("selected=alpha · 7s • Esc 中断"),
  activity_detail_width_within_columns: measureDisplayWidth(activityDetailLine) <= 80,
  rich_narrow_preserves_interrupt_over_optional_parts:
    richPartsNarrow.showInterruptHint
    && richPartsNarrow.showElapsed
    && !richPartsNarrow.showTokens
    && !richPartsNarrow.showThinking
    && stripAnsi(richLineNarrow).includes("31s • Esc 中断"),
  rich_narrow_width_within_columns: measureDisplayWidth(richLineNarrow) <= 34,
  rich_tiny_keeps_interrupt_before_elapsed:
    richPartsTiny.showInterruptHint
    && richPartsTiny.showElapsed
    && richPartsTiny.suffix.includes("Esc 中断"),
  stall_detects_no_token_progress:
    stallAfterPause.isStalled
    && stallAfterPause.stalledIntensity > 0,
  stall_active_tools_resets_timer:
    !stallActiveTools.isStalled
    && stallActiveTools.state.lastTokenAtMs === 14_000,
  stall_token_progress_resets_intensity:
    !stallTokenArrived.isStalled
    && stallTokenArrived.state.lastTokenLength === 18
    && stallTokenArrived.stalledIntensity === 0,
  stall_smoothing_is_gradual:
    stallSmoothed.isStalled
    && stallSmoothed.stalledIntensity > 0
    && stallSmoothed.stalledIntensity < stallAfterPause.stalledIntensity,
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
