import { existsSync, readFileSync } from "node:fs";
import {
  isRecord,
  parseJson,
  recordArray,
  stringArray,
} from "./utils.mjs";

export function readRuntimeToolDescribeData(runtimeToolDescribeReportPath) {
  if (!runtimeToolDescribeReportPath || !existsSync(runtimeToolDescribeReportPath)) {
    return {
      report: null,
      governance_payload: null,
      ownership_payload: null,
      events_payload: null,
      recovery_flow_payload: null,
      recovery_timeline_payload: null,
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
      events_payload: resultPayload("runtime-tool-events"),
      recovery_flow_payload: resultPayload("runtime-tool-recovery-flow"),
      recovery_timeline_payload: resultPayload("runtime-tool-recovery-timeline"),
      surface_execution_payload: resultPayload("runtime-tool-surface-execution"),
      report_parse_error: null,
    };
  } catch (error) {
    return {
      report: null,
      governance_payload: null,
      ownership_payload: null,
      events_payload: null,
      recovery_flow_payload: null,
      recovery_timeline_payload: null,
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
  const eventsPayload = data.events_payload;
  const recoveryFlowPayload = data.recovery_flow_payload;
  const recoveryTimelinePayload = data.recovery_timeline_payload;
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
    runtime_surface_execution_structured_error_data_checks:
      Number.isFinite(surfaceExecutionPayload?.structured_error_data_checks)
        ? surfaceExecutionPayload.structured_error_data_checks
        : null,
    runtime_surface_execution_recovery_action_catalog_checks:
      Number.isFinite(surfaceExecutionPayload?.recovery_action_catalog_checks)
        ? surfaceExecutionPayload.recovery_action_catalog_checks
        : null,
    runtime_recovery_feedback_prompt_action_first:
      typeof eventsPayload?.feedback_prompt_action_first === "boolean"
        ? eventsPayload.feedback_prompt_action_first
        : null,
    runtime_recovery_feedback_prompt_action_in_catalog:
      typeof eventsPayload?.feedback_prompt_action_in_catalog === "boolean"
        ? eventsPayload.feedback_prompt_action_in_catalog
        : null,
    runtime_recovery_legacy_action_prompt_fallback:
      typeof eventsPayload?.legacy_action_prompt_fallback === "string"
        ? eventsPayload.legacy_action_prompt_fallback
        : null,
    runtime_recovery_feedback_prompt_budget_max_chars:
      Number.isFinite(eventsPayload?.feedback_prompt_budget_max_chars)
        ? eventsPayload.feedback_prompt_budget_max_chars
        : null,
    runtime_recovery_feedback_prompt_budget_within_limit:
      typeof eventsPayload?.feedback_prompt_budget_within_limit === "boolean"
        ? eventsPayload.feedback_prompt_budget_within_limit
        : null,
    runtime_recovery_feedback_prompt_budget_truncated_details:
      typeof eventsPayload?.feedback_prompt_budget_truncated_details === "boolean"
        ? eventsPayload.feedback_prompt_budget_truncated_details
        : null,
    runtime_recovery_flow_automatic_recovery_denied:
      typeof recoveryFlowPayload?.first_automatic_recovery_denied === "boolean"
        ? recoveryFlowPayload.first_automatic_recovery_denied
        : null,
    runtime_recovery_flow_guarded_nonrecoverable_bypasses_guard:
      typeof recoveryFlowPayload?.guarded_nonrecoverable_bypasses_guard === "boolean"
        ? recoveryFlowPayload.guarded_nonrecoverable_bypasses_guard
        : null,
    runtime_recovery_timeline_legacy_raw_action:
      typeof recoveryTimelinePayload?.legacy_raw_action === "string"
        ? recoveryTimelinePayload.legacy_raw_action
        : null,
    runtime_recovery_timeline_legacy_effective_action:
      typeof recoveryTimelinePayload?.legacy_effective_action === "string"
        ? recoveryTimelinePayload.legacy_effective_action
        : null,
    gateway_only_recovery_actions: stringArray(governancePayload?.gateway_only_recovery_actions),
  };
}
