#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const runtimeToolQualitySchemaVersion = 1;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === "string");
}

function recordArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => isRecord(item));
}

function parseBoolean(value) {
  return value === true || value === "true" || value === "1";
}

export function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function readRuntimeToolQualityRegistry(registryPath = resolve(process.cwd(), "shared/contracts/runtime-tool-quality-v1.json")) {
  let registry = null;
  try {
    registry = JSON.parse(readFileSync(registryPath, "utf8"));
  } catch (error) {
    throw new Error(
      `runtime_tool_quality_registry_invalid_json:${registryPath}:${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(registry) || !Array.isArray(registry.action_required)) {
    throw new Error("runtime_tool_quality_registry_action_required_missing");
  }
  if (!Array.isArray(registry.failure_reasons) || !Array.isArray(registry.warning_reasons)) {
    throw new Error("runtime_tool_quality_registry_reason_catalog_missing");
  }

  const reasonByReason = new Map();
  for (const [catalogName, rows] of [
    ["failure_reason", registry.failure_reasons],
    ["warning_reason", registry.warning_reasons],
  ]) {
    rows.forEach((row, index) => {
      if (!isRecord(row) || typeof row.reason !== "string" || typeof row.action_family !== "string") {
        throw new Error(`runtime_tool_quality_registry_${catalogName}_invalid:${String(index)}`);
      }
      if (!Array.isArray(row.surfaces) || !isRecord(row.priority_by_surface)) {
        throw new Error(`runtime_tool_quality_registry_${catalogName}_priority_missing:${String(index)}`);
      }
      const priorityBySurface = {};
      for (const surface of row.surfaces) {
        if (surface !== "status" && surface !== "release") {
          throw new Error(`runtime_tool_quality_registry_${catalogName}_surface_invalid:${String(index)}:${String(surface)}`);
        }
        const priority = row.priority_by_surface[surface];
        if (!Number.isInteger(priority) || priority <= 0) {
          throw new Error(`runtime_tool_quality_registry_${catalogName}_priority_invalid:${String(index)}:${surface}`);
        }
        priorityBySurface[surface] = priority;
      }
      if (reasonByReason.has(row.reason)) {
        throw new Error(`runtime_tool_quality_registry_reason_duplicate:${row.reason}`);
      }
      reasonByReason.set(row.reason, {
        actionFamily: row.action_family,
        priorityBySurface,
      });
    });
  }

  const actionByReason = new Map();
  registry.action_required.forEach((row, index) => {
    if (!isRecord(row) || typeof row.action !== "string" || !Array.isArray(row.reasons)) {
      throw new Error(`runtime_tool_quality_registry_action_required_invalid:${String(index)}`);
    }
    if (!isRecord(row.default_next_step)) {
      throw new Error(`runtime_tool_quality_registry_default_next_step_missing:${String(index)}`);
    }
    for (const surface of ["status", "release"]) {
      if (row.default_next_step[surface] !== undefined && typeof row.default_next_step[surface] !== "string") {
        throw new Error(`runtime_tool_quality_registry_default_next_step_invalid:${String(index)}:${surface}`);
      }
    }
    row.reasons.forEach((reason) => {
      if (typeof reason !== "string" || reason.trim().length === 0) {
        throw new Error(`runtime_tool_quality_registry_action_reason_invalid:${String(index)}`);
      }
      if (!reasonByReason.has(reason)) {
        throw new Error(`runtime_tool_quality_registry_action_reason_unknown:${reason}`);
      }
      if (actionByReason.has(reason)) {
        throw new Error(`runtime_tool_quality_registry_action_reason_duplicate:${reason}`);
      }
      actionByReason.set(reason, {
        actionRequired: row.action,
        defaultNextStepBySurface: row.default_next_step,
      });
    });
  });
  return {
    actionByReason,
    reasonByReason,
  };
}

export function pushRuntimeToolQualityFailureReason(reasons, reason, registry) {
  const reasonRegistry = registry.reasonByReason.get(reason);
  if (!reasonRegistry || reasonRegistry.priorityBySurface.release === undefined) {
    throw new Error(`unknown runtime_tool_quality failure reason: ${String(reason)}`);
  }
  reasons.push(reason);
}

export function resolveRuntimeToolQualitySignal(reasons, surface, registry = readRuntimeToolQualityRegistry()) {
  const candidates = [];
  for (const reason of reasons) {
    const reasonRegistry = registry.reasonByReason.get(reason);
    if (!reasonRegistry) {
      throw new Error(`runtime_tool_quality_registry_reason_unmapped:${reason}`);
    }
    const priority = reasonRegistry.priorityBySurface[surface];
    if (!Number.isInteger(priority)) {
      throw new Error(`runtime_tool_quality_registry_reason_surface_unmapped:${reason}:${surface}`);
    }
    const actionRegistry = registry.actionByReason.get(reason) ?? null;
    candidates.push({
      reason,
      actionFamily: reasonRegistry.actionFamily,
      actionRequired: actionRegistry?.actionRequired ?? null,
      defaultNextStep: actionRegistry?.defaultNextStepBySurface?.[surface] ?? null,
      priority,
    });
  }
  return candidates.sort((left, right) => (
    left.priority - right.priority || left.reason.localeCompare(right.reason)
  ))[0] ?? null;
}

export function readRuntimeToolDescribeData(runtimeToolDescribeReportPath) {
  if (!runtimeToolDescribeReportPath || !existsSync(runtimeToolDescribeReportPath)) {
    return {
      report: null,
      governance_payload: null,
      ownership_payload: null,
      surface_execution_payload: null,
      report_parse_error: null,
    };
  }
  try {
    const report = JSON.parse(readFileSync(runtimeToolDescribeReportPath, "utf8"));
    const resultPayload = (id) => {
      const item = Array.isArray(report.results)
        ? report.results.find((row) => row && row.id === id)
        : null;
      return typeof item?.output === "string" ? parseJson(item.output) : null;
    };
    return {
      report,
      governance_payload: resultPayload("runtime-tool-governance"),
      ownership_payload: resultPayload("runtime-tool-suite-ownership"),
      surface_execution_payload: resultPayload("runtime-tool-surface-execution"),
      report_parse_error: null,
    };
  } catch (error) {
    return {
      report: null,
      governance_payload: null,
      ownership_payload: null,
      surface_execution_payload: null,
      report_parse_error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function runtimeToolDescribeSummary(data, runtimeToolDescribePassed) {
  const summary = { passed: runtimeToolDescribePassed };
  if (data.report_parse_error) {
    return {
      ...summary,
      report_parse_error: data.report_parse_error,
    };
  }
  if (!data.report) {
    return summary;
  }
  const report = data.report;
  const governancePayload = data.governance_payload;
  const surfaceExecutionPayload = data.surface_execution_payload;
  return {
    ...summary,
    ok: report.ok === true,
    runner_schema_version: Number.isFinite(report.schema_version) ? report.schema_version : null,
    contract_count: Number.isFinite(report.contract_count) ? report.contract_count : null,
    completed_count: Number.isFinite(report.completed_count) ? report.completed_count : null,
    include_runtime_describe: report.include_runtime_describe === true,
    diagnostics_self_test: report.diagnostics_self_test === true,
    failed_contract: typeof report.failed_contract === "string" ? report.failed_contract : null,
    failed_contract_detail: isRecord(report.failed_contract_detail) ? report.failed_contract_detail : null,
    runtime_binary: isRecord(report.runtime_binary) ? report.runtime_binary : null,
    diagnostic_summary: isRecord(report.diagnostic_summary) ? report.diagnostic_summary : null,
    runtime_recovery_catalog_rows: Number.isFinite(governancePayload?.runtime_recovery_catalog_rows)
      ? governancePayload.runtime_recovery_catalog_rows
      : null,
    runtime_tool_count: Number.isFinite(governancePayload?.runtime_tool_count)
      ? governancePayload.runtime_tool_count
      : null,
    runtime_default_enabled_count: Number.isFinite(governancePayload?.runtime_default_enabled_count)
      ? governancePayload.runtime_default_enabled_count
      : null,
    runtime_tool_manifest_fingerprint:
      typeof governancePayload?.runtime_tool_manifest_fingerprint === "string"
        ? governancePayload.runtime_tool_manifest_fingerprint
        : null,
    gateway_tool_manifest_fingerprint:
      typeof governancePayload?.gateway_tool_manifest_fingerprint === "string"
        ? governancePayload.gateway_tool_manifest_fingerprint
        : null,
    runtime_schema_profile_count: Number.isFinite(governancePayload?.runtime_schema_profile_count)
      ? governancePayload.runtime_schema_profile_count
      : null,
    runtime_schema_budget_violations: Number.isFinite(governancePayload?.runtime_schema_budget_violations)
      ? governancePayload.runtime_schema_budget_violations
      : null,
    runtime_tool_manifest_match:
      typeof governancePayload?.runtime_tool_manifest_match === "boolean"
        ? governancePayload.runtime_tool_manifest_match
        : null,
    runtime_tool_manifest_order_match:
      typeof governancePayload?.runtime_tool_manifest_order_match === "boolean"
        ? governancePayload.runtime_tool_manifest_order_match
        : null,
    runtime_default_manifest_match:
      typeof governancePayload?.runtime_default_manifest_match === "boolean"
        ? governancePayload.runtime_default_manifest_match
        : null,
    runtime_default_manifest_order_match:
      typeof governancePayload?.runtime_default_manifest_order_match === "boolean"
        ? governancePayload.runtime_default_manifest_order_match
        : null,
    runtime_only_tools: stringArray(governancePayload?.runtime_only_tools),
    gateway_only_tools: stringArray(governancePayload?.gateway_only_tools),
    runtime_default_only_tools: stringArray(governancePayload?.runtime_default_only_tools),
    gateway_default_only_tools: stringArray(governancePayload?.gateway_default_only_tools),
    runtime_tool_order_mismatch: isRecord(governancePayload?.runtime_tool_order_mismatch)
      ? governancePayload.runtime_tool_order_mismatch
      : null,
    runtime_default_order_mismatch: isRecord(governancePayload?.runtime_default_order_mismatch)
      ? governancePayload.runtime_default_order_mismatch
      : null,
    runtime_schema_budget_violation_profiles: stringArray(
      governancePayload?.runtime_schema_budget_violation_profiles,
    ),
    runtime_schema_profile_summary: recordArray(governancePayload?.runtime_schema_profile_summary),
    runtime_schema_budget_violation_details: recordArray(
      governancePayload?.runtime_schema_budget_violation_details,
    ),
    runtime_surface_execution_smoke_passed:
      typeof surfaceExecutionPayload?.ok === "boolean" ? surfaceExecutionPayload.ok : null,
    runtime_surface_execution_profiles_smoked: stringArray(
      surfaceExecutionPayload?.profiles_smoked,
    ),
    runtime_surface_execution_allowed_workflow_successes:
      Number.isFinite(surfaceExecutionPayload?.allowed_workflow_successes)
        ? surfaceExecutionPayload.allowed_workflow_successes
        : null,
    runtime_surface_execution_hidden_tool_rejections:
      Number.isFinite(surfaceExecutionPayload?.hidden_tool_rejections)
        ? surfaceExecutionPayload.hidden_tool_rejections
        : null,
    runtime_surface_execution_hidden_arg_rejections:
      Number.isFinite(surfaceExecutionPayload?.hidden_arg_rejections)
        ? surfaceExecutionPayload.hidden_arg_rejections
        : null,
    runtime_surface_execution_schema_projection_checks:
      Number.isFinite(surfaceExecutionPayload?.schema_projection_checks)
        ? surfaceExecutionPayload.schema_projection_checks
        : null,
    gateway_only_recovery_actions: stringArray(governancePayload?.gateway_only_recovery_actions),
  };
}

export function resolveRuntimeToolQualityActionableNextStep(describeSummary, diagnosticSummary, defaultNextStep) {
  if (typeof describeSummary.failed_contract_detail?.suggested_command === "string") {
    return describeSummary.failed_contract_detail.suggested_command;
  }
  if (typeof diagnosticSummary?.reproduce === "string") {
    return diagnosticSummary.reproduce;
  }
  return typeof defaultNextStep === "string" && defaultNextStep.trim().length > 0
    ? defaultNextStep
    : null;
}

export function runtimeToolQualitySummary(describeSummary, data, registry = readRuntimeToolQualityRegistry()) {
  const diagnosticSummary = isRecord(describeSummary.diagnostic_summary)
    ? describeSummary.diagnostic_summary
    : null;
  const ownershipPayload = isRecord(data.ownership_payload)
    ? data.ownership_payload
    : null;
  const schemaBudgetViolations = Number.isFinite(describeSummary.runtime_schema_budget_violations)
    ? describeSummary.runtime_schema_budget_violations
    : Number.isFinite(diagnosticSummary?.schema_budget_violations)
      ? diagnosticSummary.schema_budget_violations
      : null;
  const contractCoverageComplete = Number.isFinite(describeSummary.contract_count)
    && Number.isFinite(describeSummary.completed_count)
    && describeSummary.contract_count === describeSummary.completed_count;
  const runnerContractCoverage = typeof ownershipPayload?.runner_covers_all_runtime_tool_contracts === "boolean"
    ? ownershipPayload.runner_covers_all_runtime_tool_contracts
    : null;
  const tmpFixtureIsolation = typeof ownershipPayload?.all_contract_tmp_fixtures_isolated === "boolean"
    ? ownershipPayload.all_contract_tmp_fixtures_isolated
    : null;
  const runtimeBinaryExists = typeof describeSummary.runtime_binary?.exists === "boolean"
    ? describeSummary.runtime_binary.exists
    : null;
  const failureReasons = [];
  if (describeSummary.report_parse_error) {
    pushRuntimeToolQualityFailureReason(failureReasons, "report_parse_error", registry);
  }
  if (describeSummary.passed !== true || describeSummary.ok !== true) {
    pushRuntimeToolQualityFailureReason(failureReasons, "runtime_tool_describe_failed", registry);
  }
  if (describeSummary.diagnostics_self_test !== true) {
    pushRuntimeToolQualityFailureReason(failureReasons, "diagnostics_self_test_failed", registry);
  }
  if (runtimeBinaryExists !== true) {
    pushRuntimeToolQualityFailureReason(failureReasons, "runtime_binary_missing", registry);
  }
  if (!contractCoverageComplete) {
    pushRuntimeToolQualityFailureReason(failureReasons, "contract_coverage_incomplete", registry);
  }
  if (runnerContractCoverage !== true) {
    pushRuntimeToolQualityFailureReason(failureReasons, "runner_contract_coverage_missing", registry);
  }
  if (tmpFixtureIsolation !== true) {
    pushRuntimeToolQualityFailureReason(failureReasons, "tmp_fixture_isolation_missing", registry);
  }
  if (schemaBudgetViolations === null) {
    pushRuntimeToolQualityFailureReason(failureReasons, "schema_budget_unknown", registry);
  } else if (schemaBudgetViolations !== 0) {
    pushRuntimeToolQualityFailureReason(failureReasons, "schema_budget_violated", registry);
  }
  const status = failureReasons.length > 0 ? "fail" : "ok";
  const schemaBudgetStatus = schemaBudgetViolations === null
    ? "unknown"
    : schemaBudgetViolations === 0
      ? "passed"
      : "failed";
  const actionSignal = resolveRuntimeToolQualitySignal(failureReasons, "release", registry);
  const actionableNextStep = resolveRuntimeToolQualityActionableNextStep(
    describeSummary,
    diagnosticSummary,
    actionSignal?.defaultNextStep ?? null,
  );
  return {
    quality_schema_version: runtimeToolQualitySchemaVersion,
    status,
    passed: status === "ok",
    source: "runtime_tool_describe",
    failure_reasons: failureReasons,
    warning_reasons: [],
    runner_schema_version: describeSummary.runner_schema_version ?? null,
    diagnostic_summary_status: diagnosticSummary?.status ?? null,
    diagnostics_self_test: describeSummary.diagnostics_self_test === true,
    contract_count: describeSummary.contract_count ?? null,
    completed_count: describeSummary.completed_count ?? null,
    contract_coverage_complete: contractCoverageComplete,
    runner_contract_coverage: runnerContractCoverage,
    tmp_fixture_isolation: tmpFixtureIsolation,
    schema_budget_status: schemaBudgetStatus,
    schema_budget_violations: schemaBudgetViolations,
    runtime_binary_exists: runtimeBinaryExists,
    runtime_tool_count: Number.isFinite(describeSummary.runtime_tool_count)
      ? describeSummary.runtime_tool_count
      : null,
    runtime_default_enabled_count: Number.isFinite(describeSummary.runtime_default_enabled_count)
      ? describeSummary.runtime_default_enabled_count
      : null,
    runtime_tool_manifest_fingerprint:
      typeof describeSummary.runtime_tool_manifest_fingerprint === "string"
        ? describeSummary.runtime_tool_manifest_fingerprint
        : null,
    gateway_tool_manifest_fingerprint:
      typeof describeSummary.gateway_tool_manifest_fingerprint === "string"
        ? describeSummary.gateway_tool_manifest_fingerprint
        : null,
    runtime_tool_manifest_match:
      typeof describeSummary.runtime_tool_manifest_match === "boolean"
        ? describeSummary.runtime_tool_manifest_match
        : null,
    runtime_tool_manifest_order_match:
      typeof describeSummary.runtime_tool_manifest_order_match === "boolean"
        ? describeSummary.runtime_tool_manifest_order_match
        : null,
    runtime_default_manifest_match:
      typeof describeSummary.runtime_default_manifest_match === "boolean"
        ? describeSummary.runtime_default_manifest_match
        : null,
    runtime_default_manifest_order_match:
      typeof describeSummary.runtime_default_manifest_order_match === "boolean"
        ? describeSummary.runtime_default_manifest_order_match
        : null,
    runtime_only_tools: stringArray(describeSummary.runtime_only_tools),
    gateway_only_tools: stringArray(describeSummary.gateway_only_tools),
    runtime_default_only_tools: stringArray(describeSummary.runtime_default_only_tools),
    gateway_default_only_tools: stringArray(describeSummary.gateway_default_only_tools),
    runtime_tool_order_mismatch: isRecord(describeSummary.runtime_tool_order_mismatch)
      ? describeSummary.runtime_tool_order_mismatch
      : null,
    runtime_default_order_mismatch: isRecord(describeSummary.runtime_default_order_mismatch)
      ? describeSummary.runtime_default_order_mismatch
      : null,
    runtime_schema_budget_violation_profiles: stringArray(
      describeSummary.runtime_schema_budget_violation_profiles,
    ),
    runtime_schema_profile_summary: recordArray(describeSummary.runtime_schema_profile_summary),
    runtime_schema_budget_violation_details: recordArray(
      describeSummary.runtime_schema_budget_violation_details,
    ),
    runtime_surface_execution_smoke_passed:
      typeof describeSummary.runtime_surface_execution_smoke_passed === "boolean"
        ? describeSummary.runtime_surface_execution_smoke_passed
        : null,
    runtime_surface_execution_profiles_smoked: stringArray(
      describeSummary.runtime_surface_execution_profiles_smoked,
    ),
    runtime_surface_execution_allowed_workflow_successes:
      Number.isFinite(describeSummary.runtime_surface_execution_allowed_workflow_successes)
        ? describeSummary.runtime_surface_execution_allowed_workflow_successes
        : null,
    runtime_surface_execution_hidden_tool_rejections:
      Number.isFinite(describeSummary.runtime_surface_execution_hidden_tool_rejections)
        ? describeSummary.runtime_surface_execution_hidden_tool_rejections
        : null,
    runtime_surface_execution_hidden_arg_rejections:
      Number.isFinite(describeSummary.runtime_surface_execution_hidden_arg_rejections)
        ? describeSummary.runtime_surface_execution_hidden_arg_rejections
        : null,
    runtime_surface_execution_schema_projection_checks:
      Number.isFinite(describeSummary.runtime_surface_execution_schema_projection_checks)
        ? describeSummary.runtime_surface_execution_schema_projection_checks
        : null,
    gateway_only_recovery_actions: Array.isArray(describeSummary.gateway_only_recovery_actions)
      ? describeSummary.gateway_only_recovery_actions
      : [],
    failed_contract: describeSummary.failed_contract ?? null,
    action_family: actionSignal?.actionFamily ?? "none",
    action_reason: actionSignal?.reason ?? null,
    action_required: actionSignal?.actionRequired ?? null,
    actionable_next_step: actionableNextStep,
    report_parse_error: describeSummary.report_parse_error ?? null,
  };
}

export function buildCoreReleaseReport(input) {
  const runtimeToolData = readRuntimeToolDescribeData(input.runtimeToolDescribeReportPath);
  const runtimeToolDescribe = runtimeToolDescribeSummary(runtimeToolData, input.runtimeToolDescribePassed);
  const runtimeToolQuality = runtimeToolQualitySummary(runtimeToolDescribe, runtimeToolData);
  return {
    schema_version: 1,
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    overall_passed: input.exitCode === 0,
    exit_code: input.exitCode,
    fail_reason: input.failReason,
    options: {
      allow_stub: input.allowStub,
      skip_pack_dryrun: input.skipPack,
    },
    checks: {
      verify_packages: { passed: input.verifyPassed },
      launcher_lookup_chain: { passed: input.launcherPassed },
      runtime_tool_describe: runtimeToolDescribe,
      runtime_tool_quality: runtimeToolQuality,
      pack_dryrun: { passed: input.packPassed, skipped: input.packSkipped },
    },
  };
}

export function writeCoreReleaseReport(reportPath, report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function parseCliArgs(argv) {
  return {
    reportPath: argv[0] ?? "",
    exitCode: Number.parseInt(argv[1] ?? "1", 10),
    failReason: argv[2] ?? "",
    allowStub: parseBoolean(argv[3] ?? "0"),
    skipPack: parseBoolean(argv[4] ?? "0"),
    verifyPassed: parseBoolean(argv[5] ?? "false"),
    launcherPassed: parseBoolean(argv[6] ?? "false"),
    runtimeToolDescribePassed: parseBoolean(argv[7] ?? "false"),
    packPassed: parseBoolean(argv[8] ?? "false"),
    packSkipped: parseBoolean(argv[9] ?? "false"),
    runtimeToolDescribeReportPath: argv[10] ?? "",
  };
}

function main() {
  const input = parseCliArgs(process.argv.slice(2));
  const report = buildCoreReleaseReport(input);
  writeCoreReleaseReport(input.reportPath, report);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
