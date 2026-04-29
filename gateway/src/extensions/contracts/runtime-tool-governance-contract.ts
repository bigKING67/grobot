import { resolveRuntimeBinaryPath, runRuntimeToolsDescribe } from "../../orchestration/entrypoints/dev-cli/runtime-health";
import {
  buildAllRuntimeLocalTools,
  buildDefaultRuntimeEnabledTools,
  estimateToolSchemaTokens,
} from "../../tools/runtime/default-enabled-tools";
import { knownRuntimeToolRecoveryActions } from "../../tools/runtime/tool-events";
import { validateRuntimeToolSurfaceBudget } from "../../tools/runtime/tool-surface-budget";

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

const describe = runRuntimeToolsDescribe(resolveRuntimeBinaryPath());
expectEqual(describe.ok, true, `runtime.tools.describe ok (${describe.detail})`);
expectEqual(
  JSON.stringify(sorted(describe.toolNames)),
  JSON.stringify(sorted(buildAllRuntimeLocalTools())),
  "runtime.tools.describe tools must match gateway local tool manifest",
);
expectEqual(
  JSON.stringify(sorted(describe.defaultEnabledTools)),
  JSON.stringify(sorted(buildDefaultRuntimeEnabledTools())),
  "runtime.tools.describe default_enabled_tools must match gateway default manifest",
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

const gatewayActions = sorted(knownRuntimeToolRecoveryActions());
const runtimeActions = sorted(describe.toolRecoveryActions);
const runtimeOnlyActions = difference(runtimeActions, gatewayActions);
const gatewayOnlyActions = difference(gatewayActions, runtimeActions);
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

const budgetViolations = describe.toolSurfaceSchemaProfiles
  .map((profile) => ({
    profile: profile.profile,
    validation: validateRuntimeToolSurfaceBudget({
      profile: profile.profile,
      projectionMode: profile.projectionMode,
      visibleToolCount: profile.visibleToolCount,
      schemaPropertyCount: profile.schemaPropertyCount,
      fullSchemaPropertyCount: profile.fullSchemaPropertyCount,
      suppressedSchemaPropertyCount: profile.suppressedSchemaPropertyCount,
      schemaEstimatedTokens: estimateToolSchemaTokens(profile.toolNames, profile.profile),
    }),
  }))
  .filter((row) => !row.validation.ok);
expectEqual(budgetViolations.length, 0, "runtime schema profiles stay within budget policy");

process.stdout.write(JSON.stringify({
  ok: true,
  runtime_tool_count: describe.toolNames.length,
  runtime_default_enabled_count: describe.defaultEnabledTools.length,
  runtime_recovery_action_count: describe.toolRecoveryActions.length,
  gateway_only_recovery_actions: gatewayOnlyActions,
  runtime_recovery_catalog_rows: describe.toolRecoveryCatalog.length,
  runtime_schema_profile_count: describe.toolSurfaceSchemaProfiles.length,
  runtime_schema_budget_violations: budgetViolations.length,
}) + "\n");
