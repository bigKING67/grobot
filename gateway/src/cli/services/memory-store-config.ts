import { readFileSync } from "node:fs";
import { OptionValue, readOptionString } from "../cli-args";
import { MemoryStoreBackend, MemoryStoreRuntime } from "../serve/memory-store-runtime";

const MEMORY_STORE_DEFAULT_REDIS_URL = "redis://127.0.0.1:6379/0";

export class MemoryStoreConfigInputError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(field: string, detail: string) {
    super(detail);
    this.name = "MemoryStoreConfigInputError";
    this.code = `invalid_${field.replace(/-/g, "_")}`;
    this.field = field;
  }
}

export function isMemoryStoreConfigInputError(
  error: unknown,
): error is MemoryStoreConfigInputError {
  return error instanceof MemoryStoreConfigInputError;
}

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
        continue;
      }
      throw new MemoryStoreConfigInputError(
        "memory-store-backend",
        "memory-store-backend must be file, redis, or auto",
      );
    }
    if (kvMatch[1] === "require_redis") {
      const parsed = parseTomlBoolean(kvMatch[2]);
      if (typeof parsed === "boolean") {
        settings.requireRedis = parsed;
        continue;
      }
      throw new MemoryStoreConfigInputError(
        "require-redis",
        "require-redis must be boolean",
      );
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
  } catch (error) {
    if (isMemoryStoreConfigInputError(error)) {
      throw error;
    }
    return {};
  }
}

function requireValidBackend(
  raw: string | undefined,
  field: string,
): MemoryStoreBackend | "auto" | undefined {
  const parsed = normalizeMemoryStoreBackend(raw);
  if (raw !== undefined && raw.trim().length > 0 && !parsed) {
    throw new MemoryStoreConfigInputError(
      field,
      `${field} must be file, redis, or auto`,
    );
  }
  return parsed;
}

function requireValidBoolean(
  raw: string | undefined,
  field: string,
): boolean | undefined {
  const parsed = normalizeBooleanOption(raw);
  if (raw !== undefined && raw.trim().length > 0 && typeof parsed !== "boolean") {
    throw new MemoryStoreConfigInputError(
      field,
      `${field} must be boolean`,
    );
  }
  return parsed;
}

function readOptionStringAnyWithKey(
  options: Record<string, OptionValue>,
  keys: readonly string[],
): { key: string; value: string } | undefined {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(options, key)) {
      continue;
    }
    const raw = options[key];
    const value = typeof raw === "string" ? raw.trim() : undefined;
    if (value) {
      return {
        key,
        value,
      };
    }
    throw new MemoryStoreConfigInputError(
      key,
      `${key} must not be empty`,
    );
  }
  return undefined;
}

function readOptionStringAnyStrict(
  options: Record<string, OptionValue>,
  keys: readonly string[],
): string | undefined {
  return readOptionStringAnyWithKey(options, keys)?.value;
}

function requireValidCliBackend(
  options: Record<string, OptionValue>,
): MemoryStoreBackend | "auto" | undefined {
  const option = readOptionStringAnyWithKey(options, [
    "memory-store-backend",
    "session-store",
    "session-backend",
  ]);
  if (!option) {
    return undefined;
  }
  return requireValidBackend(option.value, option.key);
}

function requireValidEnvBackend(): MemoryStoreBackend | "auto" | undefined {
  return requireValidBackend(process.env.GROBOT_SESSION_STORE, "session-store");
}

function resolveRedisUrl(
  options: Record<string, OptionValue>,
  envRedisUrl: string | undefined,
): string {
  const hasCliRedisUrl = Object.prototype.hasOwnProperty.call(options, "redis-url");
  const cliRedisUrl = readOptionString(options, "redis-url");
  if (hasCliRedisUrl && !cliRedisUrl) {
    throw new MemoryStoreConfigInputError(
      "redis-url",
      "redis-url must be a redis:// or rediss:// URL",
    );
  }
  const rawRedisUrl = cliRedisUrl ?? envRedisUrl ?? MEMORY_STORE_DEFAULT_REDIS_URL;
  try {
    const url = new URL(rawRedisUrl);
    if (url.protocol === "redis:" || url.protocol === "rediss:") {
      return rawRedisUrl;
    }
  } catch {
    // Report below with the same stable field/code.
  }
  throw new MemoryStoreConfigInputError(
    "redis-url",
    "redis-url must be a redis:// or rediss:// URL",
  );
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
  const allowFallbackFromCli = requireValidBoolean(
    readOptionStringAnyStrict(options, ["allow-redis-fallback"]),
    "allow-redis-fallback",
  );
  if (allowFallbackFromCli === true) {
    return false;
  }

  const requireRedisFromCli = requireValidBoolean(
    readOptionStringAnyStrict(options, ["require-redis"]),
    "require-redis",
  );
  if (typeof requireRedisFromCli === "boolean") {
    return requireRedisFromCli;
  }

  const allowFallbackFromEnv = requireValidBoolean(
    process.env.GROBOT_ALLOW_REDIS_FALLBACK,
    "allow-redis-fallback",
  );
  if (allowFallbackFromEnv === true) {
    return false;
  }

  const requireRedisFromEnv = requireValidBoolean(
    process.env.GROBOT_REQUIRE_REDIS,
    "require-redis",
  );
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
  const fromCli = requireValidCliBackend(options);
  if (fromCli && fromCli !== "auto") {
    const strictRedis = fromCli === "redis"
      ? resolveStrictRedisMode(options, projectRuntimeStorage)
      : false;
    return {
      backend: fromCli,
      requestedBackend: fromCli,
      source: "cli",
      redisUrl: fromCli === "redis" ? resolveRedisUrl(options, process.env.GROBOT_REDIS_URL) : undefined,
      strictRedis,
    };
  }

  const fromEnv = requireValidEnvBackend();
  if (fromEnv && fromEnv !== "auto") {
    const strictRedis = fromEnv === "redis"
      ? resolveStrictRedisMode(options, projectRuntimeStorage)
      : false;
    return {
      backend: fromEnv,
      requestedBackend: fromEnv,
      source: "env:GROBOT_SESSION_STORE",
      redisUrl: fromEnv === "redis" ? resolveRedisUrl(options, process.env.GROBOT_REDIS_URL) : undefined,
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
      redisUrl: fromProject === "redis" ? resolveRedisUrl(options, process.env.GROBOT_REDIS_URL) : undefined,
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
