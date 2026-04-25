import type { RuntimeToolContext, ToolSurfaceProfile, ToolSurfaceSource } from "../../models/types";
import type { RuntimeToolRecoveryFeedback } from "./tool-events";

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
  "ask_user_question",
] as const;

export const DEFAULT_RUNTIME_ENABLED_TOOLS = [
  "glob",
  "search",
  "read",
  "write",
  "edit",
  "bash",
  "ask_user_question",
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
  recoveryStage: RuntimeToolRecoveryFeedback["stage"];
  recoveryToolName: string | null;
  recoveryErrorClass: string | null;
  recoveryObservedAt: string | null;
}

export interface RuntimeToolSurfaceAdaptationResult {
  context: RuntimeToolContext | undefined;
  adaptation: RuntimeToolSurfaceAdaptation;
}

const PROFILE_VISIBLE_TOOLS: Record<ToolSurfaceProfile, readonly string[]> = {
  minimal: ["read", "edit", "write", "ask_user_question"],
  coding: DEFAULT_RUNTIME_ENABLED_TOOLS,
  browser: ["web_scan", "web_execute_js", "read", "ask_user_question"],
  browser_advanced: ["web_scan", "web_execute_js", "read", "ask_user_question"],
  context: ["semantic_search", "read", "ask_user_question"],
  mcp: ["mcp_servers", "mcp_call", "ask_user_question"],
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
  ask_user_question: 160,
};

const ADVANCED_BROWSER_SCHEMA_TOKEN_ESTIMATE: Record<string, number> = {
  web_scan: 360,
  web_execute_js: 640,
};

export function buildDefaultRuntimeEnabledTools(): string[] {
  return [...DEFAULT_RUNTIME_ENABLED_TOOLS];
}

export function buildAllRuntimeLocalTools(): string[] {
  return [...ALL_RUNTIME_LOCAL_TOOLS];
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
    "编译",
    "测试",
  ]);
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
} {
  const envProfile = normalizeProfile(process.env.GROBOT_TOOL_SURFACE_PROFILE);
  if (envProfile) {
    return {
      profile: envProfile,
      source: "env",
      reason: "GROBOT_TOOL_SURFACE_PROFILE",
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
    return { profile: "full_debug", source: "auto_intent", reason: "explicit tool debug intent" };
  }

  const scores: Record<ToolSurfaceProfile, number> = {
    minimal: 0,
    coding: Math.max(0, codeScore),
    browser: 0,
    browser_advanced: 0,
    context: 0,
    mcp: 0,
    full_debug: 0,
  };
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
    if (scores.browser > 0 && !includesAny(normalized, ["打开", "点击", "输入", "cookie", "登录态", "dom", "current page", "web_scan", "web_execute_js"])) {
      scores.browser = Math.max(0, scores.browser - 2);
    }
    if (scores.context > 0 && includesAny(normalized, ["上下文引擎", "context engine", "memory mechanism", "记忆机制"])) {
      scores.context = Math.max(0, scores.context - 3);
    }
  }

  const profile = chooseHighestScore(scores);
  return {
    profile,
    source: "auto_intent",
    reason: profile === "coding"
      ? "scored coding task"
      : `scored ${profile} intent`,
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
    recoveryStage: input.recoveryFeedback?.stage ?? null,
    recoveryToolName: input.recoveryFeedback?.toolName ?? null,
    recoveryErrorClass: input.recoveryFeedback?.errorClass ?? null,
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
  if (includesAny(recoveryText, ["web_scan", "web_execute_js"])) {
    return "browser";
  }
  if (includesAny(recoveryText, ["mcp_servers", "mcp_call", "grok-search", "grok_search"])) {
    return "mcp";
  }
  if (includesAny(recoveryText, ["semantic_search", "semantic_tool_unavailable"])) {
    return "context";
  }

  const normalizedMessage = (input.userMessage ?? "").toLowerCase();
  if (!normalizedMessage) {
    return undefined;
  }
  const codeFocused = scoreCodeIntent(normalizedMessage) > 0;
  if (codeFocused) {
    return undefined;
  }
  if (includesAny(normalizedMessage, ["browser", "浏览器", "网页", "dom", "web_scan", "web_execute_js", "点击", "打开"])) {
    return "browser";
  }
  if (includesAny(normalizedMessage, ["mcp", "grok-search", "grok_search", "mcp_call"])) {
    return "mcp";
  }
  if (includesAny(normalizedMessage, ["semantic_search", "语义", "知识库", "记忆", "经验"])) {
    return "context";
  }
  return undefined;
}

export function adaptRuntimeToolContextForRecovery(input: {
  context: RuntimeToolContext | undefined;
  recoveryFeedback: RuntimeToolRecoveryFeedback;
  userMessage?: string;
  availableTools?: readonly string[];
}): RuntimeToolSurfaceAdaptationResult {
  if (!input.context) {
    return {
      context: undefined,
      adaptation: emptyAdaptation({
        reason: "missing_tool_context",
        recoveryFeedback: input.recoveryFeedback,
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
      recoveryStage: input.recoveryFeedback.stage,
      recoveryToolName: input.recoveryFeedback.toolName,
      recoveryErrorClass: input.recoveryFeedback.errorClass,
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
    availableTools,
  });
}
