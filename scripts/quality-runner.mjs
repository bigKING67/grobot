#!/usr/bin/env node

import { existsSync } from "node:fs";
import process from "node:process";

import {
  appendQualityEvent,
  computeGateTimingFingerprint,
  createQualityCacheContext,
  ensureQualityCacheDirs,
  explainGateCache,
  gcQualityCache,
  summarizeQualityEvents,
} from "./lib/quality-cache.mjs";
import {
  changedFilesEnvValue,
  explainAffectedSelection,
  listChangedFiles,
  selectAffectedGates,
} from "./lib/quality-affected.mjs";
import {
  buildQualityGateRegistry,
  gateNamesForMode,
  selectGatesByNames,
  validateQualityGateRegistry,
} from "./lib/quality-gate-registry.mjs";
import {
  defaultParallelism,
  formatFailure,
  planQualityGates,
  runQualityGates,
  summarizeResults,
} from "./lib/quality-scheduler.mjs";

const KNOWN_RUN_MODES = new Set(["affected", "quick", "prepush", "ci", "release"]);

function printUsage() {
  console.error([
    "Usage:",
    "  node scripts/quality-runner.mjs run <affected|quick|prepush|ci|release> [--list] [--compact] [--json] [--verbose] [--no-cache] [--parallel N] [--base REF] [--changed-files a,b]",
    "  node scripts/quality-runner.mjs list [mode] [--compact] [--json]",
    "  node scripts/quality-runner.mjs plan <affected|quick|prepush|ci|release> [--json] [--strategy auto|interactive|throughput]",
    "  node scripts/quality-runner.mjs explain affected [--summary] [--base REF] [--changed-files a,b]",
    "  node scripts/quality-runner.mjs explain cache <gate> [--json]",
    "  node scripts/quality-runner.mjs stats [--json] [--slow N] [--limit N]",
    "  node scripts/quality-runner.mjs cache gc [--max-age-days N] [--json]",
  ].join("\n"));
}

function parseArgs(argv) {
  const positionals = [];
  const options = {
    cache: true,
    changedFiles: null,
    compact: false,
    json: false,
    list: false,
    limit: 200,
    parallel: defaultParallelism(),
    slowLimit: 10,
    strategy: "auto",
    summary: false,
    verbose: false,
    maxAgeDays: 30,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--list") {
      options.list = true;
    } else if (arg === "--compact") {
      options.compact = true;
    } else if (arg === "--summary") {
      options.summary = true;
    } else if (arg === "--verbose") {
      options.verbose = true;
    } else if (arg === "--no-cache") {
      options.cache = false;
    } else if (arg === "--parallel") {
      options.parallel = Number.parseInt(argv[++index], 10);
      if (!Number.isInteger(options.parallel) || options.parallel <= 0) {
        throw new Error("--parallel must be a positive integer");
      }
    } else if (arg === "--base") {
      options.base = argv[++index];
      if (!options.base) {
        throw new Error("--base requires a value");
      }
    } else if (arg === "--changed-files") {
      options.changedFiles = argv[++index]?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
    } else if (arg === "--strategy") {
      options.strategy = argv[++index];
      if (!["auto", "interactive", "throughput"].includes(options.strategy)) {
        throw new Error("--strategy must be auto, interactive, or throughput");
      }
    } else if (arg === "--slow") {
      options.slowLimit = Number.parseInt(argv[++index], 10);
      if (!Number.isInteger(options.slowLimit) || options.slowLimit <= 0) {
        throw new Error("--slow must be a positive integer");
      }
    } else if (arg === "--limit") {
      options.limit = Number.parseInt(argv[++index], 10);
      if (!Number.isInteger(options.limit) || options.limit <= 0) {
        throw new Error("--limit must be a positive integer");
      }
    } else if (arg === "--max-age-days") {
      options.maxAgeDays = Number.parseInt(argv[++index], 10);
      if (!Number.isInteger(options.maxAgeDays) || options.maxAgeDays <= 0) {
        throw new Error("--max-age-days must be a positive integer");
      }
    } else {
      positionals.push(arg);
    }
  }
  return { options, positionals };
}

