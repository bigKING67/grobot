export const DEFAULT_RUNTIME_ENABLED_TOOLS = [
  "list",
  "glob",
  "search",
  "read",
  "write",
  "edit",
  "bash",
  "mcp_servers",
  "mcp_call",
  "semantic_search",
  "prompt_enhancer",
  "ask_user_question",
] as const;

export function buildDefaultRuntimeEnabledTools(): string[] {
  return [...DEFAULT_RUNTIME_ENABLED_TOOLS];
}
