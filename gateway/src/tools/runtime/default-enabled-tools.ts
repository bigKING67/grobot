import type {
  RuntimeToolContext,
  RuntimeToolSurfaceDecision,
  ToolSurfaceDecisionSuppression,
  ToolSurfaceProfile,
  ToolSurfaceSource,
} from "../../models/types";
import type { RuntimeToolRecoveryFeedback } from "./tool-events";
import type { RuntimeToolRecoveryReadinessGateDecision } from "./tool-recovery-readiness-gate";

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

export const TOOL_SURFACE_POLICY_VERSION = "v1";

export const TOOL_SURFACE_PROFILES = [
  "minimal",
  "coding",
  "browser",
  "browser_advanced",
  "context",
  "mcp",
  "full_debug",
] as const satisfies readonly ToolSurfaceProfile[];

export interface RuntimeToolSurfaceAdaptation {
  enabled: boolean;
  active: boolean;
  reason: string;
  fromProfile: ToolSurfaceProfile;
  appliedProfile: ToolSurfaceProfile;
  recommendedProfile: ToolSurfaceProfile | null;
  source: ToolSurfaceSource | null;
  autoAdaptationBlocked: boolean;
  recoveryStage: RuntimeToolRecoveryFeedback["stage"];
  recoveryToolName: string | null;
  recoveryErrorClass: string | null;
  recoveryRecoverable: boolean | null;
  recoveryObservedAt: string | null;
}

export interface RuntimeToolSurfaceAdaptationResult {
  context: RuntimeToolContext | undefined;
  adaptation: RuntimeToolSurfaceAdaptation;
}

export type RuntimeToolSurfaceProjectionMode = "slim" | "advanced" | "full";
export type RuntimeToolSurfaceProjectionSource = "runtime.tools.describe" | "gateway.fallback";

export interface RuntimeToolSurfaceProjectionSummary {
  source: RuntimeToolSurfaceProjectionSource;
  policyVersion: string;
  profile: ToolSurfaceProfile;
  projectionMode: RuntimeToolSurfaceProjectionMode;
  advancedToolSchema: boolean;
  visibleToolCount: number;
  dispatchEnabledToolCount: number;
  schemaPropertyCount: number;
  fullSchemaPropertyCount: number;
  suppressedSchemaPropertyCount: number;
  schemaEstimatedTokens: number;
  schemaFingerprint: string;
  perToolPropertyCount: Record<string, number>;
  perToolVisibleArgs?: Record<string, string[]>;
  perToolSuppressedArgs?: Record<string, string[]>;
}

const PROFILE_VISIBLE_TOOLS: Record<ToolSurfaceProfile, readonly string[]> = {
  minimal: ["read", "edit", "write", "ask_user"],
  coding: DEFAULT_RUNTIME_ENABLED_TOOLS,
  browser: ["web_scan", "web_execute_js", "read", "ask_user"],
  browser_advanced: ["web_scan", "web_execute_js", "read", "ask_user"],
  context: ["semantic_search", "read", "ask_user"],
  mcp: ["mcp_servers", "mcp_call", "ask_user"],
  full_debug: ALL_RUNTIME_LOCAL_TOOLS,
};

const PROFILE_SCHEMA_TOKEN_ESTIMATE: Record<string, number> = {
  list: 90,
  glob: 110,
  search: 190,
  read: 160,
  write: 90,
  edit: 150,
  bash: 150,
  mcp_servers: 80,
  mcp_call: 100,
  web_scan: 210,
  web_execute_js: 260,
  semantic_search: 190,
  prompt_enhancer: 210,
  ask_user: 160,
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
  web_scan: ["main_only", "max_chars", "session_id", "session_url_pattern", "switch_tab_id", "tabs_only", "text_only"],
  web_execute_js: ["code", "script", "session_id", "session_url_pattern", "switch_tab_id", "tab_id", "timeout_ms"],
};

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

export function buildDefaultRuntimeEnabledTools(): string[] {
  return [...DEFAULT_RUNTIME_ENABLED_TOOLS];
}

