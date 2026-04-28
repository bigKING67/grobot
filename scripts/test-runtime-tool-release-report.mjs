#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const tmpDir = mkdtempSync(join(tmpdir(), "grobot-runtime-tool-release-report-"));
const reportPath = join(tmpDir, "core-release-gate-failure-report.json");

function cleanup() {
  rmSync(tmpDir, { recursive: true, force: true });
}

process.on("exit", cleanup);

function fail(message, details = {}) {
  const suffix = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : "";
  throw new Error(`${message}${suffix}`);
}

const result = spawnSync(
  "bash",
  [
    "scripts/core-release-gate.sh",
    "--allow-stub",
    "--skip-pack-dryrun",
    "--report",
    reportPath,
  ],
  {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      GROBOT_RUNTIME_TOOL_CONTRACTS_TEST_FAIL_ID: "runtime-tool-suite-ownership",
    },
  },
);

if (result.status !== 8) {
  fail("expected release gate to fail at runtime_tool_describe", {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout.slice(-1000),
    stderr: result.stderr.slice(-1000),
  });
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (error) {
  fail("expected release gate failure report to be readable JSON", {
    error: error instanceof Error ? error.message : String(error),
    stdout: result.stdout.slice(-1000),
    stderr: result.stderr.slice(-1000),
  });
}

const runtimeToolDescribe = report?.checks?.runtime_tool_describe;
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
    stdout: result.stdout.slice(-1000),
    stderr: result.stderr.slice(-1000),
  });
}

process.stdout.write(JSON.stringify({
  ok: true,
  exit_status: result.status,
  fail_reason: report.fail_reason,
  failed_contract: runtimeToolDescribe.failed_contract,
  runner_schema_version: runtimeToolDescribe.runner_schema_version,
  diagnostic_status: diagnosticSummary.status,
  diagnostics_self_test: runtimeToolDescribe.diagnostics_self_test,
  runtime_binary_exists: runtimeBinary.exists,
}) + "\n");
