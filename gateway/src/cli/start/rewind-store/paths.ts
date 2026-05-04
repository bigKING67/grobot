import { dirname, isAbsolute, normalize, resolve } from "node:path";
import { removeTrailingSlashes } from "../../services/runtime-paths";

export function sanitizeSessionKey(sessionKey: string): string {
  return sessionKey.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function normalizeRelativePath(input: string): string | undefined {
  const cleaned = input.replace(/\\/g, "/").replace(/^\.\/+/g, "");
  if (!cleaned || cleaned === ".") {
    return undefined;
  }
  const normalized = cleaned
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
  if (!normalized || normalized.startsWith("..") || normalized.includes("/../")) {
    return undefined;
  }
  return normalized;
}

export function sessionsRoot(workDir: string): string {
  return `${removeTrailingSlashes(workDir)}/.grobot/sessions`;
}

export function rewindLogPath(workDir: string, sessionKey: string): string {
  return `${sessionsRoot(workDir)}/${sanitizeSessionKey(sessionKey)}.rewind.jsonl`;
}

export function safeWorkspacePath(workDir: string, pathValue: string): string | undefined {
  if (!pathValue || isAbsolute(pathValue)) {
    return undefined;
  }
  const normalizedRelative = normalizeRelativePath(pathValue);
  if (!normalizedRelative) {
    return undefined;
  }
  const workspaceRoot = removeTrailingSlashes(resolve(workDir));
  const absolutePath = resolve(workspaceRoot, normalizedRelative);
  const normalizedAbsolute = normalize(absolutePath);
  if (
    normalizedAbsolute !== workspaceRoot
    && !normalizedAbsolute.startsWith(`${workspaceRoot}/`)
  ) {
    return undefined;
  }
  return normalizedAbsolute;
}

export function dirnameForPath(path: string): string {
  return dirname(path);
}