export function buildAllRuntimeLocalTools(): string[] {
  return [...ALL_RUNTIME_LOCAL_TOOLS];
}

function projectionModeForSurface(
  profile: ToolSurfaceProfile,
  advancedToolSchema: boolean,
): RuntimeToolSurfaceProjectionMode {
  if (profile === "full_debug") {
    return "full";
  }
  return advancedToolSchema || profile === "browser_advanced" ? "advanced" : "slim";
}

function schemaPropertyCountForTool(toolName: string, projectionMode: RuntimeToolSurfaceProjectionMode): number {
  return schemaArgNamesForTool(toolName, projectionMode).length;
}

function schemaArgNamesForTool(toolName: string, projectionMode: RuntimeToolSurfaceProjectionMode): string[] {
  if (projectionMode === "advanced" && toolName in ADVANCED_BROWSER_SCHEMA_ARG_NAMES) {
    return [...ADVANCED_BROWSER_SCHEMA_ARG_NAMES[toolName]];
  }
  if (projectionMode === "slim" && toolName in SLIM_BROWSER_SCHEMA_ARG_NAMES) {
    return [...SLIM_BROWSER_SCHEMA_ARG_NAMES[toolName]];
  }
  return [...(FULL_SCHEMA_ARG_NAMES[toolName] ?? [])];
}

function suppressedSchemaArgNamesForTool(toolName: string, projectionMode: RuntimeToolSurfaceProjectionMode): string[] {
  const visibleArgNames = new Set(schemaArgNamesForTool(toolName, projectionMode));
  return (FULL_SCHEMA_ARG_NAMES[toolName] ?? []).filter((argName) => !visibleArgNames.has(argName));
}

function sumSchemaPropertyCounts(
  toolNames: readonly string[],
  projectionMode: RuntimeToolSurfaceProjectionMode,
): {
  total: number;
  perToolPropertyCount: Record<string, number>;
} {
  const perToolPropertyCount: Record<string, number> = {};
  let total = 0;
  for (const toolName of toolNames) {
    const count = schemaPropertyCountForTool(toolName, projectionMode);
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
  projectionMode: RuntimeToolSurfaceProjectionMode,
): {
  perToolVisibleArgs: Record<string, string[]>;
  perToolSuppressedArgs: Record<string, string[]>;
} {
  const perToolVisibleArgs: Record<string, string[]> = {};
  const perToolSuppressedArgs: Record<string, string[]> = {};
  for (const toolName of toolNames) {
    perToolVisibleArgs[toolName] = schemaArgNamesForTool(toolName, projectionMode);
    perToolSuppressedArgs[toolName] = suppressedSchemaArgNamesForTool(toolName, projectionMode);
  }
  return { perToolVisibleArgs, perToolSuppressedArgs };
}

export function buildRuntimeToolSurfaceProjectionSummary(context: RuntimeToolContext): RuntimeToolSurfaceProjectionSummary {
  const profile = context.toolSurfaceProfile ?? "coding";
  const advancedToolSchema = context.advancedToolSchema ?? (profile === "browser_advanced" || profile === "full_debug");
  const visibleTools = context.modelVisibleTools ?? toolNamesForSurfaceProfile(profile);
  const dispatchEnabledTools = context.enabledTools ?? visibleTools;
  const projectionMode = projectionModeForSurface(profile, advancedToolSchema);
  const { total: schemaPropertyCount, perToolPropertyCount } = sumSchemaPropertyCounts(visibleTools, projectionMode);
  const fullSchemaPropertyCount = sumFullSchemaPropertyCounts(visibleTools);
  const { perToolVisibleArgs, perToolSuppressedArgs } = buildSchemaArgMetadata(visibleTools, projectionMode);
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
    schemaFingerprint: context.schemaFingerprint ?? buildToolSurfaceFingerprint(profile, visibleTools),
    perToolPropertyCount,
    perToolVisibleArgs,
    perToolSuppressedArgs,
  };
}

