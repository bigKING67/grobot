import { aggregateMcpRuntimeSummary, normalizeMcpServerName, resetMcpServerStates, type MCPRuntimeState } from "./mcp-runtime";

interface CreateRunServeMcpResetInput {
  mcpSessions: Set<string>;
  mcpServerStates: Map<string, MCPRuntimeState>;
}

export function createRunServeMcpReset(input: CreateRunServeMcpResetInput) {
  return (targetServer?: string): Record<string, unknown> => {
    if (typeof targetServer === "string" && targetServer.trim().length > 0) {
      const normalizedTarget = targetServer.trim();
      const key = normalizeMcpServerName(normalizedTarget);
      const closed = input.mcpSessions.delete(key);
      const resetStates = resetMcpServerStates(input.mcpServerStates, normalizedTarget);
      const runtimeSummary = aggregateMcpRuntimeSummary(input.mcpServerStates, [normalizedTarget]);
      return {
        status: "ok",
        timestamp: new Date().toISOString(),
        scope: "server",
        target: normalizedTarget,
        closed_sessions: closed ? 1 : 0,
        reset_states: resetStates,
        runtime_summary: runtimeSummary,
      };
    }
    const closedSessions = input.mcpSessions.size;
    input.mcpSessions.clear();
    const resetStates = resetMcpServerStates(input.mcpServerStates, undefined);
    const runtimeSummary = aggregateMcpRuntimeSummary(input.mcpServerStates);
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      scope: "all",
      target: "all",
      closed_sessions: closedSessions,
      reset_states: resetStates,
      runtime_summary: runtimeSummary,
    };
  };
}
