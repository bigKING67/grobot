import {
  RuntimeClient,
  RuntimeEvent,
  RuntimeRequest,
  RuntimeTurnResult,
  TurnVerifier,
  TurnVerificationResult,
} from "../types";

function buildEvent(
  traceId: string,
  turnId: string,
  sessionKey: string,
  eventType: RuntimeEvent["eventType"],
  payload: Record<string, unknown>,
): RuntimeEvent {
  return {
    traceId,
    turnId,
    sessionKey,
    eventType,
    payload,
    timestampIso: new Date().toISOString(),
  };
}

export class DeterministicRuntimeClient implements RuntimeClient {
  private readonly runtimeLabel: string;

  public constructor(runtimeLabel: string) {
    this.runtimeLabel = runtimeLabel;
  }

  public async executeTurn(request: RuntimeRequest): Promise<RuntimeTurnResult> {
    const traceId = `trace_${request.requestId}`;
    const turnId = `turn_${request.requestId}`;
    const responseText =
      `[${this.runtimeLabel}] ${request.userMessage}` +
      (request.contextLines.length > 0 ? ` (ctx:${request.contextLines.length})` : "");

    return {
      traceId,
      runtimeLabel: this.runtimeLabel,
      assistantMessage: responseText,
      events: [
        buildEvent(traceId, turnId, request.sessionKey, "turn_start", {
          requestId: request.requestId,
        }),
        buildEvent(traceId, turnId, request.sessionKey, "model_response", {
          chars: responseText.length,
        }),
        buildEvent(traceId, turnId, request.sessionKey, "turn_end", {
          status: "ok",
        }),
      ],
    };
  }
}

export class BasicTurnVerifier implements TurnVerifier {
  public async verify(result: RuntimeTurnResult): Promise<TurnVerificationResult> {
    const checks = [
      {
        name: "assistant_message_non_empty",
        pass: result.assistantMessage.trim().length > 0,
      },
      {
        name: "has_terminal_event",
        pass: result.events.some((event) => event.eventType === "turn_end"),
      },
    ];

    return {
      pass: checks.every((check) => check.pass),
      checks,
    };
  }
}
