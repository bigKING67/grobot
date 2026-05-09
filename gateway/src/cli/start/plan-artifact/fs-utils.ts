import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { removeTrailingSlashes } from "../../services/runtime-paths";

export function nowIsoUtc(): string {
  return new Date().toISOString();
}

export function removeDangerousChars(value: string): string {
  return value
    .replace(/[`*_#<>{}\[\]()|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeSegment(raw: string, fallback: string, maxLen = 64): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/g, "")
    .replace(/-+$/g, "");
  const finalValue = normalized.length > 0 ? normalized : fallback;
  return finalValue.slice(0, Math.max(1, maxLen));
}

export function compactSingleLine(raw: string, maxLen: number): string {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLen) {
    return compact;
  }
  return `${compact.slice(0, Math.max(1, maxLen)).trimEnd()}…`;
}

export function dirname(path: string): string {
  const normalized = removeTrailingSlashes(path);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

export function writeFileAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now().toString(36)}-${Math.floor(Math.random() * 65_536).toString(16)}`;
  writeFileSync(tempPath, content, "utf8");
  try {
    renameSync(tempPath, path);
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // ignore temp cleanup errors
    }
    throw error;
  }
}

export function parseOptionalNonNegativeInt(raw: string | undefined): number | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

export function parseOptionalFiniteNumber(raw: string | undefined): number | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

export function readJsonObject(path: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

export function resolveCandidatePath(workDir: string, rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed.startsWith("/")) {
    return resolvePath(trimmed);
  }
  return resolvePath(workDir, trimmed);
}
