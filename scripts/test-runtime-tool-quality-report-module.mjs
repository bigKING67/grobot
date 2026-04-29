#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCoreReleaseReport,
  readRuntimeToolDescribeData,
  readRuntimeToolQualityRegistry,
  resolveRuntimeToolQualitySignal,
  runtimeToolDescribeSummary,
  runtimeToolQualitySummary,
  writeCoreReleaseReport,
} from "./lib/runtime-tool-quality-report.mjs";

const tmpDir = mkdtempSync(join(tmpdir(), "grobot-runtime-tool-quality-report-module-"));
const registryFixturePath = "shared/contracts/runtime-tool-quality-v1.json";
const registryFixture = JSON.parse(readFileSync(registryFixturePath, "utf8"));
const registry = readRuntimeToolQualityRegistry();

process.on("exit", () => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function fail(message, details = {}) {
  const suffix = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : "";
  throw new Error(`${message}${suffix}`);
}

function expect(condition, message, details = {}) {
  if (!condition) {
    fail(message, details);
  }
}

function expectEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(message, { actual, expected });
  }
}

function expectIncludes(value, fragment, message) {
  expect(String(value).includes(fragment), message, { value, fragment });
}

function expectThrowsIncludes(fn, fragment, message) {
  try {
    fn();
  } catch (error) {
    expectIncludes(error instanceof Error ? error.message : String(error), fragment, message);
    return;
  }
  fail(`${message}: expected throw`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeFixture(name, value) {
  const path = join(tmpDir, name);
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

expectThrowsIncludes(
  () => readRuntimeToolQualityRegistry(writeFixture("invalid-registry.json", "{")),
  "runtime_tool_quality_registry_invalid_json",
  "registry reader must fail fast for invalid JSON",
);

const duplicateReasonRegistry = clone(registryFixture);
duplicateReasonRegistry.failure_reasons.push(clone(duplicateReasonRegistry.failure_reasons[0]));
expectThrowsIncludes(
  () => readRuntimeToolQualityRegistry(writeFixture("duplicate-reason-registry.json", duplicateReasonRegistry)),
  "runtime_tool_quality_registry_reason_duplicate",
  "registry reader must reject duplicate reason rows",
);

const duplicateActionReasonRegistry = clone(registryFixture);
duplicateActionReasonRegistry.action_required[1].reasons.push(duplicateActionReasonRegistry.action_required[0].reasons[0]);
expectThrowsIncludes(
  () => readRuntimeToolQualityRegistry(writeFixture("duplicate-action-reason-registry.json", duplicateActionReasonRegistry)),
  "runtime_tool_quality_registry_action_reason_duplicate",
  "registry reader must reject duplicate action reason mappings",
);

expectThrowsIncludes(
  () => resolveRuntimeToolQualitySignal(["runtime_health_failed"], "release", registry),
  "runtime_tool_quality_registry_reason_surface_unmapped:runtime_health_failed:release",
  "signal resolver must fail fast when a reason is not valid for the target surface",
);

const prioritySignal = resolveRuntimeToolQualitySignal([
  "schema_budget_violated",
  "runtime_binary_missing",
  "diagnostics_self_test_failed",
], "release", registry);
expectEqual(
  prioritySignal?.reason,
  "diagnostics_self_test_failed",
  "signal resolver must select the lowest release priority",
);

const invalidDescribePath = writeFixture("invalid-describe-report.json", "{");
const invalidDescribeData = readRuntimeToolDescribeData(invalidDescribePath);
const invalidDescribe = runtimeToolDescribeSummary(invalidDescribeData, false);
const invalidQuality = runtimeToolQualitySummary(invalidDescribe, invalidDescribeData, registry);
expect(typeof invalidDescribe.report_parse_error === "string", "invalid describe report must expose parse error");
expectEqual(invalidQuality.action_reason, "report_parse_error", "parse errors must be the decisive quality action");
expectEqual(
  invalidQuality.action_required,
  "fix_runtime_tool_release_report_parse",
  "parse errors must map to the release report parse action",
);

const ownershipPayload = {
  runner_covers_all_runtime_tool_contracts: true,
  all_contract_tmp_fixtures_isolated: true,
};
const baseDescribeSummary = {
  passed: true,
  ok: true,
  diagnostics_self_test: true,
  contract_count: 2,
  completed_count: 2,
  runtime_binary: { exists: true },
  runtime_tool_count: 14,
  runtime_default_enabled_count: 7,
  runtime_tool_manifest_fingerprint: "fnv1a32:runtime",
  gateway_tool_manifest_fingerprint: "fnv1a32:gateway",
  runtime_tool_manifest_match: true,
  runtime_tool_manifest_order_match: true,
  runtime_default_manifest_match: true,
  runtime_default_manifest_order_match: true,
  runtime_only_tools: [],
  gateway_only_tools: [],
  runtime_default_only_tools: [],
  gateway_default_only_tools: [],
  runtime_tool_order_mismatch: null,
  runtime_default_order_mismatch: null,
  runtime_schema_profile_summary: [{
    profile: "coding",
    projection_mode: "slim",
    schema_estimated_tokens: 900,
    budget_schema_estimated_tokens_max: 920,
    budget_ok: true,
  }],
  runtime_schema_budget_violation_profiles: [],
  runtime_schema_budget_violation_details: [],
  diagnostic_summary: {
    status: "passed",
    schema_budget_violations: 0,
  },
};
const baseData = { ownership_payload: ownershipPayload };
const goodQuality = runtimeToolQualitySummary(baseDescribeSummary, baseData, registry);
expectEqual(goodQuality.status, "ok", "healthy describe evidence must produce ok quality");
expectEqual(goodQuality.schema_budget_status, "passed", "zero schema budget violations must be passed");
expectEqual(goodQuality.failure_reasons.length, 0, "healthy describe evidence must not create failure reasons");

const unknownBudgetQuality = runtimeToolQualitySummary({
  ...baseDescribeSummary,
  diagnostic_summary: { status: "passed" },
}, baseData, registry);
expectEqual(unknownBudgetQuality.schema_budget_status, "unknown", "missing schema budget evidence must be unknown");
expectEqual(unknownBudgetQuality.action_reason, "schema_budget_unknown", "unknown schema budget must be actionable");

const violatedBudgetQuality = runtimeToolQualitySummary({
  ...baseDescribeSummary,
  diagnostic_summary: { status: "failed", schema_budget_violations: 2 },
  runtime_schema_budget_violation_profiles: ["browser"],
  runtime_schema_budget_violation_details: [{
    profile: "browser",
    projection_mode: "slim",
    metric: "schema_estimated_tokens",
    actual: 561,
    max: 560,
  }],
}, baseData, registry);
expectEqual(violatedBudgetQuality.schema_budget_status, "failed", "non-zero schema budget violations must be failed");
expectEqual(violatedBudgetQuality.action_reason, "schema_budget_violated", "violated schema budget must be actionable");
expectEqual(
  violatedBudgetQuality.runtime_schema_budget_violation_details[0].metric,
  "schema_estimated_tokens",
  "violated schema budget details must preserve decisive metric",
);

const failedContractQuality = runtimeToolQualitySummary({
  ...baseDescribeSummary,
  passed: false,
  ok: false,
  failed_contract: "runtime-tool-suite-ownership",
  failed_contract_detail: {
    suggested_command: "node focused-contract.js",
  },
}, baseData, registry);
expectEqual(
  failedContractQuality.actionable_next_step,
  "node focused-contract.js",
  "failed_contract_detail.suggested_command must override generic next step",
);

const diagnosticReproduceQuality = runtimeToolQualitySummary({
  ...baseDescribeSummary,
  passed: false,
  ok: false,
  diagnostic_summary: {
    status: "failed",
    schema_budget_violations: 0,
    reproduce: "node reproduce-runner.js",
  },
}, baseData, registry);
expectEqual(
  diagnosticReproduceQuality.actionable_next_step,
  "node reproduce-runner.js",
  "diagnostic_summary.reproduce must be used when failed_contract_detail has no command",
);

const defaultNextStepQuality = runtimeToolQualitySummary({
  ...baseDescribeSummary,
  passed: false,
  ok: false,
}, baseData, registry);
expectIncludes(
  defaultNextStepQuality.actionable_next_step,
  "Run the failed runtime-tool contract",
  "default next step must be used when no specific command is available",
);

const describeReportPath = writeFixture("valid-describe-report.json", {
  ok: true,
  schema_version: 1,
  contract_count: 2,
  completed_count: 2,
  include_runtime_describe: true,
  diagnostics_self_test: true,
  runtime_binary: { exists: true },
  diagnostic_summary: {
    status: "passed",
    schema_budget_violations: 99,
  },
  results: [
    {
      id: "runtime-tool-governance",
      output: JSON.stringify({
        runtime_recovery_catalog_rows: 3,
        runtime_tool_count: 14,
        runtime_default_enabled_count: 7,
        runtime_tool_manifest_fingerprint: "fnv1a32:runtime",
        gateway_tool_manifest_fingerprint: "fnv1a32:gateway",
        runtime_tool_manifest_match: true,
        runtime_tool_manifest_order_match: true,
        runtime_default_manifest_match: true,
        runtime_default_manifest_order_match: true,
        runtime_only_tools: [],
        gateway_only_tools: [],
        runtime_default_only_tools: ["legacy_edit"],
        gateway_default_only_tools: [],
        runtime_tool_order_mismatch: null,
        runtime_default_order_mismatch: { index: 2, runtime: "legacy_edit", gateway: "edit" },
        runtime_schema_profile_summary: [{
          profile: "coding",
          projection_mode: "slim",
          schema_estimated_tokens: 900,
          budget_schema_estimated_tokens_max: 920,
          budget_ok: true,
          budget_violations: [],
        }],
        runtime_schema_budget_violation_profiles: [],
        runtime_schema_budget_violation_details: [],
        runtime_schema_profile_count: 4,
        runtime_schema_budget_violations: 0,
        gateway_only_recovery_actions: ["recover_runtime_health"],
      }),
    },
    {
      id: "runtime-tool-suite-ownership",
      output: JSON.stringify(ownershipPayload),
    },
  ],
});
const describeData = readRuntimeToolDescribeData(describeReportPath);
const describeSummary = runtimeToolDescribeSummary(describeData, true);
expectEqual(
  describeSummary.runtime_schema_budget_violations,
  0,
  "governance payload schema budget evidence must override diagnostic fallback",
);
expectEqual(
  describeSummary.runtime_tool_manifest_fingerprint,
  "fnv1a32:runtime",
  "governance payload runtime tool manifest fingerprint must be preserved",
);
expectEqual(
  describeSummary.runtime_default_only_tools[0],
  "legacy_edit",
  "governance payload default-only diff must be preserved",
);
expectEqual(
  describeSummary.runtime_default_order_mismatch.index,
  2,
  "governance payload default order mismatch must be preserved",
);
expectEqual(
  describeSummary.runtime_schema_profile_summary[0].schema_estimated_tokens,
  900,
  "governance payload schema profile summary must be preserved",
);
expectEqual(describeSummary.gateway_only_recovery_actions.length, 1, "governance recovery actions must be preserved");

const releaseReport = buildCoreReleaseReport({
  exitCode: 0,
  failReason: "",
  allowStub: true,
  skipPack: true,
  verifyPassed: true,
  launcherPassed: true,
  runtimeToolDescribePassed: true,
  packPassed: true,
  packSkipped: true,
  runtimeToolDescribeReportPath: describeReportPath,
});
expectEqual(releaseReport.checks.runtime_tool_quality.status, "ok", "buildCoreReleaseReport must embed ok quality");
expectEqual(
  releaseReport.checks.runtime_tool_quality.schema_budget_violations,
  0,
  "buildCoreReleaseReport must preserve normalized schema budget evidence",
);
expectEqual(
  releaseReport.checks.runtime_tool_describe.runtime_tool_manifest_fingerprint,
  "fnv1a32:runtime",
  "buildCoreReleaseReport must preserve runtime tool manifest fingerprint",
);
expectEqual(
  releaseReport.checks.runtime_tool_quality.gateway_tool_manifest_fingerprint,
  "fnv1a32:gateway",
  "runtime_tool_quality must expose gateway tool manifest fingerprint",
);
expectEqual(
  releaseReport.checks.runtime_tool_quality.runtime_default_only_tools[0],
  "legacy_edit",
  "runtime_tool_quality must expose default-enabled manifest diff evidence",
);
expectEqual(
  releaseReport.checks.runtime_tool_quality.runtime_default_order_mismatch.index,
  2,
  "runtime_tool_quality must expose default-enabled order mismatch evidence",
);
expectEqual(
  releaseReport.checks.runtime_tool_quality.runtime_schema_profile_summary[0].budget_ok,
  true,
  "runtime_tool_quality must expose per-profile schema budget summary",
);

const writtenReportPath = join(tmpDir, "nested", "core-release-report.json");
writeCoreReleaseReport(writtenReportPath, releaseReport);
const writtenReport = JSON.parse(readFileSync(writtenReportPath, "utf8"));
expectEqual(writtenReport.schema_version, 1, "writeCoreReleaseReport must persist the report JSON");
expectEqual(writtenReport.checks.runtime_tool_quality.status, "ok", "persisted report must retain quality summary");

process.stdout.write(JSON.stringify({
  ok: true,
  registry_invalid_json: true,
  registry_duplicate_reason: true,
  registry_duplicate_action_reason: true,
  wrong_surface_guard: true,
  priority_action: prioritySignal.reason,
  parse_error_action: invalidQuality.action_reason,
  schema_budget_cases: ["passed", "unknown", "failed"],
  manifest_evidence: [
    "runtime_tool_count",
    "runtime_tool_manifest_fingerprint",
    "runtime_only_tools",
    "runtime_tool_order_mismatch",
    "runtime_schema_profile_summary",
    "runtime_schema_budget_violation_details",
  ],
  next_step_precedence: ["failed_contract_detail", "diagnostic_summary", "default"],
  release_quality_status: releaseReport.checks.runtime_tool_quality.status,
}) + "\n");
