import type {
  RuntimeToolContext,
  ToolSurfaceProfile,
} from "../../../models/types";
import {
  TOOL_SURFACE_POLICY_VERSION,
  type RuntimeToolSurfaceProjectionMode,
  type RuntimeToolSurfaceProjectionSummary,
  type ToolSurfaceFingerprintInput,
} from "./contract";
import { toolNamesForSurfaceProfile } from "./catalog";

const PROFILE_SCHEMA_TOKEN_ESTIMATE: Record<string, number> = {
  list: 90,
  glob: 110,
  search: 190,
  read: 160,
  read_slim: 110,
  write: 90,
  edit: 150,
  bash: 150,
  mcp_servers: 80,
  mcp_servers_slim: 50,
  mcp_call: 100,
  web_scan: 160,
  web_execute_js: 220,
  semantic_search: 190,
  semantic_search_slim: 120,
  prompt_enhancer: 210,
  ask_user: 160,
  ask_user_slim: 70,
};

const ADVANCED_BROWSER_SCHEMA_TOKEN_ESTIMATE: Record<string, number> = {
  web_scan: 360,
  web_execute_js: 640,
};

const FULL_SCHEMA_ARG_NAMES: Record<string, readonly string[]> = {
  list: ["max_entries", "path", "recursive"],
  glob: ["max_entries", "path", "pattern"],
  search: ["case_sensitive", "context_after", "context_before", "fixed", "max_results", "path", "query", "regex"],
  read: ["include_metadata", "limit", "line_end", "line_start", "offset", "pages", "path"],
  write: ["content", "path"],
  edit: ["edits", "path"],
  bash: ["command", "max_output_bytes", "max_output_lines", "timeout_ms"],
  mcp_servers: ["include_disabled", "ready_only"],
  mcp_call: ["arguments", "server", "tool"],
  web_scan: [
    "cdp_endpoint",
    "main_only",
    "main_only_fallback_to_full",
    "main_only_min_chars",
    "main_only_min_coverage",
    "max_chars",
    "session_id",
    "session_url_pattern",
    "switch_tab_id",
    "tabs_only",
    "text_only",
    "tmwd_link_endpoint",
    "tmwd_mode",
    "tmwd_transport",
    "tmwd_ws_endpoint",
  ],
  web_execute_js: [
    "cdp_endpoint",
    "code",
    "native_auto_execute",
    "native_auto_fallback",
    "native_auto_fallback_policy",
    "native_execute_action_scope",
    "native_fallback_action",
    "native_fallback_args",
    "native_fallback_timeout_ms",
    "no_monitor",
    "script",
    "session_id",
    "session_url_pattern",
    "switch_tab_id",
    "tab_id",
    "target_url_contains",
    "timeout_ms",
    "tmwd_link_endpoint",
    "tmwd_mode",
    "tmwd_transport",
    "tmwd_ws_endpoint",
  ],
  semantic_search: [
    "bridge_script",
    "include_org",
    "max_segments",
    "per_source_limit",
    "query",
    "refresh",
    "sources",
    "technical_terms",
    "timeout_ms",
  ],
  prompt_enhancer: [
    "bridge_script",
    "explicit_paths",
    "explicit_symbols",
    "include_org",
    "max_evidence",
    "prompt",
    "refresh",
    "sources",
    "timeout_ms",
  ],
  ask_user: ["blocking_node_id", "default_on_timeout", "questions", "resume_token"],
};

const SLIM_BROWSER_SCHEMA_ARG_NAMES: Record<string, readonly string[]> = {
  web_scan: ["main_only", "max_chars", "session_id", "switch_tab_id", "tabs_only"],
  web_execute_js: ["code", "script", "session_id", "switch_tab_id", "tab_id", "timeout_ms"],
};

const SLIM_READ_SCHEMA_ARG_NAMES = ["include_metadata", "limit", "offset", "path"] as const;
const SLIM_SEMANTIC_SEARCH_SCHEMA_ARG_NAMES = [
  "include_org",
  "max_segments",
  "per_source_limit",
  "query",
  "sources",
] as const;
const SLIM_ASK_USER_SCHEMA_ARG_NAMES = ["questions"] as const;
const SLIM_MCP_SERVERS_SCHEMA_ARG_NAMES = ["ready_only"] as const;

const ADVANCED_BROWSER_SCHEMA_ARG_NAMES: Record<string, readonly string[]> = {
  web_scan: FULL_SCHEMA_ARG_NAMES.web_scan,
  web_execute_js: [
    "cdp_endpoint",
    "code",
    "native_auto_fallback",
    "native_auto_fallback_policy",
    "native_fallback_timeout_ms",
    "script",
    "session_id",
    "session_url_pattern",
    "switch_tab_id",
    "tab_id",
    "target_url_contains",
    "timeout_ms",
    "tmwd_link_endpoint",
    "tmwd_mode",
    "tmwd_transport",
    "tmwd_ws_endpoint",
  ],
};

