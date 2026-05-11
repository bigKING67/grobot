#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildQualityGateRegistry, gateNamesForMode, QUALITY_ENTRYPOINT_SCRIPTS, validateQualityGateRegistry } from "../../lib/quality-gate-registry.mjs";
import { explainAffectedSelection, listChangedFiles, selectAffectedGates } from "../../lib/quality-affected.mjs";
import { appendQualityEvent, computeGateCacheKey, computeGateTimingFingerprint, createQualityCacheContext, explainGateCache, summarizeQualityEvents, writeGateCache } from "../../lib/quality-cache.mjs";
import { planQualityGates, runQualityGates } from "../../lib/quality-scheduler.mjs";
import { computeActionContractFingerprint, resolveDeclaredOutputPath, resolveGateActionContract } from "../../lib/quality-action-contract.mjs";
import { createQualityCacheBackend } from "../../lib/quality-cache-backend.mjs";
import { evaluateBenchmarkThresholds, parseBenchmarkCacheHitRatioThreshold, parseBenchmarkMsThreshold } from "../../lib/quality-benchmark-policy.mjs";

function packageJson() {
  return JSON.parse(readFileSync("package.json", "utf8"));
}

function assertIncludes(list, expected, label) {
  assert.equal(list.includes(expected), true, `${label} must include ${expected}; got ${list.join(", ")}`);
}

function assertExcludes(list, unexpected, label) {
  assert.equal(list.includes(unexpected), false, `${label} must not include ${unexpected}`);
}

async function withQualityCacheEnv(env, callback) {
  const previousCacheBackend = process.env.GROBOT_QUALITY_CACHE_BACKEND;
  const previousCacheRoot = process.env.GROBOT_QUALITY_CACHE_ROOT;
  try {
    if (env.GROBOT_QUALITY_CACHE_BACKEND === undefined) {
      delete process.env.GROBOT_QUALITY_CACHE_BACKEND;
    } else {
      process.env.GROBOT_QUALITY_CACHE_BACKEND = env.GROBOT_QUALITY_CACHE_BACKEND;
    }
    if (env.GROBOT_QUALITY_CACHE_ROOT === undefined) {
      delete process.env.GROBOT_QUALITY_CACHE_ROOT;
    } else {
      process.env.GROBOT_QUALITY_CACHE_ROOT = env.GROBOT_QUALITY_CACHE_ROOT;
    }
    return await callback();
  } finally {
    if (previousCacheBackend === undefined) {
      delete process.env.GROBOT_QUALITY_CACHE_BACKEND;
    } else {
      process.env.GROBOT_QUALITY_CACHE_BACKEND = previousCacheBackend;
    }
    if (previousCacheRoot === undefined) {
      delete process.env.GROBOT_QUALITY_CACHE_ROOT;
    } else {
      process.env.GROBOT_QUALITY_CACHE_ROOT = previousCacheRoot;
    }
  }
}

