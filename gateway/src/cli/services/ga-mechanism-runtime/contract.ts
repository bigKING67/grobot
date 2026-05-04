import {
  type AskUserEnvelope,
  type AskUserResolveResult,
} from "../../../tools/ask-user";

export const REFLECTION_COOLDOWN_MS = 5 * 60 * 1000;
export const REFLECTION_MIN_FAILURES = 2;
export const ASK_USER_HINT_COOLDOWN_MS = 2 * 60 * 1000;
export const ASK_USER_HINT_FAILURE_THRESHOLD = 2;
export const ASK_USER_PENDING_MAX_AGE_MS_DEFAULT = 6 * 60 * 60 * 1000;

export type GaMemoryLevel = "L1" | "L2" | "L3" | "L4";
export type GaSourceEventType =
  | "turn_executed"
  | "tool_executed"
  | "checkpoint_updated"
  | "reflection_generated"
  | "ask_user_resolved";

export interface GaEvidenceRef {
  traceId?: string;
  turnId?: string;
  toolCallId?: string;
  source?: string;
}

export interface GaMemoryWriteRequest {
  sessionKey: string;
  memoryLevel: GaMemoryLevel;
  text: string;
  sourceEventType: GaSourceEventType;
  executionVerified: boolean;
  evidenceRef?: GaEvidenceRef;
  tags?: string[];
  confidence?: number;
}

export interface GaMemoryRecord {
  id: string;
  sessionKey: string;
  memoryLevel: GaMemoryLevel;
  text: string;
  sourceEventType: GaSourceEventType;
  executionVerified: boolean;
  evidenceRef?: GaEvidenceRef;
  tags: string[];
  confidence: number;
  createdAt: string;
}

export interface GaMemoryWriteResult {
  ok: boolean;
  code: "OK" | "MEG_INVALID_TEXT" | "MEG_EXECUTION_REQUIRED" | "MEG_EVIDENCE_REQUIRED";
  message?: string;
  record?: GaMemoryRecord;
}

export interface SkillCard {
  id: string;
  sessionKey: string;
  taskSignature: string;
  preconditions: string[];
  steps: string[];
  failureSignals: string[];
  rollback: string[];
  successEvidenceRefs: GaEvidenceRef[];
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReflectionTask {
  id: string;
  sessionKey: string;
  triggerType: "repeated_failure" | "verification_failure";
  failureBundle: string[];
  insightSchemaVersion: "v1";
  nextActionHint: string;
  createdAt: string;
}

export interface RegisterTurnSuccessInput {
  sessionKey: string;
  userText: string;
  assistantText: string;
  traceId: string;
  providerName: string;
  verificationPass: boolean;
}

export interface RegisterTurnFailureInput {
  sessionKey: string;
  providerName: string;
  errorClass: string;
  errorMessage: string;
  traceId?: string;
}

export interface SessionFailureState {
  consecutiveFailures: number;
  recentErrors: string[];
  lastReflectionAtMs: number;
}

export interface GaSessionStateSnapshot {
  memory: GaMemoryRecord[];
  skillCards: SkillCard[];
  reflectionQueue: ReflectionTask[];
  pendingAskQueue?: AskUserEnvelope[];
  failureState?: SessionFailureState;
}

export interface GaMechanismRuntime {
  buildAskUserDisplay(envelope: AskUserEnvelope): string;
  purgeExpiredPendingAsk(sessionKey: string): AskUserEnvelope[];
  getPendingAsk(sessionKey: string): AskUserEnvelope | undefined;
  listPendingAsk(sessionKey: string): AskUserEnvelope[];
  getPendingAskQueueSize(sessionKey: string): number;
  registerPendingAsk(sessionKey: string, envelope: AskUserEnvelope): void;
  resolvePendingAsk(sessionKey: string, answer: string): AskUserResolveResult | undefined;
  hydrateSession(sessionKey: string, state: GaSessionStateSnapshot | undefined): void;
  snapshotSession(sessionKey: string): GaSessionStateSnapshot | undefined;
  writeMemory(request: GaMemoryWriteRequest): GaMemoryWriteResult;
  listMemory(sessionKey: string): GaMemoryRecord[];
  listSkillCards(sessionKey: string): SkillCard[];
  registerTurnSuccess(input: RegisterTurnSuccessInput): void;
  registerTurnFailure(input: RegisterTurnFailureInput): void;
  buildAskUserClarificationHint(sessionKey: string, userText: string): string;
  pullReflectionTasks(sessionKey: string): ReflectionTask[];
}
