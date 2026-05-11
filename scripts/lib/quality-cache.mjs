import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { computeActionContractFingerprint, resolveDeclaredOutputPath, resolveGateActionContract, stableJson } from "./quality-action-contract.mjs";
import { createQualityCacheBackend } from "./quality-cache-backend.mjs";
export { getQualityCacheRoot } from "./quality-cache-backend.mjs";

const CACHE_SCHEMA_VERSION = 2;
export const QUALITY_TIMING_MODEL_VERSION = "quality-timing-v2";
const FILE_DIGEST_MANIFEST = "file-digests.json";
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
  return createQualityCacheBackend(repoRoot).manifestPath(FILE_DIGEST_MANIFEST);
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
  const backend = createQualityCacheBackend(repoRoot);
  backend.ensureDirs();
  backend.writeJson(digestManifestPath(repoRoot), manifest);
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

function digestObject(value) {
  return `sha256:${hashString(stableJson(value))}`;
}

function actionComponentDigests(action) {
  return {
    contract: digestObject(action.contract),
    env: digestObject(action.env),
    files: digestObject(action.files),
    platform: digestObject(action.platform),
    toolchains: digestObject(action.toolchains),
  };
}

function changedActionComponents(currentComponents, latestComponents) {
  if (!latestComponents || typeof latestComponents !== "object") {
    return [];
  }
  return Object.entries(currentComponents)
    .filter(([name, digest]) => latestComponents[name] && latestComponents[name] !== digest)
    .map(([name]) => name);
}

function formatActionDriftReason(changedComponents) {
  if (!changedComponents.length) {
    return "current action hash differs from latest cached action";
  }
  return `current action hash differs from latest cached action (${changedComponents.join(", ")} changed)`;
}

function mapByName(values = [], nameKey = "path") {
  return new Map(values.map((value) => [value?.[nameKey], value]).filter(([name]) => typeof name === "string" && name.length > 0));
}

function diffObjectKeys(current = {}, previous = {}) {
  return [...new Set([...Object.keys(current ?? {}), ...Object.keys(previous ?? {})])]
    .sort()
    .filter((name) => stableJson(current?.[name]) !== stableJson(previous?.[name]));
}

