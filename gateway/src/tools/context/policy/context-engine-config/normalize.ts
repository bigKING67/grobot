import {
  DEFAULT_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST,
  DEFAULT_PROMPT_QUALITY_GUARD_MAX_FLOOR_STAGE,
} from "./defaults";
import {
  type ContextCompressionProfile,
  type ContextPromptQualityGuardAdaptiveMode,
  type PromptCompactionStage,
} from "../../types";

export function parseEnvBoolean(raw: string | undefined): boolean | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "off", "no"].includes(normalized)) {
    return false;
  }
  return undefined;
}

export function parseEnvNumber(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = Number.parseFloat(raw.trim());
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

export function parseEnvStringList(raw: string | undefined): string[] | undefined {
  if (!raw) {
    return undefined;
  }
  const values = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return values.length > 0 ? values : [];
}

export function clampRatio(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(0.995, Math.max(0.5, value));
}

export function clampUnitRatio(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

export function clampPositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return fallback;
  }
  return normalized;
}

export function normalizeProfile(raw: string | undefined): ContextCompressionProfile {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "aggressive") {
    return "aggressive";
  }
  if (normalized === "conservative") {
    return "conservative";
  }
  return "balanced";
}

export function normalizePromptQualityGuardMaxFloorStage(
  raw: string | undefined,
): PromptCompactionStage {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "proactive") {
    return "proactive";
  }
  if (normalized === "forced") {
    return "forced";
  }
  if (normalized === "minimal") {
    return "minimal";
  }
  return DEFAULT_PROMPT_QUALITY_GUARD_MAX_FLOOR_STAGE;
}

export function normalizePromptQualityGuardAdaptiveMode(
  raw: string | undefined,
): ContextPromptQualityGuardAdaptiveMode | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "harden") {
    return "harden";
  }
  if (normalized === "relax") {
    return "relax";
  }
  return undefined;
}

export function normalizePromptQualityGuardAdaptiveModeAllowlist(
  raw: string[] | undefined,
): ContextPromptQualityGuardAdaptiveMode[] {
  if (!Array.isArray(raw)) {
    return [...DEFAULT_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST];
  }
  const unique = new Set<ContextPromptQualityGuardAdaptiveMode>();
  for (const value of raw) {
    const normalized = normalizePromptQualityGuardAdaptiveMode(value);
    if (normalized) {
      unique.add(normalized);
    }
  }
  if (unique.size === 0) {
    return [...DEFAULT_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST];
  }
  return Array.from(unique.values());
}
