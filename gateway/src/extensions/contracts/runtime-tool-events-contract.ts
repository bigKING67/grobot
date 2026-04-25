import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeEvent } from "../../models/types";
import { RuntimeRpcError, extractRuntimeErrorEvents } from "../../tools/runtime/runtime-error";
import {
  buildRuntimeToolRecoveryFeedback,
  readRuntimeToolSurfaceMetrics,
  recordRuntimeToolSurfaceMetrics,
  summarizeRuntimeToolEvents,
} from "../../tools/runtime/tool-events";

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: actual=${String(actual)} expected=${String(expected)}`);
  }
}

function event(eventType: RuntimeEvent["eventType"], payload: Record<string, unknown>): RuntimeEvent {
  return {
    traceId: "trace_runtime_tool_events_contract",
    turnId: "turn_runtime_tool_events_contract",
    sessionKey: "dev:tenant:dm:user",
    eventType,
    payload,
    timestampIso: "2026-04-25T00:00:00.000Z",
  };
}

const events: RuntimeEvent[] = [
  event("tool_end", {
    tool_name: "read",
    status: "ok",
    duration_ms: 12,
  }),
  event("tool_end", {
    tool_name: "edit",
    status: "failed",
    error_class: "edit_stale_target",
    duration_ms: 18,
  }),
  event("tool_recovery", {
    tool_name: "edit",
    error_class: "edit_stale_target",
    recovery_stage: "local_fix",
    recovery_reason: "edit_stale_target",
    recommended_next_action: "reread_target_then_retry",
  }),
  event("tool_end", {
    tool_name: "bash",
    status: "deferred",
    error_class: "tool_execution_deferred",
  }),
  event("tool_recovery", {
    tool_name: "bash",
    error_class: "tool_execution_deferred",
    recovery_stage: "observe_first",
    recovery_reason: "tool_execution_deferred",
    recommended_next_action: "observe_prior_tool_result",
  }),
];

const summary = summarizeRuntimeToolEvents(events);
expectEqual(summary.callsTotal, 3, "summary calls");
expectEqual(summary.failedTotal, 1, "summary failed");
expectEqual(summary.deferredTotal, 1, "summary deferred");
expectEqual(summary.callsByTool.read, 1, "summary read count");
expectEqual(summary.callsByTool.edit, 1, "summary edit count");
expectEqual(summary.failuresByErrorClass.edit_stale_target, 1, "summary edit failure class");
expectEqual(summary.failuresByErrorClass.tool_execution_deferred, 1, "summary deferred class");
expectEqual(summary.recoveryStages.local_fix, 1, "summary local recovery");
expectEqual(summary.recoveryStages.observe_first, 1, "summary observe recovery");
expectEqual(summary.latestRecovery?.stage, "observe_first", "summary latest recovery stage");
expectEqual(summary.latestRecovery?.recommendedNextAction, "observe_prior_tool_result", "summary latest action");

const workDir = join("/tmp", `grobot-runtime-tool-events-${String(process.pid)}-${String(Date.now())}`);
mkdirSync(workDir, { recursive: true });
try {
  const initial = readRuntimeToolSurfaceMetrics(workDir);
  expectEqual(initial.callsTotal, 0, "initial calls");
  expectEqual(initial.updatedAt, null, "initial updatedAt");

  const first = recordRuntimeToolSurfaceMetrics({ workDir, events });
  expectEqual(first.callsTotal, 3, "first calls");
  expectEqual(first.failedTotal, 1, "first failed");
  expectEqual(first.deferredTotal, 1, "first deferred");
  expectEqual(first.avgDurationMsByTool.read, 12, "first read avg");
  expectEqual(first.avgDurationMsByTool.edit, 18, "first edit avg");
  expectEqual(first.latestRecovery?.stage, "observe_first", "first latest recovery");
  expectEqual(typeof first.latestRecovery?.observedAt, "string", "first latest recovery observedAt");

  const activeFeedback = buildRuntimeToolRecoveryFeedback({
    metrics: first,
    nowMs: Date.parse(first.latestRecovery?.observedAt ?? ""),
  });
  expectEqual(activeFeedback.active, true, "active feedback enabled");
  expectEqual(activeFeedback.severity, "info", "active feedback severity");
  expectEqual(activeFeedback.recommendedNextAction, "observe_prior_tool_result", "active feedback action");
  expect(activeFeedback.promptBlock.includes("Do not repeat an identical failing tool call"), "active feedback prompt rule");

  const readBack = readRuntimeToolSurfaceMetrics(workDir);
  expectEqual(readBack.callsTotal, 3, "readback calls");
  expectEqual(readBack.latestRecovery?.recommendedNextAction, "observe_prior_tool_result", "readback latest action");

  const second = recordRuntimeToolSurfaceMetrics({ workDir, events: events.slice(0, 2) });
  expectEqual(second.callsTotal, 5, "second cumulative calls");
  expectEqual(second.failedTotal, 2, "second cumulative failed");
  expectEqual(second.callsByTool.read, 2, "second read count");
  expectEqual(second.callsByTool.edit, 2, "second edit count");

  const staleFeedback = buildRuntimeToolRecoveryFeedback({
    metrics: second,
    nowMs: Date.parse(second.latestRecovery?.observedAt ?? "") + 2_000,
    maxAgeMs: 1,
  });
  expectEqual(staleFeedback.active, false, "stale feedback disabled");
  expectEqual(staleFeedback.reason, "stale_recovery", "stale feedback reason");
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

const runtimeError = new RuntimeRpcError({
  message: "runtime rpc error -32001: runtime turn execution failed",
  errorClass: "edit_stale_target",
  errorMessage: "stale edit target",
  traceId: "trace_runtime_tool_events_contract",
  runtimeEvents: events,
});
expectEqual(extractRuntimeErrorEvents(runtimeError).length, events.length, "runtime error events extracted");
expectEqual(extractRuntimeErrorEvents(new Error("plain")).length, 0, "plain error has no runtime events");
expect(summary.latestRecovery !== undefined, "latest recovery exists");

process.stdout.write(JSON.stringify({
  ok: true,
  summary_calls_total: summary.callsTotal,
  summary_failed_total: summary.failedTotal,
  summary_deferred_total: summary.deferredTotal,
  latest_recovery_stage: summary.latestRecovery?.stage,
  runtime_error_events: extractRuntimeErrorEvents(runtimeError).length,
  feedback_active: true,
}) + "\n");
