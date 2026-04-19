import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractTypeScriptAstDependencyTargets } from "./dependency-ts-ast";
import { extractTypeScriptAstSymbols, type AstSymbolDeclaration } from "./symbol-ts-ast";
import { hashContentFNV, normalizeQueryKey } from "./cache-utils";
import {
  resolveContextStoragePath,
  resolveContextStorageReadPaths,
} from "../storage-boundary";

type RefreshMode = "cold" | "incremental" | "steady" | "skipped";

interface PersistentGraphSymbolRecord {
  symbol: string;
  kind: string;
  line: number;
}

interface PersistentGraphFileRecord {
  path: string;
  hash: string;
  size: number;
  mtimeMs: number;
  imports: string[];
  symbols: PersistentGraphSymbolRecord[];
  identifiers: string[];
}

interface PersistentGraphIndexDisk {
  version: number;
  rootPath: string;
  updatedAt: string;
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
  files: PersistentGraphFileRecord[];
}

interface PersistentGraphIndexMemory {
  version: number;
  rootPath: string;
  updatedAt: string;
  files: Map<string, PersistentGraphFileRecord>;
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
}

interface PersistentGraphIndexRuntime {
  fingerprint: string;
  edges: PersistentDependencyEdge[];
  pathSet: Set<string>;
  displayPathByLower: Map<string, string>;
  forward: Map<string, Set<string>>;
  reverse: Map<string, Set<string>>;
  declarations: PersistentSymbolDeclaration[];
  declarationImports: Map<string, Set<string>>;
  identifierToFiles: Map<string, Set<string>>;
}

interface PersistentDependencyEdge {
  fromPath: string;
  target: string;
  targetIsLocal: boolean;
}

interface PersistentSymbolDeclaration {
  symbol: string;
  kind: string;
  filePath: string;
  line: number;
}

interface PersistentGraphQueryCacheEntry {
  expiresAtMs: number;
  fingerprint: string;
  rows: string[];
}

interface PersistentGraphRefreshStats {
  mode: RefreshMode;
  refreshedAtIso: string;
  scannedFiles: number;
  parsedFiles: number;
  reusedFiles: number;
  removedFiles: number;
}

interface PersistentGraphWindowEntry {
  ts: string;
  rootPath: string;
  mode: RefreshMode;
  scannedFiles: number;
  parsedFiles: number;
  reusedFiles: number;
  removedFiles: number;
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
}

interface PersistentGraphWindowSummary {
  path: string;
  configuredSize: number;
  entries: number;
  fromTs: string | null;
  toTs: string | null;
  modeCounts: Record<RefreshMode, number>;
  totals: {
    scannedFiles: number;
    parsedFiles: number;
    reusedFiles: number;
    removedFiles: number;
  };
  rates: {
    parsedPerScanned: number | null;
    reusedPerScanned: number | null;
    removedPerScanned: number | null;
  };
  latest: {
    mode: RefreshMode;
    scannedFiles: number;
    parsedFiles: number;
    reusedFiles: number;
    removedFiles: number;
    fileCount: number;
    symbolCount: number;
    edgeCount: number;
  } | null;
}

interface SafeFileStats {
  size: number;
  mtimeMs: number;
  isFile: boolean;
}

interface PersistentGraphIndexEntry {
  index: PersistentGraphIndexMemory;
  runtime?: PersistentGraphIndexRuntime;
  runtimeFingerprint: string;
  lastRefreshAtMs: number;
  lastRefreshStats: PersistentGraphRefreshStats;
  dependencyQueryCache: Map<string, PersistentGraphQueryCacheEntry>;
  symbolQueryCache: Map<string, PersistentGraphQueryCacheEntry>;
}

const INDEX_VERSION = 1;
const REFRESH_MIN_INTERVAL_MS = 1_200;
const QUERY_CACHE_TTL_MS = 2_000;
const MAX_QUERY_CACHE_ENTRIES = 256;
const MAX_IMPORTS_PER_FILE = 180;
const MAX_SYMBOLS_PER_FILE = 300;
const MAX_IDENTIFIERS_PER_FILE = 480;
const MAX_IDENTIFIER_OCCURRENCES = 1_200;
const MAX_PATH_SCAN_BUFFER = 16_000_000;
const MAX_FILE_BYTES = 1_800_000;
const MAX_QUERY_ROWS = 140;
const DEFAULT_WINDOW_SIZE = 20;
const MAX_WINDOW_SIZE = 200;
const MAX_WINDOW_LOG_ROWS = 2_000;

const CODE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".swift",
  ".php",
];

const STOP_IDENTIFIERS = new Set([
  "const",
  "let",
  "var",
  "function",
  "class",
  "interface",
  "type",
  "enum",
  "async",
  "await",
  "return",
  "import",
  "export",
  "default",
  "from",
  "if",
  "else",
  "for",
  "while",
  "switch",
  "case",
  "break",
  "continue",
  "try",
  "catch",
  "finally",
  "public",
  "private",
  "protected",
  "static",
  "null",
  "true",
  "false",
  "this",
  "super",
  "new",
  "void",
  "int",
  "string",
  "boolean",
  "number",
  "object",
]);

