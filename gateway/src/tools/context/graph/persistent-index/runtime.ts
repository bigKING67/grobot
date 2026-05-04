import { resolve } from "node:path";
import { hashContentFNV } from "../cache-utils";
import type {
  PersistentDependencyEdge,
  PersistentGraphIndexEntry,
  PersistentGraphIndexMemory,
  PersistentGraphIndexRuntime,
  PersistentSymbolDeclaration,
} from "./contract";
import {
  getDirPath,
  normalizePath,
  normalizePathLower,
} from "./utils";

function resolveRelativeImportInGraph(
  fromPath: string,
  importPath: string,
  pathSet: ReadonlySet<string>,
  displayPathByLower: ReadonlyMap<string, string>,
): string | undefined {
  const rawImportPath = importPath.trim();
  if (!rawImportPath.startsWith(".")) {
    return undefined;
  }
  const normalizedImportPath = normalizePath(rawImportPath);
  const baseDir = getDirPath(fromPath);
  const resolvedBase = normalizePath(resolve("/", baseDir, normalizedImportPath)).replace(/^\//, "");
  const candidates = [
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
  for (const candidate of candidates) {
    const normalized = normalizePathLower(candidate);
    if (!normalized || !pathSet.has(normalized)) {
      continue;
    }
    const display = displayPathByLower.get(normalized);
    if (display) {
      return display;
    }
  }
  return undefined;
}

function buildRuntime(index: PersistentGraphIndexMemory): PersistentGraphIndexRuntime {
  const pathSet = new Set<string>();
  const displayPathByLower = new Map<string, string>();
  for (const row of index.files.values()) {
    const key = normalizePathLower(row.path);
    pathSet.add(key);
    displayPathByLower.set(key, row.path);
  }
  const edges: PersistentDependencyEdge[] = [];
  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  const declarations: PersistentSymbolDeclaration[] = [];
  const declarationImports = new Map<string, Set<string>>();
  const identifierToFiles = new Map<string, Set<string>>();

  const pushGraph = (map: Map<string, Set<string>>, key: string, value: string): void => {
    const current = map.get(key) ?? new Set<string>();
    current.add(value);
    map.set(key, current);
  };

  for (const row of index.files.values()) {
    const fromPath = normalizePath(row.path);
    const fromPathLower = normalizePathLower(fromPath);
    const localImports = new Set<string>();
    for (const rawTarget of row.imports) {
      const normalizedTarget = normalizePath(rawTarget);
      const resolvedLocal = resolveRelativeImportInGraph(fromPath, rawTarget, pathSet, displayPathByLower);
      const target = resolvedLocal ?? normalizedTarget;
      const targetLower = normalizePathLower(target);
      const local = pathSet.has(targetLower);
      edges.push({
        fromPath,
        target,
        targetIsLocal: local,
      });
      if (local) {
        const displayTarget = displayPathByLower.get(targetLower) ?? target;
        localImports.add(displayTarget);
        pushGraph(forward, fromPath, displayTarget);
        pushGraph(reverse, displayTarget, fromPath);
      }
    }
    declarationImports.set(fromPath, localImports);
    for (const symbol of row.symbols) {
      declarations.push({
        symbol: symbol.symbol,
        kind: symbol.kind,
        filePath: fromPath,
        line: symbol.line,
      });
    }
    for (const identifier of row.identifiers) {
      const token = identifier.toLowerCase();
      if (!token) {
        continue;
      }
      const current = identifierToFiles.get(token) ?? new Set<string>();
      current.add(fromPath);
      identifierToFiles.set(token, current);
    }
    if (!declarationImports.has(fromPathLower)) {
      declarationImports.set(fromPathLower, localImports);
    }
  }
  const fingerprint = hashContentFNV(
    `${index.rootPath}::${index.updatedAt}::${String(index.fileCount)}::${String(index.symbolCount)}::${String(index.edgeCount)}`,
  );
  return {
    fingerprint,
    edges,
    pathSet,
    displayPathByLower,
    forward,
    reverse,
    declarations,
    declarationImports,
    identifierToFiles,
  };
}

export function getRuntime(entry: PersistentGraphIndexEntry): PersistentGraphIndexRuntime {
  const nextFingerprint = hashContentFNV(
    `${entry.index.rootPath}::${entry.index.updatedAt}::${String(entry.index.fileCount)}::${String(entry.index.symbolCount)}::${String(entry.index.edgeCount)}`,
  );
  if (entry.runtime && entry.runtimeFingerprint === nextFingerprint) {
    return entry.runtime;
  }
  const runtime = buildRuntime(entry.index);
  entry.runtime = runtime;
  entry.runtimeFingerprint = nextFingerprint;
  return runtime;
}
