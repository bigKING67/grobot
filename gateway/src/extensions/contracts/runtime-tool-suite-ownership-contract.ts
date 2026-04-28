import { readFileSync } from "node:fs";
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
const runtimeToolRunner = readRepoFile("scripts/check-runtime-tool-contracts.mjs");
const runnerSchemaTest = readRepoFile("scripts/test-runtime-tool-contracts-json-schema.mjs");
const releaseReportTest = readRepoFile("scripts/test-runtime-tool-release-report.mjs");
const runtimeToolSurfaceContract = readRepoFile("gateway/src/extensions/contracts/runtime-tool-surface-contract.ts");
const harnessWorkflow = readRepoFile(".github/workflows/harness-gate.yml");
const corePackagingWorkflow = readRepoFile(".github/workflows/core-packaging-check.yml");
const coreReleaseWorkflow = readRepoFile(".github/workflows/core-release-gate.yml");

const runtimeToolContractPathFragment = "gateway/src/extensions/contracts/runtime-tool-";
const runtimeToolSmokeInvocationCount = (
  gatewaySmoke.match(new RegExp(runtimeToolContractPathFragment, "g")) ?? []
).length;
const checkSegments = checkScript.split("&&").map((segment) => segment.trim());
const runtimeToolSuiteIndex = checkSegments.indexOf("npm run check:gateway:runtime-tools");
const gatewaySmokeIndex = checkSegments.indexOf("npm run check:gateway");
const runtimeToolSuiteScript = packageJson.scripts?.["check:gateway:runtime-tools"] ?? "";
const runtimeToolSchemaScript = packageJson.scripts?.["check:gateway:runtime-tools:schema"] ?? "";
const releaseReportScript = packageJson.scripts?.["check:gateway:runtime-tools:release-report"] ?? "";

expect(runtimeToolSuiteIndex >= 0, "default check must run runtime-tool suite");
expect(gatewaySmokeIndex >= 0, "default check must run gateway smoke");
expect(
  runtimeToolSuiteIndex < gatewaySmokeIndex,
  "runtime-tool suite must run before monolithic gateway smoke",
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
  releaseGate.includes("checks.runtime_tool_describe")
    || releaseGate.includes("runtime_tool_describe: runtimeToolDescribeSummary()"),
  "release gate report must expose runtime_tool_describe evidence",
);
expect(
  releaseGate.includes("failed_contract_detail"),
  "release gate report must preserve runtime-tool failed_contract_detail evidence",
);
expect(
  releaseGate.includes("runtime_binary"),
  "release gate report must preserve runtime-tool runtime_binary evidence",
);
expect(
  releaseGate.includes("runner_schema_version"),
  "release gate report must preserve runtime-tool runner_schema_version evidence",
);
expect(
  releaseGate.includes("diagnostic_summary"),
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
  runtimeToolSuiteScript.includes("scripts/test-runtime-tool-contracts-json-schema.mjs"),
  "check:gateway:runtime-tools must run the runtime-tool JSON schema contract",
);
expect(
  runtimeToolSchemaScript === "node scripts/test-runtime-tool-contracts-json-schema.mjs",
  "package.json must expose runtime-tool JSON schema regression script",
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
    && releaseReportTest.includes("diagnostics_self_test"),
  "release-report regression test must assert diagnostics, runtime binary, and self-test fields",
);
expect(
  corePackagingWorkflow.includes("check:gateway:runtime-tools:release-report"),
  "core packaging workflow must run runtime-tool release-report regression test",
);
expect(
  corePackagingWorkflow.includes("check:gateway:runtime-tools:schema"),
  "core packaging workflow must run runtime-tool JSON schema regression test",
);
expect(
  corePackagingWorkflow.includes('"scripts/test-runtime-tool-release-report.mjs"')
    && corePackagingWorkflow.includes('"scripts/test-runtime-tool-contracts-json-schema.mjs"')
    && corePackagingWorkflow.includes('"scripts/check-runtime-tool-contracts.mjs"'),
  "core packaging workflow must trigger on runtime-tool release/report/schema test and runner changes",
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
  harnessWorkflow.includes('"scripts/test-runtime-tool-release-report.mjs"'),
  "harness gate must trigger on runtime-tool release-report test changes",
);
expect(
  harnessWorkflow.includes('"scripts/test-runtime-tool-contracts-json-schema.mjs"'),
  "harness gate must trigger on runtime-tool JSON schema test changes",
);

process.stdout.write(JSON.stringify({
  ok: true,
  check_order: checkSegments,
  runtime_tool_smoke_invocation_count: runtimeToolSmokeInvocationCount,
  release_gate_describe_json: true,
  release_gate_failure_diagnostics: true,
  release_gate_runtime_binary_status: true,
  release_gate_runner_schema_version: true,
  release_gate_diagnostic_summary: true,
  runner_failure_diagnostics: true,
  runner_runtime_binary_status: true,
  runner_diagnostics_self_test: true,
  runner_schema_version: true,
  runner_diagnostic_summary: true,
  surface_contract_tmp_isolated: true,
  runner_schema_regression_script: true,
  release_report_regression_script: true,
  release_report_regression_workflow: true,
  workflows_with_rust_toolchain: 3,
  harness_runtime_paths_covered: true,
}) + "\n");
