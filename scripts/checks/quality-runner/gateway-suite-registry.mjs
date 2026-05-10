#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  casesPayload.cases.some((testCase) => testCase.id === "runtime:controls:status-line"),
  true,
  "runtime controls must expose case-level status-line contracts",
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
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write("gateway suite registry checks passed.\n");
