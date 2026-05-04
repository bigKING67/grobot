import { expect, expectSameStringSet, sortedUnique } from "./runtime-tool-surface-execution-contract/assertions";
import { runSurfaceCase } from "./runtime-tool-surface-execution-contract/case-runner";
import { surfaceCases } from "./runtime-tool-surface-execution-contract/cases";
import {
  loadRuntimeRecoveryActions,
  runtimeBinaryPath,
} from "./runtime-tool-surface-execution-contract/runtime-rpc";
import type { SurfaceCaseResult } from "./runtime-tool-surface-execution-contract/types";

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const recoveryActions = await loadRuntimeRecoveryActions(repoRoot);
  const results: SurfaceCaseResult[] = [];
  for (const surfaceCase of surfaceCases) {
    results.push(await runSurfaceCase(repoRoot, surfaceCase, recoveryActions));
  }
  const profilesSmoked = sortedUnique(results.map((result) => result.profile));
  expectSameStringSet(
    profilesSmoked,
    ["minimal", "coding", "browser", "browser_advanced", "context", "mcp", "full_debug"],
    "surface execution smoke must cover all decisive surface families",
  );
  const allowedWorkflowSuccesses = results.filter((result) => result.outcome === "success").length;
  const hiddenToolRejections = results.filter((result) =>
    result.tool_end_error_class === "tool_not_visible").length;
  const hiddenArgRejections = results.filter((result) =>
    result.tool_end_error_class === "tool_argument_not_visible").length;
  const schemaProjectionChecks = results.reduce(
    (total, result) => total + result.schema_projection_checks,
    0,
  );
  const structuredErrorDataChecks = results.reduce(
    (total, result) => total + result.structured_error_data_checks,
    0,
  );
  const recoveryActionCatalogChecks = results.reduce(
    (total, result) => total + result.recovery_action_catalog_checks,
    0,
  );
  expect(recoveryActionCatalogChecks >= 20, "surface recovery actions must be checked against runtime catalog");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    contract: "runtime-tool-surface-execution",
    runtime_binary: runtimeBinaryPath(repoRoot),
    profiles_smoked: profilesSmoked,
    allowed_workflow_successes: allowedWorkflowSuccesses,
    hidden_tool_rejections: hiddenToolRejections,
    hidden_arg_rejections: hiddenArgRejections,
    schema_projection_checks: schemaProjectionChecks,
    structured_error_data_checks: structuredErrorDataChecks,
    recovery_action_catalog_checks: recoveryActionCatalogChecks,
    cases: results,
  })}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`runtime-tool-surface-execution-contract fatal: ${message}\n`);
  process.exitCode = 1;
});
