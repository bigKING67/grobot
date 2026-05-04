import { readFileSync } from "node:fs";
import { OptionValue, readOptionString, readOptionStringAny } from "../cli-args";
import { MemoryStoreBackend, MemoryStoreRuntime } from "../serve/memory-store-runtime";

const MEMORY_STORE_DEFAULT_REDIS_URL = "redis://127.0.0.1:6379/0";

function fileReadable(path: string): boolean {
  try {
    const content = readFileSync(path, "utf8");
    return content.length >= 0;
  } catch {
    return false;
  }
}

function stripInlineComment(line: string): string {
  let inQuote = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inQuote = !inQuote;
      continue;
    }
    if (char === "#" && !inQuote) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseTomlString(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("\"")) {
    const match = trimmed.match(/^"([^"]*)"/);
    if (match && typeof match[1] === "string") {
      return match[1].trim();
    }
  }
  return trimmed;
}

function parseTomlBoolean(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
}

interface RuntimeStorageTomlSettings {
  hotCache?: MemoryStoreBackend;
  requireRedis?: boolean;
}

function parseRuntimeStorageFromToml(rawToml: string): RuntimeStorageTomlSettings {
  const lines = rawToml.split(/\r?\n/);
  let inRuntimeStorageSection = false;
  const settings: RuntimeStorageTomlSettings = {};
  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      inRuntimeStorageSection = sectionMatch[1] === "runtime.storage";
      continue;
    }
    if (!inRuntimeStorageSection) {
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kvMatch) {
      continue;
    }
    if (kvMatch[1] === "hot_cache") {
      const parsed = parseTomlString(kvMatch[2]);
      if (!parsed) {
        continue;
      }
      const normalized = parsed.trim().toLowerCase();
      if (normalized === "redis") {
        settings.hotCache = "redis";
        continue;
      }
      if (normalized === "file") {
        settings.hotCache = "file";
      }
      continue;
    }
    if (kvMatch[1] === "require_redis") {
      const parsed = parseTomlBoolean(kvMatch[2]);
      if (typeof parsed === "boolean") {
        settings.requireRedis = parsed;
      }
    }
  }
  return settings;
}

function normalizeBooleanOption(raw: string | undefined): boolean | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return undefined;
}

function readRuntimeStorageFromProjectToml(projectTomlPath?: string): RuntimeStorageTomlSettings {
  if (!projectTomlPath || !fileReadable(projectTomlPath)) {
    return {};
  }
  try {
    const raw = readFileSync(projectTomlPath, "utf8");
    return parseRuntimeStorageFromToml(raw);
  } catch {
    return {};
  }
}

function normalizeMemoryStoreBackend(raw: string | undefined): MemoryStoreBackend | "auto" | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "file" || normalized === "redis" || normalized === "auto") {
    return normalized;
  }
  return undefined;
}

function resolveStrictRedisMode(
  options: Record<string, OptionValue>,
  projectSettings: RuntimeStorageTomlSettings,
): boolean {
  const allowFallbackFromCli = normalizeBooleanOption(
    readOptionStringAny(options, ["allow-redis-fallback"]),
  );
  if (allowFallbackFromCli === true) {
    return false;
  }

  const requireRedisFromCli = normalizeBooleanOption(
    readOptionStringAny(options, ["require-redis"]),
  );
  if (typeof requireRedisFromCli === "boolean") {
    return requireRedisFromCli;
  }

  const allowFallbackFromEnv = normalizeBooleanOption(process.env.GROBOT_ALLOW_REDIS_FALLBACK);
  if (allowFallbackFromEnv === true) {
    return false;
  }

  const requireRedisFromEnv = normalizeBooleanOption(process.env.GROBOT_REQUIRE_REDIS);
  if (typeof requireRedisFromEnv === "boolean") {
    return requireRedisFromEnv;
  }

  if (typeof projectSettings.requireRedis === "boolean") {
    return projectSettings.requireRedis;
  }

  return true;
}

export function resolveMemoryStoreRuntime(
  options: Record<string, OptionValue>,
  projectTomlPath: string | undefined,
): MemoryStoreRuntime {
  const projectRuntimeStorage = readRuntimeStorageFromProjectToml(projectTomlPath);
  const fromCli = normalizeMemoryStoreBackend(
    readOptionStringAny(options, ["memory-store-backend", "session-store", "session-backend"]),
  );
  if (fromCli && fromCli !== "auto") {
    const strictRedis = fromCli === "redis"
      ? resolveStrictRedisMode(options, projectRuntimeStorage)
      : false;
    return {
      backend: fromCli,
      requestedBackend: fromCli,
      source: "cli",
      redisUrl: fromCli === "redis"
        ? (readOptionString(options, "redis-url") ??
          process.env.GROBOT_REDIS_URL ??
          MEMORY_STORE_DEFAULT_REDIS_URL)
        : undefined,
      strictRedis,
    };
  }

  const fromEnv = normalizeMemoryStoreBackend(process.env.GROBOT_SESSION_STORE);
  if (fromEnv && fromEnv !== "auto") {
    const strictRedis = fromEnv === "redis"
      ? resolveStrictRedisMode(options, projectRuntimeStorage)
      : false;
    return {
      backend: fromEnv,
      requestedBackend: fromEnv,
      source: "env:GROBOT_SESSION_STORE",
      redisUrl: fromEnv === "redis" ? (process.env.GROBOT_REDIS_URL ?? MEMORY_STORE_DEFAULT_REDIS_URL) : undefined,
      strictRedis,
    };
  }

  const fromProject = projectRuntimeStorage.hotCache;
  if (fromProject) {
    const strictRedis = fromProject === "redis"
      ? resolveStrictRedisMode(options, projectRuntimeStorage)
      : false;
    return {
      backend: fromProject,
      requestedBackend: fromProject,
      source: `project_toml:${projectTomlPath ?? ""}`,
      redisUrl: fromProject === "redis" ? (process.env.GROBOT_REDIS_URL ?? MEMORY_STORE_DEFAULT_REDIS_URL) : undefined,
      strictRedis,
    };
  }

  return {
    backend: "file",
    requestedBackend: "file",
    source: "default:file",
    strictRedis: false,
  };
}

export function maskRedisUrl(redisUrl: string | undefined): string | undefined {
  if (!redisUrl || !redisUrl.includes("@")) {
    return redisUrl;
  }
  return redisUrl.replace(/^(redis(?:s)?:\/\/)([^@/]+)@/i, "$1<redacted>@");
}
