#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readRuntimeToolQualityRegistry,
  resolveRuntimeToolQualitySignal,
  runtimeToolQualitySummary,
} from "./lib/runtime-tool-quality-report.mjs";

const repoRoot = process.cwd();
const tmpDir = mkdtempSync(join(tmpdir(), "grobot-runtime-tool-release-report-"));
const failureReportPath = join(tmpDir, "core-release-gate-failure-report.json");
const successReportPath = join(tmpDir, "core-release-gate-success-report.json");

function cleanup() {
  rmSync(tmpDir, { recursive: true, force: true });
}

process.on("exit", cleanup);

function fail(message, details = {}) {
  const suffix = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : "";
  throw new Error(`${message}${suffix}`);
}

function runReleaseGate(reportPath, env = {}) {
  return spawnSync("bash", [
    "scripts/core-release-gate.sh",
    "--allow-stub",
    "--skip-pack-dryrun",
    "--report",
    reportPath,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

function readReport(path, result, context) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`expected ${context} report to be readable JSON`, {
      error: error instanceof Error ? error.message : String(error),
      stdout: result.stdout.slice(-1000),
      stderr: result.stderr.slice(-1000),
    });
  }
}

const qualityRegistry = readRuntimeToolQualityRegistry();
const fixtureSignal = resolveRuntimeToolQualitySignal([
  "schema_budget_violated",
  "runner_contract_coverage_missing",
  "runtime_binary_missing",
  "diagnostics_self_test_failed",
], "release", qualityRegistry);
if (fixtureSignal?.reason !== "diagnostics_self_test_failed") {
  fail("release quality module must choose lowest priority_by_surface.release signal", {
    signal: fixtureSignal,
  });
}
const fixtureQuality = runtimeToolQualitySummary({
  passed: false,
  ok: false,
  diagnostics_self_test: false,
  contract_count: 2,
  completed_count: 2,
  runtime_binary: { exists: true },
  diagnostic_summary: {
    status: "failed",
    schema_budget_violations: 0,
  },
}, {
  ownership_payload: {
    runner_covers_all_runtime_tool_contracts: true,
    all_contract_tmp_fixtures_isolated: true,
  },
}, qualityRegistry);
if (
  fixtureQuality.action_reason !== "diagnostics_self_test_failed"
  || fixtureQuality.action_required !== "fix_runtime_tool_runner_diagnostics"
) {
  fail("release quality module must derive decisive action from registry priority", {
    quality: fixtureQuality,
  });
}
const surfaceExecutionFixtureQuality = runtimeToolQualitySummary({
  passed: false,
  ok: false,
  diagnostics_self_test: true,
  failed_contract: "runtime-tool-surface-execution",
  contract_count: 12,
  completed_count: 11,
  runtime_binary: { exists: true },
  runtime_surface_execution_smoke_passed: false,
  diagnostic_summary: {
    status: "failed",
    schema_budget_violations: 0,
  },
}, {
  ownership_payload: {
    runner_covers_all_runtime_tool_contracts: true,
    all_contract_tmp_fixtures_isolated: true,
  },
}, qualityRegistry);
if (
  surfaceExecutionFixtureQuality.action_reason !== "surface_execution_smoke_failed"
  || surfaceExecutionFixtureQuality.action_required !== "run_surface_execution_smoke_and_fix_runtime_boundary"
) {
  fail("release quality module must classify surface execution smoke failures with a focused action", {
    quality: surfaceExecutionFixtureQuality,
  });
}

const result = runReleaseGate(failureReportPath, {
  GROBOT_RUNTIME_TOOL_CONTRACTS_TEST_FAIL_ID: "runtime-tool-suite-ownership",
});

if (result.status !== 8) {
  fail("expected release gate to fail at runtime_tool_describe", {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout.slice(-1000),
    stderr: result.stderr.slice(-1000),
  });
}

const report = readReport(failureReportPath, result, "release gate failure");

const runtimeToolDescribe = report?.checks?.runtime_tool_describe;
const runtimeToolQuality = report?.checks?.runtime_tool_quality;
const detail = runtimeToolDescribe?.failed_contract_detail;
const runtimeBinary = runtimeToolDescribe?.runtime_binary;
const diagnosticSummary = runtimeToolDescribe?.diagnostic_summary;
const failures = [];

