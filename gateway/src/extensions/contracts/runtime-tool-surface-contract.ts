import {
  buildRuntimeToolContextForMessage,
  buildToolSurfaceFingerprint,
  estimateToolSchemaTokens,
  TOOL_SURFACE_POLICY_VERSION,
} from "../../tools/runtime/default-enabled-tools";
import type { RuntimeToolContext } from "../../models/types";

const baseContext = {
  workDir: "/tmp/grobot-runtime-tool-surface-contract",
  enabledTools: ["glob", "search", "read", "write", "edit", "bash", "ask_user_question"],
  maxToolRounds: 8,
};

function withEnvProfile<T>(profile: string | undefined, callback: () => T): T {
  const previous = process.env.GROBOT_TOOL_SURFACE_PROFILE;
  if (profile) {
    process.env.GROBOT_TOOL_SURFACE_PROFILE = profile;
  } else {
    delete process.env.GROBOT_TOOL_SURFACE_PROFILE;
  }
  try {
    return callback();
  } finally {
    if (typeof previous === "string") {
      process.env.GROBOT_TOOL_SURFACE_PROFILE = previous;
    } else {
      delete process.env.GROBOT_TOOL_SURFACE_PROFILE;
    }
  }
}

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: actual=${String(actual)} expected=${String(expected)}`);
  }
}

function expectDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: actual=${actualJson} expected=${expectedJson}`);
  }
}

function build(message: string | undefined, availableTools?: readonly string[]): RuntimeToolContext {
  const context = buildRuntimeToolContextForMessage(baseContext, message, availableTools);
  expect(context !== undefined, "runtime tool context should be built");
  return context;
}

const coding = withEnvProfile(undefined, () => build(undefined));
expectEqual(coding.toolSurfaceProfile, "coding", "default profile");
expectEqual(coding.toolSurfaceSource, "auto_intent", "default profile source");
expectEqual(coding.toolPolicyVersion, TOOL_SURFACE_POLICY_VERSION, "policy version");
expectDeepEqual(coding.modelVisibleTools, [
  "glob",
  "search",
  "read",
  "write",
  "edit",
  "bash",
  "ask_user_question",
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
expectEqual(
  coding.schemaEstimatedTokens,
  estimateToolSchemaTokens(coding.modelVisibleTools ?? [], "coding"),
  "coding schema token estimate",
);

const browser = withEnvProfile(undefined, () => build("打开浏览器页面，扫描 DOM"));
expectEqual(browser.toolSurfaceProfile, "browser", "browser profile");
expectDeepEqual(browser.modelVisibleTools, ["web_scan", "web_execute_js", "read", "ask_user_question"], "browser visible tools");
expectDeepEqual(browser.enabledTools, browser.modelVisibleTools, "browser dispatch tools");
expectEqual(browser.advancedToolSchema, false, "browser slim schema");

const browserAdvanced = withEnvProfile(undefined, () => build("用 remote CDP devtools 调试当前页面"));
expectEqual(browserAdvanced.toolSurfaceProfile, "browser_advanced", "browser advanced profile");
expectDeepEqual(browserAdvanced.modelVisibleTools, ["web_scan", "web_execute_js", "read", "ask_user_question"], "browser advanced visible tools");
expectEqual(browserAdvanced.advancedToolSchema, true, "browser advanced schema");

const context = withEnvProfile(undefined, () => build("用记忆和语义上下文找相关经验"));
expectEqual(context.toolSurfaceProfile, "context", "context profile");
expectDeepEqual(context.modelVisibleTools, ["semantic_search", "read", "ask_user_question"], "context visible tools");
expectDeepEqual(context.enabledTools, context.modelVisibleTools, "context dispatch tools");

const mcp = withEnvProfile(undefined, () => build("通过 MCP grok-search 查资料"));
expectEqual(mcp.toolSurfaceProfile, "mcp", "mcp profile");
expectDeepEqual(mcp.modelVisibleTools, ["mcp_servers", "mcp_call", "ask_user_question"], "mcp visible tools");
expectDeepEqual(mcp.enabledTools, mcp.modelVisibleTools, "mcp dispatch tools");

const fullDebug = withEnvProfile("full_debug", () => build("普通 coding task"));
expectEqual(fullDebug.toolSurfaceProfile, "full_debug", "full_debug profile");
expectEqual(fullDebug.toolSurfaceSource, "env", "full_debug source");
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

process.stdout.write(JSON.stringify({
  ok: true,
  policy_version: TOOL_SURFACE_POLICY_VERSION,
  coding_visible_count: coding.modelVisibleTools?.length ?? 0,
  browser_visible_count: browser.modelVisibleTools?.length ?? 0,
  full_debug_visible_count: fullDebug.modelVisibleTools?.length ?? 0,
  full_debug_dispatch_count: fullDebug.enabledTools?.length ?? 0,
  full_debug_dispatch_matches_visible:
    JSON.stringify(fullDebug.enabledTools) === JSON.stringify(fullDebug.modelVisibleTools),
  page_component_code_profile: pageComponentCode.toolSurfaceProfile,
  context_engine_code_profile: contextEngineCode.toolSurfaceProfile,
}) + "\n");
