#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readRuntimeToolDescribeData,
  runtimeToolDescribeSummary,
} from "./runtime-tool-quality-report/describe.mjs";
import {
  isRecord,
  parseBoolean,
  recordArray,
  stringArray,
} from "./runtime-tool-quality-report/utils.mjs";

export {
  readRuntimeToolDescribeData,
  runtimeToolDescribeSummary,
} from "./runtime-tool-quality-report/describe.mjs";
export { parseJson } from "./runtime-tool-quality-report/utils.mjs";

export const runtimeToolQualitySchemaVersion = 1;

export const runtimeSurfaceExecutionQualityThresholds = Object.freeze({
  required_profiles_smoked: Object.freeze([
    "browser",
    "browser_advanced",
    "coding",
    "context",
    "full_debug",
    "mcp",
    "minimal",
  ]),
  allowed_workflow_successes_min: 2,
  hidden_tool_rejections_min: 1,
  hidden_arg_rejections_min: 4,
  schema_projection_checks_min: 55,
  structured_error_data_checks_min: 275,
  recovery_action_catalog_checks_min: 20,
});

export const runtimeRecoveryPromptQualityExpectations = Object.freeze({
  feedback_prompt_action_first: true,
  feedback_prompt_action_in_catalog: true,
  legacy_action_prompt_fallback: "inspect_error_and_switch_strategy",
  feedback_prompt_budget_max_chars: 1800,
  feedback_prompt_budget_within_limit: true,
  feedback_prompt_budget_truncated_details: true,
  flow_automatic_recovery_denied: true,
  flow_guarded_nonrecoverable_bypasses_guard: true,
  timeline_legacy_raw_action: "observe_and_continue",
  timeline_legacy_effective_action: "inspect_error_and_switch_strategy",
});

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

function numericThresholdFailure(field, actual, expectedMin) {
  return Number.isFinite(actual) && actual >= expectedMin
    ? null
    : {
      field,
      actual: Number.isFinite(actual) ? actual : null,
      expected_min: expectedMin,
    };
}

export function runtimeSurfaceExecutionQualityFailures(
  describeSummary,
  thresholds = runtimeSurfaceExecutionQualityThresholds,
) {
  const failures = [];
  const profilesSmoked = stringArray(describeSummary.runtime_surface_execution_profiles_smoked);
  const missingProfiles = thresholds.required_profiles_smoked.filter(
    (profile) => !profilesSmoked.includes(profile),
  );
  if (missingProfiles.length > 0) {
    failures.push({
      field: "runtime_surface_execution_profiles_smoked",
      actual: profilesSmoked,
      expected_contains: thresholds.required_profiles_smoked,
      missing: missingProfiles,
    });
  }
  for (const failure of [
    numericThresholdFailure(
      "runtime_surface_execution_allowed_workflow_successes",
      describeSummary.runtime_surface_execution_allowed_workflow_successes,
      thresholds.allowed_workflow_successes_min,
    ),
    numericThresholdFailure(
      "runtime_surface_execution_hidden_tool_rejections",
      describeSummary.runtime_surface_execution_hidden_tool_rejections,
      thresholds.hidden_tool_rejections_min,
    ),
    numericThresholdFailure(
      "runtime_surface_execution_hidden_arg_rejections",
      describeSummary.runtime_surface_execution_hidden_arg_rejections,
      thresholds.hidden_arg_rejections_min,
    ),
    numericThresholdFailure(
      "runtime_surface_execution_schema_projection_checks",
      describeSummary.runtime_surface_execution_schema_projection_checks,
      thresholds.schema_projection_checks_min,
    ),
    numericThresholdFailure(
      "runtime_surface_execution_structured_error_data_checks",
      describeSummary.runtime_surface_execution_structured_error_data_checks,
      thresholds.structured_error_data_checks_min,
    ),
    numericThresholdFailure(
      "runtime_surface_execution_recovery_action_catalog_checks",
      describeSummary.runtime_surface_execution_recovery_action_catalog_checks,
      thresholds.recovery_action_catalog_checks_min,
    ),
  ]) {
    if (failure) {
      failures.push(failure);
    }
  }
  return failures;
}

