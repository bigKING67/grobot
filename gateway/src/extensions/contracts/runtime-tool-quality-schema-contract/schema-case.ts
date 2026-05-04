import {
  expect,
  isObject,
  stringArray,
} from "./assertions";
import {
  actionRegistryByReason,
  expectProductionResolverFailures,
  expectProductionSignalMatchesFixture,
  registryActionFamilies,
  registryActions,
  registryReasonEntries,
  registryReasonsForSurface,
  resolveFixtureSignal,
} from "./registry";

export interface RuntimeToolQualitySchemaCaseResult {
  schemaFailureReasons: string[];
  schemaWarningReasons: string[];
  statusFailureReasons: string[];
  releaseFailureReasons: string[];
  statusWarningReasons: string[];
  schemaActionFamilies: string[];
  schemaActionRequiredIds: string[];
  schemaReleaseDiagnosticFields: string[];
  statusPriorityAction: string;
  releasePriorityAction: string;
}

export function runSchemaCase(input: {
  qualitySchema: unknown;
  sharedContractsReadme: string;
}): RuntimeToolQualitySchemaCaseResult {
  const { qualitySchema, sharedContractsReadme } = input;
  expect(isObject(qualitySchema), "runtime-tool quality schema must be object");
  expect(qualitySchema.schema === "runtime_tool_quality", "runtime-tool quality schema marker");
  expect(qualitySchema.schema_version === 1, "runtime-tool quality schema version");
  expect(sharedContractsReadme.includes("runtime-tool-quality-v1.json"), "shared contract README must list runtime-tool quality schema");

  const schemaStatuses = stringArray(qualitySchema.status, "schema.status");
  const schemaSources = stringArray(qualitySchema.sources, "schema.sources");
  const schemaBudgetStatuses = stringArray(qualitySchema.schema_budget_status, "schema.schema_budget_status");
  const schemaReleaseDiagnosticFields = stringArray(
    qualitySchema.release_diagnostic_fields,
    "schema.release_diagnostic_fields",
  );
  const schemaActionFamilies = registryActionFamilies(qualitySchema.action_families);
  const schemaActionRequired = registryActions(qualitySchema.action_required);
  const schemaFailureReasonEntries = registryReasonEntries(qualitySchema.failure_reasons, "schema.failure_reasons");
  const schemaWarningReasonEntries = registryReasonEntries(qualitySchema.warning_reasons, "schema.warning_reasons");
  const schemaFailureReasons = schemaFailureReasonEntries.map((entry) => entry.reason);
  const schemaWarningReasons = schemaWarningReasonEntries.map((entry) => entry.reason);
  const statusFailureReasons = registryReasonsForSurface(schemaFailureReasonEntries, "status");
  const releaseFailureReasons = registryReasonsForSurface(schemaFailureReasonEntries, "release");
  const statusWarningReasons = registryReasonsForSurface(schemaWarningReasonEntries, "status");
  const schemaActionRequiredIds = schemaActionRequired.map((item) => item.action);
  const schemaActionRequiredReasonSet = new Set(schemaActionRequired.flatMap((item) => item.reasons));
  const schemaReasonSet = new Set([...schemaFailureReasons, ...schemaWarningReasons]);
  const schemaReasonSurfaceByReason = new Map(
    [...schemaFailureReasonEntries, ...schemaWarningReasonEntries].map((entry) => [entry.reason, entry.surfaces]),
  );
  const schemaReasonPriorityEntries = [...schemaFailureReasonEntries, ...schemaWarningReasonEntries];
  const schemaActionByReason = actionRegistryByReason(schemaActionRequired);
  const schemaReasonPriorityByReason = new Map(
    schemaReasonPriorityEntries.map((entry) => [entry.reason, entry]),
  );

  expect(JSON.stringify(schemaStatuses) === JSON.stringify(["ok", "warn", "fail"]), "schema status enum must be stable");
  expect(
    JSON.stringify(schemaSources) === JSON.stringify(["status.runtime_tools", "runtime_tool_describe"]),
    "schema source enum must be stable",
  );
  expect(
    JSON.stringify(schemaBudgetStatuses) === JSON.stringify(["passed", "failed", "unknown"]),
    "schema budget status enum must be stable",
  );
  expect(
    schemaReleaseDiagnosticFields.includes("runtime_only_tools")
      && schemaReleaseDiagnosticFields.includes("runtime_tool_order_mismatch")
      && schemaReleaseDiagnosticFields.includes("runtime_default_order_mismatch")
      && schemaReleaseDiagnosticFields.includes("runtime_schema_profile_summary")
      && schemaReleaseDiagnosticFields.includes("runtime_schema_budget_violation_details")
      && schemaReleaseDiagnosticFields.includes("runtime_surface_execution_smoke_passed")
      && schemaReleaseDiagnosticFields.includes("runtime_surface_execution_schema_projection_checks")
      && schemaReleaseDiagnosticFields.includes("runtime_surface_execution_structured_error_data_checks")
      && schemaReleaseDiagnosticFields.includes("runtime_surface_execution_recovery_action_catalog_checks")
      && schemaReleaseDiagnosticFields.includes("runtime_surface_execution_threshold_status")
      && schemaReleaseDiagnosticFields.includes("runtime_surface_execution_threshold_failures")
      && schemaReleaseDiagnosticFields.includes("runtime_recovery_prompt_quality_status")
      && schemaReleaseDiagnosticFields.includes("runtime_recovery_feedback_prompt_action_first")
      && schemaReleaseDiagnosticFields.includes("runtime_recovery_feedback_prompt_budget_max_chars")
      && schemaReleaseDiagnosticFields.includes("runtime_recovery_flow_automatic_recovery_denied")
      && schemaReleaseDiagnosticFields.includes("runtime_recovery_timeline_legacy_effective_action"),
    "schema release diagnostic fields must include manifest diff, schema budget, surface execution, and recovery prompt evidence",
  );
  expect(new Set(schemaActionFamilies).size === schemaActionFamilies.length, "schema action families must be unique");
  expect(new Set(schemaActionRequiredIds).size === schemaActionRequiredIds.length, "schema action_required ids must be unique");
  expect(new Set(schemaFailureReasons).size === schemaFailureReasons.length, "schema failure reasons must be unique");
  expect(new Set(schemaWarningReasons).size === schemaWarningReasons.length, "schema warning reasons must be unique");
  const schemaActionFamilySet = new Set(schemaActionFamilies);
  for (const entry of schemaReasonPriorityEntries) {
    expect(
      schemaActionFamilySet.has(entry.actionFamily),
      `reason action_family must exist in action_families: ${entry.reason}`,
    );
  }
  for (const surface of ["status", "release"] as const) {
    const priorities = schemaReasonPriorityEntries
      .filter((entry) => entry.surfaces.includes(surface))
      .map((entry) => entry.priorityBySurface[surface]);
    expect(
      new Set(priorities).size === priorities.length,
      `schema reason priority_by_surface.${surface} values must be unique`,
    );
  }

  for (const action of schemaActionRequired) {
    for (const reason of action.reasons) {
      expect(schemaReasonSet.has(reason), `action_required reason must exist in reason catalog: ${reason}`);
      const surfaces = schemaReasonSurfaceByReason.get(reason) ?? [];
      for (const surface of surfaces) {
        expect(
          typeof action.defaultNextStep[surface] === "string",
          `action_required ${action.action} must define default_next_step.${surface} for ${reason}`,
        );
      }
    }
  }
  for (const reason of schemaFailureReasons) {
    expect(schemaActionRequiredReasonSet.has(reason), `failure reason must map to action_required: ${reason}`);
  }
  for (const reason of schemaWarningReasons.filter((reason) => reason !== "recovery_health_good")) {
    expect(schemaActionRequiredReasonSet.has(reason), `warning reason must map to action_required: ${reason}`);
  }

  const statusPriorityFixtureReasons = [
    "schema_projection_drift_not_checked",
    "recovery_health_risk",
    "runtime_health_failed",
    "runtime_tools_describe_fallback",
  ] as const;
  const statusPriorityFixture = resolveFixtureSignal({
    reasons: statusPriorityFixtureReasons,
    surface: "status",
    actionByReason: schemaActionByReason,
    reasonByReason: schemaReasonPriorityByReason,
  });
  expect(statusPriorityFixture !== null, "status priority fixture must resolve a decisive signal");
  expect(
    statusPriorityFixture.actionReason === "runtime_health_failed",
    "status priority fixture must choose lowest priority_by_surface.status reason",
  );
  expect(
    statusPriorityFixture.actionFamily === "runtime_environment",
    "status priority fixture must preserve action_family from decisive reason",
  );
  expect(
    statusPriorityFixture.actionRequired === "check_runtime_health",
    "status priority fixture must derive action_required from decisive reason",
  );
  expect(
    String(statusPriorityFixture.defaultNextStep ?? "").includes("Inspect runtime health failure"),
    "status priority fixture must derive default_next_step.status from decisive action",
  );
  expect(statusPriorityFixture.priority === 20, "status priority fixture must expose decisive priority");
  expectProductionSignalMatchesFixture({
    expected: statusPriorityFixture,
    reasons: statusPriorityFixtureReasons,
    surface: "status",
    label: "status priority fixture",
  });

  const releasePriorityFixtureReasons = [
    "schema_budget_violated",
    "runner_contract_coverage_missing",
    "runtime_binary_missing",
    "diagnostics_self_test_failed",
  ] as const;
  const releasePriorityFixture = resolveFixtureSignal({
    reasons: releasePriorityFixtureReasons,
    surface: "release",
    actionByReason: schemaActionByReason,
    reasonByReason: schemaReasonPriorityByReason,
  });
  expect(releasePriorityFixture !== null, "release priority fixture must resolve a decisive signal");
  expect(
    releasePriorityFixture.actionReason === "diagnostics_self_test_failed",
    "release priority fixture must choose lowest priority_by_surface.release reason",
  );
  expect(
    releasePriorityFixture.actionFamily === "diagnostics",
    "release priority fixture must preserve action_family from decisive reason",
  );
  expect(
    releasePriorityFixture.actionRequired === "fix_runtime_tool_runner_diagnostics",
    "release priority fixture must derive action_required from decisive reason",
  );
  expect(
    String(releasePriorityFixture.defaultNextStep ?? "").includes("Fix runtime-tool diagnostics self-test"),
    "release priority fixture must derive default_next_step.release from decisive action",
  );
  expect(releasePriorityFixture.priority === 20, "release priority fixture must expose decisive priority");
  expectProductionSignalMatchesFixture({
    expected: releasePriorityFixture,
    reasons: releasePriorityFixtureReasons,
    surface: "release",
    label: "release priority fixture",
  });
  expectProductionResolverFailures();

  return {
    schemaFailureReasons,
    schemaWarningReasons,
    statusFailureReasons,
    releaseFailureReasons,
    statusWarningReasons,
    schemaActionFamilies,
    schemaActionRequiredIds,
    schemaReleaseDiagnosticFields,
    statusPriorityAction: statusPriorityFixture.actionReason,
    releasePriorityAction: releasePriorityFixture.actionReason,
  };
}
