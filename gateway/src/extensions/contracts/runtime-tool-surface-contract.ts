import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  adaptRuntimeToolContextForRecovery,
  buildRuntimeToolContextForMessage,
  buildRuntimeToolSurfaceProjectionSummary,
  buildToolSurfaceFingerprint,
  estimateToolSchemaTokens,
  TOOL_SURFACE_PROFILES,
  TOOL_SURFACE_POLICY_VERSION,
} from "../../tools/runtime/default-enabled-tools";
import {
  RUNTIME_TOOL_SURFACE_BUDGET_POLICY_VERSION,
  RUNTIME_TOOL_SURFACE_BUDGETS,
  validateRuntimeToolSurfaceBudget,
} from "../../tools/runtime/tool-surface-budget";
import {
  parseRuntimeToolMessageBudgetProfilesWithDiagnostics,
  RUNTIME_TOOL_MESSAGE_BUDGETS,
  RUNTIME_TOOL_OUTPUT_BUDGET_POLICY_VERSION,
  validateRuntimeToolMessageBudgetProfilesAgainstPolicy,
} from "../../tools/runtime/tool-output-budget";
import { RUNTIME_TOOL_SURFACE_ROUTING_EVALS } from "../../tools/runtime/tool-surface-routing-evals";
import type { RuntimeEvent, RuntimeToolContext } from "../../models/types";
import type { RuntimeToolRecoveryFeedback } from "../../tools/runtime/tool-events";
import {
  applyRuntimeToolRecoveryConsumption,
  applyRuntimeToolSurfaceAdaptationGuard,
  buildRuntimeToolSurfaceAdaptationGuardPrompt,
  readRuntimeToolSurfaceAdaptationState,
  recordRuntimeToolNonRecoverableInterventionPrompt,
  recordRuntimeToolSurfaceAdaptationOutcome,
  recordRuntimeToolSurfaceRecoveryConsumption,
} from "../../tools/runtime/tool-surface-adaptation-state";
import {
  buildRuntimeToolRecoveryCatalogFingerprint,
  buildRuntimeToolSurfaceSchemaProfilesFingerprint,
  parseRuntimeToolSurfaceSchemaProfiles,
  parseRuntimeToolSurfaceSchemaProfilesWithDiagnostics,
  runRuntimeToolsDescribe,
} from "../../orchestration/entrypoints/dev-cli/runtime-health";
import {
  normalizeRuntimeToolsDescribeDetail,
  resolveRuntimeToolDescribeDecision,
} from "../../orchestration/entrypoints/dev-cli/services/runtime-tool-describe-decision";
import { buildRuntimeToolRecoveryReadinessGate } from "../../tools/runtime/tool-recovery-readiness-gate";

