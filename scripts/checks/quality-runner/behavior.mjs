#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildQualityGateRegistry, QUALITY_ENTRYPOINT_SCRIPTS, validateQualityGateRegistry } from "../../lib/quality-gate-registry.mjs";
import { explainAffectedSelection, listChangedFiles, selectAffectedGates } from "../../lib/quality-affected.mjs";
import { explainGateCache } from "../../lib/quality-cache.mjs";
import { planQualityGates, runQualityGates } from "../../lib/quality-scheduler.mjs";

function packageJson() {
  return JSON.parse(readFileSync("package.json", "utf8"));
}

function assertIncludes(list, expected, label) {
  assert.equal(list.includes(expected), true, `${label} must include ${expected}; got ${list.join(", ")}`);
}

function assertExcludes(list, unexpected, label) {
  assert.equal(list.includes(unexpected), false, `${label} must not include ${unexpected}`);
}

const registry = buildQualityGateRegistry({ packageJson: packageJson(), repoRoot: process.cwd() });
assert.deepEqual(validateQualityGateRegistry(registry, { packageJson: packageJson(), repoRoot: process.cwd() }), []);

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
assert.equal(registry.byName.get("check:runtime:check")?.parallel, false, "cargo check must remain exclusive");
assert.equal(registry.byName.get("check:runtime:check")?.resourceClass, "rust", "cargo gates must advertise rust resources");
assert.equal(
  registry.byName.get("check:gateway:suite:gateway:semantic-benchmark")?.parallel,
  false,
  "timing benchmark suite must remain exclusive",
);

const affectedRunnerSource = readFileSync("scripts/quality-runner.mjs", "utf8");
assert.equal(
  /if \(mode === "prepush"\) \{[\s\S]*?base: options\.base \?\? null,[\s\S]*?explicitFiles: options\.changedFiles,/m.test(affectedRunnerSource),
  true,
  "prepush must not implicitly diff origin/main; callers must pass --base explicitly",
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
  writeFileSync(join(tmp, "fail.mjs"), "process.exit(3);\n");
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
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write("quality runner behavior checks passed.\n");
