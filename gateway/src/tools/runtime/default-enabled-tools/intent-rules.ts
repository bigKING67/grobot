export function includesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

export function scoreMatches(haystack: string, needles: readonly string[], weight = 1): number {
  return needles.reduce((score, needle) => score + (haystack.includes(needle) ? weight : 0), 0);
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

export function scoreCodeIntent(haystack: string): number {
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

export function hasCodeMaintenanceIntent(haystack: string): boolean {
  return scoreCodeIntent(haystack) > 0 && includesAny(haystack, CODE_MAINTENANCE_INTENT_TERMS);
}

export function hasBrowserExecutionIntent(haystack: string): boolean {
  if (includesAny(haystack, BROWSER_DIRECT_TOOL_TERMS) || includesAny(haystack, BROWSER_CONTEXT_EXECUTION_TERMS)) {
    return true;
  }
  if (hasCodeMaintenanceIntent(haystack)) {
    return false;
  }
  return includesAny(haystack, BROWSER_SURFACE_EXECUTION_TERMS)
    || includesAny(haystack, BROWSER_AMBIGUOUS_ACTION_TERMS);
}

export function hasMcpExecutionIntent(haystack: string): boolean {
  if (includesAny(haystack, MCP_DIRECT_EXECUTION_TERMS)) {
    return true;
  }
  return !hasCodeMaintenanceIntent(haystack) && includesAny(haystack, MCP_AMBIGUOUS_TERMS);
}

export function hasContextRetrievalIntent(haystack: string): boolean {
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

export function hasAskUserInterventionIntent(haystack: string): boolean {
  if (includesAny(haystack, ASK_USER_DIRECT_TOOL_TERMS)) {
    return true;
  }
  return !hasCodeMaintenanceIntent(haystack) && includesAny(haystack, ASK_USER_HUMAN_INTERVENTION_TERMS);
}
