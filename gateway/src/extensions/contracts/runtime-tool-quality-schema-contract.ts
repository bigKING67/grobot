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

function stringArray(value: unknown, label: string): string[] {
  expect(Array.isArray(value), `${label} must be array`);
  const items = value.map((item) => {
    expect(typeof item === "string", `${label} items must be strings`);
    return item;
  });
  return items;
}

function registryReasons(value: unknown, label: string): string[] {
  expect(Array.isArray(value), `${label} must be array`);
  return value.map((item, index) => {
    expect(isObject(item), `${label}[${String(index)}] must be object`);
    expect(typeof item.reason === "string", `${label}[${String(index)}].reason must be string`);
    expect(Array.isArray(item.surfaces), `${label}[${String(index)}].surfaces must be array`);
    expect(typeof item.action_family === "string", `${label}[${String(index)}].action_family must be string`);
    return item.reason;
  });
}

function registryReasonsForSurface(value: unknown, label: string, surface: string): string[] {
  expect(Array.isArray(value), `${label} must be array`);
  return value
    .filter((item) => isObject(item) && Array.isArray(item.surfaces) && item.surfaces.includes(surface))
    .map((item) => {
      expect(isObject(item), `${label} item must be object`);
      expect(typeof item.reason === "string", `${label}.reason must be string`);
      return item.reason;
    });
}

function registryActionFamilies(value: unknown): string[] {
  expect(Array.isArray(value), "action_families must be array");
  return value.map((item, index) => {
    expect(isObject(item), `action_families[${String(index)}] must be object`);
    expect(typeof item.family === "string", `action_families[${String(index)}].family must be string`);
    return item.family;
  });
}

const releaseGate = readRepoFile("scripts/core-release-gate.sh");
const statusCommand = readRepoFile("gateway/src/orchestration/entrypoints/dev-cli/status/run-status.ts");
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
const schemaFailureReasons = registryReasons(qualitySchema.failure_reasons, "schema.failure_reasons");
const schemaWarningReasons = registryReasons(qualitySchema.warning_reasons, "schema.warning_reasons");
const statusFailureReasons = registryReasonsForSurface(qualitySchema.failure_reasons, "schema.failure_reasons", "status");
const releaseFailureReasons = registryReasonsForSurface(qualitySchema.failure_reasons, "schema.failure_reasons", "release");
const statusWarningReasons = registryReasonsForSurface(qualitySchema.warning_reasons, "schema.warning_reasons", "status");

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
expect(new Set(schemaFailureReasons).size === schemaFailureReasons.length, "schema failure reasons must be unique");
expect(new Set(schemaWarningReasons).size === schemaWarningReasons.length, "schema warning reasons must be unique");

const releaseQualityRequiredFragments = [
  "const runtimeToolQualitySchemaVersion = 1",
  "const runtimeToolQualityFailureReasonCatalog = Object.freeze([",
  "const runtimeToolQualityActionFamilyCatalog = Object.freeze([",
  "function pushRuntimeToolQualityFailureReason",
  "function runtimeToolQualitySummary(describeSummary, data)",
  "const status = failureReasons.length > 0 ? \"fail\" : \"ok\"",
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
  "actionable_next_step:",
] as const;

const statusQualityRequiredFragments = [
  "const RUNTIME_TOOL_QUALITY_SCHEMA_VERSION = 1",
  "type RuntimeToolQualityStatus = \"ok\" | \"warn\" | \"fail\"",
  "type RuntimeToolQualityActionFamily",
  "type RuntimeToolQualityFailureReason",
  "type RuntimeToolQualityWarningReason",
  "type RuntimeToolQualityReason",
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
  "action_required: string | null",
  "function resolveRuntimeToolQualityAction",
  "const status: RuntimeToolQualityStatus = failReasons.length > 0",
  "passed: status === \"ok\"",
  "quality_schema_version: RUNTIME_TOOL_QUALITY_SCHEMA_VERSION",
  "failure_reasons: failReasons",
  "warning_reasons: warnReasons",
  "schema_budget_status: budgetValidation.ok ? \"passed\" : \"failed\"",
  "action_family: action.actionFamily",
  "action_reason: action.actionReason",
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
    && releaseReportTest.includes("success runtime_tool_quality.schema_budget_status must be passed"),
  "release-report regression must assert runtime_tool_quality source and schema budget status",
);

expect(
  startSmokeContract.includes("quality_schema_budget_status")
    && startSmokeContract.includes("quality_action_family")
    && startSmokeContract.includes("quality_action_reason")
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
  ],
}) + "\n");
