import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonFile(path) {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

function runNodeScript(scriptPath, inputText = null) {
  const completed = spawnSync("node", [scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 120_000,
    input: typeof inputText === "string" ? inputText : undefined,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    code: typeof completed.status === "number" ? completed.status : 1,
    stdout: completed.stdout ?? "",
    stderr: completed.stderr ?? "",
  };
}

function parseTailJson(stdout, label) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const tail = lines[lines.length - 1] ?? "";
  if (!tail) {
    throw new Error(`${label} stdout is empty`);
  }
  return JSON.parse(tail);
}

function extractBridgeCliErrorCodes(repoRoot) {
  const bridgeCliPath = resolve(repoRoot, "gateway/src/extensions/bridge-cli.ts");
  const source = readFileSync(bridgeCliPath, "utf8");
  const set = new Set();
  const pattern = /const\s+[A-Z0-9_]+\s*=\s*"([A-Z0-9_]+)";/g;
  for (const match of source.matchAll(pattern)) {
    const code = match[1];
    if (typeof code !== "string") {
      continue;
    }
    if (code.startsWith("PLAN_") || code === "BRIDGE_FATAL") {
      set.add(code);
    }
  }
  return set;
}

function runBridgeFatalScenario(repoRoot) {
  const input = JSON.stringify({
    session: {
      platform: "feishu",
      tenant: "grobot",
      scope: "dm",
      subject: "bridge-schema-contract-user",
    },
    context: {
      actorId: "contract",
      projectId: "grobot",
    },
    workDir: "/tmp/grobot-bridge-schema-contract",
  });
  const completed = spawnSync(
    "npx",
    ["--yes", "--package", "tsx@4.20.6", "tsx", "gateway/src/extensions/bridge-cli.ts"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 120_000,
      input,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return {
    code: typeof completed.status === "number" ? completed.status : 1,
    stdout: completed.stdout ?? "",
    stderr: completed.stderr ?? "",
  };
}

function main() {
  const repoRoot = process.cwd();
  const schemaPath = resolve(repoRoot, "shared/contracts/bridge-plan-error-codes-v1.json");
  const schemaPayload = parseJsonFile(schemaPath);
  assert.equal(isObject(schemaPayload), true);
  assert.equal(schemaPayload.schema, "bridge_plan_error_codes");
  assert.equal(schemaPayload.schema_version, 1);
  assert.equal(Array.isArray(schemaPayload.codes), true);

  const registry = new Set();
  for (const item of schemaPayload.codes) {
    assert.equal(isObject(item), true);
    const code = typeof item.code === "string" ? item.code.trim() : "";
    assert.equal(code.length > 0, true);
    registry.add(code);
  }
  assert.equal(registry.size >= 8, true);
  const sourceCodes = extractBridgeCliErrorCodes(repoRoot);
  assert.equal(sourceCodes.size >= 8, true);
  const missingInSchema = [...sourceCodes].filter((code) => !registry.has(code)).sort();
  const extraInSchema = [...registry].filter((code) => !sourceCodes.has(code)).sort();
  assert.deepEqual(missingInSchema, [], `schema missing source codes: ${missingInSchema.join(", ")}`);
  assert.deepEqual(extraInSchema, [], `schema has extra codes: ${extraInSchema.join(", ")}`);

  const bridgeContractPath = resolve(repoRoot, "gateway/src/extensions/contracts/bridge-cli-contract.mjs");
  const bridgeContract = runNodeScript(bridgeContractPath);
  if (bridgeContract.code !== 0) {
    throw new Error(
      `bridge-cli-contract failed exit=${String(bridgeContract.code)} stdout=${bridgeContract.stdout} stderr=${bridgeContract.stderr}`,
    );
  }
  const bridgePayload = parseTailJson(bridgeContract.stdout, "bridge-cli-contract");
  assert.equal(isObject(bridgePayload), true);
  const observedCodes = [
    bridgePayload.no_active_error_code,
    bridgePayload.guard_error_code,
    bridgePayload.append_note_error_code,
    bridgePayload.review_error_code,
    bridgePayload.apply_blocked_error_code,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  for (const code of observedCodes) {
    assert.equal(registry.has(code), true);
  }

  const fatalResult = runBridgeFatalScenario(repoRoot);
  assert.equal(fatalResult.code, 1);
  const fatalPayload = parseTailJson(fatalResult.stdout, "bridge-fatal-scenario");
  assert.equal(isObject(fatalPayload), true);
  assert.equal(fatalPayload.status, "error");
  assert.equal(typeof fatalPayload.error_code, "string");
  assert.equal(registry.has(String(fatalPayload.error_code)), true);
  assert.equal(String(fatalPayload.error_code), "BRIDGE_FATAL");

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      schema_path: schemaPath,
      registry_count: registry.size,
      source_codes_count: sourceCodes.size,
      source_codes: [...sourceCodes].sort(),
      missing_in_schema_count: missingInSchema.length,
      missing_in_schema: missingInSchema,
      extra_in_schema_count: extraInSchema.length,
      extra_in_schema: extraInSchema,
      observed_codes: observedCodes,
      fatal_error_code: fatalPayload.error_code,
    })}\n`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`bridge-error-codes-schema-contract failed: ${message}\n`);
  process.exitCode = 1;
}
