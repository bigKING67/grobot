import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  hashContentFNV,
  recordContextGraphCacheEvict,
  recordContextGraphCacheHit,
  recordContextGraphCacheMiss,
  recordContextGraphCacheWrite,
  setLruCacheEntry,
} from "../cache-utils";
import { extractTypeScriptAstDependencyTargets } from "../dependency-ts-ast";
import {
  DEPENDENCY_IMPORT_CACHE_BUCKET,
  MAX_IMPORT_CACHE_ENTRIES,
} from "./constants";
import {
  getDirPath,
  normalizePath,
} from "./utils";

const dependencyImportCache = new Map<string, string[]>();

function dedupeTargets(rows: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of rows) {
    const normalized = raw.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= 160) {
      break;
    }
  }
  return output;
}

function resolveFileCandidates(resolvedBase: string): string[] {
  return [
    resolvedBase,
    `${resolvedBase}.ts`,
    `${resolvedBase}.tsx`,
    `${resolvedBase}.js`,
    `${resolvedBase}.jsx`,
    `${resolvedBase}.mjs`,
    `${resolvedBase}.cjs`,
    `${resolvedBase}.py`,
    `${resolvedBase}.rs`,
    `${resolvedBase}.go`,
    `${resolvedBase}.java`,
    `${resolvedBase}/index.ts`,
    `${resolvedBase}/index.tsx`,
    `${resolvedBase}/index.js`,
    `${resolvedBase}/index.mjs`,
    `${resolvedBase}/index.py`,
    `${resolvedBase}/mod.rs`,
  ];
}

export function resolveRelativeTarget(
  rootPath: string,
  fromPath: string,
  importPath: string,
): string | undefined {
  if (!importPath.startsWith(".")) {
    return undefined;
  }
  const baseDir = getDirPath(fromPath);
  const resolvedBase = resolve(rootPath, baseDir, importPath);
  for (const candidate of resolveFileCandidates(resolvedBase)) {
    if (!existsSync(candidate)) {
      continue;
    }
    const relativeRaw = candidate.startsWith(rootPath)
      ? candidate.slice(rootPath.length)
      : candidate;
    const relative = normalizePath(relativeRaw);
    if (!relative) {
      continue;
    }
    return relative;
  }
  return normalizePath(importPath);
}

export function resolveRelativeTargetInSnapshot(
  fromPath: string,
  importPath: string,
  snapshotPathSet: ReadonlySet<string>,
): string | undefined {
  if (!importPath.startsWith(".")) {
    return undefined;
  }
  const baseDir = getDirPath(fromPath);
  const resolvedBase = normalizePath(resolve("/", baseDir, importPath)).replace(/^\//, "");
  for (const candidate of resolveFileCandidates(resolvedBase)) {
    const normalized = normalizePath(candidate);
    if (!normalized) {
      continue;
    }
    if (snapshotPathSet.has(normalized.toLowerCase())) {
      return normalized;
    }
  }
  return undefined;
}

function extractRegexImports(content: string): string[] {
  const rows: string[] = [];
  const push = (value: string): void => {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    rows.push(normalized);
  };
  const esmRegex = /from\s+["']([^"']+)["']/g;
  let esmMatch: RegExpExecArray | null = esmRegex.exec(content);
  while (esmMatch) {
    if (typeof esmMatch[1] === "string") {
      push(esmMatch[1]);
    }
    esmMatch = esmRegex.exec(content);
  }
  const requireRegex = /require\(\s*["']([^"']+)["']\s*\)/g;
  let requireMatch: RegExpExecArray | null = requireRegex.exec(content);
  while (requireMatch) {
    if (typeof requireMatch[1] === "string") {
      push(requireMatch[1]);
    }
    requireMatch = requireRegex.exec(content);
  }
  const pythonFromRegex = /^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+/gm;
  let pythonFromMatch: RegExpExecArray | null = pythonFromRegex.exec(content);
  while (pythonFromMatch) {
    if (typeof pythonFromMatch[1] === "string") {
      push(pythonFromMatch[1]);
    }
    pythonFromMatch = pythonFromRegex.exec(content);
  }
  const pythonImportRegex = /^\s*import\s+([A-Za-z0-9_.]+)/gm;
  let pythonImportMatch: RegExpExecArray | null = pythonImportRegex.exec(content);
  while (pythonImportMatch) {
    if (typeof pythonImportMatch[1] === "string") {
      push(pythonImportMatch[1]);
    }
    pythonImportMatch = pythonImportRegex.exec(content);
  }
  const rustUseRegex = /^\s*use\s+([A-Za-z0-9_:]+)/gm;
  let rustUseMatch: RegExpExecArray | null = rustUseRegex.exec(content);
  while (rustUseMatch) {
    if (typeof rustUseMatch[1] === "string") {
      push(rustUseMatch[1]);
    }
    rustUseMatch = rustUseRegex.exec(content);
  }
  return dedupeTargets(rows).slice(0, 120);
}

export function extractImports(filePath: string, content: string): string[] {
  const cacheKey = `${filePath}::${String(content.length)}::${hashContentFNV(content)}`;
  const cached = dependencyImportCache.get(cacheKey);
  if (cached) {
    recordContextGraphCacheHit(DEPENDENCY_IMPORT_CACHE_BUCKET);
    return cached;
  }
  recordContextGraphCacheMiss(DEPENDENCY_IMPORT_CACHE_BUCKET);
  const astTargets = extractTypeScriptAstDependencyTargets(filePath, content);
  const resolved = astTargets.length > 0
    ? dedupeTargets(astTargets).slice(0, 120)
    : extractRegexImports(content);
  const evicted = setLruCacheEntry(
    dependencyImportCache,
    cacheKey,
    resolved,
    MAX_IMPORT_CACHE_ENTRIES,
  );
  recordContextGraphCacheWrite(DEPENDENCY_IMPORT_CACHE_BUCKET);
  if (evicted > 0) {
    recordContextGraphCacheEvict(DEPENDENCY_IMPORT_CACHE_BUCKET, evicted);
  }
  return resolved;
}