function diffActionComponentDetails(currentAction, previousAction) {
  if (!previousAction || typeof previousAction !== "object") {
    return {};
  }
  const details = {};
  const currentFiles = mapByName(currentAction.files ?? []);
  const previousFiles = mapByName(previousAction.files ?? []);
  const changedFiles = [...new Set([...currentFiles.keys(), ...previousFiles.keys()])]
    .sort()
    .filter((file) => currentFiles.get(file)?.digest !== previousFiles.get(file)?.digest);
  if (changedFiles.length > 0) {
    details.files = changedFiles;
  }
  const changedEnv = diffObjectKeys(currentAction.env, previousAction.env);
  if (changedEnv.length > 0) {
    details.env = changedEnv;
  }
  const changedToolchains = diffObjectKeys(currentAction.toolchains, previousAction.toolchains);
  if (changedToolchains.length > 0) {
    details.toolchains = changedToolchains;
  }
  if (stableJson(currentAction.contract) !== stableJson(previousAction.contract)) {
    details.contract = diffObjectKeys(currentAction.contract, previousAction.contract);
  }
  if (stableJson(currentAction.platform) !== stableJson(previousAction.platform)) {
    details.platform = [previousAction.platform, currentAction.platform].filter(Boolean);
  }
  return details;
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

export function ensureQualityCacheDirs(repoRoot) {
  return createQualityCacheBackend(repoRoot).ensureDirs();
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
  const actionComponents = actionComponentDigests(action);
  const hash = createHash("sha256");
  hash.update(`schema=${CACHE_SCHEMA_VERSION}\n`);
  hash.update(stableJson(action));
  hash.update("\n");
  flushQualityCacheContext(context);
  return {
    action,
    actionComponents,
    actionContract,
    actionContractFingerprint: action.contractFingerprint,
    cacheKey: hash.digest("hex"),
    files,
  };
}

function writeCasText(repoRoot, value) {
  const text = String(value ?? "");
  const digest = hashString(text);
  const backend = createQualityCacheBackend(repoRoot);
  backend.writeCasText(digest, text);
  return {
    digest,
    sizeBytes: Buffer.byteLength(text),
  };
}

function writeCasFile(repoRoot, filePath) {
  const digest = hashString(readFileSync(filePath));
  const backend = createQualityCacheBackend(repoRoot);
  backend.writeCasFile(digest, filePath);
  return {
    digest: `sha256:${digest}`,
    sizeBytes: statSync(filePath).size,
  };
}

function outputRestorePolicy(actionContract) {
  return (actionContract.outputs ?? []).length > 0 ? "declared-outputs" : "no-output";
}

function unsafeDeclaredOutputReason(repoRoot, actionContract) {
  for (const outputPath of actionContract.outputs ?? []) {
    const resolved = resolveDeclaredOutputPath(repoRoot, outputPath);
    if (resolved.error) {
      return resolved.error;
    }
  }
  return "";
}

function outputManifest(repoRoot, actionContract) {
  const outputs = [];
  for (const outputPath of actionContract.outputs ?? []) {
    const resolved = resolveDeclaredOutputPath(repoRoot, outputPath);
    if (resolved.error) {
      outputs.push({
        digest: "<invalid>",
        error: resolved.error,
        path: resolved.path,
        sizeBytes: 0,
        type: "invalid",
      });
      continue;
    }
    const normalized = resolved.path;
    const absolutePath = resolved.absolutePath;
    if (!existsSync(absolutePath)) {
      outputs.push({
        digest: "<missing>",
        path: normalized,
        sizeBytes: 0,
        type: "missing",
      });
      continue;
    }
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      outputs.push({
        digest: "<directory>",
        path: normalized,
        sizeBytes: 0,
        type: "directory",
      });
      continue;
    }
    const storedOutput = writeCasFile(repoRoot, absolutePath);
    outputs.push({
      digest: storedOutput.digest,
      path: normalized,
      sizeBytes: storedOutput.sizeBytes,
      type: "file",
    });
  }
  return {
    count: outputs.length,
    outputs,
    restorePolicy: outputRestorePolicy(actionContract),
  };
}

function portableActionMetadata(cacheInfo, backend) {
  return {
    actionHash: cacheInfo.cacheKey,
    backend: {
      kind: backend.kind,
      schema: backend.describe().schema,
    },
    components: cacheInfo.actionComponents,
    contract: cacheInfo.actionContract,
    contractFingerprint: cacheInfo.actionContractFingerprint,
    env: cacheInfo.action.env,
    files: cacheInfo.action.files,
    platform: cacheInfo.action.platform,
    toolchains: cacheInfo.action.toolchains,
  };
}

function resolveCachedOutputs(repoRoot, cached, options = {}) {
  const { restore = false } = options;
  const outputs = cached?.outputs?.outputs ?? [];
  if ((cached?.outputRestorePolicy ?? cached?.outputs?.restorePolicy) !== "declared-outputs") {
    return { restoredCount: 0, restorePolicy: "no-output" };
  }
  let restoredCount = 0;
  for (const output of outputs) {
    if (output?.type === "invalid") {
      return {
        error: output.error ?? `unsafe declared output path: ${output.path ?? "<unknown>"}`,
        restoredCount,
        restorePolicy: "declared-outputs",
      };
    }
    if (output?.type !== "file" || typeof output.digest !== "string" || !output.digest.startsWith("sha256:")) {
      continue;
    }
    const resolved = resolveDeclaredOutputPath(repoRoot, output.path);
    if (resolved.error) {
      return {
        error: resolved.error,
        restoredCount,
        restorePolicy: "declared-outputs",
      };
    }
    const backend = createQualityCacheBackend(repoRoot);
    if (!backend.hasCasBlob(output.digest)) {
      return {
        error: `cached output missing from CAS: ${output.path}`,
        restoredCount,
        restorePolicy: "declared-outputs",
      };
    }
    const casSizeBytes = backend.casBlobSize(output.digest);
    if (typeof output.sizeBytes === "number" && casSizeBytes !== output.sizeBytes) {
      return {
        error: `cached output size mismatch in CAS: ${output.path}`,
        restoredCount,
        restorePolicy: "declared-outputs",
      };
    }
    if (!restore) {
      continue;
    }
    backend.restoreCasFile(output.digest, resolved.absolutePath);
    restoredCount += 1;
  }
  return { restoredCount, restorePolicy: "declared-outputs" };
}

