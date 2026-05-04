import { readFileSync } from "node:fs";
import { sanitizeSessionKey } from "./session-key";
import type { ResolvedSessionStoreReadPath } from "./types";

export function fileReadable(path: string): boolean {
  try {
    const content = readFileSync(path, "utf8");
    return content.length >= 0;
  } catch {
    return false;
  }
}

function removeTrailingSlashes(value: string): string {
  if (/^[\\/]+$/.test(value)) {
    return value.startsWith("\\") ? "\\" : "/";
  }
  return value.replace(/[\\/]+$/, "");
}

export function dirname(path: string): string {
  const normalized = removeTrailingSlashes(path);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function sessionRegistryRoot(homeDir: string): string {
  return `${removeTrailingSlashes(homeDir)}/sessions`;
}

function legacySessionRegistryRoots(homeDir: string): string[] {
  const normalizedHome = removeTrailingSlashes(homeDir);
  return [
    `${normalizedHome}/session`,
    `${normalizedHome}/runtime/sessions`,
  ];
}

function resolveLegacyReadablePath(
  canonicalPath: string,
  legacyPaths: string[],
  warnPrefix: string,
  warnings: string[],
): string {
  if (fileReadable(canonicalPath)) {
    return canonicalPath;
  }
  for (const legacyPath of legacyPaths) {
    if (!fileReadable(legacyPath)) {
      continue;
    }
    warnings.push(`${warnPrefix} migrated from legacy path (${legacyPath})`);
    return legacyPath;
  }
  return canonicalPath;
}

export function sessionRegistryFilePath(homeDir: string, namespaceKey: string): string {
  const root = sessionRegistryRoot(homeDir);
  return `${root}/${sanitizeSessionKey(namespaceKey)}.sessions.json`;
}

function legacySessionRegistryFilePaths(homeDir: string, namespaceKey: string): string[] {
  const fileName = `${sanitizeSessionKey(namespaceKey)}.sessions.json`;
  return legacySessionRegistryRoots(homeDir).map((root) => `${root}/${fileName}`);
}

export function historyStoreFilePath(homeDir: string, sessionKey: string): string {
  const root = sessionRegistryRoot(homeDir);
  return `${root}/${sanitizeSessionKey(sessionKey)}.history.json`;
}

function legacyHistoryStoreFilePaths(homeDir: string, sessionKey: string): string[] {
  const fileName = `${sanitizeSessionKey(sessionKey)}.history.json`;
  return legacySessionRegistryRoots(homeDir).map((root) => `${root}/${fileName}`);
}

export function resolveSessionRegistryReadPath(
  homeDir: string,
  namespaceKey: string,
): ResolvedSessionStoreReadPath {
  const path = sessionRegistryFilePath(homeDir, namespaceKey);
  const legacyPaths = legacySessionRegistryFilePaths(homeDir, namespaceKey);
  const warnings: string[] = [];
  const sourcePath = resolveLegacyReadablePath(path, legacyPaths, "session registry", warnings);
  return {
    path: sourcePath,
    warnings,
  };
}

export function resolveHistoryStoreReadPath(
  homeDir: string,
  sessionKey: string,
): ResolvedSessionStoreReadPath {
  const path = historyStoreFilePath(homeDir, sessionKey);
  const legacyPaths = legacyHistoryStoreFilePaths(homeDir, sessionKey);
  const warnings: string[] = [];
  const sourcePath = resolveLegacyReadablePath(path, legacyPaths, "history", warnings);
  return {
    path: sourcePath,
    warnings,
  };
}
