import {
  buildToolSurfaceFingerprint,
  estimateToolSchemaTokens,
  TOOL_SURFACE_PROFILES,
} from "../../../tools/runtime/default-enabled-tools";
import {
  RUNTIME_TOOL_SURFACE_BUDGET_POLICY_VERSION,
  RUNTIME_TOOL_SURFACE_BUDGETS,
  validateRuntimeToolSurfaceBudget,
} from "../../../tools/runtime/tool-surface-budget";
import {
  parseRuntimeToolMessageBudgetProfilesWithDiagnostics,
  RUNTIME_TOOL_MESSAGE_BUDGETS,
  RUNTIME_TOOL_OUTPUT_BUDGET_POLICY_VERSION,
  validateRuntimeToolMessageBudgetProfilesAgainstPolicy,
} from "../../../tools/runtime/tool-output-budget";
import {
  buildRuntimeToolSurfaceSchemaProfilesFingerprint,
  parseRuntimeToolSurfaceSchemaProfiles,
  parseRuntimeToolSurfaceSchemaProfilesWithDiagnostics,
} from "../../../cli/runtime-health";
import { validRuntimeSchemaProfile } from "./fixtures";
import {
  build,
  expect,
  expectDeepEqual,
  expectEqual,
  expectProjectionWithinBudget,
  projection,
  withEnvProfile,
} from "./helpers";

