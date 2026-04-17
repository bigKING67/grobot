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

export interface ContextEngineConfig {
  enabled: boolean;
  profile: ContextCompressionProfile;
  contextWindowTokens: number;
  reservedOutputTokens: number;
  safetyMarginTokens: number;
  thresholds: ContextCompressionThresholds;
  recovery: ContextRecoveryConfig;
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
  utilization: number;
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
