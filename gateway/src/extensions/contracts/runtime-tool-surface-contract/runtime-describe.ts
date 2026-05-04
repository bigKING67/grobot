import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildRuntimeToolRecoveryCatalogFingerprint,
  buildRuntimeToolSurfaceSchemaProfilesFingerprint,
  runRuntimeToolsDescribe,
} from "../../../cli/runtime-health";
import {
  normalizeRuntimeToolsDescribeDetail,
  resolveRuntimeToolDescribeDecision,
} from "../../../cli/services/runtime-tool-describe-decision";
import { validRuntimeRecoveryCatalog, validRuntimeSchemaProfile } from "./fixtures";
import { baseContext, expect, expectEqual } from "./helpers";

export function runRuntimeDescribeContract(): void {
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
}