function getRepoRoot() {
  let current = process.cwd();
  while (current !== "/") {
    if (existsSync(`${current}/package.json`)) {
      return current;
    }
    current = current.split("/").slice(0, -1).join("/") || "/";
  }
  return process.cwd();
}

function modeGateNames(mode, registry, repoRoot, options) {
  if (mode === "affected") {
    const changedFiles = listChangedFiles(repoRoot, {
      base: options.base ?? null,
      explicitFiles: options.changedFiles,
    });
    const selection = selectAffectedGates(registry, changedFiles);
    return {
      changedFiles,
      names: selection.names,
      reasons: selection.reasons,
    };
  }
  if (mode === "prepush") {
    const changedFiles = listChangedFiles(repoRoot, {
      base: options.base ?? null,
      explicitFiles: options.changedFiles,
    });
    const affected = selectAffectedGates(registry, changedFiles).names;
    const quick = gateNamesForMode(registry, "quick");
    return {
      changedFiles,
      names: [...new Set([...quick, ...affected])],
      reasons: {},
    };
  }
  return {
    changedFiles: [],
    names: gateNamesForMode(registry, mode),
    reasons: {},
  };
}

function strategyForMode(mode, options) {
  if (options.strategy !== "auto") {
    return options.strategy;
  }
  return mode === "affected" || mode === "quick" ? "interactive" : "throughput";
}

function createLogger(options = {}) {
  if (options.json) {
    return { gateDone() {}, gateStart() {} };
  }
  return {
    gateStart(gate) {
      if (!options.compact) {
        console.log(`[run] ${gate.name}`);
      }
    },
    gateDone(result) {
      if (result.cacheHit) {
        console.log(`[cache hit] ${result.gate.name}`);
        return;
      }
      const prefix = result.status === "pass" ? "[pass]" : "[fail]";
      console.log(`${prefix} ${result.gate.name} ${result.durationMs}ms`);
    },
  };
}

function printGateList(mode, gates, context = {}, compact = false) {
  console.log(`[quality] mode=${mode} gates=${gates.length}`);
  if (context.changedFiles?.length) {
    console.log(`[quality] changed=${context.changedFiles.length}`);
  }
  const groups = new Map();
  for (const gate of gates) {
    groups.set(gate.group, [...(groups.get(gate.group) ?? []), gate]);
  }
  for (const [group, groupGates] of groups) {
    if (compact) {
      console.log(`- ${group}: ${groupGates.length}`);
      continue;
    }
    console.log(`\n[group] ${group} ${groupGates.length}`);
    for (const gate of groupGates) {
      const flags = [
        `cost=${gate.cost}`,
        `cache=${gate.cacheable ? "yes" : "no"}`,
        `parallel=${gate.parallel === false ? "no" : "yes"}`,
        gate.deps.length ? `deps=${gate.deps.join(",")}` : null,
      ].filter(Boolean).join(" ");
      console.log(`- ${gate.name} [${flags}] :: ${gate.command}`);
    }
  }
}

