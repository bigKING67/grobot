import { type PromptCompactionStage } from "../../types";
import type { PromptPreSendStrategy } from "./contract";

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function roundScore(value: number): number {
  return Math.round(clamp01(value) * 1000) / 1000;
}

export function roundRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1000) / 1000;
}

export function normalizePreSendStrategy(raw: unknown): PromptPreSendStrategy {
  return raw === "hard_budget" ? "hard_budget" : "quality_first";
}

export function clampNonNegativeRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

export function normalizeWindowSize(raw: number | undefined, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  return Math.min(256, Math.max(1, Math.floor(raw)));
}

export function expectedRecentRowsByStage(stage: PromptCompactionStage): number {
  switch (stage) {
    case "normal":
      return 12;
    case "proactive":
      return 6;
    case "forced":
      return 2;
    case "minimal":
      return 0;
    default:
      return 0;
  }
}
