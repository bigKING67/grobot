import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { BaselineAvailabilityMode, JsonObject } from "./types";

export function dirname(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

export function parseBaselineAvailabilityMode(value: unknown): BaselineAvailabilityMode {
  if (typeof value !== "string") {
    return "auto";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return "force_on";
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return "force_off";
  }
  return "auto";
}

export function resolveBaselineAvailability(input: {
  mode: BaselineAvailabilityMode;
  baseSha: string | undefined;
  contextMemoryBaseReportPath: string;
}): boolean {
  if (input.mode === "force_on") {
    return true;
  }
  if (input.mode === "force_off") {
    return false;
  }
  if (existsSync(input.contextMemoryBaseReportPath)) {
    return true;
  }
  return typeof input.baseSha === "string";
}

export function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function asObject(value: unknown): JsonObject {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

export function clampRate(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function toMetricNumber(value: number): number {
  return Number(value.toFixed(6));
}

export function removeTrailingSlashes(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

export function pathJoin(base: string, relative: string): string {
  const trimmedBase = removeTrailingSlashes(base);
  const trimmedRelative = relative.replace(/^[\\/]+/, "");
  return `${trimmedBase}/${trimmedRelative}`;
}

export function isAbsolutePath(path: string): boolean {
  return path.startsWith("/");
}

export function resolvePathFromRepoRoot(repoRoot: string, path: string): string {
  if (isAbsolutePath(path)) {
    return path;
  }
  return pathJoin(repoRoot, path);
}

export function toRepoRelativePath(repoRoot: string, path: string): string | undefined {
  if (!path) {
    return undefined;
  }
  if (!isAbsolutePath(path)) {
    return path.replace(/^[\\/]+/, "");
  }
  const normalizedRoot = removeTrailingSlashes(repoRoot);
  const normalizedPath = path.replace(/[\\]+/g, "/");
  if (normalizedPath === normalizedRoot) {
    return "";
  }
  if (!normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return undefined;
  }
  return normalizedPath.slice(normalizedRoot.length + 1);
}

export function runCapture(command: string[]): string | undefined {
  if (command.length === 0) {
    return undefined;
  }
  const result = spawnSync(command[0], command.slice(1), {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.status !== 0) {
    return undefined;
  }
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  return stdout.length > 0 ? stdout : undefined;
}

export function parseJsonObject(path: string): JsonObject {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return asObject(parsed);
  } catch {
    return {};
  }
}

export function parseJsonLines(path: string): JsonObject[] {
  if (!existsSync(path)) {
    return [];
  }
  try {
    const raw = readFileSync(path, "utf8");
    return parseJsonLinesContent(raw);
  } catch {
    return [];
  }
}

export function parseJsonLinesContent(raw: string): JsonObject[] {
  const rows: JsonObject[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const normalized = line.trim();
    if (!normalized) {
      continue;
    }
    try {
      const parsed = JSON.parse(normalized) as unknown;
      rows.push(asObject(parsed));
    } catch {
      continue;
    }
  }
  return rows;
}

export function readFileAtRevision(repoRoot: string, baseSha: string, repoRelativePath: string): string | undefined {
  if (!repoRelativePath) {
    return undefined;
  }
  const spec = `${baseSha}:${repoRelativePath}`;
  const result = spawnSync("git", ["-C", repoRoot, "show", spec], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.status !== 0) {
    return undefined;
  }
  return typeof result.stdout === "string" ? result.stdout : undefined;
}
