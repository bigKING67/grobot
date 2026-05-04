export type MemoryLevel = "L1" | "L2" | "L3" | "L4";
export type MemoryEventType =
  | "turn_success"
  | "turn_failure"
  | "verification_failure"
  | "tool_success"
  | "ask_user_resolved"
  | "manual_import";

export interface MemoryOrchestratorGaMemoryRecord {
  id: string;
  memoryLevel: MemoryLevel;
  text: string;
  executionVerified: boolean;
  confidence: number;
  createdAt: string;
  tags: readonly string[];
}

export interface MemoryOrchestratorGaSkillCard {
  id: string;
  taskSignature: string;
  preconditions: readonly string[];
  steps: readonly string[];
  failureSignals: readonly string[];
  rollback: readonly string[];
  confidence: number;
  updatedAt: string;
}

export interface MemoryOrchestratorExperienceRecord {
  id: string;
  user: string;
  taskSignature?: string;
  taskType?: string;
  scenarioTags?: readonly string[];
  summary: string;
  sop: readonly string[];
  reuseGuardrails?: readonly string[];
  confidence: number;
  successCount: number;
  failureCount: number;
  recoverySuccessCount?: number;
  consecutiveFailureCount?: number;
  lastFailureClass?: string;
  lastSuccessStrategy?: string;
  state: "active" | "quarantined" | "disabled";
}

export interface MemoryOrchestratorExperienceSearchMatch {
  record: MemoryOrchestratorExperienceRecord;
  score: number;
}

export interface MemoryOrchestratorExperienceRecall {
  prompt: string;
  matched: number;
  candidates: number;
}

export interface MemoryOrchestratorExperiencePublishResult {
  skipped: boolean;
  reason?: string;
  verificationPassed: boolean;
  evidenceRefPassed: boolean;
  redactionPassed: boolean;
  created?: boolean;
  recordId?: string;
  confidence?: number;
}

export interface MemoryOrchestratorExperienceFailureResult {
  matched: boolean;
  recordId?: string;
  score?: number;
  confidence?: number;
  quarantined?: boolean;
  conflictIsolated?: boolean;
}

export interface MemoryOrchestratorGaAdapter {
  listMemory(sessionKey: string): readonly MemoryOrchestratorGaMemoryRecord[];
  listSkillCards(sessionKey: string): readonly MemoryOrchestratorGaSkillCard[];
  registerTurnSuccess(input: {
    sessionKey: string;
    userText: string;
    assistantText: string;
    traceId: string;
    providerName: string;
    verificationPass: boolean;
  }): void;
  registerTurnFailure(input: {
    sessionKey: string;
    providerName: string;
    errorClass: string;
    errorMessage: string;
    traceId?: string;
  }): void;
  writeMemory?(input: {
    sessionKey: string;
    memoryLevel: MemoryLevel;
    text: string;
    sourceEventType:
      | "turn_executed"
      | "tool_executed"
      | "checkpoint_updated"
      | "reflection_generated"
      | "ask_user_resolved";
    executionVerified: boolean;
    evidenceRef?: {
      traceId?: string;
      turnId?: string;
      toolCallId?: string;
      source?: string;
    };
    tags?: string[];
    confidence?: number;
  }): {
    ok: boolean;
    code: string;
    message?: string;
    record?: MemoryOrchestratorGaMemoryRecord;
  };
}

export interface MemoryOrchestratorExperienceAdapter {
  getTeamDefault(): string;
  buildRecallPrompt(input: {
    sessionKey: string;
    userText: string;
  }): MemoryOrchestratorExperienceRecall;
  searchRecords(input: {
    tenant: string;
    query: string;
    limit: number;
    includeStates?: readonly ("active" | "quarantined" | "disabled")[];
    team?: string;
    user?: string;
  }): readonly MemoryOrchestratorExperienceSearchMatch[];
  registerTurnSuccess(input: {
    sessionKey: string;
    userText: string;
    assistantText: string;
    traceId: string;
    providerName: string;
    verificationPass: boolean;
    evidenceRef: {
      traceId?: string;
      runId?: string;
      toolCallId?: string;
      url?: string;
      sourceType?: string;
      capturedAt?: string;
    };
  }): MemoryOrchestratorExperiencePublishResult;
  registerTurnFailure(input: {
    sessionKey: string;
    userText: string;
    providerName: string;
    errorClass: string;
    errorMessage: string;
    failureStage?: "planning" | "implementation" | "verification" | "runtime" | "unknown";
    toolContext?: string;
  }): MemoryOrchestratorExperienceFailureResult;
}

export interface MemoryOrchestratorPolicySnapshot {
  version: string;
  enabled: boolean;
  injectBudgetRatio: number;
  injectBudgetMinTokens: number;
  injectBudgetMaxTokens: number;
  maxSectionTokens: number;
  maxGaMemoryRows: number;
  maxTeamExperienceRows: number;
  minTeamExperienceScore: number;
  decayEnabled: boolean;
  decayMaxRowsPerSession: number;
  decayMinRowsToKeep: number;
  decayMaxAgeHoursL1: number;
  decayMaxAgeHoursL2: number;
  decayMaxAgeHoursL3: number;
  decayMaxAgeHoursL4: number;
  decayUnverifiedMaxAgeHours: number;
  decayMinConfidenceVerified: number;
  decayMinConfidenceUnverified: number;
}

