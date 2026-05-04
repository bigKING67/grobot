import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RUNTIME_TOOL_RECOVERY_POLICY } from "../tool-recovery-policy";
import type {
  RuntimeToolRecoveryConsumptionRecord,
  RuntimeToolSurfaceAdaptationProfileOutcome,
  RuntimeToolSurfaceAdaptationRecord,
  RuntimeToolSurfaceAdaptationSnapshot,
  RuntimeToolSurfaceAdaptationState,
} from "./contract";
import {
  normalizeAdaptationRecord,
  normalizeConsumptionRecord,
  normalizeProfileOutcome,
  normalizeRecord,
  normalizeString,
} from "./normalize";

export function emptyProfileOutcome(): RuntimeToolSurfaceAdaptationProfileOutcome {
  return {
    adaptedTotal: 0,
    recoveredTotal: 0,
    failedTotal: 0,
    unknownTotal: 0,
    recoveryRate: null,
  };
}

export function emptyState(): RuntimeToolSurfaceAdaptationState {
  return {
    version: 1,
    updatedAt: "",
    recentAdaptations: [],
    profileOutcomes: {},
    recentRecoveryConsumptions: [],
  };
}

export function adaptationStatePathForWorkDir(workDir: string): string {
  return resolve(workDir, ".grobot/runtime/tool-surface-adaptation-state.json");
}

export function readState(path: string): RuntimeToolSurfaceAdaptationState {
  if (!existsSync(path)) {
    return emptyState();
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const row = normalizeRecord(parsed);
    const profileOutcomes: Record<string, RuntimeToolSurfaceAdaptationProfileOutcome> = {};
    for (const [profile, value] of Object.entries(normalizeRecord(row.profileOutcomes))) {
      profileOutcomes[profile] = normalizeProfileOutcome(value);
    }
    return {
      version: 1,
      updatedAt: normalizeString(row.updatedAt) ?? "",
      recentAdaptations: Array.isArray(row.recentAdaptations)
        ? row.recentAdaptations
            .map((item) => normalizeAdaptationRecord(item))
            .filter((item): item is RuntimeToolSurfaceAdaptationRecord => Boolean(item))
            .slice(-1 * RUNTIME_TOOL_RECOVERY_POLICY.adaptationHistoryMaxEntries)
        : [],
      profileOutcomes,
      recentRecoveryConsumptions: Array.isArray(row.recentRecoveryConsumptions)
        ? row.recentRecoveryConsumptions
            .map((item) => normalizeConsumptionRecord(item))
            .filter((item): item is RuntimeToolRecoveryConsumptionRecord => Boolean(item))
            .slice(-1 * RUNTIME_TOOL_RECOVERY_POLICY.recoveryConsumptionHistoryMaxEntries)
        : [],
    };
  } catch {
    return emptyState();
  }
}

export function toSnapshot(
  path: string,
  state: RuntimeToolSurfaceAdaptationState,
): RuntimeToolSurfaceAdaptationSnapshot {
  return {
    version: 1,
    updatedAt: state.updatedAt || null,
    path,
    recentAdaptations: state.recentAdaptations,
    latestAdaptation: state.recentAdaptations[state.recentAdaptations.length - 1] ?? null,
    profileOutcomes: state.profileOutcomes,
    recentRecoveryConsumptions: state.recentRecoveryConsumptions,
    latestRecoveryConsumption: state.recentRecoveryConsumptions[state.recentRecoveryConsumptions.length - 1] ?? null,
  };
}

export function readRuntimeToolSurfaceAdaptationState(
  workDir: string,
): RuntimeToolSurfaceAdaptationSnapshot {
  const path = adaptationStatePathForWorkDir(workDir);
  return toSnapshot(path, readState(path));
}
