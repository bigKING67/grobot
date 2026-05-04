import type { RuntimeEvent } from "../../models/types";
import { measureDisplayWidth } from "../../cli/tui/terminal/display-width";
import {
  renderRuntimeActivityFeed,
  resolveRuntimeActivityFeedDetailMode,
} from "../../cli/tui/components/activity-feed/render";
import {
  buildTurnTerminalOutputSegments,
  resolveRuntimeActivityFeedTranscriptEnabled,
} from "../../cli/start/turn";

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

function event(input: {
  eventType: RuntimeEvent["eventType"];
  payload: Record<string, unknown>;
  nested?: boolean;
}): RuntimeEvent {
  return {
    traceId: "trace-ui-feed",
    turnId: "turn-ui-feed",
    sessionKey: "feishu:grobot:dm:ui",
    eventType: input.eventType,
    payload: input.nested
      ? {
        event_type: input.eventType,
        turn_id: "turn-ui-feed",
        payload: input.payload,
      }
      : input.payload,
    timestampIso: "2026-04-26T00:00:00.000Z",
  };
}

const writePreviewContent = [
  "line-01",
  "line-02",
  "line-03",
  "line-04",
  "line-05",
  "line-06",
  "line-07",
  "line-08",
  "line-09",
  "line-10",
  "line-11",
  "line-12",
].join("\n");

const feedEvents = [
  event({
    eventType: "tool_end",
    nested: true,
    payload: {
      tool_name: "search",
      status: "ok",
      duration_ms: 15,
      output_summary: {
        tool: "search",
        count: 12,
        matches_count: 12,
        engine: "rg",
        limit_reached: false,
      },
    },
  }),
  event({
    eventType: "tool_end",
    payload: {
      tool_name: "write",
      status: "ok",
      output_summary: {
        tool: "write",
        path: "gateway/src/generated-file.ts",
        operation: "create",
        bytes_written: 95,
        line_count: 12,
        content_preview: writePreviewContent,
      },
    },
  }),
  event({
    eventType: "tool_end",
    payload: {
      tool_name: "read",
      status: "ok",
      duration_ms: 8,
      output_summary: {
        tool: "read",
        path: "gateway/src/cli/start/tui-compat.ts",
        kind: "text",
        line_start: 477,
        line_end: 520,
        has_more: true,
      },
    },
  }),
  event({
    eventType: "tool_end",
    payload: {
      tool_name: "edit",
      status: "ok",
      output_summary: {
        tool: "edit",
        path: "gateway/src/cli/tui/components/bottom-pane/render.ts",
        replacements: 1,
        first_changed_line: 42,
        fuzzy_fallback_used: false,
        diff_preview: "@@ -42,1 +42,2 @@\n-old\n+new\n+line",
      },
    },
  }),
  event({
    eventType: "tool_end",
    payload: {
      tool_name: "write",
      status: "ok",
      output_summary: {
        tool: "write",
        file_path: ".grobot/plans/feishu-grobot-dm-ui/001-plan.md",
        operation: "create",
        bytes_written: 640,
      },
    },
  }),
  event({
    eventType: "tool_end",
    payload: {
      tool_name: "edit",
      status: "ok",
      output_summary: {
        tool: "edit",
        path: "/tmp/grobot/.grobot/plans/feishu-grobot-dm-ui/001-plan.md",
        replacements: 1,
        first_changed_line: 3,
        diff_preview: "@@ -3,1 +3,2 @@\n-old plan\n+new plan\n+verify",
      },
    },
  }),
  event({
    eventType: "tool_end",
    payload: {
      tool_name: "bash",
      status: "failed",
      duration_ms: 1200,
      error_class: "bash_command_failed",
      output_summary: {
        tool: "bash",
        exit_code: 1,
        command_preview: "npm run check:gateway:ts",
      },
    },
  }),
  event({
    eventType: "tool_recovery",
    payload: {
      tool_name: "bash",
      recovery_stage: "strategy_switch",
      recommended_next_action: "inspect_error_and_switch_strategy",
      error_class: "bash_command_failed",
    },
  }),
];

const rendered = renderRuntimeActivityFeed({
  terminalColumns: 96,
  events: feedEvents,
  detailMode: "compact",
});
const fullRendered = renderRuntimeActivityFeed({
  terminalColumns: 96,
  events: feedEvents,
  detailMode: "full",
});
const noneRendered = renderRuntimeActivityFeed({
  terminalColumns: 96,
  events: feedEvents,
  detailMode: "none",
});

