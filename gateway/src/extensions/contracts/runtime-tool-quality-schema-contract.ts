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

const releaseGate = readRepoFile("scripts/core-release-gate.sh");
const statusCommand = readRepoFile("gateway/src/orchestration/entrypoints/dev-cli/status/run-status.ts");
const releaseReportTest = readRepoFile("scripts/test-runtime-tool-release-report.mjs");
const startSmokeContract = readRepoFile("gateway/src/extensions/contracts/start-smoke-contract.mjs");
const gatewaySmoke = readRepoFile("gateway/tests/check-gateway-node.mjs");

const releaseQualityRequiredFragments = [
  "function runtimeToolQualitySummary(describeSummary, data)",
  "const status = failureReasons.length > 0 ? \"fail\" : \"ok\"",
  "passed: status === \"ok\"",
  "source: \"runtime_tool_describe\"",
  "failure_reasons: failureReasons",
  "warning_reasons: []",
  "schema_budget_status: schemaBudgetStatus",
  "schema_budget_violations: schemaBudgetViolations",
  "runtime_binary_exists: runtimeBinaryExists",
  "actionable_next_step:",
] as const;

const statusQualityRequiredFragments = [
  "type RuntimeToolQualityStatus = \"ok\" | \"warn\" | \"fail\"",
  "interface RuntimeToolQualitySummary",
  "status: RuntimeToolQualityStatus",
  "passed: boolean",
  "source: \"status.runtime_tools\"",
  "failure_reasons: string[]",
  "warning_reasons: string[]",
  "runtime_binary_exists: boolean | null",
  "schema_budget_status: \"passed\" | \"failed\"",
  "schema_budget_violations: number",
  "runtime_describe_source: RuntimeToolEnabledToolsSource",
  "recovery_gate_status: RuntimeToolRecoveryReadinessGateDecision[\"status\"]",
  "action_required: string | null",
  "const status: RuntimeToolQualityStatus = failReasons.length > 0",
  "passed: status === \"ok\"",
  "failure_reasons: failReasons",
  "warning_reasons: warnReasons",
  "schema_budget_status: budgetValidation.ok ? \"passed\" : \"failed\"",
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
    && releaseReportTest.includes("success runtime_tool_quality.schema_budget_status must be passed"),
  "release-report regression must assert runtime_tool_quality source and schema budget status",
);

expect(
  startSmokeContract.includes("quality_schema_budget_status")
    && gatewaySmoke.includes("status_runtime_tool_quality_schema_budget_status"),
  "status smoke must assert runtime_tools_quality schema budget status",
);

process.stdout.write(JSON.stringify({
  ok: true,
  contract: "runtime-tool-quality-schema",
  release_fields: [
    "status",
    "passed",
    "source",
    "failure_reasons",
    "warning_reasons",
    "schema_budget_status",
    "schema_budget_violations",
    "runtime_binary_exists",
    "actionable_next_step",
  ],
  status_fields: [
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
    "action_required",
  ],
}) + "\n");
