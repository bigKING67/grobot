import {
  renderBottomPaneFooter,
  renderShortcutOverlayFooter,
} from "../../orchestration/entrypoints/dev-cli/ui/screens/bottom-pane-screen";
import {
  measureDisplayWidth,
} from "../../orchestration/entrypoints/dev-cli/ui/screens/status-line-screen";

function collapseSpaces(value: string): string {
  return stripAnsi(value).replace(/\s+/g, " ").trim();
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

const idleFooter = renderBottomPaneFooter({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.42,
  estimatedTokens: 2200,
  targetTokenLimit: 5120,
  sessionId: "019d8b75-8bdf-78e2-a056-1f98a38774bd",
  sessionTopic: "bottom pane contract",
  terminalColumns: 96,
  promptLabel: "› ",
});

const idleNoStatusFooter = renderBottomPaneFooter({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.42,
  estimatedTokens: 2200,
  targetTokenLimit: 5120,
  sessionId: "019d8b75-8bdf-78e2-a056-1f98a38774bd",
  sessionTopic: "bottom pane contract",
  terminalColumns: 96,
  promptLabel: "› ",
  config: {
    enabled: false,
  },
});

const pendingFooter = renderBottomPaneFooter({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.91,
  estimatedTokens: 4660,
  targetTokenLimit: 5120,
  sessionId: "019d8b75-8bdf-78e2-a056-1f98a38774bd",
  sessionTopic: "pending ask",
  terminalColumns: 64,
  promptLabel: "› ",
  pendingAskCount: 2,
  pendingAskSummary: "Enter 打开选择 · 1-2 直接回复",
});

const narrowPendingFooter = renderBottomPaneFooter({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.91,
  estimatedTokens: 4660,
  targetTokenLimit: 5120,
  sessionId: "019d8b75-8bdf-78e2-a056-1f98a38774bd",
  sessionTopic: "pending ask",
  terminalColumns: 48,
  promptLabel: "› ",
  pendingAskCount: 2,
  pendingAskSummary: "question=Allow npm run check? options_preview=1:yes",
});

const pendingWithoutSummaryFooter = renderBottomPaneFooter({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.42,
  estimatedTokens: 2200,
  targetTokenLimit: 5120,
  sessionId: "019d8b75-8bdf-78e2-a056-1f98a38774bd",
  sessionTopic: "pending ask",
  terminalColumns: 64,
  promptLabel: "› ",
  pendingAskCount: 1,
});

const pendingPlanModeFooter = renderBottomPaneFooter({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.42,
  estimatedTokens: 2200,
  targetTokenLimit: 5120,
  sessionId: "019d8b75-8bdf-78e2-a056-1f98a38774bd",
  sessionTopic: "plan pending ask",
  terminalColumns: 96,
  promptLabel: "› ",
  planMode: true,
  pendingAskCount: 3,
  pendingAskSummary: "Enter 打开选择 · 1-4 直选 · Other 输入",
});

const narrowPendingPlanModeFooter = renderBottomPaneFooter({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.42,
  estimatedTokens: 2200,
  targetTokenLimit: 5120,
  sessionId: "019d8b75-8bdf-78e2-a056-1f98a38774bd",
  sessionTopic: "plan pending ask",
  terminalColumns: 48,
  promptLabel: "› ",
  planMode: true,
  pendingAskCount: 3,
  pendingAskSummary: "question=Ready to code? options_preview=1:yes",
});

const runningFooter = renderBottomPaneFooter({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.91,
  estimatedTokens: 4660,
  targetTokenLimit: 5120,
  sessionId: "019d8b75-8bdf-78e2-a056-1f98a38774bd",
  sessionTopic: "running turn",
  terminalColumns: 72,
  promptLabel: "› ",
  activityText: "正在构建上下文",
  running: true,
});

const runningFallbackFooter = renderBottomPaneFooter({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.42,
  estimatedTokens: 2200,
  targetTokenLimit: 5120,
  sessionId: "019d8b75-8bdf-78e2-a056-1f98a38774bd",
  sessionTopic: "running turn",
  terminalColumns: 72,
  promptLabel: "› ",
  running: true,
});

const narrowIdleFooter = renderBottomPaneFooter({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.42,
  estimatedTokens: 2200,
  targetTokenLimit: 5120,
  sessionId: "019d8b75-8bdf-78e2-a056-1f98a38774bd",
  sessionTopic: "bottom pane contract",
  terminalColumns: 48,
  promptLabel: "› ",
});

const shortPlanModeIdleFooter = renderBottomPaneFooter({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.42,
  estimatedTokens: 2200,
  targetTokenLimit: 5120,
  sessionId: "019d8b75-8bdf-78e2-a056-1f98a38774bd",
  sessionTopic: "bottom pane contract",
  terminalColumns: 48,
  promptLabel: "› ",
  planMode: true,
});

const narrowRunningFooter = renderBottomPaneFooter({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.91,
  estimatedTokens: 4660,
  targetTokenLimit: 5120,
  sessionId: "019d8b75-8bdf-78e2-a056-1f98a38774bd",
  sessionTopic: "running turn",
  terminalColumns: 48,
  promptLabel: "› ",
  activityText: "正在构建上下文",
  running: true,
});

const narrowRunningPlanModeFooter = renderBottomPaneFooter({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.91,
  estimatedTokens: 4660,
  targetTokenLimit: 5120,
  sessionId: "019d8b75-8bdf-78e2-a056-1f98a38774bd",
  sessionTopic: "running plan turn",
  terminalColumns: 48,
  promptLabel: "› ",
  planMode: true,
  activityText: "正在构建上下文",
  running: true,
});

const idleLines = idleFooter.split("\n");
const pendingLines = pendingFooter.split("\n");
const narrowPendingLines = narrowPendingFooter.split("\n");
const pendingPlanModeLines = pendingPlanModeFooter.split("\n");
const runningLines = runningFooter.split("\n");
const narrowIdleLines = narrowIdleFooter.split("\n");
const narrowRunningLines = narrowRunningFooter.split("\n");
const narrowPendingPlanModeLines = narrowPendingPlanModeFooter.split("\n");
const narrowRunningPlanModeLines = narrowRunningPlanModeFooter.split("\n");
const shortcutOverlayFooter = renderShortcutOverlayFooter({
  terminalColumns: 72,
});
const shortcutOverlayLines = shortcutOverlayFooter.split("\n");
const narrowShortcutOverlayFooter = renderShortcutOverlayFooter({
  terminalColumns: 48,
});
const narrowShortcutOverlayLines = narrowShortcutOverlayFooter.split("\n");

const payload = {
  idle_has_no_divider: !/^─+$/.test(idleLines[0] ?? ""),
  idle_keeps_passive_status:
    (idleLines[0] ?? "").includes("grobot")
    && (idleLines[0] ?? "").includes("ctx"),
  idle_hides_shortcut_hint: !idleFooter.includes("? for shortcuts"),
  idle_omits_permanent_shift_enter_hint: !idleFooter.includes("shift + enter for newline"),
  idle_footer_has_visual_weight:
    !/\u001B\[96m/.test(idleFooter) && /\u001B\[90m/.test(idleFooter),
  idle_footer_uses_muted_not_high_saturation:
    /\u001B\[90m/.test(idleFooter) && !/\u001B\[92m/.test(idleFooter),
  idle_footer_style_keeps_plain_text:
    !collapseSpaces(idleFooter).includes("? for shortcuts")
    && collapseSpaces(idleFooter).includes("grobot")
    && collapseSpaces(idleFooter).includes("ctx"),
  idle_without_status_shows_shortcut_hint:
    collapseSpaces(idleNoStatusFooter) === "? for shortcuts",
  idle_without_status_hint_is_muted:
    /\u001B\[90m/.test(idleNoStatusFooter),
  idle_narrow_status_dimmed:
    !narrowIdleFooter.includes("? for shortcuts") && /\u001B\[90m/.test(narrowIdleFooter),
  idle_narrow_hides_shortcut_hint: !narrowIdleFooter.includes("? for shortcuts"),
  idle_narrow_keeps_status:
    narrowIdleFooter.includes("ctx") && !narrowIdleFooter.includes("? for shortcuts"),
  idle_narrow_lines_within_width:
    narrowIdleLines.every((line) => measureDisplayWidth(line) <= 48),
  plan_mode_idle_keeps_badge_when_short:
    shortPlanModeIdleFooter.includes("plan mode on"),
  plan_mode_idle_short_within_width:
    shortPlanModeIdleFooter.split("\n").every((line) => measureDisplayWidth(line) <= 48),
  pending_has_no_divider: !/^─+$/.test(pendingLines[0] ?? ""),
  pending_keeps_status_above_ask:
    (pendingLines[0] ?? "").includes("ctx")
    && (pendingLines[1] ?? "").includes("需要确认 2 项"),
  pending_status_secondary:
    pendingLines.some((line, index) =>
      index === 0 && (line.includes("ctx") || line.includes("019d8b75")),
    ),
  pending_narrow_keeps_ask_first: (narrowPendingLines[0] ?? "").includes("需要确认 2 项"),
  pending_default_prompt_is_short:
    pendingWithoutSummaryFooter.includes("需要确认 1 项 · Enter 打开选择")
    && !pendingWithoutSummaryFooter.includes("直接回复继续"),
  pending_plan_mode_keeps_badge:
    pendingPlanModeFooter.includes("plan mode on")
    && pendingPlanModeFooter.includes("需要确认 3 项"),
  pending_plan_mode_keeps_status_above_ask:
    (pendingPlanModeLines[0] ?? "").includes("plan mode on")
    && (pendingPlanModeLines[1] ?? "").includes("需要确认 3 项"),
  pending_plan_mode_narrow_keeps_badge:
    narrowPendingPlanModeFooter.includes("plan mode on")
    && narrowPendingPlanModeFooter.includes("需要确认 3 项"),
  pending_plan_mode_narrow_keeps_status_above_ask:
    (narrowPendingPlanModeLines[0] ?? "").includes("plan mode on")
    && (narrowPendingPlanModeLines[1] ?? "").includes("需要确认 3 项"),
  pending_uses_action_hint_not_question:
    pendingFooter.includes("Enter 打开选择")
    && pendingFooter.includes("1-2 直接回复")
    && !pendingFooter.includes("Allow npm run check"),
  pending_narrow_sanitizes_raw_summary:
    narrowPendingFooter.includes("需要确认 2 项 · Enter 打开选择")
    && !narrowPendingFooter.includes("question=")
    && !narrowPendingFooter.includes("options_preview"),
  pending_wide_keeps_secondary_status:
    pendingFooter.includes("019d8b75") && pendingFooter.includes("ctx"),
  pending_narrow_hides_secondary_status:
    !narrowPendingFooter.includes("kimi/") && !narrowPendingFooter.includes("019d8b75"),
  pending_omits_shift_enter_hint: !pendingFooter.includes("shift + enter for newline"),
  pending_warning_kept: pendingFooter.includes("critical"),
  pending_lines_within_width: pendingLines.every((line) => measureDisplayWidth(line) <= 64),
  pending_narrow_lines_within_width:
    narrowPendingLines.every((line) => measureDisplayWidth(line) <= 48),
  pending_plan_mode_lines_within_width:
    pendingPlanModeLines.every((line) => measureDisplayWidth(line) <= 96),
  pending_plan_mode_narrow_lines_within_width:
    narrowPendingPlanModeLines.every((line) => measureDisplayWidth(line) <= 48),
  running_has_activity: runningFooter.includes("正在构建上下文"),
  running_fallback_is_localized:
    stripAnsi(runningFallbackFooter).includes("~ 正在处理")
    && !stripAnsi(runningFallbackFooter).includes("~ running"),
  running_activity_has_visual_weight: /\u001B\[38;2;202;124;94m~/.test(runningFooter),
  running_narrow_keeps_activity_first:
    (narrowRunningLines[0] ?? "").includes("正在构建上下文"),
  running_narrow_hides_secondary_status:
    !narrowRunningFooter.includes("kimi/") && !narrowRunningFooter.includes("019d8b75"),
  running_plan_mode_narrow_keeps_badge:
    narrowRunningPlanModeFooter.includes("plan mode on"),
  running_plan_mode_narrow_keeps_activity_first:
    (narrowRunningPlanModeLines[0] ?? "").includes("正在构建上下文"),
  running_omits_shift_enter_hint: !runningFooter.includes("shift + enter for newline"),
  running_status_secondary: runningLines.some((line, index) =>
    index > 0 && (line.includes("ctx") || line.includes("019d8b75")),
  ),
  running_lines_within_width: runningLines.every((line) => measureDisplayWidth(line) <= 72),
  running_narrow_lines_within_width:
    narrowRunningLines.every((line) => measureDisplayWidth(line) <= 48),
  running_plan_mode_narrow_lines_within_width:
    narrowRunningPlanModeLines.every((line) => measureDisplayWidth(line) <= 48),
  shortcut_overlay_has_commands: collapseSpaces(shortcutOverlayFooter).includes("/ for commands"),
  shortcut_overlay_has_shift_enter:
    collapseSpaces(shortcutOverlayFooter).includes("Shift+Enter for newline"),
  shortcut_overlay_has_history: collapseSpaces(shortcutOverlayFooter).includes("Ctrl+R history"),
  shortcut_overlay_has_hide_hint: collapseSpaces(shortcutOverlayFooter).includes("? hide"),
  shortcut_overlay_aligns_key_column:
    stripAnsi(narrowShortcutOverlayLines[0] ?? "").startsWith("/ ")
    && stripAnsi(narrowShortcutOverlayLines[1] ?? "").startsWith("Shift+Enter ")
    && measureDisplayWidth(
      stripAnsi(narrowShortcutOverlayLines[0] ?? "").slice(
        0,
        stripAnsi(narrowShortcutOverlayLines[0] ?? "").indexOf("commands"),
      ),
    ) === measureDisplayWidth(
      stripAnsi(narrowShortcutOverlayLines[1] ?? "").slice(
        0,
        stripAnsi(narrowShortcutOverlayLines[1] ?? "").indexOf("newline"),
      ),
    ),
  shortcut_overlay_has_visual_weight:
    /\u001B\[38;2;202;124;94m/.test(shortcutOverlayFooter) && /\u001B\[90m/.test(shortcutOverlayFooter),
  shortcut_overlay_style_uses_accent_and_dim:
    shortcutOverlayLines.every((line) =>
      /\u001B\[38;2;202;124;94m/.test(line) && /\u001B\[90m/.test(line)
    ),
  shortcut_overlay_style_keeps_plain_text:
    collapseSpaces(shortcutOverlayFooter).includes("Shift+Enter for newline")
    && collapseSpaces(shortcutOverlayFooter).includes("Ctrl+V paste image"),
  shortcut_overlay_wide_uses_two_columns:
    shortcutOverlayLines.length === 4
    && shortcutOverlayLines.some((line) =>
      collapseSpaces(line).includes("/ for commands")
      && collapseSpaces(line).includes("Shift+Enter for newline"),
    ),
  shortcut_overlay_prioritizes_navigation:
    collapseSpaces(shortcutOverlayLines[1] ?? "").includes("Esc back")
    && collapseSpaces(shortcutOverlayLines[1] ?? "").includes("Tab apply"),
  shortcut_overlay_narrow_uses_single_column:
    narrowShortcutOverlayLines.length === 6
    && collapseSpaces(narrowShortcutOverlayLines[0] ?? "") === "/ for commands"
    && collapseSpaces(narrowShortcutOverlayLines[1] ?? "") === "Shift+Enter for newline"
    && collapseSpaces(narrowShortcutOverlayLines[2] ?? "") === "Esc back"
    && collapseSpaces(narrowShortcutOverlayLines[3] ?? "") === "Tab apply"
    && collapseSpaces(narrowShortcutOverlayLines[4] ?? "") === "Ctrl+C exit"
    && !collapseSpaces(narrowShortcutOverlayFooter).includes("Ctrl+V paste image"),
  shortcut_overlay_lines_within_width:
    shortcutOverlayLines.every((line) => measureDisplayWidth(line) <= 72),
  shortcut_overlay_narrow_lines_within_width:
    narrowShortcutOverlayLines.every((line) => measureDisplayWidth(line) <= 48),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
