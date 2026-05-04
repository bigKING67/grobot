export type RefreshMode = "cold" | "incremental" | "steady" | "skipped";

export interface PersistentGraphSymbolRecord {
  symbol: string;
  kind: string;
  line: number;
}

export interface PersistentGraphFileRecord {
  path: string;
  hash: string;
  size: number;
  mtimeMs: number;
  imports: string[];
  symbols: PersistentGraphSymbolRecord[];
  identifiers: string[];
}

export interface PersistentGraphIndexDisk {
  version: number;
  rootPath: string;
  updatedAt: string;
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
  files: PersistentGraphFileRecord[];
}

export interface PersistentGraphIndexMemory {
  version: number;
  rootPath: string;
  updatedAt: string;
  files: Map<string, PersistentGraphFileRecord>;
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
}

export interface PersistentGraphIndexRuntime {
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

export interface PersistentDependencyEdge {
  fromPath: string;
  target: string;
  targetIsLocal: boolean;
}

export interface PersistentSymbolDeclaration {
  symbol: string;
  kind: string;
  filePath: string;
  line: number;
}

export interface PersistentGraphQueryCacheEntry {
  expiresAtMs: number;
  fingerprint: string;
  rows: string[];
}

export interface PersistentGraphRefreshStats {
  mode: RefreshMode;
  refreshedAtIso: string;
  scannedFiles: number;
  parsedFiles: number;
  reusedFiles: number;
  removedFiles: number;
}

export interface PersistentGraphWindowEntry {
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

export interface PersistentGraphWindowSummary {
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

export interface SafeFileStats {
  size: number;
  mtimeMs: number;
  isFile: boolean;
}

export interface PersistentGraphIndexEntry {
  index: PersistentGraphIndexMemory;
  runtime?: PersistentGraphIndexRuntime;
  runtimeFingerprint: string;
  lastRefreshAtMs: number;
  lastRefreshStats: PersistentGraphRefreshStats;
  dependencyQueryCache: Map<string, PersistentGraphQueryCacheEntry>;
  symbolQueryCache: Map<string, PersistentGraphQueryCacheEntry>;
}

export const INDEX_VERSION = 1;
export const REFRESH_MIN_INTERVAL_MS = 1_200;
export const QUERY_CACHE_TTL_MS = 2_000;
export const MAX_QUERY_CACHE_ENTRIES = 256;
export const MAX_IMPORTS_PER_FILE = 180;
export const MAX_SYMBOLS_PER_FILE = 300;
export const MAX_IDENTIFIERS_PER_FILE = 480;
export const MAX_IDENTIFIER_OCCURRENCES = 1_200;
export const MAX_PATH_SCAN_BUFFER = 16_000_000;
export const MAX_FILE_BYTES = 1_800_000;
export const MAX_QUERY_ROWS = 140;
export const DEFAULT_WINDOW_SIZE = 20;
export const MAX_WINDOW_SIZE = 200;
export const MAX_WINDOW_LOG_ROWS = 2_000;

export const CODE_EXTENSIONS = [
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
] as const;

export const STOP_IDENTIFIERS = new Set([
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
