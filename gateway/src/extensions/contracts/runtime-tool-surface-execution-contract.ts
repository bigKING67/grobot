import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { join, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

type MockModelCall = {
  bodyText: string;
  toolNames: string[];
  toolArgsByName: Record<string, string[]>;
  hasToolResult: boolean;
};

type ToolCallSpec = {
  name: string;
  arguments: JsonRecord;
};

type ErrorDataExpectation = {
  diagnosticKind: string;
  tool: string;
  operation: string;
  profile: string;
  advancedToolSchema: boolean;
  recoveryStage: string;
  recommendedNextAction: string;
  recoverable: boolean;
  recoveryPolicyVersion: string;
  backend?: string;
  mappedTool?: string;
  hiddenArgs?: string[];
  visibleArgsIncludes?: string[];
  visibleArgsExcludes?: string[];
  visibleToolsIncludes?: string[];
  visibleToolsExcludes?: string[];
  enabledToolsIncludes?: string[];
  enabledToolsExcludes?: string[];
  recoveryHintIncludes?: string[];
};

type RuntimeRpcResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type SurfaceCase = {
  id: string;
  profile: string;
  advancedToolSchema: boolean;
  enabledTools: string[];
  modelVisibleTools: string[];
  toolCall: ToolCallSpec;
  expectedOutcome: "success" | "error";
  expectedAssistantMessage?: string;
  expectedErrorClass?: string;
  expectedErrorData?: ErrorDataExpectation;
  schemaExpectations: Array<{
    tool: string;
    includes?: string[];
    excludes?: string[];
  }>;
};

type SurfaceCaseResult = {
  id: string;
  profile: string;
  outcome: "success" | "error";
  runtime_call_count: number;
  first_model_tool_names: string[];
  tool_end_status: string;
  tool_end_error_class: string | null;
  schema_projection_checks: number;
  structured_error_data_checks: number;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function sortedUnique(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function expectSameStringSet(actual: readonly string[], expected: readonly string[], message: string): void {
  const actualSorted = sortedUnique(actual);
  const expectedSorted = sortedUnique(expected);
  const actualJson = JSON.stringify(actualSorted);
  const expectedJson = JSON.stringify(expectedSorted);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: actual=${actualJson} expected=${expectedJson}`);
  }
  if (actual.length !== actualSorted.length) {
    throw new Error(`${message}: duplicate values in actual=${JSON.stringify(actual)}`);
  }
}

function readUtf8Body(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: string[] = [];
    request.on("data", (chunk) => {
      chunks.push(String(chunk));
    });
    request.on("end", () => resolveBody(chunks.join("")));
    try {
      // The local Node shim keeps IncomingMessage intentionally small; runtime still supports this event.
      (request as unknown as { on(event: "error", listener: (error: Error) => void): void })
        .on("error", reject);
    } catch {
      // ignore shim/runtime differences
    }
  });
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function extractToolNames(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.tools)) {
    return [];
  }
  return body.tools
    .map((entry) => {
      if (!isRecord(entry) || !isRecord(entry.function)) {
        return "";
      }
      return typeof entry.function.name === "string" ? entry.function.name : "";
    })
    .filter((name) => name.length > 0);
}

function extractToolArgsByName(body: unknown): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (!isRecord(body) || !Array.isArray(body.tools)) {
    return result;
  }
  for (const entry of body.tools) {
    if (!isRecord(entry) || !isRecord(entry.function)) {
      continue;
    }
    const name = typeof entry.function.name === "string" ? entry.function.name : "";
    if (!name || !isRecord(entry.function.parameters)) {
      continue;
    }
    const properties = isRecord(entry.function.parameters.properties)
      ? entry.function.parameters.properties
      : {};
    result[name] = Object.keys(properties).sort((left, right) => left.localeCompare(right));
  }
  return result;
}

function messagesHaveToolResult(body: unknown): boolean {
  if (!isRecord(body) || !Array.isArray(body.messages)) {
    return false;
  }
  return body.messages.some((message) => (
    isRecord(message) && message.role === "tool"
  ));
}

async function startSurfaceMockModelServer(
  toolCall: ToolCallSpec,
  finalContent: string,
): Promise<{
  baseUrl: string;
  getCalls: () => MockModelCall[];
  close: () => Promise<void>;
}> {
  const calls: MockModelCall[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.statusCode = 404;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    const bodyText = await readUtf8Body(request);
    let body: unknown = null;
    try {
      body = parseJson(bodyText);
    } catch {
      body = null;
    }
    const hasToolResult = messagesHaveToolResult(body);
    calls.push({
      bodyText,
      toolNames: extractToolNames(body),
      toolArgsByName: extractToolArgsByName(body),
      hasToolResult,
    });

    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    if (!hasToolResult) {
      response.end(JSON.stringify({
        id: "mock-surface-execution",
        object: "chat.completion",
        choices: [{
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            tool_calls: [{
              id: `call_${toolCall.name}`,
              type: "function",
              function: {
                name: toolCall.name,
                arguments: JSON.stringify(toolCall.arguments),
              },
            }],
          },
        }],
      }));
      return;
    }

    response.end(JSON.stringify({
      id: "mock-surface-execution",
      object: "chat.completion",
      choices: [{
        index: 0,
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: finalContent,
        },
      }],
    }));
  });

  const port = await new Promise<number>((resolvePort, reject) => {
    const serverWithErrorHandler = server as unknown as {
      once(event: "error", listener: (error: Error) => void): void;
    };
    serverWithErrorHandler.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("surface mock model server failed to bind"));
        return;
      }
      resolvePort(address.port);
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${String(port)}/v1`,
    getCalls() {
      return calls.slice();
    },
    async close() {
      await new Promise((resolveClose) => server.close(() => resolveClose(undefined)));
    },
  };
}

function runtimeBinaryPath(repoRoot: string): string {
  return resolve(repoRoot, "runtime/target/debug", "grobot-runtime");
}

function runRuntimeTurn(
  repoRoot: string,
  request: JsonRecord,
  envOverrides: Record<string, string | undefined>,
  timeoutMs = 120_000,
): Promise<RuntimeRpcResult> {
  return new Promise((resolveResult, rejectResult) => {
    const binaryPath = runtimeBinaryPath(repoRoot);
    if (!existsSync(binaryPath)) {
      rejectResult(new Error(`runtime binary missing: ${binaryPath}; run cargo build --manifest-path runtime/Cargo.toml`));
      return;
    }
    const previousEnv = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(envOverrides)) {
      previousEnv.set(key, process.env[key]);
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
    const restoreEnv = () => {
      for (const [key, value] of previousEnv) {
        if (typeof value === "string") {
          process.env[key] = value;
        } else {
          delete process.env[key];
        }
      }
    };
    const child = spawn(binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeoutHandle = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        exitCode: 1,
        stdout,
        stderr: stderr.length > 0
          ? `${stderr}\nruntime surface execution timeout after ${String(timeoutMs)}ms`
          : `runtime surface execution timeout after ${String(timeoutMs)}ms`,
      });
    }, timeoutMs);

    const finish = (payload: RuntimeRpcResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      restoreEnv();
      resolveResult(payload);
    };

    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string | Buffer) => {
        stdout += String(chunk);
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string | Buffer) => {
        stderr += String(chunk);
      });
    }
    child.on("error", (error) => {
      restoreEnv();
      rejectResult(error);
    });
    child.on("close", (code) => {
      finish({
        exitCode: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });

    child.stdin.write(`${JSON.stringify(request)}\n`, "utf8", (error) => {
      if (error) {
        child.kill("SIGKILL");
        finish({
          exitCode: 1,
          stdout,
          stderr: `runtime stdin write failed: ${String(error)}`,
        });
      }
    });
    child.stdin.end();
  });
}

