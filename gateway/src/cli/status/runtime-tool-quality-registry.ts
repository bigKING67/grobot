import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveRepoRoot } from "../services/repo-root";

export const RUNTIME_TOOL_QUALITY_REGISTRY_RELATIVE_PATH = "shared/contracts/runtime-tool-quality-v1.json";

export type RuntimeToolQualitySurface = "status" | "release";

export interface RuntimeToolQualityRegistryResolution {
  actionFamily: string;
  actionRequired: string | null;
  defaultNextStep: string | null;
}

interface RuntimeToolQualityActionRegistryEntry {
  actionRequired: string;
  defaultNextStepBySurface: ReadonlyMap<RuntimeToolQualitySurface, string>;
}

interface RuntimeToolQualityReasonRegistryEntry {
  actionFamily: string;
  priorityBySurface: ReadonlyMap<RuntimeToolQualitySurface, number>;
}

interface RuntimeToolQualityRegistry {
  actionByReason: ReadonlyMap<string, RuntimeToolQualityActionRegistryEntry>;
  reasonByReason: ReadonlyMap<string, RuntimeToolQualityReasonRegistryEntry>;
}

export interface RuntimeToolQualitySignalResolution extends RuntimeToolQualityRegistryResolution {
  actionReason: string;
  priority: number;
}

const RUNTIME_TOOL_QUALITY_SURFACES: readonly RuntimeToolQualitySurface[] = ["status", "release"] as const;

let cachedRegistry: RuntimeToolQualityRegistry | undefined;
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

