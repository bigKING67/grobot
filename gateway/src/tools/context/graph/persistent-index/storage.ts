import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  resolveContextStoragePath,
  resolveContextStorageReadPaths,
} from "../../storage-boundary";
import {
  DEFAULT_WINDOW_SIZE,
  INDEX_VERSION,
  MAX_IDENTIFIERS_PER_FILE,
  MAX_IMPORTS_PER_FILE,
  MAX_WINDOW_LOG_ROWS,
  MAX_WINDOW_SIZE,
  type PersistentGraphFileRecord,
  type PersistentGraphIndexDisk,
  type PersistentGraphIndexMemory,
  type PersistentGraphSymbolRecord,
  type PersistentGraphWindowEntry,
  type PersistentGraphWindowSummary,
  type RefreshMode,
} from "./contract";
import { dedupeSymbols } from "./extract";
import {
  clampInteger,
  dedupeStrings,
  normalizePath,
  normalizePathLower,
  nowIso,
  readParentDir,
} from "./utils";

export function readIndexPath(rootPath: string): string {
  return resolveContextStoragePath(rootPath, "graph_persistent_index");
}

function readWindowPath(rootPath: string): string {
  return resolveContextStoragePath(rootPath, "graph_persistent_index_window");
}

function readIndexReadPaths(rootPath: string): string[] {
  return resolveContextStorageReadPaths(rootPath, "graph_persistent_index");
}

function readWindowReadPaths(rootPath: string): string[] {
  return resolveContextStorageReadPaths(rootPath, "graph_persistent_index_window");
}

function sanitizeFileRecord(raw: unknown): PersistentGraphFileRecord | undefined {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return undefined;
  }
  const row = raw as Record<string, unknown>;
  const path = typeof row.path === "string" ? normalizePath(row.path) : "";
  if (!path) {
    return undefined;
  }
  const hash = typeof row.hash === "string" ? row.hash.trim() : "";
  const size = typeof row.size === "number" && Number.isFinite(row.size)
    ? Math.max(0, Math.floor(row.size))
    : 0;
  const mtimeMs = typeof row.mtimeMs === "number" && Number.isFinite(row.mtimeMs)
    ? Math.max(0, Math.floor(row.mtimeMs))
    : 0;
  const importsRaw = Array.isArray(row.imports) ? row.imports : [];
  const symbolsRaw = Array.isArray(row.symbols) ? row.symbols : [];
  const identifiersRaw = Array.isArray(row.identifiers) ? row.identifiers : [];
  const imports = dedupeStrings(
    importsRaw.filter((item): item is string => typeof item === "string").map((item) => normalizePath(item)),
    MAX_IMPORTS_PER_FILE,
  );
  const symbols = dedupeSymbols(symbolsRaw
    .map((item) => {
      if (typeof item !== "object" || item == null || Array.isArray(item)) {
        return undefined;
      }
      const symbolRow = item as Record<string, unknown>;
      const symbol = typeof symbolRow.symbol === "string" ? symbolRow.symbol.trim() : "";
      if (!symbol) {
        return undefined;
      }
      const kind = typeof symbolRow.kind === "string" ? symbolRow.kind.trim() : "symbol";
      const line = typeof symbolRow.line === "number" && Number.isFinite(symbolRow.line)
        ? Math.max(1, Math.floor(symbolRow.line))
        : 1;
      return {
        symbol,
        kind,
        line,
      };
    })
    .filter((item): item is PersistentGraphSymbolRecord => Boolean(item)));
  const identifiers = dedupeStrings(
    identifiersRaw
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.toLowerCase()),
    MAX_IDENTIFIERS_PER_FILE,
  );
  return {
    path,
    hash,
    size,
    mtimeMs,
    imports,
    symbols,
    identifiers,
  };
}

export function loadPersistedIndex(rootPath: string): PersistentGraphIndexMemory | undefined {
  const pathCandidates = readIndexReadPaths(rootPath);
  for (const path of pathCandidates) {
    if (!existsSync(path)) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
      continue;
    }
    const container = parsed as Record<string, unknown>;
    const rootFromDisk = typeof container.rootPath === "string" ? container.rootPath : "";
    if (!rootFromDisk || resolve(rootFromDisk) !== rootPath) {
      continue;
    }
    const rowsRaw = Array.isArray(container.files) ? container.files : [];
    const files = new Map<string, PersistentGraphFileRecord>();
    for (const rowRaw of rowsRaw) {
      const row = sanitizeFileRecord(rowRaw);
      if (!row) {
        continue;
      }
      files.set(normalizePathLower(row.path), row);
    }
    const allRows = Array.from(files.values());
    const symbolCount = allRows.reduce((acc, row) => acc + row.symbols.length, 0);
    const edgeCount = allRows.reduce((acc, row) => acc + row.imports.length, 0);
    return {
      version: INDEX_VERSION,
      rootPath,
      updatedAt: typeof container.updatedAt === "string" ? container.updatedAt : nowIso(),
      files,
      fileCount: allRows.length,
      symbolCount,
      edgeCount,
    };
  }
  return undefined;
}

