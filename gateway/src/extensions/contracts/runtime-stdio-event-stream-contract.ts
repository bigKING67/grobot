import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StdioRustRuntimeClient } from "../../tools/runtime/stdio-client";
import { type RuntimeEvent, type RuntimeRequest } from "../../models/types";

const EVENT_PREFIX = "[grobot-runtime-event] ";

function buildFakeRuntimeScript(): string {
  return `#!/usr/bin/env node
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
process.stdin.on("end", () => {
  const input = Buffer.concat(chunks).toString("utf8").trim().split(/\\r?\\n/)[0] || "{}";
  const request = JSON.parse(input);
  const params = request.params || {};
  const streamEnabled = params.event_stream === "stderr_jsonl";
  const emitEvent = (eventType, payload) => {
    if (!streamEnabled) {
      return;
    }
    const event = {
      event_type: eventType,
      turn_id: "turn_fake_stream",
      timestamp_iso: "2026-05-06T00:00:00.000Z",
      payload,
    };
    process.stderr.write(${JSON.stringify(EVENT_PREFIX)} + JSON.stringify({
      grobot_event: "runtime_event",
      event,
    }) + "\\n");
  };
  emitEvent("turn_start", { request_id: params.request_id, source: "stderr_jsonl" });
  if (params.user_message === "fail_nonzero") {
    emitEvent("turn_failed", { error_class: "contract_failure" });
    process.stderr.write("plain runtime diagnostic kept\\n");
    process.exit(7);
    return;
  }
  const response = {
    jsonrpc: "2.0",
    id: request.id,
    result: {
      trace_id: "trace_fake_stream",
      assistant_message: JSON.stringify({ event_stream: params.event_stream || null }),
      events: [],
    },
  };
  process.stdout.write(JSON.stringify(response) + "\\n");
});
`;
}

function createFakeRuntime(): { path: string; cleanup(): void } {
  const dir = join(
    process.env.TMPDIR ?? "/tmp",
    `grobot-runtime-stdio-contract-${String(process.pid)}-${String(Date.now())}`,
  );
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "fake-runtime.js");
  writeFileSync(path, buildFakeRuntimeScript(), "utf8");
  chmodSync(path, 0o755);
  return {
    path,
    cleanup(): void {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function buildRequest(requestId: string, userMessage: string): RuntimeRequest {
  return {
    protocolVersion: "runtime.v1",
    requestId,
    sessionKey: "feishu:grobot:dm:stdio-event-stream-contract",
    userMessage,
    contextLines: [],
    metadata: {
      platform: "feishu",
      actorId: "contract",
      projectId: "grobot",
      gatewayImpl: "ts",
      runtimeImpl: "rust",
      shadowMode: false,
    },
  };
}

function parseAssistantMessage(value: string): { event_stream: string | null } {
  const parsed = JSON.parse(value) as unknown;
  assertEqual(typeof parsed, "object", "assistant message must be object JSON");
  assertCondition(parsed !== null, "assistant message object must not be null");
  return parsed as { event_stream: string | null };
}

function hasOwnKey(record: unknown, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function assertEqual(actual: unknown, expected: unknown, message?: string): void {
  if (actual !== expected) {
    throw new Error(message ?? `expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const fakeRuntime = createFakeRuntime();
  const receivedEvents: RuntimeEvent[] = [];
  try {
    const client = new StdioRustRuntimeClient({
      runtimeBinaryPath: fakeRuntime.path,
      timeoutMs: 15_000,
    });

    const streamingResult = await client.executeTurn(
      buildRequest("req_streaming_enabled", "success"),
      {
        streamEvents: true,
        onEvent: (event) => {
          receivedEvents.push(event);
        },
      },
    );
    const streamingMessage = parseAssistantMessage(streamingResult.assistantMessage);
    assertEqual(streamingMessage.event_stream, "stderr_jsonl");
    assertEqual(receivedEvents.length, 1);
    assertEqual(receivedEvents[0]?.eventType, "turn_start");
    assertEqual(receivedEvents[0]?.traceId, "trace_req_streaming_enabled");
    assertEqual(receivedEvents[0]?.payload.request_id, "req_streaming_enabled");
    assertEqual(hasOwnKey(receivedEvents[0]?.payload ?? {}, "event_type"), false);

    const noConsumerResult = await client.executeTurn(
      buildRequest("req_streaming_without_consumer", "success"),
      { streamEvents: true },
    );
    const noConsumerMessage = parseAssistantMessage(noConsumerResult.assistantMessage);
    assertEqual(noConsumerMessage.event_stream, null);

    const callbackOnlyResult = await client.executeTurn(
      buildRequest("req_callback_without_stream_flag", "success"),
      {
        onEvent: (event) => {
          receivedEvents.push(event);
        },
      },
    );
    const callbackOnlyMessage = parseAssistantMessage(callbackOnlyResult.assistantMessage);
    assertEqual(callbackOnlyMessage.event_stream, null);

    let nonzeroError = "";
    const nonzeroEvents: RuntimeEvent[] = [];
    try {
      await client.executeTurn(
        buildRequest("req_nonzero_streaming", "fail_nonzero"),
        {
          streamEvents: true,
          onEvent: (event) => {
            nonzeroEvents.push(event);
          },
        },
      );
    } catch (error) {
      nonzeroError = String(error);
    }
    assertEqual(nonzeroEvents.map((event) => event.eventType).join(","), "turn_start,turn_failed");
    assertEqual(nonzeroError.includes("plain runtime diagnostic kept"), true);
    assertEqual(nonzeroError.includes(EVENT_PREFIX), false);
    assertEqual(nonzeroError.includes("grobot_event"), false);

    process.stdout.write(`${JSON.stringify({
      stream_enabled_sets_stderr_jsonl: streamingMessage.event_stream === "stderr_jsonl",
      no_consumer_disables_event_stream: noConsumerMessage.event_stream === null,
      callback_without_stream_flag_disables_event_stream: callbackOnlyMessage.event_stream === null,
      stderr_events_are_observed: receivedEvents[0]?.eventType === "turn_start",
      stderr_event_payload_is_normalized: !hasOwnKey(receivedEvents[0]?.payload ?? {}, "event_type"),
      stderr_event_lines_are_stripped_from_nonzero_error:
        nonzeroError.includes("plain runtime diagnostic kept")
        && !nonzeroError.includes(EVENT_PREFIX)
        && !nonzeroError.includes("grobot_event"),
    })}\n`);
  } finally {
    fakeRuntime.cleanup();
  }
}

void main();
