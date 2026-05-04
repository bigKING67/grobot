import type {
  CreateMemoryOrchestratorInput,
  MemoryOrchestrator,
  MemoryOrchestratorDecayInput,
  MemoryOrchestratorGaMemoryRecord,
  MemoryOrchestratorReconcileInput,
} from "./contract";
import { applyMemoryDecay } from "./decay";
import { processMemoryFeedback } from "./feedback";
import { ingestMemory } from "./ingest";
import { defaultMemoryOrchestratorPolicy, tuneDecayPolicySnapshot, tuneInjectionPolicySnapshot } from "./policy";
import { reconcileMemoryRows } from "./reconcile";
import { injectMemoryContext, retrieveMemoryContext } from "./retrieve";

export function createMemoryOrchestrator(input: CreateMemoryOrchestratorInput): MemoryOrchestrator {
  const policy = {
    ...defaultMemoryOrchestratorPolicy(),
    ...(input.policy ?? {}),
  };

  return {
    policySnapshot: () => ({ ...policy }),
    tuneInjectionPolicy: (override) => tuneInjectionPolicySnapshot(policy, override),
    tuneDecayPolicy: (override) => tuneDecayPolicySnapshot(policy, override),
    ingest: (request) => ingestMemory(input, request),
    retrieve: (request) => retrieveMemoryContext(input, policy, request),
    reconcile: <T extends MemoryOrchestratorGaMemoryRecord>(
      request: MemoryOrchestratorReconcileInput<T>,
    ) => reconcileMemoryRows(request),
    decay: <T extends MemoryOrchestratorGaMemoryRecord>(
      request: MemoryOrchestratorDecayInput<T>,
    ) => applyMemoryDecay(policy, request),
    feedback: (request) => processMemoryFeedback(input, request),
    injectContext: (request) => injectMemoryContext(input, policy, request),
  };
}