const emptyRendered = renderRuntimeActivityFeed({
  events: [
    event({
      eventType: "model_response",
      payload: {
        content_chars: 240,
      },
    }),
  ],
});
const turnOutputDefault = buildTurnTerminalOutputSegments({
  assistantMessage: "final answer",
  interactiveMode: true,
  events: feedEvents,
  activityFeedDetailValue: "compact",
});
const turnOutputTranscript = buildTurnTerminalOutputSegments({
  assistantMessage: "final answer",
  interactiveMode: true,
  events: feedEvents,
  activityFeedDetailValue: "compact",
  activityFeedTranscriptValue: "1",
});
const turnOutputAskUser = buildTurnTerminalOutputSegments({
  assistantMessage: "needs confirmation",
  interactiveMode: true,
  runtimeAskUser: true,
  events: feedEvents,
  activityFeedDetailValue: "compact",
  activityFeedTranscriptValue: "1",
});
const turnOutputNonInteractive = buildTurnTerminalOutputSegments({
  assistantMessage: "**raw final**",
  interactiveMode: false,
  events: feedEvents,
  activityFeedDetailValue: "compact",
  activityFeedTranscriptValue: "1",
});
const plain = stripAnsi(rendered);
const fullPlain = stripAnsi(fullRendered);
const turnTranscriptPlain = stripAnsi(turnOutputTranscript.activityFeed);
const lines = rendered.trimEnd().split("\n");
const payload = {
  renders_real_tool_rows: plain.includes("搜索") && plain.includes("读取 gateway/src"),
  compact_hides_key_value_details:
    !plain.includes("matches=")
    && !plain.includes("engine=")
    && !plain.includes("duration=")
    && !plain.includes("command=")
    && !plain.includes("error_class=")
    && !plain.includes("@@ -42"),
  renders_edit_with_diff_stats:
    fullPlain.includes("编辑 gateway/src/cli/tui/components/bottom-pane/render.ts (+2 -1)")
    && fullPlain.includes("@@ -42,1 +42,2 @@"),
  edit_detail_uses_human_copy:
    fullPlain.includes("  ⎿  1 处替换，行 42")
    && !fullPlain.includes("replacements=1 line=42"),
  renders_write_create_with_reference_preview:
    plain.includes("写入 12 行 到 gateway/src/generated-file.ts")
    && fullPlain.includes("  ⎿  line-01")
    && fullPlain.includes("  ⎿  line-10")
    && fullPlain.includes("  ⎿  … 还有 2 行，Ctrl+O 展开"),
  compact_write_preview_hides_content:
    !plain.includes("line-01") && !plain.includes("Ctrl+O 展开"),
  full_detail_uses_reference_status_glyph:
    fullPlain.includes("  ⎿  12 个匹配 rg 15ms")
    && !fullPlain.includes("  └ 12 个匹配 rg"),
  renders_failed_bash:
    plain.includes("失败 运行") && fullPlain.includes("错误 bash_command_failed"),
  renders_recovery_row:
    plain.includes("恢复 bash") && fullPlain.includes("阶段 strategy_switch"),
  nested_payload_supported: fullPlain.includes("12 个匹配 rg"),
  plan_file_write_uses_reference_label:
    plain.includes("计划已更新")
    && !plain.includes("Wrote .grobot/plans")
    && !plain.includes("feishu-grobot-dm-ui/001-plan.md"),
  plan_file_edit_hides_path_and_diff_stats:
    fullPlain.includes("计划已更新")
    && !fullPlain.includes("Edited /tmp/grobot/.grobot/plans")
    && !fullPlain.includes("old plan")
    && !fullPlain.includes("new plan")
    && !fullPlain.includes("计划已更新 (+"),
  plan_file_full_detail_shows_preview_hint:
    fullPlain.includes("  ⎿  /plan 预览"),
  none_mode_suppresses_feed: noneRendered === "",
  env_default_suppresses_feed: resolveRuntimeActivityFeedDetailMode(undefined) === "none",
  env_compact_enables_feed:
    resolveRuntimeActivityFeedDetailMode("compact") === "compact"
    && resolveRuntimeActivityFeedDetailMode("1") === "compact",
  env_full_enables_verbose_feed:
    resolveRuntimeActivityFeedDetailMode("full") === "full"
    && resolveRuntimeActivityFeedDetailMode("debug") === "full",
  transcript_default_disables_turn_feed:
    turnOutputDefault.activityFeed === ""
    && turnOutputDefault.assistantOutput === "final answer\n\n",
  transcript_env_enables_separate_turn_feed_chunk:
    turnTranscriptPlain.includes("搜索")
    && turnOutputTranscript.assistantOutput === "final answer\n\n"
    && !stripAnsi(turnOutputTranscript.assistantOutput).includes("搜索"),
  transcript_ask_user_suppresses_turn_feed:
    turnOutputAskUser.activityFeed === "",
  transcript_non_interactive_suppresses_turn_feed:
    turnOutputNonInteractive.activityFeed === ""
    && turnOutputNonInteractive.assistantOutput === "**raw final**\n",
  transcript_env_resolver:
    resolveRuntimeActivityFeedTranscriptEnabled("1")
    && resolveRuntimeActivityFeedTranscriptEnabled("on")
    && !resolveRuntimeActivityFeedTranscriptEnabled(undefined)
    && !resolveRuntimeActivityFeedTranscriptEnabled("0"),
  empty_without_tool_events: emptyRendered === "",
  rows_within_width: lines.every((line) => measureDisplayWidth(line) <= 96),
  no_invalid_tokens:
    !rendered.includes("undefined") && !rendered.includes("NaN") && !rendered.includes("null")
    && !fullRendered.includes("undefined") && !fullRendered.includes("NaN") && !fullRendered.includes("null"),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
