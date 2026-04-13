import { spawnSync } from "node:child_process";
import { RuntimeClient, RuntimeEvent, RuntimeEventType, RuntimeRequest, RuntimeTurnResult } from "../../models/types";

interface RpcErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

interface RpcSuccessPayload {
  jsonrpc: string;
  id: string | number | null;
  result: unknown;
}

interface RpcErrorEnvelope {
  jsonrpc: string;
  id: string | number | null;
  error: RpcErrorPayload;
}

type RpcResponseEnvelope = RpcSuccessPayload | RpcErrorEnvelope;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeRuntimeEventType(raw: unknown): RuntimeEventType {
  const value = asString(raw);
  const known: RuntimeEventType[] = [
    "turn_start",
    "model_request",
    "model_response",
    "tool_start",
    "tool_end",
    "turn_stream_chunk",
    "turn_end",
    "turn_failed",
    "session_resume",
  ];
  if (known.includes(value as RuntimeEventType)) {
    return value as RuntimeEventType;
  }
  return "turn_failed";
}

function toEventObjects(
  traceId: string,
  sessionKey: string,
  rawEvents: unknown,
): RuntimeEvent[] {
  if (!Array.isArray(rawEvents)) {
    return [];
  }

  const events: RuntimeEvent[] = [];
  for (const entry of rawEvents) {
    if (!isRecord(entry)) {
      continue;
    }
    const eventType = normalizeRuntimeEventType(entry.event_type);
    const turnId = asString(entry.turn_id, `turn_${Date.now()}`);
    const timestampIso = asString(entry.timestamp_iso, new Date().toISOString());
    events.push({
      traceId,
      turnId,
      sessionKey,
      eventType,
      payload: entry,
      timestampIso,
    });
  }
  return events;
}

function resolveRuntimeBinaryPath(): string {
  const envPath = process.env.GROBOT_RUNTIME_BIN;
  if (typeof envPath === "string" && envPath.trim().length > 0) {
    return envPath.trim();
  }
  return `${process.cwd()}/runtime/target/debug/grobot-runtime`;
}

function toRpcRequestLine(request: RuntimeRequest): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: request.requestId,
    method: "runtime.turn.execute",
    params: {
      request_id: request.requestId,
      session_key: request.sessionKey,
      user_message: request.userMessage,
      context_lines: request.contextLines,
    },
  });
}

function parseRpcResponse(stdout: string): RpcResponseEnvelope {
  const firstLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    throw new Error("runtime returned empty stdout");
  }
  const parsed = JSON.parse(firstLine) as unknown;
  if (!isRecord(parsed) || asString(parsed.jsonrpc) !== "2.0") {
    throw new Error("runtime returned invalid json-rpc payload");
  }
  if (isRecord(parsed.error)) {
      return {
        jsonrpc: "2.0",
        id: (typeof parsed.id === "string" || typeof parsed.id === "number" ? parsed.id : null),
        error: {
          code: Number(parsed.error.code ?? -32603),
          message: asString(parsed.error.message, "unknown runtime error"),
          data: parsed.error.data,
        },
      };
    }
  return {
    jsonrpc: "2.0",
    id: (typeof parsed.id === "string" || typeof parsed.id === "number" ? parsed.id : null),
    result: parsed.result,
  };
}

function parseRuntimeResult(request: RuntimeRequest, response: RpcSuccessPayload): RuntimeTurnResult {
  if (!isRecord(response.result)) {
    throw new Error("runtime result is not an object");
  }
  const traceId = asString(response.result.trace_id, `trace_${request.requestId}`);
  const assistantMessage = asString(response.result.assistant_message);
  if (!assistantMessage) {
    throw new Error("runtime assistant message is empty");
  }

  const events = toEventObjects(traceId, request.sessionKey, response.result.events);
  return {
    traceId,
    runtimeLabel: "rust",
    assistantMessage,
    events,
  };
}

export class StdioRustRuntimeClient implements RuntimeClient {
  private readonly runtimeBinaryPath: string;
  private readonly timeoutMs: number;
  private readonly maxBufferBytes: number;

  public constructor(options?: { runtimeBinaryPath?: string; timeoutMs?: number; maxBufferBytes?: number }) {
    this.runtimeBinaryPath =
      options?.runtimeBinaryPath && options.runtimeBinaryPath.trim().length > 0
        ? options.runtimeBinaryPath
        : resolveRuntimeBinaryPath();
    this.timeoutMs = options?.timeoutMs ?? 15_000;
    this.maxBufferBytes = options?.maxBufferBytes ?? 1_048_576;
  }

  public async executeTurn(request: RuntimeRequest): Promise<RuntimeTurnResult> {
    const input = `${toRpcRequestLine(request)}\n`;
    const run = spawnSync(this.runtimeBinaryPath, [], {
      input,
      encoding: "utf8",
      timeout: this.timeoutMs,
      maxBuffer: this.maxBufferBytes,
    });

    if (run.error) {
      throw new Error(`runtime spawn failed: ${String(run.error)}`);
    }
    if (run.status !== 0) {
      throw new Error(
        `runtime exited non-zero status=${String(run.status)} stderr=${String(run.stderr || "").trim()}`,
      );
    }

    const response = parseRpcResponse(String(run.stdout || ""));
    if ("error" in response) {
      const errorData = isRecord(response.error.data) ? response.error.data : undefined;
      const errorClass = asString(errorData?.error_class);
      const errorMessage = asString(errorData?.error_message);
      const traceId = asString(errorData?.trace_id);
      const detail = [
        errorClass ? `class=${errorClass}` : "",
        traceId ? `trace=${traceId}` : "",
        errorMessage ? `detail=${errorMessage}` : "",
      ]
        .filter((item) => item.length > 0)
        .join(" ");
      throw new Error(
        `runtime rpc error ${response.error.code}: ${response.error.message}${detail ? ` (${detail})` : ""}`,
      );
    }
    return parseRuntimeResult(request, response);
  }
}
