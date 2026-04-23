export type Platform = "feishu" | "telegram";

export type SessionScope = "dm" | "group";

export type GatewayImpl = "ts";

export type RuntimeImpl = "rust";

export interface SessionKeyParts {
  platform: Platform;
  tenant: string;
  scope: SessionScope;
  subject: string;
}

export interface TurnRequest {
  requestId: string;
  sessionKey: string;
  userMessage: string;
  metadata: {
    platform: Platform;
    actorId: string;
    projectId: string;
  };
}

export interface RuntimeRequest {
  protocolVersion: "runtime.v1";
  requestId: string;
  sessionKey: string;
  userMessage: string;
  contextLines: string[];
  modelConfig?: RuntimeModelConfig;
  toolContext?: RuntimeToolContext;
  attachments?: RuntimeAttachment[];
  metadata: {
    platform: Platform;
    actorId: string;
    projectId: string;
    gatewayImpl: GatewayImpl;
    runtimeImpl: RuntimeImpl;
    shadowMode: boolean;
  };
}

export type RuntimeProviderKind = "openai_compatible" | "kimi";

export type KimiWebSearchMode =
  | "builtin_preferred"
  | "builtin_only"
  | "official_only"
  | "off";

export type RuntimePromptCacheStrategy = "user_last_n";
export type RuntimePromptCacheCapability = "anthropic_compatible" | "unsupported";

export interface RuntimePromptCacheOptions {
  enabled?: boolean;
  strategy?: RuntimePromptCacheStrategy;
  userLastN?: number;
  capability?: RuntimePromptCacheCapability;
}

export interface RuntimeKimiOptions {
  webSearchMode?: KimiWebSearchMode;
  disableThinkingOnBuiltinWebSearch?: boolean;
  officialToolsAllowlist?: string[];
  officialToolFormulas?: Record<string, string>;
  promptCache?: RuntimePromptCacheOptions;
  maxTokens?: number;
  stream?: boolean;
  temperature?: number;
  topP?: number;
  filesEnabled?: boolean;
  allowFileAdmin?: boolean;
}

export interface RuntimeProviderOptions {
  kimi?: RuntimeKimiOptions;
}

export interface RuntimeModelConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  providerKind?: RuntimeProviderKind;
  providerOptions?: RuntimeProviderOptions;
}

export interface RuntimeToolContext {
  workDir?: string;
  enabledTools?: string[];
  bashAllowlist?: string[];
  maxToolRounds?: number;
  noToolFallbackMode?: "off" | "safe" | "strict";
  maxRecoveryRounds?: number;
}

export type MemoryLevel = "L1" | "L2" | "L3" | "L4";

export interface MemoryEvidenceRef {
  traceId?: string;
  turnId?: string;
  toolCallId?: string;
  source?: string;
}

export interface MemoryWriteRequest {
  sessionKey: string;
  memoryLevel: MemoryLevel;
  sourceEventType: "turn_executed" | "tool_executed" | "checkpoint_updated" | "reflection_generated" | "ask_user_resolved";
  text: string;
  executionVerified: boolean;
  evidenceRef?: MemoryEvidenceRef;
  confidence?: number;
  tags?: string[];
}

export interface SkillCard {
  id: string;
  taskSignature: string;
  preconditions: string[];
  steps: string[];
  failureSignals: string[];
  rollback: string[];
  successEvidenceRefs: MemoryEvidenceRef[];
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

export interface AskUserEnvelope {
  questionId: string;
  blockingNodeId: string;
  question: string;
  options: string[];
  optionsDetailed?: RuntimeAskUserQuestionOption[];
  questionKey?: string;
  header?: string;
  questionIndex?: number;
  questionTotal?: number;
  defaultOnTimeout: string;
  resumeToken: string;
  createdAt: string;
}

export interface BrowserExtractResult {
  pageFingerprint: string;
  actionableNodes: Array<{
    id: string;
    role: string;
    text: string;
    selector: string;
  }>;
  stateTransients: string[];
  evidenceSnapshotRef: string;
  fallbackUsed: "none" | "cdp";
}

export type RuntimeAttachmentType = "file" | "image" | "video";
export type RuntimeAttachmentSourceType = "path" | "url" | "file_id";

export interface RuntimeAttachment {
  type: RuntimeAttachmentType;
  sourceType: RuntimeAttachmentSourceType;
  source: string;
  mimeType?: string;
  filename?: string;
}

export interface RuntimeAskUserInterrupt {
  blockingNodeId: string;
  questions: RuntimeAskUserQuestion[];
  defaultOnTimeout: string;
  resumeToken: string;
  createdAt: string;
}

export interface RuntimeAskUserQuestionOption {
  label: string;
  description?: string;
  value?: string;
}

export interface RuntimeAskUserQuestion {
  id: string;
  header: string;
  question: string;
  options: RuntimeAskUserQuestionOption[];
}

export interface RuntimeTurnInterrupt {
  kind: "ask_user";
  askUser: RuntimeAskUserInterrupt;
}

export type RuntimeEventType =
  | "turn_start"
  | "model_request"
  | "model_response"
  | "tool_start"
  | "tool_end"
  | "prompt_cache_hint_applied"
  | "prompt_cache_usage_observed"
  | "turn_stream_chunk"
  | "turn_interrupted"
  | "turn_end"
  | "turn_failed"
  | "session_resume"
  | "no_tool_fallback_triggered"
  | "no_tool_fallback_succeeded"
  | "no_tool_fallback_exhausted";

export interface RuntimeEvent {
  traceId: string;
  turnId: string;
  sessionKey: string;
  eventType: RuntimeEventType;
  payload: Record<string, unknown>;
  timestampIso: string;
}

export interface RuntimeTurnResult {
  traceId: string;
  runtimeLabel: string;
  assistantMessage: string;
  interrupt?: RuntimeTurnInterrupt;
  events: RuntimeEvent[];
}

export interface RuntimeExecuteOptions {
  signal?: AbortSignal;
}

export interface RuntimeClient {
  executeTurn(request: RuntimeRequest, options?: RuntimeExecuteOptions): Promise<RuntimeTurnResult>;
}

export interface TurnVerificationCheck {
  name: string;
  pass: boolean;
}

export interface TurnVerificationResult {
  pass: boolean;
  checks: TurnVerificationCheck[];
}

export interface TurnVerifier {
  verify(result: RuntimeTurnResult): Promise<TurnVerificationResult>;
}

export interface MigrationOptions {
  gatewayImpl: GatewayImpl;
  runtimeImpl: RuntimeImpl;
  shadowMode: boolean;
}

export interface ShadowComparison {
  assistantMessageMatch: boolean;
  eventCountDelta: number;
  runtimeLabel: string;
}

export type GovernanceDecision = "pass" | "review" | "block";

export interface GovernanceEvaluation {
  plane: "governance.v1";
  decision: GovernanceDecision;
  score: number;
  gatePassed: boolean;
  reasons: string[];
  suggestedAction: "none" | "manual_review";
}

export interface TurnExecutionReport {
  traceId: string;
  requestId: string;
  sessionKey: string;
  startedAtIso: string;
  finishedAtIso: string;
  primaryRuntime: string;
  assistantMessage: string;
  runtimeInterrupt?: RuntimeTurnInterrupt;
  verification: TurnVerificationResult;
  governance: GovernanceEvaluation;
  shadowComparison?: ShadowComparison;
  eventCount: number;
}
