import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  adaptRuntimeToolContextForRecovery,
  buildRuntimeToolContextForMessage,
  buildRuntimeToolSurfaceProjectionSummary,
  buildToolSurfaceFingerprint,
  estimateToolSchemaTokens,
  TOOL_SURFACE_POLICY_VERSION,
} from "../../tools/runtime/default-enabled-tools";
import type { RuntimeEvent, RuntimeToolContext } from "../../models/types";
import type { RuntimeToolRecoveryFeedback } from "../../tools/runtime/tool-events";
import {
  applyRuntimeToolRecoveryConsumption,
  applyRuntimeToolSurfaceAdaptationGuard,
  buildRuntimeToolSurfaceAdaptationGuardPrompt,
  readRuntimeToolSurfaceAdaptationState,
  recordRuntimeToolSurfaceAdaptationOutcome,
  recordRuntimeToolSurfaceRecoveryConsumption,
} from "../../tools/runtime/tool-surface-adaptation-state";
import {
  buildRuntimeToolSurfaceSchemaProfilesFingerprint,
  parseRuntimeToolSurfaceSchemaProfiles,
  parseRuntimeToolSurfaceSchemaProfilesWithDiagnostics,
  runRuntimeToolsDescribe,
} from "../../orchestration/entrypoints/dev-cli/runtime-health";

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

function expectDecisionProfile(context: RuntimeToolContext, expectedProfile: string, message: string): void {
  expect(context.toolSurfaceDecision !== undefined, `${message}: decision missing`);
  expectEqual(context.toolSurfaceDecision.profile, expectedProfile, `${message}: decision profile`);
  expectEqual(typeof context.toolSurfaceDecision.reason, "string", `${message}: decision reason type`);
  expectEqual(typeof context.toolSurfaceDecision.scores.coding, "number", `${message}: decision coding score type`);
  expect(Array.isArray(context.toolSurfaceDecision.suppressed), `${message}: decision suppressed list`);
}

function expectSuppressedProfile(context: RuntimeToolContext, profile: string, reason: string, message: string): void {
  const rows = context.toolSurfaceDecision?.suppressed ?? [];
  const match = rows.find((item) => item.profile === profile && item.reason === reason);
  expect(Boolean(match), `${message}: missing suppressed ${profile}/${reason}`);
  expect(typeof match?.originalScore === "number" && match.originalScore > 0, `${message}: original score`);
  expectEqual(match?.finalScore, 0, `${message}: final score`);
}

function event(eventType: RuntimeEvent["eventType"], payload: Record<string, unknown>): RuntimeEvent {
  return {
    traceId: "trace_runtime_tool_surface_contract",
    turnId: "turn_runtime_tool_surface_contract",
    sessionKey: "dev:tenant:dm:user",
    eventType,
    payload,
    timestampIso: "2026-04-25T00:00:00.000Z",
  };
}

function build(message: string | undefined, availableTools?: readonly string[]): RuntimeToolContext {
  const context = buildRuntimeToolContextForMessage(baseContext, message, availableTools);
  expect(context !== undefined, "runtime tool context should be built");
  return context;
}

function projection(context: RuntimeToolContext) {
  return buildRuntimeToolSurfaceProjectionSummary(context);
}

function activeRecoveryFeedback(input: {
  toolName: string;
  errorClass: string;
  stage?: RuntimeToolRecoveryFeedback["stage"];
  observedAt?: string | null;
  recoverable?: boolean | null;
}): RuntimeToolRecoveryFeedback {
  return {
    active: true,
    severity: "warning",
    reason: "recent_recovery",
    stage: input.stage ?? "strategy_switch",
    toolName: input.toolName,
    errorClass: input.errorClass,
    recommendedNextAction: "switch_tool_strategy",
    recoverable: input.recoverable ?? true,
    promptBlock: "recovery prompt",
    ...(input.observedAt !== null
      ? { observedAt: input.observedAt ?? "2026-04-25T00:00:00.000Z" }
      : {}),
  };
}

