import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
}[] {
  expect(Array.isArray(value), `${label} must be array`);
  return value.map((item, index) => {
    expect(isObject(item), `${label}[${String(index)}] must be object`);
    expect(typeof item.reason === "string", `${label}[${String(index)}].reason must be string`);
    expect(Array.isArray(item.surfaces), `${label}[${String(index)}].surfaces must be array`);
    const surfaces = item.surfaces.map((surface, surfaceIndex) => {
      expect(
        surface === "status" || surface === "release",
        `${label}[${String(index)}].surfaces[${String(surfaceIndex)}] must be status or release`,
      );
      return surface;
    });
    expect(typeof item.action_family === "string", `${label}[${String(index)}].action_family must be string`);
    return {
      reason: item.reason,
      surfaces,
      actionFamily: item.action_family,
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

const releaseGate = readRepoFile("scripts/core-release-gate.sh");
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

expect(JSON.stringify(schemaStatuses) === JSON.stringify(["ok", "warn", "fail"]), "schema status enum must be stable");
expect(
  JSON.stringify(schemaSources) === JSON.stringify(["status.runtime_tools", "runtime_tool_describe"]),
  "schema source enum must be stable",
);
expect(
  JSON.stringify(schemaBudgetStatuses) === JSON.stringify(["passed", "failed", "unknown"]),
  "schema budget status enum must be stable",
);
expect(new Set(schemaActionFamilies).size === schemaActionFamilies.length, "schema action families must be unique");
expect(new Set(schemaActionRequiredIds).size === schemaActionRequiredIds.length, "schema action_required ids must be unique");
expect(new Set(schemaFailureReasons).size === schemaFailureReasons.length, "schema failure reasons must be unique");
expect(new Set(schemaWarningReasons).size === schemaWarningReasons.length, "schema warning reasons must be unique");

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

const releaseQualityRequiredFragments = [
  "const runtimeToolQualitySchemaVersion = 1",
  "const runtimeToolQualityFailureReasonCatalog = Object.freeze([",
  "const runtimeToolQualityActionFamilyCatalog = Object.freeze([",
  "function readRuntimeToolQualityActionRegistryByReason()",
  "defaultNextStepBySurface",
  "const actionRegistryByReason = readRuntimeToolQualityActionRegistryByReason();",
  "function pushRuntimeToolQualityFailureReason",
  "function resolveRuntimeToolQualityActionableNextStep",
  "function runtimeToolQualitySummary(describeSummary, data)",
  "const status = failureReasons.length > 0 ? \"fail\" : \"ok\"",
  "const actionRegistry = actionSignal ? actionRegistryByReason.get(actionSignal[0]) ?? null : null",
  "const actionRequired = actionRegistry?.actionRequired ?? null",
  "actionRegistry?.defaultNextStepBySurface?.release ?? null",
  "quality_schema_version: runtimeToolQualitySchemaVersion",
  "passed: status === \"ok\"",
  "source: \"runtime_tool_describe\"",
  "failure_reasons: failureReasons",
  "warning_reasons: []",
  "schema_budget_status: schemaBudgetStatus",
  "schema_budget_violations: schemaBudgetViolations",
  "runtime_binary_exists: runtimeBinaryExists",
  "action_family: actionSignal ? actionSignal[1] : \"none\"",
  "action_reason: actionSignal ? actionSignal[0] : null",
  "action_required: actionRequired",
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
  "resolveRuntimeToolQualityActionFromRegistry({",
  "defaultNextStep: actionRegistry?.defaultNextStep ?? null",
  "function resolveRuntimeToolQualityActionableNextStep",
  "const status: RuntimeToolQualityStatus = failReasons.length > 0",
  "passed: status === \"ok\"",
  "quality_schema_version: RUNTIME_TOOL_QUALITY_SCHEMA_VERSION",
  "failure_reasons: failReasons",
  "warning_reasons: warnReasons",
  "schema_budget_status: budgetValidation.ok ? \"passed\" : \"failed\"",
  "action_family: action.actionFamily",
  "action_reason: action.actionReason",
  "action_required: actionRequired",
  "actionable_next_step: actionableNextStep",
] as const;

expectAllIncludes(
  releaseGate,
  releaseQualityRequiredFragments,
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
    "function readRuntimeToolQualityActionRegistryByReason()",
    "defaultNextStepBySurface",
    "function readRuntimeToolQualityActionRequiredByReason()",
    "export function resolveRuntimeToolQualityActionRequiredFromRegistry",
    "export function resolveRuntimeToolQualityActionFromRegistry",
    "export function resolveRuntimeToolQualityDefaultNextStepFromRegistry",
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
  expectIncludes(releaseGate, `"${reason}"`, `release failure reason registry ${reason}`);
}
for (const family of schemaActionFamilies) {
  expect(
    statusCommand.includes(`"${family}"`) || releaseGate.includes(`"${family}"`),
    `action family must appear in status or release implementation: ${family}`,
  );
}
expect(
  !statusCommand.includes("runtime_binary_missing: \"build_runtime_binary\"")
    && !releaseGate.includes("runtime_binary_missing: \"build_runtime_binary\""),
  "status/release must derive action_required mapping from shared registry instead of inline reason maps",
);
expect(
  !statusCommand.includes("Build or install the Rust runtime binary, then rerun")
    && !statusCommand.includes("Run `npm run check:gateway:runtime-tools:describe` and reconcile")
    && !releaseGate.includes("Fix runtime-tool release report JSON parsing")
    && !releaseGate.includes("Build the Rust runtime with `cargo build --manifest-path runtime/Cargo.toml`"),
  "status/release must derive default actionable_next_step text from shared registry instead of inline switch prose",
);

expect(
  sharedContractsReadme.includes("default_next_step")
    && sharedContractsReadme.includes("default `actionable_next_step`"),
  "shared contract README must document registry-owned default next steps",
);

expect(
  releaseGate.includes("schemaBudgetViolations === null")
    && releaseGate.includes("? \"unknown\"")
    && releaseGate.includes("? \"passed\"")
    && releaseGate.includes(": \"failed\""),
  "release runtime_tool_quality must expose explicit schema_budget_status including unknown",
);

expect(
  statusCommand.includes("warnReasons.length > 0")
    && statusCommand.includes("? \"warn\"")
    && statusCommand.includes(": \"ok\""),
  "status runtime_tools_quality must distinguish warn from ok/fail",
);

expect(
  releaseGate.includes("checks: {")
    && releaseGate.includes("runtime_tool_quality: runtimeToolQuality"),
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
    && releaseReportTest.includes("success runtime_tool_quality.schema_budget_status must be passed"),
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
