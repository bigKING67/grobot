import {
  buildToolSurfaceFingerprint,
  TOOL_SURFACE_POLICY_VERSION,
} from "../../../tools/runtime/default-enabled-tools";
import { RUNTIME_TOOL_SURFACE_ROUTING_EVALS } from "../../../tools/runtime/tool-surface-routing-evals";
import {
  build,
  expect,
  expectDecisionProfile,
  expectDeepEqual,
  expectEqual,
  expectProjectionWithinBudget,
  expectSuppressedProfile,
  withEnvProfile,
} from "./helpers";

export type RuntimeToolSurfaceRoutingContractResult = {
  routingEvalCount: number;
  codingVisibleCount: number;
  browserVisibleCount: number;
  fullDebugVisibleCount: number;
  fullDebugDispatchCount: number;
  fullDebugDispatchMatchesVisible: boolean;
  pageComponentCodeProfile: string | undefined;
  contextEngineCodeProfile: string | undefined;
  webScanSchemaCodeProfile: string | undefined;
  webScanSchemaSuppressedCount: number;
  browserSchemaCodeProfile: string | undefined;
  browserSchemaSuppressedCount: number;
  mcpToolCodeProfile: string | undefined;
  mcpToolCodeSuppressedCount: number;
  semanticToolCodeProfile: string | undefined;
  semanticToolCodeSuppressedCount: number;
  directBrowserToolProfile: string | undefined;
  directBrowserToolSuppressedCount: number;
  directMcpToolProfile: string | undefined;
  directContextToolProfile: string | undefined;
};