const graphIndexByRoot = new Map<string, PersistentGraphIndexEntry>();

function clampInteger(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < min) {
    return min;
  }
  if (normalized > max) {
    return max;
  }
  return normalized;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizePath(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
}

function normalizePathLower(raw: string): string {
  return normalizePath(raw).toLowerCase();
}

function hasCodeExtension(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase();
  return CODE_EXTENSIONS.some((ext) => normalized.endsWith(ext));
}

function getDirPath(filePath: string): string {
  const normalized = normalizePath(filePath);
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function runGitCommand(cwd: string, args: readonly string[]): string | undefined {
  const run = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 4_500,
    maxBuffer: MAX_PATH_SCAN_BUFFER,
  });
  if (run.error || run.status !== 0) {
    return undefined;
  }
  return String(run.stdout ?? "");
}

function resolveGitRoot(workDir: string): string | undefined {
  const output = runGitCommand(workDir, ["rev-parse", "--show-toplevel"]);
  if (!output) {
    return undefined;
  }
  const line = output.split(/\r?\n/)[0] ?? "";
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }
  return resolve(trimmed);
}

function resolveGitRootForContext(workDir?: string): string | undefined {
  const candidates = [
    resolve(workDir ?? process.cwd()),
    resolve(process.cwd()),
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    const root = resolveGitRoot(candidate);
    if (root) {
      return root;
    }
  }
  return undefined;
}

function parseNullSeparatedRows(raw: string): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split("\u0000")
    .map((item) => normalizePath(item))
    .filter((item) => item.length > 0);
}

function collectRepositoryCodePaths(rootPath: string): string[] {
  const output = runGitCommand(rootPath, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--full-name"]);
  if (!output) {
    return [];
  }
  const dedup = new Set<string>();
  for (const path of parseNullSeparatedRows(output)) {
    if (!hasCodeExtension(path)) {
      continue;
    }
    dedup.add(path);
  }
  return Array.from(dedup).sort((left, right) => left.localeCompare(right));
}

function dedupeStrings(rows: readonly string[], cap = 240): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const normalized = raw.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
    if (output.length >= cap) {
      break;
    }
  }
  return output;
}