function cachedActionReadiness(repoRoot, gate, cacheKey, options = {}) {
  const { restoreOutputs = false } = options;
  if (!gate.cacheable) {
    return { cached: null, missReason: "gate is not cacheable" };
  }
  const outputSafetyError = unsafeDeclaredOutputReason(repoRoot, actionContractForGate(gate));
  if (outputSafetyError) {
    return { cached: null, missReason: outputSafetyError };
  }
  const backend = createQualityCacheBackend(repoRoot);
  const cachedAction = backend.readActionEntry(gate.name, cacheKey);
  if (cachedAction) {
    const cached = cachedAction;
    if (cached?.status !== "pass") {
      return { cached: null, missReason: "cached action is not a passing result" };
    }
    const restore = resolveCachedOutputs(repoRoot, cached, { restore: restoreOutputs });
    if (restore.error) {
      return { cached: null, missReason: restore.error };
    }
    return { cached: { ...cached, outputRestore: restore }, missReason: "" };
  }

  const cachedLegacy = backend.readLegacyEntry(gate.name, cacheKey);
  if (cachedLegacy) {
    const cached = cachedLegacy;
    if (cached?.status !== "pass") {
      return { cached: null, missReason: "legacy cached action is not a passing result" };
    }
    if ((actionContractForGate(gate).outputs ?? []).length > 0) {
      return { cached: null, missReason: "legacy cache entry cannot restore declared outputs" };
    }
    return {
      cached: {
        ...cached,
        outputRestore: { restoredCount: 0, restorePolicy: "no-output" },
        outputRestorePolicy: "no-output",
      },
      missReason: "",
    };
  }
  return { cached: null, missReason: "" };
}

function readMostRecentActionCacheEntry(repoRoot, gateName) {
  const entries = createQualityCacheBackend(repoRoot).listActionEntries(gateName)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return entries[0] ?? null;
}

function countActionCacheEntries(repoRoot, gateName) {
  return createQualityCacheBackend(repoRoot).actionEntryCount(gateName);
}

export function readGateCache(repoRoot, gate, cacheKey) {
  return cachedActionReadiness(repoRoot, gate, cacheKey, { restoreOutputs: true }).cached;
}

export function writeGateCache(repoRoot, gate, cacheKey, result, cacheInfo = null) {
  if (!gate.cacheable || result.status !== "pass") {
    return;
  }
  const outputSafetyError = unsafeDeclaredOutputReason(repoRoot, actionContractForGate(gate));
  if (outputSafetyError) {
    return;
  }
  const stdout = writeCasText(repoRoot, result.stdout ?? "");
  const stderr = writeCasText(repoRoot, result.stderr ?? "");
  const resolvedCacheInfo = cacheInfo ?? computeGateCacheKey(repoRoot, gate);
  const cacheInfoOutputSafetyError = unsafeDeclaredOutputReason(repoRoot, resolvedCacheInfo.actionContract);
  if (cacheInfoOutputSafetyError) {
    return;
  }
  const outputs = outputManifest(repoRoot, resolvedCacheInfo.actionContract);
  const backend = createQualityCacheBackend(repoRoot);
  const portableAction = portableActionMetadata(resolvedCacheInfo, backend);
  backend.writeActionEntry(gate.name, cacheKey, {
    schema: CACHE_SCHEMA_VERSION,
    gate: gate.name,
    cacheKey,
    actionHash: cacheKey,
    action: portableAction,
    actionComponents: resolvedCacheInfo.actionComponents,
    actionContractFingerprint: resolvedCacheInfo.actionContractFingerprint,
    status: "pass",
    durationMs: result.durationMs,
    inputCount: resolvedCacheInfo.files.length,
    outputs,
    outputCount: outputs.count,
    outputRestorePolicy: outputs.restorePolicy,
    stdoutDigest: stdout.digest,
    stdoutSizeBytes: stdout.sizeBytes,
    stderrDigest: stderr.digest,
    stderrSizeBytes: stderr.sizeBytes,
    timestamp: new Date().toISOString(),
  });

  backend.writeLegacyEntry(gate.name, cacheKey, {
    schema: CACHE_SCHEMA_VERSION,
    gate: gate.name,
    cacheKey,
    status: "pass",
    durationMs: result.durationMs,
    timestamp: new Date().toISOString(),
  });
}

