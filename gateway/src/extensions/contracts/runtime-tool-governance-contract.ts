import { resolveRuntimeBinaryPath, runRuntimeToolsDescribe } from "../../orchestration/entrypoints/dev-cli/runtime-health";
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

const describe = runRuntimeToolsDescribe(resolveRuntimeBinaryPath());
expectEqual(describe.ok, true, `runtime.tools.describe ok (${describe.detail})`);
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
expectEqual(JSON.stringify(runtimeActions), JSON.stringify(gatewayActions), "runtime and gateway recovery action catalogs stay aligned");

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
    }),
  }))
  .filter((row) => !row.validation.ok);
expectEqual(budgetViolations.length, 0, "runtime schema profiles stay within budget policy");

process.stdout.write(JSON.stringify({
  ok: true,
  runtime_recovery_action_count: describe.toolRecoveryActions.length,
  runtime_recovery_catalog_rows: describe.toolRecoveryCatalog.length,
  runtime_schema_profile_count: describe.toolSurfaceSchemaProfiles.length,
  runtime_schema_budget_violations: budgetViolations.length,
}) + "\n");
