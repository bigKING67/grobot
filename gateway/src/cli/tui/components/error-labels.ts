import { compactSpaces } from "../terminal/display-width";

export function formatTuiErrorClassLabel(value: string): string {
  const normalized = compactSpaces(value);
  switch (normalized) {
    case "bash_command_failed":
      return "命令执行失败";
    case "config_missing":
      return "配置缺失";
    case "path_not_found":
      return "路径不存在";
    case "tool_not_visible":
      return "工具不可见";
    case "tool_disabled":
      return "工具已禁用";
    case "browser_backend_result_error":
      return "浏览器后端错误";
    case "edit_stale_target":
      return "目标文件已变化";
    case "upstream_timeout":
    case "timeout":
      return "请求超时";
    case "upstream_connect_failed":
      return "上游连接失败";
    case "upstream_http_error":
      return "上游请求失败";
    case "upstream_response_read_failed":
      return "响应读取失败";
    case "runtime_error":
      return "运行时错误";
    case "provider_inflight_limited":
      return "通道并发已满";
    case "provider_rate_limited":
      return "通道请求过快";
    case "semantic_index_required":
      return "语义索引缺失";
    case "semantic_index_config_invalid":
      return "语义索引配置无效";
    case "mcp_timeout":
    case "mcp_queue_timeout":
      return "MCP 调用超时";
    case "mcp_circuit_open":
      return "MCP 熔断中";
    case "mcp_server_unready":
      return "MCP 服务未就绪";
    case "mcp_server_not_found":
      return "MCP 服务未找到";
    case "mcp_spawn_failed":
      return "MCP 启动失败";
    case "mcp_rpc_error":
    case "mcp_tool_result_error":
      return "MCP 调用失败";
    case "mcp_tool_blocked":
      return "MCP 工具被拦截";
    case "mcp_arguments_too_large":
      return "MCP 参数过大";
    case "invalid_tool_arguments":
      return "工具参数无效";
    case "":
      return "";
    default:
      break;
  }
  if (normalized.includes("timeout")) {
    return "请求超时";
  }
  if (normalized.includes("rate")) {
    return "请求限流";
  }
  if (normalized.includes("connect")) {
    return "连接失败";
  }
  if (normalized.includes("config")) {
    return "配置错误";
  }
  if (normalized.includes("semantic")) {
    return "语义上下文错误";
  }
  if (normalized.includes("mcp")) {
    return "MCP 调用失败";
  }
  if (normalized.includes("tool")) {
    return "工具调用失败";
  }
  if (normalized.includes("browser")) {
    return "浏览器工具失败";
  }
  return normalized.replace(/[_-]+/g, " ") || "运行时错误";
}
