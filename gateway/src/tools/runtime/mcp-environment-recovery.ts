export type McpEnvironmentRecoveryErrorCode =
  | "SERVER_NOT_FOUND"
  | "SERVER_UNREADY"
  | "SPAWN_FAILED";

export type McpEnvironmentRecoveryAction =
  | "configure_server_and_check_status"
  | "fix_server_readiness_and_check_status"
  | "fix_server_command_and_check_status";

export interface McpEnvironmentRecoveryPlan {
  errorCode: McpEnvironmentRecoveryErrorCode;
  action: McpEnvironmentRecoveryAction;
  retryAllowed: false;
  commands: string[];
  server: string | null;
  toolName: string | null;
  sourcePath: string | null;
  registryPaths: string[];
}

const MCP_REGISTRY_PATHS = [
  "~/.grobot/mcp/servers.toml",
  ".grobot/mcp.toml",
];

function stringField(record: Record<string, unknown> | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function baseMcpEnvironmentPlan(input: {
  errorData: Record<string, unknown> | undefined;
  errorCode: McpEnvironmentRecoveryErrorCode;
  action: McpEnvironmentRecoveryAction;
}): McpEnvironmentRecoveryPlan {
  return {
    errorCode: input.errorCode,
    action: input.action,
    retryAllowed: false,
    commands: ["grobot status --json"],
    server: stringField(input.errorData, "server"),
    toolName: stringField(input.errorData, "tool_name"),
    sourcePath: stringField(input.errorData, "source"),
    registryPaths: MCP_REGISTRY_PATHS,
  };
}

export function buildMcpEnvironmentRecoveryPlan(input: {
  errorClass: string | null | undefined;
  errorData: Record<string, unknown> | undefined;
}): McpEnvironmentRecoveryPlan | null {
  if (input.errorClass === "mcp_server_not_found") {
    return baseMcpEnvironmentPlan({
      errorData: input.errorData,
      errorCode: "SERVER_NOT_FOUND",
      action: "configure_server_and_check_status",
    });
  }
  if (input.errorClass === "mcp_server_unready") {
    return baseMcpEnvironmentPlan({
      errorData: input.errorData,
      errorCode: "SERVER_UNREADY",
      action: "fix_server_readiness_and_check_status",
    });
  }
  if (input.errorClass === "mcp_spawn_failed") {
    return baseMcpEnvironmentPlan({
      errorData: input.errorData,
      errorCode: "SPAWN_FAILED",
      action: "fix_server_command_and_check_status",
    });
  }
  return null;
}

export function formatMcpEnvironmentRecoveryPlan(
  plan: McpEnvironmentRecoveryPlan | null | undefined,
): string {
  if (!plan) {
    return "<none>";
  }
  return [
    `code=${plan.errorCode}`,
    `action=${plan.action}`,
    `retry_allowed=${plan.retryAllowed ? "true" : "false"}`,
    `server=${plan.server ?? "<none>"}`,
    `tool=${plan.toolName ?? "<none>"}`,
    `source=${plan.sourcePath ?? "<none>"}`,
    `registry_paths=${plan.registryPaths.join("|")}`,
    `commands=${plan.commands.join("|")}`,
  ].join(" ");
}

function formatMcpEnvironmentCommands(plan: McpEnvironmentRecoveryPlan): string {
  return plan.commands.map((command) => `\`${command}\``).join(", then ");
}

function formatMcpRegistryPaths(plan: McpEnvironmentRecoveryPlan): string {
  return plan.registryPaths.map((path) => `\`${path}\``).join(" or ");
}

export function mcpEnvironmentRecoveryActionInstruction(
  plan: McpEnvironmentRecoveryPlan | null | undefined,
): string | undefined {
  if (!plan) {
    return undefined;
  }
  return [
    `Ask the user to repair MCP server configuration for ${plan.server ?? "the selected server"};`,
    `inspect readiness with ${formatMcpEnvironmentCommands(plan)}, update ${formatMcpRegistryPaths(plan)} if needed,`,
    "and do not retry the MCP tool until status shows the server is ready.",
  ].join(" ");
}

export function mcpEnvironmentRecoveryFixInstruction(input: {
  plan: McpEnvironmentRecoveryPlan | null | undefined;
  toolName: string;
}): string | undefined {
  const { plan, toolName } = input;
  if (!plan) {
    return undefined;
  }
  const server = plan.server ?? "the selected MCP server";
  const statusCommand = formatMcpEnvironmentCommands(plan);
  const registryPaths = formatMcpRegistryPaths(plan);
  if (plan.errorCode === "SERVER_NOT_FOUND") {
    return `MCP environment fix: Do not retry ${toolName} automatically. Ask the user to configure ${server} in ${registryPaths}, run ${statusCommand}, and retry only after the server appears in status.`;
  }
  if (plan.errorCode === "SERVER_UNREADY") {
    return `MCP environment fix: Do not retry ${toolName} automatically. Ask the user to fix ${server} readiness in ${registryPaths}, run ${statusCommand}, and retry only after status reports ready=true.`;
  }
  if (plan.errorCode === "SPAWN_FAILED") {
    return `MCP environment fix: Do not retry ${toolName} automatically. Ask the user to fix ${server} command/env in ${registryPaths}, run ${statusCommand}, and retry only after the server can spawn.`;
  }
  return undefined;
}
