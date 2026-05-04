import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  resolveContextStoragePath,
  resolveContextStorageReadPaths,
} from "../../context/storage-boundary";
import type { MemoryOrchestratorPolicySnapshot } from "../orchestrator";
import type { MemoryStrategyAutotuneState } from "./contract";
import { defaultMemoryStrategyAutotuneState } from "./defaults";
import { normalizeMemoryStrategyAutotuneState } from "./normalize";

function resolveParentDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) {
    return ".";
  }
  return normalized.slice(0, slashIndex);
}

function resolveStatePath(workDir: string): string {
  return resolveContextStoragePath(workDir, "memory_strategy_autotune_state");
}

function readStateFromPath(
  path: string,
  basePolicy: MemoryOrchestratorPolicySnapshot,
): MemoryStrategyAutotuneState | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return normalizeMemoryStrategyAutotuneState(raw, basePolicy);
  } catch {
    return null;
  }
}

export function readMemoryStrategyAutotuneState(input: {
  workDir?: string;
  basePolicy: MemoryOrchestratorPolicySnapshot;
}): MemoryStrategyAutotuneState {
  if (!input.workDir || input.workDir.trim().length === 0) {
    return defaultMemoryStrategyAutotuneState(input.basePolicy);
  }
  const readPaths = resolveContextStorageReadPaths(input.workDir, "memory_strategy_autotune_state");
  for (const path of readPaths) {
    const state = readStateFromPath(path, input.basePolicy);
    if (state) {
      return state;
    }
  }
  return defaultMemoryStrategyAutotuneState(input.basePolicy);
}

export function writeMemoryStrategyAutotuneState(input: {
  workDir?: string;
  basePolicy: MemoryOrchestratorPolicySnapshot;
  state: MemoryStrategyAutotuneState;
}): void {
  if (!input.workDir || input.workDir.trim().length === 0) {
    return;
  }
  const path = resolveStatePath(input.workDir);
  const parentDir = resolveParentDir(path);
  try {
    mkdirSync(parentDir, { recursive: true });
    const normalized = normalizeMemoryStrategyAutotuneState(input.state, input.basePolicy);
    writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  } catch {
    // best-effort persistence to avoid breaking turn flow.
  }
}