function normalizeProfile(raw: string | undefined): ToolSurfaceProfile | undefined {
  const normalized = raw?.trim().toLowerCase().replace(/-/g, "_");
  if (!normalized) {
    return undefined;
  }
  return TOOL_SURFACE_PROFILES.includes(normalized as ToolSurfaceProfile)
    ? normalized as ToolSurfaceProfile
    : undefined;
}

function includesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function scoreMatches(haystack: string, needles: readonly string[], weight = 1): number {
  return needles.reduce((score, needle) => score + (haystack.includes(needle) ? weight : 0), 0);
}

function emptySurfaceScores(): Record<ToolSurfaceProfile, number> {
  return {
    minimal: 0,
    coding: 0,
    browser: 0,
    browser_advanced: 0,
    context: 0,
    mcp: 0,
    full_debug: 0,
  };
}

function cloneSurfaceScores(scores: Record<ToolSurfaceProfile, number>): Record<ToolSurfaceProfile, number> {
  return {
    minimal: scores.minimal,
    coding: scores.coding,
    browser: scores.browser,
    browser_advanced: scores.browser_advanced,
    context: scores.context,
    mcp: scores.mcp,
    full_debug: scores.full_debug,
  };
}

function buildSurfaceDecision(input: {
  profile: ToolSurfaceProfile;
  source: ToolSurfaceSource;
  reason: string;
  scores?: Record<ToolSurfaceProfile, number>;
  suppressed?: readonly ToolSurfaceDecisionSuppression[];
}): RuntimeToolSurfaceDecision {
  return {
    profile: input.profile,
    source: input.source,
    reason: input.reason,
    scores: cloneSurfaceScores(input.scores ?? emptySurfaceScores()),
    suppressed: [...(input.suppressed ?? [])],
  };
}

function suppressSurfaceScore(input: {
  scores: Record<ToolSurfaceProfile, number>;
  suppressed: ToolSurfaceDecisionSuppression[];
  profile: ToolSurfaceProfile;
  reason: string;
}): void {
  const originalScore = input.scores[input.profile] ?? 0;
  if (originalScore <= 0) {
    return;
  }
  input.suppressed.push({
    profile: input.profile,
    reason: input.reason,
    originalScore,
    finalScore: 0,
  });
  input.scores[input.profile] = 0;
}

const CODE_MAINTENANCE_INTENT_TERMS = [
  "code",
  "source",
  "source code",
  "repo",
  "repository",
  "schema",
  "contract",
  "policy",
  "profile",
  "routing",
  "route",
  "heuristic",
  "implementation",
  "runtime",
  "gateway",
  "tool surface",
  "tooling",
  "代码",
  "源码",
  "仓库",
  "实现",
  "修复",
  "优化",
  "打磨",
  "测试",
  "契约",
  "策略",
  "路由",
  "机制",
  "工具",
  "分层",
  "配置",
  "状态",
] as const;

const BROWSER_SURFACE_EXECUTION_TERMS = [
  "browser",
  "devtools",
  "浏览器",
] as const;

const BROWSER_CONTEXT_EXECUTION_TERMS = [
  "current page",
  "current tab",
  "open page",
  "web page",
  "localhost",
  "http://",
  "https://",
  "cookie",
  "dom",
  "网页",
  "当前页面",
  "当前标签",
  "登录态",
] as const;

const BROWSER_DIRECT_TOOL_TERMS = [
  "use web_scan",
  "run web_scan",
  "call web_scan",
  "invoke web_scan",
  "use web_execute_js",
  "run web_execute_js",
  "call web_execute_js",
  "invoke web_execute_js",
  "用 web_scan",
  "使用 web_scan",
  "调用 web_scan",
  "执行 web_scan",
  "用 web_execute_js",
  "使用 web_execute_js",
  "调用 web_execute_js",
  "执行 web_execute_js",
] as const;

const BROWSER_AMBIGUOUS_ACTION_TERMS = [
  "打开",
  "点击",
  "输入",
  "页面",
] as const;

