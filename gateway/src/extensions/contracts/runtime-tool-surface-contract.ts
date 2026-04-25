import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  adaptRuntimeToolContextForRecovery,
  buildRuntimeToolContextForMessage,
  buildToolSurfaceFingerprint,
  estimateToolSchemaTokens,
  TOOL_SURFACE_POLICY_VERSION,
} from "../../tools/runtime/default-enabled-tools";
import type { RuntimeEvent, RuntimeToolContext } from "../../models/types";
import type { RuntimeToolRecoveryFeedback } from "../../tools/runtime/tool-events";
import {
  applyRuntimeToolSurfaceAdaptationGuard,
  readRuntimeToolSurfaceAdaptationState,
  recordRuntimeToolSurfaceAdaptationOutcome,
} from "../../tools/runtime/tool-surface-adaptation-state";

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

function activeRecoveryFeedback(input: {
  toolName: string;
  errorClass: string;
  stage?: RuntimeToolRecoveryFeedback["stage"];
}): RuntimeToolRecoveryFeedback {
  return {
    active: true,
    severity: "warning",
    reason: "recent_recovery",
    stage: input.stage ?? "strategy_switch",
    toolName: input.toolName,
    errorClass: input.errorClass,
    recommendedNextAction: "switch_tool_strategy",
    promptBlock: "recovery prompt",
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
  promptBlock: "",
};

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
  adapted_browser_profile: adaptedBrowser.context?.toolSurfaceProfile,
  adapted_context_profile: adaptedContext.context?.toolSurfaceProfile,
  adapted_mcp_profile: adaptedMcp.context?.toolSurfaceProfile,
  stale_recovery_adapted: staleRecovery.adaptation.active,
  adaptation_guard_repeated_failure: true,
  adaptation_guard_profile_oscillation: true,
  adaptation_guard_ignores_recovered_oscillation: true,
}) + "\n");
