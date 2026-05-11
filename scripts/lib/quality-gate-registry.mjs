import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { computeActionContractFingerprint, resolveDeclaredOutputPath, resolveGateActionContract } from "./quality-action-contract.mjs";

export const GATEWAY_SUITE_IDS = Object.freeze([
  "gateway:core",
  "gateway:semantic-benchmark",
  "gateway:semantic-benchmark-full",
  "gateway:session",
  "gateway:plan",
  "gateway:tui",
  "gateway:memory",
  "gateway:context",
  "gateway:ast-handoff",
  "runtime:status",
  "runtime:recovery",
  "runtime:failover-core",
  "runtime:provider-routing",
  "runtime:provider-status",
  "runtime:namespace-controls",
  "runtime:start-controls",
  "runtime:model-controls",
  "runtime:status-controls",
  "runtime:experience-state-controls",
  "runtime:tool-context-controls",
  "runtime:management-gc-controls",
  "runtime:tool-loop",
  "runtime:mcp-call",
  "runtime:mcp-session",
  "runtime:mcp-server",
  "runtime:tool-diagnostics",
  "runtime:plan",
  "runtime:context",
  "runtime:controls",
  "runtime:describe",
  "governance:policy",
  "workflow",
]);

export const QUALITY_RUNNER_COMMANDS = Object.freeze({
  affected: "node scripts/quality-runner.mjs run affected",
  ci: "node scripts/quality-runner.mjs run ci",
  prepush: "node scripts/quality-runner.mjs run prepush",
  quick: "node scripts/quality-runner.mjs run quick",
  release: "node scripts/quality-runner.mjs run release",
  benchmark: "node scripts/quality-runner.mjs benchmark prepush",
  stats: "node scripts/quality-runner.mjs stats",
});

export const QUALITY_ENTRYPOINT_SCRIPTS = Object.freeze({
  check: `${QUALITY_RUNNER_COMMANDS.affected} --compact`,
  "check:affected": QUALITY_RUNNER_COMMANDS.affected,
  "check:ci": QUALITY_RUNNER_COMMANDS.ci,
  "check:prepush": QUALITY_RUNNER_COMMANDS.prepush,
  "check:quick": QUALITY_RUNNER_COMMANDS.quick,
  "check:release": QUALITY_RUNNER_COMMANDS.release,
  "check:quality:plan": "node scripts/quality-runner.mjs plan affected",
  "check:quality:benchmark": QUALITY_RUNNER_COMMANDS.benchmark,
  "check:quality:stats": QUALITY_RUNNER_COMMANDS.stats,
});

