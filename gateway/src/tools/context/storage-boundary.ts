import { resolve } from "node:path";

export type ContextStorageDomain = "context" | "memory";

export type ContextStorageArtifact =
  | "graph_cache_window"
  | "prompt_quality_window"
  | "graph_quality_autotune_state"
  | "prompt_quality_guard_state"
  | "memory_decay_autotune_state"
  | "memory_strategy_autotune_state"
  | "graph_persistent_index"
  | "graph_persistent_index_window"
  | "lineage_diff_cache";

interface ContextStorageBoundaryDefinition {
  domain: ContextStorageDomain;
  primaryRelativePath: string;
  legacyReadRelativePaths?: readonly string[];
}

const CONTEXT_STORAGE_BOUNDARY: Record<ContextStorageArtifact, ContextStorageBoundaryDefinition> = {
  graph_cache_window: {
    domain: "context",
    primaryRelativePath: ".grobot/context/graph-cache-window.jsonl",
  },
  prompt_quality_window: {
    domain: "context",
    primaryRelativePath: ".grobot/context/prompt-quality-window.jsonl",
  },
  graph_quality_autotune_state: {
    domain: "memory",
    primaryRelativePath: ".grobot/memory/context-engine/graph-quality-autotune-state.json",
    legacyReadRelativePaths: [".grobot/context/graph-quality-autotune-state.json"],
  },
  prompt_quality_guard_state: {
    domain: "memory",
    primaryRelativePath: ".grobot/memory/context-engine/prompt-quality-guard-state.json",
    legacyReadRelativePaths: [".grobot/context/prompt-quality-guard-state.json"],
  },
  memory_decay_autotune_state: {
    domain: "memory",
    primaryRelativePath: ".grobot/memory/context-engine/memory-decay-autotune-state.json",
    legacyReadRelativePaths: [".grobot/context/memory-decay-autotune-state.json"],
  },
  memory_strategy_autotune_state: {
    domain: "memory",
    primaryRelativePath: ".grobot/memory/context-engine/memory-strategy-autotune-state.json",
    legacyReadRelativePaths: [".grobot/context/memory-strategy-autotune-state.json"],
  },
  graph_persistent_index: {
    domain: "memory",
    primaryRelativePath: ".grobot/memory/context-engine/graph-persistent-index.json",
    legacyReadRelativePaths: [".grobot/context/graph-persistent-index.json"],
  },
  graph_persistent_index_window: {
    domain: "memory",
    primaryRelativePath: ".grobot/memory/context-engine/graph-persistent-index-window.jsonl",
    legacyReadRelativePaths: [".grobot/context/graph-persistent-index-window.jsonl"],
  },
  lineage_diff_cache: {
    domain: "memory",
    primaryRelativePath: ".grobot/memory/context-engine/lineage-diff-cache.json",
    legacyReadRelativePaths: [".grobot/context/lineage-diff-cache.json"],
  },
};

export interface ResolvedContextStorageBoundary {
  artifact: ContextStorageArtifact;
  domain: ContextStorageDomain;
  primaryPath: string;
  readPaths: string[];
  legacyReadPaths: string[];
}

function normalizeWorkDir(workDir: string): string {
  const normalized = workDir.trim();
  if (!normalized) {
    return resolve(process.cwd());
  }
  return resolve(normalized);
}

function dedupePaths(paths: readonly string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    output.push(path);
  }
  return output;
}

export function resolveContextStorageBoundary(
  workDir: string,
  artifact: ContextStorageArtifact,
): ResolvedContextStorageBoundary {
  const root = normalizeWorkDir(workDir);
  const definition = CONTEXT_STORAGE_BOUNDARY[artifact];
  const primaryPath = resolve(root, definition.primaryRelativePath);
  const legacyReadPaths = (definition.legacyReadRelativePaths ?? []).map((relativePath) =>
    resolve(root, relativePath)
  );
  return {
    artifact,
    domain: definition.domain,
    primaryPath,
    readPaths: dedupePaths([primaryPath, ...legacyReadPaths]),
    legacyReadPaths: dedupePaths(legacyReadPaths),
  };
}

export function resolveContextStoragePath(workDir: string, artifact: ContextStorageArtifact): string {
  return resolveContextStorageBoundary(workDir, artifact).primaryPath;
}

export function resolveContextStorageReadPaths(
  workDir: string,
  artifact: ContextStorageArtifact,
): string[] {
  return resolveContextStorageBoundary(workDir, artifact).readPaths;
}

export function resolveContextStorageDomain(artifact: ContextStorageArtifact): ContextStorageDomain {
  return CONTEXT_STORAGE_BOUNDARY[artifact].domain;
}
