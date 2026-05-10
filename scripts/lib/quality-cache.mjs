import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const CACHE_SCHEMA_VERSION = 1;
const CACHE_ROOT = ".cache/grobot-quality";
const RESULT_CACHE_DIR = "results";
const EVENTS_FILE = "events.jsonl";

function hashString(value) {
  return createHash("sha256").update(value).digest("hex");
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

function fileDigest(repoRoot, file, context) {
  if (context?.fileDigests.has(file)) {
    return context.fileDigests.get(file);
  }
  let digest = "<missing>";
  try {
    digest = `sha256:${hashString(readFileSync(path.join(repoRoot, file)))}`;
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

export function createQualityCacheContext(repoRoot) {
  return {
    repoRoot,
    expandedInputs: new Map(),
    fileDigests: new Map(),
    toolVersions: new Map(),
    trackedFiles: null,
  };
}

export function getQualityCacheRoot(repoRoot) {
  return path.join(repoRoot, CACHE_ROOT);
}

export function ensureQualityCacheDirs(repoRoot) {
  const root = getQualityCacheRoot(repoRoot);
  mkdirSync(path.join(root, RESULT_CACHE_DIR), { recursive: true });
  return root;
}

export function computeGateCacheKey(repoRoot, gate, context = null) {
  const files = expandInputPatterns(repoRoot, gate.inputs ?? [], context);
  const hash = createHash("sha256");
  hash.update(`schema=${CACHE_SCHEMA_VERSION}\n`);
  hash.update(`gate=${gate.name}\n`);
  hash.update(`command=${gate.command}\n`);
  hash.update(`node=${process.version}\n`);
  hash.update(`npm=${toolVersion(repoRoot, "npm", ["--version"], context)}\n`);
  if (gate.group === "runtime" || gate.command.includes("cargo ")) {
    hash.update(`rustc=${toolVersion(repoRoot, "rustc", ["--version"], context)}\n`);
    hash.update(`cargo=${toolVersion(repoRoot, "cargo", ["--version"], context)}\n`);
  }
  for (const file of files) {
    hash.update(`file=${file}\n`);
    hash.update(fileDigest(repoRoot, file, context));
    hash.update("\n");
  }
  return {
    cacheKey: hash.digest("hex"),
    files,
  };
}

function cacheFilePath(repoRoot, gateName, cacheKey) {
  const safeGateName = gateName.replace(/[^A-Za-z0-9_.-]/g, "_");
  return path.join(getQualityCacheRoot(repoRoot), RESULT_CACHE_DIR, safeGateName, `${cacheKey}.json`);
}

export function readGateCache(repoRoot, gate, cacheKey) {
  if (!gate.cacheable) {
    return null;
  }
  const filePath = cacheFilePath(repoRoot, gate.name, cacheKey);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const cached = JSON.parse(readFileSync(filePath, "utf8"));
    return cached?.status === "pass" ? cached : null;
  } catch {
    return null;
  }
}

export function writeGateCache(repoRoot, gate, cacheKey, result) {
  if (!gate.cacheable || result.status !== "pass") {
    return;
  }
  const filePath = cacheFilePath(repoRoot, gate.name, cacheKey);
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

export function appendQualityEvent(repoRoot, event) {
  const root = ensureQualityCacheDirs(repoRoot);
  writeFileSync(path.join(root, EVENTS_FILE), `${JSON.stringify(event)}\n`, {
    encoding: "utf8",
    flag: "a",
  });
}

export function summarizeQualityEvents(repoRoot, options = {}) {
  const { limit = 200, slowLimit = 10 } = options;
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
      };
      const durationMs = Number(result.durationMs ?? 0);
      current.count += 1;
      current.totalMs += durationMs;
      current.maxMs = Math.max(current.maxMs, durationMs);
      if (result.cacheHit) {
        current.cachedCount += 1;
      } else {
        current.coldCount += 1;
        current.coldTotalMs += durationMs;
        current.coldMaxMs = Math.max(current.coldMaxMs, durationMs);
      }
      gates.set(result.name, current);
    }
  }

  const summaries = [...gates.values()].map((item) => ({
    ...item,
    avgMs: Math.round(item.totalMs / item.count),
    cacheHitRate: item.count === 0 ? 0 : item.cachedCount / item.count,
    coldAvgMs: item.coldCount === 0 ? 0 : Math.round(item.coldTotalMs / item.coldCount),
  }));

  return {
    cacheHits,
    cacheHitRate: totalGateResults === 0 ? 0 : cacheHits / totalGateResults,
    modes,
    slowest: [...summaries].sort((a, b) => b.maxMs - a.maxMs).slice(0, slowLimit),
    slowestCold: [...summaries].filter((item) => item.coldCount > 0).sort((a, b) => b.coldMaxMs - a.coldMaxMs).slice(0, slowLimit),
    totalGateResults,
    totalRuns: events.length,
  };
}
