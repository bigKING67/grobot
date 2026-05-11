import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  computeGateTimingFingerprint,
  computeGateCacheKey,
  createQualityCacheContext,
  flushQualityCacheContext,
  readGateCache,
  summarizeQualityEvents,
  writeGateCache,
} from "./quality-cache.mjs";

export function defaultParallelism() {
  return Math.max(1, Math.min(os.cpus().length - 1, 6));
}

function createCommandEnv(repoRoot = process.cwd(), overrides = {}) {
  const nodeBinPath = path.join(repoRoot, "node_modules", ".bin");
  const existingPath = process.env.PATH ?? "";
  return {
    ...process.env,
    PATH: existingPath ? `${nodeBinPath}${path.delimiter}${existingPath}` : nodeBinPath,
    ...overrides,
  };
}

function runShellCommand(command, options = {}) {
  const { cwd, env = {}, verbose = false } = options;
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const child = spawn(command, {
      cwd,
      env: createCommandEnv(cwd, env),
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (verbose) {
        process.stdout.write(text);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (verbose) {
        process.stderr.write(text);
      }
    });
    child.on("error", (error) => {
      resolve({
        durationMs: Math.round(performance.now() - startedAt),
        exitCode: 1,
        stderr: `${stderr}${stderr ? "\n" : ""}${error.message}`,
        stdout,
      });
    });
    child.on("exit", (code) => {
      resolve({
        durationMs: Math.round(performance.now() - startedAt),
        exitCode: code ?? 1,
        stderr,
        stdout,
      });
    });
  });
}

function buildExecutionGraph(gates) {
  const selectedByName = new Map(gates.map((gate) => [gate.name, gate]));
  const pendingDeps = new Map();
  const dependents = new Map();
  for (const gate of gates) {
    const deps = (gate.deps ?? []).filter((depName) => selectedByName.has(depName));
    pendingDeps.set(gate.name, new Set(deps));
    for (const depName of deps) {
      const list = dependents.get(depName) ?? [];
      list.push(gate.name);
      dependents.set(depName, list);
    }
  }
  return { dependents, pendingDeps, selectedByName };
}

function sortReadyGates(ready, selectedByName) {
  const costRank = { cheap: 0, medium: 1, expensive: 2 };
  return [...ready].sort((left, right) => {
    const leftGate = selectedByName.get(left);
    const rightGate = selectedByName.get(right);
    return (costRank[leftGate?.cost] ?? 1) - (costRank[rightGate?.cost] ?? 1) || left.localeCompare(right);
  });
}

function reverseGraph(dependents) {
  const depsByName = new Map();
  for (const [depName, dependentNames] of dependents) {
    for (const dependentName of dependentNames) {
      const deps = depsByName.get(dependentName) ?? [];
      deps.push(depName);
      depsByName.set(dependentName, deps);
    }
  }
  return depsByName;
}

function historicalDurationMs(gate, historicalStats = {}) {
  const stats = historicalStats[gate.name];
  if (!stats) {
    const fallback = { cheap: 750, medium: 5_000, expensive: 15_000 };
    return fallback[gate.cost] ?? 2_000;
  }
  return Math.max(1, Number(stats.estimatedMs || stats.recentColdWeightedMs || stats.coldAvgMs || stats.avgMs || stats.p90Ms || 1));
}

function computeCriticalPathScores(gates, dependents, historicalStats = {}) {
  const byName = new Map(gates.map((gate) => [gate.name, gate]));
  const memo = new Map();
  function score(gateName) {
    if (memo.has(gateName)) {
      return memo.get(gateName);
    }
    const gate = byName.get(gateName);
    if (!gate) {
      return 0;
    }
    const downstream = dependents.get(gateName) ?? [];
    const value = historicalDurationMs(gate, historicalStats) + Math.max(0, ...downstream.map(score));
    memo.set(gateName, value);
    return value;
  }
  for (const gate of gates) {
    score(gate.name);
  }
  return memo;
}

function orderReadyGates(ready, selectedByName, options = {}) {
  const {
    criticalPathScores = new Map(),
    historicalStats = {},
    strategy = "interactive",
  } = options;
  if (strategy === "throughput") {
    return [...ready].sort((left, right) => {
      const leftGate = selectedByName.get(left);
      const rightGate = selectedByName.get(right);
      return (criticalPathScores.get(right) ?? 0) - (criticalPathScores.get(left) ?? 0)
        || historicalDurationMs(rightGate, historicalStats) - historicalDurationMs(leftGate, historicalStats)
        || left.localeCompare(right);
    });
  }
  return sortReadyGates(ready, selectedByName);
}

function exclusiveGroup(gate) {
  return String(gate?.exclusiveGroup ?? "").trim();
}

function hasGlobalExclusiveRunning(running, selectedByName) {
  return [...running].some((gateName) => exclusiveGroup(selectedByName.get(gateName)) === "global");
}

function conflictsWithExclusiveGroup(gate, running, selectedByName) {
  const group = exclusiveGroup(gate);
  if (!group) {
    return hasGlobalExclusiveRunning(running, selectedByName);
  }
  if (group === "global") {
    return running.size > 0;
  }
  return hasGlobalExclusiveRunning(running, selectedByName)
    || [...running].some((gateName) => exclusiveGroup(selectedByName.get(gateName)) === group);
}