export interface MemoryOrchestratorInjectInput {
  sessionKey: string;
  userText: string;
  targetTokenLimit: number;
  tenant: string;
  team?: string;
  user: string;
  includeLineage: boolean;
  lineageMaxRows: number;
  lineageMaxCommits: number;
  lineageCacheTtlMs: number;
  workDir?: string;
}

export interface MemoryOrchestratorInjectResult {
  promptParts: string[];
  usedTokens: number;
  budgetTokens: number;
  sectionCount: number;
  includedSections: string[];
  truncatedSections: string[];
  stderrEvents: string[];
}

export type MemoryOrchestratorFeedbackInput =
  | {
    type: "turn_success";
    sessionKey: string;
    userText: string;
    assistantText: string;
    traceId: string;
    requestId?: string;
    providerName: string;
    verificationPass: boolean;
  }
  | {
    type: "turn_failure";
    sessionKey: string;
    userText: string;
    providerName: string;
    errorClass: string;
    errorMessage: string;
    traceId?: string;
    failureStage?: "planning" | "implementation" | "verification" | "runtime" | "unknown";
    toolContext?: string;
  }
  | {
    type: "verification_failure";
    sessionKey: string;
    userText: string;
    providerName: string;
    errorMessage: string;
  };

export interface MemoryOrchestratorFeedbackResult {
  stderrEvents: string[];
}

export interface MemoryOrchestratorIngestInput {
  eventType: MemoryEventType;
  sessionKey: string;
  text: string;
  executionVerified: boolean;
  evidenceRef?: {
    traceId?: string;
    turnId?: string;
    toolCallId?: string;
    source?: string;
  };
  tags?: string[];
  confidence?: number;
}

export interface MemoryOrchestratorIngestResult {
  accepted: boolean;
  reason?: string;
  stderrEvents: string[];
}

export interface MemoryOrchestratorRetrieveInput {
  sessionKey: string;
  userText: string;
  tenant: string;
  team?: string;
  user: string;
}

export interface MemoryOrchestratorRetrieveResult {
  gaSkillPrompt: string;
  gaSkillMatched: number;
  gaSkillTotal: number;
  personalExperiencePrompt: string;
  personalExperienceMatched: number;
  personalExperienceCandidates: number;
  gaMemoryRows: string[];
  teamExperienceRows: string[];
}

export interface MemoryOrchestratorReconcileInput<
  T extends MemoryOrchestratorGaMemoryRecord = MemoryOrchestratorGaMemoryRecord,
> {
  rows: readonly T[];
}

export interface MemoryOrchestratorReconcileResult<
  T extends MemoryOrchestratorGaMemoryRecord = MemoryOrchestratorGaMemoryRecord,
> {
  deduplicated: number;
  kept: number;
  rows: readonly T[];
}

export interface MemoryOrchestratorDecayInput<
  T extends MemoryOrchestratorGaMemoryRecord = MemoryOrchestratorGaMemoryRecord,
> {
  rows: readonly T[];
  nowMs?: number;
}

export interface MemoryOrchestratorDecayResult<
  T extends MemoryOrchestratorGaMemoryRecord = MemoryOrchestratorGaMemoryRecord,
> {
  action: "noop" | "pruned";
  reason: string;
  kept: number;
  dropped: number;
  rows: readonly T[];
  droppedByReason: {
    ageExceeded: number;
    lowConfidence: number;
    capacityTrim: number;
  };
  keptByLevel: Record<MemoryLevel, number>;
}

export interface MemoryOrchestratorDecayPolicyOverride {
  decayMaxRowsPerSession?: number;
  decayMinRowsToKeep?: number;
  decayUnverifiedMaxAgeHours?: number;
  decayMinConfidenceVerified?: number;
  decayMinConfidenceUnverified?: number;
}

export interface MemoryOrchestratorInjectionPolicyOverride {
  injectBudgetRatio?: number;
  injectBudgetMinTokens?: number;
  injectBudgetMaxTokens?: number;
  maxSectionTokens?: number;
  maxGaMemoryRows?: number;
  maxTeamExperienceRows?: number;
  minTeamExperienceScore?: number;
}

export interface MemoryOrchestrator {
  policySnapshot(): MemoryOrchestratorPolicySnapshot;
  ingest(input: MemoryOrchestratorIngestInput): MemoryOrchestratorIngestResult;
  retrieve(input: MemoryOrchestratorRetrieveInput): MemoryOrchestratorRetrieveResult;
  reconcile<T extends MemoryOrchestratorGaMemoryRecord>(
    input: MemoryOrchestratorReconcileInput<T>,
  ): MemoryOrchestratorReconcileResult<T>;
  decay<T extends MemoryOrchestratorGaMemoryRecord>(
    input: MemoryOrchestratorDecayInput<T>,
  ): MemoryOrchestratorDecayResult<T>;
  tuneInjectionPolicy(
    input: MemoryOrchestratorInjectionPolicyOverride,
  ): MemoryOrchestratorPolicySnapshot;
  tuneDecayPolicy(input: MemoryOrchestratorDecayPolicyOverride): MemoryOrchestratorPolicySnapshot;
  feedback(input: MemoryOrchestratorFeedbackInput): MemoryOrchestratorFeedbackResult;
  injectContext(input: MemoryOrchestratorInjectInput): MemoryOrchestratorInjectResult;
}

export interface CreateMemoryOrchestratorInput {
  ga: MemoryOrchestratorGaAdapter;
  experience: MemoryOrchestratorExperienceAdapter;
  workDir?: string;
  policy?: Partial<MemoryOrchestratorPolicySnapshot>;
}

export interface MemoryContextBlock {
  name: string;
  priority: number;
  text: string;
}
