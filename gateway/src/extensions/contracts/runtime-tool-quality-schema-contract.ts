import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveRuntimeToolQualitySignalFromRegistry } from "../../orchestration/entrypoints/dev-cli/status/runtime-tool-quality-registry";

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function expectIncludes(source: string, fragment: string, message: string): void {
  expect(source.includes(fragment), `${message}: missing ${fragment}`);
}

function expectAllIncludes(source: string, fragments: readonly string[], message: string): void {
  for (const fragment of fragments) {
    expectIncludes(source, fragment, message);
  }
}

function expectThrowsIncludes(run: () => void, fragment: string, message: string): void {
  try {
    run();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    expect(errorMessage.includes(fragment), `${message}: expected ${fragment}, got ${errorMessage}`);
    return;
  }
  throw new Error(`${message}: expected throw containing ${fragment}`);
}

function parseJsonFile(path: string): unknown {
  return JSON.parse(readRepoFile(path));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type RuntimeToolQualitySurface = "status" | "release";

function stringArray(value: unknown, label: string): string[] {
  expect(Array.isArray(value), `${label} must be array`);
  const items = value.map((item) => {
    expect(typeof item === "string", `${label} items must be strings`);
    return item;
  });
  return items;
}

function registryReasonEntries(value: unknown, label: string): {
  reason: string;
  surfaces: RuntimeToolQualitySurface[];
  actionFamily: string;
  priorityBySurface: Record<RuntimeToolQualitySurface, number>;
}[] {
  expect(Array.isArray(value), `${label} must be array`);
  return value.map((item, index) => {
    expect(isObject(item), `${label}[${String(index)}] must be object`);
    expect(typeof item.reason === "string", `${label}[${String(index)}].reason must be string`);
    expect(Array.isArray(item.surfaces), `${label}[${String(index)}].surfaces must be array`);
    const surfaces: RuntimeToolQualitySurface[] = item.surfaces.map((surface, surfaceIndex): RuntimeToolQualitySurface => {
      expect(
        surface === "status" || surface === "release",
        `${label}[${String(index)}].surfaces[${String(surfaceIndex)}] must be status or release`,
      );
      return surface;
    });
    expect(typeof item.action_family === "string", `${label}[${String(index)}].action_family must be string`);
    expect(isObject(item.priority_by_surface), `${label}[${String(index)}].priority_by_surface must be object`);
    const priorityBySurface = {} as Record<RuntimeToolQualitySurface, number>;
    for (const surface of surfaces) {
      const priority = item.priority_by_surface[surface];
      expect(
        typeof priority === "number" && Number.isInteger(priority) && priority > 0,
        `${label}[${String(index)}].priority_by_surface.${surface} must be positive integer`,
      );
      priorityBySurface[surface] = priority;
    }
    return {
      reason: item.reason,
      surfaces,
      actionFamily: item.action_family,
      priorityBySurface,
    };
  });
}

function registryReasonsForSurface(
  entries: readonly { reason: string; surfaces: readonly RuntimeToolQualitySurface[] }[],
  surface: RuntimeToolQualitySurface,
): string[] {
  return entries
    .filter((entry) => entry.surfaces.includes(surface))
    .map((entry) => entry.reason);
}

function registryActionFamilies(value: unknown): string[] {
  expect(Array.isArray(value), "action_families must be array");
  return value.map((item, index) => {
    expect(isObject(item), `action_families[${String(index)}] must be object`);
    expect(typeof item.family === "string", `action_families[${String(index)}].family must be string`);
    return item.family;
  });
}

function registryActions(value: unknown): {
  action: string;
  reasons: string[];
  defaultNextStep: Partial<Record<RuntimeToolQualitySurface, string>>;
}[] {
  expect(Array.isArray(value), "action_required must be array");
  return value.map((item, index) => {
    expect(isObject(item), `action_required[${String(index)}] must be object`);
    expect(typeof item.action === "string", `action_required[${String(index)}].action must be string`);
    expect(Array.isArray(item.reasons), `action_required[${String(index)}].reasons must be array`);
    expect(
      isObject(item.default_next_step),
      `action_required[${String(index)}].default_next_step must be object`,
    );
    const reasons = item.reasons.map((reason, reasonIndex) => {
      expect(
        typeof reason === "string",
        `action_required[${String(index)}].reasons[${String(reasonIndex)}] must be string`,
      );
      return reason;
    });
    const defaultNextStep: Partial<Record<RuntimeToolQualitySurface, string>> = {};
    for (const [surface, nextStep] of Object.entries(item.default_next_step)) {
      expect(
        surface === "status" || surface === "release",
        `action_required[${String(index)}].default_next_step surface must be status or release: ${surface}`,
      );
      expect(
        typeof nextStep === "string" && nextStep.trim().length > 0,
        `action_required[${String(index)}].default_next_step.${surface} must be non-empty string`,
      );
      defaultNextStep[surface] = nextStep;
    }
    expect(reasons.length > 0, `action_required[${String(index)}].reasons must not be empty`);
    expect(
      Object.keys(defaultNextStep).length > 0,
      `action_required[${String(index)}].default_next_step must not be empty`,
    );
    return {
      action: item.action,
      reasons,
      defaultNextStep,
    };
  });
}

function actionRegistryByReason(
  actions: readonly {
    action: string;
    reasons: readonly string[];
    defaultNextStep: Partial<Record<RuntimeToolQualitySurface, string>>;
  }[],
): ReadonlyMap<string, {
  action: string;
  defaultNextStep: Partial<Record<RuntimeToolQualitySurface, string>>;
}> {
  const byReason = new Map<string, {
    action: string;
    defaultNextStep: Partial<Record<RuntimeToolQualitySurface, string>>;
  }>();
  for (const action of actions) {
    for (const reason of action.reasons) {
      byReason.set(reason, {
        action: action.action,
        defaultNextStep: action.defaultNextStep,
      });
    }
  }
  return byReason;
}

function resolveFixtureSignal(input: {
  reasons: readonly string[];
  surface: RuntimeToolQualitySurface;
  actionByReason: ReadonlyMap<string, {
    action: string;
    defaultNextStep: Partial<Record<RuntimeToolQualitySurface, string>>;
  }>;
  reasonByReason: ReadonlyMap<string, {
    actionFamily: string;
    priorityBySurface: Record<RuntimeToolQualitySurface, number>;
  }>;
}): {
  actionReason: string;
  actionFamily: string;
  actionRequired: string;
  defaultNextStep: string | null;
  priority: number;
} | null {
  const candidates: {
    actionReason: string;
    actionFamily: string;
    actionRequired: string;
    defaultNextStep: string | null;
    priority: number;
  }[] = [];
  for (const reason of input.reasons) {
    const reasonEntry = input.reasonByReason.get(reason);
    expect(reasonEntry !== undefined, `priority fixture reason must exist: ${reason}`);
    const priority = reasonEntry.priorityBySurface[input.surface];
    expect(
      typeof priority === "number" && Number.isInteger(priority) && priority > 0,
      `priority fixture reason must define priority_by_surface.${input.surface}: ${reason}`,
    );
    const actionEntry = input.actionByReason.get(reason);
    expect(actionEntry !== undefined, `priority fixture reason must map to action_required: ${reason}`);
    candidates.push({
      actionReason: reason,
      actionFamily: reasonEntry.actionFamily,
      actionRequired: actionEntry.action,
      defaultNextStep: actionEntry.defaultNextStep[input.surface] ?? null,
      priority,
    });
  }
  return candidates.sort((left, right) => (
    left.priority - right.priority || left.actionReason.localeCompare(right.actionReason)
  ))[0] ?? null;
}

function expectProductionSignalMatchesFixture(input: {
  expected: {
    actionReason: string;
    actionFamily: string;
    actionRequired: string;
    defaultNextStep: string | null;
    priority: number;
  };
  reasons: readonly string[];
  surface: RuntimeToolQualitySurface;
  label: string;
}): void {
  const actual = resolveRuntimeToolQualitySignalFromRegistry({
    actionReasons: input.reasons,
    surface: input.surface,
  });
  expect(actual !== null, `${input.label} production resolver must resolve a decisive signal`);
  expect(
    actual.actionReason === input.expected.actionReason,
    `${input.label} production resolver actionReason must match registry fixture`,
  );
  expect(
    actual.actionFamily === input.expected.actionFamily,
    `${input.label} production resolver actionFamily must match registry fixture`,
  );
  expect(
    actual.actionRequired === input.expected.actionRequired,
    `${input.label} production resolver actionRequired must match registry fixture`,
  );
  expect(
    actual.defaultNextStep === input.expected.defaultNextStep,
    `${input.label} production resolver defaultNextStep must match registry fixture`,
  );
  expect(
    actual.priority === input.expected.priority,
    `${input.label} production resolver priority must match registry fixture`,
  );
}

const releaseGate = readRepoFile("scripts/core-release-gate.sh");
const releaseQualityModule = readRepoFile("scripts/lib/runtime-tool-quality-report.mjs");
const statusCommand = readRepoFile("gateway/src/orchestration/entrypoints/dev-cli/status/run-status.ts");
const statusQualityRegistry = readRepoFile(
  "gateway/src/orchestration/entrypoints/dev-cli/status/runtime-tool-quality-registry.ts",
);
const releaseReportTest = readRepoFile("scripts/test-runtime-tool-release-report.mjs");
const startSmokeContract = readRepoFile("gateway/src/extensions/contracts/start-smoke-contract.mjs");
const gatewaySmoke = readRepoFile("gateway/tests/check-gateway-node.mjs");
const sharedContractsReadme = readRepoFile("shared/contracts/README.md");
const qualitySchema = parseJsonFile("shared/contracts/runtime-tool-quality-v1.json");

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
const schemaReasonSurfaceByReason = new Map<string, RuntimeToolQualitySurface[]>(
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
    && schemaReleaseDiagnosticFields.includes("runtime_surface_execution_schema_projection_checks"),
  "schema release diagnostic fields must include manifest diff, schema budget, and surface execution evidence",
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
expectThrowsIncludes(
  () => {
    resolveRuntimeToolQualitySignalFromRegistry({
      actionReasons: ["unknown_runtime_tool_quality_reason"],
      surface: "status",
    });
  },
  "runtime_tool_quality_registry_reason_unmapped:unknown_runtime_tool_quality_reason",
  "production resolver must fail fast for unknown action reasons",
);
expectThrowsIncludes(
  () => {
    resolveRuntimeToolQualitySignalFromRegistry({
      actionReasons: ["runtime_health_failed"],
      surface: "release",
    });
  },
  "runtime_tool_quality_registry_reason_surface_unmapped:runtime_health_failed:release",
  "production resolver must fail fast for wrong-surface action reasons",
);

const releaseGateQualityRequiredFragments = [
  "node scripts/lib/runtime-tool-quality-report.mjs",
  "\"$REPORT_PATH\"",
  "\"$RUNTIME_TOOL_DESCRIBE_REPORT_PATH\"",
] as const;

const releaseQualityModuleRequiredFragments = [
  "runtimeToolQualitySchemaVersion = 1",
  "export function readRuntimeToolQualityRegistry(",
  "priorityBySurface",
  "actionByReason",
  "reasonByReason",
  "export function pushRuntimeToolQualityFailureReason",
  "export function resolveRuntimeToolQualitySignal(reasons, surface",
  "export function resolveRuntimeToolQualityActionableNextStep",
  "export function runtimeToolQualitySummary(describeSummary, data",
  "export function buildCoreReleaseReport(",
  "export function writeCoreReleaseReport(",
  "const status = failureReasons.length > 0 ? \"fail\" : \"ok\"",
  "const actionSignal = resolveRuntimeToolQualitySignal(failureReasons, \"release\", registry)",
  "actionSignal?.defaultNextStep ?? null",
  "quality_schema_version: runtimeToolQualitySchemaVersion",
  "passed: status === \"ok\"",
  "source: \"runtime_tool_describe\"",
  "failure_reasons: failureReasons",
  "warning_reasons: []",
  "schema_budget_status: schemaBudgetStatus",
  "schema_budget_violations: schemaBudgetViolations",
  "runtime_binary_exists: runtimeBinaryExists",
  "runtime_tool_manifest_match:",
  "runtime_tool_manifest_order_match:",
  "runtime_default_manifest_match:",
  "runtime_default_manifest_order_match:",
  "runtime_only_tools: stringArray(",
  "gateway_only_tools: stringArray(",
  "runtime_default_only_tools: stringArray(",
  "gateway_default_only_tools: stringArray(",
  "runtime_tool_order_mismatch:",
  "runtime_default_order_mismatch:",
  "runtime_schema_profile_summary: recordArray(",
  "runtime_schema_budget_violation_details: recordArray(",
  "surface_execution_smoke_failed",
  "runtime_surface_execution_smoke_passed:",
  "runtime_surface_execution_profiles_smoked:",
  "runtime_surface_execution_schema_projection_checks:",
  "action_family: actionSignal?.actionFamily ?? \"none\"",
  "action_reason: actionSignal?.reason ?? null",
  "action_required: actionSignal?.actionRequired ?? null",
  "actionable_next_step:",
] as const;

const statusQualityRequiredFragments = [
  "const RUNTIME_TOOL_QUALITY_SCHEMA_VERSION = 1",
  "type RuntimeToolQualityStatus = \"ok\" | \"warn\" | \"fail\"",
  "type RuntimeToolQualityActionFamily",
  "type RuntimeToolQualityFailureReason",
  "type RuntimeToolQualityWarningReason",
  "type RuntimeToolQualityReason",
  "type RuntimeToolQualityActionRequired",
  "const RUNTIME_TOOL_QUALITY_FAILURE_REASONS",
  "const RUNTIME_TOOL_QUALITY_WARNING_REASONS",
  "interface RuntimeToolQualitySummary",
  "quality_schema_version: typeof RUNTIME_TOOL_QUALITY_SCHEMA_VERSION",
  "status: RuntimeToolQualityStatus",
  "passed: boolean",
  "source: \"status.runtime_tools\"",
  "failure_reasons: RuntimeToolQualityFailureReason[]",
  "warning_reasons: RuntimeToolQualityWarningReason[]",
  "runtime_binary_exists: boolean | null",
  "schema_budget_status: \"passed\" | \"failed\"",
  "schema_budget_violations: number",
  "runtime_describe_source: RuntimeToolEnabledToolsSource",
  "recovery_gate_status: RuntimeToolRecoveryReadinessGateDecision[\"status\"]",
  "action_family: RuntimeToolQualityActionFamily",
  "action_reason: RuntimeToolQualityReason | null",
  "action_required: RuntimeToolQualityActionRequired | null",
  "actionable_next_step: string | null",
  "function resolveRuntimeToolQualityAction",
  "resolveRuntimeToolQualitySignalFromRegistry({",
  "defaultNextStep: signal.defaultNextStep",
  "function resolveRuntimeToolQualityActionableNextStep",
  "const status: RuntimeToolQualityStatus = failReasons.length > 0",
  "passed: status === \"ok\"",
  "quality_schema_version: RUNTIME_TOOL_QUALITY_SCHEMA_VERSION",
  "failure_reasons: failReasons",
  "warning_reasons: warnReasons",
  "schema_budget_status: budgetValidation.ok ? \"passed\" : \"failed\"",
  "action_family: action.actionFamily",
  "action_reason: action.actionReason",
  "action_required: action.actionRequired",
  "actionable_next_step: actionableNextStep",
] as const;

expectAllIncludes(
  releaseGate,
  releaseGateQualityRequiredFragments,
  "release gate runtime_tool_quality module delegation",
);

expectAllIncludes(
  releaseQualityModule,
  releaseQualityModuleRequiredFragments,
  "release checks.runtime_tool_quality schema",
);

expectAllIncludes(
  statusCommand,
  statusQualityRequiredFragments,
  "status runtime_tools_quality schema",
);

expectAllIncludes(
  statusQualityRegistry,
  [
    "RUNTIME_TOOL_QUALITY_REGISTRY_RELATIVE_PATH = \"shared/contracts/runtime-tool-quality-v1.json\"",
    "function readRuntimeToolQualityRegistry()",
    "function readRuntimeToolQualityActionRegistryByReason()",
    "defaultNextStepBySurface",
    "priorityBySurface",
    "function readRuntimeToolQualityActionRequiredByReason()",
    "export function resolveRuntimeToolQualityActionRequiredFromRegistry",
    "export function resolveRuntimeToolQualityActionFromRegistry",
    "export function resolveRuntimeToolQualityDefaultNextStepFromRegistry",
    "export function resolveRuntimeToolQualitySignalFromRegistry",
    "runtime_tool_quality_registry_action_required_unmapped",
  ],
  "status runtime-tool quality registry reader",
);

for (const reason of statusFailureReasons) {
  expectIncludes(statusCommand, `"${reason}"`, `status failure reason registry ${reason}`);
}
for (const reason of statusWarningReasons) {
  expectIncludes(statusCommand, `"${reason}"`, `status warning reason registry ${reason}`);
}
for (const reason of releaseFailureReasons) {
  expectIncludes(releaseQualityModule, `"${reason}"`, `release failure reason registry ${reason}`);
}
expect(
  !statusCommand.includes("runtime_binary_missing: \"build_runtime_binary\"")
    && !releaseGate.includes("runtime_binary_missing: \"build_runtime_binary\""),
  "status/release must derive action_required mapping from shared registry instead of inline reason maps",
);
expect(
  !statusCommand.includes("orderedSignals")
    && !releaseGate.includes("actionSignals")
    && !releaseGate.includes("runtimeToolQualityActionFamilyCatalog")
    && !releaseGate.includes("runtimeToolQualityFailureReasonCatalog"),
  "status/release must derive action_family/action_reason decisive signal priority from shared registry",
);
expect(
  !statusCommand.includes("Build or install the Rust runtime binary, then rerun")
    && !statusCommand.includes("Run `npm run check:gateway:runtime-tools:describe` and reconcile")
    && !releaseGate.includes("Fix runtime-tool release report JSON parsing")
    && !releaseGate.includes("Build the Rust runtime with `cargo build --manifest-path runtime/Cargo.toml`"),
  "status/release must derive default actionable_next_step text from shared registry instead of inline switch prose",
);
expect(
  !releaseGate.includes("function readRuntimeToolQualityRegistry()")
    && !releaseGate.includes("function runtimeToolQualitySummary(")
    && !releaseGate.includes("const runtimeToolQualityRegistry = readRuntimeToolQualityRegistry();"),
  "release gate must delegate runtime_tool_quality report construction to scripts/lib instead of inline heredoc logic",
);

expect(
  sharedContractsReadme.includes("default_next_step")
    && sharedContractsReadme.includes("default `actionable_next_step`"),
  "shared contract README must document registry-owned default next steps",
);
expect(
  sharedContractsReadme.includes("priority_by_surface")
    && sharedContractsReadme.includes("decisive `action_reason`"),
  "shared contract README must document registry-owned action signal priority",
);

expect(
  releaseQualityModule.includes("schemaBudgetViolations === null")
    && releaseQualityModule.includes("? \"unknown\"")
    && releaseQualityModule.includes("? \"passed\"")
    && releaseQualityModule.includes(": \"failed\""),
  "release runtime_tool_quality must expose explicit schema_budget_status including unknown",
);

expect(
  statusCommand.includes("warnReasons.length > 0")
    && statusCommand.includes("? \"warn\"")
    && statusCommand.includes(": \"ok\""),
  "status runtime_tools_quality must distinguish warn from ok/fail",
);

expect(
  releaseQualityModule.includes("checks: {")
    && releaseQualityModule.includes("runtime_tool_quality: runtimeToolQuality"),
  "release report must publish runtime_tool_quality under checks",
);

expect(
  statusCommand.includes("runtime_tools_quality: runtimeToolQuality")
    && statusCommand.includes("runtime_tool_quality: status=")
    && statusCommand.includes("action=${runtimeToolQuality.action_required ?? \"<none>\"}"),
  "status JSON/text must publish runtime_tools_quality and text action",
);

expect(
  releaseReportTest.includes("runtime_tool_quality.source must be runtime_tool_describe")
    && releaseReportTest.includes("runtime_tool_quality.schema_budget_status must be unknown")
    && releaseReportTest.includes("runtime_tool_quality.action_family must classify forced failure as runner_contract")
    && releaseReportTest.includes("runtime_tool_quality.action_reason must preserve the decisive failure reason")
    && releaseReportTest.includes("runtime_tool_quality.action_required must point to failed contract action")
    && releaseReportTest.includes("surface execution smoke failures with a focused action")
    && releaseReportTest.includes("surface_smoke=true")
    && releaseReportTest.includes("success runtime_tool_quality.schema_budget_status must be passed")
    && releaseReportTest.includes("success runtime_tool_quality.runtime_schema_profile_summary must describe 7 profiles")
    && releaseReportTest.includes("success runtime_tool_quality.runtime_schema_budget_violation_details must be empty array")
    && releaseReportTest.includes("success runtime_tool_quality.runtime_only_tools must be empty array")
    && releaseReportTest.includes("success runtime_tool_describe.runtime_tool_order_mismatch must be null"),
  "release-report regression must assert runtime_tool_quality source and schema budget status",
);

expect(
  startSmokeContract.includes("quality_schema_budget_status")
    && startSmokeContract.includes("quality_action_family")
    && startSmokeContract.includes("quality_action_reason")
    && startSmokeContract.includes("quality_action_required")
    && startSmokeContract.includes("quality_actionable_next_step_has_runtime_status")
    && gatewaySmoke.includes("status_runtime_tool_quality_schema_budget_status"),
  "status smoke must assert runtime_tools_quality schema budget status",
);

process.stdout.write(JSON.stringify({
  ok: true,
  contract: "runtime-tool-quality-schema",
  shared_contract: "shared/contracts/runtime-tool-quality-v1.json",
  failure_reason_count: schemaFailureReasons.length,
  warning_reason_count: schemaWarningReasons.length,
  action_family_count: schemaActionFamilies.length,
  action_required_count: schemaActionRequiredIds.length,
  release_diagnostic_field_count: schemaReleaseDiagnosticFields.length,
  priority_fixture_status_action: statusPriorityFixture.actionReason,
  priority_fixture_release_action: releasePriorityFixture.actionReason,
  release_fields: [
    "quality_schema_version",
    "status",
    "passed",
    "source",
    "failure_reasons",
    "warning_reasons",
    "schema_budget_status",
    "schema_budget_violations",
    "runtime_binary_exists",
    "runtime_tool_count",
    "runtime_default_enabled_count",
    "runtime_tool_manifest_fingerprint",
    "gateway_tool_manifest_fingerprint",
    "runtime_tool_manifest_match",
    "runtime_tool_manifest_order_match",
    "runtime_default_manifest_match",
    "runtime_default_manifest_order_match",
    "runtime_only_tools",
    "gateway_only_tools",
    "runtime_default_only_tools",
    "gateway_default_only_tools",
    "runtime_tool_order_mismatch",
    "runtime_default_order_mismatch",
    "runtime_schema_profile_summary",
    "runtime_schema_budget_violation_profiles",
    "runtime_schema_budget_violation_details",
    "runtime_surface_execution_smoke_passed",
    "runtime_surface_execution_profiles_smoked",
    "runtime_surface_execution_allowed_workflow_successes",
    "runtime_surface_execution_hidden_tool_rejections",
    "runtime_surface_execution_hidden_arg_rejections",
    "runtime_surface_execution_schema_projection_checks",
    "action_family",
    "action_reason",
    "action_required",
    "actionable_next_step",
  ],
  status_fields: [
    "quality_schema_version",
    "status",
    "passed",
    "source",
    "failure_reasons",
    "warning_reasons",
    "schema_budget_status",
    "schema_budget_violations",
    "runtime_binary_exists",
    "runtime_describe_source",
    "recovery_gate_status",
    "action_family",
    "action_reason",
    "action_required",
    "actionable_next_step",
  ],
}) + "\n");
