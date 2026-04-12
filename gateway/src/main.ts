import { SimpleContextAssembler } from "./context/context-assembler";
import { resolveMigrationOptions } from "./migration";
import { AgentLoop } from "./orchestrator/agent-loop";
import { DeterministicRuntimeClient, BasicTurnVerifier } from "./runtime/client";
import { StdioRustRuntimeClient } from "./runtime/stdio-client";
import { buildSessionKey } from "./session-key";
import { InMemorySessionPersister } from "./state/session-persister";
import {
  MigrationOptions,
  RuntimeEvent,
  SessionKeyParts,
  TurnExecutionReport,
  TurnRequest,
} from "./types";

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

export async function runGatewayTurn(
  userMessage: string,
  session: SessionKeyParts,
  context: GatewayContext,
  migrationOverrides?: Partial<MigrationOptions>,
): Promise<TurnExecutionReport> {
  const migration = resolveMigrationOptions(migrationOverrides);
  const turn = createTurnRequest(userMessage, session, context);
  const runtimeClient =
    migration.runtimeImpl === "rust"
      ? new StdioRustRuntimeClient()
      : new DeterministicRuntimeClient(migration.runtimeImpl);

  const loop = new AgentLoop({
    contextAssembler: new SimpleContextAssembler(),
    runtimeClient,
    shadowRuntimeClient: migration.shadowMode
      ? new DeterministicRuntimeClient("shadow-python")
      : undefined,
    verifier: new BasicTurnVerifier(),
    persister: new InMemorySessionPersister(),
  });

  return loop.runTurn(turn, migration);
}
