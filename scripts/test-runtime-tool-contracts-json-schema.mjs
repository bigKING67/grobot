#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const runnerPath = "scripts/check-runtime-tool-contracts.mjs";

function fail(message, details = {}) {
  const suffix = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : "";
  throw new Error(`${message}${suffix}`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runRunner({ env = {}, expectedStatus }) {
  const result = spawnSync("node", [runnerPath, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
  if (result.status !== expectedStatus) {
    fail("unexpected runtime-tool runner status", {
      expectedStatus,
      status: result.status,
      signal: result.signal,
      stdout: result.stdout.slice(-1000),
      stderr: result.stderr.slice(-1000),
    });
  }
  const firstLine = result.stdout.trim().split("\n")[0] ?? "";
  try {
    return JSON.parse(firstLine);
  } catch (error) {
    fail("runtime-tool runner did not emit parseable JSON on stdout first line", {
      error: error instanceof Error ? error.message : String(error),
      stdout: result.stdout.slice(-1000),
      stderr: result.stderr.slice(-1000),
    });
  }
}

function validateCompactResult(value, index) {
  expect(isObject(value), `results[${index}] must be object`);
  expect(typeof value.id === "string" && value.id.length > 0, `results[${index}].id must be non-empty string`);
  expect(typeof value.path === "string" && value.path.length > 0, `results[${index}].path must be non-empty string`);
  expect(typeof value.status === "number", `results[${index}].status must be number`);
  expect(value.signal === null || typeof value.signal === "string", `results[${index}].signal must be null|string`);
  expect(typeof value.duration_ms === "number", `results[${index}].duration_ms must be number`);
  expect(typeof value.output === "string", `results[${index}].output must be string`);
}

function validateFailedContractDetail(value) {
  expect(isObject(value), "failed_contract_detail must be object when failed_contract is set");
  expect(typeof value.id === "string" && value.id.length > 0, "failed_contract_detail.id must be non-empty string");
  expect(typeof value.path === "string" && value.path.length > 0, "failed_contract_detail.path must be non-empty string");
  expect(typeof value.status === "number", "failed_contract_detail.status must be number");
  expect(value.signal === null || typeof value.signal === "string", "failed_contract_detail.signal must be null|string");
  expect(typeof value.duration_ms === "number", "failed_contract_detail.duration_ms must be number");
  expect(
    typeof value.suggested_command === "string" && value.suggested_command.length > 0,
    "failed_contract_detail.suggested_command must be non-empty string",
  );
  expect(typeof value.error_message === "string", "failed_contract_detail.error_message must be string");
  expect(
    value.last_output_json === null || isObject(value.last_output_json),
    "failed_contract_detail.last_output_json must be null|object",
  );
  expect(typeof value.stdout_tail === "string", "failed_contract_detail.stdout_tail must be string");
  expect(typeof value.stderr_tail === "string", "failed_contract_detail.stderr_tail must be string");
}

function validateRuntimeBinary(value) {
  expect(value === null || isObject(value), "runtime_binary must be null|object");
  if (value === null) {
    return;
  }
  expect(typeof value.path === "string" && value.path.length > 0, "runtime_binary.path must be non-empty string");
  expect(typeof value.exists === "boolean", "runtime_binary.exists must be boolean");
  expect(typeof value.source === "string" && value.source.length > 0, "runtime_binary.source must be non-empty string");
  if (value.exists) {
    expect(typeof value.size_bytes === "number", "runtime_binary.size_bytes must be number when exists");
    expect(typeof value.mtime_ms === "number", "runtime_binary.mtime_ms must be number when exists");
    expect(typeof value.mtime_iso === "string" && value.mtime_iso.length > 0, "runtime_binary.mtime_iso must be string when exists");
  }
}

function validatePayload(payload, expected) {
  expect(isObject(payload), "payload must be object");
  expect(payload.schema_version === 1, "schema_version must be 1");
  expect(typeof payload.ok === "boolean", "ok must be boolean");
  expect(typeof payload.contract_count === "number", "contract_count must be number");
  expect(typeof payload.completed_count === "number", "completed_count must be number");
  expect(typeof payload.include_runtime_describe === "boolean", "include_runtime_describe must be boolean");
  expect(typeof payload.diagnostics_self_test === "boolean", "diagnostics_self_test must be boolean");
  expect(payload.failed_contract === null || typeof payload.failed_contract === "string", "failed_contract must be null|string");
  expect(Array.isArray(payload.results), "results must be array");
  expect(payload.results.length === payload.completed_count, "results length must match completed_count");
  payload.results.forEach(validateCompactResult);
  validateRuntimeBinary(payload.runtime_binary);
  if (payload.failed_contract === null) {
    expect(payload.failed_contract_detail === null, "failed_contract_detail must be null when failed_contract is null");
  } else {
    validateFailedContractDetail(payload.failed_contract_detail);
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    expect(payload[key] === expectedValue, `${key} must equal ${String(expectedValue)}`);
  }
}

const successPayload = runRunner({ expectedStatus: 0 });
validatePayload(successPayload, {
  ok: true,
  include_runtime_describe: false,
  diagnostics_self_test: true,
});
expect(successPayload.failed_contract === null, "success payload failed_contract must be null");
expect(successPayload.runtime_binary === null, "success payload runtime_binary must be null without describe mode");

const forcedFailurePayload = runRunner({
  expectedStatus: 1,
  env: {
    GROBOT_RUNTIME_TOOL_CONTRACTS_TEST_FAIL_ID: "runtime-tool-suite-ownership",
  },
});
validatePayload(forcedFailurePayload, {
  ok: false,
  include_runtime_describe: false,
  diagnostics_self_test: true,
});
expect(
  forcedFailurePayload.failed_contract === "runtime-tool-suite-ownership",
  "forced failure payload must preserve failed_contract id",
);
expect(
  forcedFailurePayload.failed_contract_detail.last_output_json?.marker === "runtime_tool_runner_forced_failure",
  "forced failure payload must preserve last_output_json marker",
);

process.stdout.write(JSON.stringify({
  ok: true,
  schema_version: 1,
  success_contract_count: successPayload.contract_count,
  forced_failure_contract: forcedFailurePayload.failed_contract,
}) + "\n");