function parseFirstJsonLine(name: string, stdout: string): unknown {
  const firstLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    throw new Error(`${name}: empty runtime stdout`);
  }
  try {
    return parseJson(firstLine);
  } catch (error) {
    throw new Error(`${name}: first stdout line is not JSON: ${String(error)}\n${stdout}`);
  }
}

function eventRowsFromRpcPayload(payload: unknown): JsonRecord[] {
  if (!isRecord(payload)) {
    return [];
  }
  const resultEvents = isRecord(payload.result) && Array.isArray(payload.result.events)
    ? payload.result.events
    : null;
  const errorEvents = isRecord(payload.error)
    && isRecord(payload.error.data)
    && Array.isArray(payload.error.data.events)
    ? payload.error.data.events
    : null;
  const rows = resultEvents ?? errorEvents ?? [];
  return rows.filter(isRecord);
}

function rpcAssistantMessage(payload: unknown): string {
  return isRecord(payload)
    && isRecord(payload.result)
    && typeof payload.result.assistant_message === "string"
    ? payload.result.assistant_message
    : "";
}

function rpcErrorClass(payload: unknown): string {
  return isRecord(payload)
    && isRecord(payload.error)
    && isRecord(payload.error.data)
    && typeof payload.error.data.error_class === "string"
    ? payload.error.data.error_class
    : "";
}

