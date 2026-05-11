#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GATEWAY_SUITE_IDS } from "../../lib/quality-gate-registry.mjs";

const result = spawnSync("node", ["gateway/tests/check-gateway-node.mjs", "--list-suites", "--json"], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
});

assert.equal(result.status, 0, `--list-suites must pass\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

const payload = JSON.parse(result.stdout);
assert.equal(Array.isArray(payload.suites), true, "suite list must expose suites array");

const actual = payload.suites.map((suite) => suite.id).sort();
const expected = [...GATEWAY_SUITE_IDS].sort();
assert.deepEqual(actual, expected, "gateway suite registry must match quality gate registry");

for (const suite of payload.suites) {
  assert.equal(typeof suite.id, "string", "suite id must be string");
  assert.equal(typeof suite.description, "string", `suite ${suite.id} description must be string`);
  assert.notEqual(suite.description.trim(), "", `suite ${suite.id} description must not be empty`);
}

const casesResult = spawnSync("node", ["gateway/tests/check-gateway-node.mjs", "--list-cases", "--json"], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
});

assert.equal(casesResult.status, 0, `--list-cases must pass\nstdout:\n${casesResult.stdout}\nstderr:\n${casesResult.stderr}`);

const casesPayload = JSON.parse(casesResult.stdout);
assert.equal(Array.isArray(casesPayload.cases), true, "case list must expose cases array");
assert.equal(
  casesPayload.cases.length > payload.suites.length,
  true,
  "case registry must expose split smoke cases beyond suite-level full fallbacks",
);
const caseSuites = [...new Set(casesPayload.cases.map((testCase) => testCase.suite))].sort();
assert.deepEqual(caseSuites, expected, "gateway case registry must cover every suite");
for (const testCase of casesPayload.cases) {
  assert.equal(typeof testCase.id, "string", "case id must be string");
  assert.equal(typeof testCase.suite, "string", `case ${testCase.id} suite must be string`);
  assert.equal(typeof testCase.description, "string", `case ${testCase.id} description must be string`);
  assert.notEqual(testCase.description.trim(), "", `case ${testCase.id} description must not be empty`);
  assert.equal(typeof testCase.estimatedMs, "number", `case ${testCase.id} estimatedMs must be number`);
  assert.equal(typeof testCase.isolation, "string", `case ${testCase.id} isolation must be string`);
}

assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "gateway:context:history"),
  true,
  "gateway context must expose case-level history contracts",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "gateway:context:prompt-quality"),
  true,
  "gateway context must expose case-level prompt-quality contracts",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "gateway:context:graph"),
  true,
  "gateway context must expose case-level graph contracts",
);
const contextEngineContractSource = readFileSync(
  "gateway/src/extensions/contracts/context-engine-contract.ts",
  "utf8",
);
assert.equal(
  contextEngineContractSource.includes('command === "batch"'),
  true,
  "context engine contract must keep an in-process batch command for prompt-quality contracts",
);
assert.equal(
  contextEngineContractSource.includes("graph-persistent-index-sequence"),
  true,
  "context engine contract must keep a persistent-index sequence command for graph contracts",
);
const contextGraphContractSource = readFileSync(
  "gateway/tests/check-gateway-node/gateway-contract-smoke/context-graph-contracts.mjs",
  "utf8",
);
assert.equal(
  contextGraphContractSource.includes("graph-persistent-index-sequence"),
  true,
  "gateway context graph smoke must use the persistent-index sequence command",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "gateway:plan:input-keybinding"),
  true,
  "gateway plan must expose case-level input keybinding contracts",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "gateway:plan:bridge-error-codes"),
  true,
  "gateway plan must expose case-level bridge error code contracts",
);
const planBridgeSchemaCase = casesPayload.cases.find((testCase) => testCase.id === "gateway:plan:bridge-error-codes");
assert.equal(
  planBridgeSchemaCase?.id,
  "gateway:plan:bridge-error-codes",
  "gateway plan bridge schema case lookup must resolve",
);
const fastTsxPlanContracts = [
  "gateway/src/extensions/contracts/bridge-cli-contract.mjs",
  "gateway/src/extensions/contracts/bridge-error-codes-schema-contract.mjs",
  "gateway/src/extensions/contracts/bridge-plan-apply-failure-contract.mjs",
  "gateway/src/extensions/contracts/plan-events-policy-guard-contract.mjs",
  "gateway/src/extensions/contracts/plan-quality-benchmark-contract.mjs",
];
for (const contractPath of fastTsxPlanContracts) {
  const source = readFileSync(contractPath, "utf8");
  assert.equal(
    source.includes("./_shared/run-tsx-script.mjs"),
    true,
    `${contractPath} must use the shared local tsx fast path`,
  );
  assert.equal(
    source.includes('"--package"'),
    false,
    `${contractPath} must not shell through npx --package on the hot path`,
  );
}
const statusLineValidatorContractSource = readFileSync(
  "gateway/src/extensions/contracts/status-line-config-validator-contract.mjs",
  "utf8",
);
const contextEngineValidatorContractSource = readFileSync(
  "gateway/src/extensions/contracts/context-engine-config-validator-contract.mjs",
  "utf8",
);
const experienceSchedulerValidatorContractSource = readFileSync(
  "gateway/src/extensions/contracts/experience-scheduler-config-validator-contract.mjs",
  "utf8",
);
const mcpInstructionValidatorContractSource = readFileSync(
  "gateway/src/extensions/contracts/mcp-instruction-config-validator-contract.mjs",
  "utf8",
);
assert.equal(
  contextEngineValidatorContractSource.includes("resolveContextEngineConfig"),
  true,
  "context engine fast controls must reuse the production config resolver",
);
assert.equal(
  contextEngineValidatorContractSource.includes("start-invalid-context-engine"),
  false,
  "context engine fast controls must not shell through start smoke for each invalid fixture",
);
assert.equal(
  statusLineValidatorContractSource.includes("readStatusLineConfigFromProjectToml"),
  true,
  "status-line fast controls must reuse the production project TOML validator",
);
assert.equal(
  statusLineValidatorContractSource.includes("start-invalid-status-line"),
  false,
  "status-line fast controls must not shell through start smoke for each invalid fixture",
);
assert.equal(
  experienceSchedulerValidatorContractSource.includes("resolveExperienceSchedulerConfig"),
  true,
  "experience scheduler fast controls must reuse the production config resolver",
);
assert.equal(
  experienceSchedulerValidatorContractSource.includes("start-invalid-experience-scheduler"),
  false,
  "experience scheduler fast controls must not shell through start smoke for each invalid fixture",
);
assert.equal(
  mcpInstructionValidatorContractSource.includes("resolveMcpInstructionRuntime"),
  true,
  "MCP instruction fast controls must reuse the production config resolver",
);
assert.equal(
  mcpInstructionValidatorContractSource.includes("start-invalid-mcp-instruction"),
  false,
  "MCP instruction fast controls must not shell through start smoke for each invalid fixture",
);
const statusLineControlsSource = readFileSync(
  "gateway/tests/check-gateway-node/runtime-smoke/status-line-controls.mjs",
  "utf8",
);
const contextEngineControlsSource = readFileSync(
  "gateway/tests/check-gateway-node/runtime-smoke/context-engine-controls.mjs",
  "utf8",
);
const experienceSchedulerControlsSource = readFileSync(
  "gateway/tests/check-gateway-node/runtime-smoke/experience-scheduler-controls.mjs",
  "utf8",
);
const mcpInstructionControlsSource = readFileSync(
  "gateway/tests/check-gateway-node/runtime-smoke/mcp-instruction-controls.mjs",
  "utf8",
);
assert.equal(
  contextEngineControlsSource.includes("context-engine-config-validator-contract.mjs"),
  true,
  "context engine split controls must use the validator fast path",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:controls:context-engine-validator"),
  true,
  "runtime controls must expose the context engine validator batch shard",
);
assert.equal(
  statusLineControlsSource.includes("status-line-config-validator-contract.mjs"),
  true,
  "status-line split controls must use the validator fast path",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:controls:status-line-validator"),
  true,
  "runtime controls must expose the status-line validator batch shard",
);
assert.equal(
  experienceSchedulerControlsSource.includes("experience-scheduler-config-validator-contract.mjs"),
  true,
  "experience scheduler split controls must use the validator fast path",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:controls:experience-scheduler-validator"),
  true,
  "runtime controls must expose the experience scheduler validator batch shard",
);
assert.equal(
  mcpInstructionControlsSource.includes("mcp-instruction-config-validator-contract.mjs"),
  true,
  "MCP instruction split controls must use the validator fast path",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:controls:mcp-instruction-validator"),
  true,
  "runtime controls must expose the MCP instruction validator batch shard",
);
assert.equal(
  statusLineControlsSource.includes('runStatusLineControlContract("start-invalid-status-line-controls-reject-flow")'),
  true,
  "status-line aggregate reproduction must keep the full start smoke path",
);
assert.equal(
  experienceSchedulerControlsSource.includes('runExperienceSchedulerControlContract("start-invalid-experience-scheduler-controls-reject-flow")'),
  true,
  "experience scheduler aggregate reproduction must keep the full start smoke path",
);
assert.equal(
  contextEngineControlsSource.includes('runContextEngineControlContract("start-invalid-context-engine-controls-reject-flow")'),
  true,
  "context engine aggregate reproduction must keep the full start smoke path",
);
assert.equal(
  mcpInstructionControlsSource.includes('runMcpInstructionControlContract("start-invalid-mcp-instruction-controls-reject-flow")'),
  true,
  "MCP instruction aggregate reproduction must keep the full start smoke path",
);
assert.equal(
  readFileSync("gateway/src/extensions/contracts/_shared/run-tsx-script.mjs", "utf8").includes("node_modules"),
  true,
  "shared tsx runner must prefer the repository-local binary when dependencies are installed",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:status:interrupt"),
  true,
  "runtime status must expose case-level interrupt contract",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:status:surface"),
  true,
  "runtime status must expose case-level status surface contract",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:controls:context-engine-env-core"),
  true,
  "runtime controls must expose split context-engine env core controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:controls:context-engine-env-adaptive"),
  true,
  "runtime controls must expose split context-engine env adaptive controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:controls:context-engine-toml-basic"),
  true,
  "runtime controls must expose split context-engine TOML basic controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:controls:context-engine-toml-thresholds"),
  true,
  "runtime controls must expose split context-engine TOML threshold controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:controls:context-engine-toml-window"),
  true,
  "runtime controls must expose split context-engine TOML window controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:controls:mcp-instruction-basic"),
  true,
  "runtime controls must expose split MCP instruction basic controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:controls:mcp-instruction-scope"),
  true,
  "runtime controls must expose split MCP instruction scope controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:controls:mcp-instruction-server"),
  true,
  "runtime controls must expose split MCP instruction server controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:controls:mcp-instruction-valid-disabled-boundary"),
  true,
  "runtime controls must expose split MCP instruction valid disabled boundary",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:controls:experience-runtime-start-team"),
  true,
  "runtime controls must expose split experience runtime start team controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:controls:experience-runtime-start-config"),
  true,
  "runtime controls must expose split experience runtime start config controls",
);
const gatewayHarnessSource = readFileSync("gateway/tests/check-gateway-node.mjs", "utf8");
const gatewayWorkerRunnerSource = readFileSync("gateway/tests/check-gateway-node/case-worker-runner.mjs", "utf8");
const gatewayBucketPlannerSource = readFileSync("gateway/tests/check-gateway-node/case-bucket-planner.mjs", "utf8");
for (const requiredTimingMechanism of [
  "GROBOT_GATEWAY_TIMINGS_PATH",
  "GROBOT_GATEWAY_TIMING_CONTEXT",
  "suite-worker",
  "seedMs",
  "ewmaMs",
  "p90Ms",
  "recentMs",
  "estimateCaseMs",
]) {
  assert.equal(
    gatewayHarnessSource.includes(requiredTimingMechanism),
    true,
    `gateway case scheduling must retain ${requiredTimingMechanism} timing support`,
  );
}
assert.equal(
  gatewayWorkerRunnerSource.includes("GROBOT_GATEWAY_TIMING_CONTEXT")
  && gatewayWorkerRunnerSource.includes("suite-worker"),
  true,
  "gateway worker runner must write suite-worker timing context for default suite scheduling",
);
assert.equal(
  gatewayHarnessSource.includes("planCaseBuckets")
  && gatewayWorkerRunnerSource.includes("planCaseBuckets")
  && gatewayBucketPlannerSource.includes("optimizeBucketsExactly")
  && gatewayBucketPlannerSource.includes("EXACT_BUCKET_NODE_LIMIT"),
  true,
  "gateway case sharding and worker scheduling must share the bounded optimal bucket planner",
);
const runtimeControlsPlanDir = mkdtempSync(join(tmpdir(), "grobot-runtime-controls-plan-"));
try {
  const runtimeControlsPlanPath = join(runtimeControlsPlanDir, "plan.json");
  const runtimeControlsPlanResult = spawnSync(
    "node",
    [
      "gateway/tests/check-gateway-node.mjs",
      "--suite",
      "runtime:controls",
      "--write-run-plan",
      runtimeControlsPlanPath,
      "--json",
    ],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  assert.equal(
    runtimeControlsPlanResult.status,
    0,
    `runtime controls run-plan generation must pass\nstdout:\n${runtimeControlsPlanResult.stdout}\nstderr:\n${runtimeControlsPlanResult.stderr}`,
  );
  const runtimeControlsPlan = JSON.parse(readFileSync(runtimeControlsPlanPath, "utf8"));
  const runtimeControlsCases = new Set(runtimeControlsPlan.cases);
  for (const aggregateCaseId of [
    "runtime:controls:context-engine",
    "runtime:controls:context-engine-env",
    "runtime:controls:context-engine-env-core",
    "runtime:controls:context-engine-env-adaptive",
    "runtime:controls:context-engine-toml",
    "runtime:controls:context-engine-toml-basic",
    "runtime:controls:context-engine-toml-thresholds",
    "runtime:controls:context-engine-toml-window",
    "runtime:controls:experience-scheduler-env",
    "runtime:controls:experience-scheduler-toml",
    "runtime:controls:experience-runtime-start",
    "runtime:controls:mcp-instruction",
    "runtime:controls:mcp-instruction-basic",
    "runtime:controls:mcp-instruction-scope",
    "runtime:controls:mcp-instruction-server",
    "runtime:controls:status-line",
    "runtime:controls:status-line-basic",
    "runtime:controls:status-line-segment-order",
    "runtime:controls:status-line-thresholds",
    "runtime:controls:status-line-cache",
    "runtime:controls:status-line-segment-toggle",
  ]) {
    assert.equal(
      runtimeControlsCases.has(aggregateCaseId),
      false,
      `${aggregateCaseId} must stay aggregate-only outside default runtime:controls suite selection`,
    );
  }
  for (const splitCaseId of [
    "runtime:controls:context-engine-validator",
    "runtime:controls:context-engine-status",
    "runtime:controls:context-engine-valid-boundary",
    "runtime:controls:experience-scheduler-validator",
    "runtime:controls:experience-runtime-start-team",
    "runtime:controls:experience-runtime-start-config",
    "runtime:controls:mcp-instruction-validator",
    "runtime:controls:mcp-instruction-valid-disabled-boundary",
    "runtime:controls:status-line-validator",
  ]) {
    assert.equal(
      runtimeControlsCases.has(splitCaseId),
      true,
      `${splitCaseId} must be part of default runtime:controls suite selection`,
    );
  }
  const seededCaseMetadata = new Map(casesPayload.cases.map((testCase) => [testCase.id, testCase]));
  for (const splitCaseId of [
    "runtime:controls:context-engine-validator",
    "runtime:controls:context-engine-status",
    "runtime:controls:context-engine-valid-boundary",
    "runtime:controls:experience-scheduler-validator",
    "runtime:controls:experience-runtime-start-team",
    "runtime:controls:experience-runtime-start-config",
    "runtime:controls:mcp-instruction-validator",
    "runtime:controls:mcp-instruction-valid-disabled-boundary",
    "runtime:controls:status-line-validator",
  ]) {
    assert.equal(
      Number(seededCaseMetadata.get(splitCaseId)?.estimatedMs ?? 0) > 0,
      true,
      `${splitCaseId} must expose a non-zero seed estimate before historical timings exist`,
    );
  }
  for (const unseededCaseId of [
    "runtime:controls:context-engine-env",
    "runtime:controls:context-engine-toml",
    "runtime:controls:experience-runtime-start",
    "runtime:controls:mcp-instruction",
  ]) {
    assert.equal(
      runtimeControlsCases.has(unseededCaseId),
      false,
      `${unseededCaseId} must not be pulled into default selection by seed estimates`,
    );
  }
} finally {
  rmSync(runtimeControlsPlanDir, { recursive: true, force: true });
}
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:controls:status-line"),
  true,
  "runtime controls must expose case-level status-line contracts",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:context:quality-guard"),
  true,
  "runtime context must expose case-level quality guard flow",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:context:graph-autotune-adaptive-sequence"),
  true,
  "runtime context must expose case-level graph autotune adaptive sequence flow",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:plan:diagnostics-command"),
  true,
  "runtime plan must expose case-level diagnostics command flow",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:plan:diagnostics-plan-command"),
  true,
  "runtime plan must expose split diagnostics plan-command flow",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:plan:diagnostics-skill-creator"),
  true,
  "runtime plan must expose split diagnostics skill-creator flow",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:plan:diagnostics-user-command"),
  true,
  "runtime plan must expose split diagnostics user-command flow",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:plan:events-policy"),
  true,
  "runtime plan must expose isolated case-level events policy flow",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:model-controls:kimi-options"),
  true,
  "runtime model controls must expose case-level Kimi option controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:model-controls:cli-env"),
  true,
  "runtime model controls must expose case-level CLI/env controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:provider-status:persisted-failure"),
  true,
  "runtime provider status must expose case-level persisted failure status smoke",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:provider-status:clean-alternate"),
  true,
  "runtime provider status must expose case-level clean alternate smoke",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:start-controls:runtime-options"),
  true,
  "runtime start controls must expose case-level runtime option controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:start-controls:memory-maintenance-env"),
  true,
  "runtime start controls must expose case-level memory maintenance environment controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:start-controls:ask-user-ttl-env"),
  true,
  "runtime start controls must expose case-level ask-user TTL environment controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:experience-state-controls:storage-cli"),
  true,
  "runtime experience/state controls must expose case-level storage CLI controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:experience-state-controls:session-history"),
  true,
  "runtime experience/state controls must expose case-level session history controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:experience-state-controls:experience-recall"),
  true,
  "runtime experience/state controls must expose case-level experience recall controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:management-gc-controls:management-policy"),
  true,
  "runtime management/gc controls must expose case-level management policy controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:management-gc-controls:management-storage"),
  true,
  "runtime management/gc controls must expose case-level management storage controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:management-gc-controls:gc-env"),
  true,
  "runtime management/gc controls must expose case-level GC environment controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:tool-context-controls:tool-start"),
  true,
  "runtime tool/context controls must expose case-level tool start controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "runtime:tool-context-controls:context-status"),
  true,
  "runtime tool/context controls must expose case-level context status controls",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "gateway:semantic-benchmark:smoke"),
  true,
  "semantic benchmark suite must expose a quick smoke benchmark case",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "gateway:semantic-benchmark:aggregate"),
  true,
  "semantic benchmark suite must keep an aggregate full benchmark reproduction case",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "gateway:tui:browser-health"),
  true,
  "gateway TUI must expose case-level browser/health contracts",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "gateway:tui:activity-status"),
  true,
  "gateway TUI must expose case-level activity/status contracts",
);
assert.equal(
  casesPayload.cases.some((testCase) => testCase.id === "gateway:tui:ask-skill"),
  true,
  "gateway TUI must expose case-level ask/skill contracts",
);

const shardResult = spawnSync("node", ["gateway/tests/check-gateway-node.mjs", "--suite", "workflow", "--shard", "1/1", "--json"], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
});
assert.equal(shardResult.status, 0, `single-suite shard run must pass\nstdout:\n${shardResult.stdout}\nstderr:\n${shardResult.stderr}`);

const workerResult = spawnSync("node", ["gateway/tests/check-gateway-node.mjs", "--suite", "workflow", "--suite", "gateway:core", "--workers", "2", "--json"], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
});
assert.equal(workerResult.status, 0, `multi-suite worker run must pass\nstdout:\n${workerResult.stdout}\nstderr:\n${workerResult.stderr}`);
const workerPayload = JSON.parse(workerResult.stdout);
assert.equal(workerPayload.worker_report_count, 2, "worker run must expose one parent report per worker bucket");
assert.equal(workerPayload.case_count, 2, "worker run must aggregate child case results into parent JSON");
assert.equal(workerPayload.step_count, 2, "worker run must expose parent worker steps");
assert.equal(
  workerPayload.cases.some((entry) => entry.type === "worker" && Array.isArray(entry.cases) && entry.cases.length === 1),
  true,
  "worker run must include structured worker bucket metadata",
);
assert.equal(
  workerPayload.cases.some((entry) => entry.type === "case" && entry.id === "workflow:full" && entry.status === "ok"),
  true,
  "worker run must include successful child case metadata",
);
const bucketPlannerResult = spawnSync(
  "node",
  [
    "--input-type=module",
    "--eval",
    [
      "import assert from 'node:assert/strict';",
      "import { planCaseBuckets } from './gateway/tests/check-gateway-node/case-bucket-planner.mjs';",
      "const cases = [3, 3, 2, 2, 2].map((estimatedMs, index) => ({ id: `case:${index}`, estimatedMs }));",
      "const buckets = planCaseBuckets(cases.map((testCase) => testCase.id), 2, cases);",
      "const maxTotal = Math.max(...buckets.map((bucket) => bucket.totalMs));",
      "assert.equal(maxTotal, 6, 'bounded exact planner must improve non-optimal greedy LPT buckets');",
    ].join("\n"),
  ],
  {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
assert.equal(
  bucketPlannerResult.status,
  0,
  `bounded optimal bucket planner smoke must pass\nstdout:\n${bucketPlannerResult.stdout}\nstderr:\n${bucketPlannerResult.stderr}`,
);

const caseResult = spawnSync("node", ["gateway/tests/check-gateway-node.mjs", "--case", "workflow:full", "--json"], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
});
assert.equal(caseResult.status, 0, `single-case run must pass\nstdout:\n${caseResult.stdout}\nstderr:\n${caseResult.stderr}`);

const tmp = mkdtempSync(join(tmpdir(), "grobot-gateway-run-plan-"));
try {
  const planPath = join(tmp, "plan.json");
  writeFileSync(planPath, `${JSON.stringify({ schema: 1, cases: ["workflow:full"] }, null, 2)}\n`);
  const runPlanResult = spawnSync("node", ["gateway/tests/check-gateway-node.mjs", "--run-plan", planPath, "--workers", "2", "--json"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(runPlanResult.status, 0, `run-plan worker run must pass\nstdout:\n${runPlanResult.stdout}\nstderr:\n${runPlanResult.stderr}`);
  const runPlanPayload = JSON.parse(runPlanResult.stdout);
  assert.equal(runPlanPayload.worker_report_count, 0, "single-case run plan should not spawn redundant workers");
  assert.equal(runPlanPayload.case_count, 1, "single-case run plan must expose the executed case result");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write("gateway suite registry checks passed.\n");