const baseContext = {
  workDir: "/tmp/grobot-runtime-tool-surface-contract",
  enabledTools: ["glob", "search", "read", "write", "edit", "bash", "ask_user"],
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

function expectProjectionWithinBudget(
  context: RuntimeToolContext,
  message: string,
): void {
  const summary = projection(context);
  const validation = validateRuntimeToolSurfaceBudget(summary);
  expect(
    validation.ok,
    `${message}: schema budget violations=${validation.violations.join(",")}`,
  );
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
    recoverable: input.recoverable === undefined ? true : input.recoverable,
    requiresUserIntervention: input.recoverable === false,
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
  requiresUserIntervention: false,
  promptBlock: "",
};

expectEqual(RUNTIME_TOOL_SURFACE_BUDGET_POLICY_VERSION, "v1", "runtime tool surface budget policy version");
expectEqual(RUNTIME_TOOL_OUTPUT_BUDGET_POLICY_VERSION, "v1", "runtime tool output budget policy version");
expectDeepEqual(
  Object.keys(RUNTIME_TOOL_SURFACE_BUDGETS).sort(),
  [...TOOL_SURFACE_PROFILES].sort(),
  "runtime tool surface budgets cover every profile",
);
expectDeepEqual(
  RUNTIME_TOOL_MESSAGE_BUDGETS,
  {
    "*": 80_000,
    mcp_call: 48_000,
    web_scan: 48_000,
    web_execute_js: 48_000,
  },
  "runtime tool message budgets are fixed by contract",
);

const validToolMessageBudgetProfiles = Object.entries(RUNTIME_TOOL_MESSAGE_BUDGETS).map(
  ([toolName, maxChars]) => ({
    tool_name: toolName,
    max_chars: maxChars,
    applies_to: "model_tool_message_content",
  }),
);
const parsedToolMessageBudgets =
  parseRuntimeToolMessageBudgetProfilesWithDiagnostics(validToolMessageBudgetProfiles);
expectEqual(parsedToolMessageBudgets.invalidReason, null, "tool message budget profiles parse");
expectEqual(parsedToolMessageBudgets.profiles.length, 4, "tool message budget profile count");
expectEqual(
  validateRuntimeToolMessageBudgetProfilesAgainstPolicy(parsedToolMessageBudgets.profiles),
  null,
  "tool message budget profiles validate",
);
expectEqual(
  parseRuntimeToolMessageBudgetProfilesWithDiagnostics([
    ...validToolMessageBudgetProfiles,
    { tool_name: "web_scan", max_chars: 48_000, applies_to: "model_tool_message_content" },
  ]).invalidReason,
  "tool_message_budget_profiles_invalid_rows:1",
  "duplicate tool message budget profiles are invalid",
);
expect(
  validateRuntimeToolMessageBudgetProfilesAgainstPolicy([
    ...parsedToolMessageBudgets.profiles.filter((row) => row.toolName !== "web_scan"),
    { toolName: "web_scan", maxChars: 64_000, appliesTo: "model_tool_message_content" },
  ])?.startsWith("tool_message_budget_profiles_max_chars_mismatch:web_scan:")
    === true,
  "tool message budget mismatch is invalid",
);

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
expectProjectionWithinBudget(coding, "coding projection budget");

const minimal = withEnvProfile("minimal", () => build("普通 coding task"));
expectEqual(minimal.toolSurfaceProfile, "minimal", "minimal profile");
expectEqual(minimal.toolSurfaceSource, "env", "minimal source");
expectDeepEqual(minimal.modelVisibleTools, ["read", "edit", "write", "ask_user"], "minimal visible tools");
const minimalProjection = projection(minimal);
expectEqual(minimalProjection.projectionMode, "slim", "minimal projection mode");
expectEqual(minimalProjection.schemaPropertyCount, 12, "minimal projection schema property count");
expectEqual(minimalProjection.suppressedSchemaPropertyCount, 3, "minimal suppressed property count");
expectProjectionWithinBudget(minimal, "minimal projection budget");
expectDeepEqual(
  minimalProjection.perToolVisibleArgs?.read,
  ["include_metadata", "limit", "offset", "path"],
  "minimal projection exposes slim read arg names",
);

const browser = withEnvProfile(undefined, () => build("打开浏览器页面，扫描 DOM"));
expectEqual(browser.toolSurfaceProfile, "browser", "browser profile");
expectDecisionProfile(browser, "browser", "browser profile decision");
expectDeepEqual(browser.modelVisibleTools, ["web_scan", "web_execute_js", "read", "ask_user"], "browser visible tools");
expectDeepEqual(browser.enabledTools, browser.modelVisibleTools, "browser dispatch tools");
expectEqual(browser.advancedToolSchema, false, "browser slim schema");
const browserProjection = projection(browser);
expectEqual(browserProjection.source, "gateway.fallback", "browser projection source");
expectEqual(browserProjection.projectionMode, "slim", "browser projection mode");
expectEqual(browserProjection.schemaPropertyCount, 19, "browser projection schema property count");
expectEqual(browserProjection.fullSchemaPropertyCount, 47, "browser projection full property count");
expectEqual(browserProjection.suppressedSchemaPropertyCount, 28, "browser projection suppressed property count");
expectProjectionWithinBudget(browser, "browser projection budget");
expectDeepEqual(
  browserProjection.perToolVisibleArgs?.read,
  ["include_metadata", "limit", "offset", "path"],
  "browser projection exposes slim read arg names",
);
expectDeepEqual(
  browserProjection.perToolVisibleArgs?.web_scan,
  ["main_only", "max_chars", "session_id", "switch_tab_id", "tabs_only"],
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
    "session_url_pattern",
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
const validRuntimeRecoveryCatalog = [
  {
    error_classes: ["tool_argument_not_visible"],
    risk_class: "*",
    stage: "strategy_switch",
    recommended_next_action: "inspect_visible_tool_schema_then_retry",
    recoverable: true,
  },
  {
    error_classes: ["config_missing"],
    risk_class: "*",
    stage: "ask_user",
    recommended_next_action: "ask_user_for_config_or_switch_provider",
    recoverable: false,
  },
  {
    error_classes: ["*"],
    risk_class: "*",
    stage: "strategy_switch",
    recommended_next_action: "inspect_error_and_switch_strategy",
    recoverable: true,
  },
];
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
    full_schema_property_count: 6,
  }]).length,
  0,
  "runtime schema profile parser rejects inconsistent full schema counts",
);
expectEqual(
  parseRuntimeToolSurfaceSchemaProfiles([{
    ...validRuntimeSchemaProfile,
    per_tool_suppressed_args: {
      web_scan: ["main_only"],
      web_execute_js: ["native_fallback_action"],
    },
  }]).length,
  0,
  "runtime schema profile parser rejects overlapping visible and suppressed args",
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
      tool_recovery_policy_version: "v1",
      tool_recovery_actions: [
        "inspect_visible_tool_schema_then_retry",
        "ask_user_for_config_or_switch_provider",
        "inspect_error_and_switch_strategy",
      ],
      tool_recovery_catalog_fingerprint: buildRuntimeToolRecoveryCatalogFingerprint(validRuntimeRecoveryCatalog),
      tool_recovery_catalog: validRuntimeRecoveryCatalog,
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
expectEqual(
  normalizeRuntimeToolsDescribeDetail("spawn_failed: missing"),
  "runtime_tools_describe_unavailable:spawn_failed: missing",
  "runtime tools describe detail normalizes generic failures",
);
expectEqual(
  normalizeRuntimeToolsDescribeDetail(mismatchedRuntimeDescribe.detail),
  mismatchedRuntimeDescribe.detail,
  "runtime tools describe detail preserves machine-readable describe failures",
);
const notRunDescribeDecision = resolveRuntimeToolDescribeDecision({ runtimeBinaryPath: null });
expectEqual(notRunDescribeDecision.enabledToolsSource, "start-default", "not-run describe decision falls back");
expectEqual(
  notRunDescribeDecision.enabledToolsSourceDetail,
  "runtime_tools_describe_unavailable:not_run",
  "not-run describe decision is observable",
);
expectEqual(
  notRunDescribeDecision.schemaProfilesFingerprint,
  null,
  "not-run describe decision omits schema profile fingerprint",
);
const invalidDescribeDecision = resolveRuntimeToolDescribeDecision({ runtimeBinaryPath: fakeRuntimePath });
expectEqual(invalidDescribeDecision.enabledToolsSource, "start-default", "invalid describe decision falls back");
expect(
  invalidDescribeDecision.enabledToolsSourceDetail?.startsWith("runtime_tools_describe_schema_profiles_fingerprint_mismatch:")
    === true,
  "invalid describe decision exposes exact invalid describe reason",
);

const fakeRecoveryMismatchPath = join(fakeRuntimeDir, "runtime-recovery-mismatch.js");
writeFileSync(
  fakeRecoveryMismatchPath,
  `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify({
    jsonrpc: "2.0",
    id: "tools-describe-1",
    result: {
      tools: [
        { type: "function", function: { name: "web_scan" } },
        { type: "function", function: { name: "web_execute_js" } },
      ],
      default_enabled_tools: ["web_scan"],
      tool_recovery_policy_version: "v1",
      tool_recovery_actions: [
        "inspect_visible_tool_schema_then_retry",
        "ask_user_for_config_or_switch_provider",
        "inspect_error_and_switch_strategy",
      ],
      tool_recovery_catalog_fingerprint: "recovery_catalog:00000000",
      tool_recovery_catalog: validRuntimeRecoveryCatalog,
      tool_surface_schema_profiles_fingerprint: buildRuntimeToolSurfaceSchemaProfilesFingerprint([validRuntimeSchemaProfile]),
      tool_surface_schema_profiles: [validRuntimeSchemaProfile],
    },
  }))});\n`,
  "utf8",
);
chmodSync(fakeRecoveryMismatchPath, 0o755);
const mismatchedRecoveryRuntimeDescribe = runRuntimeToolsDescribe(fakeRecoveryMismatchPath);
expectEqual(
  mismatchedRecoveryRuntimeDescribe.ok,
  false,
  "runtime tools describe rejects mismatched recovery catalog fingerprint",
);
expect(
  mismatchedRecoveryRuntimeDescribe.detail.startsWith("runtime_tools_describe_recovery_catalog_fingerprint_mismatch:"),
  "runtime tools describe reports recovery catalog fingerprint mismatch",
);

const fakeIncompleteSchemaProfilesPath = join(fakeRuntimeDir, "runtime-incomplete-schema-profiles.js");
writeFileSync(
  fakeIncompleteSchemaProfilesPath,
  `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify({
    jsonrpc: "2.0",
    id: "tools-describe-1",
    result: {
      tools: [
        { type: "function", function: { name: "web_scan" } },
        { type: "function", function: { name: "web_execute_js" } },
      ],
      default_enabled_tools: ["web_scan"],
      tool_recovery_policy_version: "v1",
      tool_recovery_actions: [
        "inspect_visible_tool_schema_then_retry",
        "ask_user_for_config_or_switch_provider",
        "inspect_error_and_switch_strategy",
      ],
      tool_recovery_catalog_fingerprint: buildRuntimeToolRecoveryCatalogFingerprint(validRuntimeRecoveryCatalog),
      tool_recovery_catalog: validRuntimeRecoveryCatalog,
      tool_surface_schema_profiles_fingerprint: buildRuntimeToolSurfaceSchemaProfilesFingerprint([validRuntimeSchemaProfile]),
      tool_surface_schema_profiles: [validRuntimeSchemaProfile],
    },
  }))});\n`,
  "utf8",
);
chmodSync(fakeIncompleteSchemaProfilesPath, 0o755);
const incompleteSchemaProfilesRuntimeDescribe = runRuntimeToolsDescribe(fakeIncompleteSchemaProfilesPath);
expectEqual(
  incompleteSchemaProfilesRuntimeDescribe.ok,
  false,
  "runtime tools describe rejects incomplete schema profile set",
);
expect(
  incompleteSchemaProfilesRuntimeDescribe.detail.includes(
    "runtime_tools_describe_invalid_schema_profiles:schema_profiles_missing_profiles:",
  ),
  "runtime tools describe reports missing schema profiles",
);

const browserAdvanced = withEnvProfile(undefined, () => build("用 remote CDP devtools 调试当前页面"));
expectEqual(browserAdvanced.toolSurfaceProfile, "browser_advanced", "browser advanced profile");
expectDecisionProfile(browserAdvanced, "browser_advanced", "browser advanced profile decision");
expectDeepEqual(browserAdvanced.modelVisibleTools, ["web_scan", "web_execute_js", "read", "ask_user"], "browser advanced visible tools");
expectEqual(browserAdvanced.advancedToolSchema, true, "browser advanced schema");
const browserAdvancedProjection = projection(browserAdvanced);
expectEqual(browserAdvancedProjection.source, "gateway.fallback", "browser advanced projection source");
expectEqual(browserAdvancedProjection.projectionMode, "advanced", "browser advanced projection mode");
expectEqual(browserAdvancedProjection.schemaPropertyCount, 42, "browser advanced projection schema property count");
expectEqual(browserAdvancedProjection.fullSchemaPropertyCount, 47, "browser advanced projection full property count");
expectEqual(browserAdvancedProjection.suppressedSchemaPropertyCount, 5, "browser advanced projection suppressed property count");
expectProjectionWithinBudget(browserAdvanced, "browser advanced projection budget");

const context = withEnvProfile(undefined, () => build("用记忆和语义上下文找相关经验"));
expectEqual(context.toolSurfaceProfile, "context", "context profile");
expectDecisionProfile(context, "context", "context profile decision");
expectDeepEqual(context.modelVisibleTools, ["semantic_search", "read", "ask_user"], "context visible tools");
expectDeepEqual(context.enabledTools, context.modelVisibleTools, "context dispatch tools");
const contextProjection = projection(context);
expectEqual(contextProjection.schemaPropertyCount, 17, "context projection schema property count");
expectEqual(contextProjection.suppressedSchemaPropertyCount, 3, "context projection suppressed property count");
expectProjectionWithinBudget(context, "context projection budget");

const mcp = withEnvProfile(undefined, () => build("通过 MCP grok-search 查资料"));
expectEqual(mcp.toolSurfaceProfile, "mcp", "mcp profile");
expectDecisionProfile(mcp, "mcp", "mcp profile decision");
expectDeepEqual(mcp.modelVisibleTools, ["mcp_servers", "mcp_call", "ask_user"], "mcp visible tools");
expectDeepEqual(mcp.enabledTools, mcp.modelVisibleTools, "mcp dispatch tools");
expectProjectionWithinBudget(mcp, "mcp projection budget");

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
expectProjectionWithinBudget(fullDebug, "full_debug projection budget");

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
expectDeepEqual(adaptedBrowser.context?.modelVisibleTools, ["web_scan", "web_execute_js", "read", "ask_user"], "browser recovery visible tools");

const nonRecoverableBrowserRecovery = adaptRuntimeToolContextForRecovery({
  context: coding,
  recoveryFeedback: activeRecoveryFeedback({
    toolName: "web_scan",
    errorClass: "config_missing",
    stage: "ask_user",
    recoverable: false,
  }),
});
expectEqual(nonRecoverableBrowserRecovery.adaptation.active, false, "nonrecoverable recovery does not adapt");
expectEqual(
  nonRecoverableBrowserRecovery.adaptation.reason,
  "recovery_requires_user_intervention",
  "nonrecoverable recovery reason",
);
expectEqual(
  nonRecoverableBrowserRecovery.adaptation.autoAdaptationBlocked,
  true,
  "nonrecoverable recovery blocks automatic adaptation",
);
expectEqual(
  nonRecoverableBrowserRecovery.adaptation.recoveryRecoverable,
  false,
  "nonrecoverable recovery observable",
);
expectEqual(
  nonRecoverableBrowserRecovery.context?.toolSurfaceProfile,
  "coding",
  "nonrecoverable recovery keeps coding profile",
);

const unknownRecoverabilityBrowserRecovery = adaptRuntimeToolContextForRecovery({
  context: coding,
  recoveryFeedback: activeRecoveryFeedback({
    toolName: "web_scan",
    errorClass: "tool_not_visible",
    recoverable: null,
  }),
});
expectEqual(
  unknownRecoverabilityBrowserRecovery.adaptation.active,
  true,
  "unknown recoverability preserves legacy recovery adaptation",
);
expectEqual(
  unknownRecoverabilityBrowserRecovery.adaptation.autoAdaptationBlocked,
  false,
  "unknown recoverability does not block automatic adaptation",
);
expectEqual(
  unknownRecoverabilityBrowserRecovery.adaptation.recoveryRecoverable,
  null,
  "unknown recoverability remains observable",
);
expectEqual(
  unknownRecoverabilityBrowserRecovery.context?.toolSurfaceProfile,
  "browser",
  "unknown recoverability can still adapt browser profile",
);

const gateBlockedBrowserRecovery = adaptRuntimeToolContextForRecovery({
  context: coding,
  recoveryFeedback: activeRecoveryFeedback({
    toolName: "web_scan",
    errorClass: "tool_not_visible",
    recoverable: true,
  }),
  recoveryGate: buildRuntimeToolRecoveryReadinessGate({
    readiness: {
      status: "degraded",
      ready: false,
      automaticRecoveryAllowed: false,
      operatorActionRequired: false,
      reason: "health_watch:policy_denied_recovery",
      recommendedNextAction: "inspect_runtime_tool_recovery_policy",
      policyVersion: "v1",
      healthLevel: "watch",
      healthScore: 94,
      riskScoreThreshold: 70,
      watchScoreThreshold: 95,
      attentionRecoveryKey: "strategy_switch:web_scan:tool_not_visible:2026-04-25T00:00:00.000Z",
      attentionSource: "latest",
      attentionStage: "strategy_switch",
      attentionToolName: "web_scan",
      attentionErrorClass: "tool_not_visible",
      attentionRequiresUserIntervention: false,
      attentionRuntimeEnvironmentRecovery: null,
      attentionBrowserEnvironmentRecovery: null,
      attentionMcpEnvironmentRecovery: null,
    },
  }),
});
expectEqual(gateBlockedBrowserRecovery.adaptation.active, false, "gate fail blocks surface adaptation");
expectEqual(
  gateBlockedBrowserRecovery.adaptation.reason,
  "recovery_gate_automatic_recovery_denied",
  "gate fail adaptation reason",
);
expectEqual(
  gateBlockedBrowserRecovery.adaptation.autoAdaptationBlocked,
  true,
  "gate fail marks automatic adaptation blocked",
);
expectEqual(gateBlockedBrowserRecovery.context?.toolSurfaceProfile, "coding", "gate fail keeps coding profile");

const adaptedContext = adaptRuntimeToolContextForRecovery({
  context: coding,
  recoveryFeedback: activeRecoveryFeedback({
    toolName: "semantic_search",
    errorClass: "tool_not_visible",
  }),
});
expectEqual(adaptedContext.adaptation.active, true, "context recovery adaptation active");
expectEqual(adaptedContext.context?.toolSurfaceProfile, "context", "context recovery adapts profile");
expectDeepEqual(adaptedContext.context?.modelVisibleTools, ["semantic_search", "read", "ask_user"], "context recovery visible tools");

const adaptedMcp = adaptRuntimeToolContextForRecovery({
  context: coding,
  recoveryFeedback: activeRecoveryFeedback({
    toolName: "mcp_call",
    errorClass: "tool_disabled",
  }),
});
expectEqual(adaptedMcp.adaptation.active, true, "mcp recovery adaptation active");
expectEqual(adaptedMcp.context?.toolSurfaceProfile, "mcp", "mcp recovery adapts profile");
expectDeepEqual(adaptedMcp.context?.modelVisibleTools, ["mcp_servers", "mcp_call", "ask_user"], "mcp recovery visible tools");

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

  const nonrecoverableConsumptionWorkDir = join(adaptationWorkDir, "nonrecoverable-consumption");
  mkdirSync(nonrecoverableConsumptionWorkDir, { recursive: true });
  const nonrecoverableObservedAt = "2026-04-25T00:00:10.000Z";
  const nonrecoverableFeedback = activeRecoveryFeedback({
    toolName: "web_scan",
    errorClass: "config_missing",
    stage: "ask_user",
    observedAt: nonrecoverableObservedAt,
    recoverable: false,
  });
  const nonrecoverableConsumption = recordRuntimeToolNonRecoverableInterventionPrompt({
    workDir: nonrecoverableConsumptionWorkDir,
    recoveryFeedback: nonrecoverableFeedback,
    traceId: "trace_nonrecoverable_prompted",
    nowIso: "2026-04-25T00:00:11.000Z",
  });
  expectEqual(nonrecoverableConsumption.recorded, true, "nonrecoverable intervention prompt consumption recorded");
  expectEqual(
    nonrecoverableConsumption.record?.reason,
    "nonrecoverable_intervention_prompted",
    "nonrecoverable intervention consumption reason",
  );
  expectEqual(
    nonrecoverableConsumption.snapshot.latestRecoveryConsumption?.reason,
    "nonrecoverable_intervention_prompted",
    "nonrecoverable intervention latest consumption reason",
  );
  const duplicateNonrecoverableConsumption = recordRuntimeToolNonRecoverableInterventionPrompt({
    workDir: nonrecoverableConsumptionWorkDir,
    recoveryFeedback: nonrecoverableFeedback,
    traceId: "trace_nonrecoverable_prompted_duplicate",
    nowIso: "2026-04-25T00:00:12.000Z",
  });
  expectEqual(duplicateNonrecoverableConsumption.recorded, false, "nonrecoverable intervention prompt is deduped");
  const consumedNonrecoverableFeedback = applyRuntimeToolRecoveryConsumption({
    feedback: {
      ...nonrecoverableFeedback,
      observedAt: "2026-04-25T00:00:10.500Z",
    },
    snapshot: nonrecoverableConsumption.snapshot,
  });
  expectEqual(consumedNonrecoverableFeedback.active, false, "nonrecoverable consumption suppresses same prompt");
  expectEqual(consumedNonrecoverableFeedback.consumed, true, "nonrecoverable consumption marks feedback consumed");
  expectEqual(
    consumedNonrecoverableFeedback.consumedReason,
    "nonrecoverable_intervention_prompted",
    "nonrecoverable consumed feedback reason",
  );
  const newerNonrecoverableFeedback = applyRuntimeToolRecoveryConsumption({
    feedback: {
      ...nonrecoverableFeedback,
      observedAt: "2026-04-25T00:00:12.000Z",
    },
    snapshot: nonrecoverableConsumption.snapshot,
  });
  expectEqual(newerNonrecoverableFeedback.active, true, "newer nonrecoverable recovery remains active");

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
  routing_eval_count: RUNTIME_TOOL_SURFACE_ROUTING_EVALS.length,
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
  nonrecoverable_blocks_auto_adaptation: nonRecoverableBrowserRecovery.adaptation.autoAdaptationBlocked,
  gate_blocks_surface_adaptation: gateBlockedBrowserRecovery.adaptation.autoAdaptationBlocked,
  gate_blocked_surface_adaptation_reason: gateBlockedBrowserRecovery.adaptation.reason,
  nonrecoverable_intervention_consumed: true,
  newer_nonrecoverable_intervention_remains_active: true,
  adaptation_guard_recovered_signal_consumed: true,
  recovery_feedback_consumed_at_source: true,
  newer_recovery_bypasses_consumed_guard: true,
  adaptation_guard_prompt_suppresses_recovery_hint: true,
  adaptation_guard_repeated_failure: true,
  adaptation_guard_profile_oscillation: true,
  adaptation_guard_ignores_recovered_oscillation: true,
}) + "\n");
