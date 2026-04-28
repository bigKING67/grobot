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

process.stdout.write(JSON.stringify({
  ok: true,
  check_order: checkSegments,
  runtime_tool_smoke_invocation_count: runtimeToolSmokeInvocationCount,
  release_gate_describe_json: true,
  release_gate_failure_diagnostics: true,
  release_gate_runtime_binary_status: true,
  runner_failure_diagnostics: true,
  runner_runtime_binary_status: true,
  runner_diagnostics_self_test: true,
  workflows_with_rust_toolchain: 3,
  harness_runtime_paths_covered: true,
}) + "\n");