const BASE_GATE_DEFINITIONS = Object.freeze([
  {
    name: "audit:python:target",
    command: "node scripts/python-scope-audit.mjs",
    group: "core",
    inputs: ["scripts/python-scope-audit.mjs", "gateway/**", ".github/**", "package.json", "package-lock.json"],
    modes: ["quick", "ci"],
  },
  {
    name: "check:version",
    command: "node scripts/check-version-consistency.mjs",
    group: "core",
    inputs: ["scripts/check-version-consistency.mjs", "package.json", "runtime/Cargo.toml", "gateway/src/cli/product-identity.ts", "gateway/src/cli/start/startup/banner.ts", "README.md"],
    modes: ["quick", "ci"],
  },
  {
    name: "check:tools-all-reference",
    command: "node scripts/check-tools-all-reference.mjs",
    group: "core",
    inputs: ["scripts/check-tools-all-reference.mjs", "scripts/tools-all-reference-lib.mjs", "shared/**", "adapters/**", "package.json", "package-lock.json"],
    modes: ["quick", "ci"],
  },
  {
    name: "check:layer-contract:test",
    command: "node scripts/test-layer-contract-check.mjs",
    group: "architecture",
    inputs: ["scripts/test-layer-contract-check.mjs", "scripts/layer-contract-check.mjs", "scripts/layer-contract-spec.json", "package.json"],
    modes: ["quick", "ci"],
  },
  {
    name: "check:layer-contract",
    command: "node scripts/layer-contract-check.mjs --strict",
    deps: ["check:layer-contract:test"],
    group: "architecture",
    inputs: ["scripts/layer-contract-check.mjs", "scripts/layer-contract-spec.json", "gateway/**", "runtime/**", "README.md", "gateway/README.md", "runtime/README.md", "package.json"],
    modes: ["quick", "ci"],
  },
  {
    name: "check:gateway:runtime-tools:schema",
    command: "node scripts/test-runtime-tool-contracts-json-schema.mjs",
    group: "runtime-tools",
    inputs: ["scripts/test-runtime-tool-contracts-json-schema.mjs", "scripts/check-runtime-tool-contracts.mjs", "shared/contracts/runtime-tool-quality-v1.json", "gateway/src/extensions/contracts/runtime-tool-*.ts", "package.json", "package-lock.json"],
    modes: ["quick", "ci"],
  },
  {
    name: "check:gateway:runtime-tools:quality-report",
    command: "node scripts/test-runtime-tool-quality-report-module.mjs",
    group: "runtime-tools",
    inputs: ["scripts/test-runtime-tool-quality-report-module.mjs", "scripts/lib/runtime-tool-quality-report.mjs", "scripts/lib/runtime-tool-quality-report/**", "shared/contracts/runtime-tool-quality-v1.json", "package.json", "package-lock.json"],
    modes: ["quick", "ci"],
  },
  {
    name: "check:gateway:runtime-tools:quality-parity",
    command: "node scripts/test-runtime-tool-quality-registry-parity.mjs",
    group: "runtime-tools",
    inputs: ["scripts/test-runtime-tool-quality-registry-parity.mjs", "scripts/lib/runtime-tool-quality-report.mjs", "gateway/src/cli/status/runtime-tool-quality-registry.ts", "shared/contracts/runtime-tool-quality-v1.json", "package.json", "package-lock.json"],
    modes: ["quick", "ci"],
  },
  {
    name: "check:gateway:runtime-tools",
    command: "node scripts/check-runtime-tool-contracts.mjs",
    deps: [
      "check:gateway:runtime-tools:schema",
      "check:gateway:runtime-tools:quality-report",
      "check:gateway:runtime-tools:quality-parity",
    ],
    group: "runtime-tools",
    inputs: ["scripts/check-runtime-tool-contracts.mjs", "gateway/src/extensions/contracts/runtime-tool-*.ts", "shared/contracts/runtime-tool-quality-v1.json", "package.json", "package-lock.json"],
    modes: ["ci"],
  },
  {
    name: "check:gateway:runtime-tools:release-report",
    command: "node scripts/test-runtime-tool-release-report.mjs",
    group: "runtime-tools",
    inputs: ["scripts/test-runtime-tool-release-report.mjs", "scripts/lib/runtime-tool-quality-report.mjs", "scripts/lib/runtime-tool-quality-report/**", "scripts/core-release-gate.sh", "package.json", "package-lock.json"],
    modes: ["release"],
  },
  {
    name: "check:gateway:ts",
    command: "tsc --project gateway/tsconfig.json --noEmit",
    group: "gateway",
    inputs: ["gateway/src/**", "gateway/tsconfig.json", "package.json", "package-lock.json"],
    modes: ["quick", "ci"],
    parallel: false,
  },
  {
    name: "check:runtime:check",
    command: "cargo check --manifest-path runtime/Cargo.toml",
    group: "runtime",
    inputs: ["runtime/Cargo.toml", "runtime/Cargo.lock", "runtime/src/**"],
    modes: ["quick", "ci"],
    parallel: false,
  },
  {
    name: "check:runtime:test",
    command: "cargo test --manifest-path runtime/Cargo.toml",
    deps: ["check:runtime:check"],
    group: "runtime",
    inputs: ["runtime/Cargo.toml", "runtime/Cargo.lock", "runtime/src/**"],
    modes: ["ci"],
    cacheable: false,
    parallel: false,
    exclusiveGroup: "rust",
  },
  {
    name: "check:gateway:suite-registry",
    command: "node scripts/checks/quality-runner/gateway-suite-registry.mjs",
    group: "quality",
    inputs: ["scripts/checks/quality-runner/gateway-suite-registry.mjs", "gateway/tests/check-gateway-node.mjs", "gateway/tests/check-gateway-node/**", "scripts/lib/quality-gate-registry.mjs"],
    modes: ["quick", "ci"],
  },
  {
    name: "check:quality-runner:registry",
    command: "node scripts/checks/quality-runner/behavior.mjs --section registry",
    deps: ["check:gateway:suite-registry"],
    group: "quality",
    inputs: ["scripts/quality-runner.mjs", "scripts/lib/quality-*.mjs", "scripts/checks/quality-runner/**", "package.json", "package-lock.json"],
  },
  {
    name: "check:quality-runner:cache",
    command: "node scripts/checks/quality-runner/behavior.mjs --section cache",
    deps: ["check:gateway:suite-registry"],
    group: "quality",
    inputs: ["scripts/quality-runner.mjs", "scripts/lib/quality-*.mjs", "scripts/checks/quality-runner/**", "package.json", "package-lock.json"],
  },
  {
    name: "check:quality-runner:scheduler",
    command: "node scripts/checks/quality-runner/behavior.mjs --section scheduler",
    deps: ["check:gateway:suite-registry"],
    group: "quality",
    inputs: ["scripts/quality-runner.mjs", "scripts/lib/quality-*.mjs", "scripts/checks/quality-runner/**", "package.json", "package-lock.json"],
  },
  {
    name: "check:quality-runner",
    command: "node scripts/checks/quality-runner/behavior.mjs --section aggregate",
    deps: ["check:quality-runner:registry", "check:quality-runner:cache", "check:quality-runner:scheduler"],
    group: "quality",
    inputs: ["scripts/quality-runner.mjs", "scripts/lib/quality-*.mjs", "scripts/checks/quality-runner/**", "package.json", "package-lock.json"],
    modes: ["quick", "ci"],
    cacheable: false,
  },
  {
    name: "harness:ci-label-policy:check",
    command: "tsx gateway/src/governance/evals/ci-label-policy-guard.ts --policy gateway/evals/ci_label_policy.json",
    group: "governance",
    inputs: ["gateway/src/governance/evals/ci-label-policy-guard.ts", "gateway/evals/ci_label_policy.json", "package.json", "package-lock.json"],
    modes: ["ci"],
  },
  {
    name: "core:verify:packages",
    command: "bash ./scripts/core-verify-packages.sh --allow-stub",
    group: "release",
    inputs: ["packages/**", "scripts/core-verify-packages.sh", "package.json", "package-lock.json"],
    modes: ["release"],
    parallel: false,
  },
  {
    name: "core:gate:release",
    command: "bash ./scripts/core-release-gate.sh --allow-stub --report /tmp/core-release-gate-report.dev.json",
    deps: ["core:verify:packages", "check:gateway:runtime-tools:release-report"],
    group: "release",
    inputs: ["scripts/core-release-gate.sh", "scripts/lib/**", "runtime/**", "gateway/src/extensions/contracts/runtime-tool-*.ts", "shared/contracts/runtime-tool-quality-v1.json", "package.json", "package-lock.json"],
    modes: ["release"],
    cacheable: false,
    parallel: false,
  },
]);

