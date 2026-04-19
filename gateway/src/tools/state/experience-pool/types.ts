export type ExperienceRecordState = "active" | "quarantined" | "disabled";

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
}

export interface ExperienceRecord {
  id: string;
  tenant: string;
  team: string;
  user: string;
  signature: string;
  summary: string;
  keywords: string[];
  sop: string[];
  failureSignals: string[];
  confidence: number;
  successCount: number;
  failureCount: number;
  conflictCount: number;
  verificationPassCount: number;
  lastOutcome: "success" | "failure";
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
