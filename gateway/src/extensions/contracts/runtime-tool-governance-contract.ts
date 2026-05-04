import {
  buildToolsManifestFingerprint,
  resolveRuntimeBinaryPath,
  runRuntimeToolsDescribe,
} from "../../cli/runtime-health";
import {
  buildAllRuntimeLocalTools,
  buildDefaultRuntimeEnabledTools,
  estimateToolSchemaTokens,
} from "../../tools/runtime/default-enabled-tools";
import { knownRuntimeToolRecoveryActions } from "../../tools/runtime/tool-events";
import {
  RUNTIME_TOOL_SURFACE_BUDGET_POLICY_VERSION,
  RUNTIME_TOOL_SURFACE_BUDGETS,
  validateRuntimeToolSurfaceBudget,
} from "../../tools/runtime/tool-surface-budget";

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

function sorted(items: readonly string[]): string[] {
  return [...items].sort();
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

function firstOrderMismatch(left: readonly string[], right: readonly string[]): {
  index: number;
  runtime: string | null;
  gateway: string | null;
} | null {
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    if (left[index] !== right[index]) {
      return {
        index,
        runtime: left[index] ?? null,
        gateway: right[index] ?? null,
      };
    }
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const describe = runRuntimeToolsDescribe(resolveRuntimeBinaryPath());
const gatewayToolNames = buildAllRuntimeLocalTools();
const gatewayDefaultEnabledTools = buildDefaultRuntimeEnabledTools();
const gatewayToolManifestFingerprint = buildToolsManifestFingerprint(
  gatewayToolNames,
  gatewayDefaultEnabledTools,
);
const runtimeOnlyTools = difference(describe.toolNames, gatewayToolNames);
const gatewayOnlyTools = difference(gatewayToolNames, describe.toolNames);
const runtimeDefaultOnlyTools = difference(describe.defaultEnabledTools, gatewayDefaultEnabledTools);
const gatewayDefaultOnlyTools = difference(gatewayDefaultEnabledTools, describe.defaultEnabledTools);
const runtimeToolOrderMismatch = firstOrderMismatch(describe.toolNames, gatewayToolNames);
const runtimeDefaultOrderMismatch = firstOrderMismatch(describe.defaultEnabledTools, gatewayDefaultEnabledTools);

const gatewayActions = sorted(knownRuntimeToolRecoveryActions());
const runtimeActions = sorted(describe.toolRecoveryActions);
const runtimeOnlyActions = difference(runtimeActions, gatewayActions);
const gatewayOnlyActions = difference(gatewayActions, runtimeActions);

let runtimeSchemaBudgetViolationCount: number | null = null;
let runtimeSchemaBudgetViolationProfiles: string[] = [];
let runtimeSchemaProfileSummary: Record<string, unknown>[] = [];
let runtimeSchemaBudgetViolationDetails: Record<string, unknown>[] = [];

function governancePayload(ok: boolean, failure: string | null): Record<string, unknown> {
  return {
    ok,
    failure,
    runtime_tool_manifest_match: runtimeOnlyTools.length === 0 && gatewayOnlyTools.length === 0,
    runtime_tool_manifest_order_match: runtimeToolOrderMismatch == null,
    runtime_default_manifest_match:
      runtimeDefaultOnlyTools.length === 0 && gatewayDefaultOnlyTools.length === 0,
    runtime_default_manifest_order_match: runtimeDefaultOrderMismatch == null,
    runtime_tool_count: describe.toolNames.length,
    gateway_tool_count: gatewayToolNames.length,
    runtime_default_enabled_count: describe.defaultEnabledTools.length,
    gateway_default_enabled_count: gatewayDefaultEnabledTools.length,
    runtime_tool_manifest_fingerprint: describe.manifestFingerprint,
    gateway_tool_manifest_fingerprint: gatewayToolManifestFingerprint,
    runtime_only_tools: runtimeOnlyTools,
    gateway_only_tools: gatewayOnlyTools,
    runtime_default_only_tools: runtimeDefaultOnlyTools,
    gateway_default_only_tools: gatewayDefaultOnlyTools,
    runtime_tool_order_mismatch: runtimeToolOrderMismatch,
    runtime_default_order_mismatch: runtimeDefaultOrderMismatch,
    runtime_recovery_action_count: describe.toolRecoveryActions.length,
    runtime_only_recovery_actions: runtimeOnlyActions,
    gateway_only_recovery_actions: gatewayOnlyActions,
    runtime_recovery_catalog_rows: describe.toolRecoveryCatalog.length,
    runtime_schema_profile_count: describe.toolSurfaceSchemaProfiles.length,
    runtime_schema_profile_summary: runtimeSchemaProfileSummary,
    runtime_schema_budget_violations: runtimeSchemaBudgetViolationCount,
    runtime_schema_budget_violation_profiles: runtimeSchemaBudgetViolationProfiles,
    runtime_schema_budget_violation_details: runtimeSchemaBudgetViolationDetails,
  };
}

try {
  expectEqual(describe.ok, true, `runtime.tools.describe ok (${describe.detail})`);
  expectEqual(
    JSON.stringify(describe.toolNames),
    JSON.stringify(gatewayToolNames),
    "runtime.tools.describe tools must match gateway local tool manifest order",
  );
  expectEqual(
    JSON.stringify(describe.defaultEnabledTools),
    JSON.stringify(gatewayDefaultEnabledTools),
    "runtime.tools.describe default_enabled_tools must match gateway default manifest order",
  );
  expectEqual(describe.toolRecoveryPolicyVersion, "v1", "runtime recovery policy version");
  expect(
    typeof describe.toolRecoveryCatalogFingerprint === "string"
      && describe.toolRecoveryCatalogFingerprint.startsWith("recovery_catalog:"),
    "runtime recovery catalog fingerprint is exposed",
  );
  expect(describe.toolRecoveryCatalog.length > 0, "runtime recovery catalog is non-empty");
  expect(describe.toolRecoveryActions.length > 0, "runtime recovery actions are non-empty");
  expect(!describe.toolRecoveryActions.includes("observe_and_continue"), "legacy recovery action is absent");

  expectEqual(JSON.stringify(runtimeOnlyActions), "[]", "runtime recovery actions are known by gateway");
  expectEqual(
    JSON.stringify(gatewayOnlyActions),
    JSON.stringify(["fix_mcp_tool_arguments"]),
    "only contextual gateway MCP refinements may be absent from runtime base catalog",
  );

  const configMissingRow = describe.toolRecoveryCatalog.find((row) =>
    row.errorClasses.length === 1
    && row.errorClasses[0] === "config_missing"
    && row.recommendedNextAction === "ask_user_for_config_or_switch_provider");
  expect(Boolean(configMissingRow), "config_missing recovery row exists");
  expectEqual(configMissingRow?.stage, "ask_user", "config_missing recovery stage");
  expectEqual(configMissingRow?.recoverable, false, "config_missing recovery recoverable");

  const unknownRiskRow = describe.toolRecoveryCatalog.find((row) =>
    row.riskClass === "unknown" && row.recommendedNextAction === "avoid_unknown_tool");
  expect(Boolean(unknownRiskRow), "unknown risk recovery row exists");
  expectEqual(unknownRiskRow?.recoverable, true, "unknown risk recovery recoverable");

  const mcpRpcRow = describe.toolRecoveryCatalog.find((row) =>
    row.errorClasses.includes("mcp_rpc_error")
    && row.recommendedNextAction === "inspect_mcp_rpc_error_and_switch_strategy");
  expect(Boolean(mcpRpcRow), "mcp_rpc_error recovery row uses MCP-specific strategy action");
  expectEqual(mcpRpcRow?.recoverable, true, "mcp_rpc_error recovery recoverable");

  const mcpPayloadRow = describe.toolRecoveryCatalog.find((row) =>
    row.errorClasses.includes("mcp_arguments_too_large")
    && row.recommendedNextAction === "reduce_mcp_argument_payload");
  expect(Boolean(mcpPayloadRow), "MCP oversized payload recovery row exists");
  expectEqual(mcpPayloadRow?.stage, "local_fix", "MCP oversized payload stage");

  const mcpPolicyRow = describe.toolRecoveryCatalog.find((row) =>
    row.errorClasses.includes("mcp_tool_blocked")
    && row.recommendedNextAction === "use_allowed_mcp_tool_or_request_policy_change");
  expect(Boolean(mcpPolicyRow), "MCP blocked-tool recovery row exists");
  expectEqual(mcpPolicyRow?.recoverable, true, "MCP blocked-tool recovery recoverable");

  const budgetRows = describe.toolSurfaceSchemaProfiles
    .map((profile) => {
      const schemaEstimatedTokens = estimateToolSchemaTokens(profile.toolNames, profile.profile);
      const budget = RUNTIME_TOOL_SURFACE_BUDGETS[profile.profile];
      const validation = validateRuntimeToolSurfaceBudget({
        profile: profile.profile,
        projectionMode: profile.projectionMode,
        visibleToolCount: profile.visibleToolCount,
        schemaPropertyCount: profile.schemaPropertyCount,
        fullSchemaPropertyCount: profile.fullSchemaPropertyCount,
        suppressedSchemaPropertyCount: profile.suppressedSchemaPropertyCount,
        schemaEstimatedTokens,
      });
      return {
        profile: profile.profile,
        projection_mode: profile.projectionMode,
        advanced_tool_schema: profile.advancedToolSchema,
        visible_tool_count: profile.visibleToolCount,
        schema_property_count: profile.schemaPropertyCount,
        full_schema_property_count: profile.fullSchemaPropertyCount,
        suppressed_schema_property_count: profile.suppressedSchemaPropertyCount,
        schema_estimated_tokens: schemaEstimatedTokens,
        schema_fingerprint: profile.schemaFingerprint,
        budget_policy_version: RUNTIME_TOOL_SURFACE_BUDGET_POLICY_VERSION,
        budget_visible_tool_count_max: budget.visibleToolCountMax,
        budget_schema_property_count_max: budget.schemaPropertyCountMax,
        budget_full_schema_property_count_max: budget.fullSchemaPropertyCountMax,
        budget_suppressed_schema_property_count_max: budget.suppressedSchemaPropertyCountMax,
        budget_schema_estimated_tokens_max: budget.schemaEstimatedTokensMax,
        budget_ok: validation.ok,
        budget_violations: validation.violations,
        budget_violation_details: validation.violationDetails,
      };
    });
  runtimeSchemaProfileSummary = budgetRows.map((row) => ({
    profile: row.profile,
    projection_mode: row.projection_mode,
    advanced_tool_schema: row.advanced_tool_schema,
    visible_tool_count: row.visible_tool_count,
    schema_property_count: row.schema_property_count,
    full_schema_property_count: row.full_schema_property_count,
    suppressed_schema_property_count: row.suppressed_schema_property_count,
    schema_estimated_tokens: row.schema_estimated_tokens,
    schema_fingerprint: row.schema_fingerprint,
    budget_policy_version: row.budget_policy_version,
    budget_visible_tool_count_max: row.budget_visible_tool_count_max,
    budget_schema_property_count_max: row.budget_schema_property_count_max,
    budget_full_schema_property_count_max: row.budget_full_schema_property_count_max,
    budget_suppressed_schema_property_count_max: row.budget_suppressed_schema_property_count_max,
    budget_schema_estimated_tokens_max: row.budget_schema_estimated_tokens_max,
    budget_ok: row.budget_ok,
    budget_violations: row.budget_violations,
  }));
  const budgetViolations = budgetRows.filter((row) => !row.budget_ok);
  runtimeSchemaBudgetViolationDetails = budgetViolations.flatMap((row) =>
    row.budget_violation_details.map((detail) => ({
      profile: row.profile,
      projection_mode: row.projection_mode,
      metric: detail.metric,
      actual: detail.actual,
      ...(detail.expected === undefined ? {} : { expected: detail.expected }),
      ...(detail.max === undefined ? {} : { max: detail.max }),
    })));
  runtimeSchemaBudgetViolationCount = budgetViolations.length;
  runtimeSchemaBudgetViolationProfiles = budgetViolations.map((row) => row.profile);
  expectEqual(runtimeSchemaBudgetViolationCount, 0, "runtime schema profiles stay within budget policy");

  process.stdout.write(`${JSON.stringify(governancePayload(true, null))}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify(governancePayload(false, errorMessage(error)))}\n`);
  throw error;
}
