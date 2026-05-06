import type { RuntimeEvent } from "../../../models/types";
import { renderRuntimeActivityFeed } from "../../../cli/tui/components/activity-feed/render";

export interface GroupedToolFlowFixturePlain {
  groupedReads: string;
  mixedResolvedRunning: string;
  failedGroupGuard: string;
  attachedRecovery: string;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

function event(input: {
  eventType: RuntimeEvent["eventType"];
  payload: Record<string, unknown>;
}): RuntimeEvent {
  return {
    traceId: "trace-ui-feed-grouped",
    turnId: "turn-ui-feed-grouped",
    sessionKey: "feishu:grobot:dm:ui",
    eventType: input.eventType,
    payload: input.payload,
    timestampIso: "2026-04-26T00:00:00.000Z",
  };
}

function renderPlain(events: readonly RuntimeEvent[], maxItems?: number): string {
  return stripAnsi(renderRuntimeActivityFeed({
    terminalColumns: 120,
    detailMode: "full",
    maxItems,
    events,
  }));
}

export function buildGroupedToolFlowFixturePlain(): GroupedToolFlowFixturePlain {
  const groupedReads = renderPlain([
    event({
      eventType: "tool_start",
      payload: {
        tool_name: "read",
        tool_call_id: "group-read-1",
        input_summary: { path: "gateway/src/cli/tui/a.ts" },
      },
    }),
    event({
      eventType: "tool_end",
      payload: {
        tool_name: "read",
        tool_call_id: "group-read-1",
        status: "ok",
        output_summary: {
          tool: "read",
          path: "gateway/src/cli/tui/a.ts",
          line_start: 1,
          line_end: 4,
        },
      },
    }),
    event({
      eventType: "tool_start",
      payload: {
        tool_name: "read",
        tool_call_id: "group-read-2",
        input_summary: { path: "gateway/src/cli/tui/b.ts" },
      },
    }),
    event({
      eventType: "tool_end",
      payload: {
        tool_name: "read",
        tool_call_id: "group-read-2",
        status: "ok",
        output_summary: {
          tool: "read",
          path: "gateway/src/cli/tui/b.ts",
          line_start: 8,
          line_end: 12,
        },
      },
    }),
    event({
      eventType: "tool_start",
      payload: {
        tool_name: "read",
        tool_call_id: "group-read-3",
        input_summary: { path: "gateway/src/cli/tui/c.ts" },
      },
    }),
    event({
      eventType: "tool_end",
      payload: {
        tool_name: "read",
        tool_call_id: "group-read-3",
        status: "ok",
        output_summary: {
          tool: "read",
          path: "gateway/src/cli/tui/c.ts",
          line_start: 20,
          line_end: 24,
        },
      },
    }),
  ]);

  const mixedResolvedRunning = renderPlain([
    event({
      eventType: "tool_start",
      payload: {
        tool_name: "read",
        tool_call_id: "mixed-read-resolved",
        input_summary: { path: "gateway/src/resolved-start.ts" },
      },
    }),
    event({
      eventType: "tool_end",
      payload: {
        tool_name: "read",
        tool_call_id: "mixed-read-resolved",
        status: "ok",
        output_summary: {
          tool: "read",
          path: "gateway/src/resolved-result.ts",
          line_start: 1,
          line_end: 2,
        },
      },
    }),
    event({
      eventType: "tool_start",
      payload: {
        tool_name: "read",
        tool_call_id: "mixed-read-running",
        input_summary: { path: "gateway/src/running-now.ts" },
      },
    }),
  ]);

  const failedGroupGuard = renderPlain([
    event({
      eventType: "tool_end",
      payload: {
        tool_name: "bash",
        tool_call_id: "bash-ok-before-fail",
        status: "ok",
        output_summary: {
          tool: "bash",
          exit_code: 0,
          stdout: "ok",
          command_preview: "npm run ok",
        },
      },
    }),
    event({
      eventType: "tool_end",
      payload: {
        tool_name: "bash",
        tool_call_id: "bash-fail-not-grouped",
        status: "failed",
        output_summary: {
          tool: "bash",
          exit_code: 1,
          stderr: "failure detail",
          command_preview: "npm run fail",
        },
      },
    }),
  ]);

  const attachedRecovery = renderPlain([
    event({
      eventType: "tool_start",
      payload: {
        tool_name: "bash",
        tool_call_id: "recover-bash",
        input_summary: { command_preview: "npm run recoverable" },
      },
    }),
    event({
      eventType: "tool_end",
      payload: {
        tool_name: "bash",
        tool_call_id: "recover-bash",
        status: "failed",
        output_summary: {
          tool: "bash",
          exit_code: 1,
          stderr: "recoverable failure",
          command_preview: "npm run recoverable",
        },
      },
    }),
    event({
      eventType: "tool_recovery",
      payload: {
        tool_name: "bash",
        tool_call_id: "recover-bash",
        recovery_stage: "strategy_switch",
        recommended_next_action: "inspect_error_and_switch_strategy",
        error_class: "bash_command_failed",
      },
    }),
  ], 2);

  return { groupedReads, mixedResolvedRunning, failedGroupGuard, attachedRecovery };
}