function defaultResourceLimits(parallel) {
  return {
    "gateway-smoke": Math.max(1, Math.min(parallel, 4)),
    node: Math.max(1, parallel),
    release: 1,
    rust: 2,
    typescript: 2,
  };
}

function resourceUsage(running, selectedByName) {
  const usage = {};
  for (const gateName of running) {
    const gate = selectedByName.get(gateName);
    if (!gate) {
      continue;
    }
    const resourceClass = gate.resourceClass ?? "node";
    usage[resourceClass] = (usage[resourceClass] ?? 0) + (gate.resourceCost ?? 1);
  }
  return usage;
}

function canRunWithResources(gate, running, selectedByName, resourceLimits) {
  const resourceClass = gate.resourceClass ?? "node";
  const limit = resourceLimits[resourceClass] ?? resourceLimits.node ?? Number.POSITIVE_INFINITY;
  const usage = resourceUsage(running, selectedByName);
  return (usage[resourceClass] ?? 0) + (gate.resourceCost ?? 1) <= limit;
}

function blockedByFailedDependency(gateName, context) {
  const { dependents, failed, pendingDeps, selectedByName } = context;
  const queue = [...(dependents.get(gateName) ?? [])];
  const blocked = [];
  const seen = new Set();

  while (queue.length > 0) {
    const currentName = queue.shift();
    if (seen.has(currentName)) {
      continue;
    }
    seen.add(currentName);
    if (failed.has(currentName)) {
      continue;
    }
    const deps = pendingDeps.get(currentName);
    if (!deps || deps.size === 0) {
      continue;
    }
    failed.add(currentName);
    blocked.push({
      cacheHit: false,
      command: selectedByName.get(currentName)?.command ?? "",
      durationMs: 0,
      exitCode: 1,
      gate: selectedByName.get(currentName),
      skipped: true,
      status: "fail",
      stderr: `Skipped because dependency failed: ${[...deps].join(", ")}`,
      stdout: "",
    });
    for (const dependentName of dependents.get(currentName) ?? []) {
      queue.push(dependentName);
    }
  }
  return blocked.filter((item) => item.gate);
}

function outputTail(text, maxLines = 40) {
  const lines = String(text ?? "").trimEnd().split(/\r?\n/).filter(Boolean);
  return lines.length <= maxLines ? lines.join("\n") : lines.slice(-maxLines).join("\n");
}

export async function runQualityGates(gates, options = {}) {
  const {
    cache = true,
    env = {},
    failFast = true,
    logger = null,
    parallel = defaultParallelism(),
    resourceLimits = defaultResourceLimits(parallel),
    repoRoot = process.cwd(),
    strategy = "interactive",
    verbose = false,
  } = options;
  const startedAt = performance.now();
  const { dependents, pendingDeps, selectedByName } = buildExecutionGraph(gates);
  const historicalStats = summarizeQualityEvents(repoRoot, { currentGates: gates, limit: 200, slowLimit: 50 }).gateStats ?? {};
  const criticalPathScores = computeCriticalPathScores(gates, dependents, historicalStats);
  const cacheContext = cache ? createQualityCacheContext(repoRoot) : null;
  const completed = new Set();
  const failed = new Set();
  const running = new Set();
  const results = [];
  let stopped = false;

  async function executeGate(gate) {
    const command = String(gate.command ?? "").trim();
    if (!command) {
      return {
        cacheHit: false,
        command,
        durationMs: 0,
        exitCode: 1,
        gate,
        status: "fail",
        stderr: "empty command",
        stdout: "",
      };
    }

    const cacheInfo = cache && gate.cacheable ? computeGateCacheKey(repoRoot, gate, cacheContext) : null;
    const cached = cacheInfo ? readGateCache(repoRoot, gate, cacheInfo.cacheKey) : null;
    if (cached) {
      const result = {
        cacheHit: true,
        command,
        commandFingerprint: computeGateTimingFingerprint(gate),
        durationMs: 0,
        exitCode: 0,
        gate,
        outputRestore: cached.outputRestore ?? null,
        status: "pass",
        stderr: "",
        stdout: "",
      };
      logger?.gateDone?.(result);
      return result;
    }

    logger?.gateStart?.(gate);
    const commandResult = await runShellCommand(command, { cwd: repoRoot, env, verbose });
    const result = {
      cacheHit: false,
      command,
      commandFingerprint: computeGateTimingFingerprint(gate),
      durationMs: commandResult.durationMs,
      exitCode: commandResult.exitCode,
      gate,
      status: commandResult.exitCode === 0 ? "pass" : "fail",
      stderr: commandResult.stderr,
      stdout: commandResult.stdout,
    };
    if (result.status === "pass" && cacheInfo) {
      writeGateCache(repoRoot, gate, cacheInfo.cacheKey, result, cacheInfo);
    }
    logger?.gateDone?.(result);
    return result;
  }

  return new Promise((resolve) => {
    function finishIfDone() {
      const totalDone = completed.size + failed.size;
      if ((stopped || totalDone === gates.length) && running.size === 0) {
        flushQualityCacheContext(cacheContext);
        resolve({
          durationMs: Math.round(performance.now() - startedAt),
          results,
          status: failed.size > 0 ? "fail" : "pass",
        });
        return true;
      }
      return false;
    }

    function markComplete(gateName, result) {
      running.delete(gateName);
      results.push(result);
      if (result.status === "pass") {
        completed.add(gateName);
        for (const dependentName of dependents.get(gateName) ?? []) {
          pendingDeps.get(dependentName)?.delete(gateName);
        }
      } else {
        failed.add(gateName);
        results.push(...blockedByFailedDependency(gateName, { dependents, failed, pendingDeps, selectedByName }));
        if (failFast) {
          stopped = true;
        }
      }
    }

    function schedule() {
      if (finishIfDone() || stopped) {
        finishIfDone();
        return;
      }

      const ready = [];
      for (const [gateName, deps] of pendingDeps) {
        if (completed.has(gateName) || failed.has(gateName) || running.has(gateName)) {
          continue;
        }
        if (deps.size === 0) {
          ready.push(gateName);
        }
      }

      for (const gateName of orderReadyGates(ready, selectedByName, {
        criticalPathScores,
        historicalStats,
        strategy,
      })) {
        if (running.size >= parallel) {
          break;
        }
        const gate = selectedByName.get(gateName);
        if (!gate) {
          continue;
        }
        if (conflictsWithExclusiveGroup(gate, running, selectedByName)) {
          continue;
        }
        if (!canRunWithResources(gate, running, selectedByName, resourceLimits)) {
          continue;
        }
        running.add(gateName);
        executeGate(gate)
          .then((result) => {
            markComplete(gateName, result);
            schedule();
          })
          .catch((error) => {
            markComplete(gateName, {
              cacheHit: false,
              command: gate.command,
              commandFingerprint: computeGateTimingFingerprint(gate),
              durationMs: 0,
              exitCode: 1,
              gate,
              status: "fail",
              stderr: error instanceof Error ? error.message : String(error),
              stdout: "",
            });
            schedule();
          });
        if (exclusiveGroup(gate) === "global") {
          break;
        }
      }
      finishIfDone();
    }

    schedule();
  });
}

