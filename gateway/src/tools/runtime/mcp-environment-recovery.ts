import {
  buildEnvironmentRecoveryCore,
  formatEnvironmentCommands,
  formatEnvironmentRecoveryCoreFields,
  formatPipeList,
  stringField,
  stringListField,
  type EnvironmentRecoveryPlanCore,
} from "./environment-recovery";

export type McpEnvironmentRecoveryErrorCode =
  | "SERVER_NOT_FOUND"
  | "SERVER_UNREADY"
  | "SPAWN_FAILED";

export type McpEnvironmentRecoveryAction =
  | "configure_server_and_check_status"
  | "fix_server_readiness_and_check_status"
  | "fix_server_command_and_check_status";

export interface McpEnvironmentRecoveryPlan
  extends EnvironmentRecoveryPlanCore<McpEnvironmentRecoveryErrorCode, McpEnvironmentRecoveryAction> {
  server: string | null;
  toolName: string | null;
  sourcePath: string | null;
  readyReason: string | null;
  command: string | null;
  availableServers: string[];
  registryPaths: string[];
}

const MCP_REGISTRY_PATHS = [
  "~/.grobot/mcp/servers.toml",
  ".grobot/mcp.toml",
];

function baseMcpEnvironmentPlan(input: {
  errorData: Record<string, unknown> | undefined;
  errorCode: McpEnvironmentRecoveryErrorCode;
  action: McpEnvironmentRecoveryAction;
}): McpEnvironmentRecoveryPlan {
  return {
    ...buildEnvironmentRecoveryCore({
      errorCode: input.errorCode,
      action: input.action,
      commands: ["grobot status --json"],
    }),
    server: stringField(input.errorData, "server"),
    toolName: stringField(input.errorData, "tool_name"),
    sourcePath: stringField(input.errorData, "source"),
    readyReason: stringField(input.errorData, "ready_reason"),
    command: stringField(input.errorData, "command"),
    availableServers: stringListField(input.errorData, "available_servers"),
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
  return formatEnvironmentRecoveryCoreFields(plan, [
    `server=${plan.server ?? "<none>"}`,
    `tool=${plan.toolName ?? "<none>"}`,
    `source=${plan.sourcePath ?? "<none>"}`,
    `ready_reason=${plan.readyReason ?? "<none>"}`,
    `command=${plan.command ?? "<none>"}`,
    `available_servers=${formatPipeList(plan.availableServers)}`,
    `registry_paths=${formatPipeList(plan.registryPaths)}`,
  ]);
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
    `inspect readiness with ${formatEnvironmentCommands(plan)}, update ${formatMcpRegistryPaths(plan)} if needed,`,
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
  const statusCommand = formatEnvironmentCommands(plan);
  const registryPaths = formatMcpRegistryPaths(plan);
  if (plan.errorCode === "SERVER_NOT_FOUND") {
    const availableServers = plan.availableServers.length > 0
      ? ` Available servers: ${plan.availableServers.join(", ")}.`
      : "";
    return `MCP environment fix: Do not retry ${toolName} automatically. Ask the user to configure ${server} in ${registryPaths}, run ${statusCommand}, and retry only after the server appears in status.${availableServers}`;
  }
  if (plan.errorCode === "SERVER_UNREADY") {
    const readyReason = plan.readyReason ? ` Current ready_reason=${plan.readyReason}.` : "";
    return `MCP environment fix: Do not retry ${toolName} automatically. Ask the user to fix ${server} readiness in ${registryPaths}, run ${statusCommand}, and retry only after status reports ready=true.${readyReason}`;
  }
  if (plan.errorCode === "SPAWN_FAILED") {
    const command = plan.command ? ` Current command=${plan.command}.` : "";
    return `MCP environment fix: Do not retry ${toolName} automatically. Ask the user to fix ${server} command/env in ${registryPaths}, run ${statusCommand}, and retry only after the server can spawn.${command}`;
  }
  return undefined;
}