function dedupeSymbols(rows: readonly PersistentGraphSymbolRecord[]): PersistentGraphSymbolRecord[] {
  const output: PersistentGraphSymbolRecord[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const symbol = row.symbol.trim();
    if (!symbol) {
      continue;
    }
    const line = clampInteger(row.line, 1, 1, 999_999);
    const key = `${row.kind.toLowerCase()}::${symbol.toLowerCase()}::${String(line)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push({
      symbol,
      kind: row.kind.trim() || "symbol",
      line,
    });
    if (output.length >= MAX_SYMBOLS_PER_FILE) {
      break;
    }
  }
  return output;
}

function addRegexSymbolRows(
  rows: PersistentGraphSymbolRecord[],
  content: string,
  regex: RegExp,
  kind: string,
): void {
  let match: RegExpExecArray | null = regex.exec(content);
  while (match) {
    const symbolRaw = String(match[1] ?? "").trim();
    const symbol = symbolRaw.replace(/[^A-Za-z0-9_$]/g, "");
    if (symbol.length >= 2) {
      const before = content.slice(0, match.index);
      const line = before.split("\n").length;
      rows.push({
        symbol,
        kind,
        line,
      });
    }
    match = regex.exec(content);
  }
}

function extractRegexSymbolDeclarations(content: string): PersistentGraphSymbolRecord[] {
  const rows: PersistentGraphSymbolRecord[] = [];
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g, "fn");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*(?:export\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/g, "class");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*(?:export\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/g, "interface");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*(?:export\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/g, "type");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g, "const-fn");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g, "fn");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|:)/g, "class");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g, "fn");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*(?:pub\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)\b/g, "struct");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*(?:pub\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)\b/g, "enum");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*(?:pub\s+)?trait\s+([A-Za-z_][A-Za-z0-9_]*)\b/g, "trait");
  addRegexSymbolRows(rows, content, /(?:^|\n)\s*func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g, "fn");
  return dedupeSymbols(rows);
}

function extractSymbols(filePath: string, content: string): PersistentGraphSymbolRecord[] {
  const astRows = extractTypeScriptAstSymbols(filePath, content).map((row: AstSymbolDeclaration) => ({
    symbol: row.symbol,
    kind: row.kind,
    line: row.line,
  }));
  if (astRows.length > 0) {
    return dedupeSymbols(astRows);
  }
  return extractRegexSymbolDeclarations(content);
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
  return dedupeStrings(rows, MAX_IMPORTS_PER_FILE);
}

function extractImports(filePath: string, content: string): string[] {
  const astTargets = extractTypeScriptAstDependencyTargets(filePath, content);
  if (astTargets.length > 0) {
    return dedupeStrings(astTargets, MAX_IMPORTS_PER_FILE);
  }
  return extractRegexImports(content);
}

function extractIdentifierHints(content: string): string[] {
  const counts = new Map<string, number>();
  const regex = /\b[A-Za-z_][A-Za-z0-9_$]{1,63}\b/g;
  let match: RegExpExecArray | null = regex.exec(content);
  let observed = 0;
  while (match) {
    const raw = String(match[0] ?? "").trim();
    const token = raw.toLowerCase();
    if (!token || STOP_IDENTIFIERS.has(token)) {
      match = regex.exec(content);
      continue;
    }
    observed += 1;
    counts.set(token, (counts.get(token) ?? 0) + 1);
    if (observed >= MAX_IDENTIFIER_OCCURRENCES) {
      break;
    }
    match = regex.exec(content);
  }
  return Array.from(counts.entries())
    .sort((left, right) => {
      if (left[1] !== right[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, MAX_IDENTIFIERS_PER_FILE)
    .map((item) => item[0]);
}

function readIndexPath(rootPath: string): string {
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

function readParentDir(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
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

function loadPersistedIndex(rootPath: string): PersistentGraphIndexMemory | undefined {
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

function persistIndex(index: PersistentGraphIndexMemory): void {
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

function appendWindowEntry(rootPath: string, entry: PersistentGraphWindowEntry): void {
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

function readWindowSummary(rootPath: string, size?: number): PersistentGraphWindowSummary {
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

function parseCodeFile(rootPath: string, filePath: string): PersistentGraphFileRecord | undefined {
  const absolutePath = resolve(rootPath, filePath);
  if (!existsSync(absolutePath)) {
    return undefined;
  }
  const stats = readSafeFileStats(absolutePath);
  if (!stats || !stats.isFile) {
    return undefined;
  }
  if (stats.size > MAX_FILE_BYTES) {
    return undefined;
  }
  let content = "";
  try {
    content = readFileSync(absolutePath, "utf8");
  } catch {
    return undefined;
  }
  return {
    path: normalizePath(filePath),
    hash: hashContentFNV(content),
    size: Math.max(0, Math.floor(stats.size)),
    mtimeMs: Math.max(0, Math.floor(stats.mtimeMs)),
    imports: extractImports(filePath, content),
    symbols: extractSymbols(filePath, content),
    identifiers: extractIdentifierHints(content),
  };
}

function createEmptyIndex(rootPath: string): PersistentGraphIndexMemory {
  return {
    version: INDEX_VERSION,
    rootPath,
    updatedAt: nowIso(),
    files: new Map<string, PersistentGraphFileRecord>(),
    fileCount: 0,
    symbolCount: 0,
    edgeCount: 0,
  };
}

function readSafeFileStats(path: string): SafeFileStats | undefined {
  let raw: unknown;
  try {
    raw = statSync(path) as unknown;
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return undefined;
  }
  const stats = raw as {
    size?: unknown;
    mtimeMs?: unknown;
    isFile?: unknown;
  };
  const size = typeof stats.size === "number" && Number.isFinite(stats.size)
    ? Math.max(0, Math.floor(stats.size))
    : 0;
  const mtimeMs = typeof stats.mtimeMs === "number" && Number.isFinite(stats.mtimeMs)
    ? Math.max(0, Math.floor(stats.mtimeMs))
    : 0;
  const isFile = typeof stats.isFile === "function"
    ? Boolean((stats.isFile as () => unknown).call(stats))
    : true;
  return {
    size,
    mtimeMs,
    isFile,
  };
}

function buildDefaultRefreshStats(mode: RefreshMode): PersistentGraphRefreshStats {
  return {
    mode,
    refreshedAtIso: nowIso(),
    scannedFiles: 0,
    parsedFiles: 0,
    reusedFiles: 0,
    removedFiles: 0,
  };
}

function setEntryIndex(entry: PersistentGraphIndexEntry, nextIndex: PersistentGraphIndexMemory): void {
  entry.index = nextIndex;
  entry.runtime = undefined;
  entry.runtimeFingerprint = "";
  entry.dependencyQueryCache.clear();
  entry.symbolQueryCache.clear();
}

function refreshPersistentIndex(rootPath: string, forceRefresh: boolean): PersistentGraphIndexEntry {
  const existing = graphIndexByRoot.get(rootPath);
  if (!existing) {
    const loaded = loadPersistedIndex(rootPath) ?? createEmptyIndex(rootPath);
    const created: PersistentGraphIndexEntry = {
      index: loaded,
      runtimeFingerprint: "",
      lastRefreshAtMs: 0,
      lastRefreshStats: buildDefaultRefreshStats("cold"),
      dependencyQueryCache: new Map<string, PersistentGraphQueryCacheEntry>(),
      symbolQueryCache: new Map<string, PersistentGraphQueryCacheEntry>(),
    };
    graphIndexByRoot.set(rootPath, created);
  }
  const entry = graphIndexByRoot.get(rootPath) as PersistentGraphIndexEntry;
  const nowMs = Date.now();
  if (!forceRefresh && nowMs - entry.lastRefreshAtMs < REFRESH_MIN_INTERVAL_MS) {
    entry.lastRefreshStats = {
      ...entry.lastRefreshStats,
      mode: "skipped",
      refreshedAtIso: nowIso(),
    };
    return entry;
  }
  const previousRows = entry.index.files;
  const codePaths = collectRepositoryCodePaths(rootPath);
  const seen = new Set<string>();
  const nextRows = new Map<string, PersistentGraphFileRecord>();
  let parsedFiles = 0;
  let reusedFiles = 0;
  for (const codePath of codePaths) {
    const normalizedPath = normalizePath(codePath);
    const key = normalizePathLower(normalizedPath);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const absolutePath = resolve(rootPath, normalizedPath);
    if (!existsSync(absolutePath)) {
      continue;
    }
    const stats = readSafeFileStats(absolutePath);
    if (!stats || !stats.isFile) {
      continue;
    }
    const size = stats.size;
    const mtimeMs = stats.mtimeMs;
    const previous = previousRows.get(key);
    if (previous && previous.size === size && previous.mtimeMs === mtimeMs) {
      nextRows.set(key, previous);
      reusedFiles += 1;
      continue;
    }
    const parsed = parseCodeFile(rootPath, normalizedPath);
    if (parsed) {
      nextRows.set(key, parsed);
      parsedFiles += 1;
      continue;
    }
    if (previous) {
      nextRows.set(key, previous);
      reusedFiles += 1;
    }
  }
  const removedFiles = Math.max(0, previousRows.size - reusedFiles - parsedFiles);
  const allRows = Array.from(nextRows.values());
  const nextIndex: PersistentGraphIndexMemory = {
    version: INDEX_VERSION,
    rootPath,
    updatedAt: nowIso(),
    files: nextRows,
    fileCount: allRows.length,
    symbolCount: allRows.reduce((acc, row) => acc + row.symbols.length, 0),
    edgeCount: allRows.reduce((acc, row) => acc + row.imports.length, 0),
  };
  const hadPreviousRows = previousRows.size > 0;
  const hasDelta = parsedFiles > 0 || removedFiles > 0 || nextRows.size !== previousRows.size;
  const mode: RefreshMode = !hadPreviousRows ? "cold" : hasDelta ? "incremental" : "steady";
  setEntryIndex(entry, nextIndex);
  entry.lastRefreshAtMs = nowMs;
  entry.lastRefreshStats = {
    mode,
    refreshedAtIso: nowIso(),
    scannedFiles: codePaths.length,
    parsedFiles,
    reusedFiles,
    removedFiles,
  };
  appendWindowEntry(rootPath, {
    ts: entry.lastRefreshStats.refreshedAtIso,
    rootPath,
    mode,
    scannedFiles: codePaths.length,
    parsedFiles,
    reusedFiles,
    removedFiles,
    fileCount: nextIndex.fileCount,
    symbolCount: nextIndex.symbolCount,
    edgeCount: nextIndex.edgeCount,
  });
  if (hasDelta || !hadPreviousRows) {
    persistIndex(nextIndex);
  }
  return entry;
}

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

function toPathCluster(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split("/").filter((item) => item.length > 0);
  if (parts.length <= 1) {
    return normalized || "__root__";
  }
  return `${parts[0]}/${parts[1]}`;
}

function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function tokenizeIdentifier(raw: string): string[] {
  const compact = raw.trim();
  if (!compact) {
    return [];
  }
  const spaced = compact.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const merged = [...tokenize(compact), ...tokenize(spaced)];
  return Array.from(new Set(merged));
}

function countPathTokenMatches(path: string, queryTokens: ReadonlySet<string>): number {
  if (queryTokens.size === 0) {
    return 0;
  }
  const pathTokens = new Set(tokenize(path));
  let matched = 0;
  for (const token of queryTokens) {
    if (pathTokens.has(token)) {
      matched += 1;
    }
  }
  return matched;
}

function scoreDependencyEdge(queryTokens: ReadonlySet<string>, fromPath: string, target: string, local: boolean): number {
  let score = 1;
  const tokens = new Set([...tokenize(fromPath), ...tokenize(target)]);
  for (const token of queryTokens) {
    if (tokens.has(token)) {
      score += 2;
    }
  }
  if (target.startsWith(".")) {
    score += 1;
  }
  if (target.includes("/") && /\.[A-Za-z0-9_]+$/.test(target)) {
    score += 1;
  }
  if (local) {
    score += 1.4;
  }
  return score;
}

function shouldPreferDeepChains(queryTokens: ReadonlySet<string>): boolean {
  if (queryTokens.size === 0) {
    return false;
  }
  const deepTokens = new Set([
    "trace",
    "chain",
    "call",
    "flow",
    "pipeline",
    "path",
    "route",
    "link",
    "lineage",
    "dependency",
    "依赖",
    "链路",
    "调用",
    "路径",
    "追踪",
  ]);
  for (const token of queryTokens) {
    if (deepTokens.has(token)) {
      return true;
    }
  }
  return false;
}

function dedupeRows(rows: readonly string[], cap: number): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const normalized = raw.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= cap) {
      break;
    }
  }
  return output;
}

function extractPathHints(raw: string): string[] {
  const matches = raw.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9_]+(?::\d+)?/g) ?? [];
  return dedupeRows(matches.map((item) => normalizePath(item).replace(/:(\d+)(?::\d+)?$/, "")), 12);
}

function isPathOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizePathLower(left);
  const normalizedRight = normalizePathLower(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  return normalizedLeft.startsWith(`${normalizedRight}/`) || normalizedRight.startsWith(`${normalizedLeft}/`);
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

function getRuntime(entry: PersistentGraphIndexEntry): PersistentGraphIndexRuntime {
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

function readQueryCacheRows(
  cache: Map<string, PersistentGraphQueryCacheEntry>,
  key: string,
  fingerprint: string,
): string[] | undefined {
  const cached = cache.get(key);
  if (!cached) {
    return undefined;
  }
  if (cached.expiresAtMs <= Date.now() || cached.fingerprint !== fingerprint) {
    cache.delete(key);
    return undefined;
  }
  return cached.rows.slice();
}

function writeQueryCacheRows(
  cache: Map<string, PersistentGraphQueryCacheEntry>,
  key: string,
  fingerprint: string,
  rows: readonly string[],
): void {
  const deduped = dedupeRows(rows, MAX_QUERY_ROWS);
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, {
    expiresAtMs: Date.now() + QUERY_CACHE_TTL_MS,
    fingerprint,
    rows: deduped,
  });
  while (cache.size > MAX_QUERY_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) {
      break;
    }
    cache.delete(oldest);
  }
}

function collectSeedPaths(args: {
  queryTokens: ReadonlySet<string>;
  allPaths: readonly string[];
  rankedDirect: ReadonlyArray<{ fromPath: string; target: string; score: number; targetIsLocal: boolean }>;
}): string[] {
  const scores = new Map<string, number>();
  const add = (path: string, delta: number): void => {
    if (!path) {
      return;
    }
    scores.set(path, (scores.get(path) ?? 0) + delta);
  };
  for (const path of args.allPaths) {
    const pathScore = countPathTokenMatches(path, args.queryTokens);
    if (pathScore > 0) {
      add(path, 2 + pathScore * 1.15);
    }
  }
  for (const row of args.rankedDirect) {
    add(row.fromPath, row.score * 0.65);
    if (row.targetIsLocal) {
      add(row.target, row.score * 0.7);
    }
  }
  return Array.from(scores.entries())
    .sort((left, right) => {
      if (left[1] !== right[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, 14)
    .map((item) => item[0]);
}

function buildMultiHopDependencyRows(args: {
  queryTokens: ReadonlySet<string>;
  seeds: readonly string[];
  forward: ReadonlyMap<string, ReadonlySet<string>>;
  reverse: ReadonlyMap<string, ReadonlySet<string>>;
  changedPathSet: ReadonlySet<string>;
}): Array<{ line: string; score: number }> {
  const maxDepth = shouldPreferDeepChains(args.queryTokens) ? 4 : 3;
  const maxBranchesPerStep = 4;
  const maxRows = MAX_QUERY_ROWS * 4;
  const degree = new Map<string, number>();
  for (const [path, targets] of args.forward.entries()) {
    degree.set(path, (degree.get(path) ?? 0) + targets.size);
    for (const target of targets) {
      degree.set(target, (degree.get(target) ?? 0) + 1);
    }
  }
  for (const [path, sources] of args.reverse.entries()) {
    degree.set(path, (degree.get(path) ?? 0) + sources.size);
    for (const source of sources) {
      degree.set(source, (degree.get(source) ?? 0) + 1);
    }
  }
  const rows: Array<{ line: string; score: number }> = [];
  const seen = new Set<string>();
  const scoreChain = (nodes: readonly string[]): number => {
    const uniqueNodes = Array.from(new Set(nodes));
    let score = 1 + Math.max(0, nodes.length - 1) * 0.9;
    let tokenHits = 0;
    for (const node of uniqueNodes) {
      tokenHits += countPathTokenMatches(node, args.queryTokens);
    }
    score += Math.min(4, tokenHits * 1.2);
    let changedHits = 0;
    for (const node of uniqueNodes) {
      if (args.changedPathSet.has(normalizePathLower(node))) {
        changedHits += 1;
      }
    }
    score += Math.min(3.8, changedHits * 1.3);
    const bridgeNodes = uniqueNodes.slice(1, Math.max(1, uniqueNodes.length - 1));
    const centrality = bridgeNodes.reduce((acc, node) => acc + (degree.get(node) ?? 0), 0);
    score += Math.min(3.1, centrality * 0.25);
    if (uniqueNodes.length >= 4) {
      score += 0.9;
    }
    return score;
  };
  const sortByPriority = (nodes: readonly string[]): string[] =>
    [...nodes].sort((left, right) => {
      const leftToken = countPathTokenMatches(left, args.queryTokens);
      const rightToken = countPathTokenMatches(right, args.queryTokens);
      if (leftToken !== rightToken) {
        return rightToken - leftToken;
      }
      const leftChanged = args.changedPathSet.has(normalizePathLower(left)) ? 1 : 0;
      const rightChanged = args.changedPathSet.has(normalizePathLower(right)) ? 1 : 0;
      if (leftChanged !== rightChanged) {
        return rightChanged - leftChanged;
      }
      const leftDegree = degree.get(left) ?? 0;
      const rightDegree = degree.get(right) ?? 0;
      if (leftDegree !== rightDegree) {
        return rightDegree - leftDegree;
      }
      return left.localeCompare(right);
    });
  const pushChain = (nodes: readonly string[]): boolean => {
    if (nodes.length < 2) {
      return false;
    }
    if (new Set(nodes).size !== nodes.length) {
      return false;
    }
    const line = nodes.join(" -> ");
    if (seen.has(line)) {
      return false;
    }
    seen.add(line);
    rows.push({
      line,
      score: scoreChain(nodes),
    });
    return rows.length >= maxRows;
  };
  const collectForwardChains = (seed: string): string[][] => {
    const output: string[][] = [];
    const walk = (path: string[]): void => {
      if (path.length >= 2) {
        output.push([...path]);
      }
      if (path.length >= maxDepth || output.length >= maxRows) {
        return;
      }
      const current = path[path.length - 1];
      if (!current) {
        return;
      }
      const neighbors = sortByPriority(Array.from(args.forward.get(current) ?? []))
        .filter((next) => !path.includes(next))
        .slice(0, maxBranchesPerStep);
      for (const next of neighbors) {
        walk([...path, next]);
      }
    };
    walk([seed]);
    return output;
  };
  for (const seed of args.seeds) {
    const forwardChains = collectForwardChains(seed);
    for (const chain of forwardChains) {
      if (pushChain(chain)) {
        break;
      }
    }
    if (rows.length >= maxRows) {
      break;
    }
    const reverseLevel1 = sortByPriority(Array.from(args.reverse.get(seed) ?? []))
      .slice(0, maxBranchesPerStep);
    for (const source of reverseLevel1) {
      if (pushChain([source, seed])) {
        break;
      }
      for (const chain of forwardChains) {
        if (chain.includes(source)) {
          continue;
        }
        const merged = [source, ...chain].slice(0, maxDepth);
        if (pushChain(merged)) {
          break;
        }
      }
      if (rows.length >= maxRows) {
        break;
      }
    }
    if (rows.length >= maxRows) {
      break;
    }
  }
  return rows
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.line.localeCompare(right.line);
    })
    .slice(0, MAX_QUERY_ROWS);
}

function ensureIndexEntry(workDir?: string, forceRefresh = false): PersistentGraphIndexEntry | undefined {
  const rootPath = resolveGitRootForContext(workDir);
  if (!rootPath) {
    return undefined;
  }
  return refreshPersistentIndex(rootPath, forceRefresh);
}

function resolveIndexEntryForStatus(workDir?: string, forceRefresh = false): PersistentGraphIndexEntry | undefined {
  const rootPath = resolveGitRootForContext(workDir);
  if (!rootPath) {
    return undefined;
  }
  if (forceRefresh) {
    return refreshPersistentIndex(rootPath, true);
  }
  const existing = graphIndexByRoot.get(rootPath);
  if (existing) {
    return existing;
  }
  return refreshPersistentIndex(rootPath, true);
}

export function queryPersistentDependencyHints(
  query: string,
  options: {
    workDir?: string;
    maxRows?: number;
    forceRefresh?: boolean;
  } = {},
): string[] {
  const maxRows = clampInteger(options.maxRows ?? 4, 4, 1, 24);
  const entry = ensureIndexEntry(options.workDir, options.forceRefresh === true);
  if (!entry) {
    return [];
  }
  const runtime = getRuntime(entry);
  if (runtime.edges.length === 0) {
    return [];
  }
  const queryKey = normalizeQueryKey(query);
  const cacheKey = `${entry.index.rootPath}::${queryKey}`;
  const cachedRows = readQueryCacheRows(entry.dependencyQueryCache, cacheKey, runtime.fingerprint);
  if (cachedRows) {
    return cachedRows.slice(0, maxRows);
  }
  const queryTokens = new Set(tokenize(query));
  const rankedDirect = runtime.edges
    .map((edge) => ({
      ...edge,
      score: scoreDependencyEdge(queryTokens, edge.fromPath, edge.target, edge.targetIsLocal),
    }))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      const leftKey = `${left.fromPath}->${left.target}`;
      const rightKey = `${right.fromPath}->${right.target}`;
      return leftKey.localeCompare(rightKey);
    });
  const directRows = rankedDirect.map((edge) => ({
    line: `${edge.fromPath} -> ${edge.target}`,
    score: edge.score,
  }));
  const seedPaths = collectSeedPaths({
    queryTokens,
    allPaths: Array.from(runtime.displayPathByLower.values()),
    rankedDirect,
  });
  const chainRows = buildMultiHopDependencyRows({
    queryTokens,
    seeds: seedPaths,
    forward: runtime.forward,
    reverse: runtime.reverse,
    changedPathSet: runtime.pathSet,
  });
  const merged = [...chainRows, ...directRows]
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.line.localeCompare(right.line);
    })
    .map((row) => row.line);
  const deduped = dedupeRows(merged, MAX_QUERY_ROWS);
  writeQueryCacheRows(entry.dependencyQueryCache, cacheKey, runtime.fingerprint, deduped);
  return deduped.slice(0, maxRows);
}

function rankPersistentSymbolRow(args: {
  declaration: PersistentSymbolDeclaration;
  references: string[];
  query: string;
  queryTokens: ReadonlySet<string>;
  queryPathHints: readonly string[];
  declarationImports: ReadonlySet<string>;
  reverseImports: ReadonlyMap<string, ReadonlySet<string>>;
}): { score: number; line: string } {
  const declaration = args.declaration;
  const symbolTokens = new Set(tokenizeIdentifier(declaration.symbol));
  const pathTokens = new Set(tokenize(declaration.filePath));
  const normalizedQuery = args.query.toLowerCase();
  let score = 1;
  if (normalizedQuery.includes(declaration.symbol.toLowerCase())) {
    score += 5;
  }
  for (const token of args.queryTokens) {
    if (symbolTokens.has(token)) {
      score += 2;
      continue;
    }
    if (pathTokens.has(token)) {
      score += 1;
    }
  }
  for (const pathHint of args.queryPathHints) {
    if (isPathOverlap(pathHint, declaration.filePath)) {
      score += 2.2;
      break;
    }
  }
  let bridge = 0;
  const breadthClusters = new Set<string>();
  const refsPreview: string[] = [];
  for (const path of args.references) {
    breadthClusters.add(toPathCluster(path));
    const reverse = args.reverseImports.get(path) ?? new Set<string>();
    if (args.declarationImports.has(path) || reverse.has(declaration.filePath)) {
      bridge += 1;
    }
    if (refsPreview.length < 2) {
      refsPreview.push(`${path}(1)`);
    }
  }
  const refCount = args.references.length;
  score += Math.min(4, refCount * 0.45);
  score += Math.min(3.8, bridge * 1.15);
  score += Math.min(2.8, breadthClusters.size * 0.75);
  const suffix = refsPreview.length > 0 ? ` -> ${refsPreview.join(", ")}` : "";
  return {
    score,
    line: `${declaration.kind} ${declaration.symbol} @ ${declaration.filePath}:${String(declaration.line)} refs=${String(refCount)} bridge=${String(bridge)} breadth=${String(breadthClusters.size)}${suffix}`,
  };
}

export function queryPersistentSymbolHints(
  query: string,
  options: {
    workDir?: string;
    maxRows?: number;
    forceRefresh?: boolean;
  } = {},
): string[] {
  const maxRows = clampInteger(options.maxRows ?? 4, 4, 1, 24);
  const entry = ensureIndexEntry(options.workDir, options.forceRefresh === true);
  if (!entry) {
    return [];
  }
  const runtime = getRuntime(entry);
  if (runtime.declarations.length === 0) {
    return [];
  }
  const queryKey = normalizeQueryKey(query);
  const cacheKey = `${entry.index.rootPath}::${queryKey}`;
  const cachedRows = readQueryCacheRows(entry.symbolQueryCache, cacheKey, runtime.fingerprint);
  if (cachedRows) {
    return cachedRows.slice(0, maxRows);
  }
  const queryTokens = new Set(tokenize(query));
  const queryPathHints = extractPathHints(query);
  const ranked = runtime.declarations
    .map((declaration) => {
      const references = Array.from(runtime.identifierToFiles.get(declaration.symbol.toLowerCase()) ?? [])
        .filter((path) => path !== declaration.filePath)
        .slice(0, 24);
      return rankPersistentSymbolRow({
        declaration,
        references,
        query,
        queryTokens,
        queryPathHints,
        declarationImports: runtime.declarationImports.get(declaration.filePath) ?? new Set<string>(),
        reverseImports: runtime.reverse,
      });
    })
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.line.localeCompare(right.line);
    })
    .map((row) => row.line);
  const deduped = dedupeRows(ranked, MAX_QUERY_ROWS);
  writeQueryCacheRows(entry.symbolQueryCache, cacheKey, runtime.fingerprint, deduped);
  return deduped.slice(0, maxRows);
}

export function readPersistentGraphIndexStatus(
  options: {
    workDir?: string;
    forceRefresh?: boolean;
    windowSize?: number;
  } = {},
): {
  enabled: boolean;
  root_path?: string;
  index_path?: string;
  version?: number;
  updated_at?: string;
  file_count?: number;
  symbol_count?: number;
  edge_count?: number;
  last_refresh?: {
    mode: RefreshMode;
    refreshed_at: string;
    scanned_files: number;
    parsed_files: number;
    reused_files: number;
    removed_files: number;
  };
  window?: {
    path: string;
    configured_size: number;
    entries: number;
    from_ts: string | null;
    to_ts: string | null;
    mode_counts: Record<RefreshMode, number>;
    totals: {
      scanned_files: number;
      parsed_files: number;
      reused_files: number;
      removed_files: number;
    };
    rates: {
      parsed_per_scanned: number | null;
      reused_per_scanned: number | null;
      removed_per_scanned: number | null;
    };
    latest: {
      mode: RefreshMode;
      scanned_files: number;
      parsed_files: number;
      reused_files: number;
      removed_files: number;
      file_count: number;
      symbol_count: number;
      edge_count: number;
    } | null;
  };
} {
  const entry = resolveIndexEntryForStatus(options.workDir, options.forceRefresh === true);
  if (!entry) {
    return { enabled: false };
  }
  const refresh = entry.lastRefreshStats;
  const window = readWindowSummary(entry.index.rootPath, options.windowSize);
  return {
    enabled: true,
    root_path: entry.index.rootPath,
    index_path: readIndexPath(entry.index.rootPath),
    version: entry.index.version,
    updated_at: entry.index.updatedAt,
    file_count: entry.index.fileCount,
    symbol_count: entry.index.symbolCount,
    edge_count: entry.index.edgeCount,
    last_refresh: {
      mode: refresh.mode,
      refreshed_at: refresh.refreshedAtIso,
      scanned_files: refresh.scannedFiles,
      parsed_files: refresh.parsedFiles,
      reused_files: refresh.reusedFiles,
      removed_files: refresh.removedFiles,
    },
    window: {
      path: window.path,
      configured_size: window.configuredSize,
      entries: window.entries,
      from_ts: window.fromTs,
      to_ts: window.toTs,
      mode_counts: window.modeCounts,
      totals: {
        scanned_files: window.totals.scannedFiles,
        parsed_files: window.totals.parsedFiles,
        reused_files: window.totals.reusedFiles,
        removed_files: window.totals.removedFiles,
      },
      rates: {
        parsed_per_scanned: window.rates.parsedPerScanned,
        reused_per_scanned: window.rates.reusedPerScanned,
        removed_per_scanned: window.rates.removedPerScanned,
      },
      latest: window.latest == null
        ? null
        : {
          mode: window.latest.mode,
          scanned_files: window.latest.scannedFiles,
          parsed_files: window.latest.parsedFiles,
          reused_files: window.latest.reusedFiles,
          removed_files: window.latest.removedFiles,
          file_count: window.latest.fileCount,
          symbol_count: window.latest.symbolCount,
          edge_count: window.latest.edgeCount,
        },
    },
  };
}

export function readPersistentGraphIndexWindowSummary(
  options: {
    workDir?: string;
    size?: number;
    forceRefresh?: boolean;
  } = {},
): {
  enabled: boolean;
  root_path?: string;
  path?: string;
  configured_size?: number;
  entries?: number;
  from_ts?: string | null;
  to_ts?: string | null;
  mode_counts?: Record<RefreshMode, number>;
  totals?: {
    scanned_files: number;
    parsed_files: number;
    reused_files: number;
    removed_files: number;
  };
  rates?: {
    parsed_per_scanned: number | null;
    reused_per_scanned: number | null;
    removed_per_scanned: number | null;
  };
  latest?: {
    mode: RefreshMode;
    scanned_files: number;
    parsed_files: number;
    reused_files: number;
    removed_files: number;
    file_count: number;
    symbol_count: number;
    edge_count: number;
  } | null;
} {
  const entry = resolveIndexEntryForStatus(options.workDir, options.forceRefresh === true);
  if (!entry) {
    return { enabled: false };
  }
  const window = readWindowSummary(entry.index.rootPath, options.size);
  return {
    enabled: true,
    root_path: entry.index.rootPath,
    path: window.path,
    configured_size: window.configuredSize,
    entries: window.entries,
    from_ts: window.fromTs,
    to_ts: window.toTs,
    mode_counts: window.modeCounts,
    totals: {
      scanned_files: window.totals.scannedFiles,
      parsed_files: window.totals.parsedFiles,
      reused_files: window.totals.reusedFiles,
      removed_files: window.totals.removedFiles,
    },
    rates: {
      parsed_per_scanned: window.rates.parsedPerScanned,
      reused_per_scanned: window.rates.reusedPerScanned,
      removed_per_scanned: window.rates.removedPerScanned,
    },
    latest: window.latest == null
      ? null
      : {
        mode: window.latest.mode,
        scanned_files: window.latest.scannedFiles,
        parsed_files: window.latest.parsedFiles,
        reused_files: window.latest.reusedFiles,
        removed_files: window.latest.removedFiles,
        file_count: window.latest.fileCount,
        symbol_count: window.latest.symbolCount,
        edge_count: window.latest.edgeCount,
      },
  };
}
