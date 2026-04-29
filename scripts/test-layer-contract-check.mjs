#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const scriptPath = resolve(__filename, "..");
const repoRoot = resolve(scriptPath, "..");
const checkScriptPath = resolve(scriptPath, "layer-contract-check.mjs");

function makeTempRepo() {
  return mkdtempSync(resolve(tmpdir(), "grobot-layer-contract-test-"));
}

function write(relativePath, content, root) {
  const target = resolve(root, relativePath);
  mkdirSync(resolve(target, ".."), { recursive: true });
  writeFileSync(target, content);
}

function runCheck({ root, specPath, strict = true }) {
  const args = [checkScriptPath, "--repo-root", root, "--spec", specPath, "--json"];
  if (strict) {
    args.push("--strict");
  }
  const result = spawnSync(
    process.execPath,
    args,
    { encoding: "utf8" }
  );
  const stdout = (result.stdout || "").trim();
  const payload = stdout ? JSON.parse(stdout) : {};
  return {
    code: result.status ?? 1,
    payload,
  };
}

function testPackageScriptsUseStrictDefault() {
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  const scripts = packageJson.scripts ?? {};
  assert.equal(scripts["check:layer-contract"], "node scripts/layer-contract-check.mjs --strict");
  assert.equal(scripts["check:layer-contract:strict"], "node scripts/layer-contract-check.mjs --strict");
  assert.equal(scripts["check:layer-contract:warn"], "node scripts/layer-contract-check.mjs");
  assert.match(scripts.check ?? "", /npm run check:layer-contract( |$|&&)/);
  assert.doesNotMatch(scripts.check ?? "", /check:layer-contract:warn/);
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

function testEntrypointIncludeMissingRequiredDirTriggersWarning() {
  const root = makeTempRepo();
  try {
    write("runtime/src/tools/tools.rs", 'include!("core/mod.rs");\n', root);
    write("runtime/src/tools/core/mod.rs", "pub fn core() {}\n", root);
    write("runtime/src/tools/bash/mod.rs", "pub fn bash() {}\n", root);
    const spec = baseSpec();
    spec.layers = [
      {
        name: "runtime-tools",
        path: "runtime/src/tools",
        requiredDirs: ["core", "bash"],
        entrypointIncludeChecks: [
          {
            path: "runtime/src/tools/tools.rs",
          },
        ],
      },
    ];
    spec.importPolicyWarnings = [];
    const specPath = resolve(root, "spec.json");
    writeFileSync(specPath, JSON.stringify(spec, null, 2));

    const result = runCheck({ root, specPath });
    assert.equal(result.code, 1);
    assert.equal(result.payload.pass, false);
    assert.ok(
      result.payload.warnings.some((entry) =>
        String(entry).includes("does not include required directory: bash")
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function testEntrypointIncludeUnexpectedCapabilityTriggersWarning() {
  const root = makeTempRepo();
  try {
    write("runtime/src/tools/tools.rs", 'include!("core/mod.rs");\ninclude!("shell/mod.rs");\n', root);
    write("runtime/src/tools/core/mod.rs", "pub fn core() {}\n", root);
    write("runtime/src/tools/shell/mod.rs", "pub fn shell() {}\n", root);
    const spec = baseSpec();
    spec.layers = [
      {
        name: "runtime-tools",
        path: "runtime/src/tools",
        requiredDirs: ["core"],
        entrypointIncludeChecks: [
          {
            path: "runtime/src/tools/tools.rs",
          },
        ],
      },
    ];
    spec.importPolicyWarnings = [];
    const specPath = resolve(root, "spec.json");
    writeFileSync(specPath, JSON.stringify(spec, null, 2));

    const result = runCheck({ root, specPath });
    assert.equal(result.code, 1);
    assert.equal(result.payload.pass, false);
    assert.ok(
      result.payload.warnings.some((entry) =>
        String(entry).includes("includes unexpected capability: shell/mod.rs")
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function testEntrypointIncludeAllowsSupportFiles() {
  const root = makeTempRepo();
  try {
    write(
      "runtime/src/tools/tools.rs",
      'include!("core/mod.rs");\ninclude!("file_snapshot/mod.rs");\ninclude!("recovery.rs");\n',
      root
    );
    write("runtime/src/tools/core/mod.rs", "pub fn core() {}\n", root);
    write("runtime/src/tools/file_snapshot/mod.rs", "pub fn snapshot() {}\n", root);
    write("runtime/src/tools/recovery.rs", "pub fn recovery() {}\n", root);
    const spec = baseSpec();
    spec.layers = [
      {
        name: "runtime-tools",
        path: "runtime/src/tools",
        requiredDirs: ["core"],
        entrypointIncludeChecks: [
          {
            path: "runtime/src/tools/tools.rs",
            allowedExtraIncludeDirs: ["file_snapshot"],
            allowedExtraIncludeFiles: ["recovery.rs"],
          },
        ],
      },
    ];
    spec.importPolicyWarnings = [];
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

function testWarnModeAllowsWarningsForDiagnostics() {
  const root = makeTempRepo();
  try {
    write("runtime/src/models/sample.rs", "pub fn sample() {}\n", root);
    const spec = baseSpec();
    spec.layers[0].requiredDirs = ["providers"];
    const specPath = resolve(root, "spec.json");
    writeFileSync(specPath, JSON.stringify(spec, null, 2));

    const result = runCheck({ root, specPath, strict: false });
    assert.equal(result.code, 0);
    assert.equal(result.payload.pass, true);
    assert.ok(Array.isArray(result.payload.warnings));
    assert.ok(
      result.payload.warnings.some((entry) =>
        String(entry).includes("missing required directory")
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  testPackageScriptsUseStrictDefault();
  testForbiddenImportTriggersWarning();
  testAllowlistSuppressesWarning();
  testForbiddenTsImportTriggersWarning();
  testEntrypointIncludeMissingRequiredDirTriggersWarning();
  testEntrypointIncludeUnexpectedCapabilityTriggersWarning();
  testEntrypointIncludeAllowsSupportFiles();
  testWarnModeAllowsWarningsForDiagnostics();
  process.stdout.write("layer-contract-check tests passed.\n");
}

main();
