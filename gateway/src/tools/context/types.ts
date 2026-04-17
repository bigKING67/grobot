export type ContextCompressionProfile = "balanced" | "aggressive" | "conservative";

export interface ContextCompressionThresholds {
  proactiveRatio: number;
  forcedRatio: number;
  hardRatio: number;
}

export interface ContextRecoveryConfig {
  reactiveMaxRetries: number;
  ptlMaxRetries: number;
  circuitBreakerFailures: number;
}

export interface ContextLineageConfig {
  enabled: boolean;
  maxRows: number;
  maxCommits: number;
  cacheTtlMs: number;
}

export interface ContextWorkspaceSignalsConfig {
  enabled: boolean;
  maxRows: number;
  includeUntracked: boolean;
  cacheTtlMs: number;
}

export interface ContextSemanticPrefetchConfig {
  enabled: boolean;
  timeoutMs: number;
  maxEvidence: number;
}

export interface ContextDependencyGraphConfig {
  enabled: boolean;
  maxRows: number;
}

export interface ContextSymbolGraphConfig {
  enabled: boolean;
  maxRows: number;
}

export interface ContextEngineConfig {
  enabled: boolean;
  profile: ContextCompressionProfile;
  contextWindowTokens: number;
  reservedOutputTokens: number;
  safetyMarginTokens: number;
  thresholds: ContextCompressionThresholds;
  recovery: ContextRecoveryConfig;
  lineage: ContextLineageConfig;
  workspaceSignals: ContextWorkspaceSignalsConfig;
  semanticPrefetch: ContextSemanticPrefetchConfig;
  dependencyGraph: ContextDependencyGraphConfig;
  symbolGraph: ContextSymbolGraphConfig;
  reactiveOnPromptTooLong: boolean;
}

export type PromptCompactionStage = "normal" | "proactive" | "forced" | "minimal";

export interface PromptVariant {
  stage: PromptCompactionStage;
  prompt: string;
  estimatedTokens: number;
}

export interface PromptPreparationResult {
  selected: PromptVariant;
  variants: PromptVariant[];
  thresholdStage: PromptCompactionStage;
  selectionReason: "threshold" | "budget_guard";
  utilization: number;
  selectedUtilization: number;
  effectiveWindowTokens: number;
  totalEstimatedTokens: number;
}

export interface ContextHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PromptOverflowClassification {
  overflow: boolean;
  reason: "prompt_too_long" | "context_length_exceeded" | "status_413" | "none";
}
