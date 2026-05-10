#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

process.stdout.write("gateway suite registry checks passed.\n");