function readSurfaceList(value: unknown, rowIndex: number, label: string): RuntimeToolQualitySurface[] {
  if (!Array.isArray(value)) {
    throw new Error(`runtime_tool_quality_registry_${label}_surfaces_missing:${String(rowIndex)}`);
  }
  return value.map((surface, surfaceIndex) => {
    if (surface !== "status" && surface !== "release") {
      throw new Error(
        `runtime_tool_quality_registry_${label}_surface_invalid:${String(rowIndex)}:${String(surfaceIndex)}`,
      );
    }
    return surface;
  });
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

function readPriorityBySurface(
  value: unknown,
  surfaces: readonly RuntimeToolQualitySurface[],
  rowIndex: number,
  label: string,
): ReadonlyMap<RuntimeToolQualitySurface, number> {
  if (!isRecord(value)) {
    throw new Error(`runtime_tool_quality_registry_${label}_priority_missing:${String(rowIndex)}`);
  }
  const bySurface = new Map<RuntimeToolQualitySurface, number>();
  for (const surface of surfaces) {
    const priority = value[surface];
    if (typeof priority !== "number" || !Number.isInteger(priority) || priority <= 0) {
      throw new Error(
        `runtime_tool_quality_registry_${label}_priority_invalid:${String(rowIndex)}:${surface}`,
      );
    }
    bySurface.set(surface, priority);
  }
  return bySurface;
}

function readReasonRegistryRows(
  rows: unknown,
  label: "failure_reason" | "warning_reason",
  byReason: Map<string, RuntimeToolQualityReasonRegistryEntry>,
): void {
  if (!Array.isArray(rows)) {
    throw new Error(`runtime_tool_quality_registry_${label}s_missing`);
  }
  for (const [index, row] of rows.entries()) {
    if (!isRecord(row) || typeof row.reason !== "string" || typeof row.action_family !== "string") {
      throw new Error(`runtime_tool_quality_registry_${label}_invalid:${String(index)}`);
    }
    const reason = row.reason.trim();
    if (reason.length === 0) {
      throw new Error(`runtime_tool_quality_registry_${label}_reason_invalid:${String(index)}`);
    }
    if (byReason.has(reason)) {
      throw new Error(`runtime_tool_quality_registry_reason_duplicate:${reason}`);
    }
    const surfaces = readSurfaceList(row.surfaces, index, label);
    byReason.set(reason, {
      actionFamily: row.action_family,
      priorityBySurface: readPriorityBySurface(row.priority_by_surface, surfaces, index, label),
    });
  }
}

function readRuntimeToolQualityRegistry(): RuntimeToolQualityRegistry {
  if (cachedRegistry) {
    return cachedRegistry;
  }
  const registry = readRegistryJson();
  if (!isRecord(registry) || !Array.isArray(registry.action_required)) {
    throw new Error("runtime_tool_quality_registry_action_required_missing");
  }

  const reasonByReason = new Map<string, RuntimeToolQualityReasonRegistryEntry>();
  readReasonRegistryRows(registry.failure_reasons, "failure_reason", reasonByReason);
  readReasonRegistryRows(registry.warning_reasons, "warning_reason", reasonByReason);

  const actionByReason = new Map<string, RuntimeToolQualityActionRegistryEntry>();
  for (const [index, row] of registry.action_required.entries()) {
    if (!isRecord(row) || typeof row.action !== "string" || !Array.isArray(row.reasons)) {
      throw new Error(`runtime_tool_quality_registry_action_required_invalid:${String(index)}`);
    }
    const defaultNextStepBySurface = readDefaultNextStepBySurface(row.default_next_step, index);
    for (const reason of row.reasons) {
      if (typeof reason !== "string" || reason.trim().length === 0) {
        throw new Error(`runtime_tool_quality_registry_action_reason_invalid:${String(index)}`);
      }
      if (!reasonByReason.has(reason)) {
        throw new Error(`runtime_tool_quality_registry_action_reason_unknown:${reason}`);
      }
      if (actionByReason.has(reason)) {
        throw new Error(`runtime_tool_quality_registry_action_reason_duplicate:${reason}`);
      }
      actionByReason.set(reason, {
        actionRequired: row.action,
        defaultNextStepBySurface,
      });
    }
  }

  cachedRegistry = {
    actionByReason,
    reasonByReason,
  };
  return cachedRegistry;
}

function readRuntimeToolQualityActionRegistryByReason(): ReadonlyMap<string, RuntimeToolQualityActionRegistryEntry> {
  if (cachedActionRegistryByReason) {
    return cachedActionRegistryByReason;
  }
  cachedActionRegistryByReason = readRuntimeToolQualityRegistry().actionByReason;
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
  const registry = readRuntimeToolQualityRegistry();
  const reasonEntry = registry.reasonByReason.get(input.actionReason);
  if (!reasonEntry) {
    throw new Error(`runtime_tool_quality_registry_reason_unmapped:${input.actionReason}`);
  }
  const actionEntry = registry.actionByReason.get(input.actionReason);
  if (!actionEntry) {
    throw new Error(`runtime_tool_quality_registry_action_required_unmapped:${input.actionReason}`);
  }
  return {
    actionFamily: reasonEntry.actionFamily,
    actionRequired: actionEntry.actionRequired,
    defaultNextStep: actionEntry.defaultNextStepBySurface.get(input.surface) ?? null,
  };
}

export function resolveRuntimeToolQualityDefaultNextStepFromRegistry(input: {
  actionReason: string | null;
  surface: RuntimeToolQualitySurface;
}): string | null {
  return resolveRuntimeToolQualityActionFromRegistry(input)?.defaultNextStep ?? null;
}

export function resolveRuntimeToolQualitySignalFromRegistry(input: {
  actionReasons: readonly string[];
  surface: RuntimeToolQualitySurface;
}): RuntimeToolQualitySignalResolution | null {
  const registry = readRuntimeToolQualityRegistry();
  const candidates: RuntimeToolQualitySignalResolution[] = [];
  for (const actionReason of input.actionReasons) {
    const reasonEntry = registry.reasonByReason.get(actionReason);
    if (!reasonEntry) {
      throw new Error(`runtime_tool_quality_registry_reason_unmapped:${actionReason}`);
    }
    const priority = reasonEntry.priorityBySurface.get(input.surface);
    if (priority === undefined) {
      throw new Error(`runtime_tool_quality_registry_reason_surface_unmapped:${actionReason}:${input.surface}`);
    }
    const actionEntry = registry.actionByReason.get(actionReason);
    candidates.push({
      actionReason,
      actionFamily: reasonEntry.actionFamily,
      actionRequired: actionEntry?.actionRequired ?? null,
      defaultNextStep: actionEntry?.defaultNextStepBySurface.get(input.surface) ?? null,
      priority,
    });
  }
  return candidates.sort((left, right) => (
    left.priority - right.priority || left.actionReason.localeCompare(right.actionReason)
  ))[0] ?? null;
}
