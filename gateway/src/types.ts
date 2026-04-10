export type Platform = "feishu" | "telegram";

export type SessionScope = "dm" | "group";

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
