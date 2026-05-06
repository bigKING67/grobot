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
    eventType: "tool_start",
    nested: true,
    payload: {
      tool_name: "search",
      tool_call_id: "tool-search-1",
    },
  }),
  event({
    eventType: "tool_end",
    nested: true,
    payload: {
      tool_name: "search",
      tool_call_id: "tool-search-1",
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
      status: "ok",
      duration_ms: 1200,
      output_summary: {
        tool: "bash",
        exit_code: 1,
        stdout: "first line\nsecond line\nthird line\nfourth line\nfifth line\nsixth line\nseventh line",
        truncation: {
          stdout: {
            total_lines: 7,
            total_bytes: 70,
          },
        },
        audit: {
          command_preview: "npm run check:gateway:ts",
        },
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
const recoveryRendered = renderRuntimeActivityFeed({
  terminalColumns: 96,
  detailMode: "full",
  events: [
    event({
      eventType: "tool_recovery",
      payload: {
        tool_name: "edit",
        recovery_stage: "local_fix",
        recommended_next_action: "reread_target_then_retry",
        error_class: "edit_stale_target",
      },
    }),
    event({
      eventType: "tool_recovery",
      payload: {
        tool_name: "web_scan",
        recovery_stage: "ask_user",
        recommended_next_action: "request_environment_fix",
        error_class: "browser_backend_result_error",
      },
    }),
    event({
      eventType: "tool_recovery",
      payload: {
        tool_name: "read",
        recovery_stage: "observe_first",
        recommended_next_action: "observe_prior_tool_result",
        error_class: "tool_execution_deferred",
      },
    }),
    event({
      eventType: "tool_recovery",
      payload: {
        tool_name: "mcp_call",
        recovery_stage: "strategy_switch",
        recommended_next_action: "inspect_visible_tool_schema_then_retry",
        error_class: "mcp_rpc_error",
      },
    }),
  ],
});

const runningRendered = renderRuntimeActivityFeed({
  terminalColumns: 96,
  detailMode: "compact",
  events: [
    event({
      eventType: "tool_start",
      payload: {
        tool_name: "bash",
        tool_call_id: "tool-bash-running",
        input_summary: {
          command_preview: "npm test -- --runInBand",
        },
      },
    }),
  ],
});
const runningFullRendered = renderRuntimeActivityFeed({
  terminalColumns: 96,
  detailMode: "full",
  events: [
    event({
      eventType: "tool_start",
      payload: {
        tool_name: "bash",
        tool_call_id: "tool-bash-running-full",
        input_summary: {
          command_preview: "sleep 60",
        },
      },
    }),
  ],
});
const longBashCommand = [
  `node ${"a".repeat(80)}`,
  `echo ${"b".repeat(120)}`,
  "echo third-line-hidden",
].join("\n");
const longCommandRendered = renderRuntimeActivityFeed({
  terminalColumns: 240,
  detailMode: "compact",
  events: [
    event({
      eventType: "tool_start",
      payload: {
        tool_name: "bash",
        tool_call_id: "tool-bash-long-command",
        input_summary: {
          command_preview: longBashCommand,
        },
      },
    }),
  ],
});
const truncatedBashRendered = renderRuntimeActivityFeed({
  terminalColumns: 120,
  detailMode: "full",
  events: [
    event({
      eventType: "tool_end",
      payload: {
        tool_name: "bash",
        status: "ok",
        output_summary: {
          tool: "bash",
          exit_code: 0,
          stdout: "one\ntwo\nthree\nfour\nfive",
          truncation: {
            stdout: {
              truncated: true,
              truncated_by: "lines",
              total_lines: 2000,
              total_bytes: 900000,
            },
          },
          command_preview: "node scripts/large-output.js",
        },
      },
    }),
  ],
});
const ansiBashRendered = renderRuntimeActivityFeed({
  terminalColumns: 120,
  detailMode: "full",
  events: [
    event({
      eventType: "tool_end",
      payload: {
        tool_name: "bash",
        status: "ok",
        output_summary: {
          tool: "bash",
          exit_code: 0,
          stdout: "\u001B[31mred line\u001B[0m\nplain",
          truncation: {
            stdout: {
              total_lines: 2,
              total_bytes: 19,
            },
          },
          command_preview: "\u001B[32mnpm test\u001B[0m",
        },
      },
    }),
  ],
});
const failedMixedBashRendered = renderRuntimeActivityFeed({
  terminalColumns: 120,
  detailMode: "full",
  events: [
    event({
      eventType: "tool_end",
      payload: {
        tool_name: "bash",
        status: "ok",
        output_summary: {
          tool: "bash",
          exit_code: 2,
          stdout: "build stdout\nignored stdout",
          stderr: "error one\nerror two",
          truncation: {
            stdout: { total_lines: 2, total_bytes: 27 },
            stderr: { total_lines: 2, total_bytes: 19 },
          },
          command_preview: "npm run failing-script",
        },
      },
    }),
  ],
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
const recoveryPlain = stripAnsi(recoveryRendered);
const runningPlain = stripAnsi(runningRendered);
const runningFullPlain = stripAnsi(runningFullRendered);
const longCommandPlain = stripAnsi(longCommandRendered);
const truncatedBashPlain = stripAnsi(truncatedBashRendered);
const ansiBashPlain = stripAnsi(ansiBashRendered);
const failedMixedBashPlain = stripAnsi(failedMixedBashRendered);
const turnTranscriptPlain = stripAnsi(turnOutputTranscript.activityFeed);
const lines = rendered.trimEnd().split("\n");
const referenceToolStatusDot = process.platform === "darwin" ? "⏺" : "●";
const searchRowCount = plain
  .split("\n")
  .filter((line) => line.trimStart().startsWith(`${referenceToolStatusDot} Search`))
  .length;
const failedBashTitleCount = plain
  .split("\n")
  .filter((line) => line.trimStart().startsWith(`${referenceToolStatusDot} Run failed`))
  .length;
const bareBashTitleCount = plain
  .split("\n")
  .filter((line) => line.trimStart() === `${referenceToolStatusDot} Run`)
  .length;
const payload = {
  renders_real_tool_rows: plain.includes("Search") && plain.includes("Read gateway/src"),
  uses_reference_tool_status_dot:
    plain.trimStart().startsWith(`${referenceToolStatusDot} Search`)
    && !plain.trimStart().startsWith("• Search"),
  renders_unresolved_tool_start_as_dim_status:
    runningPlain.trimStart().startsWith(`${referenceToolStatusDot} Run $ npm test -- --runInBand`),
  unresolved_tool_start_uses_input_summary_without_raw_args:
    runningPlain.includes("Run $ npm test -- --runInBand")
    && !runningPlain.includes("command_preview")
    && !runningPlain.includes("input_summary")
    && !runningPlain.includes("command="),
  bash_running_full_detail_shows_progress_placeholder:
    runningFullPlain.includes("  ⎿  Running…"),
  bash_command_preview_limits_reference_display:
    longCommandPlain.includes("Run $ node")
    && longCommandPlain.includes("echo")
    && longCommandPlain.includes("…")
    && !longCommandPlain.includes("third-line-hidden")
    && !longCommandPlain.includes("command_preview"),
  resolved_tool_start_deduped_by_tool_end: searchRowCount === 1,
  compact_hides_key_value_details:
    !plain.includes("matches=")
    && !plain.includes("engine=")
    && !plain.includes("duration=")
    && !plain.includes("command=")
    && !plain.includes("command ")
    && !plain.includes("error_class=")
    && !plain.includes("@@ -42"),
  renders_edit_with_diff_stats:
    fullPlain.includes("Edit gateway/src/cli/tui/components/bottom-pane/render.ts (+2 -1)")
    && fullPlain.includes("@@ -42,1 +42,2 @@"),
  edit_detail_uses_human_copy:
    fullPlain.includes("  ⎿  1 replacement, line 42")
    && !fullPlain.includes("replacements=1 line=42"),
  renders_write_create_with_reference_preview:
    plain.includes("Write gateway/src/generated-file.ts · 12 lines")
    && fullPlain.includes("  ⎿  line-01")
    && fullPlain.includes("  ⎿  line-10")
    && fullPlain.includes("  ⎿  ... 2 more lines")
    && !fullPlain.includes("Ctrl+O expand"),
  compact_write_preview_hides_content:
    !plain.includes("line-01") && !plain.includes("Ctrl+O expand"),
  full_detail_uses_reference_status_glyph:
    fullPlain.includes("  ⎿  12 matches · rg · 15ms")
    && !fullPlain.includes("  └ 12 matches rg"),
  renders_failed_bash:
    plain.includes("Run failed")
    && fullPlain.includes("  ⎿  third line")
    && fullPlain.includes("  ⎿  seventh line")
    && fullPlain.includes("  ⎿  $ npm run check:gateway:ts · exit 1 · 1.2s")
    && fullPlain.includes("+2 lines")
    && fullPlain.includes("70 bytes")
    && !fullPlain.includes("command npm run check")
    && !fullPlain.includes("first line")
    && !fullPlain.includes("Error bash_command_failed"),
  bash_exit_code_failure_normalized_from_ok_status:
    failedBashTitleCount === 1
    && bareBashTitleCount === 0,
  bash_truncated_output_uses_estimated_line_status:
    truncatedBashPlain.includes("~2000 lines")
    && truncatedBashPlain.includes("878.9KB")
    && !truncatedBashPlain.includes("+1995 lines"),
  bash_output_and_command_strip_raw_ansi_sequences:
    ansiBashPlain.includes("red line")
    && ansiBashPlain.includes("$ npm test")
    && !ansiBashRendered.includes("\u001B[31mred line")
    && !ansiBashRendered.includes("\u001B[32mnpm test"),
  failed_bash_prefers_stderr_when_stdout_also_present:
    failedMixedBashPlain.includes("Run failed")
    && failedMixedBashPlain.includes("error two")
    && !failedMixedBashPlain.includes("ignored stdout"),
  renders_recovery_row:
    plain.includes("Recovery · Run")
    && fullPlain.includes("  ⎿  Switch strategy · Inspect error, then switch strategy · Error Command failed")
    && !fullPlain.includes("inspect_error_and_switch_strategy"),
  recovery_rows_humanize_all_known_stages:
    recoveryPlain.includes("Local fix · Reread target, then retry · Error Target changed")
    && recoveryPlain.includes("Waiting for confirmation · Environment fix needed · Error Browser backend error")
    && recoveryPlain.includes("Observe first · Observe prior tool result first · Error Tool execution deferred")
    && recoveryPlain.includes("Switch strategy · Inspect visible tool args, then retry · Error MCP call failed"),
  recovery_rows_avoid_raw_stage_and_action_codes:
    !recoveryPlain.includes("local_fix")
    && !recoveryPlain.includes("ask_user")
    && !recoveryPlain.includes("observe_first")
    && !recoveryPlain.includes("reread_target_then_retry")
    && !recoveryPlain.includes("request_environment_fix")
    && !recoveryPlain.includes("observe_prior_tool_result")
    && !recoveryPlain.includes("inspect_visible_tool_schema_then_retry"),
  full_detail_hides_raw_error_class:
    !fullPlain.includes("bash_command_failed")
    && !fullPlain.includes("error_class="),
  nested_payload_supported: fullPlain.includes("12 matches · rg"),
  plan_file_write_uses_reference_label:
    plain.includes("Plan updated")
    && !plain.includes("Wrote .grobot/plans")
    && !plain.includes("feishu-grobot-dm-ui/001-plan.md"),
  plan_file_edit_hides_path_and_diff_stats:
    fullPlain.includes("Plan updated")
    && !fullPlain.includes("Edited /tmp/grobot/.grobot/plans")
    && !fullPlain.includes("old plan")
    && !fullPlain.includes("new plan")
    && !fullPlain.includes("Plan updated (+"),
  plan_file_full_detail_shows_preview_hint:
    fullPlain.includes("  ⎿  /plan preview"),
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
    turnTranscriptPlain.includes("Search")
    && turnOutputTranscript.assistantOutput === "final answer\n\n"
    && !stripAnsi(turnOutputTranscript.assistantOutput).includes("Search"),
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
