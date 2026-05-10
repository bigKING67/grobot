import { execFileSync } from "node:child_process";

const SAFE_FALLBACK_GATES = Object.freeze([
  "audit:python:target",
  "check:version",
  "check:tools-all-reference",
  "check:layer-contract:test",
  "check:layer-contract",
  "check:gateway:runtime-tools:schema",
  "check:gateway:runtime-tools:quality-report",
  "check:gateway:runtime-tools:quality-parity",
  "check:gateway:ts",
  "check:runtime:check",
  "check:quality-runner",
]);

const RUNTIME_EXTENSION_GATES = Object.freeze([
  "check:runtime:check",
  "check:runtime:test",
  "check:gateway:runtime-tools:schema",
  "check:gateway:runtime-tools:quality-report",
  "check:gateway:runtime-tools:quality-parity",
  "check:gateway:suite:runtime:status",
]);

const GATEWAY_CORE_GATES = Object.freeze([
  "check:gateway:ts",
  "check:gateway:suite:gateway:core",
]);

const GATEWAY_SEMANTIC_BENCHMARK_GATES = Object.freeze([
  "check:gateway:suite:gateway:semantic-benchmark",
]);

const GATEWAY_TUI_GATES = Object.freeze([
  "check:gateway:ts",
  "check:gateway:suite:gateway:tui",
]);

const GATEWAY_PLAN_GATES = Object.freeze([
  "check:gateway:ts",
  "check:gateway:suite:gateway:plan",
  "check:gateway:suite:runtime:plan",
]);

const GATEWAY_CONTEXT_GATES = Object.freeze([
  "check:gateway:ts",
  "check:gateway:suite:gateway:context",
  "check:gateway:suite:runtime:context",
]);

const GATEWAY_MEMORY_GATES = Object.freeze([
  "check:gateway:ts",
  "check:gateway:suite:gateway:memory",
  "check:gateway:suite:gateway:context",
]);

const QUALITY_RUNNER_GATES = Object.freeze([
  "check:quality-runner",
  "check:gateway:suite-registry",
  ...SAFE_FALLBACK_GATES,
]);

const PACKAGE_LOCAL_GATES = Object.freeze([
  ...SAFE_FALLBACK_GATES,
  "check:gateway:suite-registry",
]);

const RUNTIME_FAILOVER_TOOL_SPLIT_GATES = Object.freeze([
  "check:gateway:suite:runtime:failover-core",
  "check:gateway:suite:runtime:provider-routing",
  "check:gateway:suite:runtime:provider-status",
  "check:gateway:suite:runtime:namespace-controls",
  "check:gateway:suite:runtime:start-controls",
  "check:gateway:suite:runtime:model-controls",
  "check:gateway:suite:runtime:status-controls",
  "check:gateway:suite:runtime:experience-state-controls",
  "check:gateway:suite:runtime:tool-context-controls",
  "check:gateway:suite:runtime:management-gc-controls",
  "check:gateway:suite:runtime:tool-loop",
  "check:gateway:suite:runtime:mcp-call",
  "check:gateway:suite:runtime:mcp-session",
  "check:gateway:suite:runtime:mcp-server",
  "check:gateway:suite:runtime:tool-diagnostics",
]);

const RUNTIME_CONTROL_SURFACE_SPLIT_GATES = Object.freeze([
  "check:gateway:suite:runtime:namespace-controls",
  "check:gateway:suite:runtime:start-controls",
  "check:gateway:suite:runtime:model-controls",
  "check:gateway:suite:runtime:status-controls",
  "check:gateway:suite:runtime:experience-state-controls",
  "check:gateway:suite:runtime:tool-context-controls",
  "check:gateway:suite:runtime:management-gc-controls",
]);

const RUNTIME_TOOL_MCP_SPLIT_GATES = Object.freeze([
  "check:gateway:suite:runtime:tool-loop",
  "check:gateway:suite:runtime:mcp-call",
  "check:gateway:suite:runtime:mcp-session",
  "check:gateway:suite:runtime:mcp-server",
  "check:gateway:suite:runtime:tool-diagnostics",
]);