const GATEWAY_SUITE_WORKER_COUNTS = Object.freeze({
  "gateway:context": 3,
  "gateway:plan": 4,
  "gateway:tui": 3,
  "runtime:context": 4,
  "runtime:controls": 5,
  "runtime:describe": 4,
  "runtime:experience-state-controls": 4,
  "runtime:management-gc-controls": 4,
  "runtime:model-controls": 4,
  "runtime:plan": 4,
  "runtime:provider-status": 3,
  "runtime:status": 3,
  "runtime:tool-context-controls": 3,
});

function gatewaySuiteGate(id) {
  const group = id.startsWith("runtime:") ? "gateway-runtime-smoke" : id.startsWith("governance:") ? "governance" : "gateway-smoke";
  const isBenchmark = id.includes("benchmark");
  const isFullBenchmark = id.endsWith("-full");
  const workerCount = GATEWAY_SUITE_WORKER_COUNTS[id] ?? 1;
  const isRuntimeSuite = id.startsWith("runtime:");
  const gatewaySmokeCost = workerCount > 1
    ? isRuntimeSuite ? 3 : 2
    : 1;
  const command = id === "gateway:semantic-benchmark"
    ? "node gateway/tests/check-gateway-node.mjs --case gateway:semantic-benchmark:smoke --json"
    : `node gateway/tests/check-gateway-node.mjs --suite ${id} --json${workerCount > 1 ? ` --workers ${String(workerCount)}` : ""}`;
  return {
    name: `check:gateway:suite:${id}`,
    command,
    deps: id.startsWith("runtime:") ? ["check:runtime:check"] : [],
    group,
    inputs: ["gateway/tests/check-gateway-node.mjs", "gateway/tests/check-gateway-node/**", "gateway/src/**", "runtime/src/**", "package.json", "package-lock.json"],
    modes: isFullBenchmark ? ["release"] : ["ci"],
    cacheable: false,
    parallel: !isBenchmark,
    ...(isBenchmark ? { exclusiveGroup: "global" } : {}),
    ...(gatewaySmokeCost > 1 ? { resourceCost: gatewaySmokeCost } : {}),
  };
}

