import { spawn } from "node:child_process";
import {
  RuntimeAskUserInterrupt,
  RuntimeClient,
  RuntimeEvent,
  RuntimeEventType,
  RuntimeExecuteOptions,
  RuntimeRequest,
  RuntimeTurnInterrupt,
  RuntimeTurnResult,
} from "../../models/types";

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
const RUNTIME_SPAWN_TIMEOUT_FLOOR_MS = 15_000;
const RUNTIME_SPAWN_TIMEOUT_CEILING_MS = 300_000;
const RUNTIME_SPAWN_TIMEOUT_HEADROOM_MS = 3_000;
const RUNTIME_INTERRUPT_ERROR_CLASS = "turn_interrupted";

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
    "turn_interrupted",
    "turn_end",
    "turn_failed",
    "session_resume",
    "no_tool_fallback_triggered",
    "no_tool_fallback_succeeded",
    "no_tool_fallback_exhausted",
  ];
  if (known.includes(value as RuntimeEventType)) {
    return value as RuntimeEventType;
  }
  return "turn_failed";
}

function normalizePositiveInt(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return undefined;
  }
  return normalized;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function parseAskUserInterrupt(raw: unknown): RuntimeAskUserInterrupt | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const questionId = asString(raw.question_id).trim();
  const blockingNodeId = asString(raw.blocking_node_id).trim();
  const question = asString(raw.question).trim();
  if (!questionId || !blockingNodeId || !question) {
    return undefined;
  }
  const options = Array.isArray(raw.options)
    ? raw.options
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .slice(0, 6)
    : [];
  const defaultOnTimeout = asString(raw.default_on_timeout, "continue_with_best_effort");
  const resumeToken = asString(raw.resume_token).trim() || `resume_${questionId}`;
  const createdAt = asString(raw.created_at, new Date().toISOString());
  return {
    questionId,
    blockingNodeId,
    question,
    options,
    defaultOnTimeout,
    resumeToken,
    createdAt,
  };
}

function parseRuntimeInterrupt(raw: unknown): RuntimeTurnInterrupt | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const kind = asString(raw.kind).trim().toLowerCase();
  if (kind !== "ask_user") {
    return undefined;
  }
  const askUser = parseAskUserInterrupt(raw.ask_user);
  if (!askUser) {
    return undefined;
  }
  return {
    kind: "ask_user",
    askUser,
  };
}

function resolveRuntimeBinaryPath(): string {
  const envPath = process.env.GROBOT_RUNTIME_BIN;
  if (typeof envPath === "string" && envPath.trim().length > 0) {
    return envPath.trim();
  }
  return `${process.cwd()}/runtime/target/debug/grobot-runtime`;
}

