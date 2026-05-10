import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  computeGateCacheKey,
  createQualityCacheContext,
  readGateCache,
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

function hasExclusiveRunning(running, selectedByName) {
  return [...running].some((gateName) => selectedByName.get(gateName)?.parallel === false);
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
    repoRoot = process.cwd(),
    verbose = false,
  } = options;
  const startedAt = performance.now();
  const { dependents, pendingDeps, selectedByName } = buildExecutionGraph(gates);
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
        durationMs: 0,
        exitCode: 0,
        gate,
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
      durationMs: commandResult.durationMs,
      exitCode: commandResult.exitCode,
      gate,
      status: commandResult.exitCode === 0 ? "pass" : "fail",
      stderr: commandResult.stderr,
      stdout: commandResult.stdout,
    };
    if (result.status === "pass" && cacheInfo) {
      writeGateCache(repoRoot, gate, cacheInfo.cacheKey, result);
    }
    logger?.gateDone?.(result);
    return result;
  }

  return new Promise((resolve) => {
    function finishIfDone() {
      const totalDone = completed.size + failed.size;
      if ((stopped || totalDone === gates.length) && running.size === 0) {
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

      for (const gateName of sortReadyGates(ready, selectedByName)) {
        if (running.size >= parallel) {
          break;
        }
        const gate = selectedByName.get(gateName);
        if (!gate) {
          continue;
        }
        if (hasExclusiveRunning(running, selectedByName)) {
          break;
        }
        if (gate.parallel === false && running.size > 0) {
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
              durationMs: 0,
              exitCode: 1,
              gate,
              status: "fail",
              stderr: error instanceof Error ? error.message : String(error),
              stdout: "",
            });
            schedule();
          });
        if (gate.parallel === false) {
          break;
        }
      }
      finishIfDone();
    }

    schedule();
  });
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