const inactiveRecoveryFeedback: RuntimeToolRecoveryFeedback = {
  active: false,
  severity: "none",
  reason: "stale_recovery",
  stage: "strategy_switch",
  toolName: "web_scan",
  errorClass: "tool_not_visible",
  recommendedNextAction: "switch_tool_strategy",
  recoverable: null,
  promptBlock: "",
};

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
const codingProjection = projection(coding);
expectEqual(codingProjection.source, "gateway.fallback", "coding projection source");
expectEqual(codingProjection.projectionMode, "slim", "coding projection mode");
expectEqual(codingProjection.visibleToolCount, 7, "coding projection visible tool count");
expectEqual(codingProjection.dispatchEnabledToolCount, 7, "coding projection dispatch tool count");
expectEqual(codingProjection.schemaPropertyCount, 30, "coding projection schema property count");
expectEqual(codingProjection.fullSchemaPropertyCount, 30, "coding projection full property count");
expectEqual(codingProjection.suppressedSchemaPropertyCount, 0, "coding projection suppressed property count");

const browser = withEnvProfile(undefined, () => build("打开浏览器页面，扫描 DOM"));
expectEqual(browser.toolSurfaceProfile, "browser", "browser profile");
expectDecisionProfile(browser, "browser", "browser profile decision");
expectDeepEqual(browser.modelVisibleTools, ["web_scan", "web_execute_js", "read", "ask_user_question"], "browser visible tools");
expectDeepEqual(browser.enabledTools, browser.modelVisibleTools, "browser dispatch tools");
expectEqual(browser.advancedToolSchema, false, "browser slim schema");
const browserProjection = projection(browser);
expectEqual(browserProjection.source, "gateway.fallback", "browser projection source");
expectEqual(browserProjection.projectionMode, "slim", "browser projection mode");
expectEqual(browserProjection.schemaPropertyCount, 25, "browser projection schema property count");
expectEqual(browserProjection.fullSchemaPropertyCount, 47, "browser projection full property count");
expectEqual(browserProjection.suppressedSchemaPropertyCount, 22, "browser projection suppressed property count");
expectDeepEqual(
  browserProjection.perToolVisibleArgs?.web_scan,
  ["main_only", "max_chars", "session_id", "session_url_pattern", "switch_tab_id", "tabs_only", "text_only"],
  "browser projection exposes slim web_scan arg names",
);
expectDeepEqual(
  browserProjection.perToolSuppressedArgs?.web_execute_js,
  [
    "cdp_endpoint",
    "native_auto_execute",
    "native_auto_fallback",
    "native_auto_fallback_policy",
    "native_execute_action_scope",
    "native_fallback_action",
    "native_fallback_args",
    "native_fallback_timeout_ms",
    "no_monitor",
    "target_url_contains",
    "tmwd_link_endpoint",
    "tmwd_mode",
    "tmwd_transport",
    "tmwd_ws_endpoint",
  ],
  "browser projection exposes slim web_execute_js suppressed arg names",
);

const validRuntimeSchemaProfile = {
  policy_version: "v1",
  profile: "browser",
  projection_mode: "slim",
  advanced_tool_schema: false,
  schema_fingerprint: "schema:test",
  tool_names: ["web_scan", "web_execute_js"],
  visible_tool_count: 2,
  schema_property_count: 3,
  full_schema_property_count: 5,
  suppressed_schema_property_count: 2,
  per_tool_property_count: {
    web_scan: 1,
    web_execute_js: 2,
  },
  per_tool_visible_args: {
    web_scan: ["main_only"],
    web_execute_js: ["script", "timeout_ms"],
  },
  per_tool_suppressed_args: {
    web_scan: ["tmwd_mode"],
    web_execute_js: ["native_fallback_action"],
  },
};
expectEqual(
  parseRuntimeToolSurfaceSchemaProfiles([validRuntimeSchemaProfile]).length,
  1,
  "runtime schema profile parser accepts exact arg metadata",
);
const validRuntimeSchemaProfileDiagnostics =
  parseRuntimeToolSurfaceSchemaProfilesWithDiagnostics([validRuntimeSchemaProfile]);
expectEqual(validRuntimeSchemaProfileDiagnostics.rawCount, 1, "runtime schema profile diagnostics raw count");
expectEqual(validRuntimeSchemaProfileDiagnostics.invalidReason, null, "runtime schema profile diagnostics valid reason");
const validRuntimeSchemaProfilesFingerprint =
  buildRuntimeToolSurfaceSchemaProfilesFingerprint([validRuntimeSchemaProfile]);