export function planQualityGates(gates, options = {}) {
  const {
    parallel = defaultParallelism(),
    repoRoot = process.cwd(),
    strategy = "interactive",
  } = options;
  const { dependents, pendingDeps, selectedByName } = buildExecutionGraph(gates);
  const depsByName = reverseGraph(dependents);
  const historicalStats = summarizeQualityEvents(repoRoot, { currentGates: gates, limit: 200, slowLimit: 50 }).gateStats ?? {};
  const criticalPathScores = computeCriticalPathScores(gates, dependents, historicalStats);
  const levels = new Map();
  function level(gateName) {
    if (levels.has(gateName)) {
      return levels.get(gateName);
    }
    const deps = depsByName.get(gateName) ?? [];
    const value = deps.length === 0 ? 0 : Math.max(...deps.map(level)) + 1;
    levels.set(gateName, value);
    return value;
  }
  for (const gate of gates) {
    level(gate.name);
  }
  const planned = gates.map((gate) => ({
    name: gate.name,
    command: gate.command,
    actionContractFingerprint: gate.actionContractFingerprint ?? "",
    group: gate.group,
    deps: [...(pendingDeps.get(gate.name) ?? [])],
    level: levels.get(gate.name) ?? 0,
    cost: gate.cost,
    estimatedMs: historicalDurationMs(gate, historicalStats),
    criticalPathMs: Math.round(criticalPathScores.get(gate.name) ?? 0),
    resourceClass: gate.resourceClass ?? "node",
    resourceCost: gate.resourceCost ?? 1,
    exclusiveGroup: gate.exclusiveGroup ?? "",
    cacheable: gate.cacheable === true,
    parallel: gate.parallel !== false,
  })).sort((left, right) => (
    left.level - right.level
  ) || (
    strategy === "throughput"
      ? right.criticalPathMs - left.criticalPathMs
      : left.estimatedMs - right.estimatedMs
  ) || left.name.localeCompare(right.name));
  return {
    parallel,
    strategy,
    resourceLimits: defaultResourceLimits(parallel),
    gates: planned,
  };
}

export function summarizeResults(results) {
  const summary = { cached: 0, failed: 0, passed: 0, total: results.length };
  for (const result of results) {
    if (result.status === "pass") {
      summary.passed += 1;
    } else {
      summary.failed += 1;
    }
    if (result.cacheHit) {
      summary.cached += 1;
    }
  }
  return summary;
}

export function formatFailure(result) {
  return [
    `[fail] ${result.gate.name} ${result.durationMs}ms`,
    `command: ${result.command}`,
    result.stderr ? `stderr:\n${outputTail(result.stderr)}` : "",
    result.stdout ? `stdout:\n${outputTail(result.stdout)}` : "",
  ].filter(Boolean).join("\n");
}
