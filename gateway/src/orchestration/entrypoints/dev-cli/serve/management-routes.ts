import { type IncomingMessage, type ServerResponse } from "node:http";
import { dispatchManagementMemoryRoutes } from "./management-routes-memory";
import { requireManagementToken } from "./management-routes-auth";
import { type ManagementRoutesContext } from "./management-routes-types";

export type { ManagementRoutesContext } from "./management-routes-types";

export async function dispatchManagementRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  context: ManagementRoutesContext,
): Promise<boolean> {
  const method = request.method ?? "GET";
  const rawUrl = request.url ?? "/";
  const path = rawUrl.split("?")[0] ?? "/";

  if (method === "GET" && path === "/api/v1/status") {
    const executionPlane = context.getExecutionPlane();
    const configReadPolicy = context.getConfigReadPolicy();
    const memoryStoreRuntime = context.getMemoryStoreRuntime();
    context.writeJson(response, 200, {
      status: "ok",
      engine: "ts-dev-cli",
      project: context.projectName,
      work_dir: context.workDir,
      reload_count: context.getReloadCount(),
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
          "POST /api/v1/sessions/{id}/interrupt",
          "POST /api/v1/mcp/reset",
          "POST /api/v1/mcp/servers/{name}/reset",
        ],
      },
      memory_store: {
        backend: memoryStoreRuntime.backend,
        requested_backend: memoryStoreRuntime.requestedBackend,
        source: memoryStoreRuntime.source,
        redis_url: memoryStoreRuntime.redisUrl ?? null,
        fallback_reason: memoryStoreRuntime.fallbackReason ?? null,
        file_path: context.memoryStorePath,
        redis_key: context.memoryStoreKey,
        session_count: context.getMemorySessionCount(),
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
      engine: "ts-dev-cli",
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

  if (method === "GET" && path === "/healthz") {
    context.writeJson(response, 200, {
      status: "ok",
      ready: true,
      engine: "ts-dev-cli",
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
    let ttlSecs = 300;
    if (body.trim()) {
      try {
        const payload = JSON.parse(body) as unknown;
        if (typeof payload === "object" && payload !== null) {
          const value = (payload as Record<string, unknown>).ttl_secs;
          if (typeof value === "number" && Number.isFinite(value) && value > 0) {
            ttlSecs = Math.floor(value);
          }
        }
      } catch {
        context.writeJson(response, 400, {
          error: "bad_request",
          detail: "invalid json body",
        });
        return true;
      }
    }

    context.setInterruptFlag(sessionId, ttlSecs);
    context.writeJson(response, 200, {
      status: "ok",
      session_id: sessionId,
      ttl_secs: ttlSecs,
    });
    return true;
  }

  return false;
}