export function persistIndex(index: PersistentGraphIndexMemory): void {
  const rows = Array.from(index.files.values())
    .sort((left, right) => left.path.localeCompare(right.path));
  const payload: PersistentGraphIndexDisk = {
    version: INDEX_VERSION,
    rootPath: index.rootPath,
    updatedAt: index.updatedAt,
    fileCount: rows.length,
    symbolCount: rows.reduce((acc, row) => acc + row.symbols.length, 0),
    edgeCount: rows.reduce((acc, row) => acc + row.imports.length, 0),
    files: rows,
  };
  const path = readIndexPath(index.rootPath);
  try {
    mkdirSync(readParentDir(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch {
    // best effort persistence only
  }
}

function parseWindowEntry(raw: string): PersistentGraphWindowEntry | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
    return undefined;
  }
  const row = parsed as Record<string, unknown>;
  const ts = typeof row.ts === "string" ? row.ts.trim() : "";
  const rootPath = typeof row.rootPath === "string" ? row.rootPath.trim() : "";
  const modeRaw = typeof row.mode === "string" ? row.mode.trim() : "";
  const mode: RefreshMode = modeRaw === "cold"
    || modeRaw === "incremental"
    || modeRaw === "steady"
    || modeRaw === "skipped"
    ? modeRaw
    : "steady";
  if (!ts || !rootPath) {
    return undefined;
  }
  const toInt = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.floor(value));
  };
  return {
    ts,
    rootPath,
    mode,
    scannedFiles: toInt(row.scannedFiles),
    parsedFiles: toInt(row.parsedFiles),
    reusedFiles: toInt(row.reusedFiles),
    removedFiles: toInt(row.removedFiles),
    fileCount: toInt(row.fileCount),
    symbolCount: toInt(row.symbolCount),
    edgeCount: toInt(row.edgeCount),
  };
}

export function appendWindowEntry(rootPath: string, entry: PersistentGraphWindowEntry): void {
  const path = readWindowPath(rootPath);
  const fallbackPath = readWindowReadPaths(rootPath).find((candidate) => existsSync(candidate));
  const readPath = existsSync(path) ? path : (fallbackPath ?? path);
  let rows = "";
  if (existsSync(readPath)) {
    try {
      rows = readFileSync(readPath, "utf8");
    } catch {
      rows = "";
    }
  }
  const parsedRows = rows
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter((row) => row.length > 0)
    .slice(-Math.max(0, MAX_WINDOW_LOG_ROWS - 1));
  parsedRows.push(JSON.stringify(entry));
  try {
    mkdirSync(readParentDir(path), { recursive: true });
    writeFileSync(path, `${parsedRows.join("\n")}\n`, "utf8");
  } catch {
    // best effort persistence only
  }
}

export function readWindowSummary(rootPath: string, size?: number): PersistentGraphWindowSummary {
  const configuredSize = clampInteger(
    size ?? DEFAULT_WINDOW_SIZE,
    DEFAULT_WINDOW_SIZE,
    1,
    MAX_WINDOW_SIZE,
  );
  const defaultPath = readWindowPath(rootPath);
  const path = readWindowReadPaths(rootPath).find((candidate) => existsSync(candidate)) ?? defaultPath;
  if (!existsSync(path)) {
    return {
      path,
      configuredSize,
      entries: 0,
      fromTs: null,
      toTs: null,
      modeCounts: {
        cold: 0,
        incremental: 0,
        steady: 0,
        skipped: 0,
      },
      totals: {
        scannedFiles: 0,
        parsedFiles: 0,
        reusedFiles: 0,
        removedFiles: 0,
      },
      rates: {
        parsedPerScanned: null,
        reusedPerScanned: null,
        removedPerScanned: null,
      },
      latest: null,
    };
  }
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    raw = "";
  }
  const entries = raw
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter((row) => row.length > 0)
    .map(parseWindowEntry)
    .filter((row): row is PersistentGraphWindowEntry => Boolean(row))
    .filter((row) => resolve(row.rootPath) === rootPath)
    .slice(-configuredSize);
  const modeCounts: Record<RefreshMode, number> = {
    cold: 0,
    incremental: 0,
    steady: 0,
    skipped: 0,
  };
  let scannedFiles = 0;
  let parsedFiles = 0;
  let reusedFiles = 0;
  let removedFiles = 0;
  for (const row of entries) {
    modeCounts[row.mode] += 1;
    scannedFiles += row.scannedFiles;
    parsedFiles += row.parsedFiles;
    reusedFiles += row.reusedFiles;
    removedFiles += row.removedFiles;
  }
  const denominator = scannedFiles > 0 ? scannedFiles : 0;
  const latest = entries.length > 0 ? entries[entries.length - 1] ?? null : null;
  return {
    path,
    configuredSize,
    entries: entries.length,
    fromTs: entries.length > 0 ? entries[0]?.ts ?? null : null,
    toTs: entries.length > 0 ? entries[entries.length - 1]?.ts ?? null : null,
    modeCounts,
    totals: {
      scannedFiles,
      parsedFiles,
      reusedFiles,
      removedFiles,
    },
    rates: {
      parsedPerScanned: denominator > 0 ? parsedFiles / denominator : null,
      reusedPerScanned: denominator > 0 ? reusedFiles / denominator : null,
      removedPerScanned: denominator > 0 ? removedFiles / denominator : null,
    },
    latest: latest
      ? {
        mode: latest.mode,
        scannedFiles: latest.scannedFiles,
        parsedFiles: latest.parsedFiles,
        reusedFiles: latest.reusedFiles,
        removedFiles: latest.removedFiles,
        fileCount: latest.fileCount,
        symbolCount: latest.symbolCount,
        edgeCount: latest.edgeCount,
      }
      : null,
  };
}
