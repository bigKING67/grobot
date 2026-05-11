import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const QUALITY_CACHE_BACKEND_SCHEMA_VERSION = 1;

const CACHE_ROOT = ".cache/grobot-quality";
const ACTION_CACHE_DIR = "ac";
const CAS_DIR = "cas";
const MANIFEST_DIR = "manifests";
const RESULT_CACHE_DIR = "results";
const EVENTS_FILE = "events.jsonl";
const CACHE_BACKEND_ENV = "GROBOT_QUALITY_CACHE_BACKEND";
const CACHE_ROOT_ENV = "GROBOT_QUALITY_CACHE_ROOT";

function safeGateName(gateName) {
  return gateName.replace(/[^A-Za-z0-9_.-]/g, "_");
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export class LocalQualityCacheBackend {
  constructor(repoRoot, options = {}) {
    this.kind = options.kind ?? "local";
    this.repoRoot = repoRoot;
    this.root = options.root ?? path.join(repoRoot, CACHE_ROOT);
  }

  describe() {
    return {
      kind: this.kind,
      root: this.root,
      schema: QUALITY_CACHE_BACKEND_SCHEMA_VERSION,
    };
  }

  ensureDirs() {
    mkdirSync(path.join(this.root, ACTION_CACHE_DIR), { recursive: true });
    mkdirSync(path.join(this.root, CAS_DIR), { recursive: true });
    mkdirSync(path.join(this.root, MANIFEST_DIR), { recursive: true });
    mkdirSync(path.join(this.root, RESULT_CACHE_DIR), { recursive: true });
    return this.root;
  }

  actionCachePath(gateName, cacheKey) {
    return path.join(this.root, ACTION_CACHE_DIR, safeGateName(gateName), `${cacheKey}.json`);
  }

  legacyCachePath(gateName, cacheKey) {
    return path.join(this.root, RESULT_CACHE_DIR, safeGateName(gateName), `${cacheKey}.json`);
  }

  casPath(digest) {
    return path.join(this.root, CAS_DIR, digest.slice(0, 2), digest);
  }

  casStoredPath(digest) {
    return this.casPath(String(digest).replace(/^sha256:/, ""));
  }

  hasCasBlob(digest) {
    return existsSync(this.casStoredPath(digest));
  }

  writeCasText(digest, text) {
    const filePath = this.casPath(digest);
    mkdirSync(path.dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) {
      writeFileSync(filePath, text, "utf8");
    }
    return filePath;
  }

  writeCasFile(digest, sourcePath) {
    const filePath = this.casPath(digest);
    mkdirSync(path.dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) {
      copyFileSync(sourcePath, filePath);
    }
    return filePath;
  }

  restoreCasFile(digest, targetPath) {
    const sourcePath = this.casStoredPath(digest);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }

  manifestPath(name) {
    return path.join(this.root, MANIFEST_DIR, name);
  }

  eventsPath() {
    return path.join(this.root, EVENTS_FILE);
  }

  readJson(filePath) {
    return readJsonFile(filePath);
  }

  readActionEntry(gateName, cacheKey) {
    return this.readJson(this.actionCachePath(gateName, cacheKey));
  }

  readLegacyEntry(gateName, cacheKey) {
    return this.readJson(this.legacyCachePath(gateName, cacheKey));
  }

  writeJson(filePath, payload) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  writeActionEntry(gateName, cacheKey, payload) {
    this.writeJson(this.actionCachePath(gateName, cacheKey), payload);
  }

  writeLegacyEntry(gateName, cacheKey, payload) {
    this.writeJson(this.legacyCachePath(gateName, cacheKey), payload);
  }

  listActionEntries(gateName) {
    const dir = path.join(this.root, ACTION_CACHE_DIR, safeGateName(gateName));
    if (!existsSync(dir)) {
      return [];
    }
    return readdirSync(dir)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => {
        const filePath = path.join(dir, entry);
        try {
          return {
            filePath,
            mtimeMs: statSync(filePath).mtimeMs,
            payload: this.readJson(filePath),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  actionEntryCount(gateName) {
    return this.listActionEntries(gateName).length;
  }

  hasPath(filePath) {
    return existsSync(filePath);
  }

  appendEvent(event) {
    this.ensureDirs();
    writeFileSync(this.eventsPath(), `${JSON.stringify(event)}\n`, {
      encoding: "utf8",
      flag: "a",
    });
  }

  gc(maxAgeDays = 30) {
    if (!existsSync(this.root)) {
      return { deleted: 0, root: this.root };
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
    walk(path.join(this.root, ACTION_CACHE_DIR));
    walk(path.join(this.root, CAS_DIR));
    walk(path.join(this.root, MANIFEST_DIR));
    walk(path.join(this.root, RESULT_CACHE_DIR));
    return { deleted, root: this.root };
  }
}

export function createQualityCacheBackend(repoRoot) {
  const backendKind = String(process.env[CACHE_BACKEND_ENV] ?? "local").trim() || "local";
  if (!["local", "filesystem"].includes(backendKind)) {
    throw new Error(`unsupported quality cache backend: ${backendKind}`);
  }
  if (backendKind === "filesystem") {
    const configuredRoot = String(process.env[CACHE_ROOT_ENV] ?? "").trim();
    if (!configuredRoot) {
      throw new Error(`${CACHE_ROOT_ENV} is required when ${CACHE_BACKEND_ENV}=filesystem`);
    }
    if (!path.isAbsolute(configuredRoot)) {
      throw new Error(`${CACHE_ROOT_ENV} must be an absolute path`);
    }
    return new LocalQualityCacheBackend(repoRoot, {
      kind: "filesystem",
      root: configuredRoot,
    });
  }
  return new LocalQualityCacheBackend(repoRoot);
}

export function getQualityCacheRoot(repoRoot) {
  return createQualityCacheBackend(repoRoot).root;
}
