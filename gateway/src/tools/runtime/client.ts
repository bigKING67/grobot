import {
  RuntimeClient,
  RuntimeExecuteOptions,
  RuntimeEvent,
  RuntimeRequest,
  RuntimeTurnResult,
  TurnVerifier,
  TurnVerificationResult,
} from "../../models/types";

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

  public async executeTurn(request: RuntimeRequest, options?: RuntimeExecuteOptions): Promise<RuntimeTurnResult> {
    if (options?.signal?.aborted) {
      throw new Error("runtime turn interrupted class=turn_interrupted detail=aborted_before_runtime_call");
    }
    const traceId = `trace_${request.requestId}`;
    const turnId = `turn_${request.requestId}`;
    const responseText =
      `[${this.runtimeLabel}] ${request.userMessage}` +
      (request.contextLines.length > 0 ? ` (ctx:${request.contextLines.length})` : "");

    const events = [
      buildEvent(traceId, turnId, request.sessionKey, "turn_start", {
        requestId: request.requestId,
      }),
      buildEvent(traceId, turnId, request.sessionKey, "model_response", {
        chars: responseText.length,
      }),
      buildEvent(traceId, turnId, request.sessionKey, "turn_end", {
        status: "ok",
      }),
    ];
    if (options?.streamEvents && options.onEvent) {
      for (const event of events) {
        options.onEvent(event);
      }
    }

    return {
      traceId,
      runtimeLabel: this.runtimeLabel,
      assistantMessage: responseText,
      events,
    };
  }
}

export class BasicTurnVerifier implements TurnVerifier {
  public async verify(result: RuntimeTurnResult): Promise<TurnVerificationResult> {
    const hasAskUserInterrupt = result.interrupt?.kind === "ask_user";
    const checks = [
      {
        name: "assistant_message_non_empty",
        pass: hasAskUserInterrupt || result.assistantMessage.trim().length > 0,
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
