import { type RuntimeEvent } from "../../../models/types";
import {
  recordRuntimeToolSurfaceMetrics,
  summarizeRuntimeToolEvents,
} from "../../../tools/runtime/tool-events";
import { adaptRuntimeToolContextForRecovery } from "../../../tools/runtime/default-enabled-tools";
import {
  recordRuntimeToolSurfaceAdaptationOutcome as persistRuntimeToolSurfaceAdaptationOutcome,
} from "../../../tools/runtime/tool-surface-adaptation-state";

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function payloadNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function hashText(raw: string): number {
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function summarizeToolOutput(payload: Record<string, unknown>): string {
  const outputSummary = payload.output_summary;
  if (!outputSummary || typeof outputSummary !== "object" || Array.isArray(outputSummary)) {
    return "";
  }
  const summary = outputSummary as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of [
    "tool",
    "count",
    "limit_reached",
    "engine",
    "preferred_engine",
    "exit_code",
    "matches_count",
    "entries_count",
    "stdout_chars",
    "stderr_chars",
    "tool_content_chars",
    "error_class",
  ]) {
    const value = summary[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      parts.push(`${key}=${String(value)}`);
    }
  }
  return parts.slice(0, 8).join(" ");
}

export function buildRuntimeToolTraceMemory(input: {
  events: readonly RuntimeEvent[];
  userText: string;
}): { text: string; toolCount: number; failedCount: number; deferredCount: number; turnId?: string } | undefined {
  const toolEndEvents = input.events.filter((event) => event.eventType === "tool_end");
  if (toolEndEvents.length === 0) {
    return undefined;
  }
  const failedCount = toolEndEvents.filter((event) => payloadString(event.payload, "status") === "failed").length;
  const deferredCount = toolEndEvents.filter((event) => payloadString(event.payload, "status") === "deferred").length;
  const rows = toolEndEvents.slice(0, 6).map((event) => {
    const payload = event.payload;
    const durationMs = payloadNumber(payload, "duration_ms");
    const durationLabel = typeof durationMs === "number" ? String(durationMs) : "n/a";
    const summary = summarizeToolOutput(payload);
    return [
      `tool=${payloadString(payload, "tool_name") || "unknown_tool"}`,
      `status=${payloadString(payload, "status") || "unknown"}`,
      `risk=${payloadString(payload, "risk_class") || "unknown"}`,
      `duration_ms=${durationLabel}`,
      summary ? `summary=${summary}` : "",
    ].filter(Boolean).join(" ");
  });
  const userHash = hashText(input.userText).toString(16);
  const overflow = toolEndEvents.length > rows.length
    ? `\n- omitted=${String(toolEndEvents.length - rows.length)}`
    : "";
  return {
    text: [
      `[runtime-tool-trace] user_hash=${userHash} total=${String(toolEndEvents.length)} failed=${String(failedCount)} deferred=${String(deferredCount)}`,
      ...rows.map((row) => `- ${row}`),
    ].join("\n") + overflow,
    toolCount: toolEndEvents.length,
    failedCount,
    deferredCount,
    turnId: toolEndEvents[0]?.turnId,
  };
}

export function recordRuntimeToolMetricsForEvents(input: {
  workDir: string;
  events: readonly RuntimeEvent[];
  source: "runtime_turn" | "runtime_failure";
  writeStderr(message: string): void;
}): void {
  const toolEventSummary = summarizeRuntimeToolEvents(input.events);
  if (toolEventSummary.callsTotal === 0 && !toolEventSummary.latestRecovery) {
    return;
  }
  const metrics = recordRuntimeToolSurfaceMetrics({
    workDir: input.workDir,
    events: input.events,
  });
  input.writeStderr(
    `[tool-metrics] event=recorded source=${input.source} calls=${String(toolEventSummary.callsTotal)} failed=${String(toolEventSummary.failedTotal)} deferred=${String(toolEventSummary.deferredTotal)} total_calls=${String(metrics.callsTotal)}\n`,
  );
  if (toolEventSummary.latestRecovery) {
    input.writeStderr(
      `[tool-recovery] stage=${toolEventSummary.latestRecovery.stage} reason=${toolEventSummary.latestRecovery.reason} action=${toolEventSummary.latestRecovery.recommendedNextAction} tool=${toolEventSummary.latestRecovery.toolName ?? "<none>"} error_class=${toolEventSummary.latestRecovery.errorClass ?? "<none>"}\n`,
    );
  }
}

export function writeRuntimeToolSurfaceAdaptationOutcome(input: {
  workDir: string;
  adaptation: ReturnType<typeof adaptRuntimeToolContextForRecovery>["adaptation"];
  events: readonly RuntimeEvent[];
  verificationPass?: boolean;
  traceId?: string;
  startedAtIso?: string;
  recoveryObservedAt?: string | null;
  writeStderr(message: string): void;
}): void {
  const outcome = persistRuntimeToolSurfaceAdaptationOutcome({
    workDir: input.workDir,
    adaptation: input.adaptation,
    events: input.events,
    verificationPass: input.verificationPass,
    traceId: input.traceId,
    startedAtIso: input.startedAtIso,
    recoveryObservedAt: input.recoveryObservedAt,
  });
  if (!outcome.recorded || !outcome.record) {
    return;
  }
  input.writeStderr(
    `[tool-surface] event=adaptation_outcome profile=${outcome.record.appliedProfile} outcome=${outcome.record.outcome} reason=${outcome.record.outcomeReason} calls=${String(outcome.record.callsTotal)} failed=${String(outcome.record.failedTotal)} deferred=${String(outcome.record.deferredTotal)}\n`,
  );
}

export function resolveErrorClass(message: string): string {
  const classMatch = message.match(/\bclass=([a-zA-Z0-9_]+)/);
  if (classMatch && typeof classMatch[1] === "string" && classMatch[1].length > 0) {
    return classMatch[1];
  }
  if (message.includes("timeout")) {
    return "upstream_timeout";
  }
  return "runtime_error";
}

export function deriveFailureStageFromError(
  errorClass: string,
  message: string,
): "planning" | "implementation" | "verification" | "runtime" | "unknown" {
  const merged = `${errorClass} ${message}`.toLowerCase();
  if (/(verify|verification|assert|contract|schema|lint|typecheck|测试|验证|验收)/.test(merged)) {
    return "verification";
  }
  if (/(timeout|429|503|upstream|provider|network|socket|连接|超时|限流)/.test(merged)) {
    return "runtime";
  }
  if (/(parse|invalid|argument|option|input|prompt|intent|参数|解析|输入)/.test(merged)) {
    return "planning";
  }
  if (/(tool|shell|write|read|path|permission|command|fs|文件|目录|权限)/.test(merged)) {
    return "implementation";
  }
  return "unknown";
}
