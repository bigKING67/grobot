#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const scriptPath = resolve(__filename, "..");
const checkScriptPath = resolve(scriptPath, "layer-contract-check.mjs");

function makeTempRepo() {
  return mkdtempSync(resolve(tmpdir(), "grobot-layer-contract-test-"));
}

function write(relativePath, content, root) {
  const target = resolve(root, relativePath);
  mkdirSync(resolve(target, ".."), { recursive: true });
  writeFileSync(target, content);
}

function runCheck({ root, specPath }) {
  const result = spawnSync(
    process.execPath,
    [checkScriptPath, "--repo-root", root, "--spec", specPath, "--strict", "--json"],
    { encoding: "utf8" }
  );
  const stdout = (result.stdout || "").trim();
  const payload = stdout ? JSON.parse(stdout) : {};
  return {
    code: result.status ?? 1,
    payload,
  };
}

function baseSpec() {
  return {
    schema: "layer_contract_test",
    layers: [
      {
        name: "model",
        path: "runtime/src/models",
        requiredDirs: [],
      },
    ],
    docs: [],
    maxLinesWarnings: [],
    importPolicyWarnings: [
      {
        name: "model",
        path: "runtime/src/models",
        forbiddenCratePrefixes: ["extensions"],
      },
    ],
    importPolicyAllowlist: [],
  };
}

function testForbiddenImportTriggersWarning() {
  const root = makeTempRepo();
  try {
    write("runtime/src/models/sample.rs", "use crate::extensions::protocol::handle_request;\n", root);
    const spec = baseSpec();
    const specPath = resolve(root, "spec.json");
    writeFileSync(specPath, JSON.stringify(spec, null, 2));

    const result = runCheck({ root, specPath });
    assert.equal(result.code, 1);
    assert.equal(result.payload.pass, false);
    assert.ok(Array.isArray(result.payload.warnings));
    assert.ok(
      result.payload.warnings.some((entry) =>
        String(entry).includes("runtime/src/models/sample.rs")
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function testAllowlistSuppressesWarning() {
  const root = makeTempRepo();
  try {
    write("runtime/src/models/sample.rs", "use crate::extensions::protocol::handle_request;\n", root);
    const spec = baseSpec();
    spec.importPolicyAllowlist.push({
      pathEquals: "runtime/src/models/sample.rs",
      cratePrefix: "extensions",
    });
    const specPath = resolve(root, "spec.json");
    writeFileSync(specPath, JSON.stringify(spec, null, 2));

    const result = runCheck({ root, specPath });
    assert.equal(result.code, 0);
    assert.equal(result.payload.pass, true);
    assert.equal(result.payload.warnings.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function testForbiddenTsImportTriggersWarning() {
  const root = makeTempRepo();
  try {
    write("gateway/src/tools/example.ts", 'import { evaluateTurnGovernance } from "../governance/evaluator";\n', root);
    const spec = baseSpec();
    spec.layers = [
      {
        name: "gateway-tools",
        path: "gateway/src/tools",
        requiredDirs: [],
      },
    ];
    spec.importPolicyWarnings = [
      {
        name: "gateway-tools",
        path: "gateway/src/tools",
        fileExtensions: [".ts"],
        forbiddenImportPrefixes: ["../governance"],
      },
    ];
    const specPath = resolve(root, "spec.json");
    writeFileSync(specPath, JSON.stringify(spec, null, 2));

    const result = runCheck({ root, specPath });
    assert.equal(result.code, 1);
    assert.equal(result.payload.pass, false);
    assert.ok(Array.isArray(result.payload.warnings));
    assert.ok(
      result.payload.warnings.some((entry) =>
        String(entry).includes("gateway/src/tools/example.ts")
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  testForbiddenImportTriggersWarning();
  testAllowlistSuppressesWarning();
  testForbiddenTsImportTriggersWarning();
  process.stdout.write("layer-contract-check tests passed.\n");
}

main();