async function runMode(mode, options) {
  if (!KNOWN_RUN_MODES.has(mode)) {
    throw new Error(`unknown run mode: ${mode}`);
  }
  const repoRoot = getRepoRoot();
  ensureQualityCacheDirs(repoRoot);
  const registry = buildQualityGateRegistry({ repoRoot });
  const findings = validateQualityGateRegistry(registry, { repoRoot });
  if (findings.length > 0) {
    console.error("[quality] registry validation failed:");
    for (const finding of findings) {
      console.error(`- ${finding}`);
    }
    process.exit(1);
  }

  const context = modeGateNames(mode, registry, repoRoot, options);
  const { gates, missing } = selectGatesByNames(registry, context.names);
  if (missing.length > 0) {
    console.error(`[quality] missing gates: ${missing.join(", ")}`);
    process.exit(1);
  }

  if (options.list) {
    if (options.json) {
      console.log(JSON.stringify({ changedFiles: context.changedFiles, gates, mode }, null, 2));
    } else {
      printGateList(mode, gates, context, options.compact);
    }
    return;
  }

  const run = await runQualityGates(gates, {
    cache: options.cache,
    env: {
      GROBOT_QUALITY_CHANGED_FILES: changedFilesEnvValue(context.changedFiles),
    },
    logger: createLogger(options),
    parallel: options.parallel,
    repoRoot,
    strategy: strategyForMode(mode, options),
    verbose: options.verbose,
  });
  const summary = summarizeResults(run.results);
  const event = {
    completedAt: new Date().toISOString(),
    durationMs: run.durationMs,
    gates: run.results.map((result) => ({
      cacheHit: result.cacheHit,
      durationMs: result.durationMs,
      commandFingerprint: result.commandFingerprint ?? computeGateTimingFingerprint(result.gate),
      exitCode: result.exitCode,
      name: result.gate.name,
      skipped: result.skipped === true,
      status: result.status,
    })),
    mode,
    strategy: strategyForMode(mode, options),
    summary,
  };
  appendQualityEvent(repoRoot, event);

  if (options.json) {
    console.log(JSON.stringify({ ...event, changedFiles: context.changedFiles }, null, 2));
  } else {
    console.log(`[quality] mode=${mode} status=${run.status} duration=${run.durationMs}ms passed=${summary.passed} failed=${summary.failed} cached=${summary.cached}/${summary.total}`);
  }
  if (run.status !== "pass") {
    for (const failure of run.results.filter((result) => result.status !== "pass")) {
      console.error(formatFailure(failure));
    }
    process.exit(1);
  }
}

function listMode(mode, options) {
  const repoRoot = getRepoRoot();
  const registry = buildQualityGateRegistry({ repoRoot });
  const { gates, missing } = selectGatesByNames(registry, gateNamesForMode(registry, mode));
  if (missing.length > 0) {
    throw new Error(`missing gates: ${missing.join(", ")}`);
  }
  if (options.json) {
    console.log(JSON.stringify({ gates, mode }, null, 2));
    return;
  }
  printGateList(mode, gates, {}, options.compact);
}