const MCP_DIRECT_EXECUTION_TERMS = [
  "use mcp",
  "run mcp",
  "call mcp",
  "invoke mcp",
  "through mcp",
  "via mcp",
  "use mcp_call",
  "run mcp_call",
  "call mcp_call",
  "invoke mcp_call",
  "grok-search query",
  "grok_search query",
  "web search",
  "external search",
  "用 mcp",
  "使用 mcp",
  "调用 mcp",
  "执行 mcp",
  "通过 mcp",
  "用 mcp_call",
  "使用 mcp_call",
  "调用 mcp_call",
  "执行 mcp_call",
  "grok-search 查",
  "grok_search 查",
  "查资料",
  "检索资料",
  "外部检索",
] as const;

const MCP_AMBIGUOUS_TERMS = [
  "mcp",
  "mcp_call",
  "mcp server",
  "grok-search",
  "grok_search",
] as const;

const CONTEXT_DIRECT_RETRIEVAL_TERMS = [
  "semantic search",
  "use semantic_search",
  "run semantic_search",
  "call semantic_search",
  "invoke semantic_search",
  "semantic_search query",
  "search memory",
  "retrieve memory",
  "query wiki",
  "用 semantic_search",
  "使用 semantic_search",
  "调用 semantic_search",
  "执行 semantic_search",
  "语义搜索",
  "语义检索",
  "查记忆",
  "检索记忆",
  "召回记忆",
  "查经验",
  "检索经验",
  "召回经验",
  "找相关经验",
  "查知识库",
  "检索知识库",
  "知识库找",
  "wiki 查",
] as const;

const ASK_USER_DIRECT_TOOL_TERMS = [
  "use ask_user",
  "run ask_user",
  "call ask_user",
  "invoke ask_user",
  "用 ask_user",
  "使用 ask_user",
  "调用 ask_user",
  "执行 ask_user",
] as const;

const ASK_USER_HUMAN_INTERVENTION_TERMS = [
  "ask user",
  "ask the user",
  "clarify with user",
  "user confirmation",
  "confirm with user",
  "need user input",
  "human intervention",
  "missing constraints",
  "missing information",
  "问用户",
  "询问用户",
  "让用户确认",
  "用户确认",
  "需要用户",
  "人工确认",
  "人工介入",
  "缺失约束",
  "缺少信息",
  "信息不完整",
] as const;

function scoreCodeIntent(haystack: string): number {
  return scoreMatches(haystack, [
    "code",
    "repo",
    "repository",
    "src/",
    "gateway/",
    "runtime/",
    ".ts",
    ".tsx",
    ".js",
    ".mjs",
    ".rs",
    "schema",
    "contract",
    "policy",
    "profile",
    "routing",
    "route",
    "heuristic",
    "runtime",
    "gateway",
    "function",
    "class",
    "interface",
    "component",
    "代码",
    "源码",
    "仓库",
    "文件",
    "组件",
    "函数",
    "接口",
    "实现",
    "修复",
    "优化",
    "打磨",
    "编译",
    "测试",
    "契约",
    "策略",
    "路由",
    "机制",
    "工具",
    "配置",
    "状态",
  ]);
}

function hasCodeMaintenanceIntent(haystack: string): boolean {
  return scoreCodeIntent(haystack) > 0 && includesAny(haystack, CODE_MAINTENANCE_INTENT_TERMS);
}

function hasBrowserExecutionIntent(haystack: string): boolean {
  if (includesAny(haystack, BROWSER_DIRECT_TOOL_TERMS) || includesAny(haystack, BROWSER_CONTEXT_EXECUTION_TERMS)) {
    return true;
  }
  if (hasCodeMaintenanceIntent(haystack)) {
    return false;
  }
  return includesAny(haystack, BROWSER_SURFACE_EXECUTION_TERMS)
    || includesAny(haystack, BROWSER_AMBIGUOUS_ACTION_TERMS);
}

function hasMcpExecutionIntent(haystack: string): boolean {
  if (includesAny(haystack, MCP_DIRECT_EXECUTION_TERMS)) {
    return true;
  }
  return !hasCodeMaintenanceIntent(haystack) && includesAny(haystack, MCP_AMBIGUOUS_TERMS);
}