export function runtimeRecoveryPromptQualityFailures(
  describeSummary,
  expectations = runtimeRecoveryPromptQualityExpectations,
) {
  const failures = [];
  const expectField = (field, actual, expected) => {
    if (actual !== expected) {
      failures.push({ field, actual: actual ?? null, expected });
    }
  };
  expectField(
    "runtime_recovery_feedback_prompt_action_first",
    describeSummary.runtime_recovery_feedback_prompt_action_first,
    expectations.feedback_prompt_action_first,
  );
  expectField(
    "runtime_recovery_feedback_prompt_action_in_catalog",
    describeSummary.runtime_recovery_feedback_prompt_action_in_catalog,
    expectations.feedback_prompt_action_in_catalog,
  );
  expectField(
    "runtime_recovery_legacy_action_prompt_fallback",
    describeSummary.runtime_recovery_legacy_action_prompt_fallback,
    expectations.legacy_action_prompt_fallback,
  );
  expectField(
    "runtime_recovery_feedback_prompt_budget_max_chars",
    describeSummary.runtime_recovery_feedback_prompt_budget_max_chars,
    expectations.feedback_prompt_budget_max_chars,
  );
  expectField(
    "runtime_recovery_feedback_prompt_budget_within_limit",
    describeSummary.runtime_recovery_feedback_prompt_budget_within_limit,
    expectations.feedback_prompt_budget_within_limit,
  );
  expectField(
    "runtime_recovery_feedback_prompt_budget_truncated_details",
    describeSummary.runtime_recovery_feedback_prompt_budget_truncated_details,
    expectations.feedback_prompt_budget_truncated_details,
  );
  expectField(
    "runtime_recovery_flow_automatic_recovery_denied",
    describeSummary.runtime_recovery_flow_automatic_recovery_denied,
    expectations.flow_automatic_recovery_denied,
  );
  expectField(
    "runtime_recovery_flow_guarded_nonrecoverable_bypasses_guard",
    describeSummary.runtime_recovery_flow_guarded_nonrecoverable_bypasses_guard,
    expectations.flow_guarded_nonrecoverable_bypasses_guard,
  );
  expectField(
    "runtime_recovery_timeline_legacy_raw_action",
    describeSummary.runtime_recovery_timeline_legacy_raw_action,
    expectations.timeline_legacy_raw_action,
  );
  expectField(
    "runtime_recovery_timeline_legacy_effective_action",
    describeSummary.runtime_recovery_timeline_legacy_effective_action,
    expectations.timeline_legacy_effective_action,
  );
  return failures;
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
  const shouldEvaluateSurfaceExecutionThresholds = describeSummary.passed === true && describeSummary.ok === true;
  const surfaceExecutionThresholdFailures = shouldEvaluateSurfaceExecutionThresholds
    ? runtimeSurfaceExecutionQualityFailures(describeSummary)
    : [];
  const shouldEvaluateRecoveryPromptQuality = describeSummary.passed === true && describeSummary.ok === true;
  const recoveryPromptQualityFailures = shouldEvaluateRecoveryPromptQuality
    ? runtimeRecoveryPromptQualityFailures(describeSummary)
    : [];
  const failureReasons = [];
  if (describeSummary.report_parse_error) {
    pushRuntimeToolQualityFailureReason(failureReasons, "report_parse_error", registry);
  }
  if (
    describeSummary.failed_contract === "runtime-tool-surface-execution"
    || describeSummary.runtime_surface_execution_smoke_passed === false
  ) {
    pushRuntimeToolQualityFailureReason(failureReasons, "surface_execution_smoke_failed", registry);
  }
  if (surfaceExecutionThresholdFailures.length > 0) {
    pushRuntimeToolQualityFailureReason(
      failureReasons,
      "surface_execution_evidence_below_threshold",
      registry,
    );
  }
  if (recoveryPromptQualityFailures.length > 0) {
    pushRuntimeToolQualityFailureReason(
      failureReasons,
      "recovery_prompt_quality_failed",
      registry,
    );
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
    runtime_surface_execution_structured_error_data_checks:
      Number.isFinite(describeSummary.runtime_surface_execution_structured_error_data_checks)
        ? describeSummary.runtime_surface_execution_structured_error_data_checks
        : null,
    runtime_surface_execution_recovery_action_catalog_checks:
      Number.isFinite(describeSummary.runtime_surface_execution_recovery_action_catalog_checks)
        ? describeSummary.runtime_surface_execution_recovery_action_catalog_checks
        : null,
    runtime_surface_execution_threshold_status:
      shouldEvaluateSurfaceExecutionThresholds
        ? surfaceExecutionThresholdFailures.length === 0 ? "passed" : "failed"
        : null,
    runtime_surface_execution_thresholds: runtimeSurfaceExecutionQualityThresholds,
    runtime_surface_execution_threshold_failures: surfaceExecutionThresholdFailures,
    runtime_recovery_prompt_quality_status:
      shouldEvaluateRecoveryPromptQuality
        ? recoveryPromptQualityFailures.length === 0 ? "passed" : "failed"
        : null,
    runtime_recovery_prompt_quality_expectations: runtimeRecoveryPromptQualityExpectations,
    runtime_recovery_prompt_quality_failures: recoveryPromptQualityFailures,
    runtime_recovery_feedback_prompt_action_first:
      typeof describeSummary.runtime_recovery_feedback_prompt_action_first === "boolean"
        ? describeSummary.runtime_recovery_feedback_prompt_action_first
        : null,
    runtime_recovery_feedback_prompt_action_in_catalog:
      typeof describeSummary.runtime_recovery_feedback_prompt_action_in_catalog === "boolean"
        ? describeSummary.runtime_recovery_feedback_prompt_action_in_catalog
        : null,
    runtime_recovery_legacy_action_prompt_fallback:
      typeof describeSummary.runtime_recovery_legacy_action_prompt_fallback === "string"
        ? describeSummary.runtime_recovery_legacy_action_prompt_fallback
        : null,
    runtime_recovery_feedback_prompt_budget_max_chars:
      Number.isFinite(describeSummary.runtime_recovery_feedback_prompt_budget_max_chars)
        ? describeSummary.runtime_recovery_feedback_prompt_budget_max_chars
        : null,
    runtime_recovery_feedback_prompt_budget_within_limit:
      typeof describeSummary.runtime_recovery_feedback_prompt_budget_within_limit === "boolean"
        ? describeSummary.runtime_recovery_feedback_prompt_budget_within_limit
        : null,
    runtime_recovery_feedback_prompt_budget_truncated_details:
      typeof describeSummary.runtime_recovery_feedback_prompt_budget_truncated_details === "boolean"
        ? describeSummary.runtime_recovery_feedback_prompt_budget_truncated_details
        : null,
    runtime_recovery_flow_automatic_recovery_denied:
      typeof describeSummary.runtime_recovery_flow_automatic_recovery_denied === "boolean"
        ? describeSummary.runtime_recovery_flow_automatic_recovery_denied
        : null,
    runtime_recovery_flow_guarded_nonrecoverable_bypasses_guard:
      typeof describeSummary.runtime_recovery_flow_guarded_nonrecoverable_bypasses_guard === "boolean"
        ? describeSummary.runtime_recovery_flow_guarded_nonrecoverable_bypasses_guard
        : null,
    runtime_recovery_timeline_legacy_raw_action:
      typeof describeSummary.runtime_recovery_timeline_legacy_raw_action === "string"
        ? describeSummary.runtime_recovery_timeline_legacy_raw_action
        : null,
    runtime_recovery_timeline_legacy_effective_action:
      typeof describeSummary.runtime_recovery_timeline_legacy_effective_action === "string"
        ? describeSummary.runtime_recovery_timeline_legacy_effective_action
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

export function checkRuntimeToolDescribeQuality(runtimeToolDescribeReportPath) {
  const runtimeToolData = readRuntimeToolDescribeData(runtimeToolDescribeReportPath);
  const runtimeToolDescribe = runtimeToolDescribeSummary(runtimeToolData, true);
  const runtimeToolQuality = runtimeToolQualitySummary(runtimeToolDescribe, runtimeToolData);
  if (!runtimeToolQuality.passed) {
    process.stderr.write(`${JSON.stringify({
      marker: "runtime_tool_quality_failed",
      action_reason: runtimeToolQuality.action_reason,
      action_required: runtimeToolQuality.action_required,
      failure_reasons: runtimeToolQuality.failure_reasons,
      runtime_surface_execution_threshold_failures:
        runtimeToolQuality.runtime_surface_execution_threshold_failures,
      runtime_recovery_prompt_quality_failures:
        runtimeToolQuality.runtime_recovery_prompt_quality_failures,
    })}\n`);
    return false;
  }
  process.stdout.write(`${JSON.stringify({
    marker: "runtime_tool_quality_passed",
    runtime_surface_execution_threshold_status:
      runtimeToolQuality.runtime_surface_execution_threshold_status,
    runtime_recovery_prompt_quality_status:
      runtimeToolQuality.runtime_recovery_prompt_quality_status,
  })}\n`);
  return true;
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
  const argv = process.argv.slice(2);
  if (argv[0] === "--check-describe-quality") {
    const reportPath = argv[1] ?? "";
    if (!reportPath || !checkRuntimeToolDescribeQuality(reportPath)) {
      process.exit(1);
    }
    return;
  }
  const input = parseCliArgs(argv);
  const report = buildCoreReleaseReport(input);
  writeCoreReleaseReport(input.reportPath, report);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
