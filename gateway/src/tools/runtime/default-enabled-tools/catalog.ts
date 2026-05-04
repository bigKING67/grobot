import type { ToolSurfaceProfile } from "../../../models/types";

export const ALL_RUNTIME_LOCAL_TOOLS = [
  "list",
  "glob",
  "search",
  "read",
  "write",
  "edit",
  "bash",
  "mcp_servers",
  "mcp_call",
  "web_scan",
  "web_execute_js",
  "semantic_search",
  "prompt_enhancer",
  "ask_user",
] as const;

export const DEFAULT_RUNTIME_ENABLED_TOOLS = [
  "glob",
  "search",
  "read",
  "write",
  "edit",
  "bash",
  "ask_user",
] as const;

export const TOOL_SURFACE_PROFILES = [
  "minimal",
  "coding",
  "browser",
  "browser_advanced",
  "context",
  "mcp",
  "full_debug",
] as const satisfies readonly ToolSurfaceProfile[];

const PROFILE_VISIBLE_TOOLS: Record<ToolSurfaceProfile, readonly string[]> = {
  minimal: ["read", "edit", "write", "ask_user"],
  coding: DEFAULT_RUNTIME_ENABLED_TOOLS,
  browser: ["web_scan", "web_execute_js", "read", "ask_user"],
  browser_advanced: ["web_scan", "web_execute_js", "read", "ask_user"],
  context: ["semantic_search", "read", "ask_user"],
  mcp: ["mcp_servers", "mcp_call", "ask_user"],
  full_debug: ALL_RUNTIME_LOCAL_TOOLS,
};

export function buildDefaultRuntimeEnabledTools(): string[] {
  return [...DEFAULT_RUNTIME_ENABLED_TOOLS];
}

export function buildAllRuntimeLocalTools(): string[] {
  return [...ALL_RUNTIME_LOCAL_TOOLS];
}

export function toolNamesForSurfaceProfile(profile: ToolSurfaceProfile): string[] {
  return [...PROFILE_VISIBLE_TOOLS[profile]];
}