function hasContextRetrievalIntent(haystack: string): boolean {
  return includesAny(haystack, CONTEXT_DIRECT_RETRIEVAL_TERMS)
    || (!hasCodeMaintenanceIntent(haystack) && includesAny(haystack, [
      "semantic",
      "semantic_search",
      "memory",
      "wiki",
      "经验",
      "记忆",
      "知识库",
      "语义",
      "context",
      "上下文",
    ]));
}

function hasAskUserInterventionIntent(haystack: string): boolean {
  if (includesAny(haystack, ASK_USER_DIRECT_TOOL_TERMS)) {
    return true;
  }
  return !hasCodeMaintenanceIntent(haystack) && includesAny(haystack, ASK_USER_HUMAN_INTERVENTION_TERMS);
}

function chooseHighestScore(scores: Record<ToolSurfaceProfile, number>): ToolSurfaceProfile {
  const priority: ToolSurfaceProfile[] = ["browser_advanced", "mcp", "browser", "context", "coding", "minimal", "full_debug"];
  let best: ToolSurfaceProfile = "coding";
  let bestScore = scores.coding;
  for (const profile of priority) {
    const score = scores[profile] ?? 0;
    if (score > bestScore) {
      best = profile;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : "coding";
}

export function resolveToolSurfaceProfileFromMessage(message: string | undefined): {
  profile: ToolSurfaceProfile;
  source: ToolSurfaceSource;
  reason: string;
  decision: RuntimeToolSurfaceDecision;
} {
  const envProfile = normalizeProfile(process.env.GROBOT_TOOL_SURFACE_PROFILE);
  if (envProfile) {
    const reason = "GROBOT_TOOL_SURFACE_PROFILE";
    return {
      profile: envProfile,
      source: "env",
      reason,
      decision: buildSurfaceDecision({
        profile: envProfile,
        source: "env",
        reason,
      }),
    };
  }

  const normalized = (message ?? "").toLowerCase();
  const codeScore = scoreCodeIntent(normalized);
  if (includesAny(normalized, [
    "full_debug",
    "tool debug",
    "工具调试",
    "全量工具",
  ])) {
    const reason = "explicit tool debug intent";
    const scores = emptySurfaceScores();
    scores.full_debug = 1;
    return {
      profile: "full_debug",
      source: "auto_intent",
      reason,
      decision: buildSurfaceDecision({
        profile: "full_debug",
        source: "auto_intent",
        reason,
        scores,
      }),
    };
  }

  const scores = emptySurfaceScores();
  const suppressed: ToolSurfaceDecisionSuppression[] = [];
  scores.coding = Math.max(0, codeScore);
  if (hasAskUserInterventionIntent(normalized)) {
    scores.minimal += 3;
  }
  scores.browser_advanced += scoreMatches(normalized, [
    "remote cdp",
    "cdp_endpoint",
    "debug chrome",
    "tmwd_ws_endpoint",
    "tmwd_link_endpoint",
    "native fallback",
    "native input",
    "istrusted",
    "devtools",
    "远程调试",
    "坐标点击",
    "文件选择器",
  ], 3);
  scores.browser += scoreMatches(normalized, [
    "browser",
    "web_scan",
    "web_execute_js",
    "current page",
    "tab",
    "cookie",
    "dom",
    "浏览器",
    "网页",
    "登录态",
  ], 2);
  scores.browser += scoreMatches(normalized, ["打开", "点击", "输入", "页面"], 1);
  scores.mcp += scoreMatches(normalized, [
    "mcp",
    "connector",
    "mcp_call",
    "mcp server",
    "grok-search",
    "grok_search",
  ], 3);
  scores.context += scoreMatches(normalized, [
    "semantic",
    "semantic_search",
    "memory",
    "wiki",
    "经验",
    "记忆",
    "知识库",
    "语义",
  ], 2);
  scores.context += scoreMatches(normalized, ["context", "上下文"], 1);

  if (codeScore > 0) {
    if (scores.browser_advanced > 0 && !hasBrowserExecutionIntent(normalized)) {
      suppressSurfaceScore({
        scores,
        suppressed,
        profile: "browser_advanced",
        reason: "code_symbol_not_browser_execution",
      });
    }
    if (scores.browser > 0 && !hasBrowserExecutionIntent(normalized)) {
      suppressSurfaceScore({
        scores,
        suppressed,
        profile: "browser",
        reason: "code_symbol_not_browser_execution",
      });
    }
    if (scores.mcp > 0 && !hasMcpExecutionIntent(normalized)) {
      suppressSurfaceScore({
        scores,
        suppressed,
        profile: "mcp",
        reason: "code_symbol_not_mcp_execution",
      });
    }
    if (scores.context > 0 && !hasContextRetrievalIntent(normalized)) {
      suppressSurfaceScore({
        scores,
        suppressed,
        profile: "context",
        reason: "code_symbol_not_context_retrieval",
      });
    }
  }

  const profile = chooseHighestScore(scores);
  const reason = profile === "coding"
    ? (scores.coding > 0 ? "scored coding task" : "default coding task")
    : `scored ${profile} intent`;
  return {
    profile,
    source: "auto_intent",
    reason,
    decision: buildSurfaceDecision({
      profile,
      source: "auto_intent",
      reason,
      scores,
      suppressed,
    }),
  };
}

export function toolNamesForSurfaceProfile(profile: ToolSurfaceProfile): string[] {
  return [...PROFILE_VISIBLE_TOOLS[profile]];
}

function dedupeKnownToolNames(toolNames: readonly string[], availableTools?: readonly string[]): string[] {
  const available = new Set((availableTools && availableTools.length > 0 ? availableTools : ALL_RUNTIME_LOCAL_TOOLS).map((item) => item.trim()));
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const item of toolNames) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized) || !available.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    rows.push(normalized);
  }
  return rows;
}