function spawnNode(args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      reject(new Error(`node child exited ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });
}

const registry = buildQualityGateRegistry({ packageJson: packageJson(), repoRoot: process.cwd() });
assert.deepEqual(validateQualityGateRegistry(registry, { packageJson: packageJson(), repoRoot: process.cwd() }), []);

const qualityRunnerGate = registry.byName.get("check:quality-runner");
assert.equal(qualityRunnerGate?.actionContract?.name, "check:quality-runner", "registry gates must expose normalized action contracts");
assert.equal(qualityRunnerGate?.actionContract?.command, qualityRunnerGate?.command, "action contract command must match executable gate command");
assert.equal(
  qualityRunnerGate?.actionContractFingerprint,
  computeActionContractFingerprint(qualityRunnerGate?.actionContract),
  "action contract fingerprint must be derived from normalized action contract",
);
assert.equal(
  resolveGateActionContract({
    cacheable: true,
    command: "node pass-a.mjs",
    env: ["BETA", "ALPHA", "ALPHA"],
    group: "test",
    inputs: ["b.txt", "a.txt", "b.txt"],
    name: "contract-normalization",
  }).inputs.join(","),
  "a.txt,b.txt",
  "action contracts must normalize input sets for stable hashing",
);
assert.deepEqual(
  resolveGateActionContract({
    cacheable: true,
    command: "node pass-a.mjs",
    group: "test",
    name: "contract-toolchains",
  }).toolchains,
  ["node", "npm"],
  "action contracts must declare Node toolchain dimensions by default",
);
assert.deepEqual(
  resolveGateActionContract({
    cacheable: true,
    command: "cargo check --manifest-path runtime/Cargo.toml",
    group: "runtime",
    name: "contract-rust-toolchains",
  }).toolchains,
  ["cargo", "node", "npm", "rustc"],
  "runtime action contracts must declare Rust and Node toolchain dimensions",
);
assert.equal(
  resolveDeclaredOutputPath(process.cwd(), "dist/report.json").path,
  "dist/report.json",
  "declared output paths may be repo-relative",
);
assert.equal(
  resolveDeclaredOutputPath(process.cwd(), "/tmp/report.json").error?.includes("unsafe declared output path"),
  true,
  "declared output paths must reject absolute paths",
);
assert.deepEqual(
  resolveGateActionContract({
    cacheable: true,
    command: "node pass-a.mjs",
    group: "test",
    name: "contract-output-empty",
    outputs: [""],
  }).outputs,
  [""],
  "action contracts must preserve empty output declarations so registry validation can reject them",
);
assert.equal(
  resolveDeclaredOutputPath(process.cwd(), "dist/../report.json").error?.includes("unsafe declared output path"),
  true,
  "declared output paths must reject parent-directory segments even when normalized inside the repo",
);
assert.deepEqual(
  validateQualityGateRegistry({
    ...registry,
    gates: [
      {
        ...qualityRunnerGate,
        actionContract: {
          ...qualityRunnerGate.actionContract,
          outputs: ["../outside.txt"],
        },
      },
    ],
  }, { packageJson: { scripts: QUALITY_ENTRYPOINT_SCRIPTS }, repoRoot: process.cwd() }),
  ["check:quality-runner unsafe declared output path: ../outside.txt"],
  "registry validation must reject declared outputs that escape the repo",
);

for (const [scriptName, expected] of Object.entries(QUALITY_ENTRYPOINT_SCRIPTS)) {
  assert.equal(packageJson().scripts?.[scriptName], expected, `${scriptName} package script drifted`);
}

const runtimeExtension = selectAffectedGates(registry, [
  "runtime/src/extensions/handler.rs",
  "runtime/src/extensions/tests/turn_unknown_fields.rs",
]).names;
assertIncludes(runtimeExtension, "check:runtime:check", "runtime extension affected gates");
assertIncludes(runtimeExtension, "check:runtime:test", "runtime extension affected gates");
assertIncludes(runtimeExtension, "check:gateway:runtime-tools:schema", "runtime extension affected gates");
assertIncludes(runtimeExtension, "check:gateway:suite:runtime:status", "runtime extension affected gates");
assertExcludes(runtimeExtension, "check:gateway:suite:runtime:controls", "runtime extension affected gates");
assertExcludes(runtimeExtension, "check:gateway:suite:gateway:tui", "runtime extension affected gates");

const runtimeExplanation = explainAffectedSelection(registry, ["runtime/src/extensions/handler.rs"]);
assert.equal(
  runtimeExplanation.surfaces.some((surface) => surface.surfaces.includes("runtime.extensions")),
  true,
  "affected explanation must include surface graph hits",
);
assert.equal(
  runtimeExplanation.surfaces.some((surface) => surface.impactedSurfaces.includes("runtime.tool-contracts")),
  true,
  "affected explanation must include impacted surface closure",
);

const tui = selectAffectedGates(registry, ["gateway/src/cli/tui/components/prompt-input/controller.ts"]).names;
assertIncludes(tui, "check:gateway:ts", "tui affected gates");
assertIncludes(tui, "check:gateway:suite:gateway:tui", "tui affected gates");

const runtimeControlsHarness = selectAffectedGates(registry, [
  "gateway/tests/check-gateway-node/runtime-smoke/context-engine-controls.mjs",
]).names;
assertIncludes(runtimeControlsHarness, "check:gateway:suite-registry", "runtime controls harness affected gates");
assertIncludes(runtimeControlsHarness, "check:gateway:suite:runtime:controls", "runtime controls harness affected gates");
assertExcludes(runtimeControlsHarness, "check:gateway:suite:runtime:status", "runtime controls harness affected gates");

const runtimeFailoverHarness = selectAffectedGates(registry, [
  "gateway/tests/check-gateway-node/runtime-smoke/runtime-model-controls.mjs",
]).names;
assertIncludes(runtimeFailoverHarness, "check:gateway:suite:runtime:model-controls", "runtime control helper affected gates");
assertExcludes(runtimeFailoverHarness, "check:gateway:suite:runtime:failover-core", "runtime control helper affected gates");
assertExcludes(runtimeFailoverHarness, "check:gateway:suite:runtime:controls", "runtime failover harness affected gates");

const runtimeToolControlHarness = selectAffectedGates(registry, [
  "gateway/tests/check-gateway-node/runtime-smoke/runtime-tool-controls.mjs",
]).names;
assertIncludes(runtimeToolControlHarness, "check:gateway:suite:runtime:tool-context-controls", "runtime tool control helper affected gates");
assertExcludes(runtimeToolControlHarness, "check:gateway:suite:runtime:model-controls", "runtime tool control helper affected gates");

const runtimeFailoverAggregateHarness = selectAffectedGates(registry, [
  "gateway/tests/check-gateway-node/runtime-smoke/failover-and-tools.mjs",
]).names;
assertIncludes(runtimeFailoverAggregateHarness, "check:gateway:suite:runtime:failover-core", "runtime failover aggregate affected gates");
assertIncludes(runtimeFailoverAggregateHarness, "check:gateway:suite:runtime:provider-routing", "runtime failover aggregate affected gates");
assertIncludes(runtimeFailoverAggregateHarness, "check:gateway:suite:runtime:provider-status", "runtime failover aggregate affected gates");
assertIncludes(runtimeFailoverAggregateHarness, "check:gateway:suite:runtime:namespace-controls", "runtime failover aggregate affected gates");
assertIncludes(runtimeFailoverAggregateHarness, "check:gateway:suite:runtime:start-controls", "runtime failover aggregate affected gates");
assertIncludes(runtimeFailoverAggregateHarness, "check:gateway:suite:runtime:model-controls", "runtime failover aggregate affected gates");
assertIncludes(runtimeFailoverAggregateHarness, "check:gateway:suite:runtime:status-controls", "runtime failover aggregate affected gates");
assertIncludes(runtimeFailoverAggregateHarness, "check:gateway:suite:runtime:experience-state-controls", "runtime failover aggregate affected gates");
assertIncludes(runtimeFailoverAggregateHarness, "check:gateway:suite:runtime:tool-context-controls", "runtime failover aggregate affected gates");
assertIncludes(runtimeFailoverAggregateHarness, "check:gateway:suite:runtime:management-gc-controls", "runtime failover aggregate affected gates");
assertIncludes(runtimeFailoverAggregateHarness, "check:gateway:suite:runtime:tool-loop", "runtime failover aggregate affected gates");
assertIncludes(runtimeFailoverAggregateHarness, "check:gateway:suite:runtime:mcp-call", "runtime failover aggregate affected gates");
assertIncludes(runtimeFailoverAggregateHarness, "check:gateway:suite:runtime:mcp-session", "runtime failover aggregate affected gates");
assertIncludes(runtimeFailoverAggregateHarness, "check:gateway:suite:runtime:mcp-server", "runtime failover aggregate affected gates");
assertIncludes(runtimeFailoverAggregateHarness, "check:gateway:suite:runtime:tool-diagnostics", "runtime failover aggregate affected gates");

const runtimeProviderStatusHarness = selectAffectedGates(registry, [
  "gateway/tests/check-gateway-node/runtime-smoke/provider-status.mjs",
]).names;
assertIncludes(runtimeProviderStatusHarness, "check:gateway:suite:runtime:provider-status", "runtime provider status affected gates");
assertExcludes(runtimeProviderStatusHarness, "check:gateway:suite:runtime:model-controls", "runtime provider status affected gates");

const runtimeToolMcpHarness = selectAffectedGates(registry, [
  "gateway/tests/check-gateway-node/runtime-smoke/tool-mcp.mjs",
]).names;
assertIncludes(runtimeToolMcpHarness, "check:gateway:suite:runtime:tool-loop", "runtime tool/mcp affected gates");
assertIncludes(runtimeToolMcpHarness, "check:gateway:suite:runtime:mcp-session", "runtime tool/mcp affected gates");
assertExcludes(runtimeToolMcpHarness, "check:gateway:suite:runtime:provider-status", "runtime tool/mcp affected gates");

const runtimeMcpContractHarness = selectAffectedGates(registry, [
  "gateway/src/extensions/contracts/runtime-smoke-contract/mcp-cases.mjs",
]).names;
assertIncludes(runtimeMcpContractHarness, "check:gateway:suite:runtime:mcp-call", "runtime MCP contract affected gates");
assertIncludes(runtimeMcpContractHarness, "check:gateway:suite:runtime:mcp-session", "runtime MCP contract affected gates");
assertIncludes(runtimeMcpContractHarness, "check:gateway:suite:runtime:mcp-server", "runtime MCP contract affected gates");
assertExcludes(runtimeMcpContractHarness, "check:gateway:suite:runtime:provider-status", "runtime MCP contract affected gates");

const runtimeControlSurfaceHarness = selectAffectedGates(registry, [
  "gateway/tests/check-gateway-node/runtime-smoke/control-surface.mjs",
]).names;
assertIncludes(runtimeControlSurfaceHarness, "check:gateway:suite:runtime:model-controls", "runtime control surface affected gates");
assertIncludes(runtimeControlSurfaceHarness, "check:gateway:suite:runtime:management-gc-controls", "runtime control surface affected gates");
assertExcludes(runtimeControlSurfaceHarness, "check:gateway:suite:runtime:provider-status", "runtime control surface affected gates");

const gatewayRuntimeSuiteGate = registry.byName.get("check:gateway:suite:runtime:model-controls");
assert.equal(gatewayRuntimeSuiteGate?.parallel, true, "gateway suite gates must be process-isolated and scheduler-parallel");
assertIncludes(gatewayRuntimeSuiteGate?.deps ?? [], "check:runtime:check", "runtime suite gate dependencies");
assert.equal(gatewayRuntimeSuiteGate?.resourceClass, "gateway-smoke", "gateway suite gates must advertise gateway-smoke resources");
assert.equal(gatewayRuntimeSuiteGate?.cachePolicy, "never", "stateful smoke gates must remain uncached until hermetic");
assert.equal(
  registry.byName.get("check:gateway:suite:runtime:context")?.command,
  "node gateway/tests/check-gateway-node.mjs --suite runtime:context --json --workers 4",
  "runtime context suite gate must use internal case workers",
);
assert.equal(
  registry.byName.get("check:gateway:suite:runtime:context")?.resourceCost,
  3,
  "runtime internal worker suite gates must reserve enough gateway-smoke resources to avoid noisy overlap",
);
assert.equal(
  registry.byName.get("check:gateway:suite:runtime:plan")?.command,
  "node gateway/tests/check-gateway-node.mjs --suite runtime:plan --json --workers 4",
  "runtime plan suite gate must use internal case workers",
);
assert.equal(
  registry.byName.get("check:gateway:suite:runtime:plan")?.resourceCost,
  3,
  "runtime plan internal worker suite must reserve enough gateway-smoke resources to avoid noisy overlap",
);
assert.equal(
  registry.byName.get("check:gateway:suite:runtime:model-controls")?.command,
  "node gateway/tests/check-gateway-node.mjs --suite runtime:model-controls --json --workers 4",
  "runtime model controls suite gate must use internal case workers",
);
assert.equal(
  registry.byName.get("check:gateway:suite:runtime:model-controls")?.resourceCost,
  3,
  "runtime model controls internal worker suite must reserve enough gateway-smoke resources to avoid noisy overlap",
);
assert.equal(
  registry.byName.get("check:gateway:suite:runtime:management-gc-controls")?.command,
  "node gateway/tests/check-gateway-node.mjs --suite runtime:management-gc-controls --json --workers 4",
  "runtime management/gc controls suite gate must use internal case workers",
);
assert.equal(
  registry.byName.get("check:gateway:suite:runtime:management-gc-controls")?.resourceCost,
  3,
  "runtime management/gc controls internal worker suite must reserve enough gateway-smoke resources to avoid noisy overlap",
);
assert.equal(
  registry.byName.get("check:gateway:suite:runtime:provider-status")?.command,
  "node gateway/tests/check-gateway-node.mjs --suite runtime:provider-status --json --workers 3",
  "runtime provider status suite gate must use internal case workers",
);
assert.equal(
  registry.byName.get("check:gateway:suite:runtime:provider-status")?.resourceCost,
  3,
  "runtime provider status internal worker suite must reserve enough gateway-smoke resources to avoid noisy overlap",
);
assert.equal(
  registry.byName.get("check:gateway:suite:runtime:start-controls")?.command,
  "node gateway/tests/check-gateway-node.mjs --suite runtime:start-controls --json",
  "runtime start controls suite gate must stay single-process once fail-fast cases are below worker startup cost",
);
assert.equal(
  registry.byName.get("check:gateway:suite:runtime:start-controls")?.resourceCost,
  1,
  "runtime start controls lightweight suite must not reserve internal-worker smoke resources",
);
assert.equal(
  registry.byName.get("check:gateway:suite:runtime:experience-state-controls")?.command,
  "node gateway/tests/check-gateway-node.mjs --suite runtime:experience-state-controls --json --workers 4",
  "runtime experience/state controls suite gate must use profitable internal case workers",
);
assert.equal(
  registry.byName.get("check:gateway:suite:runtime:experience-state-controls")?.resourceCost,
  3,
  "runtime experience/state controls internal worker suite must reserve enough gateway-smoke resources to avoid noisy overlap",
);
assert.equal(
  registry.byName.get("check:gateway:suite:gateway:plan")?.command,
  "node gateway/tests/check-gateway-node.mjs --suite gateway:plan --json --workers 4",
  "gateway plan suite gate must use internal case workers",
);
assert.equal(
  registry.byName.get("check:gateway:suite:gateway:plan")?.resourceCost,
  2,
  "gateway plan internal worker suite must reserve extra gateway-smoke resources without monopolizing the pool",
);
assert.equal(
  registry.byName.get("check:gateway:suite:runtime:status")?.command,
  "node gateway/tests/check-gateway-node.mjs --suite runtime:status --json --workers 3",
  "runtime status suite gate must use internal case workers",
);
assert.equal(
  registry.byName.get("check:gateway:suite:runtime:status")?.resourceCost,
  3,
  "runtime status internal worker suite must reserve enough gateway-smoke resources to avoid noisy overlap",
);
assert.equal(
  registry.byName.get("check:gateway:suite:runtime:controls")?.resourceCost,
  3,
  "runtime controls internal worker suite must reserve enough gateway-smoke resources to avoid noisy overlap",
);
assert.equal(
  registry.byName.get("check:gateway:suite:runtime:tool-context-controls")?.command,
  "node gateway/tests/check-gateway-node.mjs --suite runtime:tool-context-controls --json --workers 3",
  "runtime tool/context controls suite gate must use internal case workers",
);
assert.equal(
  registry.byName.get("check:gateway:suite:gateway:context")?.command,
  "node gateway/tests/check-gateway-node.mjs --suite gateway:context --json --workers 3",
  "gateway context suite gate must use internal case workers",
);
assert.equal(
  registry.byName.get("check:gateway:suite:gateway:tui")?.command,
  "node gateway/tests/check-gateway-node.mjs --suite gateway:tui --json --workers 3",
  "gateway TUI suite gate must use internal case workers",
);
assert.equal(registry.byName.get("check:runtime:check")?.parallel, false, "cargo check must remain exclusive");
assert.equal(registry.byName.get("check:runtime:check")?.resourceClass, "rust", "cargo gates must advertise rust resources");
assert.equal(
  registry.byName.get("check:runtime:check")?.exclusiveGroup,
  "rust",
  "cargo check must only serialize the rust resource class",
);
assert.equal(
  registry.byName.get("check:runtime:test")?.exclusiveGroup,
  "rust",
  "cargo test must only serialize the rust resource class",
);
assert.equal(
  registry.byName.get("check:gateway:suite:gateway:semantic-benchmark")?.parallel,
  false,
  "timing benchmark suite must remain exclusive",
);
assert.equal(
  registry.byName.get("check:gateway:suite:gateway:semantic-benchmark")?.command,
  "node gateway/tests/check-gateway-node.mjs --case gateway:semantic-benchmark:smoke --json",
  "default semantic benchmark gate must run the quick smoke case only",
);
assert.equal(
  registry.byName.get("check:gateway:suite:gateway:semantic-benchmark")?.exclusiveGroup,
  "global",
  "timing benchmark suite must keep global exclusive scheduling",
);
assert.equal(
  registry.byName.get("check:gateway:suite:gateway:semantic-benchmark")?.modes.includes("ci"),
  true,
  "quick semantic benchmark must remain in CI profile",
);
assert.equal(
  registry.byName.get("check:gateway:suite:gateway:semantic-benchmark-full")?.modes.includes("release"),
  true,
  "full semantic benchmark must be reserved for release profile",
);
assert.equal(
  registry.byName.get("check:gateway:suite:gateway:semantic-benchmark-full")?.exclusiveGroup,
  "global",
  "full semantic benchmark must keep global exclusive scheduling",
);
assert.equal(
  gateNamesForMode(registry, "ci").includes("check:gateway:suite:gateway:semantic-benchmark-full"),
  false,
  "CI profile must not run the full semantic benchmark by default",
);
assert.equal(
  gateNamesForMode(registry, "release").includes("check:gateway:suite:gateway:semantic-benchmark-full"),
  true,
  "release profile must include the full semantic benchmark",
);

const affectedRunnerSource = readFileSync("scripts/quality-runner.mjs", "utf8");
assert.equal(
  /if \(mode === "prepush"\) \{[\s\S]*?base: options\.base \?\? null,[\s\S]*?explicitFiles: options\.changedFiles,/m.test(affectedRunnerSource),
  true,
  "prepush must not implicitly diff origin/main; callers must pass --base explicitly",
);
assert.equal(
  affectedRunnerSource.includes("--fail-on-median-ms"),
  true,
  "benchmark CLI must expose a median regression threshold",
);
assert.equal(
  parseBenchmarkMsThreshold("--fail-on-median-ms", "1000"),
  1000,
  "benchmark millisecond thresholds must parse explicit integer budgets",
);
assert.equal(
  parseBenchmarkCacheHitRatioThreshold("--fail-below-cache-hit-ratio", "95%"),
  95,
  "benchmark cache-hit thresholds must parse percentage values",
);
assert.equal(
  parseBenchmarkCacheHitRatioThreshold("--fail-below-cache-hit-ratio", "0.95"),
  95,
  "benchmark cache-hit thresholds must parse ratio values",
);
assert.equal(
  evaluateBenchmarkThresholds({
    cacheHitPercent: 80,
    maxMs: 1500,
    medianMs: 900,
    p90Ms: 1200,
  }, {
    maxMs: 2000,
    medianMs: 800,
    minCacheHitRatio: 90,
    p90Ms: 1300,
  }).map((failure) => failure.metric).join(","),
  "medianMs,cacheHitPercent",
  "benchmark threshold policy must report only violated metrics",
);

const packageChange = selectAffectedGates(registry, ["package.json"]).names;
assertIncludes(packageChange, "check:quality-runner", "package affected gates");
assertIncludes(packageChange, "check:gateway:suite-registry", "package affected gates");
assertExcludes(packageChange, "check:gateway:runtime-tools", "package affected gates");
assertExcludes(packageChange, "core:gate:release", "package affected gates");
assertExcludes(packageChange, "check:gateway:runtime-tools:release-report", "package affected gates");

const unknown = selectAffectedGates(registry, ["unknown/surface.txt"]).names;
assertIncludes(unknown, "check:layer-contract", "unknown affected fallback");
assertIncludes(unknown, "check:runtime:check", "unknown affected fallback");

const tmp = mkdtempSync(join(tmpdir(), "grobot-quality-runner-"));
try {
  mkdirSync(join(tmp, "scripts"), { recursive: true });
  writeFileSync(join(tmp, "package.json"), "{}\n");
  writeFileSync(join(tmp, "tracked.txt"), "base\n");
  writeFileSync(join(tmp, "pass-a.mjs"), "process.exit(0);\n");
  writeFileSync(join(tmp, "pass-b.mjs"), "process.exit(0);\n");
  writeFileSync(join(tmp, "write-output.mjs"), "import { writeFileSync } from 'node:fs';\nwriteFileSync('artifact.txt', 'artifact\\n');\n");
  writeFileSync(join(tmp, "fail.mjs"), "process.exit(3);\n");
  writeFileSync(join(tmp, "slow-a.mjs"), "await new Promise((resolve) => setTimeout(resolve, 250));\nprocess.exit(0);\n");
  writeFileSync(join(tmp, "slow-b.mjs"), "await new Promise((resolve) => setTimeout(resolve, 250));\nprocess.exit(0);\n");
  writeFileSync(join(tmp, "env-inherit.mjs"), "process.exit(process.env.GROBOT_QUALITY_UNDECLARED_ENV === 'leak' ? 0 : 4);\n");
  writeFileSync(join(tmp, "env-strict.mjs"), [
    "if (process.env.GROBOT_QUALITY_UNDECLARED_ENV === 'leak') { console.error('undeclared env leaked'); process.exit(2); }",
    "if (process.env.GROBOT_QUALITY_DECLARED_ENV !== 'allowed') { console.error('declared env missing'); process.exit(3); }",
    "process.exit(0);",
    "",
  ].join("\n"));
  execFileSync("git", ["init"], { cwd: tmp, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "quality-runner@example.invalid"], { cwd: tmp, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Quality Runner"], { cwd: tmp, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: tmp, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: tmp, stdio: "ignore" });
  writeFileSync(join(tmp, "dirty.txt"), "worktree\n");

  const defaultChanged = listChangedFiles(tmp);
  assert.deepEqual(defaultChanged, ["dirty.txt"], "default affected scan must use worktree only");
  const baseChanged = listChangedFiles(tmp, { base: "HEAD" });
  assert.deepEqual(baseChanged, ["dirty.txt"], "base scan must still include worktree changes");

  const passRun = await runQualityGates([
    {
      cacheable: false,
      command: "node pass-a.mjs",
      cost: "cheap",
      deps: [],
      group: "test",
      inputs: ["pass-a.mjs"],
      name: "a",
      parallel: true,
    },
    {
      cacheable: false,
      command: "node pass-b.mjs",
      cost: "cheap",
      deps: ["a"],
      group: "test",
      inputs: ["pass-b.mjs"],
      name: "b",
      parallel: true,
    },
  ], { cache: false, repoRoot: tmp });
  assert.equal(passRun.status, "pass", "dependent pass graph must pass");

  process.env.GROBOT_QUALITY_UNDECLARED_ENV = "leak";
  process.env.GROBOT_QUALITY_DECLARED_ENV = "allowed";
  try {
    const inheritedEnvRun = await runQualityGates([{
      cacheable: false,
      command: "node env-inherit.mjs",
      cost: "cheap",
      deps: [],
      group: "test",
      inputs: ["env-inherit.mjs"],
      name: "env-inherit",
      parallel: true,
    }], { cache: false, repoRoot: tmp });
    assert.equal(inheritedEnvRun.status, "pass", "default gate env must preserve legacy inherited environment behavior");
    const strictEnvGate = {
      cacheable: false,
      command: "node env-strict.mjs",
      cost: "cheap",
      deps: [],
      env: ["GROBOT_QUALITY_DECLARED_ENV"],
      group: "test",
      inputs: ["env-strict.mjs"],
      name: "env-strict",
      parallel: true,
    };
    const strictEnvRun = await runQualityGates([strictEnvGate], { cache: false, repoRoot: tmp, strictEnv: true });
    assert.equal(strictEnvRun.status, "pass", "strict env mode must keep declared env while hiding undeclared env");
    assert.notEqual(
      computeGateCacheKey(tmp, strictEnvGate).cacheKey,
      computeGateCacheKey(tmp, strictEnvGate, null, { strictEnv: true }).cacheKey,
      "strict env mode must use a distinct action hash from inherited env mode",
    );
  } finally {
    delete process.env.GROBOT_QUALITY_UNDECLARED_ENV;
    delete process.env.GROBOT_QUALITY_DECLARED_ENV;
  }

  const plan = planQualityGates([
    {
      cacheable: false,
      command: "node pass-a.mjs",
      cost: "expensive",
      deps: [],
      group: "test",
      inputs: ["pass-a.mjs"],
      name: "a",
      parallel: true,
      resourceClass: "node",
      resourceCost: 1,
    },
    {
      cacheable: false,
      command: "node pass-b.mjs",
      cost: "cheap",
      deps: ["a"],
      group: "test",
      inputs: ["pass-b.mjs"],
      name: "b",
      parallel: true,
      resourceClass: "node",
      resourceCost: 1,
    },
  ], { repoRoot: tmp, strategy: "throughput" });
  assert.equal(plan.gates.length, 2, "plan must include all selected gates");
  assert.equal(plan.gates[0].name, "a", "plan must respect dependency levels");

  const cacheExplanation = explainGateCache(tmp, {
    cacheable: true,
    command: "node pass-a.mjs",
    cost: "cheap",
    deps: [],
    env: [],
    group: "test",
    inputs: ["pass-a.mjs"],
    name: "cache-test",
    parallel: true,
    resourceClass: "node",
    resourceCost: 1,
  });
  assert.equal(cacheExplanation.status, "miss", "uncached gate explanation must report miss");
  assert.equal(cacheExplanation.cacheable, true, "cache explanation must expose cacheability");
  assert.equal(cacheExplanation.outputRestorePolicy, "no-output", "gates without declared outputs must not pretend to restore artifacts");
  assert.equal(cacheExplanation.outputCount, 0, "gates without declared outputs must expose zero output count");
  assert.equal(cacheExplanation.actionContract.name, "cache-test", "cache explanation must expose the normalized action contract");
  assert.equal(
    cacheExplanation.actionContractFingerprint,
    computeActionContractFingerprint(cacheExplanation.actionContract),
    "cache explanation must expose the action contract fingerprint used by the action hash",
  );
  const cacheBackend = createQualityCacheBackend(tmp);
  const digestManifestPath = cacheBackend.manifestPath("file-digests.json");
  assert.equal(
    existsSync(digestManifestPath),
    true,
    "cache explanation must persist a file digest manifest",
  );
  const manifest = JSON.parse(readFileSync(digestManifestPath, "utf8"));
  assert.equal(typeof manifest["pass-a.mjs"]?.digest, "string", "digest manifest must track hashed input files");

  const reusedContext = createQualityCacheContext(tmp);
  const firstReuse = explainGateCache(tmp, {
    cacheable: true,
    command: "node pass-a.mjs",
    cost: "cheap",
    deps: [],
    env: [],
    group: "test",
    inputs: ["pass-a.mjs"],
    name: "cache-test",
    parallel: true,
    resourceClass: "node",
    resourceCost: 1,
  }, reusedContext);
  const secondReuse = explainGateCache(tmp, {
    cacheable: true,
    command: "node pass-a.mjs",
    cost: "cheap",
    deps: [],
    env: [],
    group: "test",
    inputs: ["pass-a.mjs"],
    name: "cache-test",
    parallel: true,
    resourceClass: "node",
    resourceCost: 1,
  }, reusedContext);
  assert.equal(firstReuse.cacheKey, secondReuse.cacheKey, "digest manifest reuse must preserve cache key stability");

  process.env.GROBOT_QUALITY_CONTRACT_TEST = "alpha";
  const envKeyAlpha = explainGateCache(tmp, {
    cacheable: true,
    command: "node pass-a.mjs",
    cost: "cheap",
    deps: [],
    env: ["GROBOT_QUALITY_CONTRACT_TEST"],
    group: "test",
    inputs: ["pass-a.mjs"],
    name: "cache-env-test",
    parallel: true,
    resourceClass: "node",
    resourceCost: 1,
  }).cacheKey;
  process.env.GROBOT_QUALITY_CONTRACT_TEST = "beta";
  const envKeyBeta = explainGateCache(tmp, {
    cacheable: true,
    command: "node pass-a.mjs",
    cost: "cheap",
    deps: [],
    env: ["GROBOT_QUALITY_CONTRACT_TEST"],
    group: "test",
    inputs: ["pass-a.mjs"],
    name: "cache-env-test",
    parallel: true,
    resourceClass: "node",
    resourceCost: 1,
  }).cacheKey;
  delete process.env.GROBOT_QUALITY_CONTRACT_TEST;
  assert.notEqual(envKeyAlpha, envKeyBeta, "declared env values must participate in action hashes");

  const unrelatedEnvKeyBefore = explainGateCache(tmp, {
    cacheable: true,
    command: "node pass-a.mjs",
    cost: "cheap",
    deps: [],
    env: [],
    group: "test",
    inputs: ["pass-a.mjs"],
    name: "cache-unrelated-env-test",
    parallel: true,
    resourceClass: "node",
    resourceCost: 1,
  }).cacheKey;
  process.env.GROBOT_QUALITY_UNDECLARED_ENV = "changed";
  const unrelatedEnvKeyAfter = explainGateCache(tmp, {
    cacheable: true,
    command: "node pass-a.mjs",
    cost: "cheap",
    deps: [],
    env: [],
    group: "test",
    inputs: ["pass-a.mjs"],
    name: "cache-unrelated-env-test",
    parallel: true,
    resourceClass: "node",
    resourceCost: 1,
  }).cacheKey;
  delete process.env.GROBOT_QUALITY_UNDECLARED_ENV;
  assert.equal(unrelatedEnvKeyBefore, unrelatedEnvKeyAfter, "undeclared env values must not invalidate action hashes");

  const commandKeyA = explainGateCache(tmp, {
    cacheable: true,
    command: "node pass-a.mjs",
    cost: "cheap",
    deps: [],
    env: [],
    group: "test",
    inputs: ["pass-a.mjs"],
    name: "cache-command-test",
    parallel: true,
    resourceClass: "node",
    resourceCost: 1,
  }).cacheKey;
  const commandKeyB = explainGateCache(tmp, {
    cacheable: true,
    command: "node pass-b.mjs",
    cost: "cheap",
    deps: [],
    env: [],
    group: "test",
    inputs: ["pass-a.mjs"],
    name: "cache-command-test",
    parallel: true,
    resourceClass: "node",
    resourceCost: 1,
  }).cacheKey;
  assert.notEqual(commandKeyA, commandKeyB, "command changes must invalidate action hashes");

  const inputKeyBefore = explainGateCache(tmp, {
    cacheable: true,
    command: "node pass-a.mjs",
    cost: "cheap",
    deps: [],
    env: [],
    group: "test",
    inputs: ["tracked.txt"],
    name: "cache-input-test",
    parallel: true,
    resourceClass: "node",
    resourceCost: 1,
  }).cacheKey;
  writeFileSync(join(tmp, "tracked.txt"), "changed\n");
  const inputKeyAfter = explainGateCache(tmp, {
    cacheable: true,
    command: "node pass-a.mjs",
    cost: "cheap",
    deps: [],
    env: [],
    group: "test",
    inputs: ["tracked.txt"],
    name: "cache-input-test",
    parallel: true,
    resourceClass: "node",
    resourceCost: 1,
  }).cacheKey;
  assert.notEqual(inputKeyBefore, inputKeyAfter, "input digest changes must invalidate action hashes");
  writeFileSync(join(tmp, "tracked.txt"), "base\n");

  const explainableGate = {
    cacheable: true,
    command: "node pass-a.mjs",
    cost: "cheap",
    deps: [],
    env: [],
    group: "test",
    inputs: ["tracked.txt"],
    name: "cache-explainable-test",
    parallel: true,
    resourceClass: "node",
    resourceCost: 1,
  };
  const explainableBaseline = explainGateCache(tmp, explainableGate);
  writeGateCache(tmp, explainableGate, explainableBaseline.cacheKey, {
    durationMs: 1,
    status: "pass",
    stderr: "",
    stdout: "",
  });
  writeFileSync(join(tmp, "tracked.txt"), "changed-again\n");
  const explainableMiss = explainGateCache(tmp, explainableGate);
  assert.equal(
    explainableMiss.latestEntry.actionComponents.files,
    explainableBaseline.actionComponents.files,
    "action cache entries must preserve component digests for explainable misses",
  );
  assert.equal(
    explainableMiss.missReason.includes("files changed"),
    true,
    "cache miss reason must identify input-file drift when action components are available",
  );
  assert.deepEqual(
    explainableMiss.actionDiff.files,
    ["tracked.txt"],
    "cache miss explanation must identify the changed input files when portable action metadata is available",
  );

  const outputGate = {
    cacheable: true,
    command: "node write-output.mjs",
    cost: "cheap",
    deps: [],
    env: [],
    group: "test",
    inputs: ["write-output.mjs"],
    name: "cache-output-test",
    outputs: ["artifact.txt"],
    parallel: true,
    resourceClass: "node",
    resourceCost: 1,
  };
  const outputRun = await runQualityGates([outputGate], { cache: true, repoRoot: tmp });
  assert.equal(outputRun.status, "pass", "output-producing gate must pass");
  const outputExplanation = explainGateCache(tmp, outputGate);
  assert.equal(outputExplanation.status, "hit", "output-producing gate should be cache-readable after a pass");
  assert.equal(
    readdirSync(dirname(outputExplanation.actionCachePath)).some((entry) => entry.endsWith(".tmp")),
    false,
    "action cache writes must not leave temporary files behind",
  );
  assert.equal(
    outputExplanation.cacheBackend.kind,
    createQualityCacheBackend(tmp).describe().kind,
    "cache explanations must expose the active cache backend kind",
  );
  await withQualityCacheEnv({
    GROBOT_QUALITY_CACHE_BACKEND: "filesystem",
    GROBOT_QUALITY_CACHE_ROOT: resolve(tmp, "shared-quality-cache"),
  }, () => {
    const filesystemBackend = createQualityCacheBackend(tmp);
    assert.equal(filesystemBackend.describe().kind, "filesystem", "filesystem cache backend must be selectable by env");
    assert.equal(filesystemBackend.describe().root, resolve(tmp, "shared-quality-cache"), "filesystem cache backend must use configured absolute root");
  });
  await withQualityCacheEnv({
    GROBOT_QUALITY_CACHE_BACKEND: "filesystem",
    GROBOT_QUALITY_CACHE_ROOT: resolve(tmp, "shared-quality-cache-run"),
  }, async () => {
    const filesystemGate = {
      ...outputGate,
      name: "cache-filesystem-output-test",
    };
    const filesystemRun = await runQualityGates([filesystemGate], { cache: true, repoRoot: tmp });
    assert.equal(filesystemRun.status, "pass", "filesystem cache backend gate run must pass");
    const filesystemExplanation = explainGateCache(tmp, filesystemGate);
    assert.equal(filesystemExplanation.status, "hit", "filesystem cache backend must read back written action entries");
    assert.equal(filesystemExplanation.cacheBackend.kind, "filesystem", "filesystem cache explain must expose backend kind");
    assert.equal(
      filesystemExplanation.actionCachePath.startsWith(resolve(tmp, "shared-quality-cache-run")),
      true,
      "filesystem cache action entries must be stored under the configured root",
    );
  });
  const atomicWriterPath = join(tmp, "atomic-cache-writer.mjs");
  writeFileSync(atomicWriterPath, `
import { createQualityCacheBackend } from ${JSON.stringify(pathToFileURL(resolve(process.cwd(), "scripts/lib/quality-cache-backend.mjs")).href)};

const backend = createQualityCacheBackend(process.argv[2]);
const writer = process.argv[3];
const targetPath = backend.actionCachePath("atomic-concurrent-test", "shared");
for (let iteration = 0; iteration < 1; iteration += 1) {
  backend.writeJson(targetPath, {
    schema: 1,
    writer,
    iteration,
    payload: "x".repeat(2048),
  });
}
`, "utf8");
  await withQualityCacheEnv({
    GROBOT_QUALITY_CACHE_BACKEND: "filesystem",
    GROBOT_QUALITY_CACHE_ROOT: resolve(tmp, "shared-quality-cache-atomic"),
  }, async () => {
    await Promise.all([0, 1].map((worker) => spawnNode([atomicWriterPath, tmp, `worker-${worker}`], {
      cwd: tmp,
      env: {
        ...process.env,
        GROBOT_QUALITY_CACHE_BACKEND: "filesystem",
        GROBOT_QUALITY_CACHE_ROOT: resolve(tmp, "shared-quality-cache-atomic"),
      },
    })));
    const atomicBackend = createQualityCacheBackend(tmp);
    const atomicActionPath = atomicBackend.actionCachePath("atomic-concurrent-test", "shared");
    const atomicPayload = atomicBackend.readJson(atomicActionPath);
    assert.equal(typeof atomicPayload?.writer, "string", "concurrent filesystem action cache writes must leave valid JSON");
    assert.equal(
      readdirSync(dirname(atomicActionPath)).some((entry) => entry.endsWith(".tmp")),
      false,
      "concurrent filesystem action cache writes must clean up temporary files",
    );
  });
  await withQualityCacheEnv({
    GROBOT_QUALITY_CACHE_BACKEND: "filesystem",
    GROBOT_QUALITY_CACHE_ROOT: "relative-cache",
  }, () => {
    assert.throws(
      () => createQualityCacheBackend(tmp),
      /GROBOT_QUALITY_CACHE_ROOT must be an absolute path/,
      "filesystem cache backend must reject relative roots",
    );
  });
  await withQualityCacheEnv({
    GROBOT_QUALITY_CACHE_BACKEND: "remote",
    GROBOT_QUALITY_CACHE_ROOT: resolve(tmp, "shared-quality-cache"),
  }, () => {
    assert.throws(
      () => createQualityCacheBackend(tmp),
      /unsupported quality cache backend/,
      "unknown cache backend kind must fail closed",
    );
  });
  assert.equal(outputExplanation.portableAction.actionHash, outputExplanation.cacheKey, "portable action metadata must include the action hash");
  assert.equal(outputExplanation.portableAction.backend.kind, outputExplanation.cacheBackend.kind, "portable action metadata must include backend kind");
  assert.equal(outputExplanation.portableAction.contractFingerprint, outputExplanation.actionContractFingerprint, "portable action metadata must include contract fingerprint");
  assert.equal(outputExplanation.portableAction.execution.envMode, "inherit", "portable action metadata must include execution env mode");
  assert.equal(outputExplanation.portableAction.files[0]?.path, "write-output.mjs", "portable action metadata must include input file digests");
  assert.equal(typeof outputExplanation.portableAction.toolchains.node, "string", "portable action metadata must include toolchain versions");
  assert.equal(outputExplanation.outputCount, 1, "declared outputs must be counted in cache explanation");
  assert.equal(outputExplanation.outputRestorePolicy, "declared-outputs", "declared outputs must expose restore policy");
  assert.equal(outputExplanation.outputs.outputs[0]?.path, "artifact.txt", "output manifest must include declared output path");
  assert.equal(outputExplanation.outputs.outputs[0]?.digest.startsWith("sha256:"), true, "output manifest must store output file digest");
  unlinkSync(join(tmp, "artifact.txt"));
  const outputExplainAfterDelete = explainGateCache(tmp, outputGate);
  assert.equal(outputExplainAfterDelete.status, "hit", "explain cache must report restorable output cache hits without restoring them");
  assert.equal(existsSync(join(tmp, "artifact.txt")), false, "explain cache must not mutate the worktree by restoring outputs");
  const outputRestoreRun = await runQualityGates([outputGate], { cache: true, repoRoot: tmp });
  assert.equal(outputRestoreRun.status, "pass", "output cache hit must pass after declared output restore");
  assert.equal(outputRestoreRun.results[0]?.cacheHit, true, "second output gate run must hit cache");
  assert.equal(existsSync(join(tmp, "artifact.txt")), true, "declared output must be restored from cache on hit");
  assert.equal(readFileSync(join(tmp, "artifact.txt"), "utf8"), "artifact\n", "restored output content must match cached artifact");
  assert.equal(outputRestoreRun.results[0]?.outputRestore?.restoredCount, 1, "cache hit result must report restored output count");
  const restoredOutputDigest = outputExplanation.outputs.outputs[0]?.digest.replace(/^sha256:/, "");
  const restoredOutputPath = createQualityCacheBackend(tmp).casStoredPath(restoredOutputDigest);
  assert.equal(
    readdirSync(dirname(restoredOutputPath)).some((entry) => entry.endsWith(".tmp")),
    false,
    "CAS writes must not leave temporary files behind",
  );
  writeFileSync(restoredOutputPath, "partial", "utf8");
  const casSizeMismatchExplanation = explainGateCache(tmp, outputGate);
  assert.equal(casSizeMismatchExplanation.status, "miss", "partial output CAS artifacts must prevent cache reuse");
  assert.equal(
    casSizeMismatchExplanation.missReason.includes("cached output size mismatch in CAS"),
    true,
    "partial output CAS artifacts must be reported as size mismatches",
  );
  rmSync(restoredOutputPath, { force: true });
  unlinkSync(join(tmp, "artifact.txt"));
  const casMissingExplanation = explainGateCache(tmp, outputGate);
  assert.equal(casMissingExplanation.status, "miss", "missing output CAS artifact must prevent cache reuse");
  assert.equal(
    casMissingExplanation.missReason.includes("cached output missing from CAS"),
    true,
    "missing output CAS artifact must be reported as the cache miss reason",
  );

  const outputContractA = explainGateCache(tmp, outputGate).actionContractFingerprint;
  const outputContractB = explainGateCache(tmp, {
    ...outputGate,
    outputs: ["artifact-renamed.txt"],
  }).actionContractFingerprint;
  assert.notEqual(outputContractA, outputContractB, "outputs declaration changes must change the action contract fingerprint");
  const invalidOutputGate = {
    ...outputGate,
    name: "cache-invalid-output-test",
    outputs: ["../outside.txt"],
  };
  const invalidOutputBaseline = explainGateCache(tmp, invalidOutputGate);
  assert.equal(invalidOutputBaseline.status, "miss", "unsafe declared output paths must be rejected before cache lookup");
  assert.equal(
    invalidOutputBaseline.missReason.includes("unsafe declared output path"),
    true,
    "unsafe declared output paths must explain why cache lookup is denied",
  );
  writeGateCache(tmp, invalidOutputGate, invalidOutputBaseline.cacheKey, {
    durationMs: 1,
    status: "pass",
    stderr: "",
    stdout: "",
  }, invalidOutputBaseline);
  const invalidOutputExplanation = explainGateCache(tmp, invalidOutputGate);
  assert.equal(invalidOutputExplanation.status, "miss", "unsafe declared output paths must not be written to cache");
  writeGateCache(tmp, outputGate, outputExplanation.cacheKey, {
    durationMs: 1,
    status: "pass",
    stderr: "",
    stdout: "",
  }, {
    ...outputExplanation,
    actionContract: {
      ...outputExplanation.actionContract,
      outputs: ["../artifact-escape.txt"],
    },
  });
  assert.equal(explainGateCache(tmp, outputGate).status, "miss", "unsafe cacheInfo output paths must not be written to cache");
  writeFileSync(createQualityCacheBackend(tmp).actionCachePath(outputGate.name, outputExplanation.cacheKey), `${JSON.stringify({
    schema: 2,
    gate: outputGate.name,
    cacheKey: outputExplanation.cacheKey,
    actionHash: outputExplanation.cacheKey,
    actionComponents: outputExplanation.actionComponents,
    actionContractFingerprint: outputExplanation.actionContractFingerprint,
    status: "pass",
    durationMs: 1,
    outputs: {
      count: 1,
      outputs: [{
        digest: outputExplanation.outputs.outputs[0]?.digest,
        path: "../artifact-escape.txt",
        sizeBytes: 1,
        type: "file",
      }],
      restorePolicy: "declared-outputs",
    },
    outputCount: 1,
    outputRestorePolicy: "declared-outputs",
    stdoutDigest: "sha256:empty",
    stdoutSizeBytes: 0,
    stderrDigest: "sha256:empty",
    stderrSizeBytes: 0,
    timestamp: new Date().toISOString(),
  }, null, 2)}\n`);
  const unsafeRestoreExplanation = explainGateCache(tmp, outputGate);
  assert.equal(unsafeRestoreExplanation.status, "miss", "unsafe cached output paths must prevent polluted cache reuse");
  assert.equal(
    unsafeRestoreExplanation.missReason.includes("unsafe declared output path"),
    true,
    "unsafe cached output paths must be reported as the cache miss reason",
  );

  const cacheSlotSeedGate = {
    cacheable: true,
    command: "node pass-a.mjs",
    cost: "cheap",
    deps: [],
    group: "test",
    inputs: ["pass-a.mjs"],
    name: "cache-slot-seed",
    parallel: true,
    resourceClass: "node",
    resourceCost: 1,
  };
  const cacheSlotSeed = await runQualityGates([cacheSlotSeedGate], { cache: true, repoRoot: tmp });
  assert.equal(cacheSlotSeed.status, "pass", "cache slot seed gate must pass before scheduling test");
  const cacheSlotRun = await runQualityGates([
    cacheSlotSeedGate,
    {
      cacheable: false,
      command: "node slow-a.mjs",
      cost: "cheap",
      deps: [],
      group: "test",
      inputs: ["slow-a.mjs"],
      name: "cache-slot-slow-a",
      parallel: true,
      resourceClass: "node",
      resourceCost: 1,
    },
    {
      cacheable: false,
      command: "node slow-b.mjs",
      cost: "cheap",
      deps: [],
      group: "test",
      inputs: ["slow-b.mjs"],
      name: "cache-slot-slow-b",
      parallel: true,
      resourceClass: "node",
      resourceCost: 1,
    },
  ], { cache: true, parallel: 2, repoRoot: tmp });
  assert.equal(cacheSlotRun.status, "pass", "mixed cached/slow scheduling test must pass");
  assert.equal(
    cacheSlotRun.durationMs < 800,
    true,
    "scheduler cache hits must not consume parallel/resource slots before slow gates are launched",
  );

  const failRun = await runQualityGates([
    {
      cacheable: false,
      command: "node fail.mjs",
      cost: "cheap",
      deps: [],
      group: "test",
      inputs: ["fail.mjs"],
      name: "fail",
      parallel: true,
    },
    {
      cacheable: false,
      command: "node pass-b.mjs",
      cost: "cheap",
      deps: ["fail"],
      group: "test",
      inputs: ["pass-b.mjs"],
      name: "blocked",
      parallel: true,
    },
  ], { cache: false, repoRoot: tmp });
  assert.equal(failRun.status, "fail", "failed dependency graph must fail");
  assert.equal(failRun.results.some((result) => result.gate.name === "blocked" && result.skipped === true), true, "dependent gate must be marked skipped");

  const scopedExclusiveRun = await runQualityGates([
    {
      cacheable: false,
      command: "node slow-a.mjs",
      cost: "cheap",
      deps: [],
      exclusiveGroup: "rust",
      group: "test",
      inputs: ["slow-a.mjs"],
      name: "scoped-exclusive",
      parallel: false,
      resourceClass: "rust",
      resourceCost: 1,
    },
    {
      cacheable: false,
      command: "node slow-b.mjs",
      cost: "cheap",
      deps: [],
      group: "test",
      inputs: ["slow-b.mjs"],
      name: "parallel-peer",
      parallel: true,
      resourceClass: "node",
      resourceCost: 1,
    },
  ], { cache: false, parallel: 2, repoRoot: tmp });
  assert.equal(scopedExclusiveRun.status, "pass", "scoped exclusive graph must pass");
  assert.equal(
    scopedExclusiveRun.durationMs < 800,
    true,
    "scoped exclusive gates must not block unrelated resource classes",
  );

  const timingGate = {
    cacheable: false,
    command: "node slow-a.mjs",
    cost: "expensive",
    deps: [],
    group: "test",
    inputs: ["slow-a.mjs"],
    name: "timing-sensitive",
    parallel: true,
    resourceClass: "node",
    resourceCost: 1,
  };
  appendQualityEvent(tmp, {
    completedAt: "2026-01-01T00:00:00.000Z",
    durationMs: 10_000,
    gates: [{
      cacheHit: false,
      commandFingerprint: "sha256:stale",
      durationMs: 10_000,
      exitCode: 0,
      name: "timing-sensitive",
      status: "pass",
    }],
    mode: "ci",
    strategy: "throughput",
  });
  appendQualityEvent(tmp, {
    completedAt: "2026-01-01T00:01:00.000Z",
    durationMs: 600,
    gates: [{
      cacheHit: false,
      commandFingerprint: computeGateTimingFingerprint(timingGate),
      durationMs: 600,
      exitCode: 0,
      name: "timing-sensitive",
      status: "pass",
    }],
    mode: "ci",
    strategy: "throughput",
  });
  appendQualityEvent(tmp, {
    completedAt: "2026-01-01T00:02:00.000Z",
    durationMs: 20_000,
    gates: [{
      cacheHit: false,
      commandFingerprint: "sha256:retired",
      durationMs: 20_000,
      exitCode: 0,
      name: "retired-gate",
      status: "pass",
    }],
    mode: "ci",
    strategy: "throughput",
  });
  const timingStats = summarizeQualityEvents(tmp, {
    currentGates: [timingGate],
    limit: 20,
  });
  assert.equal(
    timingStats.recommendations.some((item) => item.gate === "timing-sensitive"),
    false,
    "fast compatible timing estimate must remove stale slow recommendation",
  );
  assert.equal(
    timingStats.recommendations.some((item) => item.gate === "retired-gate"),
    false,
    "retired gates must not appear in active recommendations",
  );
  assert.equal(
    timingStats.slowestCold.some((item) => item.name === "retired-gate"),
    false,
    "retired gates must not appear in active slowest lists",
  );
  const timingSensitiveStats = timingStats.gateStats["timing-sensitive"];
  assert.equal(timingSensitiveStats.staleTimingCount, 1, "timing stats must count stale command fingerprints");
  assert.equal(timingSensitiveStats.compatibleColdCount, 1, "timing stats must preserve compatible cold sample count");
  assert.equal(timingSensitiveStats.estimatedMs, 600, "timing estimate must prefer compatible recent command samples over stale averages");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write("quality runner behavior checks passed.\n");
