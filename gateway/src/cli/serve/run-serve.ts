import { createServer } from "node:http";
import { OptionValue } from "../cli-args";
import { dispatchManagementRoutes } from "./management-routes";
import { writeJson } from "./http-utils";
import { type MCPRuntimeState } from "./mcp-runtime";
import { runServeServerLifecycle } from "./server-lifecycle";
import { resolveRunServeContext } from "./run-serve-context";
import { createRunServeWire } from "./run-serve-wire";
import { isRouteDecisionNamespaceInputError } from "../status/route-namespace";
import { isBindConfigInputError } from "./bind-config";

export async function runServe(options: Record<string, OptionValue>): Promise<number> {
  let context: ReturnType<typeof resolveRunServeContext>;
  try {
    context = resolveRunServeContext(options);
  } catch (error) {
    if (isRouteDecisionNamespaceInputError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      return 2;
    }
    if (isBindConfigInputError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
  const { bind } = context;
  const mcpSessions = new Set<string>();
  const mcpServerStates = new Map<string, MCPRuntimeState>();
  const { runtimeState, managementRoutesContext } = await createRunServeWire({
    options,
    context,
    mcpSessions,
    mcpServerStates,
  });

  const server = createServer(async (request, response) => {
    const handled = await dispatchManagementRoutes(request, response, managementRoutesContext);

    if (handled) {
      return;
    }

    const method = request.method ?? "GET";
    const rawUrl = request.url ?? "/";
    const path = rawUrl.split("?")[0] ?? "/";
    writeJson(response, 404, {
      error: "not_found",
      path,
      method,
    });
  });

  return runServeServerLifecycle({
    server,
    bind,
    getExecutionPlane: runtimeState.getExecutionPlane,
  });
}
