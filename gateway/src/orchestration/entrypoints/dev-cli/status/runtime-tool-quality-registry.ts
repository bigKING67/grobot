import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveRepoRoot } from "../services/repo-root";

export const RUNTIME_TOOL_QUALITY_REGISTRY_RELATIVE_PATH = "shared/contracts/runtime-tool-quality-v1.json";

export type RuntimeToolQualitySurface = "status" | "release";

export interface RuntimeToolQualityRegistryResolution {
  actionRequired: string;
  defaultNextStep: string | null;
}

interface RuntimeToolQualityActionRegistryEntry {
  actionRequired: string;
  defaultNextStepBySurface: ReadonlyMap<RuntimeToolQualitySurface, string>;
}

const RUNTIME_TOOL_QUALITY_SURFACES: readonly RuntimeToolQualitySurface[] = ["status", "release"] as const;

let cachedActionRegistryByReason: ReadonlyMap<string, RuntimeToolQualityActionRegistryEntry> | undefined;
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

function readDefaultNextStepBySurface(
  value: unknown,
  rowIndex: number,
): ReadonlyMap<RuntimeToolQualitySurface, string> {
  if (!isRecord(value)) {
    throw new Error(`runtime_tool_quality_registry_default_next_step_missing:${String(rowIndex)}`);
  }
  const bySurface = new Map<RuntimeToolQualitySurface, string>();
  for (const surface of RUNTIME_TOOL_QUALITY_SURFACES) {
    const nextStep = value[surface];
    if (nextStep === undefined) {
      continue;
    }
    if (typeof nextStep !== "string" || nextStep.trim().length === 0) {
      throw new Error(
        `runtime_tool_quality_registry_default_next_step_invalid:${String(rowIndex)}:${surface}`,
      );
    }
    bySurface.set(surface, nextStep);
  }
  return bySurface;
}

function readRuntimeToolQualityActionRegistryByReason(): ReadonlyMap<string, RuntimeToolQualityActionRegistryEntry> {
  if (cachedActionRegistryByReason) {
    return cachedActionRegistryByReason;
  }
  const registry = readRegistryJson();
  if (!isRecord(registry) || !Array.isArray(registry.action_required)) {
    throw new Error("runtime_tool_quality_registry_action_required_missing");
  }

  const byReason = new Map<string, RuntimeToolQualityActionRegistryEntry>();
  for (const [index, row] of registry.action_required.entries()) {
    if (!isRecord(row) || typeof row.action !== "string" || !Array.isArray(row.reasons)) {
      throw new Error(`runtime_tool_quality_registry_action_required_invalid:${String(index)}`);
    }
    const defaultNextStepBySurface = readDefaultNextStepBySurface(row.default_next_step, index);
    for (const reason of row.reasons) {
      if (typeof reason !== "string" || reason.trim().length === 0) {
        throw new Error(`runtime_tool_quality_registry_action_reason_invalid:${String(index)}`);
      }
      if (byReason.has(reason)) {
        throw new Error(`runtime_tool_quality_registry_action_reason_duplicate:${reason}`);
      }
      byReason.set(reason, {
        actionRequired: row.action,
        defaultNextStepBySurface,
      });
    }
  }

  cachedActionRegistryByReason = byReason;
  return cachedActionRegistryByReason;
}

function readRuntimeToolQualityActionRequiredByReason(): ReadonlyMap<string, string> {
  if (cachedActionRequiredByReason) {
    return cachedActionRequiredByReason;
  }
  const byReason = new Map<string, string>();
  for (const [reason, entry] of readRuntimeToolQualityActionRegistryByReason()) {
    byReason.set(reason, entry.actionRequired);
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

export function resolveRuntimeToolQualityActionFromRegistry(input: {
  actionReason: string | null;
  surface: RuntimeToolQualitySurface;
}): RuntimeToolQualityRegistryResolution | null {
  if (!input.actionReason) {
    return null;
  }
  const entry = readRuntimeToolQualityActionRegistryByReason().get(input.actionReason);
  if (!entry) {
    throw new Error(`runtime_tool_quality_registry_action_required_unmapped:${input.actionReason}`);
  }
  return {
    actionRequired: entry.actionRequired,
    defaultNextStep: entry.defaultNextStepBySurface.get(input.surface) ?? null,
  };
}

export function resolveRuntimeToolQualityDefaultNextStepFromRegistry(input: {
  actionReason: string | null;
  surface: RuntimeToolQualitySurface;
}): string | null {
  return resolveRuntimeToolQualityActionFromRegistry(input)?.defaultNextStep ?? null;
}
