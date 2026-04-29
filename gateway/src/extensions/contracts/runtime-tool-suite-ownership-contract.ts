import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: actual=${String(actual)} expected=${String(expected)}`);
  }
}

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

const packageJson = JSON.parse(readRepoFile("package.json")) as {
  scripts?: Record<string, string>;
};
const checkScript = packageJson.scripts?.check ?? "";
const gatewaySmoke = readRepoFile("gateway/tests/check-gateway-node.mjs");
const releaseGate = readRepoFile("scripts/core-release-gate.sh");
const releaseQualityModule = readRepoFile("scripts/lib/runtime-tool-quality-report.mjs");
const runtimeToolRunner = readRepoFile("scripts/check-runtime-tool-contracts.mjs");
const runnerSchemaTest = readRepoFile("scripts/test-runtime-tool-contracts-json-schema.mjs");
const qualityReportModuleTest = readRepoFile("scripts/test-runtime-tool-quality-report-module.mjs");
const qualityRegistryParityTest = readRepoFile("scripts/test-runtime-tool-quality-registry-parity.mjs");
const releaseReportTest = readRepoFile("scripts/test-runtime-tool-release-report.mjs");
const runtimeToolSurfaceContract = readRepoFile("gateway/src/extensions/contracts/runtime-tool-surface-contract.ts");
const statusCommand = readRepoFile("gateway/src/orchestration/entrypoints/dev-cli/status/run-status.ts");
const startSmokeContract = readRepoFile("gateway/src/extensions/contracts/start-smoke-contract.mjs");
const harnessWorkflow = readRepoFile(".github/workflows/harness-gate.yml");
const corePackagingWorkflow = readRepoFile(".github/workflows/core-packaging-check.yml");
const coreReleaseWorkflow = readRepoFile(".github/workflows/core-release-gate.yml");

const runtimeToolContractPathFragment = "gateway/src/extensions/contracts/runtime-tool-";
const runtimeToolContractFiles = readdirSync(resolve(repoRoot, "gateway/src/extensions/contracts"))
  .filter((name) => name.startsWith("runtime-tool-") && name.endsWith(".ts"));
const runtimeToolSmokeInvocationCount = (
  gatewaySmoke.match(new RegExp(runtimeToolContractPathFragment, "g")) ?? []
).length;
const checkSegments = checkScript.split("&&").map((segment) => segment.trim());
const runtimeToolSuiteIndex = checkSegments.indexOf("npm run check:gateway:runtime-tools");
const gatewaySmokeIndex = checkSegments.indexOf("npm run check:gateway");
const layerContractScript = packageJson.scripts?.["check:layer-contract"] ?? "";
const layerContractStrictScript = packageJson.scripts?.["check:layer-contract:strict"] ?? "";
const layerContractWarnScript = packageJson.scripts?.["check:layer-contract:warn"] ?? "";
const runtimeToolSuiteScript = packageJson.scripts?.["check:gateway:runtime-tools"] ?? "";
const runtimeToolSchemaScript = packageJson.scripts?.["check:gateway:runtime-tools:schema"] ?? "";
const qualityReportScript = packageJson.scripts?.["check:gateway:runtime-tools:quality-report"] ?? "";
const qualityParityScript = packageJson.scripts?.["check:gateway:runtime-tools:quality-parity"] ?? "";
const releaseReportScript = packageJson.scripts?.["check:gateway:runtime-tools:release-report"] ?? "";

expect(runtimeToolSuiteIndex >= 0, "default check must run runtime-tool suite");
expect(gatewaySmokeIndex >= 0, "default check must run gateway smoke");
expect(
  checkSegments.includes("npm run check:layer-contract"),
  "default check must run the strict layer-contract gate",
);
expect(
  !checkSegments.includes("npm run check:layer-contract:warn"),
  "default check must not use warn-only layer-contract diagnostics",
);
expect(
  runtimeToolSuiteIndex < gatewaySmokeIndex,
  "runtime-tool suite must run before monolithic gateway smoke",
);
expect(
  layerContractScript === "node scripts/layer-contract-check.mjs --strict"
    && layerContractStrictScript === layerContractScript,
  "default layer-contract check must be strict so warnings fail local full checks",
);
expect(
  layerContractWarnScript === "node scripts/layer-contract-check.mjs",
  "package.json must expose an explicit warn-only layer-contract diagnostics script",
);
expectEqual(
  runtimeToolSmokeInvocationCount,
  0,
  "check-gateway-node.mjs must not directly execute focused runtime-tool contracts",
);
expect(
  releaseGate.includes("node scripts/check-runtime-tool-contracts.mjs --include-runtime-describe --json"),
  "release gate must run runtime-tool describe suite through the ownership runner",
);
expect(
  releaseGate.includes("runtime_tool_describe_report_invalid"),
  "release gate must emit an explicit fail_reason when runtime-tool describe report parsing fails",
);
expect(
  releaseGate.includes("scripts/lib/runtime-tool-quality-report.mjs")
    && releaseQualityModule.includes("runtime_tool_describe: runtimeToolDescribe"),
  "release gate report must expose runtime_tool_describe evidence",
);
expect(
  releaseGate.includes("scripts/lib/runtime-tool-quality-report.mjs")
    && releaseQualityModule.includes("runtime_tool_quality: runtimeToolQuality")
    && releaseQualityModule.includes("runtimeToolQualitySummary("),
  "release gate report must expose runtime_tool_quality evidence",
);
expect(
  releaseQualityModule.includes("failure_reasons: failureReasons")
    && releaseQualityModule.includes("warning_reasons: []"),
  "release gate runtime_tool_quality must expose status reasons",
);
expect(
  releaseQualityModule.includes("surface_execution_payload")
    && releaseQualityModule.includes("runtime_surface_execution_smoke_passed")
    && releaseQualityModule.includes("runtime_surface_execution_schema_projection_checks"),
  "release gate runtime_tool_quality must expose real surface execution smoke evidence",
);
expect(
  statusCommand.includes("runtime_tools_quality")
    && statusCommand.includes("buildRuntimeToolQualitySummary(")
    && statusCommand.includes("runtime_tool_quality: status="),
  "status --json/text must expose runtime tool quality summary",
);
expect(
  releaseQualityModule.includes("failed_contract_detail"),
  "release gate report must preserve runtime-tool failed_contract_detail evidence",
);
expect(
  releaseQualityModule.includes("runtime_binary"),
  "release gate report must preserve runtime-tool runtime_binary evidence",
);
expect(
  releaseQualityModule.includes("runner_schema_version"),
  "release gate report must preserve runtime-tool runner_schema_version evidence",
);
expect(
  releaseQualityModule.includes("diagnostic_summary"),
  "release gate report must preserve runtime-tool diagnostic_summary evidence",
);
expect(
  runtimeToolRunner.includes("failed_contract_detail"),
  "runtime-tool runner JSON must expose failed_contract_detail",
);
expect(
  runtimeToolRunner.includes("runtime_binary"),
  "runtime-tool runner JSON must expose describe-mode runtime_binary status",
);
expect(
  runtimeToolRunner.includes("diagnostics_self_test"),
  "runtime-tool runner JSON must expose diagnostics_self_test status",
);
expect(
  runtimeToolRunner.includes("schema_version: reportSchemaVersion"),
  "runtime-tool runner JSON must expose schema_version",
);
expect(
  runtimeToolRunner.includes("diagnostic_summary") && runtimeToolRunner.includes("diagnosticSummary("),
  "runtime-tool runner JSON must expose diagnostic_summary",
);
expect(
  runtimeToolRunner.includes("runtime-tool-surface-execution")
    && runtimeToolRunner.includes("runtime-tool-surface-execution-contract.ts")
    && runtimeToolRunner.includes("runtimeDescribeContracts"),
  "runtime-tool runner must execute the real surface execution smoke in describe/release mode",
);
expect(
  runtimeToolSuiteScript.includes("scripts/test-runtime-tool-contracts-json-schema.mjs"),
  "check:gateway:runtime-tools must run the runtime-tool JSON schema contract",
);
expect(
  runtimeToolSuiteScript.includes("scripts/test-runtime-tool-quality-report-module.mjs"),
  "check:gateway:runtime-tools must run the runtime-tool quality report module contract",
);
expect(
  runtimeToolSuiteScript.includes("scripts/test-runtime-tool-quality-registry-parity.mjs"),
  "check:gateway:runtime-tools must run the runtime-tool quality registry parity contract",
);
expect(
  runtimeToolSchemaScript === "node scripts/test-runtime-tool-contracts-json-schema.mjs",
  "package.json must expose runtime-tool JSON schema regression script",
);
expect(
  qualityReportScript === "node scripts/test-runtime-tool-quality-report-module.mjs",
  "package.json must expose runtime-tool quality report module regression script",
);
expect(
  qualityParityScript === "node scripts/test-runtime-tool-quality-registry-parity.mjs",
  "package.json must expose runtime-tool quality registry parity regression script",
);
expect(
  runnerSchemaTest.includes("schema_version")
    && runnerSchemaTest.includes("failed_contract_detail")
    && runnerSchemaTest.includes("runtime_binary")
    && runnerSchemaTest.includes("diagnostic_summary")
    && runnerSchemaTest.includes("diagnostics_self_test"),
  "runtime-tool JSON schema contract must assert schema_version, diagnostics, runtime binary, and self-test fields",
);
expect(
  qualityReportModuleTest.includes("readRuntimeToolQualityRegistry")
    && qualityReportModuleTest.includes("resolveRuntimeToolQualitySignal")
    && qualityReportModuleTest.includes("runtime_tool_quality_registry_invalid_json")
    && qualityReportModuleTest.includes("runtime_tool_quality_registry_reason_surface_unmapped")
    && qualityReportModuleTest.includes("schema_budget_cases")
    && qualityReportModuleTest.includes("runtime_surface_execution_smoke_passed")
    && qualityReportModuleTest.includes("next_step_precedence"),
  "runtime-tool quality report module test must directly cover registry guards, signal priority, schema budget matrix, surface execution evidence, and next-step precedence",
);
expect(
  qualityRegistryParityTest.includes("resolveRuntimeToolQualitySignalFromRegistry")
    && qualityRegistryParityTest.includes("resolveRuntimeToolQualitySignal")
    && qualityRegistryParityTest.includes("status_all_reasons_priority")
    && qualityRegistryParityTest.includes("release_all_reasons_priority")
    && qualityRegistryParityTest.includes("status_wrong_surface_release_reason")
    && qualityRegistryParityTest.includes("release_wrong_surface_status_reason")
    && qualityRegistryParityTest.includes("status_unknown_reason"),
  "runtime-tool quality registry parity test must compare status TS resolver and release JS resolver across valid, priority, wrong-surface, and unknown-reason cases",
);
expect(
  releaseReportScript === "node scripts/test-runtime-tool-release-report.mjs",
  "package.json must expose runtime-tool release-report regression script",
);
expect(
  runtimeToolSurfaceContract.includes("process.env.TMPDIR ?? \"/tmp\"")
    && runtimeToolSurfaceContract.includes("process.pid")
    && runtimeToolSurfaceContract.includes("Date.now()")
    && !runtimeToolSurfaceContract.includes("workDir: \"/tmp/grobot-runtime-tool-surface-contract\""),
  "runtime-tool surface contract must isolate tmp fixtures per process",
);
for (const fileName of runtimeToolContractFiles) {
  const contractPath = `gateway/src/extensions/contracts/${fileName}`;
  expect(
    runtimeToolRunner.includes(contractPath),
    `runtime-tool runner must include ${contractPath}`,
  );
  if (fileName === "runtime-tool-suite-ownership-contract.ts") {
    continue;
  }
  const source = readRepoFile(contractPath);
  expect(
    !source.includes("join(\"/tmp\"") && !source.includes("\"/tmp/grobot"),
    `${fileName} must not use fixed /tmp grobot fixtures`,
  );
}
expect(
  runtimeToolRunner.includes("GROBOT_RUNTIME_TOOL_CONTRACTS_TEST_FAIL_ID"),
  "runtime-tool runner must support deterministic contract failure injection for report regression tests",
);
expect(
  releaseReportTest.includes("GROBOT_RUNTIME_TOOL_CONTRACTS_TEST_FAIL_ID"),
  "release-report regression test must inject a runtime-tool contract failure",
);
expect(
  releaseReportTest.includes("failed_contract_detail")
    && releaseReportTest.includes("runtime_binary")
    && releaseReportTest.includes("diagnostic_summary")
    && releaseReportTest.includes("runtime_tool_manifest_fingerprint")
    && releaseReportTest.includes("tool_count=14")
    && releaseReportTest.includes("runtime_tool_quality")
    && releaseReportTest.includes("failure_reasons")
    && releaseReportTest.includes("successQuality")
    && releaseReportTest.includes("runtime_surface_execution_smoke_passed")
    && releaseReportTest.includes("diagnostics_self_test"),
  "release-report regression test must assert diagnostics, runtime binary, surface execution evidence, quality summary reasons, and self-test fields",
);
expect(
  startSmokeContract.includes("status_has_runtime_tools_quality")
    && startSmokeContract.includes("quality_failure_has_runtime_health_failed")
    && gatewaySmoke.includes("status_has_runtime_tools_quality")
    && gatewaySmoke.includes("status_runtime_tool_quality_status"),
  "gateway status smoke must assert runtime tool quality summary and failure states",
);
expect(
  corePackagingWorkflow.includes("check:gateway:runtime-tools:release-report"),
  "core packaging workflow must run runtime-tool release-report regression test",
);
expect(
  corePackagingWorkflow.includes("check:gateway:runtime-tools:quality-report"),
  "core packaging workflow must run runtime-tool quality report module regression test",
);
expect(
  corePackagingWorkflow.includes("check:gateway:runtime-tools:quality-parity"),
  "core packaging workflow must run runtime-tool quality registry parity regression test",
);
expect(
  corePackagingWorkflow.includes("check:gateway:runtime-tools:schema"),
  "core packaging workflow must run runtime-tool JSON schema regression test",
);
expect(
  corePackagingWorkflow.includes('"scripts/test-runtime-tool-release-report.mjs"')
    && corePackagingWorkflow.includes('"scripts/test-runtime-tool-contracts-json-schema.mjs"')
    && corePackagingWorkflow.includes('"scripts/test-runtime-tool-quality-report-module.mjs"')
    && corePackagingWorkflow.includes('"scripts/test-runtime-tool-quality-registry-parity.mjs"')
    && corePackagingWorkflow.includes('"scripts/check-runtime-tool-contracts.mjs"')
    && corePackagingWorkflow.includes('"scripts/lib/**"')
    && corePackagingWorkflow.includes('"gateway/src/extensions/contracts/runtime-tool-*.ts"')
    && corePackagingWorkflow.includes('"shared/contracts/runtime-tool-quality-v1.json"'),
  "core packaging workflow must trigger on runtime-tool contract, release/report/schema test, and runner changes",
);
for (const [name, workflow] of [
  ["harness-gate", harnessWorkflow],
  ["core-packaging-check", corePackagingWorkflow],
  ["core-release-gate", coreReleaseWorkflow],
] as const) {
  expect(workflow.includes("dtolnay/rust-toolchain@stable"), `${name} must set up Rust explicitly`);
}
expect(harnessWorkflow.includes('"runtime/**"'), "harness gate must trigger on runtime changes");
expect(
  harnessWorkflow.includes('"scripts/check-runtime-tool-contracts.mjs"'),
  "harness gate must trigger on runtime-tool runner changes",
);
expect(
  harnessWorkflow.includes('"scripts/lib/**"'),
  "harness gate must trigger on runtime-tool script library changes",
);
expect(
  harnessWorkflow.includes('"scripts/test-runtime-tool-release-report.mjs"'),
  "harness gate must trigger on runtime-tool release-report test changes",
);
expect(
  harnessWorkflow.includes('"scripts/test-runtime-tool-quality-report-module.mjs"'),
  "harness gate must trigger on runtime-tool quality report module test changes",
);
expect(
  harnessWorkflow.includes('"scripts/test-runtime-tool-quality-registry-parity.mjs"'),
  "harness gate must trigger on runtime-tool quality registry parity test changes",
);
expect(
  harnessWorkflow.includes('"scripts/test-runtime-tool-contracts-json-schema.mjs"'),
  "harness gate must trigger on runtime-tool JSON schema test changes",
);
expect(
  harnessWorkflow.includes('"shared/contracts/runtime-tool-quality-v1.json"'),
  "harness gate must trigger on runtime-tool quality schema registry changes",
);

process.stdout.write(JSON.stringify({
  ok: true,
  check_order: checkSegments,
  layer_contract_default_strict: true,
  layer_contract_warn_diagnostics: true,
  runtime_tool_smoke_invocation_count: runtimeToolSmokeInvocationCount,
  release_gate_describe_json: true,
  release_gate_failure_diagnostics: true,
  release_gate_runtime_binary_status: true,
  release_gate_runner_schema_version: true,
  release_gate_diagnostic_summary: true,
  release_gate_quality_summary: true,
  release_gate_surface_execution_smoke_summary: true,
  status_quality_summary: true,
  release_gate_invalid_report_fail_reason: true,
  runner_failure_diagnostics: true,
  runner_runtime_binary_status: true,
  runner_diagnostics_self_test: true,
  runner_schema_version: true,
  runner_diagnostic_summary: true,
  runner_surface_execution_describe_contract: true,
  surface_contract_tmp_isolated: true,
  all_contract_tmp_fixtures_isolated: true,
  runner_covers_all_runtime_tool_contracts: true,
  runner_schema_regression_script: true,
  quality_report_module_regression_script: true,
  quality_registry_parity_regression_script: true,
  release_report_regression_script: true,
  release_report_regression_workflow: true,
  core_packaging_runtime_tool_contract_paths_covered: true,
  workflows_with_rust_toolchain: 3,
  harness_runtime_paths_covered: true,
}) + "\n");
