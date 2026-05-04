export interface LineageSummaryRow {
  commitId: string;
  author?: string;
  timestamp?: string;
  summary: string;
}

export type LineageIntentTag =
  | "feature"
  | "fix"
  | "refactor"
  | "test"
  | "perf"
  | "docs"
  | "chore"
  | "security"
  | "deps"
  | "ci";

export interface LineageCommitRow {
  commitId: string;
  author: string;
  timestamp: string;
  rootPath: string;
  repoLabel: string;
  subject: string;
  files: string[];
  normalizedFiles: string[];
  insertions: number;
  deletions: number;
  fileChangeCount: number;
  subjectTokens: Set<string>;
  fileTokens: Set<string>;
  normalizedSubject: string;
  intentTags: Set<LineageIntentTag>;
}

export interface LineageCacheEntry {
  expiresAtMs: number;
  headCommit: string;
  rows: LineageCommitRow[];
}

export interface RetrieveLineageOptions {
  workDir?: string;
  maxCommits?: number;
  cacheTtlMs?: number;
}

export interface LineageDiffSemantic {
  tags: Set<LineageIntentTag>;
  tokens: Set<string>;
  normalizedFiles: Set<string>;
  summary: string;
}

export interface PersistedLineageDiffSemantic {
  commitId: string;
  tags: LineageIntentTag[];
  tokens: string[];
  files: string[];
  summary: string;
}

export const DEFAULT_MAX_COMMITS = 120;
export const DEFAULT_CACHE_TTL_MS = 30_000;
export const MAX_MAX_COMMITS = 500;
export const MIN_MAX_COMMITS = 20;
export const MIN_CACHE_TTL_MS = 1_000;
export const MAX_CACHE_TTL_MS = 600_000;
export const MAX_CROSS_REPO_ROOTS = 5;
export const MAX_DIFF_TOKEN_COUNT = 220;
export const MAX_DIFF_FILE_HINTS = 80;
export const MAX_PERSISTED_DIFF_ENTRIES = 3_500;
export const LOG_MARKER = "__GROBOT_COMMIT__";
export const LOG_FIELD_SEPARATOR = "\u001f";