function rpcErrorData(payload: unknown): JsonRecord | null {
  return isRecord(payload)
    && isRecord(payload.error)
    && isRecord(payload.error.data)
    && isRecord(payload.error.data.error_data)
    ? payload.error.data.error_data
    : null;
}

function eventPayload(event: JsonRecord): JsonRecord {
  return isRecord(event.payload) ? event.payload : {};
}

function findToolEndEvent(events: JsonRecord[], toolName: string): JsonRecord | null {
  return events.find((event) => {
    if (event.event_type !== "tool_end") {
      return false;
    }
    const payload = eventPayload(event);
    return payload.tool_name === toolName;
  }) ?? null;
}

function findToolRecoveryEvent(events: JsonRecord[], toolName: string): JsonRecord | null {
  return events.find((event) => {
    if (event.event_type !== "tool_recovery") {
      return false;
    }
    const payload = eventPayload(event);
    return payload.tool_name === toolName;
  }) ?? null;
}

function assertSchemaExpectations(
  firstCall: MockModelCall,
  expectations: SurfaceCase["schemaExpectations"],
  caseId: string,
): number {
  let checks = 0;
  for (const expectation of expectations) {
    const properties = firstCall.toolArgsByName[expectation.tool] ?? [];
    for (const argName of expectation.includes ?? []) {
      checks += 1;
      expect(
        properties.includes(argName),
        `${caseId}: expected ${expectation.tool}.${argName} to be visible; visible=${JSON.stringify(properties)}`,
      );
    }
    for (const argName of expectation.excludes ?? []) {
      checks += 1;
      expect(
        !properties.includes(argName),
        `${caseId}: expected ${expectation.tool}.${argName} to be hidden; visible=${JSON.stringify(properties)}`,
      );
    }
  }
  return checks;
}

function stringArrayField(data: JsonRecord, field: string, label: string): string[] {
  const value = data[field];
  expect(Array.isArray(value), `${label}: expected ${field} to be an array`);
  return value.map((item, index) => {
    expect(typeof item === "string", `${label}: expected ${field}[${String(index)}] to be string`);
    return item;
  });
}

function expectStringField(
  data: JsonRecord,
  field: string,
  expected: string,
  label: string,
): number {
  expectEqual(data[field], expected, `${label}: ${field}`);
  return 1;
}

function expectBooleanField(
  data: JsonRecord,
  field: string,
  expected: boolean,
  label: string,
): number {
  expectEqual(data[field], expected, `${label}: ${field}`);
  return 1;
}

function assertArrayIncludes(
  data: JsonRecord,
  field: string,
  expected: readonly string[] | undefined,
  label: string,
): number {
  let checks = 0;
  if (!expected || expected.length === 0) {
    return checks;
  }
  const values = stringArrayField(data, field, label);
  for (const item of expected) {
    checks += 1;
    expect(values.includes(item), `${label}: expected ${field} to include ${item}; values=${JSON.stringify(values)}`);
  }
  return checks;
}

function assertArrayExcludes(
  data: JsonRecord,
  field: string,
  expected: readonly string[] | undefined,
  label: string,
): number {
  let checks = 0;
  if (!expected || expected.length === 0) {
    return checks;
  }
  const values = stringArrayField(data, field, label);
  for (const item of expected) {
    checks += 1;
    expect(!values.includes(item), `${label}: expected ${field} to exclude ${item}; values=${JSON.stringify(values)}`);
  }
  return checks;
}

