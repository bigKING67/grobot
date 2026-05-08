import {
  type ContextCompressionProfile,
  type ContextPromptQualityGuardAdaptiveMode,
  type PromptCompactionStage,
} from "../../types";

export function parseBooleanToken(raw: string | undefined): boolean | undefined {
  if (raw === undefined) {
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

export function parseNumberToken(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const normalized = raw.trim();
  if (!/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

export function parseStringListToken(raw: string | undefined): string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const values = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return values.length > 0 ? values : [];
}

export function parseContextCompressionProfile(
  raw: string | undefined,
): ContextCompressionProfile | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "balanced") {
    return "balanced";
  }
  if (normalized === "aggressive") {
    return "aggressive";
  }
  if (normalized === "conservative") {
    return "conservative";
  }
  return undefined;
}

export function parsePromptQualityGuardMaxFloorStage(
  raw: string | undefined,
): PromptCompactionStage | undefined {
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
  return undefined;
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