export function projectionModeForSurface(
  profile: ToolSurfaceProfile,
  advancedToolSchema: boolean,
): RuntimeToolSurfaceProjectionMode {
  if (profile === "full_debug") {
    return "full";
  }
  return advancedToolSchema || profile === "browser_advanced" ? "advanced" : "slim";
}

function shouldUseSlimReadSchema(
  toolName: string,
  profile: ToolSurfaceProfile,
  projectionMode: RuntimeToolSurfaceProjectionMode,
): boolean {
  return toolName === "read"
    && projectionMode === "slim"
    && (profile === "minimal" || profile === "browser" || profile === "context");
}

function shouldUseSlimSemanticSearchSchema(
  toolName: string,
  profile: ToolSurfaceProfile,
  projectionMode: RuntimeToolSurfaceProjectionMode,
): boolean {
  return toolName === "semantic_search"
    && projectionMode === "slim"
    && profile === "context";
}

function shouldUseSlimAskUserSchema(
  toolName: string,
  projectionMode: RuntimeToolSurfaceProjectionMode,
): boolean {
  return toolName === "ask_user" && projectionMode !== "full";
}

function shouldUseSlimMcpServersSchema(
  toolName: string,
  projectionMode: RuntimeToolSurfaceProjectionMode,
): boolean {
  return toolName === "mcp_servers" && projectionMode !== "full";
}

function schemaPropertyCountForTool(
  toolName: string,
  profile: ToolSurfaceProfile,
  projectionMode: RuntimeToolSurfaceProjectionMode,
): number {
  return schemaArgNamesForTool(toolName, profile, projectionMode).length;
}

function schemaArgNamesForTool(
  toolName: string,
  profile: ToolSurfaceProfile,
  projectionMode: RuntimeToolSurfaceProjectionMode,
): string[] {
  if (shouldUseSlimReadSchema(toolName, profile, projectionMode)) {
    return [...SLIM_READ_SCHEMA_ARG_NAMES];
  }
  if (shouldUseSlimSemanticSearchSchema(toolName, profile, projectionMode)) {
    return [...SLIM_SEMANTIC_SEARCH_SCHEMA_ARG_NAMES];
  }
  if (shouldUseSlimAskUserSchema(toolName, projectionMode)) {
    return [...SLIM_ASK_USER_SCHEMA_ARG_NAMES];
  }
  if (shouldUseSlimMcpServersSchema(toolName, projectionMode)) {
    return [...SLIM_MCP_SERVERS_SCHEMA_ARG_NAMES];
  }
  if (projectionMode === "advanced" && toolName in ADVANCED_BROWSER_SCHEMA_ARG_NAMES) {
    return [...ADVANCED_BROWSER_SCHEMA_ARG_NAMES[toolName]];
  }
  if (projectionMode === "slim" && toolName in SLIM_BROWSER_SCHEMA_ARG_NAMES) {
    return [...SLIM_BROWSER_SCHEMA_ARG_NAMES[toolName]];
  }
  return [...(FULL_SCHEMA_ARG_NAMES[toolName] ?? [])];
}

function suppressedSchemaArgNamesForTool(
  toolName: string,
  profile: ToolSurfaceProfile,
  projectionMode: RuntimeToolSurfaceProjectionMode,
): string[] {
  const visibleArgNames = new Set(schemaArgNamesForTool(toolName, profile, projectionMode));
  return (FULL_SCHEMA_ARG_NAMES[toolName] ?? []).filter((argName) => !visibleArgNames.has(argName));
}

function sumSchemaPropertyCounts(
  toolNames: readonly string[],
  profile: ToolSurfaceProfile,
  projectionMode: RuntimeToolSurfaceProjectionMode,
): {
  total: number;
  perToolPropertyCount: Record<string, number>;
} {
  const perToolPropertyCount: Record<string, number> = {};
  let total = 0;
  for (const toolName of toolNames) {
    const count = schemaPropertyCountForTool(toolName, profile, projectionMode);
    perToolPropertyCount[toolName] = count;
    total += count;
  }
  return { total, perToolPropertyCount };
}

function sumFullSchemaPropertyCounts(toolNames: readonly string[]): number {
  return toolNames.reduce((total, toolName) => total + (FULL_SCHEMA_ARG_NAMES[toolName]?.length ?? 0), 0);
}

function buildSchemaArgMetadata(
  toolNames: readonly string[],
  profile: ToolSurfaceProfile,
  projectionMode: RuntimeToolSurfaceProjectionMode,
): {
  perToolVisibleArgs: Record<string, string[]>;
  perToolSuppressedArgs: Record<string, string[]>;
} {
  const perToolVisibleArgs: Record<string, string[]> = {};
  const perToolSuppressedArgs: Record<string, string[]> = {};
  for (const toolName of toolNames) {
    perToolVisibleArgs[toolName] = schemaArgNamesForTool(toolName, profile, projectionMode);
    perToolSuppressedArgs[toolName] = suppressedSchemaArgNamesForTool(toolName, profile, projectionMode);
  }
  return { perToolVisibleArgs, perToolSuppressedArgs };
}