function assertErrorDataExpectation(
  data: JsonRecord,
  expectation: ErrorDataExpectation,
  caseId: string,
  source: string,
): number {
  const label = `${caseId}: ${source} error_data`;
  let checks = 0;
  checks += expectStringField(data, "diagnostic_kind", expectation.diagnosticKind, label);
  checks += expectStringField(data, "tool", expectation.tool, label);
  checks += expectStringField(data, "operation", expectation.operation, label);
  checks += expectStringField(data, "tool_surface_profile", expectation.profile, label);
  checks += expectBooleanField(data, "advanced_tool_schema", expectation.advancedToolSchema, label);
  checks += expectStringField(data, "recovery_stage", expectation.recoveryStage, label);
  checks += expectStringField(data, "recommended_next_action", expectation.recommendedNextAction, label);
  checks += expectBooleanField(data, "recoverable", expectation.recoverable, label);
  checks += expectStringField(data, "recovery_policy_version", expectation.recoveryPolicyVersion, label);
  if (typeof expectation.backend === "string") {
    checks += expectStringField(data, "backend", expectation.backend, label);
  }
  if (typeof expectation.mappedTool === "string") {
    checks += expectStringField(data, "mapped_tool", expectation.mappedTool, label);
  }
  if (expectation.hiddenArgs) {
    expectSameStringSet(stringArrayField(data, "hidden_args", label), expectation.hiddenArgs, `${label}: hidden_args`);
    checks += 1;
  }
  checks += assertArrayIncludes(data, "visible_args", expectation.visibleArgsIncludes, label);
  checks += assertArrayExcludes(data, "visible_args", expectation.visibleArgsExcludes, label);
  checks += assertArrayIncludes(data, "visible_tools", expectation.visibleToolsIncludes, label);
  checks += assertArrayExcludes(data, "visible_tools", expectation.visibleToolsExcludes, label);
  checks += assertArrayIncludes(data, "enabled_tools", expectation.enabledToolsIncludes, label);
  checks += assertArrayExcludes(data, "enabled_tools", expectation.enabledToolsExcludes, label);
  if (expectation.recoveryHintIncludes && expectation.recoveryHintIncludes.length > 0) {
    const recoveryHint = data.recovery_hint;
    expect(typeof recoveryHint === "string", `${label}: recovery_hint must be string`);
    for (const fragment of expectation.recoveryHintIncludes) {
      checks += 1;
      expect(recoveryHint.includes(fragment), `${label}: recovery_hint must include ${fragment}; value=${recoveryHint}`);
    }
  }
  return checks;
}

function assertStructuredErrorData(
  surfaceCase: SurfaceCase,
  rpcPayload: unknown,
  toolEndPayload: JsonRecord,
  toolRecoveryEvent: JsonRecord | null,
): number {
  if (!surfaceCase.expectedErrorData) {
    return 0;
  }
  let checks = 0;
  const toolEndErrorData = isRecord(toolEndPayload.error_data) ? toolEndPayload.error_data : null;
  expect(toolEndErrorData !== null, `${surfaceCase.id}: tool_end must expose structured error_data`);
  checks += assertErrorDataExpectation(
    toolEndErrorData,
    surfaceCase.expectedErrorData,
    surfaceCase.id,
    "tool_end",
  );

  const rpcData = rpcErrorData(rpcPayload);
  expect(rpcData !== null, `${surfaceCase.id}: RPC error must expose structured error_data`);
  checks += assertErrorDataExpectation(
    rpcData,
    surfaceCase.expectedErrorData,
    surfaceCase.id,
    "rpc_error",
  );

  expect(toolRecoveryEvent !== null, `${surfaceCase.id}: tool_recovery event missing`);
  const toolRecoveryPayload = eventPayload(toolRecoveryEvent);
  const toolRecoveryErrorData = isRecord(toolRecoveryPayload.error_data)
    ? toolRecoveryPayload.error_data
    : null;
  expect(toolRecoveryErrorData !== null, `${surfaceCase.id}: tool_recovery must expose structured error_data`);
  expectEqual(
    toolRecoveryPayload.error_class,
    surfaceCase.expectedErrorClass,
    `${surfaceCase.id}: tool_recovery error class`,
  );
  checks += 1;
  expectEqual(
    toolRecoveryPayload.recovery_stage,
    surfaceCase.expectedErrorData.recoveryStage,
    `${surfaceCase.id}: tool_recovery recovery_stage`,
  );
  checks += 1;
  expectEqual(
    toolRecoveryPayload.recommended_next_action,
    surfaceCase.expectedErrorData.recommendedNextAction,
    `${surfaceCase.id}: tool_recovery recommended_next_action`,
  );
  checks += 1;
  expectEqual(
    toolRecoveryPayload.recoverable,
    surfaceCase.expectedErrorData.recoverable,
    `${surfaceCase.id}: tool_recovery recoverable`,
  );
  checks += 1;
  checks += assertErrorDataExpectation(
    toolRecoveryErrorData,
    surfaceCase.expectedErrorData,
    surfaceCase.id,
    "tool_recovery",
  );
  return checks;
}