export function explainGateCache(repoRoot, gate, context = null) {
  const backend = createQualityCacheBackend(repoRoot);
  const cacheInfo = computeGateCacheKey(repoRoot, gate, context);
  const actionPath = backend.actionCachePath(gate.name, cacheInfo.cacheKey);
  const legacyPath = backend.legacyCachePath(gate.name, cacheInfo.cacheKey);
  const readiness = cachedActionReadiness(repoRoot, gate, cacheInfo.cacheKey, { restoreOutputs: false });
  const cached = readiness.cached;
  const latest = readMostRecentActionCacheEntry(repoRoot, gate.name);
  const changedComponents = changedActionComponents(cacheInfo.actionComponents, latest?.payload?.actionComponents);
  const actionDiff = diffActionComponentDetails(cacheInfo.action, latest?.payload?.action);
  const currentOutputPolicy = outputRestorePolicy(cacheInfo.actionContract);
  return {
    gate: gate.name,
    cacheable: gate.cacheable === true,
    status: cached ? "hit" : "miss",
    cacheKey: cacheInfo.cacheKey,
    actionContract: cacheInfo.actionContract,
    actionComponents: cacheInfo.actionComponents,
    actionContractFingerprint: cacheInfo.actionContractFingerprint,
    actionCachePath: actionPath,
    cacheBackend: backend.describe(),
    legacyCachePath: legacyPath,
    portableAction: cached?.action ?? portableActionMetadata(cacheInfo, backend),
    actionCacheEntries: countActionCacheEntries(repoRoot, gate.name),
    inputCount: cacheInfo.files.length,
    outputCount: cacheInfo.actionContract.outputs.length,
    outputRestorePolicy: cached?.outputRestorePolicy ?? currentOutputPolicy,
    outputs: cached?.outputs ?? {
      count: cacheInfo.actionContract.outputs.length,
      outputs: [],
      restorePolicy: currentOutputPolicy,
    },
    sampleInputs: cacheInfo.files.slice(0, 20),
    actionDiff,
    latestEntry: latest?.payload
      ? {
        cacheKey: latest.payload.cacheKey ?? "",
        action: latest.payload.action ?? null,
        actionComponents: latest.payload.actionComponents ?? null,
        actionContractFingerprint: latest.payload.actionContractFingerprint ?? "",
        status: latest.payload.status ?? "",
        timestamp: latest.payload.timestamp ?? "",
        durationMs: latest.payload.durationMs ?? 0,
        outputCount: latest.payload.outputCount ?? latest.payload.outputs?.count ?? 0,
        outputRestorePolicy: latest.payload.outputRestorePolicy ?? latest.payload.outputs?.restorePolicy ?? "unknown",
      }
      : null,
    missReason: cached
      ? ""
      : readiness.missReason
        ? readiness.missReason
        : latest?.payload?.cacheKey
          ? formatActionDriftReason(changedComponents)
          : "no cached pass result for this gate/action hash",
  };
}

export function appendQualityEvent(repoRoot, event) {
  createQualityCacheBackend(repoRoot).appendEvent(event);
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
  const eventPath = createQualityCacheBackend(repoRoot).eventsPath();
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
  return { ...createQualityCacheBackend(repoRoot).gc(maxAgeDays), maxAgeDays };
}