if (report.overall_passed !== false) {
  failures.push("overall_passed must be false");
}
if (report.fail_reason !== "runtime_tool_describe_failed") {
  failures.push("fail_reason must be runtime_tool_describe_failed");
}
if (runtimeToolDescribe?.passed !== false) {
  failures.push("runtime_tool_describe.passed must be false");
}
if (runtimeToolDescribe?.runner_schema_version !== 1) {
  failures.push("runner_schema_version must be 1");
}
if (!runtimeToolQuality || typeof runtimeToolQuality !== "object") {
  failures.push("runtime_tool_quality must be present");
} else {
  if (runtimeToolQuality.status !== "fail") {
    failures.push("runtime_tool_quality.status must be fail for forced contract failure");
  }
  if (runtimeToolQuality.quality_schema_version !== 1) {
    failures.push("runtime_tool_quality.quality_schema_version must be 1");
  }
  if (runtimeToolQuality.passed !== false) {
    failures.push("runtime_tool_quality.passed must be false for forced contract failure");
  }
  if (runtimeToolQuality.source !== "runtime_tool_describe") {
    failures.push("runtime_tool_quality.source must be runtime_tool_describe");
  }
  if (!Array.isArray(runtimeToolQuality.failure_reasons)) {
    failures.push("runtime_tool_quality.failure_reasons must be array");
  } else if (!runtimeToolQuality.failure_reasons.includes("runtime_tool_describe_failed")) {
    failures.push("runtime_tool_quality.failure_reasons must include runtime_tool_describe_failed");
  }
  if (!Array.isArray(runtimeToolQuality.warning_reasons)) {
    failures.push("runtime_tool_quality.warning_reasons must be array");
  }
  if (runtimeToolQuality.runner_schema_version !== 1) {
    failures.push("runtime_tool_quality.runner_schema_version must be 1");
  }
  if (runtimeToolQuality.diagnostic_summary_status !== "failed") {
    failures.push("runtime_tool_quality.diagnostic_summary_status must be failed");
  }
  if (runtimeToolQuality.runtime_binary_exists !== true) {
    failures.push("runtime_tool_quality.runtime_binary_exists must be true");
  }
  if (runtimeToolQuality.schema_budget_status !== "unknown") {
    failures.push("runtime_tool_quality.schema_budget_status must be unknown for early forced failure");
  }
  if (runtimeToolQuality.failed_contract !== "runtime-tool-suite-ownership") {
    failures.push("runtime_tool_quality.failed_contract must preserve the failed contract id");
  }
  if (runtimeToolQuality.action_family !== "runner_contract") {
    failures.push("runtime_tool_quality.action_family must classify forced failure as runner_contract");
  }
  if (runtimeToolQuality.action_reason !== "runtime_tool_describe_failed") {
    failures.push("runtime_tool_quality.action_reason must preserve the decisive failure reason");
  }
  if (runtimeToolQuality.action_required !== "run_failed_runtime_tool_contract") {
    failures.push("runtime_tool_quality.action_required must point to failed contract action");
  }
  if (!String(runtimeToolQuality.actionable_next_step ?? "").includes("runtime-tool-suite-ownership-contract.ts")) {
    failures.push("runtime_tool_quality.actionable_next_step must be actionable");
  }
}
if (runtimeToolDescribe?.diagnostics_self_test !== true) {
  failures.push("diagnostics_self_test must stay true on forced contract failure");
}
if (runtimeToolDescribe?.failed_contract !== "runtime-tool-suite-ownership") {
  failures.push("failed_contract must preserve the forced contract id");
}
if (!diagnosticSummary || typeof diagnosticSummary !== "object") {
  failures.push("diagnostic_summary must be present");
} else {
  if (diagnosticSummary.status !== "failed") {
    failures.push("diagnostic_summary.status must be failed");
  }
  if (diagnosticSummary.failed_id !== "runtime-tool-suite-ownership") {
    failures.push("diagnostic_summary.failed_id must preserve the failed contract id");
  }
  if (!String(diagnosticSummary.reproduce ?? "").includes("runtime-tool-suite-ownership-contract.ts")) {
    failures.push("diagnostic_summary.reproduce must be actionable");
  }
  if (diagnosticSummary.runtime_binary_exists !== true) {
    failures.push("diagnostic_summary.runtime_binary_exists must be true");
  }
}
if (!detail || typeof detail !== "object") {
  failures.push("failed_contract_detail must be present");
} else {
  if (detail.id !== "runtime-tool-suite-ownership") {
    failures.push("failed_contract_detail.id must preserve the failing contract id");
  }
  if (detail.last_output_json?.marker !== "runtime_tool_runner_forced_failure") {
    failures.push("failed_contract_detail.last_output_json must preserve the runner JSON marker");
  }
  if (!String(detail.suggested_command ?? "").includes("runtime-tool-suite-ownership-contract.ts")) {
    failures.push("failed_contract_detail.suggested_command must be actionable");
  }
  if (String(detail.stderr_tail ?? "").includes("forced-failure-stderr-line-00")) {
    failures.push("failed_contract_detail.stderr_tail must be capped to recent lines");
  }
  if (!String(detail.stderr_tail ?? "").includes("forced-failure-stderr-line-44")) {
    failures.push("failed_contract_detail.stderr_tail must include the latest line");
  }
}
if (!runtimeBinary || typeof runtimeBinary !== "object") {
  failures.push("runtime_binary must be present on describe-mode failure");
} else if (runtimeBinary.exists !== true) {
  failures.push("runtime_binary.exists must be true after release gate builds the runtime");
}

