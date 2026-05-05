import { compactSpaces } from "../terminal/display-width";

export function formatTuiErrorClassLabel(value: string): string {
  const normalized = compactSpaces(value);
  switch (normalized) {
    case "bash_command_failed":
      return "Command failed";
    case "config_missing":
      return "Missing config";
    case "path_not_found":
      return "Path not found";
    case "tool_not_visible":
      return "Tool not visible";
    case "tool_disabled":
      return "Tool disabled";
    case "tool_execution_deferred":
      return "Tool execution deferred";
    case "browser_backend_result_error":
      return "Browser backend error";
    case "edit_stale_target":
      return "Target changed";
    case "upstream_timeout":
    case "timeout":
      return "Request timed out";
    case "upstream_connect_failed":
      return "Upstream connection failed";
    case "upstream_http_error":
      return "Upstream request failed";
    case "upstream_response_read_failed":
      return "Response read failed";
    case "runtime_error":
      return "Runtime error";
    case "provider_inflight_limited":
      return "Provider in-flight limit";
    case "provider_rate_limited":
      return "Provider rate limited";
    case "semantic_index_required":
      return "Semantic index missing";
    case "semantic_index_config_invalid":
      return "Semantic index config invalid";
    case "mcp_timeout":
    case "mcp_queue_timeout":
      return "MCP timed out";
    case "mcp_circuit_open":
      return "MCP circuit open";
    case "mcp_server_unready":
      return "MCP server not ready";
    case "mcp_server_not_found":
      return "MCP server not found";
    case "mcp_spawn_failed":
      return "MCP spawn failed";
    case "mcp_rpc_error":
    case "mcp_tool_result_error":
      return "MCP call failed";
    case "mcp_tool_blocked":
      return "MCP tool blocked";
    case "mcp_arguments_too_large":
      return "MCP args too large";
    case "invalid_tool_arguments":
      return "Invalid tool args";
    case "":
      return "";
    default:
      break;
  }
  if (normalized.includes("timeout")) {
    return "Request timed out";
  }
  if (normalized.includes("rate")) {
    return "Request rate limited";
  }
  if (normalized.includes("connect")) {
    return "Connection failed";
  }
  if (normalized.includes("config")) {
    return "Config error";
  }
  if (normalized.includes("semantic")) {
    return "Semantic context error";
  }
  if (normalized.includes("mcp")) {
    return "MCP call failed";
  }
  if (normalized.includes("tool")) {
    return "Tool call failed";
  }
  if (normalized.includes("browser")) {
    return "Browser tool failed";
  }
  return normalized.replace(/[_-]+/g, " ") || "Runtime error";
}