expect(
  typeof validRuntimeSchemaProfilesFingerprint === "string"
    && validRuntimeSchemaProfilesFingerprint.startsWith("schema_profiles:"),
  "runtime schema profile fingerprint has expected prefix",
);
expectEqual(
  buildRuntimeToolSurfaceSchemaProfilesFingerprint([validRuntimeSchemaProfile]),
  validRuntimeSchemaProfilesFingerprint,
  "runtime schema profile fingerprint is stable",
);
expectEqual(
  buildRuntimeToolSurfaceSchemaProfilesFingerprint({ not: "array" }),
  null,
  "runtime schema profile fingerprint rejects non-array payloads",
);
expect(
  buildRuntimeToolSurfaceSchemaProfilesFingerprint([{
    ...validRuntimeSchemaProfile,
    suppressed_schema_property_count: 3,
  }]) !== validRuntimeSchemaProfilesFingerprint,
  "runtime schema profile fingerprint changes when profile payload changes",
);
expectEqual(
  parseRuntimeToolSurfaceSchemaProfiles([{
    ...validRuntimeSchemaProfile,
    per_tool_visible_args: {
      web_scan: ["main_only", "main_only"],
      web_execute_js: ["script", "timeout_ms"],
    },
  }]).length,
  0,
  "runtime schema profile parser rejects duplicate visible args",
);
expectEqual(
  parseRuntimeToolSurfaceSchemaProfilesWithDiagnostics([{
    ...validRuntimeSchemaProfile,
    per_tool_visible_args: {
      web_scan: ["main_only", "main_only"],
      web_execute_js: ["script", "timeout_ms"],
    },
  }]).invalidReason,
  "schema_profiles_invalid_rows:1",
  "runtime schema profile diagnostics reports duplicate arg rows",
);
expectEqual(
  parseRuntimeToolSurfaceSchemaProfiles([{
    ...validRuntimeSchemaProfile,
    per_tool_suppressed_args: {
      web_scan: ["tmwd_mode"],
      web_execute_js: ["native_fallback_action"],
      ghost_tool: [],
    },
  }]).length,
  0,
  "runtime schema profile parser rejects ghost arg metadata keys",
);
expectEqual(
  parseRuntimeToolSurfaceSchemaProfilesWithDiagnostics({ not: "array" }).invalidReason,
  "schema_profiles_not_array",
  "runtime schema profile diagnostics rejects non-array payloads",
);

const fakeRuntimeDir = join(baseContext.workDir, "fake-runtime-tools-describe");
rmSync(fakeRuntimeDir, { recursive: true, force: true });
mkdirSync(fakeRuntimeDir, { recursive: true });
const fakeRuntimePath = join(fakeRuntimeDir, "runtime.js");
writeFileSync(
  fakeRuntimePath,
  `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify({
    jsonrpc: "2.0",
    id: "tools-describe-1",
    result: {
      tools: [
        { type: "function", function: { name: "web_scan" } },
        { type: "function", function: { name: "web_execute_js" } },
      ],
      default_enabled_tools: ["web_scan"],
      tool_surface_schema_profiles_fingerprint: "schema_profiles:00000000",
      tool_surface_schema_profiles: [validRuntimeSchemaProfile],
    },
  }))});\n`,
  "utf8",
);
chmodSync(fakeRuntimePath, 0o755);
const mismatchedRuntimeDescribe = runRuntimeToolsDescribe(fakeRuntimePath);
expectEqual(mismatchedRuntimeDescribe.ok, false, "runtime tools describe rejects mismatched schema profile fingerprint");
expect(
  mismatchedRuntimeDescribe.detail.startsWith("runtime_tools_describe_schema_profiles_fingerprint_mismatch:"),
  "runtime tools describe reports schema profile fingerprint mismatch",
);