if (failures.length > 0) {
  fail("runtime-tool release failure report contract failed", {
    failures,
    report: runtimeToolDescribe,
    quality: runtimeToolQuality,
    stdout: result.stdout.slice(-1000),
    stderr: result.stderr.slice(-1000),
  });
}

const successResult = runReleaseGate(successReportPath);
if (successResult.status !== 0) {
  fail("expected release gate success path to pass", {
    status: successResult.status,
    signal: successResult.signal,
    stdout: successResult.stdout.slice(-1000),
    stderr: successResult.stderr.slice(-1000),
  });
}
if (
  !successResult.stdout.includes("tool_count=14")
  || !successResult.stdout.includes("default_enabled=7")
  || !successResult.stdout.includes("manifest=fnv1a32:")
  || !successResult.stdout.includes("surface_smoke=true")
  || !successResult.stdout.includes("surface_profiles=7")
  || !successResult.stdout.includes("surface_hidden_args=4")
) {
  fail("release gate stdout must expose runtime tool manifest and surface execution smoke evidence", {
    stdout: successResult.stdout.slice(-1000),
    stderr: successResult.stderr.slice(-1000),
  });
}

const successReport = readReport(successReportPath, successResult, "release gate success");
const successQuality = successReport?.checks?.runtime_tool_quality;
const successDescribe = successReport?.checks?.runtime_tool_describe;
const successFailures = [];

