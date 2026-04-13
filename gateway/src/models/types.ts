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
  metadata: {
    platform: Platform;
    actorId: string;
    projectId: string;
    gatewayImpl: GatewayImpl;
    runtimeImpl: RuntimeImpl;
    shadowMode: boolean;
  };
}

export interface RuntimeModelConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

export type RuntimeEventType =
  | "turn_start"
  | "model_request"
  | "model_response"
  | "tool_start"
  | "tool_end"
  | "turn_stream_chunk"
  | "turn_end"
  | "turn_failed"
  | "session_resume";

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
  events: RuntimeEvent[];
}

export interface RuntimeClient {
  executeTurn(request: RuntimeRequest): Promise<RuntimeTurnResult>;
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
  verification: TurnVerificationResult;
  governance: GovernanceEvaluation;
  shadowComparison?: ShadowComparison;
  eventCount: number;
}
