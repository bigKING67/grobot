import type { MemoryOrchestratorPolicySnapshot } from "../orchestrator";
import type {
  MemoryStrategyAutotuneActionDirection,
  MemoryStrategyAutotuneProfile,
} from "./contract";

export interface MemoryStrategyAutotuneRanges {
  budgetRatioMin: number;
  budgetRatioMax: number;
  sectionMin: number;
  sectionMax: number;
  gaRowsMin: number;
  gaRowsMax: number;
  teamRowsMin: number;
  teamRowsMax: number;
  teamScoreMin: number;
  teamScoreMax: number;
}

export function resolveStrategyRanges(
  basePolicy: MemoryOrchestratorPolicySnapshot,
): MemoryStrategyAutotuneRanges {
  const budgetRatioMin = Math.max(0.08, Math.min(0.3, Number((basePolicy.injectBudgetRatio * 0.5).toFixed(4))));
  const budgetRatioMax = Math.min(0.55, Math.max(
    Number((basePolicy.injectBudgetRatio * 1.8).toFixed(4)),
    budgetRatioMin + 0.08,
  ));
  const sectionMin = Math.max(320, Math.floor(basePolicy.maxSectionTokens * 0.4));
  const sectionMax = Math.max(Math.floor(basePolicy.maxSectionTokens * 2.2), sectionMin + 280);
  const gaRowsMin = 1;
  const gaRowsMax = Math.max(basePolicy.maxGaMemoryRows + 4, gaRowsMin + 3);
  const teamRowsMin = 1;
  const teamRowsMax = Math.max(basePolicy.maxTeamExperienceRows + 4, teamRowsMin + 3);
  const teamScoreMin = Math.max(12, Math.floor(basePolicy.minTeamExperienceScore - 20));
  const teamScoreMax = Math.max(teamScoreMin + 12, Math.floor(basePolicy.minTeamExperienceScore + 30));
  return {
    budgetRatioMin,
    budgetRatioMax,
    sectionMin,
    sectionMax,
    gaRowsMin,
    gaRowsMax,
    teamRowsMin,
    teamRowsMax,
    teamScoreMin,
    teamScoreMax,
  };
}

export function inferActionDirectionFromReason(
  reason: string,
): MemoryStrategyAutotuneActionDirection {
  if (reason.includes("quality_pressure_tighten")) {
    return "tighten";
  }
  if (reason.includes("budget_pressure_tighten")) {
    return "tighten";
  }
  if (reason.includes("quality_signal_relax")) {
    return "relax";
  }
  return "neutral";
}

export function normalizeProfile(raw: unknown): MemoryStrategyAutotuneProfile {
  if (raw === "debug_heavy" || raw === "delivery" || raw === "docs" || raw === "general") {
    return raw;
  }
  return "general";
}

export function resolveProfileThresholdOffset(profile: MemoryStrategyAutotuneProfile): {
  tightenOffset: number;
  relaxOffset: number;
} {
  if (profile === "delivery") {
    return {
      tightenOffset: -0.03,
      relaxOffset: -0.02,
    };
  }
  if (profile === "debug_heavy") {
    return {
      tightenOffset: 0.035,
      relaxOffset: 0.02,
    };
  }
  if (profile === "docs") {
    return {
      tightenOffset: 0.045,
      relaxOffset: 0.03,
    };
  }
  return {
    tightenOffset: 0,
    relaxOffset: 0,
  };
}