function buildRuntimeToolContextForProfile(input: {
  baseContext: RuntimeToolContext;
  profile: ToolSurfaceProfile;
  source: ToolSurfaceSource;
  reason: string;
  decision?: RuntimeToolSurfaceDecision;
  availableTools?: readonly string[];
}): RuntimeToolContext {
  const visibleTools = dedupeKnownToolNames(toolNamesForSurfaceProfile(input.profile), input.availableTools);
  const enabledTools = input.profile === "full_debug"
    ? dedupeKnownToolNames(ALL_RUNTIME_LOCAL_TOOLS, input.availableTools)
    : visibleTools;
  return {
    ...input.baseContext,
    enabledTools,
    modelVisibleTools: visibleTools,
    toolSurfaceProfile: input.profile,
    toolSurfaceSource: input.source,
    toolSurfaceReason: input.reason,
    toolSurfaceDecision: input.decision ?? input.baseContext.toolSurfaceDecision,
    toolPolicyVersion: TOOL_SURFACE_POLICY_VERSION,
    advancedToolSchema: input.profile === "browser_advanced" || input.profile === "full_debug",
    schemaEstimatedTokens: estimateToolSchemaTokens(visibleTools, input.profile),
    schemaFingerprint: buildToolSurfaceFingerprint(input.profile, visibleTools),
  };
}

function emptyAdaptation(input: {
  context?: RuntimeToolContext;
  reason: string;
  recommendedProfile?: ToolSurfaceProfile | null;
  source?: ToolSurfaceSource | null;
  recoveryFeedback?: RuntimeToolRecoveryFeedback;
  recoveryGate?: RuntimeToolRecoveryReadinessGateDecision;
}): RuntimeToolSurfaceAdaptation {
  const fromProfile = input.context?.toolSurfaceProfile ?? "coding";
  return {
    enabled: true,
    active: false,
    reason: input.reason,
    fromProfile,
    appliedProfile: fromProfile,
    recommendedProfile: input.recommendedProfile ?? null,
    source: input.source ?? null,
    autoAdaptationBlocked: Boolean(
      input.recoveryGate?.blocking
      || (input.recoveryFeedback?.active && input.recoveryFeedback.recoverable === false),
    ),
    recoveryStage: input.recoveryFeedback?.stage ?? null,
    recoveryToolName: input.recoveryFeedback?.toolName ?? null,
    recoveryErrorClass: input.recoveryFeedback?.errorClass ?? null,
    recoveryRecoverable: input.recoveryFeedback?.recoverable ?? null,
    recoveryObservedAt: input.recoveryFeedback?.observedAt ?? null,
  };
}

