import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { computeActionContractFingerprint, resolveGateActionContract, stableJson } from "./quality-action-contract.mjs";

const CACHE_SCHEMA_VERSION = 2;
export const QUALITY_TIMING_MODEL_VERSION = "quality-timing-v2";
const CACHE_ROOT = ".cache/grobot-quality";
const ACTION_CACHE_DIR = "ac";
const CAS_DIR = "cas";
const MANIFEST_DIR = "manifests";
const FILE_DIGEST_MANIFEST = "file-digests.json";
const RESULT_CACHE_DIR = "results";
const EVENTS_FILE = "events.jsonl";
const RECENT_TIMING_WINDOW = 5;
const RECENT_TIMING_ALPHA = 0.9;

function hashString(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function computeGateTimingFingerprint(gate) {
  const actionContract = gate?.actionContract ?? resolveGateActionContract(gate);
  const hash = createHash("sha256");
  hash.update(`timing=${QUALITY_TIMING_MODEL_VERSION}\n`);
  hash.update(`actionContract=${computeActionContractFingerprint(actionContract)}\n`);
  return `sha256:${hash.digest("hex")}`;
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function globPrefix(pattern) {
  const wildcardIndex = pattern.search(/[*?[{]/);
  const rawPrefix = wildcardIndex === -1 ? pattern : pattern.slice(0, wildcardIndex);
  const slashIndex = rawPrefix.lastIndexOf("/");
  return slashIndex === -1 ? "" : rawPrefix.slice(0, slashIndex + 1);
}

function globToRegExp(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

function runVersionCommand(repoRoot, command, args) {
  try {
    return execFileSync(command, args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "<unavailable>";
  }
}

function trackedFiles(repoRoot, context) {
  if (context?.trackedFiles) {
    return context.trackedFiles;
  }
  try {
    const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: repoRoot,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .sort();
    if (context) {
      context.trackedFiles = files;
    }
    return files;
  } catch {
    if (context) {
      context.trackedFiles = [];
    }
    return [];
  }
}

function expandInputPatterns(repoRoot, patterns, context) {
  const cacheKey = patterns.join("\0");
  if (context?.expandedInputs.has(cacheKey)) {
    return context.expandedInputs.get(cacheKey);
  }

  const files = new Set();
  const tracked = trackedFiles(repoRoot, context);
  for (const pattern of patterns ?? []) {
    if (!pattern || pattern.includes("{")) {
      continue;
    }
    if (!/[?*[]/.test(pattern)) {
      if (existsSync(path.join(repoRoot, pattern))) {
        files.add(normalizePath(pattern));
      }
      continue;
    }
    const prefix = globPrefix(pattern);
    const matcher = globToRegExp(pattern);
    for (const file of tracked) {
      if (prefix && !file.startsWith(prefix)) {
        continue;
      }
      if (matcher.test(file)) {
        files.add(normalizePath(file));
      }
    }
  }
  const expanded = [...files].sort();
  context?.expandedInputs.set(cacheKey, expanded);
  return expanded;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function digestManifestPath(repoRoot) {
  return path.join(getQualityCacheRoot(repoRoot), MANIFEST_DIR, FILE_DIGEST_MANIFEST);
}

function loadDigestManifest(repoRoot, context) {
  if (context?.digestManifest) {
    return context.digestManifest;
  }
  const manifest = readJsonFile(digestManifestPath(repoRoot)) ?? {};
  if (context) {
    context.digestManifest = manifest;
  }
  return manifest;
}

function writeDigestManifest(repoRoot, manifest, context) {
  mkdirSync(path.join(getQualityCacheRoot(repoRoot), MANIFEST_DIR), { recursive: true });
  writeFileSync(digestManifestPath(repoRoot), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (context) {
    context.digestManifestDirty = false;
  }
}

function fileDigest(repoRoot, file, context) {
  if (context?.fileDigests.has(file)) {
    return context.fileDigests.get(file);
  }
  let digest = "<missing>";
  const absolutePath = path.join(repoRoot, file);
  try {
    const stat = statSync(absolutePath);
    const manifest = loadDigestManifest(repoRoot, context);
    const cached = manifest[file];
    if (
      cached
      && cached.mtimeMs === stat.mtimeMs
      && cached.size === stat.size
      && typeof cached.digest === "string"
    ) {
      digest = cached.digest;
    } else {
      digest = `sha256:${hashString(readFileSync(absolutePath))}`;
      manifest[file] = {
        digest,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        updatedAt: new Date().toISOString(),
      };
      if (context) {
        context.digestManifestDirty = true;
      } else {
        writeDigestManifest(repoRoot, manifest, null);
      }
    }
  } catch {
    // Missing files are part of the key so deleted inputs invalidate cache.
  }
  context?.fileDigests.set(file, digest);
  return digest;
}

function toolVersion(repoRoot, command, args, context) {
  const cacheKey = `${command}\0${args.join("\0")}`;
  if (context?.toolVersions.has(cacheKey)) {
    return context.toolVersions.get(cacheKey);
  }
  const version = runVersionCommand(repoRoot, command, args);
  context?.toolVersions.set(cacheKey, version);
  return version;
}

function actionContractForGate(gate) {
  return gate?.actionContract ?? resolveGateActionContract(gate);
}

function toolchainVersions(repoRoot, actionContract, context) {
  const versions = {};
  for (const toolchain of actionContract.toolchains ?? []) {
    if (toolchain === "node") {
      versions.node = process.version;
    } else if (toolchain === "npm") {
      versions.npm = toolVersion(repoRoot, "npm", ["--version"], context);
    } else if (toolchain === "rustc") {
      versions.rustc = toolVersion(repoRoot, "rustc", ["--version"], context);
    } else if (toolchain === "cargo") {
      versions.cargo = toolVersion(repoRoot, "cargo", ["--version"], context);
    } else {
      versions[toolchain] = "<declared>";
    }
  }
  return versions;
}

export function createQualityCacheContext(repoRoot) {
  return {
    repoRoot,
    digestManifest: null,
    digestManifestDirty: false,
    expandedInputs: new Map(),
    fileDigests: new Map(),
    toolVersions: new Map(),
    trackedFiles: null,
  };
}

export function flushQualityCacheContext(context) {
  if (!context?.digestManifestDirty || !context.repoRoot || !context.digestManifest) {
    return;
  }
  writeDigestManifest(context.repoRoot, context.digestManifest, context);
}

export function getQualityCacheRoot(repoRoot) {
  return path.join(repoRoot, CACHE_ROOT);
}

export function ensureQualityCacheDirs(repoRoot) {
  const root = getQualityCacheRoot(repoRoot);
  mkdirSync(path.join(root, ACTION_CACHE_DIR), { recursive: true });
  mkdirSync(path.join(root, CAS_DIR), { recursive: true });
  mkdirSync(path.join(root, MANIFEST_DIR), { recursive: true });
  mkdirSync(path.join(root, RESULT_CACHE_DIR), { recursive: true });
  return root;
}

export function computeGateCacheKey(repoRoot, gate, context = null) {
  const actionContract = actionContractForGate(gate);
  const files = expandInputPatterns(repoRoot, actionContract.inputs ?? [], context);
  const fileDigests = files.map((file) => ({
    digest: fileDigest(repoRoot, file, context),
    path: file,
  }));
  const envValues = Object.fromEntries(
    (actionContract.env ?? []).map((envName) => [envName, process.env[envName] ?? ""]),
  );
  const toolchainVersionValues = toolchainVersions(repoRoot, actionContract, context);
  const action = {
    contract: actionContract,
    contractFingerprint: computeActionContractFingerprint(actionContract),
    env: envValues,
    files: fileDigests,
    platform: `${process.platform}-${process.arch}`,
    toolchains: toolchainVersionValues,
  };
  const hash = createHash("sha256");
  hash.update(`schema=${CACHE_SCHEMA_VERSION}\n`);
  hash.update(stableJson(action));
  hash.update("\n");
  flushQualityCacheContext(context);
  return {
    action,
    actionContract,
    actionContractFingerprint: action.contractFingerprint,
    cacheKey: hash.digest("hex"),
    files,
  };
}

function safeGateName(gateName) {
  return gateName.replace(/[^A-Za-z0-9_.-]/g, "_");
}

function legacyCacheFilePath(repoRoot, gateName, cacheKey) {
  return path.join(getQualityCacheRoot(repoRoot), RESULT_CACHE_DIR, safeGateName(gateName), `${cacheKey}.json`);
}

function actionCacheFilePath(repoRoot, gateName, cacheKey) {
  return path.join(getQualityCacheRoot(repoRoot), ACTION_CACHE_DIR, safeGateName(gateName), `${cacheKey}.json`);
}

function casFilePath(repoRoot, digest) {
  return path.join(getQualityCacheRoot(repoRoot), CAS_DIR, digest.slice(0, 2), digest);
}

function writeCasText(repoRoot, value) {
  const text = String(value ?? "");
  const digest = hashString(text);
  const filePath = casFilePath(repoRoot, digest);
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (!existsSync(filePath)) {
    writeFileSync(filePath, text, "utf8");
  }
  return {
    digest,
    sizeBytes: Buffer.byteLength(text),
  };
}

function readMostRecentActionCacheEntry(repoRoot, gateName) {
  const dir = path.join(getQualityCacheRoot(repoRoot), ACTION_CACHE_DIR, safeGateName(gateName));
  if (!existsSync(dir)) {
    return null;
  }
  const entries = readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => {
      const filePath = path.join(dir, entry);
      try {
        return {
          filePath,
          mtimeMs: statSync(filePath).mtimeMs,
          payload: readJsonFile(filePath),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return entries[0] ?? null;
}

function countActionCacheEntries(repoRoot, gateName) {
  const dir = path.join(getQualityCacheRoot(repoRoot), ACTION_CACHE_DIR, safeGateName(gateName));
  if (!existsSync(dir)) {
    return 0;
  }
  return readdirSync(dir).filter((entry) => entry.endsWith(".json")).length;
}

function cacheFilePath(repoRoot, gateName, cacheKey) {
  const safeGateName = gateName.replace(/[^A-Za-z0-9_.-]/g, "_");
  return path.join(getQualityCacheRoot(repoRoot), RESULT_CACHE_DIR, safeGateName, `${cacheKey}.json`);
}

export function readGateCache(repoRoot, gate, cacheKey) {
  if (!gate.cacheable) {
    return null;
  }
  const actionPath = actionCacheFilePath(repoRoot, gate.name, cacheKey);
  if (existsSync(actionPath)) {
    const cached = readJsonFile(actionPath);
    return cached?.status === "pass" ? cached : null;
  }

  const legacyPath = legacyCacheFilePath(repoRoot, gate.name, cacheKey);
  if (existsSync(legacyPath)) {
    const cached = readJsonFile(legacyPath);
    return cached?.status === "pass" ? cached : null;
  }
  return null;
}

export function writeGateCache(repoRoot, gate, cacheKey, result) {
  if (!gate.cacheable || result.status !== "pass") {
    return;
  }
  const stdout = writeCasText(repoRoot, result.stdout ?? "");
  const stderr = writeCasText(repoRoot, result.stderr ?? "");
  const actionPath = actionCacheFilePath(repoRoot, gate.name, cacheKey);
  mkdirSync(path.dirname(actionPath), { recursive: true });
  writeFileSync(
    actionPath,
    `${JSON.stringify({
      schema: CACHE_SCHEMA_VERSION,
      gate: gate.name,
      cacheKey,
      actionHash: cacheKey,
      actionContractFingerprint: gate.actionContractFingerprint ?? computeActionContractFingerprint(actionContractForGate(gate)),
      status: "pass",
      durationMs: result.durationMs,
      stdoutDigest: stdout.digest,
      stdoutSizeBytes: stdout.sizeBytes,
      stderrDigest: stderr.digest,
      stderrSizeBytes: stderr.sizeBytes,
      timestamp: new Date().toISOString(),
    }, null, 2)}\n`,
    "utf8",
  );

  const filePath = legacyCacheFilePath(repoRoot, gate.name, cacheKey);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${JSON.stringify({
      schema: CACHE_SCHEMA_VERSION,
      gate: gate.name,
      cacheKey,
      status: "pass",
      durationMs: result.durationMs,
      timestamp: new Date().toISOString(),
    }, null, 2)}\n`,
    "utf8",
  );
}

export function explainGateCache(repoRoot, gate, context = null) {
  const cacheInfo = computeGateCacheKey(repoRoot, gate, context);
  const actionPath = actionCacheFilePath(repoRoot, gate.name, cacheInfo.cacheKey);
  const legacyPath = legacyCacheFilePath(repoRoot, gate.name, cacheInfo.cacheKey);
  const cached = readGateCache(repoRoot, gate, cacheInfo.cacheKey);
  const latest = readMostRecentActionCacheEntry(repoRoot, gate.name);
  return {
    gate: gate.name,
    cacheable: gate.cacheable === true,
    status: cached ? "hit" : "miss",
    cacheKey: cacheInfo.cacheKey,
    actionContract: cacheInfo.actionContract,
    actionContractFingerprint: cacheInfo.actionContractFingerprint,
    actionCachePath: actionPath,
    legacyCachePath: legacyPath,
    actionCacheEntries: countActionCacheEntries(repoRoot, gate.name),
    inputCount: cacheInfo.files.length,
    sampleInputs: cacheInfo.files.slice(0, 20),
    latestEntry: latest?.payload
      ? {
        cacheKey: latest.payload.cacheKey ?? "",
        actionContractFingerprint: latest.payload.actionContractFingerprint ?? "",
        status: latest.payload.status ?? "",
        timestamp: latest.payload.timestamp ?? "",
        durationMs: latest.payload.durationMs ?? 0,
      }
      : null,
    missReason: cached
      ? ""
      : gate.cacheable === false
        ? "gate is not cacheable"
        : latest?.payload?.cacheKey
          ? "current action hash differs from latest cached action"
          : "no cached pass result for this gate/action hash",
  };
}

export function appendQualityEvent(repoRoot, event) {
  const root = ensureQualityCacheDirs(repoRoot);
  writeFileSync(path.join(root, EVENTS_FILE), `${JSON.stringify(event)}\n`, {
    encoding: "utf8",
    flag: "a",
  });
}

function percentile(values, p) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function weightedRecentDuration(values) {
  if (values.length === 0) {
    return 0;
  }
  let estimate = values[0];
  for (const value of values.slice(1)) {
    estimate = RECENT_TIMING_ALPHA * value + (1 - RECENT_TIMING_ALPHA) * estimate;
  }
  return Math.round(estimate);
}

function currentTimingFingerprints(gates = []) {
  return new Map(
    gates
      .filter((gate) => gate?.name)
      .map((gate) => [gate.name, computeGateTimingFingerprint(gate)]),
  );
}

function recommendationsForSummaries(summaries) {
  const recommendations = [];
  const coldSlow = summaries
    .filter((item) => item.active !== false && item.coldCount > 0)
    .sort((left, right) => right.estimatedMs - left.estimatedMs || right.coldTotalMs - left.coldTotalMs)
    .slice(0, 5);
  for (const gate of coldSlow) {
    if (gate.cacheHitRate === 0 && gate.estimatedMs >= 10_000) {
      const isTimingBenchmark = gate.name.includes("benchmark");
      recommendations.push({
        gate: gate.name,
        reason: "slow cold gate with no cache hits",
        action: isTimingBenchmark
          ? "separate quick smoke from full timing benchmark and keep benchmark globally exclusive"
          : gate.name.includes("suite:")
          ? "split into smaller gateway smoke cases or enable timing-based sharding"
          : "narrow inputs, add hermetic cache policy, or move repeated work into a shared helper",
        coldAvgMs: gate.coldAvgMs,
        estimatedMs: gate.estimatedMs,
      });
    }
  }
  return recommendations;
}

export function summarizeQualityEvents(repoRoot, options = {}) {
  const { limit = 200, slowLimit = 10 } = options;
  const fingerprints = currentTimingFingerprints(options.currentGates ?? options.gates ?? []);
  const hasCurrentGateSet = fingerprints.size > 0;
  const eventPath = path.join(getQualityCacheRoot(repoRoot), EVENTS_FILE);
  if (!existsSync(eventPath)) {
    return {
      cacheHitRate: 0,
      modes: {},
      slowest: [],
      slowestCold: [],
      totalGateResults: 0,
      totalRuns: 0,
    };
  }
  const events = readFileSync(eventPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .map((line) => JSON.parse(line));
  const modes = {};
  const gates = new Map();
  let cacheHits = 0;
  let totalGateResults = 0;

  for (const event of events) {
    modes[event.mode] = (modes[event.mode] ?? 0) + 1;
    for (const result of event.gates ?? []) {
      totalGateResults += 1;
      if (result.cacheHit) {
        cacheHits += 1;
      }
      const current = gates.get(result.name) ?? {
        name: result.name,
        cachedCount: 0,
        coldCount: 0,
        coldMaxMs: 0,
        coldTotalMs: 0,
        count: 0,
        maxMs: 0,
        totalMs: 0,
        failures: 0,
        durations: [],
        coldDurations: [],
        timingRecords: [],
      };
      const durationMs = Number(result.durationMs ?? 0);
      const commandFingerprint = typeof result.commandFingerprint === "string"
        ? result.commandFingerprint
        : "";
      const currentFingerprint = fingerprints.get(result.name) ?? "";
      const timingCompatible =
        currentFingerprint.length > 0
        && commandFingerprint.length > 0
        && commandFingerprint === currentFingerprint;
      const timingStale =
        currentFingerprint.length > 0
        && commandFingerprint.length > 0
        && commandFingerprint !== currentFingerprint;
      current.count += 1;
      current.totalMs += durationMs;
      current.maxMs = Math.max(current.maxMs, durationMs);
      current.durations.push(durationMs);
      current.timingRecords.push({
        cacheHit: result.cacheHit === true,
        compatible: timingCompatible,
        durationMs,
        stale: timingStale,
      });
      if (result.status !== "pass") {
        current.failures += 1;
      }
      if (result.cacheHit) {
        current.cachedCount += 1;
      } else {
        current.coldCount += 1;
        current.coldTotalMs += durationMs;
        current.coldMaxMs = Math.max(current.coldMaxMs, durationMs);
        current.coldDurations.push(durationMs);
      }
      gates.set(result.name, current);
    }
  }

  const summaries = [...gates.values()].map((item) => {
    const recentDurations = item.durations.slice(-RECENT_TIMING_WINDOW);
    const recentColdDurations = item.coldDurations.slice(-RECENT_TIMING_WINDOW);
    const compatibleColdDurations = item.timingRecords
      .filter((record) => !record.cacheHit && record.compatible)
      .map((record) => record.durationMs)
      .slice(-RECENT_TIMING_WINDOW);
    const staleTimingCount = item.timingRecords.filter((record) => record.stale).length;
    const legacyTimingCount = item.timingRecords.filter((record) => {
      const hasCurrent = fingerprints.has(item.name);
      return hasCurrent && !record.compatible && !record.stale;
    }).length;
    const compatibleEstimate = compatibleColdDurations.length > 0
      ? weightedRecentDuration(compatibleColdDurations)
      : 0;
    const recentEstimate = recentColdDurations.length > 0
      ? weightedRecentDuration(recentColdDurations)
      : weightedRecentDuration(recentDurations);
    const coldAverage = item.coldCount === 0 ? 0 : Math.round(item.coldTotalMs / item.coldCount);
    const estimatedMs = Math.max(1, compatibleEstimate || recentEstimate || coldAverage || Math.round(item.totalMs / item.count) || 1);
    return {
      active: !hasCurrentGateSet || fingerprints.has(item.name),
      name: item.name,
      cachedCount: item.cachedCount,
      coldCount: item.coldCount,
      coldMaxMs: item.coldMaxMs,
      coldTotalMs: item.coldTotalMs,
      compatibleColdCount: compatibleColdDurations.length,
      count: item.count,
      estimatedMs,
      failures: item.failures,
      legacyTimingCount,
      maxMs: item.maxMs,
      recentColdAvgMs: recentColdDurations.length === 0
        ? 0
        : Math.round(recentColdDurations.reduce((sum, value) => sum + value, 0) / recentColdDurations.length),
      recentColdCount: recentColdDurations.length,
      recentColdP50Ms: percentile(recentColdDurations, 50),
      recentColdWeightedMs: recentEstimate,
      staleTimingCount,
      timingModelVersion: QUALITY_TIMING_MODEL_VERSION,
      totalMs: item.totalMs,
      avgMs: Math.round(item.totalMs / item.count),
      cacheHitRate: item.count === 0 ? 0 : item.cachedCount / item.count,
      coldAvgMs: coldAverage,
      failureRate: item.count === 0 ? 0 : item.failures / item.count,
      p50Ms: percentile(item.durations, 50),
      p90Ms: percentile(item.durations, 90),
      p95Ms: percentile(item.durations, 95),
      coldP90Ms: percentile(item.coldDurations, 90),
    };
  });
  const byGate = Object.fromEntries(summaries.map((item) => [item.name, item]));
  const activeSummaries = summaries.filter((item) => item.active !== false);

  return {
    cacheHits,
    cacheHitRate: totalGateResults === 0 ? 0 : cacheHits / totalGateResults,
    gateStats: byGate,
    modes,
    recommendations: recommendationsForSummaries(summaries),
    slowest: [...activeSummaries].sort((a, b) => b.maxMs - a.maxMs).slice(0, slowLimit),
    slowestCold: [...activeSummaries].filter((item) => item.coldCount > 0).sort((a, b) => b.coldMaxMs - a.coldMaxMs).slice(0, slowLimit),
    totalGateResults,
    totalRuns: events.length,
  };
}

export function gcQualityCache(repoRoot, options = {}) {
  const { maxAgeDays = 30 } = options;
  const root = getQualityCacheRoot(repoRoot);
  if (!existsSync(root)) {
    return { deleted: 0, root };
  }
  const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let deleted = 0;
  function walk(dir) {
    if (!existsSync(dir)) {
      return;
    }
    for (const entry of readdirSync(dir)) {
      const filePath = path.join(dir, entry);
      let stat = null;
      try {
        stat = statSync(filePath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(filePath);
        try {
          if (readdirSync(filePath).length === 0) {
            rmSync(filePath, { recursive: true, force: true });
          }
        } catch {
          // Best-effort cleanup only.
        }
        continue;
      }
      if (stat.mtimeMs < cutoffMs) {
        rmSync(filePath, { force: true });
        deleted += 1;
      }
    }
  }
  walk(path.join(root, ACTION_CACHE_DIR));
  walk(path.join(root, CAS_DIR));
  walk(path.join(root, MANIFEST_DIR));
  walk(path.join(root, RESULT_CACHE_DIR));
  return { deleted, maxAgeDays, root };
}