if (!successQuality || typeof successQuality !== "object") {
  successFailures.push("success runtime_tool_quality must be present");
} else {
  if (successQuality.status !== "ok") {
    successFailures.push("success runtime_tool_quality.status must be ok");
  }
  if (successQuality.quality_schema_version !== 1) {
    successFailures.push("success runtime_tool_quality.quality_schema_version must be 1");
  }
  if (successQuality.passed !== true) {
    successFailures.push("success runtime_tool_quality.passed must be true");
  }
  if (successQuality.source !== "runtime_tool_describe") {
    successFailures.push("success runtime_tool_quality.source must be runtime_tool_describe");
  }
  if (!Array.isArray(successQuality.failure_reasons) || successQuality.failure_reasons.length !== 0) {
    successFailures.push("success runtime_tool_quality.failure_reasons must be empty array");
  }
  if (!Array.isArray(successQuality.warning_reasons)) {
    successFailures.push("success runtime_tool_quality.warning_reasons must be array");
  }
  if (successQuality.diagnostic_summary_status !== "passed") {
    successFailures.push("success runtime_tool_quality.diagnostic_summary_status must be passed");
  }
  if (successQuality.runner_contract_coverage !== true) {
    successFailures.push("success runtime_tool_quality.runner_contract_coverage must be true");
  }
  if (successQuality.tmp_fixture_isolation !== true) {
    successFailures.push("success runtime_tool_quality.tmp_fixture_isolation must be true");
  }
  if (successQuality.schema_budget_violations !== 0) {
    successFailures.push("success runtime_tool_quality.schema_budget_violations must be 0");
  }
  if (successQuality.schema_budget_status !== "passed") {
    successFailures.push("success runtime_tool_quality.schema_budget_status must be passed");
  }
  if (!Array.isArray(successQuality.runtime_schema_profile_summary) || successQuality.runtime_schema_profile_summary.length !== 7) {
    successFailures.push("success runtime_tool_quality.runtime_schema_profile_summary must describe 7 profiles");
  } else if (
    typeof successQuality.runtime_schema_profile_summary[0].schema_estimated_tokens !== "number"
    || successQuality.runtime_schema_profile_summary.some((profile) => profile.budget_ok !== true)
  ) {
    successFailures.push("success runtime_tool_quality.runtime_schema_profile_summary must include per-profile budget values");
  }
  if (!Array.isArray(successQuality.runtime_schema_budget_violation_details) || successQuality.runtime_schema_budget_violation_details.length !== 0) {
    successFailures.push("success runtime_tool_quality.runtime_schema_budget_violation_details must be empty array");
  }
  if (successQuality.runtime_surface_execution_smoke_passed !== true) {
    successFailures.push("success runtime_tool_quality.runtime_surface_execution_smoke_passed must be true");
  }
  if (!Array.isArray(successQuality.runtime_surface_execution_profiles_smoked) || successQuality.runtime_surface_execution_profiles_smoked.length !== 7) {
    successFailures.push("success runtime_tool_quality.runtime_surface_execution_profiles_smoked must cover 7 profiles");
  }
  if (successQuality.runtime_surface_execution_allowed_workflow_successes !== 2) {
    successFailures.push("success runtime_tool_quality.runtime_surface_execution_allowed_workflow_successes must be 2");
  }
  if (successQuality.runtime_surface_execution_hidden_tool_rejections !== 1) {
    successFailures.push("success runtime_tool_quality.runtime_surface_execution_hidden_tool_rejections must be 1");
  }
  if (successQuality.runtime_surface_execution_hidden_arg_rejections !== 4) {
    successFailures.push("success runtime_tool_quality.runtime_surface_execution_hidden_arg_rejections must be 4");
  }
  if (!Number.isFinite(successQuality.runtime_surface_execution_schema_projection_checks) || successQuality.runtime_surface_execution_schema_projection_checks < 20) {
    successFailures.push("success runtime_tool_quality.runtime_surface_execution_schema_projection_checks must be >= 20");
  }
  if (successQuality.runtime_binary_exists !== true) {
    successFailures.push("success runtime_tool_quality.runtime_binary_exists must be true");
  }
  if (successQuality.runtime_tool_count !== 14) {
    successFailures.push("success runtime_tool_quality.runtime_tool_count must be 14");
  }
  if (successQuality.runtime_default_enabled_count !== 7) {
    successFailures.push("success runtime_tool_quality.runtime_default_enabled_count must be 7");
  }
  if (typeof successQuality.runtime_tool_manifest_fingerprint !== "string" || !successQuality.runtime_tool_manifest_fingerprint.startsWith("fnv1a32:")) {
    successFailures.push("success runtime_tool_quality.runtime_tool_manifest_fingerprint must be present");
  }
  if (typeof successQuality.gateway_tool_manifest_fingerprint !== "string" || !successQuality.gateway_tool_manifest_fingerprint.startsWith("fnv1a32:")) {
    successFailures.push("success runtime_tool_quality.gateway_tool_manifest_fingerprint must be present");
  }
  if (successQuality.runtime_tool_manifest_match !== true) {
    successFailures.push("success runtime_tool_quality.runtime_tool_manifest_match must be true");
  }
  if (successQuality.runtime_tool_manifest_order_match !== true) {
    successFailures.push("success runtime_tool_quality.runtime_tool_manifest_order_match must be true");
  }
  if (successQuality.runtime_default_manifest_match !== true) {
    successFailures.push("success runtime_tool_quality.runtime_default_manifest_match must be true");
  }
  if (successQuality.runtime_default_manifest_order_match !== true) {
    successFailures.push("success runtime_tool_quality.runtime_default_manifest_order_match must be true");
  }
  if (!Array.isArray(successQuality.runtime_only_tools) || successQuality.runtime_only_tools.length !== 0) {
    successFailures.push("success runtime_tool_quality.runtime_only_tools must be empty array");
  }
  if (!Array.isArray(successQuality.gateway_only_tools) || successQuality.gateway_only_tools.length !== 0) {
    successFailures.push("success runtime_tool_quality.gateway_only_tools must be empty array");
  }
  if (!Array.isArray(successQuality.runtime_default_only_tools) || successQuality.runtime_default_only_tools.length !== 0) {
    successFailures.push("success runtime_tool_quality.runtime_default_only_tools must be empty array");
  }
  if (!Array.isArray(successQuality.gateway_default_only_tools) || successQuality.gateway_default_only_tools.length !== 0) {
    successFailures.push("success runtime_tool_quality.gateway_default_only_tools must be empty array");
  }
  if (successQuality.runtime_tool_order_mismatch !== null) {
    successFailures.push("success runtime_tool_quality.runtime_tool_order_mismatch must be null");
  }
  if (successQuality.runtime_default_order_mismatch !== null) {
    successFailures.push("success runtime_tool_quality.runtime_default_order_mismatch must be null");
  }
  if (!Array.isArray(successQuality.gateway_only_recovery_actions)) {
    successFailures.push("success runtime_tool_quality.gateway_only_recovery_actions must be array");
  }
  if (successQuality.action_family !== "none") {
    successFailures.push("success runtime_tool_quality.action_family must be none");
  }
  if (successQuality.action_reason !== null) {
    successFailures.push("success runtime_tool_quality.action_reason must be null");
  }
  if (successQuality.action_required !== null) {
    successFailures.push("success runtime_tool_quality.action_required must be null");
  }
  if (successQuality.actionable_next_step !== null) {
    successFailures.push("success runtime_tool_quality.actionable_next_step must be null");
  }
}
if (successDescribe?.runner_schema_version !== 1) {
  successFailures.push("success runtime_tool_describe.runner_schema_version must be 1");
}
if (successDescribe?.runtime_schema_budget_violations !== 0) {
  successFailures.push("success runtime_tool_describe.runtime_schema_budget_violations must be 0");
}
if (!Array.isArray(successDescribe?.runtime_schema_profile_summary) || successDescribe.runtime_schema_profile_summary.length !== 7) {
  successFailures.push("success runtime_tool_describe.runtime_schema_profile_summary must describe 7 profiles");
}
if (!Array.isArray(successDescribe?.runtime_schema_budget_violation_details) || successDescribe.runtime_schema_budget_violation_details.length !== 0) {
  successFailures.push("success runtime_tool_describe.runtime_schema_budget_violation_details must be empty array");
}
if (successDescribe?.runtime_surface_execution_smoke_passed !== true) {
  successFailures.push("success runtime_tool_describe.runtime_surface_execution_smoke_passed must be true");
}
if (!Array.isArray(successDescribe?.runtime_surface_execution_profiles_smoked) || successDescribe.runtime_surface_execution_profiles_smoked.length !== 7) {
  successFailures.push("success runtime_tool_describe.runtime_surface_execution_profiles_smoked must cover 7 profiles");
}
if (successDescribe?.runtime_tool_count !== 14) {
  successFailures.push("success runtime_tool_describe.runtime_tool_count must be 14");
}
if (successDescribe?.runtime_default_enabled_count !== 7) {
  successFailures.push("success runtime_tool_describe.runtime_default_enabled_count must be 7");
}
if (typeof successDescribe?.runtime_tool_manifest_fingerprint !== "string" || !successDescribe.runtime_tool_manifest_fingerprint.startsWith("fnv1a32:")) {
  successFailures.push("success runtime_tool_describe.runtime_tool_manifest_fingerprint must be present");
}
if (successDescribe?.runtime_tool_manifest_match !== true) {
  successFailures.push("success runtime_tool_describe.runtime_tool_manifest_match must be true");
}
if (successDescribe?.runtime_tool_manifest_order_match !== true) {
  successFailures.push("success runtime_tool_describe.runtime_tool_manifest_order_match must be true");
}
if (!Array.isArray(successDescribe?.runtime_only_tools) || successDescribe.runtime_only_tools.length !== 0) {
  successFailures.push("success runtime_tool_describe.runtime_only_tools must be empty array");
}
if (successDescribe?.runtime_tool_order_mismatch !== null) {
  successFailures.push("success runtime_tool_describe.runtime_tool_order_mismatch must be null");
}

if (successFailures.length > 0) {
  fail("runtime-tool release success quality summary contract failed", {
    failures: successFailures,
    quality: successQuality,
    describe: successDescribe,
    stdout: successResult.stdout.slice(-1000),
    stderr: successResult.stderr.slice(-1000),
  });
}

process.stdout.write(JSON.stringify({
  ok: true,
  exit_status: result.status,
  fail_reason: report.fail_reason,
  failed_contract: runtimeToolDescribe.failed_contract,
  runner_schema_version: runtimeToolDescribe.runner_schema_version,
  diagnostic_status: diagnosticSummary.status,
  quality_status: runtimeToolQuality.passed,
  quality_summary_status: runtimeToolQuality.status,
  success_quality_status: successQuality.passed,
  success_quality_summary_status: successQuality.status,
  diagnostics_self_test: runtimeToolDescribe.diagnostics_self_test,
  runtime_binary_exists: runtimeBinary.exists,
  module_priority_fixture_action: fixtureSignal.reason,
  surface_execution_fixture_action: surfaceExecutionFixtureQuality.action_reason,
}) + "\n");