const browserAdvanced = withEnvProfile(undefined, () => build("用 remote CDP devtools 调试当前页面"));
expectEqual(browserAdvanced.toolSurfaceProfile, "browser_advanced", "browser advanced profile");
expectDecisionProfile(browserAdvanced, "browser_advanced", "browser advanced profile decision");
expectDeepEqual(browserAdvanced.modelVisibleTools, ["web_scan", "web_execute_js", "read", "ask_user_question"], "browser advanced visible tools");
expectEqual(browserAdvanced.advancedToolSchema, true, "browser advanced schema");
const browserAdvancedProjection = projection(browserAdvanced);
expectEqual(browserAdvancedProjection.source, "gateway.fallback", "browser advanced projection source");
expectEqual(browserAdvancedProjection.projectionMode, "advanced", "browser advanced projection mode");
expectEqual(browserAdvancedProjection.schemaPropertyCount, 42, "browser advanced projection schema property count");
expectEqual(browserAdvancedProjection.fullSchemaPropertyCount, 47, "browser advanced projection full property count");
expectEqual(browserAdvancedProjection.suppressedSchemaPropertyCount, 5, "browser advanced projection suppressed property count");

const context = withEnvProfile(undefined, () => build("用记忆和语义上下文找相关经验"));
expectEqual(context.toolSurfaceProfile, "context", "context profile");
expectDecisionProfile(context, "context", "context profile decision");
expectDeepEqual(context.modelVisibleTools, ["semantic_search", "read", "ask_user_question"], "context visible tools");
expectDeepEqual(context.enabledTools, context.modelVisibleTools, "context dispatch tools");

const mcp = withEnvProfile(undefined, () => build("通过 MCP grok-search 查资料"));
expectEqual(mcp.toolSurfaceProfile, "mcp", "mcp profile");
expectDecisionProfile(mcp, "mcp", "mcp profile decision");
expectDeepEqual(mcp.modelVisibleTools, ["mcp_servers", "mcp_call", "ask_user_question"], "mcp visible tools");
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
const fullDebugProjection = projection(fullDebug);
expectEqual(fullDebugProjection.source, "gateway.fallback", "full_debug projection source");
expectEqual(fullDebugProjection.projectionMode, "full", "full_debug projection mode");
expectEqual(fullDebugProjection.schemaPropertyCount, 92, "full_debug projection schema property count");
expectEqual(fullDebugProjection.suppressedSchemaPropertyCount, 0, "full_debug suppressed property count");

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

const adaptedBrowser = adaptRuntimeToolContextForRecovery({
  context: coding,
  recoveryFeedback: activeRecoveryFeedback({
    toolName: "web_scan",
    errorClass: "tool_not_visible",
  }),
});
expectEqual(adaptedBrowser.adaptation.active, true, "browser recovery adaptation active");
expectEqual(adaptedBrowser.context?.toolSurfaceProfile, "browser", "browser recovery adapts profile");
expectEqual(adaptedBrowser.context?.toolSurfaceSource, "metrics_recovery", "browser recovery source");
expectEqual(adaptedBrowser.adaptation.recoveryRecoverable, true, "browser recovery recoverable is exposed");
expectEqual(adaptedBrowser.context?.toolSurfaceDecision?.profile, "coding", "recovery keeps original message decision trace");
expectDeepEqual(adaptedBrowser.context?.modelVisibleTools, ["web_scan", "web_execute_js", "read", "ask_user_question"], "browser recovery visible tools");

const adaptedContext = adaptRuntimeToolContextForRecovery({
  context: coding,
  recoveryFeedback: activeRecoveryFeedback({
    toolName: "semantic_search",
    errorClass: "tool_not_visible",
  }),
});
expectEqual(adaptedContext.adaptation.active, true, "context recovery adaptation active");
expectEqual(adaptedContext.context?.toolSurfaceProfile, "context", "context recovery adapts profile");
expectDeepEqual(adaptedContext.context?.modelVisibleTools, ["semantic_search", "read", "ask_user_question"], "context recovery visible tools");

const adaptedMcp = adaptRuntimeToolContextForRecovery({
  context: coding,
  recoveryFeedback: activeRecoveryFeedback({
    toolName: "mcp_call",
    errorClass: "tool_disabled",
  }),
});
expectEqual(adaptedMcp.adaptation.active, true, "mcp recovery adaptation active");
expectEqual(adaptedMcp.context?.toolSurfaceProfile, "mcp", "mcp recovery adapts profile");
expectDeepEqual(adaptedMcp.context?.modelVisibleTools, ["mcp_servers", "mcp_call", "ask_user_question"], "mcp recovery visible tools");