const fullDebugTools = [
  "list",
  "glob",
  "search",
  "read",
  "write",
  "edit",
  "bash",
  "mcp_servers",
  "mcp_call",
  "web_scan",
  "web_execute_js",
  "semantic_search",
  "prompt_enhancer",
  "ask_user",
];

const surfaceCases: SurfaceCase[] = [
  {
    id: "minimal_read_allowed",
    profile: "minimal",
    advancedToolSchema: false,
    enabledTools: ["read", "edit", "write", "ask_user"],
    modelVisibleTools: ["read", "edit", "write", "ask_user"],
    toolCall: {
      name: "read",
      arguments: {
        path: "notes.txt",
        offset: 1,
        limit: 1,
        include_metadata: true,
      },
    },
    expectedOutcome: "success",
    expectedAssistantMessage: "SURFACE_EXECUTION_OK",
    schemaExpectations: [
      { tool: "read", includes: ["path", "offset", "limit", "include_metadata"], excludes: ["line_start", "pages"] },
      { tool: "ask_user", includes: ["questions"], excludes: ["blocking_node_id", "resume_token"] },
    ],
  },
  {
    id: "coding_rejects_hidden_browser_tool",
    profile: "coding",
    advancedToolSchema: false,
    enabledTools: ["glob", "search", "read", "write", "edit", "bash", "ask_user"],
    modelVisibleTools: ["glob", "search", "read", "write", "edit", "bash", "ask_user"],
    toolCall: {
      name: "web_scan",
      arguments: {
        tabs_only: true,
      },
    },
    expectedOutcome: "error",
    expectedErrorClass: "tool_not_visible",
    expectedErrorData: {
      diagnosticKind: "tool_not_visible",
      tool: "web_scan",
      operation: "validate_tool_visible",
      profile: "coding",
      advancedToolSchema: false,
      recoveryStage: "strategy_switch",
      recommendedNextAction: "switch_tool_strategy",
      recoverable: true,
      recoveryPolicyVersion: "v1",
      visibleToolsIncludes: ["read", "bash"],
      visibleToolsExcludes: ["web_scan"],
      enabledToolsIncludes: ["read", "bash"],
      enabledToolsExcludes: ["web_scan"],
      recoveryHintIncludes: ["model-visible", "current surface"],
    },
    schemaExpectations: [
      { tool: "read", includes: ["path", "line_start", "pages"] },
    ],
  },
  {
    id: "browser_rejects_hidden_execute_transport_args",
    profile: "browser",
    advancedToolSchema: false,
    enabledTools: ["web_scan", "web_execute_js", "read", "ask_user"],
    modelVisibleTools: ["web_scan", "web_execute_js", "read", "ask_user"],
    toolCall: {
      name: "web_execute_js",
      arguments: {
        script: "return 1",
        tmwd_ws_endpoint: "ws://127.0.0.1:9222/devtools/browser/mock",
      },
    },
    expectedOutcome: "error",
    expectedErrorClass: "tool_argument_not_visible",
    expectedErrorData: {
      diagnosticKind: "tool_argument_not_visible",
      tool: "web_execute_js",
      operation: "validate_browser_facade_args_visible",
      profile: "browser",
      advancedToolSchema: false,
      recoveryStage: "strategy_switch",
      recommendedNextAction: "inspect_visible_tool_schema_then_retry",
      recoverable: true,
      recoveryPolicyVersion: "v1",
      backend: "browser-structured",
      mappedTool: "web_execute_js",
      hiddenArgs: ["tmwd_ws_endpoint"],
      visibleArgsIncludes: ["script", "timeout_ms"],
      visibleArgsExcludes: ["tmwd_ws_endpoint", "native_fallback_action"],
      recoveryHintIncludes: ["browser_advanced", "full_debug"],
    },
    schemaExpectations: [
      {
        tool: "web_execute_js",
        includes: ["script", "timeout_ms"],
        excludes: ["tmwd_ws_endpoint", "native_fallback_action"],
      },
      { tool: "read", includes: ["path", "offset", "limit"], excludes: ["line_start", "pages"] },
    ],
  },
  {
    id: "browser_advanced_rejects_full_native_action_args",
    profile: "browser_advanced",
    advancedToolSchema: true,
    enabledTools: ["web_scan", "web_execute_js", "read", "ask_user"],
    modelVisibleTools: ["web_scan", "web_execute_js", "read", "ask_user"],
    toolCall: {
      name: "web_execute_js",
      arguments: {
        script: "return document.title",
        tmwd_ws_endpoint: "ws://127.0.0.1:9222/devtools/browser/mock",
        native_fallback_action: "click",
        native_fallback_args: { x: 1, y: 2 },
      },
    },
    expectedOutcome: "error",
    expectedErrorClass: "tool_argument_not_visible",
    expectedErrorData: {
      diagnosticKind: "tool_argument_not_visible",
      tool: "web_execute_js",
      operation: "validate_browser_facade_args_visible",
      profile: "browser_advanced",
      advancedToolSchema: true,
      recoveryStage: "strategy_switch",
      recommendedNextAction: "inspect_visible_tool_schema_then_retry",
      recoverable: true,
      recoveryPolicyVersion: "v1",
      backend: "browser-structured",
      mappedTool: "web_execute_js",
      hiddenArgs: ["native_fallback_action", "native_fallback_args"],
      visibleArgsIncludes: ["tmwd_ws_endpoint", "native_auto_fallback", "native_fallback_timeout_ms"],
      visibleArgsExcludes: ["native_fallback_action", "native_fallback_args", "native_auto_execute"],
      recoveryHintIncludes: ["browser_advanced", "full_debug"],
    },
    schemaExpectations: [
      {
        tool: "web_execute_js",
        includes: [
          "script",
          "timeout_ms",
          "tmwd_ws_endpoint",
          "target_url_contains",
          "native_auto_fallback",
          "native_auto_fallback_policy",
          "native_fallback_timeout_ms",
        ],
        excludes: [
          "native_auto_execute",
          "native_execute_action_scope",
          "native_fallback_action",
          "native_fallback_args",
        ],
      },
      { tool: "read", includes: ["path", "line_start", "line_end", "pages"] },
    ],
  },
  {
    id: "context_rejects_hidden_semantic_debug_args",
    profile: "context",
    advancedToolSchema: false,
    enabledTools: ["semantic_search", "read", "ask_user"],
    modelVisibleTools: ["semantic_search", "read", "ask_user"],
    toolCall: {
      name: "semantic_search",
      arguments: {
        query: "tool surface drift",
        technical_terms: ["ContextWeaver"],
        bridge_script: "/tmp/custom-contextweaver.mjs",
      },
    },
    expectedOutcome: "error",
    expectedErrorClass: "tool_argument_not_visible",
    expectedErrorData: {
      diagnosticKind: "tool_argument_not_visible",
      tool: "semantic_search",
      operation: "validate_semantic_search_args_visible",
      profile: "context",
      advancedToolSchema: false,
      recoveryStage: "strategy_switch",
      recommendedNextAction: "inspect_visible_tool_schema_then_retry",
      recoverable: true,
      recoveryPolicyVersion: "v1",
      hiddenArgs: ["bridge_script", "technical_terms"],
      visibleArgsIncludes: ["query", "sources", "include_org"],
      visibleArgsExcludes: ["bridge_script", "technical_terms", "timeout_ms"],
      recoveryHintIncludes: ["full_debug"],
    },
    schemaExpectations: [
      {
        tool: "semantic_search",
        includes: ["query", "sources", "per_source_limit", "max_segments", "include_org"],
        excludes: ["technical_terms", "bridge_script", "timeout_ms"],
      },
    ],
  },
  {
    id: "mcp_rejects_hidden_inventory_args",
    profile: "mcp",
    advancedToolSchema: false,
    enabledTools: ["mcp_servers", "mcp_call", "ask_user"],
    modelVisibleTools: ["mcp_servers", "mcp_call", "ask_user"],
    toolCall: {
      name: "mcp_servers",
      arguments: {
        ready_only: true,
        include_disabled: true,
      },
    },
    expectedOutcome: "error",
    expectedErrorClass: "tool_argument_not_visible",
    expectedErrorData: {
      diagnosticKind: "tool_argument_not_visible",
      tool: "mcp_servers",
      operation: "validate_mcp_servers_args_visible",
      profile: "mcp",
      advancedToolSchema: false,
      recoveryStage: "strategy_switch",
      recommendedNextAction: "inspect_visible_tool_schema_then_retry",
      recoverable: true,
      recoveryPolicyVersion: "v1",
      hiddenArgs: ["include_disabled"],
      visibleArgsIncludes: ["ready_only"],
      visibleArgsExcludes: ["include_disabled"],
      recoveryHintIncludes: ["full_debug"],
    },
    schemaExpectations: [
      { tool: "mcp_servers", includes: ["ready_only"], excludes: ["include_disabled"] },
      { tool: "ask_user", includes: ["questions"], excludes: ["blocking_node_id"] },
    ],
  },
  {
    id: "full_debug_allows_full_read_schema",
    profile: "full_debug",
    advancedToolSchema: true,
    enabledTools: fullDebugTools,
    modelVisibleTools: fullDebugTools,
    toolCall: {
      name: "read",
      arguments: {
        path: "notes.txt",
        line_start: 1,
        line_end: 1,
      },
    },
    expectedOutcome: "success",
    expectedAssistantMessage: "SURFACE_EXECUTION_OK",
    schemaExpectations: [
      { tool: "read", includes: ["path", "line_start", "line_end", "pages", "include_metadata"] },
      { tool: "web_execute_js", includes: ["tmwd_ws_endpoint", "native_fallback_action"] },
    ],
  },
];

