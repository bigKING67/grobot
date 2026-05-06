import {
  formatStatusIndicatorElapsed,
  formatStatusIndicatorThinkingText,
  formatStatusIndicatorTokenText,
  renderStatusIndicatorLine,
  resolveStatusIndicatorModeGlyph,
  resolveStatusIndicatorParts,
  resolveStatusIndicatorStallState,
} from "../../cli/tui/components/status-indicator/render";
import { measureDisplayWidth } from "../../cli/tui/terminal/display-width";
import {
  createRuntimeActivitySignalState,
  readRuntimeActivitySignalSnapshot,
  reduceRuntimeActivitySignalState,
} from "../../cli/tui/interactive/activity-runtime-signals";
import type { RuntimeEvent } from "../../models/types";

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

function runtimeEvent(
  eventType: RuntimeEvent["eventType"],
  payload: Record<string, unknown>,
): RuntimeEvent {
  return {
    traceId: "trace_status_indicator_contract",
    turnId: "turn_status_indicator_contract",
    sessionKey: "feishu:contract:dm:status-indicator",
    eventType,
    payload,
    timestampIso: "unix:1",
  };
}

const startedAtMs = 1_000_000;
const line = renderStatusIndicatorLine({
  message: "Preparing context and tool calls",
  startedAtMs,
  nowMs: startedAtMs + 7_140,
  tick: 4,
  terminalColumns: 72,
});
const repeated = renderStatusIndicatorLine({
  message: "Preparing context and tool calls",
  startedAtMs,
  nowMs: startedAtMs + 7_140,
  tick: 4,
  terminalColumns: 72,
});
const narrowLine = renderStatusIndicatorLine({
  message: "Preparing context and tool calls",
  startedAtMs,
  nowMs: startedAtMs + 67_500,
  tick: 16,
  terminalColumns: 36,
});
const reducedMotionLine = renderStatusIndicatorLine({
  message: "Preparing context",
  startedAtMs,
  nowMs: startedAtMs + 1_000,
  tick: 2,
  terminalColumns: 72,
  reducedMotion: true,
});
const richPartsWide = resolveStatusIndicatorParts({
  spinner: "⠼",
  message: "Preparing context and tool calls",
  elapsedText: "31s",
  interruptHint: "Esc interrupt",
  tokenText: "812 tokens",
  thinkingText: "thinking high",
  terminalColumns: 96,
});
const richLineWide = renderStatusIndicatorLine({
  message: "Preparing context and tool calls",
  startedAtMs,
  nowMs: startedAtMs + 31_000,
  tick: 7,
  terminalColumns: 96,
  mode: "responding",
  tokenText: "812 tokens",
  thinkingText: "thinking high",
});
const tokenGateHiddenLine = renderStatusIndicatorLine({
  message: "Reading task and preparing context",
  startedAtMs,
  nowMs: startedAtMs + 12_000,
  tick: 2,
  terminalColumns: 96,
  mode: "responding",
  tokenCount: 812,
});
const tokenGateVisibleLine = renderStatusIndicatorLine({
  message: "Reading task and preparing context",
  startedAtMs,
  nowMs: startedAtMs + 31_000,
  tick: 2,
  terminalColumns: 96,
  mode: "responding",
  tokenCount: 812,
});
const requestingTokenGateLine = renderStatusIndicatorLine({
  message: "Sending model request",
  startedAtMs,
  nowMs: startedAtMs + 31_000,
  tick: 2,
  terminalColumns: 96,
  mode: "requesting",
  tokenCount: 812,
});
const thinkingStatusLine = renderStatusIndicatorLine({
  message: "Designing implementation plan",
  startedAtMs,
  nowMs: startedAtMs + 4_200,
  tick: 2,
  terminalColumns: 80,
  mode: "thinking",
  thinkingStatus: "thinking",
  effortSuffix: "high",
});
const thoughtStatusLine = renderStatusIndicatorLine({
  message: "Saving plan draft",
  startedAtMs,
  nowMs: startedAtMs + 8_500,
  tick: 2,
  terminalColumns: 80,
  mode: "thinking",
  thinkingStatus: 2_400,
});
const thinkingOnlyParts = resolveStatusIndicatorParts({
  spinner: "✻",
  message: "Designing implementation plan",
  elapsedText: "4s",
  interruptHint: "Esc interrupt",
  tokenText: "",
  thinkingText: "thinking high",
  terminalColumns: 15,
});
const thinkingOnlyLine = renderStatusIndicatorLine({
  message: "Designing implementation plan",
  startedAtMs,
  nowMs: startedAtMs + 4_200,
  tick: 2,
  terminalColumns: 15,
  mode: "thinking",
  thinkingStatus: "thinking",
  effortSuffix: "high",
});
const activityDetailLine = renderStatusIndicatorLine({
  message: "Choosing model route",
  startedAtMs,
  nowMs: startedAtMs + 7_140,
  tick: 4,
  terminalColumns: 80,
  thinkingText: "selected=alpha",
});
const toolUseLine = renderStatusIndicatorLine({
  message: "Running bash command",
  startedAtMs,
  nowMs: startedAtMs + 9_000,
  tick: 4,
  terminalColumns: 80,
  mode: "tool-use",
});
const stalledLine = renderStatusIndicatorLine({
  message: "Waiting for model output",
  startedAtMs,
  nowMs: startedAtMs + 9_000,
  tick: 4,
  terminalColumns: 80,
  mode: "responding",
  stalledIntensity: 1,
});
const richPartsNarrow = resolveStatusIndicatorParts({
  spinner: "⠼",
  message: "Preparing context and tool calls",
  elapsedText: "31s",
  interruptHint: "Esc interrupt",
  tokenText: "812 tokens",
  thinkingText: "thinking high",
  terminalColumns: 34,
});
const richLineNarrow = renderStatusIndicatorLine({
  message: "Preparing context and tool calls",
  startedAtMs,
  nowMs: startedAtMs + 31_000,
  tick: 7,
  terminalColumns: 34,
  tokenText: "812 tokens",
  thinkingText: "thinking high",
});
const richPartsTiny = resolveStatusIndicatorParts({
  spinner: "⠼",
  message: "Preparing context and tool calls",
  elapsedText: "31s",
  interruptHint: "Esc interrupt",
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
let signalState = createRuntimeActivitySignalState();
signalState = reduceRuntimeActivitySignalState(signalState, runtimeEvent("tool_start", {
  tool_name: "bash",
  tool_call_id: "signal_tool_1",
}));
const activeToolSignal = readRuntimeActivitySignalSnapshot(signalState);
signalState = reduceRuntimeActivitySignalState(signalState, runtimeEvent("turn_stream_chunk", {
  delta: {
    text: "hello",
  },
  usage: {
    output_tokens: 12,
  },
}));
const streamSignal = readRuntimeActivitySignalSnapshot(signalState);
signalState = reduceRuntimeActivitySignalState(signalState, runtimeEvent("tool_end", {
  tool_name: "bash",
  tool_call_id: "signal_tool_1",
}));
const clearedToolSignal = readRuntimeActivitySignalSnapshot(signalState);
let anonymousSignalState = createRuntimeActivitySignalState();
anonymousSignalState = reduceRuntimeActivitySignalState(
  anonymousSignalState,
  runtimeEvent("tool_start", { tool_name: "read" }),
);
anonymousSignalState = reduceRuntimeActivitySignalState(
  anonymousSignalState,
  runtimeEvent("tool_end", { tool_name: "read" }),
);
const anonymousSignal = readRuntimeActivitySignalSnapshot(anonymousSignalState);
const activeToolStall = resolveStatusIndicatorStallState({
  previousState: stallAfterPause.state,
  nowMs: 16_000,
  tokenLength: activeToolSignal.tokenLength,
  hasActiveTools: activeToolSignal.hasActiveTools,
  reducedMotion: true,
});

const payload = {
  line_contains_elapsed: stripAnsi(line).includes("(7s · esc to interrupt)"),
  line_uses_reference_spinner: /^✻ /.test(stripAnsi(line)),
  line_has_brand_shimmer: /\u001B\[38;2;202;124;94m/.test(line),
  line_has_muted_base: /\u001B\[90m/.test(line),
  deterministic_for_same_tick: line === repeated,
  narrow_keeps_interrupt_hint: stripAnsi(narrowLine).includes("esc to interrupt"),
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
    && stripAnsi(richLineWide).includes("31s · ↓ 812 tokens · thinking high · esc to interrupt"),
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
  thinking_only_compacts_effort_to_bare_thinking:
    thinkingOnlyParts.thinkingOnly
    && thinkingOnlyParts.showThinking
    && !thinkingOnlyParts.showElapsed
    && !thinkingOnlyParts.showInterruptHint
    && !thinkingOnlyParts.showTokens
    && thinkingOnlyParts.suffix === " (thinking)",
  thinking_only_uses_parenthesized_byline:
    stripAnsi(thinkingOnlyLine).includes("(thinking)")
    && !stripAnsi(thinkingOnlyLine).includes("thinking high")
    && !stripAnsi(thinkingOnlyLine).includes("esc to interrupt")
    && !stripAnsi(thinkingOnlyLine).includes("4s"),
  thinking_only_width_within_columns: measureDisplayWidth(thinkingOnlyLine) <= 15,
  activity_detail_renders_before_elapsed:
    stripAnsi(activityDetailLine).includes("7s · Selected alpha · esc to interrupt")
    && !stripAnsi(activityDetailLine).includes("selected=alpha"),
  activity_detail_width_within_columns: measureDisplayWidth(activityDetailLine) <= 80,
  tool_use_flashes_whole_message_not_per_grapheme:
    stripAnsi(toolUseLine).includes("Running bash command")
    && (toolUseLine.match(/\u001B\[38;2;/g) ?? []).length <= 3,
  stalled_line_turns_spinner_and_message_error_red:
    stripAnsi(stalledLine).includes("Waiting for model output")
    && (stalledLine.match(/\u001B\[38;2;171;43;63m/g) ?? []).length >= 2,
  stalled_line_keeps_reference_spinner_animation:
    /^✻ /.test(stripAnsi(stalledLine))
    && !stripAnsi(stalledLine).startsWith("● "),
  rich_narrow_preserves_interrupt_over_optional_parts:
    richPartsNarrow.showInterruptHint
    && richPartsNarrow.showElapsed
    && !richPartsNarrow.showTokens
    && !richPartsNarrow.showThinking
    && stripAnsi(richLineNarrow).includes("31s · esc to interrupt"),
  rich_narrow_width_within_columns: measureDisplayWidth(richLineNarrow) <= 34,
  rich_tiny_keeps_interrupt_before_elapsed:
    richPartsTiny.showInterruptHint
    && richPartsTiny.suffix.includes("Esc interrupt"),
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
  runtime_signal_tool_start_marks_active:
    activeToolSignal.hasActiveTools,
  runtime_signal_stream_chunk_tracks_output_progress:
    streamSignal.tokenLength === 5
    && streamSignal.tokenCount === 12,
  runtime_signal_tool_end_clears_active:
    !clearedToolSignal.hasActiveTools,
  runtime_signal_anonymous_tool_end_does_not_stick:
    !anonymousSignal.hasActiveTools,
  runtime_signal_active_tool_prevents_status_stall:
    !activeToolStall.isStalled
    && activeToolStall.state.lastTokenAtMs === 16_000,
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