export function buildRuntimeToolSurfaceProjectionSummary(context: RuntimeToolContext): RuntimeToolSurfaceProjectionSummary {
  const profile = context.toolSurfaceProfile ?? "coding";
  const advancedToolSchema = context.advancedToolSchema ?? (profile === "browser_advanced" || profile === "full_debug");
  const visibleTools = context.modelVisibleTools ?? toolNamesForSurfaceProfile(profile);
  const dispatchEnabledTools = context.enabledTools ?? visibleTools;
  const projectionMode = projectionModeForSurface(profile, advancedToolSchema);
  const { total: schemaPropertyCount, perToolPropertyCount } = sumSchemaPropertyCounts(visibleTools, profile, projectionMode);
  const fullSchemaPropertyCount = sumFullSchemaPropertyCounts(visibleTools);
  const { perToolVisibleArgs, perToolSuppressedArgs } = buildSchemaArgMetadata(visibleTools, profile, projectionMode);
  return {
    source: "gateway.fallback",
    policyVersion: context.toolPolicyVersion ?? TOOL_SURFACE_POLICY_VERSION,
    profile,
    projectionMode,
    advancedToolSchema,
    visibleToolCount: visibleTools.length,
    dispatchEnabledToolCount: dispatchEnabledTools.length,
    schemaPropertyCount,
    fullSchemaPropertyCount,
    suppressedSchemaPropertyCount: Math.max(0, fullSchemaPropertyCount - schemaPropertyCount),
    schemaEstimatedTokens: context.schemaEstimatedTokens ?? estimateToolSchemaTokens(visibleTools, profile),
    schemaFingerprint: buildToolSurfaceFingerprint(profile, visibleTools, { advancedToolSchema }),
    perToolPropertyCount,
    perToolVisibleArgs,
    perToolSuppressedArgs,
  };
}

export function estimateToolSchemaTokens(toolNames: readonly string[], profile: ToolSurfaceProfile): number {
  return Math.max(1, Math.ceil(toolNames.reduce((total, toolName) => {
    if (profile === "full_debug") {
      return total + (ADVANCED_BROWSER_SCHEMA_TOKEN_ESTIMATE[toolName] ?? PROFILE_SCHEMA_TOKEN_ESTIMATE[toolName] ?? 80);
    }
    if (profile === "browser_advanced") {
      if (toolName === "ask_user") {
        return total + PROFILE_SCHEMA_TOKEN_ESTIMATE.ask_user_slim;
      }
      return total + (ADVANCED_BROWSER_SCHEMA_TOKEN_ESTIMATE[toolName] ?? PROFILE_SCHEMA_TOKEN_ESTIMATE[toolName] ?? 80);
    }
    if (
      toolName === "read"
      && (profile === "minimal" || profile === "browser" || profile === "context")
    ) {
      return total + PROFILE_SCHEMA_TOKEN_ESTIMATE.read_slim;
    }
    if (toolName === "semantic_search" && profile === "context") {
      return total + PROFILE_SCHEMA_TOKEN_ESTIMATE.semantic_search_slim;
    }
    if (toolName === "ask_user") {
      return total + PROFILE_SCHEMA_TOKEN_ESTIMATE.ask_user_slim;
    }
    if (toolName === "mcp_servers") {
      return total + PROFILE_SCHEMA_TOKEN_ESTIMATE.mcp_servers_slim;
    }
    return total + (PROFILE_SCHEMA_TOKEN_ESTIMATE[toolName] ?? 80);
  }, 0)));
}

function fingerprintPayloadHash(prefix: string, payload: unknown): string {
  const text = JSON.stringify(payload);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${prefix}:${hash.toString(16).padStart(8, "0")}`;
}

export function buildToolSurfaceFingerprint(
  profile: ToolSurfaceProfile,
  toolNames: readonly string[],
  input: ToolSurfaceFingerprintInput = {},
): string {
  const advancedToolSchema = input.advancedToolSchema ?? (profile === "browser_advanced" || profile === "full_debug");
  const projectionMode = projectionModeForSurface(profile, advancedToolSchema);
  const stableToolNames = [...new Set(toolNames.map((toolName) => toolName.trim()).filter(Boolean))].sort();
  const { total: schemaPropertyCount, perToolPropertyCount } = sumSchemaPropertyCounts(
    stableToolNames,
    profile,
    projectionMode,
  );
  const fullSchemaPropertyCount = sumFullSchemaPropertyCounts(stableToolNames);
  const { perToolVisibleArgs, perToolSuppressedArgs } = buildSchemaArgMetadata(
    stableToolNames,
    profile,
    projectionMode,
  );
  return fingerprintPayloadHash("surface", {
    policy: TOOL_SURFACE_POLICY_VERSION,
    profile,
    projection_mode: projectionMode,
    advanced_tool_schema: advancedToolSchema,
    tools: stableToolNames,
    schema_property_count: schemaPropertyCount,
    full_schema_property_count: fullSchemaPropertyCount,
    suppressed_schema_property_count: Math.max(0, fullSchemaPropertyCount - schemaPropertyCount),
    per_tool_property_count: perToolPropertyCount,
    per_tool_visible_args: perToolVisibleArgs,
    per_tool_suppressed_args: perToolSuppressedArgs,
  });
}
