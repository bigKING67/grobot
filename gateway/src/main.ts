import { buildSessionKey } from "./session-key";
import { RuntimeEvent, SessionKeyParts, TurnRequest } from "./types";

export interface GatewayContext {
  actorId: string;
  projectId: string;
}

export function createTurnRequest(
  userMessage: string,
  session: SessionKeyParts,
  context: GatewayContext,
): TurnRequest {
  return {
    requestId: `req_${Date.now()}`,
    sessionKey: buildSessionKey(session),
    userMessage,
    metadata: {
      platform: session.platform,
      actorId: context.actorId,
      projectId: context.projectId,
    },
  };
}

export function makeTurnStartEvent(turn: TurnRequest): RuntimeEvent {
  return {
    traceId: `trace_${Date.now()}`,
    turnId: `turn_${Date.now()}`,
    sessionKey: turn.sessionKey,
    eventType: "turn_start",
    payload: {
      requestId: turn.requestId,
      projectId: turn.metadata.projectId,
    },
    timestampIso: new Date().toISOString(),
  };
}
