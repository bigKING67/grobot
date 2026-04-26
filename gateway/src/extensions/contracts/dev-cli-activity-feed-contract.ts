import type { RuntimeEvent } from "../../models/types";
import { measureDisplayWidth } from "../../orchestration/entrypoints/dev-cli/ui/interactive/display-width";
import { renderRuntimeActivityFeed } from "../../orchestration/entrypoints/dev-cli/ui/screens/activity-feed-screen";

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

const rendered = renderRuntimeActivityFeed({
  terminalColumns: 96,
  events: [
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
        tool_name: "read",
        status: "ok",
        duration_ms: 8,
        output_summary: {
          tool: "read",
          path: "gateway/src/orchestration/entrypoints/dev-cli/start/run-start-io.ts",
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
          path: "gateway/src/orchestration/entrypoints/dev-cli/ui/screens/bottom-pane-screen.ts",
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
const plain = stripAnsi(rendered);
const lines = rendered.trimEnd().split("\n");
const payload = {
  renders_real_tool_rows: plain.includes("Searched") && plain.includes("Read gateway/src"),
  renders_edit_with_diff_stats:
    plain.includes("Edited gateway/src/orchestration/entrypoints/dev-cli/ui/screens/bottom-pane-screen.ts (+2 -1)")
    && plain.includes("@@ -42,1 +42,2 @@"),
  renders_failed_bash:
    plain.includes("Failed bash") && plain.includes("error_class=bash_command_failed"),
  renders_recovery_row:
    plain.includes("Recovery bash") && plain.includes("stage=strategy_switch"),
  nested_payload_supported: plain.includes("matches=12 engine=rg"),
  empty_without_tool_events: emptyRendered === "",
  rows_within_width: lines.every((line) => measureDisplayWidth(line) <= 96),
  no_invalid_tokens:
    !rendered.includes("undefined") && !rendered.includes("NaN") && !rendered.includes("null"),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
