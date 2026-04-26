import {
  formatStatusIndicatorElapsed,
  renderStatusIndicatorLine,
} from "../../orchestration/entrypoints/dev-cli/ui/screens/status-indicator-screen";
import { measureDisplayWidth } from "../../orchestration/entrypoints/dev-cli/ui/interactive/display-width";

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

const payload = {
  line_contains_elapsed: stripAnsi(line).includes("(7s • esc to interrupt)"),
  line_uses_braille_spinner: /^⠼ /.test(stripAnsi(line)),
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
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