function readPackageJson(repoRoot) {
  return JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
}

function commandTargetFiles(command) {
  return [...String(command ?? "").matchAll(/(?:node|bash|sh)\s+((?:\.\/)?scripts\/[A-Za-z0-9._/-]+\.(?:mjs|js|sh))/g)]
    .map((match) => match[1].replace(/^\.\//, ""));
}

function inferCost(gate) {
  if (gate.cost) {
    return gate.cost;
  }
  if (gate.command.includes("cargo ") || gate.name.includes(":suite:") || gate.group === "release") {
    return "expensive";
  }
  if (gate.command.includes("tsc ") || gate.name.includes("runtime-tools")) {
    return "medium";
  }
  return "cheap";
}

function inferCacheable(gate) {
  if (typeof gate.cacheable === "boolean") {
    return gate.cacheable;
  }
  if (gate.command.includes("cargo test") || gate.command.includes("check-gateway-node.mjs") || gate.group === "release") {
    return false;
  }
  return true;
}

function inferParallel(gate) {
  if (typeof gate.parallel === "boolean") {
    return gate.parallel;
  }
  if (gate.command.includes("cargo ") || gate.command.includes("check-gateway-node.mjs") || gate.group === "release") {
    return false;
  }
  return true;
}

function inferResourceClass(gate) {
  if (gate.resourceClass) {
    return gate.resourceClass;
  }
  if (gate.command.includes("cargo ")) {
    return "rust";
  }
  if (gate.command.includes("check-gateway-node.mjs")) {
    return "gateway-smoke";
  }
  if (gate.command.includes("tsc ")) {
    return "typescript";
  }
  if (gate.group === "release") {
    return "release";
  }
  return "node";
}

function inferResourceCost(gate) {
  if (Number.isFinite(gate.resourceCost) && gate.resourceCost > 0) {
    return gate.resourceCost;
  }
  if (gate.command.includes("cargo ") || gate.command.includes("tsc ")) {
    return 2;
  }
  if (gate.command.includes("check-gateway-node.mjs")) {
    return gate.command.includes("semantic-benchmark") ? 2 : 1;
  }
  return 1;
}

function inferCachePolicy(gate) {
  if (gate.cachePolicy) {
    return gate.cachePolicy;
  }
  return inferCacheable(gate) ? "pass-only" : "never";
}

function inferExclusiveGroup(gate) {
  if (gate.exclusiveGroup) {
    return gate.exclusiveGroup;
  }
  if (gate.parallel === false || inferParallel(gate) === false) {
    return inferResourceClass(gate);
  }
  return "";
}

function makeGate(definition) {
  const base = {
    cacheable: inferCacheable(definition),
    cachePolicy: inferCachePolicy(definition),
    command: definition.command,
    cost: inferCost(definition),
    deps: Object.freeze(definition.deps ?? []),
    env: Object.freeze(definition.env ?? []),
    exclusiveGroup: inferExclusiveGroup(definition),
    group: definition.group,
    inputs: Object.freeze(definition.inputs ?? ["package.json", "package-lock.json"]),
    label: definition.label ?? `[quality] ${definition.name}`,
    modes: Object.freeze(definition.modes ?? []),
    name: definition.name,
    outputs: Object.freeze(definition.outputs ?? []),
    parallel: inferParallel(definition),
    resourceClass: inferResourceClass(definition),
    resourceCost: inferResourceCost(definition),
    timeoutMs: definition.timeoutMs ?? 0,
    toolchains: Object.freeze(definition.toolchains ?? []),
    workdir: definition.workdir ?? ".",
  };
  const actionContract = resolveGateActionContract(base);
  return Object.freeze({
    ...base,
    actionContract,
    actionContractFingerprint: computeActionContractFingerprint(actionContract),
  });
}

export function buildQualityGateRegistry(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const definitions = [
    ...BASE_GATE_DEFINITIONS,
    ...GATEWAY_SUITE_IDS.map(gatewaySuiteGate),
  ];
  const gates = Object.freeze(definitions.map(makeGate));
  const byName = new Map(gates.map((gate) => [gate.name, gate]));
  const ciGateNames = Object.freeze(gates.filter((gate) => gate.modes.includes("ci")).map((gate) => gate.name));

  return Object.freeze({
    byName,
    ciGateNames,
    gates,
    packageJson: options.packageJson ?? readPackageJson(repoRoot),
  });
}

export function gateNamesForMode(registry, mode) {
  if (mode === "affected") {
    return registry.gates.filter((gate) => gate.modes.includes("quick")).map((gate) => gate.name);
  }
  if (mode === "prepush") {
    return registry.gates.filter((gate) => gate.modes.includes("quick")).map((gate) => gate.name);
  }
  if (mode === "ci") {
    return registry.ciGateNames;
  }
  if (mode === "release") {
    return [...registry.ciGateNames, ...registry.gates.filter((gate) => gate.modes.includes("release")).map((gate) => gate.name)];
  }
  return registry.gates.filter((gate) => gate.modes.includes(mode)).map((gate) => gate.name);
}

export function selectGatesByNames(registry, names, options = {}) {
  const { includeDeps = true } = options;
  const gates = [];
  const missing = [];
  const seen = new Set();

  function addGate(name) {
    if (seen.has(name)) {
      return;
    }
    seen.add(name);
    const gate = registry.byName.get(name);
    if (!gate) {
      missing.push(name);
      return;
    }
    if (includeDeps) {
      for (const depName of gate.deps) {
        addGate(depName);
      }
    }
    gates.push(gate);
  }

  for (const name of names) {
    addGate(name);
  }
  return { gates, missing };
}

export function validateQualityGateRegistry(registry, options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const packageJson = options.packageJson ?? registry.packageJson ?? readPackageJson(repoRoot);
  const scripts = packageJson.scripts ?? {};
  const findings = [];
  const seen = new Set();

  for (const gate of registry.gates) {
    if (seen.has(gate.name)) {
      findings.push(`duplicate quality gate: ${gate.name}`);
    }
    seen.add(gate.name);
    if (!gate.command) {
      findings.push(`${gate.name} is missing an executable command`);
    }
    if (!gate.actionContract || gate.actionContract.name !== gate.name) {
      findings.push(`${gate.name} is missing a normalized action contract`);
    }
    if (gate.actionContract?.command !== gate.command) {
      findings.push(`${gate.name} action contract command drifted from gate command`);
    }
    if (!String(gate.actionContractFingerprint ?? "").startsWith("sha256:")) {
      findings.push(`${gate.name} is missing an action contract fingerprint`);
    }
    if (gate.cacheable && gate.actionContract?.cachePolicy === "never") {
      findings.push(`${gate.name} is cacheable but its action contract cachePolicy is never`);
    }
    for (const outputPath of gate.actionContract?.outputs ?? []) {
      const resolved = resolveDeclaredOutputPath(repoRoot, outputPath);
      if (resolved.error) {
        findings.push(`${gate.name} ${resolved.error}`);
      }
    }
    for (const depName of gate.deps) {
      if (!registry.byName.has(depName)) {
        findings.push(`${gate.name} depends on missing gate ${depName}`);
      }
    }
    for (const targetFile of commandTargetFiles(gate.command)) {
      if (!existsSync(path.join(repoRoot, targetFile))) {
        findings.push(`${gate.name} command references missing file: ${targetFile}`);
      }
    }
  }

  for (const [scriptName, expectedCommand] of Object.entries(QUALITY_ENTRYPOINT_SCRIPTS)) {
    if (scripts[scriptName] !== expectedCommand) {
      findings.push(`${scriptName} package script drifted; expected ${JSON.stringify(expectedCommand)}, got ${JSON.stringify(scripts[scriptName])}`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  function visit(gateName) {
    if (visited.has(gateName)) {
      return;
    }
    if (visiting.has(gateName)) {
      const cycleStart = stack.indexOf(gateName);
      findings.push(`quality gate dependency cycle: ${[...stack.slice(Math.max(0, cycleStart)), gateName].join(" -> ")}`);
      return;
    }
    visiting.add(gateName);
    stack.push(gateName);
    for (const depName of registry.byName.get(gateName)?.deps ?? []) {
      visit(depName);
    }
    stack.pop();
    visiting.delete(gateName);
    visited.add(gateName);
  }
  for (const gate of registry.gates) {
    visit(gate.name);
  }
  return findings;
}
