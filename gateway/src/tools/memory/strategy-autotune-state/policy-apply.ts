import type { MemoryOrchestratorPolicySnapshot } from "../orchestrator";
import type { MemoryStrategyAutotuneState } from "./contract";

export function applyMemoryStrategyAutotuneToPolicy(input: {
  basePolicy: MemoryOrchestratorPolicySnapshot;
  state: MemoryStrategyAutotuneState;
}): MemoryOrchestratorPolicySnapshot {
  return {
    ...input.basePolicy,
    injectBudgetRatio: input.state.injectBudgetRatio,
    maxSectionTokens: input.state.maxSectionTokens,
    maxGaMemoryRows: input.state.maxGaMemoryRows,
    maxTeamExperienceRows: input.state.maxTeamExperienceRows,
    minTeamExperienceScore: input.state.minTeamExperienceScore,
  };
}
