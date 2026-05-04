import { expect } from "./assertions";
import type { RuntimeToolQualityRepoFiles } from "./repo-files";

export function runTestCoverageCase(files: RuntimeToolQualityRepoFiles): void {
  expect(
    files.releaseReportTest.includes("runtime_tool_quality.source must be runtime_tool_describe")
      && files.releaseReportTest.includes("runtime_tool_quality.schema_budget_status must be unknown")
      && files.releaseReportTest.includes("runtime_tool_quality.action_family must classify forced failure as runner_contract")
      && files.releaseReportTest.includes("runtime_tool_quality.action_reason must preserve the decisive failure reason")
      && files.releaseReportTest.includes("runtime_tool_quality.action_required must point to failed contract action")
      && files.releaseReportTest.includes("surface execution smoke failures with a focused action")
      && files.releaseReportTest.includes("surface_smoke=true")
      && files.releaseReportTest.includes("surface_error_data=275")
      && files.releaseReportTest.includes("surface_action_catalog=20")
      && files.releaseReportTest.includes("surface execution threshold failures with a focused action")
      && files.releaseReportTest.includes("recovery_prompt=passed")
      && files.releaseReportTest.includes("recovery_prompt_quality_failed")
      && files.releaseReportTest.includes("recovery prompt quality failures with a focused action")
      && files.releaseReportTest.includes("success runtime_tool_quality.runtime_recovery_prompt_quality_status must be passed")
      && files.releaseReportTest.includes("success runtime_tool_quality.runtime_surface_execution_threshold_status must be passed")
      && files.releaseReportTest.includes("success runtime_tool_quality.schema_budget_status must be passed")
      && files.releaseReportTest.includes("success runtime_tool_quality.runtime_schema_profile_summary must describe 7 profiles")
      && files.releaseReportTest.includes("success runtime_tool_quality.runtime_schema_budget_violation_details must be empty array")
      && files.releaseReportTest.includes("success runtime_tool_quality.runtime_only_tools must be empty array")
      && files.releaseReportTest.includes("success runtime_tool_describe.runtime_tool_order_mismatch must be null"),
    "release-report regression must assert runtime_tool_quality source and schema budget status",
  );

  expect(
    files.startSmokeStatusRuntimeFlows.includes("quality_schema_budget_status")
      && files.startSmokeStatusRuntimeFlows.includes("quality_action_family")
      && files.startSmokeStatusRuntimeFlows.includes("quality_action_reason")
      && files.startSmokeStatusRuntimeFlows.includes("quality_action_required")
      && files.startSmokeStatusRuntimeFlows.includes("quality_actionable_next_step_has_runtime_status")
      && files.startSmokeStatusTsRustRuntimeToolsStatus.includes("status_runtime_tool_quality_schema_budget_status")
      && files.gatewayRuntimeToolAssertions.includes("status_runtime_tool_quality_schema_budget_status"),
    "status smoke must assert runtime_tools_quality schema budget status",
  );
}