const IGNORED_AFFECTED_FILE_PATTERNS = Object.freeze([
  /^\.cache\//,
  /^target\//,
  /^runtime\/target\//,
  /^gateway\/dist\//,
  /^dist\//,
]);

const SURFACE_GRAPH = Object.freeze([
  {
    id: "quality.runner",
    patterns: [
      /^scripts\/quality-runner\.mjs$/,
      /^scripts\/lib\/quality-/,
      /^scripts\/checks\/quality-runner\//,
    ],
    gates: QUALITY_RUNNER_GATES,
    reason: "quality runtime core change",
  },
  {
    id: "runtime.extensions",
    patterns: [/^runtime\/src\/extensions\//],
    gates: RUNTIME_EXTENSION_GATES,
    impacts: ["runtime.tool-contracts"],
    reason: "runtime extension protocol/handler change",
  },
  {
    id: "runtime.source",
    patterns: [/^runtime\//],
    gates: ["check:runtime:check", "check:runtime:test", "check:gateway:suite:runtime:status"],
    reason: "runtime source/config change",
  },
  {
    id: "gateway.tui",
    patterns: [/^gateway\/src\/cli\/tui\//, /^gateway\/src\/tools\/ask-user\//],
    gates: GATEWAY_TUI_GATES,
    reason: "terminal UI surface change",
  },
  {
    id: "gateway.plan",
    patterns: [/^gateway\/src\/cli\/start\//, /plan/],
    gates: GATEWAY_PLAN_GATES,
    impacts: ["runtime.plan"],
    reason: "start/plan flow change",
  },
  {
    id: "gateway.context",
    patterns: [/context/, /history/],
    gates: GATEWAY_CONTEXT_GATES,
    reason: "context/history flow change",
  },
  {
    id: "gateway.memory",
    patterns: [/memory/, /experience/],
    gates: GATEWAY_MEMORY_GATES,
    impacts: ["gateway.context"],
    reason: "memory/experience flow change",
  },
  {
    id: "runtime.tool-contracts",
    patterns: [/^gateway\/src\/extensions\/contracts\/runtime-tool-/, /^shared\/contracts\/runtime-tool-quality-v1\.json$/],
    gates: [
      "check:gateway:runtime-tools:schema",
      "check:gateway:runtime-tools:quality-report",
      "check:gateway:runtime-tools:quality-parity",
    ],
    reason: "runtime tool contract surface",
  },
  {
    id: "runtime.plan",
    patterns: [/^gateway\/tests\/check-gateway-node\/runtime-smoke\/interactive-plan-flow/, /^gateway\/tests\/check-gateway-node\/runtime-smoke\/plan-events-policy/],
    gates: ["check:gateway:suite:runtime:plan"],
    reason: "runtime plan flow impact",
  },
  {
    id: "gateway.semantic-benchmark",
    patterns: [/^gateway\/src\/extensions\/contracts\/semantic-search-regression-contract\.mjs$/],
    gates: GATEWAY_SEMANTIC_BENCHMARK_GATES,
    reason: "semantic retrieval benchmark contract",
  },
  {
    id: "gateway.source",
    patterns: [/^gateway\/src\//],
    gates: GATEWAY_CORE_GATES,
    reason: "gateway source change",
  },
  {
    id: "docs.spec",
    patterns: [/^\.trellis\/spec\//, /^README\.md$/, /^HANDOFF\.md$/, /^docs\//],
    gates: ["check:version", "check:layer-contract"],
    reason: "docs/spec change with command/architecture drift risk",
  },
]);

function runGit(repoRoot, args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function normalizeStatus(status) {
  return String(status ?? "").trim();
}

function statusPriority(status) {
  const normalized = normalizeStatus(status);
  if (normalized.includes("?") || normalized.includes("A") || normalized.startsWith("R")) {
    return 3;
  }
  if (normalized.includes("D")) {
    return 2;
  }
  return normalized ? 1 : 0;
}

function parseChangedFileEntry(value) {
  if (value && typeof value === "object" && typeof value.file === "string") {
    return { file: value.file, status: normalizeStatus(value.status) };
  }
  const text = String(value ?? "").trim();
  const match = text.match(/^([ MARCDAU?!]{1,2}|\?\?)\s*:\s*(.+)$/);
  if (!match) {
    return { file: text, status: "" };
  }
  return { file: match[2].trim(), status: normalizeStatus(match[1]) };
}

function parseGitNameStatusLine(line) {
  if (!line) {
    return null;
  }
  const [status, ...fileParts] = line.split("\t");
  const file = fileParts.at(-1);
  if (!status || !file) {
    return null;
  }
  return { file, status: normalizeStatus(status) };
}

function parseGitStatusLine(line) {
  if (!line || line.length < 4) {
    return null;
  }
  const trimmedStatusMatch = line.match(/^([MADRCU?!])\s+(.+)$/);
  const rawStatus = trimmedStatusMatch ? trimmedStatusMatch[1] : line.slice(0, 2);
  let file = trimmedStatusMatch ? trimmedStatusMatch[2].trim() : line.slice(3).trim();
  if (file.includes(" -> ")) {
    file = file.split(" -> ").at(-1).trim();
  }
  if (file.startsWith("\"") && file.endsWith("\"")) {
    file = file.slice(1, -1);
  }
  return { file, status: normalizeStatus(rawStatus) };
}

function dedupeEntries(entries) {
  const byFile = new Map();
  for (const entry of entries) {
    if (!entry?.file) {
      continue;
    }
    const previous = byFile.get(entry.file);
    if (!previous || statusPriority(entry.status) > statusPriority(previous.status)) {
      byFile.set(entry.file, { file: entry.file, status: normalizeStatus(entry.status) });
    }
  }
  return [...byFile.values()].sort((left, right) => left.file.localeCompare(right.file));
}

function addNames(target, names, reason) {
  for (const name of names) {
    target.set(name, [...new Set([...(target.get(name) ?? []), reason])]);
  }
}

function isIgnoredAffectedFile(file) {
  return IGNORED_AFFECTED_FILE_PATTERNS.some((pattern) => pattern.test(file));
}

function commandTargetFiles(command) {
  return [...String(command ?? "").matchAll(/(?:node|bash|sh)\s+((?:\.\/)?scripts\/[A-Za-z0-9._/-]+\.(?:mjs|js|sh))/g)]
    .map((match) => match[1].replace(/^\.\//, ""));
}

function gateNamesByCommandTarget(registry, file) {
  return registry.gates
    .filter((gate) => commandTargetFiles(gate.command).includes(file))
    .filter((gate) => !isReleaseOnlyGate(gate))
    .map((gate) => gate.name);
}

function surfaceMatchesFile(surface, file) {
  return surface.patterns.some((pattern) => pattern.test(file));
}

function surfacesById() {
  return new Map(SURFACE_GRAPH.map((surface) => [surface.id, surface]));
}

function impactedSurfacesFor(matches) {
  const byId = surfacesById();
  const impacted = new Map();
  const queue = matches.flatMap((surface) => surface.impacts ?? []);
  for (const id of queue) {
    if (impacted.has(id) || matches.some((surface) => surface.id === id)) {
      continue;
    }
    const surface = byId.get(id);
    if (!surface) {
      continue;
    }
    impacted.set(id, surface);
    queue.push(...(surface.impacts ?? []));
  }
  return [...impacted.values()];
}

function matchingSurfaces(file) {
  const matches = SURFACE_GRAPH.filter((surface) => surfaceMatchesFile(surface, file));
  const hasSpecificGatewaySurface = matches.some((surface) => surface.id.startsWith("gateway.") && surface.id !== "gateway.source");
  const hasSpecificRuntimeSurface = matches.some((surface) => surface.id.startsWith("runtime.") && surface.id !== "runtime.source");
  return matches.filter((surface) => {
    if (surface.id === "gateway.source" && hasSpecificGatewaySurface) {
      return false;
    }
    if (surface.id === "runtime.source" && hasSpecificRuntimeSurface) {
      return false;
    }
    return true;
  });
}

function isReleaseOnlyGate(gate) {
  return gate?.modes?.includes("release") && !gate.modes.some((mode) => mode === "quick" || mode === "ci");
}

function gatewaySmokeHarnessGates(file) {
  const base = ["check:gateway:suite-registry"];
  if (file === "gateway/tests/check-gateway-node.mjs" || file.endsWith("/harness.mjs")) {
    return [...base, "check:gateway:suite:gateway:core", "check:gateway:suite:runtime:status"];
  }
  if (file.includes("/runtime-smoke/status-surface")) {
    return [...base, "check:gateway:suite:runtime:status"];
  }
  if (file.includes("/runtime-smoke/recovery-surface")) {
    return [...base, "check:gateway:suite:runtime:recovery"];
  }
  if (file.includes("/runtime-smoke/failover-and-tools")) {
    return [...base, ...RUNTIME_FAILOVER_TOOL_SPLIT_GATES];
  }
  if (file.includes("/runtime-smoke/failover-core")) {
    return [...base, "check:gateway:suite:runtime:failover-core"];
  }
  if (file.includes("/runtime-smoke/provider-routing")) {
    return [...base, "check:gateway:suite:runtime:provider-routing"];
  }
  if (file.includes("/runtime-smoke/provider-status")) {
    return [...base, "check:gateway:suite:runtime:provider-status"];
  }
  if (file.includes("/runtime-smoke/control-surface")) {
    return [...base, ...RUNTIME_CONTROL_SURFACE_SPLIT_GATES];
  }
  if (file.includes("/runtime-smoke/tool-mcp")) {
    return [...base, ...RUNTIME_TOOL_MCP_SPLIT_GATES];
  }
  if (file.includes("/runtime-smoke/runtime-model-controls")) {
    return [...base, "check:gateway:suite:runtime:model-controls"];
  }
  if (file.includes("/runtime-smoke/runtime-tool-controls")) {
    return [...base, "check:gateway:suite:runtime:tool-context-controls"];
  }
  if (
    file.includes("/runtime-smoke/interactive-plan-flow")
    || file.includes("/runtime-smoke/plan-events-policy")
  ) {
    return [...base, "check:gateway:suite:runtime:plan"];
  }
  if (file.includes("/runtime-smoke/context-quality-flows")) {
    return [...base, "check:gateway:suite:runtime:context"];
  }
  if (
    file.includes("/runtime-smoke/context-engine-controls")
    || file.includes("/runtime-smoke/experience-runtime-controls")
    || file.includes("/runtime-smoke/experience-scheduler-controls")
    || file.includes("/runtime-smoke/mcp-instruction-controls")
    || file.includes("/runtime-smoke/runtime-bin-controls")
    || file.includes("/runtime-smoke/status-line-controls")
    || file.includes("/runtime-smoke/tool-surface-profile-controls")
  ) {
    return [...base, "check:gateway:suite:runtime:controls"];
  }
  if (file.includes("/runtime-smoke/runtime-describe-fallbacks")) {
    return [...base, "check:gateway:suite:runtime:describe"];
  }
  if (file.includes("/gateway-contract-smoke/tui")) {
    return [...base, "check:gateway:suite:gateway:tui"];
  }
  if (file.includes("/gateway-contract-smoke/plan")) {
    return [...base, "check:gateway:suite:gateway:plan"];
  }
  if (file.includes("/gateway-contract-smoke/session")) {
    return [...base, "check:gateway:suite:gateway:session"];
  }
  if (file.includes("/gateway-contract-smoke/memory")) {
    return [...base, "check:gateway:suite:gateway:memory"];
  }
  if (file.includes("/gateway-contract-smoke/context")) {
    return [...base, "check:gateway:suite:gateway:context"];
  }
  if (file.includes("/gateway-contract-smoke/ast-handoff")) {
    return [...base, "check:gateway:suite:gateway:ast-handoff"];
  }
  return [...base, "check:gateway:suite:gateway:core", "check:gateway:suite:runtime:status"];
}

export function listChangedFileEntries(repoRoot, options = {}) {
  const { base = null, explicitFiles } = options;
  if (explicitFiles?.length) {
    return dedupeEntries(explicitFiles.map(parseChangedFileEntry));
  }

  const entries = [];
  if (base) {
    try {
      entries.push(...runGit(repoRoot, ["diff", "--name-status", "--find-renames", `${base}...HEAD`]).split(/\r?\n/).map(parseGitNameStatusLine).filter(Boolean));
    } catch {
      try {
        entries.push(...runGit(repoRoot, ["diff", "--name-status", "--find-renames", base]).split(/\r?\n/).map(parseGitNameStatusLine).filter(Boolean));
      } catch {
        // Continue with worktree diffs.
      }
    }
  }

  for (const args of [
    ["diff", "--name-status", "--find-renames"],
    ["diff", "--name-status", "--find-renames", "--cached"],
    ["status", "--short", "--untracked-files=all"],
  ]) {
    try {
      const parser = args[0] === "status" ? parseGitStatusLine : parseGitNameStatusLine;
      entries.push(...runGit(repoRoot, args).split(/\r?\n/).map(parser).filter(Boolean));
    } catch {
      // Safe fallback handles unknown git state.
    }
  }

  return dedupeEntries(entries);
}

export function listChangedFiles(repoRoot, options = {}) {
  return listChangedFileEntries(repoRoot, options).map((entry) => entry.file);
}

export function changedFilesEnvValue(changedFiles = []) {
  return dedupeEntries(changedFiles.map(parseChangedFileEntry))
    .map(({ file, status }) => (status ? `${status}:${file}` : file))
    .join("\n");
}

export function selectAffectedGates(registry, changedFiles) {
  const selected = new Map();
  const entries = dedupeEntries(changedFiles.map(parseChangedFileEntry));

  if (entries.length === 0) {
    addNames(selected, SAFE_FALLBACK_GATES, "no changed files detected; running safe fallback");
  }

  for (const { file } of entries) {
    if (isIgnoredAffectedFile(file)) {
      continue;
    }

    if (file === "package.json" || file === "package-lock.json" || file.endsWith("lock")) {
      addNames(selected, PACKAGE_LOCAL_GATES, `${file}: package/toolchain change`);
      continue;
    }

    if (file.startsWith("scripts/quality-runner.mjs") || file.startsWith("scripts/lib/quality-") || file.startsWith("scripts/checks/quality-runner/")) {
      addNames(selected, QUALITY_RUNNER_GATES, `${file}: quality runtime core change`);
      continue;
    }

    if (file.startsWith("scripts/")) {
      addNames(selected, [...SAFE_FALLBACK_GATES, ...gateNamesByCommandTarget(registry, file)], `${file}: script/check command change`);
      continue;
    }

    if (file.startsWith(".github/") || file.startsWith(".githooks/")) {
      addNames(selected, ["check:quality-runner", ...SAFE_FALLBACK_GATES], `${file}: CI/hook contract change`);
      continue;
    }

    if (file.startsWith("gateway/tests/check-gateway-node")) {
      addNames(selected, gatewaySmokeHarnessGates(file), `${file}: gateway smoke harness change`);
      continue;
    }

    const surfaces = matchingSurfaces(file);
    if (surfaces.length > 0) {
      const impactedSurfaces = impactedSurfacesFor(surfaces);
      for (const surface of surfaces) {
        addNames(selected, surface.gates, `${file}: surface ${surface.id} -> ${surface.reason}`);
      }
      for (const surface of impactedSurfaces) {
        addNames(selected, surface.gates, `${file}: impacted surface ${surface.id} -> ${surface.reason}`);
      }
      continue;
    }

    addNames(selected, SAFE_FALLBACK_GATES, `${file}: unknown surface; running safe fallback`);
  }

  return {
    names: [...selected.keys()]
      .filter((name) => registry.byName.has(name))
      .filter((name) => !isReleaseOnlyGate(registry.byName.get(name))),
    reasons: Object.fromEntries(selected.entries()),
  };
}

export function explainAffectedSelection(registry, changedFiles) {
  const selection = selectAffectedGates(registry, changedFiles);
  const entries = dedupeEntries(changedFiles.map(parseChangedFileEntry));
  return {
    changedFiles,
    surfaces: entries.map(({ file, status }) => {
      const surfaces = matchingSurfaces(file);
      return {
        file,
        status,
        ignored: isIgnoredAffectedFile(file),
        surfaces: surfaces.map((surface) => surface.id),
        impactedSurfaces: impactedSurfacesFor(surfaces).map((surface) => surface.id),
      };
    }),
    gates: selection.names.map((name) => ({
      name,
      reasons: selection.reasons[name] ?? [],
    })),
  };
}
