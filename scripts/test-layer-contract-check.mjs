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

function runGit(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

function testPackageScriptsUseStrictDefault() {
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  const scripts = packageJson.scripts ?? {};
  assert.equal(scripts["check:layer-contract"], "node scripts/layer-contract-check.mjs --strict");
  assert.equal(scripts["check:layer-contract:strict"], "node scripts/layer-contract-check.mjs --strict");
  assert.equal(scripts["check:layer-contract:warn"], "node scripts/layer-contract-check.mjs");
  assert.match(scripts.check ?? "", /npm run check:layer-contract( |$|&&)/);
  assert.doesNotMatch(scripts.check ?? "", /check:layer-contract:warn/);

  const layerSpec = JSON.parse(
    readFileSync(resolve(repoRoot, "scripts/layer-contract-spec.json"), "utf8"),
  );
  const gatewayCliLayer = (layerSpec.layers ?? []).find((layer) =>
    layer?.name === "gateway-cli"
  );
  assert.equal(gatewayCliLayer?.path, "gateway/src/cli");
  assert.deepEqual(
    [...(gatewayCliLayer?.requiredDirs ?? [])].sort(),
    [
      "commands",
      "gc",
      "init",
      "provider-probe",
      "runtime-health",
      "serve",
      "services",
      "start",
      "status",
      "system",
      "tui",
    ].sort(),
  );
  const gatewayCliStartLayer = (layerSpec.layers ?? []).find((layer) =>
    layer?.name === "gateway-cli-start"
  );
  assert.equal(gatewayCliStartLayer?.path, "gateway/src/cli/start");
  assert.deepEqual(
    [...(gatewayCliStartLayer?.requiredDirs ?? [])].sort(),
    [
      "context",
      "interactive-bindings",
      "interactive-mode",
      "plan-artifact",
      "plan-mode",
      "rewind-store",
      "session",
      "session-registry",
      "startup",
      "status",
      "turn",
      "user-commands",
    ].sort(),
  );
  const startRootCountRule = (layerSpec.directFileCountWarnings ?? []).find((rule) =>
    rule?.name === "gateway-cli-start-root"
  );
  assert.equal(startRootCountRule?.path, "gateway/src/cli/start");
  assert.equal(startRootCountRule?.maxFiles, 34);
}

function testTrackedGeneratedStateTriggersWarning() {
  const root = makeTempRepo();
  try {
    runGit(root, ["init"]);
    write(".grobot/context/cache.jsonl", "{}\n", root);
    write(".grobot/memory/README.md", "# Memory\n", root);
    runGit(root, ["add", "."]);
    const spec = baseSpec();
    spec.layers = [];
    spec.importPolicyWarnings = [];
    spec.trackedGeneratedStateWarnings = [
      {
        name: "runtime-state",
        pathPrefixes: [".grobot/context/"],
        allowedBasenames: ["README.md"],
      },
    ];
    const specPath = resolve(root, "spec.json");
    writeFileSync(specPath, JSON.stringify(spec, null, 2));

    const result = runCheck({ root, specPath });
    assert.equal(result.code, 1);
    assert.equal(result.payload.pass, false);
    assert.ok(
      result.payload.warnings.some((entry) =>
        String(entry).includes("tracked runtime state should be untracked: .grobot/context/cache.jsonl")
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function testLegacyPathRatchetTriggersWarningOnlyWhenDebtGrows() {
  const root = makeTempRepo();
  try {
    runGit(root, ["init"]);
    write("gateway/src/orchestration/entrypoints/dev-cli/index.ts", "export {};\n", root);
    write("gateway/src/orchestration/entrypoints/dev-cli/start/run.ts", "export {};\n", root);
    runGit(root, ["add", "."]);
    const spec = baseSpec();
    spec.layers = [];
    spec.importPolicyWarnings = [];
    spec.legacyPathWarnings = [
      {
        name: "gateway-dev-cli",
        pathPrefixes: ["gateway/src/orchestration/entrypoints/dev-cli/"],
        maxFiles: 1,
        message: "migrate to gateway/src/cli",
      },
    ];
    const specPath = resolve(root, "spec.json");
    writeFileSync(specPath, JSON.stringify(spec, null, 2));

    const result = runCheck({ root, specPath });
    assert.equal(result.code, 1);
    assert.equal(result.payload.pass, false);
    assert.ok(
      result.payload.warnings.some((entry) =>
        String(entry).includes("2 files exceed limit=1")
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function testLegacyPathRatchetIncludesUntrackedFiles() {
  const root = makeTempRepo();
  try {
    runGit(root, ["init"]);
    write("gateway/src/orchestration/entrypoints/dev-cli/index.ts", "export {};\n", root);
    runGit(root, ["add", "."]);
    runGit(root, ["commit", "-m", "init"]);
    write("gateway/src/orchestration/entrypoints/dev-cli/new-product.ts", "export {};\n", root);
    const spec = baseSpec();
    spec.layers = [];
    spec.importPolicyWarnings = [];
    spec.legacyPathWarnings = [
      {
        name: "gateway-dev-cli",
        pathPrefixes: ["gateway/src/orchestration/entrypoints/dev-cli/"],
        maxFiles: 1,
        message: "migrate to gateway/src/cli",
      },
    ];
    const specPath = resolve(root, "spec.json");
    writeFileSync(specPath, JSON.stringify(spec, null, 2));

    const result = runCheck({ root, specPath });
    assert.equal(result.code, 1);
    assert.equal(result.payload.pass, false);
    assert.ok(
      result.payload.warnings.some((entry) =>
        String(entry).includes("2 files exceed limit=1")
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function testDirectFileCountRatchetTriggersWarningOnlyWhenRootGrows() {
  const root = makeTempRepo();
  try {
    runGit(root, ["init"]);
    write("gateway/src/cli/start/run.ts", "export {};\n", root);
    write("gateway/src/cli/start/session/ops.ts", "export {};\n", root);
    runGit(root, ["add", "."]);
    const spec = baseSpec();
    spec.layers = [];
    spec.importPolicyWarnings = [];
    spec.directFileCountWarnings = [
      {
        name: "start-root",
        path: "gateway/src/cli/start",
        extensions: [".ts"],
        maxFiles: 0,
        message: "keep root thin",
      },
    ];
    const specPath = resolve(root, "spec.json");
    writeFileSync(specPath, JSON.stringify(spec, null, 2));

    const result = runCheck({ root, specPath });
    assert.equal(result.code, 1);
    assert.equal(result.payload.pass, false);
    assert.ok(
      result.payload.warnings.some((entry) =>
        String(entry).includes("1 files exceed limit=0")
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function testSourceSizeAggregateRatchetFailsOnGrowth() {
  const root = makeTempRepo();
  try {
    runGit(root, ["init"]);
    write("gateway/src/example.ts", `${"x\n".repeat(12)}`, root);
    runGit(root, ["add", "."]);
    const spec = baseSpec();
    spec.layers = [];
    spec.importPolicyWarnings = [];
    spec.sourceFileSizeWarnings = [
      {
        name: "product-source",
        includePrefixes: ["gateway/src/"],
        extensions: [".ts"],
        warn: 5,
        fail: 10,
        maxWarnCount: 1,
        maxFailCount: 0,
        maxObservedLines: 11,
      },
    ];
    const specPath = resolve(root, "spec.json");
    writeFileSync(specPath, JSON.stringify(spec, null, 2));

    const result = runCheck({ root, specPath });
    assert.equal(result.code, 1);
    assert.equal(result.payload.pass, false);
    assert.ok(
      result.payload.failures.some((entry) =>
        String(entry).includes("fail debt count increased")
      )
    );
    assert.ok(
      result.payload.failures.some((entry) =>
        String(entry).includes("largest file grew")
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function testSourceSizeRatchetIncludesUntrackedFiles() {
  const root = makeTempRepo();
  try {
    runGit(root, ["init"]);
    write(".gitignore", "ignored.ts\n", root);
    write("gateway/tests/large-untracked.mjs", `${"x\n".repeat(9)}`, root);
    write("gateway/tests/ignored.ts", `${"x\n".repeat(40)}`, root);
    runGit(root, ["add", ".gitignore"]);
    runGit(root, ["commit", "-m", "init"]);
    const spec = baseSpec();
    spec.layers = [];
    spec.importPolicyWarnings = [];
    spec.sourceFileSizeWarnings = [
      {
        name: "gateway-test-source",
        includePrefixes: ["gateway/tests/"],
        extensions: [".mjs", ".ts"],
        warn: 5,
        fail: 10,
        maxWarnCount: 0,
        maxFailCount: 0,
        maxObservedLines: 5,
      },
    ];
    const specPath = resolve(root, "spec.json");
    writeFileSync(specPath, JSON.stringify(spec, null, 2));

    const result = runCheck({ root, specPath });
    assert.equal(result.code, 1);
    assert.equal(result.payload.pass, false);
    assert.ok(
      result.payload.warnings.some((entry) =>
        String(entry).includes("warn debt count increased")
      )
    );
    assert.ok(
      result.payload.failures.some((entry) =>
        String(entry).includes("largest file grew: 10 lines in gateway/tests/large-untracked.mjs")
      )
    );
    assert.equal(
      result.payload.failures.some((entry) => String(entry).includes("ignored.ts")),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function testForbiddenTextTriggersWarningWithAllowlist() {
  const root = makeTempRepo();
  try {
    runGit(root, ["init"]);
    write("gateway/src/cli/index.ts", "export const runDevCli = () => 0;\n", root);
    write("gateway/src/orchestration/entrypoints/dev-cli/index.ts", "export const runDevCli = () => 0;\n", root);
    runGit(root, ["add", "."]);
    const spec = baseSpec();
    spec.layers = [];
    spec.importPolicyWarnings = [];
    spec.forbiddenTextWarnings = [
      {
        name: "cli-product-dev-cli-names",
        includePrefixes: ["gateway/src/cli/", "gateway/src/orchestration/"],
        extensions: [".ts"],
        patterns: [
          {
            regex: "\\brunDevCli\\b",
            message: "use Cli names in product code",
            allowlist: [
              {
                pathEquals: "gateway/src/orchestration/entrypoints/dev-cli/index.ts",
                reason: "legacy compatibility re-export",
              },
            ],
          },
        ],
      },
    ];
    const specPath = resolve(root, "spec.json");
    writeFileSync(specPath, JSON.stringify(spec, null, 2));

    const result = runCheck({ root, specPath });
    assert.equal(result.code, 1);
    assert.equal(result.payload.pass, false);
    assert.ok(
      result.payload.warnings.some((entry) =>
        String(entry).includes("gateway/src/cli/index.ts:1 matched")
      )
    );
    assert.equal(
      result.payload.warnings.some((entry) =>
        String(entry).includes("gateway/src/orchestration/entrypoints/dev-cli/index.ts")
      ),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function testForbiddenTextBlocksTsDevCliImplementationNames() {
  const root = makeTempRepo();
  try {
    runGit(root, ["init"]);
    write(
      "gateway/src/cli/gc/run-gc.ts",
      "function resolveDefaultTsDevCliCacheRoot() { return ''; }\nconst target = 'ts_dev_cli_cache';\n",
      root,
    );
    runGit(root, ["add", "."]);
    runGit(root, ["commit", "-m", "init"]);
    const spec = baseSpec();
    spec.layers = [];
    spec.importPolicyWarnings = [];
    spec.forbiddenTextWarnings = [
      {
        name: "cli-product-dev-cli-names",
        includePrefixes: ["gateway/src/cli/"],
        extensions: [".ts"],
        patterns: [
          {
            regex: "\\b[A-Za-z0-9_]*TsDevCli[A-Za-z0-9_]*\\b",
            message: "ts-dev-cli labels must not leak into product implementation names",
          },
          {
            regex: "\\b[A-Za-z0-9_]*ts_dev_cli[A-Za-z0-9_]*\\b",
            message: "ts-dev-cli labels must not leak into product implementation names",
          },
        ],
      },
    ];
    const specPath = resolve(root, "spec.json");
    writeFileSync(specPath, JSON.stringify(spec, null, 2));

    const result = runCheck({ root, specPath });
    assert.equal(result.code, 1);
    assert.equal(result.payload.pass, false);
    assert.ok(
      result.payload.warnings.some((entry) =>
        String(entry).includes("gateway/src/cli/gc/run-gc.ts:1 matched")
      )
    );
    assert.ok(
      result.payload.warnings.some((entry) =>
        String(entry).includes("gateway/src/cli/gc/run-gc.ts:2 matched")
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function testLegacyContractNameTriggersWarning() {
  const root = makeTempRepo();
  try {
    runGit(root, ["init"]);
    write("gateway/src/extensions/contracts/dev-cli-ui-renderer-contract.ts", "export {};\n", root);
    write("gateway/src/extensions/contracts/run-start-plan-mode-contract.ts", "export {};\n", root);
    runGit(root, ["add", "."]);
    const spec = baseSpec();
    spec.layers = [];
    spec.importPolicyWarnings = [];
    spec.legacyPathWarnings = [
      {
        name: "gateway-dev-cli-contract-names",
        pathPrefixes: ["gateway/src/extensions/contracts/dev-cli-"],
        maxFiles: 0,
        message: "use cli-* contract names",
      },
      {
        name: "gateway-run-start-contract-names",
        pathPrefixes: ["gateway/src/extensions/contracts/run-start-"],
        maxFiles: 0,
        message: "use start-* contract names",
      },
    ];
    const specPath = resolve(root, "spec.json");
    writeFileSync(specPath, JSON.stringify(spec, null, 2));

    const result = runCheck({ root, specPath });
    assert.equal(result.code, 1);
    assert.equal(result.payload.pass, false);
    assert.ok(
      result.payload.warnings.some((entry) =>
        String(entry).includes("gateway-dev-cli-contract-names")
      )
    );
    assert.ok(
      result.payload.warnings.some((entry) =>
        String(entry).includes("gateway-run-start-contract-names")
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
  testTrackedGeneratedStateTriggersWarning();
  testLegacyPathRatchetTriggersWarningOnlyWhenDebtGrows();
  testLegacyPathRatchetIncludesUntrackedFiles();
  testDirectFileCountRatchetTriggersWarningOnlyWhenRootGrows();
  testSourceSizeAggregateRatchetFailsOnGrowth();
  testSourceSizeRatchetIncludesUntrackedFiles();
  testForbiddenTextTriggersWarningWithAllowlist();
  testForbiddenTextBlocksTsDevCliImplementationNames();
  testLegacyContractNameTriggersWarning();
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