const codeSymbolRecovery = adaptRuntimeToolContextForRecovery({
  context: coding,
  recoveryFeedback: activeRecoveryFeedback({
    toolName: "web_scan",
    errorClass: "tool_not_visible",
  }),
  userMessage: "优化 web_scan schema 和 web_execute_js contract",
});
expectEqual(codeSymbolRecovery.adaptation.active, false, "code-symbol recovery should not switch browser profile");
expectEqual(codeSymbolRecovery.adaptation.reason, "no_safe_profile_for_recovery", "code-symbol recovery reason");
expectEqual(codeSymbolRecovery.context?.toolSurfaceProfile, "coding", "code-symbol recovery keeps coding profile");

const directBrowserRecovery = adaptRuntimeToolContextForRecovery({
  context: coding,
  recoveryFeedback: activeRecoveryFeedback({
    toolName: "web_scan",
    errorClass: "tool_not_visible",
  }),
  userMessage: "用 web_scan 扫描当前页面",
});
expectEqual(directBrowserRecovery.adaptation.active, true, "direct browser recovery still adapts");
expectEqual(directBrowserRecovery.context?.toolSurfaceProfile, "browser", "direct browser recovery profile");

const staleRecovery = adaptRuntimeToolContextForRecovery({
  context: coding,
  recoveryFeedback: inactiveRecoveryFeedback,
});
expectEqual(staleRecovery.adaptation.active, false, "stale recovery does not adapt");
expectEqual(staleRecovery.context?.toolSurfaceProfile, "coding", "stale recovery keeps coding profile");

const envFullDebugRecovery = adaptRuntimeToolContextForRecovery({
  context: fullDebug,
  recoveryFeedback: activeRecoveryFeedback({
    toolName: "web_scan",
    errorClass: "tool_not_visible",
  }),
});
expectEqual(envFullDebugRecovery.adaptation.active, false, "env profile should not adapt");
expectEqual(envFullDebugRecovery.context?.toolSurfaceProfile, "full_debug", "env profile remains full_debug");

