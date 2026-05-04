import type {
  RuntimeToolContext,
  RuntimeToolSurfaceDecision,
  ToolSurfaceDecisionSuppression,
  ToolSurfaceProfile,
  ToolSurfaceSource,
} from "../../../models/types";
import {
  ALL_RUNTIME_LOCAL_TOOLS,
  TOOL_SURFACE_PROFILES,
  toolNamesForSurfaceProfile,
} from "./catalog";
import { TOOL_SURFACE_POLICY_VERSION } from "./contract";
import {
  buildToolSurfaceFingerprint,
  estimateToolSchemaTokens,
} from "./schema";
import {
  hasAskUserInterventionIntent,
  hasBrowserExecutionIntent,
  hasCodeMaintenanceIntent,
  hasContextRetrievalIntent,
  hasMcpExecutionIntent,
  includesAny,
  scoreCodeIntent,
  scoreMatches,
} from "./intent-rules";

function normalizeProfile(raw: string | undefined): ToolSurfaceProfile | undefined {
  const normalized = raw?.trim().toLowerCase().replace(/-/g, "_");
  if (!normalized) {
    return undefined;
  }
  return TOOL_SURFACE_PROFILES.includes(normalized as ToolSurfaceProfile)
    ? normalized as ToolSurfaceProfile
    : undefined;
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

export function dedupeKnownToolNames(toolNames: readonly string[], availableTools?: readonly string[]): string[] {
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

export function buildRuntimeToolContextForProfile(input: {
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
  const advancedToolSchema = input.profile === "browser_advanced" || input.profile === "full_debug";
  return {
    ...input.baseContext,
    enabledTools,
    modelVisibleTools: visibleTools,
    toolSurfaceProfile: input.profile,
    toolSurfaceSource: input.source,
    toolSurfaceReason: input.reason,
    toolSurfaceDecision: input.decision ?? input.baseContext.toolSurfaceDecision,
    toolPolicyVersion: TOOL_SURFACE_POLICY_VERSION,
    advancedToolSchema,
    schemaEstimatedTokens: estimateToolSchemaTokens(visibleTools, input.profile),
    schemaFingerprint: buildToolSurfaceFingerprint(input.profile, visibleTools, { advancedToolSchema }),
  };
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