async function runSurfaceCase(repoRoot: string, surfaceCase: SurfaceCase): Promise<SurfaceCaseResult> {
  const tmpRoot = process.env.TMPDIR ?? "/tmp";
  const uniqueSuffix = `${String(process.pid)}-${String(Date.now())}-${surfaceCase.id}`;
  const workDir = join(tmpRoot, `grobot-surface-exec-work-${uniqueSuffix}`);
  const homeDir = join(tmpRoot, `grobot-surface-exec-home-${uniqueSuffix}`);
  const model = await startSurfaceMockModelServer(
    surfaceCase.toolCall,
    surfaceCase.expectedAssistantMessage ?? "SURFACE_EXECUTION_OK",
  );
  try {
    mkdirSync(workDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    writeFileSync(
      join(workDir, "notes.txt"),
      ["first line", "second line", "third line", ""].join("\n"),
      "utf8",
    );
    const request = {
      jsonrpc: "2.0",
      id: `surface-${surfaceCase.id}`,
      method: "runtime.turn.execute",
      params: {
        request_id: `req_${surfaceCase.id}_${String(Date.now())}`,
        session_key: `contract:runtime-tool-surface:${surfaceCase.id}`,
        user_message: `runtime tool surface execution contract ${surfaceCase.id}`,
        context_lines: [],
        tool_context: {
          work_dir: workDir,
          enabled_tools: surfaceCase.enabledTools,
          model_visible_tools: surfaceCase.modelVisibleTools,
          tool_surface_profile: surfaceCase.profile,
          advanced_tool_schema: surfaceCase.advancedToolSchema,
          max_tool_rounds: 4,
          no_tool_fallback_mode: "off",
        },
      },
    };
    const runtimeResult = await runRuntimeTurn(repoRoot, request, {
      ...process.env,
      HOME: homeDir,
      GROBOT_BASE_URL: model.baseUrl,
      GROBOT_API_KEY: "surface-execution-key",
      GROBOT_MODEL: "surface-execution-model",
      GROBOT_RUNTIME_HTTP_TIMEOUT_MS: "8000",
    });
    expectEqual(runtimeResult.exitCode, 0, `${surfaceCase.id}: runtime process exit`);
    const rpcPayload = parseFirstJsonLine(surfaceCase.id, runtimeResult.stdout);
    const calls = model.getCalls();
    expect(calls.length >= 1, `${surfaceCase.id}: mock model should receive at least one call`);
    const firstCall = calls[0];
    expect(firstCall !== undefined, `${surfaceCase.id}: first model call missing`);
    expectSameStringSet(
      firstCall.toolNames,
      surfaceCase.modelVisibleTools,
      `${surfaceCase.id}: model request visible tool set`,
    );
    const schemaProjectionChecks = assertSchemaExpectations(
      firstCall,
      surfaceCase.schemaExpectations,
      surfaceCase.id,
    );
    const events = eventRowsFromRpcPayload(rpcPayload);
    const toolEndEvent = findToolEndEvent(events, surfaceCase.toolCall.name);
    const toolRecoveryEvent = findToolRecoveryEvent(events, surfaceCase.toolCall.name);
    expect(toolEndEvent !== null, `${surfaceCase.id}: tool_end event missing`);
    const toolEndPayload = eventPayload(toolEndEvent);
    const toolEndStatus = typeof toolEndPayload.status === "string" ? toolEndPayload.status : "";
    const toolEndErrorClass = typeof toolEndPayload.error_class === "string"
      ? toolEndPayload.error_class
      : null;

    if (surfaceCase.expectedOutcome === "success") {
      expectEqual(rpcAssistantMessage(rpcPayload), surfaceCase.expectedAssistantMessage, `${surfaceCase.id}: assistant message`);
      expectEqual(toolEndStatus, "ok", `${surfaceCase.id}: tool_end status`);
      expectEqual(calls.length, 2, `${surfaceCase.id}: successful tool loop call count`);
      return {
        id: surfaceCase.id,
        profile: surfaceCase.profile,
        outcome: "success",
        runtime_call_count: calls.length,
        first_model_tool_names: firstCall.toolNames,
        tool_end_status: toolEndStatus,
        tool_end_error_class: toolEndErrorClass,
        schema_projection_checks: schemaProjectionChecks,
        structured_error_data_checks: 0,
      };
    }

    expectEqual(rpcErrorClass(rpcPayload), surfaceCase.expectedErrorClass, `${surfaceCase.id}: rpc error class`);
    expectEqual(toolEndStatus, "failed", `${surfaceCase.id}: tool_end status`);
    expectEqual(toolEndErrorClass, surfaceCase.expectedErrorClass, `${surfaceCase.id}: tool_end error class`);
    const structuredErrorDataChecks = assertStructuredErrorData(
      surfaceCase,
      rpcPayload,
      toolEndPayload,
      toolRecoveryEvent,
    );
    expectEqual(calls.length, 1, `${surfaceCase.id}: failed tool call must fail fast before second model call`);
    return {
      id: surfaceCase.id,
      profile: surfaceCase.profile,
      outcome: "error",
      runtime_call_count: calls.length,
      first_model_tool_names: firstCall.toolNames,
      tool_end_status: toolEndStatus,
      tool_end_error_class: toolEndErrorClass,
      schema_projection_checks: schemaProjectionChecks,
      structured_error_data_checks: structuredErrorDataChecks,
    };
  } finally {
    await model.close();
    rmSync(workDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const results: SurfaceCaseResult[] = [];
  for (const surfaceCase of surfaceCases) {
    results.push(await runSurfaceCase(repoRoot, surfaceCase));
  }
  const profilesSmoked = sortedUnique(results.map((result) => result.profile));
  expectSameStringSet(
    profilesSmoked,
    ["minimal", "coding", "browser", "browser_advanced", "context", "mcp", "full_debug"],
    "surface execution smoke must cover all decisive surface families",
  );
  const allowedWorkflowSuccesses = results.filter((result) => result.outcome === "success").length;
  const hiddenToolRejections = results.filter((result) =>
    result.tool_end_error_class === "tool_not_visible").length;
  const hiddenArgRejections = results.filter((result) =>
    result.tool_end_error_class === "tool_argument_not_visible").length;
  const schemaProjectionChecks = results.reduce(
    (total, result) => total + result.schema_projection_checks,
    0,
  );
  const structuredErrorDataChecks = results.reduce(
    (total, result) => total + result.structured_error_data_checks,
    0,
  );
  process.stdout.write(`${JSON.stringify({
    ok: true,
    contract: "runtime-tool-surface-execution",
    runtime_binary: runtimeBinaryPath(repoRoot),
    profiles_smoked: profilesSmoked,
    allowed_workflow_successes: allowedWorkflowSuccesses,
    hidden_tool_rejections: hiddenToolRejections,
    hidden_arg_rejections: hiddenArgRejections,
    schema_projection_checks: schemaProjectionChecks,
    structured_error_data_checks: structuredErrorDataChecks,
    cases: results,
  })}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`runtime-tool-surface-execution-contract fatal: ${message}\n`);
  process.exitCode = 1;
});
