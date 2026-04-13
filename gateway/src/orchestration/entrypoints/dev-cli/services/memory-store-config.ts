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

function parseRuntimeHotCacheFromToml(rawToml: string): MemoryStoreBackend | undefined {
  const lines = rawToml.split(/\r?\n/);
  let inRuntimeStorageSection = false;
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
    if (kvMatch[1] !== "hot_cache") {
      continue;
    }
    const parsed = parseTomlString(kvMatch[2]);
    if (!parsed) {
      return undefined;
    }
    const normalized = parsed.trim().toLowerCase();
    if (normalized === "redis") {
      return "redis";
    }
    if (normalized === "file") {
      return "file";
    }
    return undefined;
  }
  return undefined;
}

function readRuntimeHotCacheFromProjectToml(projectTomlPath?: string): MemoryStoreBackend | undefined {
  if (!projectTomlPath || !fileReadable(projectTomlPath)) {
    return undefined;
  }
  try {
    const raw = readFileSync(projectTomlPath, "utf8");
    return parseRuntimeHotCacheFromToml(raw);
  } catch {
    return undefined;
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

export function resolveMemoryStoreRuntime(
  options: Record<string, OptionValue>,
  projectTomlPath: string | undefined,
): MemoryStoreRuntime {
  const fromCli = normalizeMemoryStoreBackend(
    readOptionStringAny(options, ["memory-store-backend", "session-store", "session-backend"]),
  );
  if (fromCli && fromCli !== "auto") {
    return {
      backend: fromCli,
      requestedBackend: fromCli,
      source: "cli",
      redisUrl: fromCli === "redis"
        ? (readOptionString(options, "redis-url") ??
          process.env.GROBOT_REDIS_URL ??
          MEMORY_STORE_DEFAULT_REDIS_URL)
        : undefined,
    };
  }

  const fromEnv = normalizeMemoryStoreBackend(process.env.GROBOT_SESSION_STORE);
  if (fromEnv && fromEnv !== "auto") {
    return {
      backend: fromEnv,
      requestedBackend: fromEnv,
      source: "env:GROBOT_SESSION_STORE",
      redisUrl: fromEnv === "redis" ? (process.env.GROBOT_REDIS_URL ?? MEMORY_STORE_DEFAULT_REDIS_URL) : undefined,
    };
  }

  const fromProject = readRuntimeHotCacheFromProjectToml(projectTomlPath);
  if (fromProject) {
    return {
      backend: fromProject,
      requestedBackend: fromProject,
      source: `project_toml:${projectTomlPath ?? ""}`,
      redisUrl: fromProject === "redis" ? (process.env.GROBOT_REDIS_URL ?? MEMORY_STORE_DEFAULT_REDIS_URL) : undefined,
    };
  }

  return {
    backend: "file",
    requestedBackend: "file",
    source: "default:file",
  };
}

export function maskRedisUrl(redisUrl: string | undefined): string | undefined {
  if (!redisUrl || !redisUrl.includes("@")) {
    return redisUrl;
  }
  return redisUrl.replace(/^(redis(?:s)?:\/\/)([^@/]+)@/i, "$1<redacted>@");
}
