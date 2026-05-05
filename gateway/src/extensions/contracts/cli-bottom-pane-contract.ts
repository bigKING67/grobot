import {
  renderBottomPaneFooter,
  renderShortcutOverlayFooter,
} from "../../cli/tui/components/bottom-pane/render";
import {
  measureDisplayWidth,
} from "../../cli/tui/components/status-line/render";

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
  pendingAskSummary: "Enter open picker · 1-2 direct",
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
  pendingAskSummary: "Enter open picker · 1-4 direct · Custom",
});

const runningWithPendingAskFooter = renderBottomPaneFooter({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.42,
  estimatedTokens: 2200,
  targetTokenLimit: 5120,
  sessionId: "019d8b75-8bdf-78e2-a056-1f98a38774bd",
  sessionTopic: "running pending ask",
  terminalColumns: 96,
  promptLabel: "› ",
  activityText: "Building context",
  running: true,
  pendingAskCount: 2,
  pendingAskSummary: "Enter open picker · 1-2 direct",
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
  activityText: "Building context",
  running: true,
});

const runningQueuedFooter = renderBottomPaneFooter({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.42,
  estimatedTokens: 2200,
  targetTokenLimit: 5120,
  sessionId: "019d8b75-8bdf-78e2-a056-1f98a38774bd",
  sessionTopic: "running queued turn",
  terminalColumns: 72,
  promptLabel: "› ",
  activityText: "Building context",
  queuedInputCount: 2,
  queuedInputPreview: "continue polishing prompt queue visual feedback; do not print raw diagnostics",
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

const runningPlanModeFallbackFooter = renderBottomPaneFooter({
  model: "kimi/kimi-k2-2026-04",
  projectFolder: "grobot",
  contextWindowUsageRatio: 0.42,
  estimatedTokens: 2200,
  targetTokenLimit: 5120,
  sessionId: "019d8b75-8bdf-78e2-a056-1f98a38774bd",
  sessionTopic: "running plan turn",
  terminalColumns: 72,
  promptLabel: "› ",
  planMode: true,
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
  activityText: "Building context",
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
  activityText: "Building context",
  running: true,
});

const idleLines = idleFooter.split("\n");
const pendingLines = pendingFooter.split("\n");
const narrowPendingLines = narrowPendingFooter.split("\n");
const pendingPlanModeLines = pendingPlanModeFooter.split("\n");
const runningWithPendingAskLines = runningWithPendingAskFooter.split("\n");
const runningLines = runningFooter.split("\n");
const runningQueuedLines = runningQueuedFooter.split("\n");
const narrowIdleLines = narrowIdleFooter.split("\n");
const narrowRunningLines = narrowRunningFooter.split("\n");
const narrowPendingPlanModeLines = narrowPendingPlanModeFooter.split("\n");
const narrowRunningPlanModeLines = narrowRunningPlanModeFooter.split("\n");
const shortcutOverlayFooter = renderShortcutOverlayFooter({
  terminalColumns: 72,
});
const shortcutOverlayLines = shortcutOverlayFooter.split("\n");
const wideShortcutOverlayFooter = renderShortcutOverlayFooter({
  terminalColumns: 108,
});
const wideShortcutOverlayLines = wideShortcutOverlayFooter.split("\n");
const narrowShortcutOverlayFooter = renderShortcutOverlayFooter({
  terminalColumns: 48,
});
const narrowShortcutOverlayLines = narrowShortcutOverlayFooter.split("\n");

const payload = {
  idle_has_no_divider: !/^─+$/.test(idleLines[0] ?? ""),
  idle_keeps_passive_status:
    (idleLines[0] ?? "").includes("grobot")
    && (idleLines[0] ?? "").includes("ctx"),
  idle_hides_shortcut_hint: !idleFooter.includes("? shortcuts"),
  idle_omits_permanent_shift_enter_hint: !idleFooter.includes("shift + enter for newline"),
  idle_footer_has_visual_weight:
    !/\u001B\[96m/.test(idleFooter) && /\u001B\[90m/.test(idleFooter),
  idle_footer_uses_muted_not_high_saturation:
    /\u001B\[90m/.test(idleFooter) && !/\u001B\[92m/.test(idleFooter),
  idle_footer_style_keeps_plain_text:
    !collapseSpaces(idleFooter).includes("? shortcuts")
    && collapseSpaces(idleFooter).includes("grobot")
    && collapseSpaces(idleFooter).includes("ctx"),
  idle_without_status_shows_shortcut_hint:
    collapseSpaces(idleNoStatusFooter) === "? shortcuts",
  idle_without_status_hint_is_muted:
    /\u001B\[90m/.test(idleNoStatusFooter),
  idle_narrow_status_dimmed:
    !narrowIdleFooter.includes("? shortcuts") && /\u001B\[90m/.test(narrowIdleFooter),
  idle_narrow_hides_shortcut_hint: !narrowIdleFooter.includes("? shortcuts"),
  idle_narrow_keeps_status:
    narrowIdleFooter.includes("ctx") && !narrowIdleFooter.includes("? shortcuts"),
  idle_narrow_lines_within_width:
    narrowIdleLines.every((line) => measureDisplayWidth(line) <= 48),
  plan_mode_idle_keeps_badge_when_short:
    shortPlanModeIdleFooter.includes("plan mode"),
  plan_mode_idle_badge_leads_status:
    collapseSpaces(shortPlanModeIdleFooter).startsWith("⏸ plan mode"),
  plan_mode_idle_short_within_width:
    shortPlanModeIdleFooter.split("\n").every((line) => measureDisplayWidth(line) <= 48),
  pending_has_no_divider: !/^─+$/.test(pendingLines[0] ?? ""),
  pending_keeps_status_above_ask:
    (pendingLines[0] ?? "").includes("ctx")
    && (pendingLines[1] ?? "").includes("Pending 2"),
  pending_status_secondary:
    pendingLines.some((line, index) =>
      index === 0 && (line.includes("ctx") || line.includes("019d8b75")),
    ),
  pending_narrow_keeps_ask_first: (narrowPendingLines[0] ?? "").includes("Pending 2"),
  pending_default_prompt_is_short:
    pendingWithoutSummaryFooter.includes("Pending 1 · Enter open picker")
    && !pendingWithoutSummaryFooter.includes("reply directly"),
  pending_plan_mode_keeps_badge:
    pendingPlanModeFooter.includes("plan mode")
    && pendingPlanModeFooter.includes("Pending 3"),
  pending_plan_mode_keeps_status_above_ask:
    (pendingPlanModeLines[0] ?? "").includes("plan mode")
    && (pendingPlanModeLines[1] ?? "").includes("Pending 3"),
  pending_preempts_running_activity:
    !runningWithPendingAskFooter.includes("Building context")
    && runningWithPendingAskFooter.includes("Pending 2"),
  pending_running_state_keeps_status_above_ask:
    (runningWithPendingAskLines[0] ?? "").includes("ctx")
    && (runningWithPendingAskLines[1] ?? "").includes("Pending 2"),
  pending_plan_mode_narrow_keeps_badge:
    narrowPendingPlanModeFooter.includes("plan mode")
    && narrowPendingPlanModeFooter.includes("Pending 3"),
  pending_plan_mode_narrow_keeps_status_above_ask:
    (narrowPendingPlanModeLines[0] ?? "").includes("plan mode")
    && (narrowPendingPlanModeLines[1] ?? "").includes("Pending 3"),
  pending_uses_action_hint_not_question:
    pendingFooter.includes("Enter open picker")
    && pendingFooter.includes("1-2 direct")
    && !pendingFooter.includes("Allow npm run check"),
  pending_narrow_sanitizes_raw_summary:
    narrowPendingFooter.includes("Pending 2 · Enter open picker")
    && !narrowPendingFooter.includes("question=")
    && !narrowPendingFooter.includes("options_preview"),
  pending_wide_keeps_secondary_status:
    pendingFooter.includes("019d8b75") && pendingFooter.includes("ctx"),
  pending_narrow_hides_secondary_status:
    !narrowPendingFooter.includes("kimi/") && !narrowPendingFooter.includes("019d8b75"),
  pending_omits_shift_enter_hint: !pendingFooter.includes("shift + enter for newline"),
  pending_warning_kept:
    pendingFooter.includes("context 91%") || pendingFooter.includes("limit reached"),
  pending_lines_within_width: pendingLines.every((line) => measureDisplayWidth(line) <= 64),
  pending_narrow_lines_within_width:
    narrowPendingLines.every((line) => measureDisplayWidth(line) <= 48),
  pending_plan_mode_lines_within_width:
    pendingPlanModeLines.every((line) => measureDisplayWidth(line) <= 96),
  pending_plan_mode_narrow_lines_within_width:
    narrowPendingPlanModeLines.every((line) => measureDisplayWidth(line) <= 48),
  running_has_activity: runningFooter.includes("Building context"),
  running_queued_input_visible:
    runningQueuedFooter.includes("Queued 2")
    && runningQueuedFooter.includes("continue polishing"),
  running_queued_input_is_secondary:
    runningQueuedLines.some((line, index) => index > 0 && line.includes("Queued 2")),
  running_queued_preview_truncated:
    !runningQueuedFooter.includes("raw diagnostics"),
  running_fallback_is_localized:
    stripAnsi(runningFallbackFooter).includes("~ working")
    && !stripAnsi(runningFallbackFooter).includes("~ running"),
  running_plan_mode_fallback_is_planning:
    stripAnsi(runningPlanModeFallbackFooter).includes("~ planning")
    && !stripAnsi(runningPlanModeFallbackFooter).includes("~ working"),
  running_activity_has_visual_weight: /\u001B\[38;2;202;124;94m~/.test(runningFooter),
  running_narrow_keeps_activity_first:
    (narrowRunningLines[0] ?? "").includes("Building context"),
  running_narrow_hides_secondary_status:
    !narrowRunningFooter.includes("kimi/") && !narrowRunningFooter.includes("019d8b75"),
  running_plan_mode_narrow_keeps_badge:
    narrowRunningPlanModeFooter.includes("plan mode"),
  running_plan_mode_narrow_keeps_activity_first:
    narrowRunningPlanModeLines.some((line) => line.includes("Building context")),
  running_omits_shift_enter_hint: !runningFooter.includes("shift + enter for newline"),
  running_status_secondary: runningLines.some((line, index) =>
    index > 0 && (line.includes("ctx") || line.includes("019d8b75")),
  ),
  running_lines_within_width: runningLines.every((line) => measureDisplayWidth(line) <= 72),
  running_queued_lines_within_width:
    runningQueuedLines.every((line) => measureDisplayWidth(line) <= 72),
  running_narrow_lines_within_width:
    narrowRunningLines.every((line) => measureDisplayWidth(line) <= 48),
  running_plan_mode_narrow_lines_within_width:
    narrowRunningPlanModeLines.every((line) => measureDisplayWidth(line) <= 48),
  shortcut_overlay_has_commands: collapseSpaces(shortcutOverlayFooter).includes("/ commands"),
  shortcut_overlay_has_shift_enter:
    collapseSpaces(shortcutOverlayFooter).includes("Shift+Enter newline"),
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
    collapseSpaces(shortcutOverlayFooter).includes("Shift+Enter newline")
    && collapseSpaces(shortcutOverlayFooter).includes("Ctrl+V paste image"),
  shortcut_overlay_medium_uses_two_columns:
    shortcutOverlayLines.length === 5
    && shortcutOverlayLines.some((line) =>
      collapseSpaces(line).includes("/ commands")
      && collapseSpaces(line).includes("Shift+Enter newline"),
    ),
  shortcut_overlay_wide_uses_three_columns:
    wideShortcutOverlayLines.length === 5
    && collapseSpaces(wideShortcutOverlayLines[0] ?? "").includes("/ commands")
    && collapseSpaces(wideShortcutOverlayLines[0] ?? "").includes("Shift+Enter newline")
    && collapseSpaces(wideShortcutOverlayLines[0] ?? "").includes("Enter send")
    && collapseSpaces(wideShortcutOverlayFooter).includes("/status status")
    && collapseSpaces(wideShortcutOverlayFooter).includes("Left/Right move cursor"),
  shortcut_overlay_prioritizes_navigation:
    collapseSpaces(shortcutOverlayLines[1] ?? "").includes("/model model")
    && collapseSpaces(shortcutOverlayLines[1] ?? "").includes("Esc back/clear")
    && collapseSpaces(shortcutOverlayLines[2] ?? "").includes("/plan plan")
    && collapseSpaces(shortcutOverlayLines[2] ?? "").includes("Tab apply suggestion"),
  shortcut_overlay_narrow_uses_single_column:
    narrowShortcutOverlayLines.length === 7
    && collapseSpaces(narrowShortcutOverlayLines[0] ?? "") === "/ commands"
    && collapseSpaces(narrowShortcutOverlayLines[1] ?? "") === "Shift+Enter newline"
    && collapseSpaces(narrowShortcutOverlayLines[2] ?? "") === "Esc back"
    && collapseSpaces(narrowShortcutOverlayLines[3] ?? "") === "Tab apply"
    && collapseSpaces(narrowShortcutOverlayLines[4] ?? "") === "Ctrl+R history"
    && collapseSpaces(narrowShortcutOverlayLines[5] ?? "") === "Ctrl+C exit"
    && !collapseSpaces(narrowShortcutOverlayFooter).includes("Ctrl+V paste image"),
  shortcut_overlay_lines_within_width:
    shortcutOverlayLines.every((line) => measureDisplayWidth(line) <= 72),
  shortcut_overlay_wide_lines_within_width:
    wideShortcutOverlayLines.every((line) => measureDisplayWidth(line) <= 108),
  shortcut_overlay_narrow_lines_within_width:
    narrowShortcutOverlayLines.every((line) => measureDisplayWidth(line) <= 48),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
