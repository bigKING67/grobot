import { type PromptCompactionStage } from "../../../tools/context";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizePromptCompactionStage(raw: unknown): PromptCompactionStage {
  if (raw === "proactive" || raw === "forced" || raw === "minimal") {
    return raw;
  }
  return "normal";
}
