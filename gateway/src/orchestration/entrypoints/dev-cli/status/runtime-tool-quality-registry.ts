import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveRepoRoot } from "../services/repo-root";

export const RUNTIME_TOOL_QUALITY_REGISTRY_RELATIVE_PATH = "shared/contracts/runtime-tool-quality-v1.json";

let cachedActionRequiredByReason: ReadonlyMap<string, string> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function candidateRegistryPaths(): string[] {
  const candidates: string[] = [];
  const repoRoot = resolveRepoRoot();
  if (repoRoot) {
    candidates.push(resolve(repoRoot, RUNTIME_TOOL_QUALITY_REGISTRY_RELATIVE_PATH));
  }
  candidates.push(resolve(process.cwd(), RUNTIME_TOOL_QUALITY_REGISTRY_RELATIVE_PATH));
  return [...new Set(candidates)];
}

function readRegistryJson(): unknown {
  const candidates = candidateRegistryPaths();
  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }
    try {
      return JSON.parse(readFileSync(candidate, "utf8")) as unknown;
    } catch (error) {
      throw new Error(
        `runtime_tool_quality_registry_invalid_json:${candidate}:${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(`runtime_tool_quality_registry_missing:${candidates.join(",")}`);
}

function readRuntimeToolQualityActionRequiredByReason(): ReadonlyMap<string, string> {
  if (cachedActionRequiredByReason) {
    return cachedActionRequiredByReason;
  }
  const registry = readRegistryJson();
  if (!isRecord(registry) || !Array.isArray(registry.action_required)) {
    throw new Error("runtime_tool_quality_registry_action_required_missing");
  }

  const byReason = new Map<string, string>();
  for (const [index, row] of registry.action_required.entries()) {
    if (!isRecord(row) || typeof row.action !== "string" || !Array.isArray(row.reasons)) {
      throw new Error(`runtime_tool_quality_registry_action_required_invalid:${String(index)}`);
    }
    for (const reason of row.reasons) {
      if (typeof reason !== "string" || reason.trim().length === 0) {
        throw new Error(`runtime_tool_quality_registry_action_reason_invalid:${String(index)}`);
      }
      if (byReason.has(reason)) {
        throw new Error(`runtime_tool_quality_registry_action_reason_duplicate:${reason}`);
      }
      byReason.set(reason, row.action);
    }
  }

  cachedActionRequiredByReason = byReason;
  return cachedActionRequiredByReason;
}

export function resolveRuntimeToolQualityActionRequiredFromRegistry(actionReason: string | null): string | null {
  if (!actionReason) {
    return null;
  }
  const actionRequired = readRuntimeToolQualityActionRequiredByReason().get(actionReason);
  if (!actionRequired) {
    throw new Error(`runtime_tool_quality_registry_action_required_unmapped:${actionReason}`);
  }
  return actionRequired;
}