function inferProfileFromRecovery(input: {
  feedback: RuntimeToolRecoveryFeedback;
  userMessage?: string;
}): ToolSurfaceProfile | undefined {
  const recoveryText = [
    input.feedback.toolName ?? "",
    input.feedback.errorClass ?? "",
    input.feedback.recommendedNextAction ?? "",
  ].join(" ").toLowerCase();
  const unavailableSignal = includesAny(recoveryText, [
    "tool_not_visible",
    "tool_disabled",
    "semantic_tool_unavailable",
  ]);
  if (!unavailableSignal && input.feedback.stage !== "strategy_switch") {
    return undefined;
  }
  const normalizedMessage = (input.userMessage ?? "").toLowerCase();
  if (includesAny(recoveryText, ["web_scan", "web_execute_js"])) {
    if (hasCodeMaintenanceIntent(normalizedMessage) && !hasBrowserExecutionIntent(normalizedMessage)) {
      return undefined;
    }
    return "browser";
  }
  if (includesAny(recoveryText, ["mcp_servers", "mcp_call", "grok-search", "grok_search"])) {
    if (hasCodeMaintenanceIntent(normalizedMessage) && !hasMcpExecutionIntent(normalizedMessage)) {
      return undefined;
    }
    return "mcp";
  }
  if (includesAny(recoveryText, ["semantic_search", "semantic_tool_unavailable"])) {
    if (hasCodeMaintenanceIntent(normalizedMessage) && !hasContextRetrievalIntent(normalizedMessage)) {
      return undefined;
    }
    return "context";
  }

  if (!normalizedMessage) {
    return undefined;
  }
  if (hasBrowserExecutionIntent(normalizedMessage)) {
    return "browser";
  }
  if (hasMcpExecutionIntent(normalizedMessage)) {
    return "mcp";
  }
  if (hasContextRetrievalIntent(normalizedMessage)) {
    return "context";
  }
  return undefined;
}

