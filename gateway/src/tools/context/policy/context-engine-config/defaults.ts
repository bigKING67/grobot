import { type RuntimeModelConfig } from "../../../../models/types";
import {
  type ContextCompressionProfile,
  type ContextPromptQualityGuardAdaptiveMode,
  type PromptCompactionStage,
} from "../../types";

export const DEFAULT_CONTEXT_WINDOW_OPENAI_COMPATIBLE = 128_000;
export const DEFAULT_CONTEXT_WINDOW_KIMI = 262_144;
export const DEFAULT_RESERVED_OUTPUT_TOKENS = 20_000;
export const DEFAULT_SAFETY_MARGIN_TOKENS = 3_000;
export const DEFAULT_AUTO_COMPACT_RATIO = 0.9;
export const DEFAULT_LINEAGE_MAX_ROWS = 3;
export const DEFAULT_LINEAGE_MAX_COMMITS = 120;
export const DEFAULT_LINEAGE_CACHE_TTL_MS = 30_000;
export const DEFAULT_WORKSPACE_SIGNALS_MAX_ROWS = 4;
export const DEFAULT_WORKSPACE_SIGNALS_CACHE_TTL_MS = 2_000;
export const DEFAULT_SEMANTIC_PREFETCH_TIMEOUT_MS = 2_500;
export const DEFAULT_SEMANTIC_PREFETCH_MAX_EVIDENCE = 6;
export const DEFAULT_DEPENDENCY_GRAPH_MAX_ROWS = 4;
export const DEFAULT_SYMBOL_GRAPH_MAX_ROWS = 4;
export const DEFAULT_PROMPT_QUALITY_LOW_QUALITY_THRESHOLD = 0.6;
export const DEFAULT_PROMPT_QUALITY_DEGRADE_OVERALL_THRESHOLD = 0.62;
export const DEFAULT_PROMPT_QUALITY_DEGRADE_LOW_RATE_THRESHOLD = 0.4;
export const DEFAULT_PROMPT_QUALITY_DEGRADE_MIN_ENTRIES = 8;
export const DEFAULT_PROMPT_QUALITY_GUARD_ENABLED = true;
export const DEFAULT_PROMPT_QUALITY_GUARD_ADAPTIVE_ENABLED = true;
export const DEFAULT_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST: ContextPromptQualityGuardAdaptiveMode[] = [
  "harden",
  "relax",
];
export const DEFAULT_PROMPT_QUALITY_GUARD_PROMOTE_STREAK = 2;
export const DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_PROMOTE_STREAK = 2;
export const DEFAULT_PROMPT_QUALITY_GUARD_RELEASE_STREAK = 3;
export const DEFAULT_PROMPT_QUALITY_GUARD_HOLD_TURNS = 2;
export const DEFAULT_PROMPT_QUALITY_GUARD_MAX_FLOOR_STAGE: PromptCompactionStage = "minimal";
export const DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_OVERALL_THRESHOLD = 0.45;
export const DEFAULT_PROMPT_QUALITY_GUARD_SEVERE_LOW_RATE_THRESHOLD = 0.7;

export type ThresholdProfile = {
  proactive: number;
  forced: number;
  hard: number;
};

export const PROFILE_THRESHOLDS: Record<ContextCompressionProfile, ThresholdProfile> = {
  balanced: {
    proactive: 0.88,
    forced: 0.93,
    hard: 0.97,
  },
  aggressive: {
    proactive: 0.82,
    forced: 0.89,
    hard: 0.94,
  },
  conservative: {
    proactive: 0.92,
    forced: 0.95,
    hard: 0.98,
  },
};

export function resolveDefaultContextWindow(modelConfig?: RuntimeModelConfig): number {
  const providerKind = modelConfig?.providerKind?.trim().toLowerCase();
  if (providerKind === "kimi") {
    return DEFAULT_CONTEXT_WINDOW_KIMI;
  }
  const baseUrl = modelConfig?.baseUrl?.trim().toLowerCase() ?? "";
  if (baseUrl.includes("moonshot.cn")) {
    return DEFAULT_CONTEXT_WINDOW_KIMI;
  }
  return DEFAULT_CONTEXT_WINDOW_OPENAI_COMPATIBLE;
}
