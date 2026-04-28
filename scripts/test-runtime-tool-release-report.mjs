#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  if (runtimeToolQuality.passed !== false) {
    failures.push("runtime_tool_quality.passed must be false for forced contract failure");
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
  if (runtimeToolQuality.failed_contract !== "runtime-tool-suite-ownership") {
    failures.push("runtime_tool_quality.failed_contract must preserve the failed contract id");
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
  if (successQuality.passed !== true) {
    successFailures.push("success runtime_tool_quality.passed must be true");
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
  if (successQuality.runtime_binary_exists !== true) {
    successFailures.push("success runtime_tool_quality.runtime_binary_exists must be true");
  }
  if (!Array.isArray(successQuality.gateway_only_recovery_actions)) {
    successFailures.push("success runtime_tool_quality.gateway_only_recovery_actions must be array");
  }
}
if (successDescribe?.runner_schema_version !== 1) {
  successFailures.push("success runtime_tool_describe.runner_schema_version must be 1");
}
if (successDescribe?.runtime_schema_budget_violations !== 0) {
  successFailures.push("success runtime_tool_describe.runtime_schema_budget_violations must be 0");
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
}) + "\n");
