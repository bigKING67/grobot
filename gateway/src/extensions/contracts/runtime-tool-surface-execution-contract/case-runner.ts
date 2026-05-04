import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertSchemaExpectations,
  assertStructuredErrorData,
  expect,
  expectEqual,
  expectSameStringSet,
} from "./assertions";
import { startSurfaceMockModelServer } from "./mock-model-server";
import {
  eventPayload,
  eventRowsFromRpcPayload,
  findToolEndEvent,
  findToolRecoveryPayload,
  parseFirstJsonLine,
  rpcAssistantMessage,
  rpcErrorClass,
  rpcErrorData,
  runRuntimeRequest,
} from "./runtime-rpc";
import type { SurfaceCase, SurfaceCaseResult } from "./types";

export async function runSurfaceCase(
  repoRoot: string,
  surfaceCase: SurfaceCase,
  recoveryActions: readonly string[],
): Promise<SurfaceCaseResult> {
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
    const runtimeResult = await runRuntimeRequest(repoRoot, request, {
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
    const toolRecoveryPayload = findToolRecoveryPayload(events, surfaceCase.toolCall.name);
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
        recovery_action_catalog_checks: 0,
      };
    }

    expectEqual(rpcErrorClass(rpcPayload), surfaceCase.expectedErrorClass, `${surfaceCase.id}: rpc error class`);
    expectEqual(toolEndStatus, "failed", `${surfaceCase.id}: tool_end status`);
    expectEqual(toolEndErrorClass, surfaceCase.expectedErrorClass, `${surfaceCase.id}: tool_end error class`);
    const structuredErrorDataChecks = assertStructuredErrorData(
      surfaceCase,
      rpcErrorData(rpcPayload),
      toolEndPayload,
      toolRecoveryPayload,
      recoveryActions,
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
      structured_error_data_checks: structuredErrorDataChecks.structuredChecks,
      recovery_action_catalog_checks: structuredErrorDataChecks.recoveryActionCatalogChecks,
    };
  } finally {
    await model.close();
    rmSync(workDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  }
}
