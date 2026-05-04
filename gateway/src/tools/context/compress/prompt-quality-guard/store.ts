import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  resolveContextStoragePath,
  resolveContextStorageReadPaths,
} from "../../storage-boundary";
import type { PromptQualityGuardState } from "./contract";
import { defaultPromptQualityGuardState, resolveParentDir } from "./core";
import { normalizePromptQualityGuardState } from "./normalize";

function resolveStatePath(workDir: string): string {
  return resolveContextStoragePath(workDir, "prompt_quality_guard_state");
}

export function readPromptQualityGuardState(input: {
  workDir: string;
}): PromptQualityGuardState {
  const pathCandidates = resolveContextStorageReadPaths(input.workDir, "prompt_quality_guard_state");
  for (const path of pathCandidates) {
    if (!existsSync(path)) {
      continue;
    }
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      return normalizePromptQualityGuardState(parsed);
    } catch {
      // try next candidate
    }
  }
  return defaultPromptQualityGuardState();
}

export function writePromptQualityGuardState(input: {
  workDir: string;
  state: PromptQualityGuardState;
}): void {
  const path = resolveStatePath(input.workDir);
  const normalized = normalizePromptQualityGuardState(input.state);
  try {
    mkdirSync(resolveParentDir(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  } catch {
    // best effort only
  }
}