function toRpcRequestLine(request: RuntimeRequest): string {
  const runtimeModelConfig = request.modelConfig;
  const runtimeToolContext = request.toolContext;
  const modelConfigPayload = runtimeModelConfig
    ? {
        base_url: runtimeModelConfig.baseUrl,
        api_key: runtimeModelConfig.apiKey,
        model: runtimeModelConfig.model,
        timeout_ms: runtimeModelConfig.timeoutMs,
        provider_kind: runtimeModelConfig.providerKind,
        provider_options: runtimeModelConfig.providerOptions
          ? {
              kimi: runtimeModelConfig.providerOptions.kimi
                ? {
                    web_search_mode: runtimeModelConfig.providerOptions.kimi.webSearchMode,
                    disable_thinking_on_builtin_web_search:
                      runtimeModelConfig.providerOptions.kimi.disableThinkingOnBuiltinWebSearch,
                    official_tools_allowlist:
                      runtimeModelConfig.providerOptions.kimi.officialToolsAllowlist,
                    official_tool_formulas:
                      runtimeModelConfig.providerOptions.kimi.officialToolFormulas,
                    max_tokens: runtimeModelConfig.providerOptions.kimi.maxTokens,
                    stream: runtimeModelConfig.providerOptions.kimi.stream,
                    temperature: runtimeModelConfig.providerOptions.kimi.temperature,
                    top_p: runtimeModelConfig.providerOptions.kimi.topP,
                    files_enabled: runtimeModelConfig.providerOptions.kimi.filesEnabled,
                    allow_file_admin: runtimeModelConfig.providerOptions.kimi.allowFileAdmin,
                  }
                : undefined,
            }
          : undefined,
      }
    : undefined;
  const toolContextPayload = runtimeToolContext
    ? {
        work_dir: runtimeToolContext.workDir,
        enabled_tools: runtimeToolContext.enabledTools,
        bash_allowlist: runtimeToolContext.bashAllowlist,
        max_tool_rounds: runtimeToolContext.maxToolRounds,
        no_tool_fallback_mode: runtimeToolContext.noToolFallbackMode,
        max_recovery_rounds: runtimeToolContext.maxRecoveryRounds,
      }
    : undefined;
  return JSON.stringify({
    jsonrpc: "2.0",
    id: request.requestId,
    method: "runtime.turn.execute",
    params: {
      request_id: request.requestId,
      session_key: request.sessionKey,
      user_message: request.userMessage,
      context_lines: request.contextLines,
      model_config: modelConfigPayload,
      tool_context: toolContextPayload,
      attachments: Array.isArray(request.attachments) && request.attachments.length > 0
        ? request.attachments.map((item) => ({
            type: item.type,
            source_type: item.sourceType,
            source: item.source,
            mime_type: item.mimeType,
            filename: item.filename,
          }))
        : undefined,
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
  const interrupt = parseRuntimeInterrupt(response.result.interrupt);
  if (!assistantMessage && !interrupt) {
    throw new Error("runtime assistant message is empty");
  }

  const events = toEventObjects(traceId, request.sessionKey, response.result.events);
  return {
    traceId,
    runtimeLabel: "rust",
    assistantMessage,
    interrupt,
    events,
  };
}

function buildInterruptedError(detail: string): Error {
  return new Error(`runtime turn interrupted class=${RUNTIME_INTERRUPT_ERROR_CLASS} detail=${detail}`);
}

interface SpawnRuntimeResult {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
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
    this.timeoutMs = options?.timeoutMs ?? RUNTIME_SPAWN_TIMEOUT_FLOOR_MS;
    this.maxBufferBytes = options?.maxBufferBytes ?? 1_048_576;
  }

  private resolveRequestTimeoutMs(request: RuntimeRequest): number {
    const baseTimeout = clamp(this.timeoutMs, RUNTIME_SPAWN_TIMEOUT_FLOOR_MS, RUNTIME_SPAWN_TIMEOUT_CEILING_MS);
    const modelTimeout = normalizePositiveInt(request.modelConfig?.timeoutMs);
    if (typeof modelTimeout !== "number") {
      return baseTimeout;
    }
    const expandedTimeout = clamp(
      modelTimeout + RUNTIME_SPAWN_TIMEOUT_HEADROOM_MS,
      RUNTIME_SPAWN_TIMEOUT_FLOOR_MS,
      RUNTIME_SPAWN_TIMEOUT_CEILING_MS,
    );
    return Math.max(baseTimeout, expandedTimeout);
  }

  private async executeRpcRequest(
    input: string,
    requestTimeoutMs: number,
    request: RuntimeRequest,
    signal?: AbortSignal,
  ): Promise<SpawnRuntimeResult> {
    if (signal?.aborted) {
      throw buildInterruptedError("aborted_before_spawn");
    }
    return await new Promise<SpawnRuntimeResult>((resolve, reject) => {
      let settled = false;
      let stdout = "";
      let stderr = "";
      let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      let child: ReturnType<typeof spawn> | undefined;
      const cleanup = (): void => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = undefined;
        }
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
          forceKillTimer = undefined;
        }
        if (signal && onAbort) {
          signal.removeEventListener("abort", onAbort);
        }
      };
      const finish = (result: SpawnRuntimeResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(result);
      };
      const fail = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };
      const terminateChild = (): void => {
        if (!child) {
          return;
        }
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore terminate errors
        }
        forceKillTimer = setTimeout(() => {
          try {
            child?.kill("SIGKILL");
          } catch {
            // ignore force-kill errors
          }
        }, 200);
      };
      const onAbort = (): void => {
        terminateChild();
        fail(buildInterruptedError("aborted_during_runtime_call"));
      };
      try {
        child = spawn(this.runtimeBinaryPath, [], {
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        fail(new Error(`runtime spawn failed: ${String(error)}`));
        return;
      }
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string | Buffer) => {
        stdout += String(chunk);
        if (stdout.length > this.maxBufferBytes) {
          terminateChild();
          fail(new Error(`runtime stdout exceeded max buffer ${String(this.maxBufferBytes)} bytes`));
        }
      });
      child.stderr.on("data", (chunk: string | Buffer) => {
        stderr += String(chunk);
        if (stderr.length > this.maxBufferBytes) {
          terminateChild();
          fail(new Error(`runtime stderr exceeded max buffer ${String(this.maxBufferBytes)} bytes`));
        }
      });
      child.on("error", (error) => {
        fail(new Error(`runtime spawn failed: ${String(error)}`));
      });
      child.on("close", (code, closeSignal) => {
        finish({
          code,
          signal: closeSignal,
          stdout,
          stderr,
        });
      });
      timeoutTimer = setTimeout(() => {
        terminateChild();
        const modelTimeout = normalizePositiveInt(request.modelConfig?.timeoutMs);
        const timeoutSource = typeof modelTimeout === "number"
          ? `model_timeout_ms=${String(modelTimeout)}`
          : "model_timeout_ms=default_unset";
        fail(
          new Error(
            `runtime spawn timeout after ${String(requestTimeoutMs)}ms (${timeoutSource}); consider setting --runtime-http-timeout-ms or GROBOT_RUNTIME_HTTP_TIMEOUT_MS`,
          ),
        );
      }, requestTimeoutMs);
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
      child.stdin.on("error", (error) => {
        fail(new Error(`runtime stdin write failed: ${String(error)}`));
      });
      child.stdin.write(input, "utf8", (error) => {
        if (error) {
          fail(new Error(`runtime stdin write failed: ${String(error)}`));
          return;
        }
        child?.stdin.end();
      });
    });
  }

  public async executeTurn(request: RuntimeRequest, options?: RuntimeExecuteOptions): Promise<RuntimeTurnResult> {
    const input = `${toRpcRequestLine(request)}\n`;
    const requestTimeoutMs = this.resolveRequestTimeoutMs(request);
    const run = await this.executeRpcRequest(input, requestTimeoutMs, request, options?.signal);
    if (run.code !== 0) {
      if (options?.signal?.aborted) {
        throw buildInterruptedError("aborted_after_runtime_exit");
      }
      throw new Error(
        `runtime exited non-zero status=${String(run.code)} signal=${String(run.signal ?? "")} stderr=${String(run.stderr || "").trim()}`,
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
