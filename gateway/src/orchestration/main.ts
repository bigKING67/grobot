import { SimpleContextAssembler } from "../models/context/context-assembler";
import { resolveMigrationOptions } from "./migration";
import { AgentLoop } from "./orchestrator/agent-loop";
import { DeterministicRuntimeClient, BasicTurnVerifier } from "../tools/runtime/client";
import { StdioRustRuntimeClient } from "../tools/runtime/stdio-client";
import { buildSessionKey } from "../models/session-key";
import { InMemorySessionPersister } from "../tools/state/session-persister";
import {
  MigrationOptions,
  RuntimeModelConfig,
  RuntimeToolContext,
  RuntimeEvent,
  SessionKeyParts,
  TurnExecutionReport,
  TurnRequest,
} from "../models/types";

export interface GatewayContext {
  actorId: string;
  projectId: string;
}

export interface GatewayRuntimeOptions {
  modelConfig?: RuntimeModelConfig;
  toolContext?: RuntimeToolContext;
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
  runtimeOptions?: GatewayRuntimeOptions,
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

  return loop.runTurn(turn, migration, runtimeOptions?.modelConfig, runtimeOptions?.toolContext);
}
