export type ExperienceRecordState = "active" | "quarantined" | "disabled";
export type ExperienceAttemptOutcome = "success" | "failure";
export type ExperienceAttemptStage =
  | "planning"
  | "implementation"
  | "verification"
  | "runtime"
  | "unknown";

export interface ExperienceEvidenceRef {
  traceId?: string;
  runId?: string;
  toolCallId?: string;
  url?: string;
  sourceType?: string;
  capturedAt?: string;
}

export interface ExperienceEvidence {
  source: "turn_success" | "turn_failure" | "manual";
  traceId?: string;
  providerName?: string;
  errorClass?: string;
  capturedAt: string;
  evidenceRef?: ExperienceEvidenceRef;
  providerFailureDiagnostics?: ExperienceProviderFailureDiagnostics;
}

export interface ExperienceProviderFailureDiagnostics {
  providerName?: string;
  diagnosticKind?: string;
  source?: string;
  stage?: string;
  providerKind?: string;
  model?: string;
  upstreamErrorKind?: string;
  httpStatus?: number;
  attempt?: number;
  maxAttempts?: number;
  retryable?: boolean;
}

export interface ExperienceAttemptRecord {
  capturedAt: string;
  outcome: ExperienceAttemptOutcome;
  stage: ExperienceAttemptStage;
  providerName?: string;
  verificationPass?: boolean;
  traceId?: string;
  strategy?: string;
  errorClass?: string;
  errorMessage?: string;
  toolContext?: string;
  providerFailureDiagnostics?: ExperienceProviderFailureDiagnostics;
}

export interface ExperienceRecord {
  id: string;
  tenant: string;
  team: string;
  user: string;
  signature: string;
  taskSignature: string;
  taskType: string;
  scenarioTags: string[];
  summary: string;
  keywords: string[];
  sop: string[];
  failureSignals: string[];
  reuseGuardrails: string[];
  attemptHistory: ExperienceAttemptRecord[];
  confidence: number;
  successCount: number;
  failureCount: number;
  recoverySuccessCount: number;
  consecutiveFailureCount: number;
  conflictCount: number;
  verificationPassCount: number;
  lastOutcome: "success" | "failure";
  lastFailureClass?: string;
  lastFailureStage?: ExperienceAttemptStage;
  lastProviderFailureDiagnostics?: ExperienceProviderFailureDiagnostics;
  lastSuccessStrategy?: string;
  state: ExperienceRecordState;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
  lastConflictAt?: string;
  conflictSignals: string[];
  evidence: ExperienceEvidence[];
}

export interface ExperiencePoolSnapshot {
  version: "v1";
  updatedAt: string;
  records: ExperienceRecord[];
}

export interface ExperienceSearchMatch {
  record: ExperienceRecord;
  score: number;
  matchedTokens: string[];
  matchedTaskSignals?: string[];
  matchedScenarioTags?: string[];
}

export interface ExperienceSearchInput {
  tenant: string;
  team?: string;
  user?: string;
  query: string;
  limit: number;
  includeStates?: ExperienceRecordState[];
}

export interface ExperienceUpsertSuccessInput {
  tenant: string;
  team: string;
  user: string;
  userText: string;
  assistantText: string;
  traceId?: string;
  providerName?: string;
  verificationPass: boolean;
  evidenceRef?: ExperienceEvidenceRef;
}

export interface ExperienceFeedbackFailureInput {
  tenant: string;
  team: string;
  user: string;
  userText: string;
  providerName?: string;
  errorClass: string;
  errorMessage: string;
  failureStage?: ExperienceAttemptStage;
  toolContext?: string;
  providerFailureDiagnostics?: ExperienceProviderFailureDiagnostics;
}

export interface ExperienceUpsertResult {
  record: ExperienceRecord;
  created: boolean;
}

export interface ExperienceFailureResult {
  matchedRecord?: ExperienceRecord;
  score?: number;
  quarantined: boolean;
  conflictIsolated?: boolean;
}