export function adaptRuntimeToolContextForRecovery(input: {
  context: RuntimeToolContext | undefined;
  recoveryFeedback: RuntimeToolRecoveryFeedback;
  recoveryGate?: RuntimeToolRecoveryReadinessGateDecision;
  userMessage?: string;
  availableTools?: readonly string[];
}): RuntimeToolSurfaceAdaptationResult {
  if (!input.context) {
    return {
      context: undefined,
      adaptation: emptyAdaptation({
        reason: "missing_tool_context",
        recoveryFeedback: input.recoveryFeedback,
        recoveryGate: input.recoveryGate,
      }),
    };
  }
  if (input.recoveryGate?.blocking) {
    return {
      context: input.context,
      adaptation: emptyAdaptation({
        context: input.context,
        reason: `recovery_gate_${input.recoveryGate.reason}`,
        recoveryFeedback: input.recoveryFeedback,
        recoveryGate: input.recoveryGate,
      }),
    };
  }
  if (!input.recoveryFeedback.active) {
    return {
      context: input.context,
      adaptation: emptyAdaptation({
        context: input.context,
        reason: input.recoveryFeedback.reason,
        recoveryFeedback: input.recoveryFeedback,
        recoveryGate: input.recoveryGate,
      }),
    };
  }
  if (input.recoveryFeedback.recoverable === false) {
    return {
      context: input.context,
      adaptation: emptyAdaptation({
        context: input.context,
        reason: "recovery_requires_user_intervention",
        recoveryFeedback: input.recoveryFeedback,
        recoveryGate: input.recoveryGate,
      }),
    };
  }

  const source = input.context.toolSurfaceSource ?? "fallback";
  if (source === "env" || source === "cli" || source === "config" || source === "debug") {
    return {
      context: input.context,
      adaptation: emptyAdaptation({
        context: input.context,
        reason: `explicit_surface_source_${source}`,
        recoveryFeedback: input.recoveryFeedback,
        recoveryGate: input.recoveryGate,
      }),
    };
  }

  const fromProfile = input.context.toolSurfaceProfile ?? "coding";
  if (fromProfile !== "coding" && fromProfile !== "minimal") {
    return {
      context: input.context,
      adaptation: emptyAdaptation({
        context: input.context,
        reason: `current_profile_${fromProfile}_wins`,
        recoveryFeedback: input.recoveryFeedback,
        recoveryGate: input.recoveryGate,
      }),
    };
  }

  const recommendedProfile = inferProfileFromRecovery({
    feedback: input.recoveryFeedback,
    userMessage: input.userMessage,
  });
  if (!recommendedProfile) {
    return {
      context: input.context,
      adaptation: emptyAdaptation({
        context: input.context,
        reason: "no_safe_profile_for_recovery",
        recoveryFeedback: input.recoveryFeedback,
        recoveryGate: input.recoveryGate,
      }),
    };
  }
  if (recommendedProfile === fromProfile) {
    return {
      context: input.context,
      adaptation: emptyAdaptation({
        context: input.context,
        reason: "already_on_recommended_profile",
        recommendedProfile,
        recoveryFeedback: input.recoveryFeedback,
        recoveryGate: input.recoveryGate,
      }),
    };
  }

  const reason = [
    "recent_recovery_surface_adaptation",
    `tool=${input.recoveryFeedback.toolName ?? "<none>"}`,
    `error_class=${input.recoveryFeedback.errorClass ?? "<none>"}`,
  ].join(" ");
  const adaptedContext = buildRuntimeToolContextForProfile({
    baseContext: input.context,
    profile: recommendedProfile,
    source: "metrics_recovery",
    reason,
    availableTools: input.availableTools,
  });
  return {
    context: adaptedContext,
    adaptation: {
      enabled: true,
      active: true,
      reason,
      fromProfile,
      appliedProfile: recommendedProfile,
      recommendedProfile,
      source: "metrics_recovery",
      autoAdaptationBlocked: false,
      recoveryStage: input.recoveryFeedback.stage,
      recoveryToolName: input.recoveryFeedback.toolName,
      recoveryErrorClass: input.recoveryFeedback.errorClass,
      recoveryRecoverable: input.recoveryFeedback.recoverable,
      recoveryObservedAt: input.recoveryFeedback.observedAt ?? null,
    },
  };
}

export function estimateToolSchemaTokens(toolNames: readonly string[], profile: ToolSurfaceProfile): number {
  return Math.max(1, Math.ceil(toolNames.reduce((total, toolName) => {
    if (profile === "browser_advanced" || profile === "full_debug") {
      return total + (ADVANCED_BROWSER_SCHEMA_TOKEN_ESTIMATE[toolName] ?? PROFILE_SCHEMA_TOKEN_ESTIMATE[toolName] ?? 80);
    }
    return total + (PROFILE_SCHEMA_TOKEN_ESTIMATE[toolName] ?? 80);
  }, 0)));
}

export function buildToolSurfaceFingerprint(profile: ToolSurfaceProfile, toolNames: readonly string[]): string {
  const payload = JSON.stringify({
    policy: TOOL_SURFACE_POLICY_VERSION,
    profile,
    tools: [...toolNames].sort(),
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `surface:${hash.toString(16).padStart(8, "0")}`;
}

export function buildRuntimeToolContextForMessage(
  baseContext: RuntimeToolContext | undefined,
  message: string | undefined,
  availableTools?: readonly string[],
): RuntimeToolContext | undefined {
  if (!baseContext) {
    return undefined;
  }
  const decision = resolveToolSurfaceProfileFromMessage(message);
  return buildRuntimeToolContextForProfile({
    baseContext,
    profile: decision.profile,
    source: decision.source,
    reason: decision.reason,
    decision: decision.decision,
    availableTools,
  });
}