export function runBudgetAndSchemaContract(): void {
  expectEqual(RUNTIME_TOOL_SURFACE_BUDGET_POLICY_VERSION, "v1", "runtime tool surface budget policy version");
  expectEqual(RUNTIME_TOOL_OUTPUT_BUDGET_POLICY_VERSION, "v1", "runtime tool output budget policy version");
  const syntheticBudgetViolation = validateRuntimeToolSurfaceBudget({
    profile: "browser",
    projectionMode: "slim",
    visibleToolCount: 5,
    schemaPropertyCount: 17,
    fullSchemaPropertyCount: 48,
    suppressedSchemaPropertyCount: 32,
    schemaEstimatedTokens: 561,
  });
  expect(!syntheticBudgetViolation.ok, "synthetic budget violation should fail");
  expect(
    syntheticBudgetViolation.violationDetails.some((detail) =>
      detail.metric === "schema_estimated_tokens" && detail.actual === 561 && detail.max === 560),
    "synthetic budget violation should expose structured token limit detail",
  );
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

  const coding = withEnvProfile(undefined, () => build(undefined));
  const codingProjection = projection(coding);
  expectEqual(codingProjection.source, "gateway.fallback", "coding projection source");
  expectEqual(coding.schemaFingerprint, codingProjection.schemaFingerprint, "coding context/projection fingerprint");
  expectEqual(codingProjection.projectionMode, "slim", "coding projection mode");
  expectEqual(codingProjection.visibleToolCount, 7, "coding projection visible tool count");
  expectEqual(codingProjection.dispatchEnabledToolCount, 7, "coding projection dispatch tool count");
  expectEqual(codingProjection.schemaPropertyCount, 27, "coding projection schema property count");
  expectEqual(codingProjection.fullSchemaPropertyCount, 30, "coding projection full property count");
  expectEqual(codingProjection.suppressedSchemaPropertyCount, 3, "coding projection suppressed property count");
  expectProjectionWithinBudget(coding, "coding projection budget");
  expectDeepEqual(
    codingProjection.perToolVisibleArgs?.ask_user,
    ["questions"],
    "coding projection exposes slim ask_user arg names",
  );

  const minimal = withEnvProfile("minimal", () => build("普通 coding task"));
  const minimalProjection = projection(minimal);
  expectEqual(minimal.schemaFingerprint, minimalProjection.schemaFingerprint, "minimal context/projection fingerprint");
  expectEqual(minimalProjection.projectionMode, "slim", "minimal projection mode");
  expectEqual(minimalProjection.schemaPropertyCount, 9, "minimal projection schema property count");
  expectEqual(minimalProjection.suppressedSchemaPropertyCount, 6, "minimal suppressed property count");
  expectProjectionWithinBudget(minimal, "minimal projection budget");
  expectDeepEqual(
    minimalProjection.perToolVisibleArgs?.read,
    ["include_metadata", "limit", "offset", "path"],
    "minimal projection exposes slim read arg names",
  );
  expect(
    buildToolSurfaceFingerprint("minimal", ["read"], { advancedToolSchema: false })
      !== buildToolSurfaceFingerprint("minimal", ["read"], { advancedToolSchema: true }),
    "schema fingerprint changes when only read projected args change",
  );

  const browser = withEnvProfile(undefined, () => build("打开浏览器页面，扫描 DOM"));
  const browserProjection = projection(browser);
  expectEqual(browserProjection.source, "gateway.fallback", "browser projection source");
  expectEqual(browser.schemaFingerprint, browserProjection.schemaFingerprint, "browser context/projection fingerprint");
  expectEqual(browserProjection.projectionMode, "slim", "browser projection mode");
  expectEqual(browserProjection.schemaPropertyCount, 16, "browser projection schema property count");
  expectEqual(browserProjection.fullSchemaPropertyCount, 47, "browser projection full property count");
  expectEqual(browserProjection.suppressedSchemaPropertyCount, 31, "browser projection suppressed property count");
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

  const browserAdvanced = withEnvProfile(undefined, () => build("用 remote CDP devtools 调试当前页面"));
  const browserAdvancedProjection = projection(browserAdvanced);
  expectEqual(browserAdvancedProjection.source, "gateway.fallback", "browser advanced projection source");
  expectEqual(
    browserAdvanced.schemaFingerprint,
    browserAdvancedProjection.schemaFingerprint,
    "browser advanced context/projection fingerprint",
  );
  expect(
    browserProjection.schemaFingerprint !== browserAdvancedProjection.schemaFingerprint,
    "schema fingerprint distinguishes slim and advanced browser projections with the same visible tools",
  );
  expect(
    buildToolSurfaceFingerprint("browser", browser.modelVisibleTools ?? [], { advancedToolSchema: false })
      !== buildToolSurfaceFingerprint("browser", browser.modelVisibleTools ?? [], { advancedToolSchema: true }),
    "schema fingerprint changes when only projected args change",
  );
  expectEqual(browserAdvancedProjection.projectionMode, "advanced", "browser advanced projection mode");
  expectEqual(browserAdvancedProjection.schemaPropertyCount, 39, "browser advanced projection schema property count");
  expectEqual(browserAdvancedProjection.fullSchemaPropertyCount, 47, "browser advanced projection full property count");
  expectEqual(browserAdvancedProjection.suppressedSchemaPropertyCount, 8, "browser advanced projection suppressed property count");
  expectProjectionWithinBudget(browserAdvanced, "browser advanced projection budget");

  const context = withEnvProfile(undefined, () => build("用记忆和语义上下文找相关经验"));
  const contextProjection = projection(context);
  expectEqual(context.schemaFingerprint, contextProjection.schemaFingerprint, "context context/projection fingerprint");
  expectEqual(contextProjection.schemaPropertyCount, 10, "context projection schema property count");
  expectEqual(contextProjection.suppressedSchemaPropertyCount, 10, "context projection suppressed property count");
  expectProjectionWithinBudget(context, "context projection budget");
  expectDeepEqual(
    contextProjection.perToolVisibleArgs?.semantic_search,
    ["include_org", "max_segments", "per_source_limit", "query", "sources"],
    "context projection exposes slim semantic_search arg names",
  );
  expectDeepEqual(
    contextProjection.perToolSuppressedArgs?.semantic_search,
    ["bridge_script", "refresh", "technical_terms", "timeout_ms"],
    "context projection suppresses semantic_search debug/cache args",
  );

  const mcp = withEnvProfile(undefined, () => build("通过 MCP grok-search 查资料"));
  const mcpProjection = projection(mcp);
  expectEqual(mcpProjection.schemaPropertyCount, 5, "mcp projection schema property count");
  expectEqual(mcpProjection.suppressedSchemaPropertyCount, 4, "mcp projection suppressed property count");
  expectProjectionWithinBudget(mcp, "mcp projection budget");
  expectDeepEqual(
    mcpProjection.perToolVisibleArgs?.mcp_servers,
    ["ready_only"],
    "mcp projection exposes slim mcp_servers arg names",
  );
  expectDeepEqual(
    mcpProjection.perToolSuppressedArgs?.mcp_servers,
    ["include_disabled"],
    "mcp projection suppresses disabled-server inventory arg",
  );

  const fullDebug = withEnvProfile("full_debug", () => build("普通 coding task"));
  const fullDebugProjection = projection(fullDebug);
  expectEqual(fullDebugProjection.source, "gateway.fallback", "full_debug projection source");
  expectEqual(fullDebugProjection.projectionMode, "full", "full_debug projection mode");
  expectEqual(fullDebugProjection.schemaPropertyCount, 92, "full_debug projection schema property count");
  expectEqual(fullDebugProjection.suppressedSchemaPropertyCount, 0, "full_debug suppressed property count");
  expectProjectionWithinBudget(fullDebug, "full_debug projection budget");

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
}
