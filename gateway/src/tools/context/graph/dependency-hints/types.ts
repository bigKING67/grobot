import { type ChangedCodeSnapshot } from "../changed-code-snapshot";

export interface RetrieveDependencyHintsOptions {
  workDir?: string;
  maxRows?: number;
  changedCodeSnapshot?: ChangedCodeSnapshot;
}

export interface DependencyEdge {
  fromPath: string;
  target: string;
  score: number;
  targetIsLocal: boolean;
}

export interface DependencyQueryCacheEntry {
  expiresAtMs: number;
  snapshotFingerprint: string;
  rows: string[];
}

export interface ScoredDependencyRow {
  line: string;
  score: number;
}