function planMode(mode, options) {
  if (!KNOWN_RUN_MODES.has(mode)) {
    throw new Error(`unknown plan mode: ${mode}`);
  }
  const repoRoot = getRepoRoot();
  const registry = buildQualityGateRegistry({ repoRoot });
  const context = modeGateNames(mode, registry, repoRoot, options);
  const { gates, missing } = selectGatesByNames(registry, context.names);
  if (missing.length > 0) {
    throw new Error(`missing gates: ${missing.join(", ")}`);
  }
  const plan = {
    mode,
    changedFiles: context.changedFiles,
    ...planQualityGates(gates, {
      parallel: options.parallel,
      repoRoot,
      strategy: strategyForMode(mode, options),
    }),
  };
  if (options.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  console.log(`[quality] plan mode=${mode} strategy=${plan.strategy} gates=${plan.gates.length} parallel=${plan.parallel}`);
  for (const gate of plan.gates) {
    console.log(`- L${gate.level} ${gate.name} est=${gate.estimatedMs}ms cp=${gate.criticalPathMs}ms resource=${gate.resourceClass}:${gate.resourceCost}`);
  }
}

function explainAffected(options) {
  const repoRoot = getRepoRoot();
  const registry = buildQualityGateRegistry({ repoRoot });
  const changedFiles = listChangedFiles(repoRoot, {
    base: options.base ?? null,
    explicitFiles: options.changedFiles,
  });
  const explanation = explainAffectedSelection(registry, changedFiles);
  if (options.json) {
    console.log(JSON.stringify(explanation, null, 2));
    return;
  }
  console.log(`[quality] changed=${changedFiles.length} selected=${explanation.gates.length}`);
  if (!options.summary) {
    if (explanation.surfaces?.length) {
      console.log("[quality] affected surfaces:");
      for (const surface of explanation.surfaces) {
        console.log(`- ${surface.file}: ${surface.ignored ? "ignored" : surface.surfaces.join(",") || "fallback"}`);
      }
    }
    for (const gate of explanation.gates) {
      console.log(`- ${gate.name}`);
      for (const reason of gate.reasons) {
        console.log(`  - ${reason}`);
      }
    }
  }
}

function explainCache(gateName, options) {
  if (!gateName) {
    throw new Error("explain cache requires a gate name");
  }
  const repoRoot = getRepoRoot();
  const registry = buildQualityGateRegistry({ repoRoot });
  const gate = registry.byName.get(gateName);
  if (!gate) {
    throw new Error(`unknown gate: ${gateName}`);
  }
  const explanation = explainGateCache(repoRoot, gate, createQualityCacheContext(repoRoot));
  if (options.json) {
    console.log(JSON.stringify(explanation, null, 2));
    return;
  }
  console.log(`[quality] cache ${gateName}: ${explanation.status}`);
  console.log(`- cacheable: ${explanation.cacheable ? "yes" : "no"}`);
  console.log(`- actionHash: ${explanation.cacheKey}`);
  console.log(`- actionContract: ${explanation.actionContractFingerprint}`);
  console.log(`- backend: ${explanation.cacheBackend.kind}`);
  console.log(`- inputs: ${explanation.inputCount}`);
  console.log(`- outputs: ${explanation.outputCount} (${explanation.outputRestorePolicy})`);
  console.log(`- entries: ${explanation.actionCacheEntries}`);
  if (explanation.missReason) {
    console.log(`- miss: ${explanation.missReason}`);
  }
}

function printStats(options) {
  const repoRoot = getRepoRoot();
  const stats = summarizeQualityEvents(repoRoot, {
    currentGates: buildQualityGateRegistry({ repoRoot }).gates,
    limit: options.limit,
    slowLimit: options.slowLimit,
  });
  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }
  console.log(`[quality] runs=${stats.totalRuns} gates=${stats.totalGateResults} cacheHitRate=${(stats.cacheHitRate * 100).toFixed(1)}%`);
  console.log("[quality] slowest cold gates:");
  for (const gate of stats.slowestCold) {
    console.log(`- ${gate.name}: max=${gate.coldMaxMs}ms avg=${gate.coldAvgMs}ms recent=${gate.recentColdWeightedMs}ms estimate=${gate.estimatedMs}ms p90=${gate.coldP90Ms}ms count=${gate.coldCount}`);
  }
  if (stats.recommendations?.length) {
    console.log("[quality] recommendations:");
    for (const item of stats.recommendations) {
      console.log(`- ${item.gate}: ${item.action} (${item.reason}, estimate=${item.estimatedMs}ms coldAvg=${item.coldAvgMs}ms)`);
    }
  }
}

function cacheCommand(positionals, options) {
  const subcommand = positionals[1] ?? "";
  if (subcommand !== "gc") {
    throw new Error("only `cache gc` is supported");
  }
  const repoRoot = getRepoRoot();
  const result = gcQualityCache(repoRoot, { maxAgeDays: options.maxAgeDays });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`[quality] cache gc deleted=${result.deleted} maxAgeDays=${result.maxAgeDays}`);
}

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2));
  const command = positionals[0];
  if (!command) {
    printUsage();
    process.exit(2);
  }
  if (command === "run") {
    await runMode(positionals[1] ?? "affected", options);
    return;
  }
  if (command === "list") {
    listMode(positionals[1] ?? "quick", options);
    return;
  }
  if (command === "plan") {
    planMode(positionals[1] ?? "affected", options);
    return;
  }
  if (command === "explain") {
    if ((positionals[1] ?? "") === "affected") {
      explainAffected(options);
      return;
    }
    if ((positionals[1] ?? "") === "cache") {
      explainCache(positionals[2], options);
      return;
    }
    throw new Error("only `explain affected` and `explain cache <gate>` are supported");
  }
  if (command === "stats") {
    printStats(options);
    return;
  }
  if (command === "cache") {
    cacheCommand(positionals, options);
    return;
  }
  printUsage();
  process.exit(2);
}

try {
  await main();
} catch (error) {
  console.error(`[quality] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
