import { type IncomingMessage, type ServerResponse } from "node:http";
import { dispatchManagementMemoryRoutes } from "./management-routes-memory";
import { requireManagementToken } from "./management-routes-auth";
import { type ManagementRoutesContext } from "./management-routes-types";
import { queryCsvEnum, queryInt, queryOptionalNonEmptyString, writeManagementInputError } from "./management-input-parsing";
import { type ExperienceRecordState } from "../../tools/state/experience-pool/types";
import { CLI_PRODUCT_ENGINE } from "../product-identity";
import { serializeRouteDecisionSummary } from "../status/route-status";

export type { ManagementRoutesContext } from "./management-routes-types";

const EXPERIENCE_RECORD_STATES: readonly ExperienceRecordState[] = ["active", "quarantined", "disabled"];
const EXPERIENCE_STATES_DETAIL = "states must be comma separated: active,quarantined,disabled";

function resolveInterruptTtlSecs(rawBody: string): {
  ok: true;
  ttlSecs: number;
} | {
  ok: false;
  error: string;
  detail: string;
} {
  if (!rawBody.trim()) {
    return {
      ok: true,
      ttlSecs: 300,
    };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch (error) {
    return {
      ok: false,
      error: "bad_request",
      detail: `Invalid JSON body: ${String(error)}`,
    };
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return {
      ok: false,
      error: "bad_request",
      detail: "JSON body must be an object",
    };
  }
  const value = (payload as Record<string, unknown>).ttl_secs;
  if (value === undefined) {
    return {
      ok: true,
      ttlSecs: 300,
    };
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return {
      ok: false,
      error: "invalid_ttl_secs",
      detail: "ttl_secs must be a positive number",
    };
  }
  return {
    ok: true,
    ttlSecs: Math.floor(value),
  };
}

export async function dispatchManagementRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  context: ManagementRoutesContext,
): Promise<boolean> {
  const method = request.method ?? "GET";
  const rawUrl = request.url ?? "/";
  const path = rawUrl.split("?")[0] ?? "/";

  if (method === "GET" && path === "/api/v1/status") {
    const query = context.parseQueryParams(rawUrl);
    const executionPlane = context.getExecutionPlane();
    const routeDecisionResult = context.getRouteDecision(query);
    if (!routeDecisionResult.ok) {
      context.writeJson(response, 400, {
        error: routeDecisionResult.error,
        field: routeDecisionResult.field,
        detail: routeDecisionResult.detail,
      });
      return true;
    }
    const routeDecision = routeDecisionResult.value;
    const configReadPolicy = context.getConfigReadPolicy();
    const memoryStoreRuntime = context.getMemoryStoreRuntime();
    const experiencePoolState = context.getExperiencePoolState();
    context.writeJson(response, 200, {
      status: "ok",
      engine: CLI_PRODUCT_ENGINE,
      project: context.projectName,
      work_dir: context.workDir,
      reload_count: context.getReloadCount(),
      route_decision: serializeRouteDecisionSummary(routeDecision),
      execution_plane: {
        gateway_impl: executionPlane.gatewayImpl,
        runtime_impl: executionPlane.runtimeImpl,
        shadow_mode: executionPlane.shadowMode,
        sources: {
          gateway_impl: executionPlane.gatewayImplSource,
          runtime_impl: executionPlane.runtimeImplSource,
          shadow_mode: executionPlane.shadowModeSource,
        },
      },
      governance_plane: {
        enabled: true,
        plane: "governance.v1",
        evaluator: "basic_turn_gate",
        auto_upgrade_enabled: false,
        auto_upgrade_reason: "manual_mode_default",
      },
      management_auth: {
        credential_count: context.managementToken ? 1 : 0,
        config_read_policy: configReadPolicy.effectivePolicy,
        config_read_policy_configured: configReadPolicy.configuredPolicy,
        config_read_policy_source: configReadPolicy.configuredSource,
        config_read_policy_reason: configReadPolicy.reason,
        config_endpoint_requires_auth: configReadPolicy.effectivePolicy === "auth",
        config_endpoint_disabled: configReadPolicy.effectivePolicy === "disabled",
        write_headers: ["Authorization: Bearer <token>", "X-Grobot-Token: <token>"],
        protected_endpoints: [
          "POST /api/v1/reload",
          "GET /api/v1/sessions/{id}/memory",
          "GET /api/v1/sessions/{id}/memory/export",
          "POST /api/v1/sessions/{id}/memory/import",
          "POST /api/v1/sessions/{id}/memory/forget",
          "POST /api/v1/sessions/{id}/memory/lifecycle",
          "POST /api/v1/memory/lifecycle/run",
          "GET /api/v1/experience",
          "GET /api/v1/experience/{id}",
          "POST /api/v1/experience/{id}/state",
          "POST /api/v1/sessions/{id}/interrupt",
          "POST /api/v1/mcp/reset",
          "POST /api/v1/mcp/servers/{name}/reset",
        ],
      },
      memory_store: {
        backend: memoryStoreRuntime.backend,
        requested_backend: memoryStoreRuntime.requestedBackend,
        source: memoryStoreRuntime.source,
        strict_redis: memoryStoreRuntime.strictRedis ?? false,
        redis_url: memoryStoreRuntime.redisUrl ?? null,
        fallback_reason: memoryStoreRuntime.fallbackReason ?? null,
        file_path: context.memoryStorePath,
        redis_key: context.memoryStoreKey,
        session_count: context.getMemorySessionCount(),
      },
      experience_pool: {
        path: experiencePoolState.path,
        publish_mode: experiencePoolState.publishMode,
        recall_limit: experiencePoolState.recallLimit,
        team_default: experiencePoolState.teamDefault,
        record_count: experiencePoolState.recordCount,
        updated_at: experiencePoolState.updatedAt,
      },
      endpoints: {
        status: "/api/v1/status",
        config: "/api/v1/config",
        reload: "/api/v1/reload",
        session_memory_list: "/api/v1/sessions/{id}/memory",
        session_memory_export: "/api/v1/sessions/{id}/memory/export",
        session_memory_import: "/api/v1/sessions/{id}/memory/import",
        session_memory_forget: "/api/v1/sessions/{id}/memory/forget",
        session_memory_lifecycle: "/api/v1/sessions/{id}/memory/lifecycle",
        memory_lifecycle_run: "/api/v1/memory/lifecycle/run",
        experience_list: "/api/v1/experience",
        experience_get: "/api/v1/experience/{id}",
        experience_state: "/api/v1/experience/{id}/state",
        session_interrupt: "/api/v1/sessions/{id}/interrupt",
        mcp_reset_all: "/api/v1/mcp/reset",
        mcp_reset_server: "/api/v1/mcp/servers/{name}/reset",
        healthz: "/healthz",
      },
      timestamp_iso: new Date().toISOString(),
    });
    return true;
  }

  if (method === "GET" && path === "/api/v1/config") {
    const configReadPolicy = context.getConfigReadPolicy();
    if (configReadPolicy.effectivePolicy === "disabled") {
      context.writeJson(response, 403, {
        error: "forbidden",
        detail: "config endpoint is disabled by policy",
      });
      return true;
    }
    if (configReadPolicy.effectivePolicy === "auth" && !context.managementToken) {
      context.writeJson(response, 403, {
        error: "forbidden",
        detail: "management token is not configured",
      });
      return true;
    }
    if (configReadPolicy.effectivePolicy === "auth") {
      const incomingToken = context.parseBearerToken(request.headers);
      if (incomingToken !== context.managementToken) {
        context.writeJson(response, 403, {
          error: "forbidden",
          detail: "invalid management token",
        });
        return true;
      }
    }

    const executionPlane = context.getExecutionPlane();
    const configTomlPath = context.getConfigTomlPath();
    context.writeJson(response, 200, {
      status: "ok",
      engine: CLI_PRODUCT_ENGINE,
      project: context.projectName,
      work_dir: context.workDir,
      config: {
        paths: {
          project_toml: context.projectTomlPath ?? null,
          config_toml: configTomlPath ?? null,
        },
        execution_plane: {
          gateway_impl: executionPlane.gatewayImpl,
          runtime_impl: executionPlane.runtimeImpl,
          shadow_mode: executionPlane.shadowMode,
          sources: {
            gateway_impl: executionPlane.gatewayImplSource,
            runtime_impl: executionPlane.runtimeImplSource,
            shadow_mode: executionPlane.shadowModeSource,
          },
        },
        files: {
          project_toml_masked: context.readMaskedFile(context.projectTomlPath) ?? null,
          config_toml_masked: context.readMaskedFile(configTomlPath) ?? null,
        },
      },
      timestamp_iso: new Date().toISOString(),
    });
    return true;
  }

  const memoryHandled = await dispatchManagementMemoryRoutes({
    request,
    response,
    context,
    method,
    rawUrl,
    path,
  });
  if (memoryHandled) {
    return true;
  }

  if (method === "GET" && path === "/api/v1/experience") {
    if (!requireManagementToken(request, response, context)) {
      return true;
    }

    const query = context.parseQueryParams(rawUrl);
    const tenantResult = queryOptionalNonEmptyString(query, "tenant");
    if (!tenantResult.ok) {
      return writeManagementInputError(response, context, tenantResult);
    }
    const teamResult = queryOptionalNonEmptyString(query, "team");
    if (!teamResult.ok) {
      return writeManagementInputError(response, context, teamResult);
    }
    const userResult = queryOptionalNonEmptyString(query, "user");
    if (!userResult.ok) {
      return writeManagementInputError(response, context, userResult);
    }
    const queryResult = queryOptionalNonEmptyString(query, "q");
    if (!queryResult.ok) {
      return writeManagementInputError(response, context, queryResult);
    }
    const tenant = tenantResult.value ?? context.projectName;
    const team = teamResult.value ?? context.getExperiencePoolState().teamDefault;
    const user = userResult.value;
    const q = queryResult.value;
    const limitResult = queryInt(query, "limit", 10, 1, 100);
    if (!limitResult.ok) {
      return writeManagementInputError(response, context, limitResult);
    }
    const limit = limitResult.value;
    const includeStatesResult = queryCsvEnum(
      query,
      "states",
      ["active"],
      EXPERIENCE_RECORD_STATES,
      EXPERIENCE_STATES_DETAIL,
    );
    if (!includeStatesResult.ok) {
      return writeManagementInputError(response, context, includeStatesResult);
    }
    const includeStates = includeStatesResult.value;

    if (q) {
      const matches = context.searchExperienceRecords({
        tenant,
        team: team || undefined,
        user: user || undefined,
        query: q,
        limit,
        includeStates,
      });
      context.writeJson(response, 200, {
        status: "ok",
        tenant,
        team: team || null,
        user: user || null,
        mode: "search",
        total: matches.length,
        items: matches.map((match) => ({
          id: match.record.id,
          tenant: match.record.tenant,
          team: match.record.team,
          user: match.record.user,
          summary: match.record.summary,
          signature: match.record.signature,
          task_signature: match.record.taskSignature,
          task_type: match.record.taskType,
          scenario_tags: match.record.scenarioTags,
          state: match.record.state,
          confidence: match.record.confidence,
          success_count: match.record.successCount,
          failure_count: match.record.failureCount,
          recovery_success_count: match.record.recoverySuccessCount,
          consecutive_failure_count: match.record.consecutiveFailureCount,
          last_failure_class: match.record.lastFailureClass ?? null,
          last_provider_failure_diagnostics: match.record.lastProviderFailureDiagnostics ?? null,
          last_success_strategy: match.record.lastSuccessStrategy ?? null,
          updated_at: match.record.updatedAt,
          matched_tokens: match.matchedTokens,
          matched_task_signals: match.matchedTaskSignals ?? [],
          matched_scenario_tags: match.matchedScenarioTags ?? [],
          score: match.score,
        })),
        experience_pool: context.getExperiencePoolState(),
      });
      return true;
    }

    const rows = context
      .listExperienceRecords(tenant, team || undefined, user || undefined)
      .filter((record) => includeStates.includes(record.state))
      .slice(0, limit);
    context.writeJson(response, 200, {
      status: "ok",
      tenant,
      team: team || null,
      user: user || null,
      mode: "list",
      total: rows.length,
      items: rows.map((record) => ({
        id: record.id,
        tenant: record.tenant,
        team: record.team,
        user: record.user,
        summary: record.summary,
        signature: record.signature,
        task_signature: record.taskSignature,
        task_type: record.taskType,
        scenario_tags: record.scenarioTags,
        state: record.state,
        confidence: record.confidence,
        success_count: record.successCount,
        failure_count: record.failureCount,
        recovery_success_count: record.recoverySuccessCount,
        consecutive_failure_count: record.consecutiveFailureCount,
        last_failure_class: record.lastFailureClass ?? null,
        last_provider_failure_diagnostics: record.lastProviderFailureDiagnostics ?? null,
        last_success_strategy: record.lastSuccessStrategy ?? null,
        updated_at: record.updatedAt,
      })),
      experience_pool: context.getExperiencePoolState(),
    });
    return true;
  }

  const experienceGetMatch = path.match(/^\/api\/v1\/experience\/([^/]+)$/);
  if (method === "GET" && experienceGetMatch) {
    if (!requireManagementToken(request, response, context)) {
      return true;
    }
    const id = decodeURIComponent(experienceGetMatch[1]).trim();
    if (!id) {
      context.writeJson(response, 400, {
        error: "invalid_experience_id",
      });
      return true;
    }
    const record = context.getExperienceRecord(id);
    if (!record) {
      context.writeJson(response, 404, {
        error: "experience_not_found",
      });
      return true;
    }
    context.writeJson(response, 200, {
      status: "ok",
      item: {
        id: record.id,
        tenant: record.tenant,
        team: record.team,
        user: record.user,
        signature: record.signature,
        task_signature: record.taskSignature,
        task_type: record.taskType,
        scenario_tags: record.scenarioTags,
        summary: record.summary,
        state: record.state,
        confidence: record.confidence,
        keywords: record.keywords,
        sop: record.sop,
        failure_signals: record.failureSignals,
        reuse_guardrails: record.reuseGuardrails,
        attempt_history: record.attemptHistory,
        success_count: record.successCount,
        failure_count: record.failureCount,
        recovery_success_count: record.recoverySuccessCount,
        consecutive_failure_count: record.consecutiveFailureCount,
        verification_pass_count: record.verificationPassCount,
        last_outcome: record.lastOutcome,
        last_failure_class: record.lastFailureClass ?? null,
        last_failure_stage: record.lastFailureStage ?? null,
        last_provider_failure_diagnostics: record.lastProviderFailureDiagnostics ?? null,
        last_success_strategy: record.lastSuccessStrategy ?? null,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        last_used_at: record.lastUsedAt,
        evidence: record.evidence,
      },
      experience_pool: context.getExperiencePoolState(),
    });
    return true;
  }

  const experienceStateMatch = path.match(/^\/api\/v1\/experience\/([^/]+)\/state$/);
  if (method === "POST" && experienceStateMatch) {
    if (!requireManagementToken(request, response, context)) {
      return true;
    }
    const id = decodeURIComponent(experienceStateMatch[1]).trim();
    if (!id) {
      context.writeJson(response, 400, {
        error: "invalid_experience_id",
      });
      return true;
    }
    const rawBody = await context.readBody(request);
    const parsedBody = context.parseJsonObjectBody(rawBody);
    if (!parsedBody.ok) {
      context.writeJson(response, 400, {
        error: "bad_request",
        detail: parsedBody.detail,
      });
      return true;
    }
    const stateRaw = typeof parsedBody.body.state === "string" ? parsedBody.body.state.trim() : "";
    if (stateRaw !== "active" && stateRaw !== "quarantined" && stateRaw !== "disabled") {
      context.writeJson(response, 400, {
        error: "invalid_state",
        detail: "state must be active | quarantined | disabled",
      });
      return true;
    }
    const reason = typeof parsedBody.body.reason === "string" ? parsedBody.body.reason.trim() : undefined;
    const updated = context.setExperienceRecordState(id, stateRaw, reason);
    if (!updated) {
      context.writeJson(response, 404, {
        error: "experience_not_found",
      });
      return true;
    }
    context.writeJson(response, 200, {
      status: "ok",
      id: updated.id,
      state: updated.state,
      updated_at: updated.updatedAt,
      confidence: updated.confidence,
      experience_pool: context.getExperiencePoolState(),
    });
    return true;
  }

  if (method === "GET" && path === "/healthz") {
    context.writeJson(response, 200, {
      status: "ok",
      ready: true,
      engine: CLI_PRODUCT_ENGINE,
      timestamp_iso: new Date().toISOString(),
    });
    return true;
  }

  if (method === "POST" && path === "/api/v1/reload") {
    if (!requireManagementToken(request, response, context)) {
      return true;
    }

    await context.reloadRuntimeState();
    const executionPlane = context.getExecutionPlane();
    const memoryStoreRuntime = context.getMemoryStoreRuntime();
    context.writeJson(response, 200, {
      status: "ok",
      reload_count: context.getReloadCount(),
      execution_plane: {
        gateway_impl: executionPlane.gatewayImpl,
        runtime_impl: executionPlane.runtimeImpl,
        shadow_mode: executionPlane.shadowMode,
      },
      memory_store: {
        backend: memoryStoreRuntime.backend,
        requested_backend: memoryStoreRuntime.requestedBackend,
        source: memoryStoreRuntime.source,
        strict_redis: memoryStoreRuntime.strictRedis ?? false,
        fallback_reason: memoryStoreRuntime.fallbackReason ?? null,
        session_count: context.getMemorySessionCount(),
      },
    });
    return true;
  }

  if (method === "POST" && path === "/api/v1/mcp/reset") {
    if (!requireManagementToken(request, response, context)) {
      return true;
    }

    try {
      context.writeJson(response, 200, context.applyMcpReset());
    } catch (error) {
      context.writeJson(response, 500, {
        error: "mcp_reset_failed",
        detail: String(error),
      });
    }
    return true;
  }

  const mcpResetMatch = path.match(/^\/api\/v1\/mcp\/servers\/(.+)\/reset$/);
  if (method === "POST" && mcpResetMatch) {
    const serverName = decodeURIComponent(mcpResetMatch[1]).trim();
    if (!serverName) {
      context.writeJson(response, 400, {
        error: "invalid_server_name",
      });
      return true;
    }

    if (!requireManagementToken(request, response, context)) {
      return true;
    }

    try {
      context.writeJson(response, 200, context.applyMcpReset(serverName));
    } catch (error) {
      context.writeJson(response, 500, {
        error: "mcp_reset_failed",
        detail: String(error),
      });
    }
    return true;
  }

  const interruptMatch = path.match(/^\/api\/v1\/sessions\/(.+)\/interrupt$/);
  if (method === "POST" && interruptMatch) {
    if (!requireManagementToken(request, response, context)) {
      return true;
    }

    const sessionId = decodeURIComponent(interruptMatch[1]);
    const body = await context.readBody(request);
    const ttl = resolveInterruptTtlSecs(body);
    if (!ttl.ok) {
      context.writeJson(response, 400, {
        error: ttl.error,
        detail: ttl.detail,
      });
      return true;
    }

    context.setInterruptFlag(sessionId, ttl.ttlSecs);
    context.forceEndTurnGate(sessionId);
    context.writeJson(response, 200, {
      status: "ok",
      session_id: sessionId,
      ttl_secs: ttl.ttlSecs,
      turn_gate_forced_end: true,
    });
    return true;
  }

  return false;
}