export function runRoutingProfilesContract(): RuntimeToolSurfaceRoutingContractResult {
  for (const row of RUNTIME_TOOL_SURFACE_ROUTING_EVALS) {
    const routed = withEnvProfile(undefined, () => build(row.message));
    expectEqual(routed.toolSurfaceProfile, row.expectedProfile, `${row.id}: profile`);
    expectEqual(routed.toolSurfaceSource, row.expectedSource, `${row.id}: source`);
    expectDeepEqual(routed.modelVisibleTools, row.expectedVisibleTools, `${row.id}: visible tools`);
    for (const forbiddenToolName of row.forbiddenVisibleTools ?? []) {
      expect(
        routed.modelVisibleTools?.includes(forbiddenToolName) !== true,
        `${row.id}: forbidden visible tool ${forbiddenToolName}`,
      );
    }
    for (const suppression of row.requiredSuppressed ?? []) {
      expectSuppressedProfile(
        routed,
        suppression.profile,
        suppression.reason,
        `${row.id}: suppression`,
      );
    }
    expectProjectionWithinBudget(routed, `${row.id}: projection budget`);
  }

  const coding = withEnvProfile(undefined, () => build(undefined));
  expectEqual(coding.toolSurfaceProfile, "coding", "default profile");
  expectEqual(coding.toolSurfaceSource, "auto_intent", "default profile source");
  expectDecisionProfile(coding, "coding", "default profile decision");
  expectEqual(coding.toolSurfaceDecision?.suppressed.length, 0, "default decision has no suppressions");
  expectEqual(coding.toolPolicyVersion, TOOL_SURFACE_POLICY_VERSION, "policy version");
  expectDeepEqual(coding.modelVisibleTools, [
    "glob",
    "search",
    "read",
    "write",
    "edit",
    "bash",
    "ask_user",
  ], "coding visible tools");
  expectDeepEqual(coding.enabledTools, coding.modelVisibleTools, "coding dispatch tools");
  expectEqual(coding.modelVisibleTools?.includes("prompt_enhancer"), false, "coding hides prompt_enhancer");
  expectEqual(coding.modelVisibleTools?.includes("web_scan"), false, "coding hides web_scan");
  expectEqual(coding.advancedToolSchema, false, "coding slim schema");
  expectEqual(
    coding.schemaFingerprint,
    buildToolSurfaceFingerprint("coding", coding.modelVisibleTools ?? []),
    "coding fingerprint",
  );

  const minimal = withEnvProfile("minimal", () => build("普通 coding task"));
  expectEqual(minimal.toolSurfaceProfile, "minimal", "minimal profile");
  expectEqual(minimal.toolSurfaceSource, "env", "minimal source");
  expectDeepEqual(minimal.modelVisibleTools, ["read", "edit", "write", "ask_user"], "minimal visible tools");

  const browser = withEnvProfile(undefined, () => build("打开浏览器页面，扫描 DOM"));
  expectEqual(browser.toolSurfaceProfile, "browser", "browser profile");
  expectDecisionProfile(browser, "browser", "browser profile decision");
  expectDeepEqual(browser.modelVisibleTools, ["web_scan", "web_execute_js", "read", "ask_user"], "browser visible tools");
  expectDeepEqual(browser.enabledTools, browser.modelVisibleTools, "browser dispatch tools");
  expectEqual(browser.advancedToolSchema, false, "browser slim schema");

  const browserAdvanced = withEnvProfile(undefined, () => build("用 remote CDP devtools 调试当前页面"));
  expectEqual(browserAdvanced.toolSurfaceProfile, "browser_advanced", "browser advanced profile");
  expectDecisionProfile(browserAdvanced, "browser_advanced", "browser advanced profile decision");
  expectDeepEqual(browserAdvanced.modelVisibleTools, ["web_scan", "web_execute_js", "read", "ask_user"], "browser advanced visible tools");
  expectEqual(browserAdvanced.advancedToolSchema, true, "browser advanced schema");

  const context = withEnvProfile(undefined, () => build("用记忆和语义上下文找相关经验"));
  expectEqual(context.toolSurfaceProfile, "context", "context profile");
  expectDecisionProfile(context, "context", "context profile decision");
  expectDeepEqual(context.modelVisibleTools, ["semantic_search", "read", "ask_user"], "context visible tools");
  expectDeepEqual(context.enabledTools, context.modelVisibleTools, "context dispatch tools");

  const mcp = withEnvProfile(undefined, () => build("通过 MCP grok-search 查资料"));
  expectEqual(mcp.toolSurfaceProfile, "mcp", "mcp profile");
  expectDecisionProfile(mcp, "mcp", "mcp profile decision");
  expectDeepEqual(mcp.modelVisibleTools, ["mcp_servers", "mcp_call", "ask_user"], "mcp visible tools");
  expectDeepEqual(mcp.enabledTools, mcp.modelVisibleTools, "mcp dispatch tools");

  const fullDebug = withEnvProfile("full_debug", () => build("普通 coding task"));
  expectEqual(fullDebug.toolSurfaceProfile, "full_debug", "full_debug profile");
  expectEqual(fullDebug.toolSurfaceSource, "env", "full_debug source");
  expectDecisionProfile(fullDebug, "full_debug", "full_debug env decision");
  expectEqual(fullDebug.modelVisibleTools?.length, 14, "full_debug visible count");
  expectEqual(fullDebug.enabledTools?.length, 14, "full_debug dispatch count");
  expectEqual(fullDebug.modelVisibleTools?.includes("prompt_enhancer"), true, "full_debug shows prompt_enhancer");
  expectEqual(fullDebug.modelVisibleTools?.includes("web_scan"), true, "full_debug shows web_scan");
  expectDeepEqual(fullDebug.enabledTools, fullDebug.modelVisibleTools, "full_debug dispatch matches visible");
  expectEqual(fullDebug.advancedToolSchema, true, "full_debug advanced schema");

  const filteredFullDebug = withEnvProfile("full_debug", () => build("普通 coding task", ["read", "bash"]));
  expectDeepEqual(filteredFullDebug.modelVisibleTools, ["read", "bash"], "filtered full_debug visible tools");
  expectDeepEqual(filteredFullDebug.enabledTools, ["read", "bash"], "filtered full_debug dispatch tools");

  const pageComponentCode = withEnvProfile(undefined, () => build("优化这个页面组件代码的布局逻辑"));
  expectEqual(pageComponentCode.toolSurfaceProfile, "coding", "page component code should stay coding");

  const contextEngineCode = withEnvProfile(undefined, () => build("看下上下文引擎代码里的 memory mechanism"));
  expectEqual(contextEngineCode.toolSurfaceProfile, "coding", "context engine code should stay coding");

  const webScanSchemaCode = withEnvProfile(undefined, () => build("优化 web_scan schema 和 web_execute_js contract"));
  expectEqual(webScanSchemaCode.toolSurfaceProfile, "coding", "browser tool symbols in code should stay coding");
  expectDecisionProfile(webScanSchemaCode, "coding", "web_scan schema code decision");
  expectSuppressedProfile(webScanSchemaCode, "browser", "code_symbol_not_browser_execution", "web_scan schema code decision");

  const browserSchemaCode = withEnvProfile(undefined, () => build("继续打磨 browser devtools schema 分层"));
  expectEqual(browserSchemaCode.toolSurfaceProfile, "coding", "browser schema work should stay coding");
  expectDecisionProfile(browserSchemaCode, "coding", "browser schema code decision");
  expectSuppressedProfile(browserSchemaCode, "browser", "code_symbol_not_browser_execution", "browser schema code decision");
  expectSuppressedProfile(browserSchemaCode, "browser_advanced", "code_symbol_not_browser_execution", "browser schema code decision");

  const mcpToolCode = withEnvProfile(undefined, () => build("修复 mcp_call 工具代码里的 routing policy"));
  expectEqual(mcpToolCode.toolSurfaceProfile, "coding", "mcp tool symbols in code should stay coding");
  expectDecisionProfile(mcpToolCode, "coding", "mcp tool code decision");
  expectSuppressedProfile(mcpToolCode, "mcp", "code_symbol_not_mcp_execution", "mcp tool code decision");

  const semanticToolCode = withEnvProfile(undefined, () => build("打磨 semantic_search runtime 实现和 memory orchestrator 状态"));
  expectEqual(semanticToolCode.toolSurfaceProfile, "coding", "semantic and memory implementation work should stay coding");
  expectDecisionProfile(semanticToolCode, "coding", "semantic tool code decision");
  expectSuppressedProfile(semanticToolCode, "context", "code_symbol_not_context_retrieval", "semantic tool code decision");

  const directBrowserToolUse = withEnvProfile(undefined, () => build("用 web_scan 扫描当前页面"));
  expectEqual(directBrowserToolUse.toolSurfaceProfile, "browser", "direct browser tool use should select browser");
  expectDecisionProfile(directBrowserToolUse, "browser", "direct browser tool decision");
  expectEqual(directBrowserToolUse.toolSurfaceDecision?.suppressed.length, 0, "direct browser tool decision has no suppressions");

  const directMcpToolUse = withEnvProfile(undefined, () => build("用 mcp_call 调 grok-search 查资料"));
  expectEqual(directMcpToolUse.toolSurfaceProfile, "mcp", "direct mcp tool use should select mcp");
  expectDecisionProfile(directMcpToolUse, "mcp", "direct mcp tool decision");

  const directContextToolUse = withEnvProfile(undefined, () => build("用 semantic_search 查团队经验"));
  expectEqual(directContextToolUse.toolSurfaceProfile, "context", "direct semantic retrieval should select context");
  expectDecisionProfile(directContextToolUse, "context", "direct semantic tool decision");

  return {
    routingEvalCount: RUNTIME_TOOL_SURFACE_ROUTING_EVALS.length,
    codingVisibleCount: coding.modelVisibleTools?.length ?? 0,
    browserVisibleCount: browser.modelVisibleTools?.length ?? 0,
    fullDebugVisibleCount: fullDebug.modelVisibleTools?.length ?? 0,
    fullDebugDispatchCount: fullDebug.enabledTools?.length ?? 0,
    fullDebugDispatchMatchesVisible:
      JSON.stringify(fullDebug.enabledTools) === JSON.stringify(fullDebug.modelVisibleTools),
    pageComponentCodeProfile: pageComponentCode.toolSurfaceProfile,
    contextEngineCodeProfile: contextEngineCode.toolSurfaceProfile,
    webScanSchemaCodeProfile: webScanSchemaCode.toolSurfaceProfile,
    webScanSchemaSuppressedCount: webScanSchemaCode.toolSurfaceDecision?.suppressed.length ?? 0,
    browserSchemaCodeProfile: browserSchemaCode.toolSurfaceProfile,
    browserSchemaSuppressedCount: browserSchemaCode.toolSurfaceDecision?.suppressed.length ?? 0,
    mcpToolCodeProfile: mcpToolCode.toolSurfaceProfile,
    mcpToolCodeSuppressedCount: mcpToolCode.toolSurfaceDecision?.suppressed.length ?? 0,
    semanticToolCodeProfile: semanticToolCode.toolSurfaceProfile,
    semanticToolCodeSuppressedCount: semanticToolCode.toolSurfaceDecision?.suppressed.length ?? 0,
    directBrowserToolProfile: directBrowserToolUse.toolSurfaceProfile,
    directBrowserToolSuppressedCount: directBrowserToolUse.toolSurfaceDecision?.suppressed.length ?? 0,
    directMcpToolProfile: directMcpToolUse.toolSurfaceProfile,
    directContextToolProfile: directContextToolUse.toolSurfaceProfile,
  };
}