const adaptationWorkDir = join("/tmp", `grobot-runtime-tool-surface-adaptation-${String(process.pid)}-${String(Date.now())}`);
mkdirSync(adaptationWorkDir, { recursive: true });
try {
  const initialAdaptationState = readRuntimeToolSurfaceAdaptationState(adaptationWorkDir);
  expectEqual(initialAdaptationState.latestAdaptation, null, "initial adaptation state has no latest record");

  const invalidConsumptionWorkDir = join(adaptationWorkDir, "invalid-consumption");
  const invalidConsumptionStateDir = join(invalidConsumptionWorkDir, ".grobot/runtime");
  mkdirSync(invalidConsumptionStateDir, { recursive: true });
  writeFileSync(
    join(invalidConsumptionStateDir, "tool-surface-adaptation-state.json"),
    `${JSON.stringify({
      version: 1,
      updatedAt: "2026-04-25T00:00:00.000Z",
      recentAdaptations: [],
      profileOutcomes: {},
      recentRecoveryConsumptions: [
        {
          id: "bad_consumption",
          reason: "not_a_known_reason",
          recoveryStage: "strategy_switch",
          recoveryToolName: "web_scan",
          recoveryErrorClass: "tool_not_visible",
          recoveryObservedAt: "2026-04-25T00:00:00.000Z",
          consumedAt: "not-a-date",
          traceId: null,
        },
      ],
    })}\n`,
    "utf8",
  );
  const invalidConsumptionSnapshot = readRuntimeToolSurfaceAdaptationState(invalidConsumptionWorkDir);
  expectEqual(invalidConsumptionSnapshot.recentRecoveryConsumptions.length, 0, "invalid consumption rows are ignored");

  const recoveredWrite = recordRuntimeToolSurfaceAdaptationOutcome({
    workDir: adaptationWorkDir,
    adaptation: adaptedBrowser.adaptation,
    events: [
      event("tool_end", {
        tool_name: "web_scan",
        status: "ok",
      }),
    ],
    verificationPass: true,
    traceId: "trace_recovered",
    nowIso: "2026-04-25T00:00:01.000Z",
  });
  expectEqual(recoveredWrite.recorded, true, "recovered adaptation recorded");
  expectEqual(recoveredWrite.record?.outcome, "recovered", "recovered adaptation outcome");
  expectEqual(recoveredWrite.snapshot.profileOutcomes.browser.recoveredTotal, 1, "browser recovered total");
  expectEqual(recoveredWrite.snapshot.profileOutcomes.browser.recoveryRate, 1, "browser recovery rate");
  expectEqual(recoveredWrite.snapshot.recentRecoveryConsumptions.length, 1, "recovered adaptation consumes recovery signal");
  expectEqual(recoveredWrite.snapshot.latestRecoveryConsumption?.reason, "recovered_signal_consumed", "recovered consumption reason");

  const consumedRecoveredFeedback = applyRuntimeToolRecoveryConsumption({
    feedback: {
      ...activeRecoveryFeedback({
        toolName: "web_scan",
        errorClass: "tool_not_visible",
      }),
      observedAt: "2026-04-25T00:00:00.500Z",
    },
    snapshot: recoveredWrite.snapshot,
  });
  expectEqual(consumedRecoveredFeedback.active, false, "recovered consumption suppresses stale recovery feedback");
  expectEqual(consumedRecoveredFeedback.consumed, true, "recovered consumption marks feedback consumed");
  expectEqual(consumedRecoveredFeedback.consumedReason, "recovered_signal_consumed", "recovered feedback consumed reason");

  const newerRecoveredFeedback = applyRuntimeToolRecoveryConsumption({
    feedback: {
      ...activeRecoveryFeedback({
        toolName: "web_scan",
        errorClass: "tool_not_visible",
      }),
      observedAt: "2026-04-25T00:00:02.000Z",
    },
    snapshot: recoveredWrite.snapshot,
  });
  expectEqual(newerRecoveredFeedback.active, true, "newer recovery signal remains active after prior consumption");

  const newerRecoveredAdaptation = adaptRuntimeToolContextForRecovery({
    context: coding,
    recoveryFeedback: newerRecoveredFeedback,
  });
  const newerRecoveredGuard = applyRuntimeToolSurfaceAdaptationGuard({
    baseContext: coding,
    result: newerRecoveredAdaptation,
    snapshot: recoveredWrite.snapshot,
  });
  expectEqual(newerRecoveredGuard.guard.active, false, "newer recovery signal bypasses consumed guard");
  expectEqual(newerRecoveredGuard.adaptation.active, true, "newer recovery signal can adapt after prior recovery");

  const unobservedRecoveredFeedback = applyRuntimeToolRecoveryConsumption({
    feedback: activeRecoveryFeedback({
      toolName: "web_scan",
      errorClass: "tool_not_visible",
      observedAt: null,
    }),
    snapshot: recoveredWrite.snapshot,
  });
  expectEqual(unobservedRecoveredFeedback.active, true, "untimestamped active recovery feedback fails open");
  expectEqual(unobservedRecoveredFeedback.consumed, false, "untimestamped active recovery feedback is not consumed");

  const consumedRecoveryGuard = applyRuntimeToolSurfaceAdaptationGuard({
    baseContext: coding,
    result: adaptedBrowser,
    snapshot: recoveredWrite.snapshot,
  });
  expectEqual(consumedRecoveryGuard.guard.active, true, "recovered signal activates consumed guard");
  expectEqual(consumedRecoveryGuard.guard.reason, "recovered_signal_consumed", "recovered signal consumed guard reason");
  expectEqual(consumedRecoveryGuard.context?.toolSurfaceProfile, "coding", "consumed guard falls back to coding context");
  expectEqual(consumedRecoveryGuard.adaptation.active, false, "consumed guard blocks stale recovered adaptation");
  expectEqual(consumedRecoveryGuard.adaptation.recommendedProfile, "browser", "consumed guard keeps recommended profile observable");
  const consumedRecoveryGuardPrompt = buildRuntimeToolSurfaceAdaptationGuardPrompt({
    guard: consumedRecoveryGuard.guard,
    recoveryFeedback: activeRecoveryFeedback({
      toolName: "web_scan",
      errorClass: "tool_not_visible",
    }),
  });
  expect(consumedRecoveryGuardPrompt.includes("Runtime Tool Surface Guard"), "guard prompt header");
  expect(consumedRecoveryGuardPrompt.includes("recovered_signal_consumed"), "guard prompt reason");
  expect(consumedRecoveryGuardPrompt.includes("Suppressed recovery hint"), "guard prompt suppresses stale recovery hint");
  expect(consumedRecoveryGuardPrompt.includes("Treat that signal as consumed"), "guard prompt gives consumed signal rule");

  for (let index = 0; index < 2; index += 1) {
    recordRuntimeToolSurfaceAdaptationOutcome({
      workDir: adaptationWorkDir,
      adaptation: adaptedBrowser.adaptation,
      events: [
        event("tool_end", {
          tool_name: "web_scan",
          status: "failed",
          error_class: "tool_not_visible",
        }),
        event("tool_recovery", {
          tool_name: "web_scan",
          error_class: "tool_not_visible",
          recovery_stage: "strategy_switch",
          recovery_reason: "tool_not_visible",
          recommended_next_action: "switch_tool_strategy",
        }),
      ],
      verificationPass: false,
      traceId: `trace_failed_${String(index)}`,
      nowIso: `2026-04-25T00:00:0${String(index + 2)}.000Z`,
    });
  }
  const failedSnapshot = readRuntimeToolSurfaceAdaptationState(adaptationWorkDir);
  expectEqual(failedSnapshot.profileOutcomes.browser.failedTotal, 2, "browser failed total");
  expectEqual(failedSnapshot.profileOutcomes.browser.recoveryRate, 0.3333, "browser recovery rate after failures");

  const guardedBrowser = applyRuntimeToolSurfaceAdaptationGuard({
    baseContext: coding,
    result: adaptedBrowser,
    snapshot: failedSnapshot,
  });
  expectEqual(guardedBrowser.guard.active, true, "repeated failed adaptation activates guard");
  expectEqual(guardedBrowser.guard.reason, "repeated_profile_failure", "repeated failure guard reason");
  expectEqual(guardedBrowser.context?.toolSurfaceProfile, "coding", "guard falls back to coding context");
  expectEqual(guardedBrowser.adaptation.active, false, "guard blocks active adaptation");
  expectEqual(guardedBrowser.adaptation.recommendedProfile, "browser", "guard keeps recommended profile observable");
  const guardedConsumption = recordRuntimeToolSurfaceRecoveryConsumption({
    workDir: adaptationWorkDir,
    guard: guardedBrowser.guard,
    recoveryFeedback: {
      ...activeRecoveryFeedback({
        toolName: "web_scan",
        errorClass: "tool_not_visible",
      }),
      observedAt: "2026-04-25T00:00:03.000Z",
    },
    nowIso: "2026-04-25T00:00:04.000Z",
  });
  expectEqual(guardedConsumption.recorded, true, "guarded recovery consumption recorded");
  expectEqual(guardedConsumption.record?.reason, "repeated_profile_failure", "guarded consumption reason");
  const consumedGuardedFeedback = applyRuntimeToolRecoveryConsumption({
    feedback: {
      ...activeRecoveryFeedback({
        toolName: "web_scan",
        errorClass: "tool_not_visible",
      }),
      observedAt: "2026-04-25T00:00:03.500Z",
    },
    snapshot: guardedConsumption.snapshot,
  });
  expectEqual(consumedGuardedFeedback.active, false, "guarded consumption suppresses stale recovery feedback");
  expectEqual(consumedGuardedFeedback.consumedReason, "repeated_profile_failure", "guarded feedback consumed reason");

  const oscillationWorkDir = join(adaptationWorkDir, "oscillation");
  mkdirSync(oscillationWorkDir, { recursive: true });
  const oscillationSequence = [
    { adaptation: adaptedBrowser.adaptation, toolName: "web_scan", errorClass: "tool_not_visible" },
    { adaptation: adaptedContext.adaptation, toolName: "semantic_search", errorClass: "tool_not_visible" },
    { adaptation: adaptedBrowser.adaptation, toolName: "web_scan", errorClass: "tool_not_visible" },
  ];
  for (const [index, item] of oscillationSequence.entries()) {
    recordRuntimeToolSurfaceAdaptationOutcome({
      workDir: oscillationWorkDir,
      adaptation: item.adaptation,
      events: [
        event("tool_end", {
          tool_name: item.toolName,
          status: "failed",
          error_class: item.errorClass,
        }),
      ],
      verificationPass: false,
      traceId: `trace_oscillation_${String(index)}`,
      nowIso: `2026-04-25T00:01:0${String(index)}.000Z`,
    });
  }
  const oscillationGuarded = applyRuntimeToolSurfaceAdaptationGuard({
    baseContext: coding,
    result: adaptedContext,
    snapshot: readRuntimeToolSurfaceAdaptationState(oscillationWorkDir),
  });
  expectEqual(oscillationGuarded.guard.active, true, "failed A/B/A plus candidate B activates oscillation guard");
  expectEqual(oscillationGuarded.guard.reason, "profile_oscillation", "oscillation guard reason");
  expectDeepEqual(oscillationGuarded.guard.recentProfileSequence, ["browser", "context", "browser", "context"], "oscillation profile sequence");

  const recoveredOscillationWorkDir = join(adaptationWorkDir, "recovered-oscillation");
  mkdirSync(recoveredOscillationWorkDir, { recursive: true });
  for (const [index, item] of oscillationSequence.entries()) {
    recordRuntimeToolSurfaceAdaptationOutcome({
      workDir: recoveredOscillationWorkDir,
      adaptation: item.adaptation,
      events: [
        event("tool_end", {
          tool_name: item.toolName,
          status: "ok",
        }),
      ],
      verificationPass: true,
      traceId: `trace_recovered_oscillation_${String(index)}`,
      nowIso: `2026-04-25T00:02:0${String(index)}.000Z`,
    });
  }
  const recoveredOscillationGuarded = applyRuntimeToolSurfaceAdaptationGuard({
    baseContext: coding,
    result: adaptedContext,
    snapshot: readRuntimeToolSurfaceAdaptationState(recoveredOscillationWorkDir),
  });
  expectEqual(recoveredOscillationGuarded.guard.active, false, "recovered A/B/A does not activate oscillation guard");
  expectEqual(recoveredOscillationGuarded.adaptation.active, true, "successful alternation keeps candidate adaptation active");

  const inactiveWrite = recordRuntimeToolSurfaceAdaptationOutcome({
    workDir: adaptationWorkDir,
    adaptation: staleRecovery.adaptation,
    events: [],
    verificationPass: true,
  });
  expectEqual(inactiveWrite.recorded, false, "inactive adaptation not recorded");
} finally {
  rmSync(adaptationWorkDir, { recursive: true, force: true });
}

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
  web_scan_schema_code_profile: webScanSchemaCode.toolSurfaceProfile,
  web_scan_schema_suppressed_count: webScanSchemaCode.toolSurfaceDecision?.suppressed.length ?? 0,
  browser_schema_code_profile: browserSchemaCode.toolSurfaceProfile,
  browser_schema_suppressed_count: browserSchemaCode.toolSurfaceDecision?.suppressed.length ?? 0,
  mcp_tool_code_profile: mcpToolCode.toolSurfaceProfile,
  mcp_tool_code_suppressed_count: mcpToolCode.toolSurfaceDecision?.suppressed.length ?? 0,
  semantic_tool_code_profile: semanticToolCode.toolSurfaceProfile,
  semantic_tool_code_suppressed_count: semanticToolCode.toolSurfaceDecision?.suppressed.length ?? 0,
  direct_browser_tool_profile: directBrowserToolUse.toolSurfaceProfile,
  direct_browser_tool_suppressed_count: directBrowserToolUse.toolSurfaceDecision?.suppressed.length ?? 0,
  direct_mcp_tool_profile: directMcpToolUse.toolSurfaceProfile,
  direct_context_tool_profile: directContextToolUse.toolSurfaceProfile,
  adapted_browser_profile: adaptedBrowser.context?.toolSurfaceProfile,
  adapted_context_profile: adaptedContext.context?.toolSurfaceProfile,
  adapted_mcp_profile: adaptedMcp.context?.toolSurfaceProfile,
  code_symbol_recovery_adapted: codeSymbolRecovery.adaptation.active,
  direct_browser_recovery_profile: directBrowserRecovery.context?.toolSurfaceProfile,
  stale_recovery_adapted: staleRecovery.adaptation.active,
  adaptation_guard_recovered_signal_consumed: true,
  recovery_feedback_consumed_at_source: true,
  newer_recovery_bypasses_consumed_guard: true,
  adaptation_guard_prompt_suppresses_recovery_hint: true,
  adaptation_guard_repeated_failure: true,
  adaptation_guard_profile_oscillation: true,
  adaptation_guard_ignores_recovered_oscillation: true,
}) + "\n");
