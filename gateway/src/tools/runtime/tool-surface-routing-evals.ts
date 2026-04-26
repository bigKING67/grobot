import type { ToolSurfaceProfile, ToolSurfaceSource } from "../../models/types";

export interface RuntimeToolSurfaceRoutingEvalCase {
  id: string;
  message: string;
  expectedProfile: ToolSurfaceProfile;
  expectedSource: ToolSurfaceSource;
  expectedVisibleTools: readonly string[];
  forbiddenVisibleTools?: readonly string[];
  requiredSuppressed?: readonly {
    profile: ToolSurfaceProfile;
    reason: string;
  }[];
}

const CODING_VISIBLE_TOOLS = ["glob", "search", "read", "write", "edit", "bash", "ask_user"] as const;
const BROWSER_VISIBLE_TOOLS = ["web_scan", "web_execute_js", "read", "ask_user"] as const;
const CONTEXT_VISIBLE_TOOLS = ["semantic_search", "read", "ask_user"] as const;
const MCP_VISIBLE_TOOLS = ["mcp_servers", "mcp_call", "ask_user"] as const;
const MINIMAL_VISIBLE_TOOLS = ["read", "edit", "write", "ask_user"] as const;
const FULL_DEBUG_VISIBLE_TOOLS = [
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

export const RUNTIME_TOOL_SURFACE_ROUTING_EVALS: readonly RuntimeToolSurfaceRoutingEvalCase[] = [
  {
    id: "default-coding-empty",
    message: "",
    expectedProfile: "coding",
    expectedSource: "auto_intent",
    expectedVisibleTools: CODING_VISIBLE_TOOLS,
    forbiddenVisibleTools: ["web_scan", "mcp_call", "semantic_search", "prompt_enhancer"],
  },
  {
    id: "code-browser-symbols-stay-coding",
    message: "继续打磨 browser devtools schema 分层和 web_scan contract",
    expectedProfile: "coding",
    expectedSource: "auto_intent",
    expectedVisibleTools: CODING_VISIBLE_TOOLS,
    forbiddenVisibleTools: ["web_scan", "web_execute_js"],
    requiredSuppressed: [
      { profile: "browser", reason: "code_symbol_not_browser_execution" },
      { profile: "browser_advanced", reason: "code_symbol_not_browser_execution" },
    ],
  },
  {
    id: "direct-browser-page-action",
    message: "打开 localhost:3000 当前页面，点击登录按钮后扫描 DOM",
    expectedProfile: "browser",
    expectedSource: "auto_intent",
    expectedVisibleTools: BROWSER_VISIBLE_TOOLS,
    forbiddenVisibleTools: ["mcp_call", "semantic_search", "prompt_enhancer"],
  },
  {
    id: "advanced-browser-debug",
    message: "用 remote CDP devtools 调试当前页面，并用坐标点击文件选择器",
    expectedProfile: "browser_advanced",
    expectedSource: "auto_intent",
    expectedVisibleTools: BROWSER_VISIBLE_TOOLS,
    forbiddenVisibleTools: ["mcp_call", "semantic_search", "prompt_enhancer"],
  },
  {
    id: "code-mcp-symbols-stay-coding",
    message: "修复 mcp_call 工具代码里的 routing policy",
    expectedProfile: "coding",
    expectedSource: "auto_intent",
    expectedVisibleTools: CODING_VISIBLE_TOOLS,
    forbiddenVisibleTools: ["mcp_call", "mcp_servers"],
    requiredSuppressed: [
      { profile: "mcp", reason: "code_symbol_not_mcp_execution" },
    ],
  },
  {
    id: "direct-mcp-search",
    message: "用 mcp_call 调 grok-search 查资料",
    expectedProfile: "mcp",
    expectedSource: "auto_intent",
    expectedVisibleTools: MCP_VISIBLE_TOOLS,
    forbiddenVisibleTools: ["web_scan", "semantic_search", "prompt_enhancer"],
  },
  {
    id: "code-semantic-symbols-stay-coding",
    message: "打磨 semantic_search runtime 实现和 memory orchestrator 状态",
    expectedProfile: "coding",
    expectedSource: "auto_intent",
    expectedVisibleTools: CODING_VISIBLE_TOOLS,
    forbiddenVisibleTools: ["semantic_search"],
    requiredSuppressed: [
      { profile: "context", reason: "code_symbol_not_context_retrieval" },
    ],
  },
  {
    id: "direct-context-retrieval",
    message: "用 semantic_search 查团队经验和 wiki 知识库",
    expectedProfile: "context",
    expectedSource: "auto_intent",
    expectedVisibleTools: CONTEXT_VISIBLE_TOOLS,
    forbiddenVisibleTools: ["web_scan", "mcp_call", "prompt_enhancer"],
  },
  {
    id: "human-intervention-minimal",
    message: "缺少部署窗口信息，先问用户确认是否继续",
    expectedProfile: "minimal",
    expectedSource: "auto_intent",
    expectedVisibleTools: MINIMAL_VISIBLE_TOOLS,
    forbiddenVisibleTools: ["bash", "web_scan", "mcp_call", "semantic_search", "prompt_enhancer"],
  },
  {
    id: "explicit-tool-debug",
    message: "full_debug 工具调试，检查完整 tool manifest",
    expectedProfile: "full_debug",
    expectedSource: "auto_intent",
    expectedVisibleTools: FULL_DEBUG_VISIBLE_TOOLS,
  },
] as const;
