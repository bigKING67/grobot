import {
  AgentLoop,
  type TurnContextAssembler,
  type TurnPersister,
} from "../../orchestration/orchestrator/agent-loop";
import {
  serializeTurnGateSnapshot,
  TurnGate,
  TurnGateReentrantError,
  TurnGateStaleLeaseError,
  type TurnGateLease,
} from "../../orchestration/orchestrator/turn-gate";
import {
  type MigrationOptions,
  type RuntimeClient,
  type RuntimeRequest,
  type RuntimeTurnResult,
  type TurnExecutionReport,
  type TurnRequest,
  type TurnVerifier,
} from "../../models/types";

const migration: MigrationOptions = {
  gatewayImpl: "ts",
  runtimeImpl: "rust",
  shadowMode: false,
};

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected=${String(expected)} actual=${String(actual)}`);
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, delayMs));
}

function buildTurn(requestId: string, sessionKey: string): TurnRequest {
  return {
    requestId,
    sessionKey,
    userMessage: `contract turn ${requestId}`,
    metadata: {
      platform: "feishu",
      actorId: "contract",
      projectId: "grobot",
    },
  };
}

function buildRuntimeResult(request: RuntimeRequest): RuntimeTurnResult {
  return {
    traceId: `trace_${request.requestId}`,
    runtimeLabel: "contract-runtime",
    assistantMessage: `ok:${request.requestId}`,
    events: [{
      traceId: `trace_${request.requestId}`,
      turnId: `turn_${request.requestId}`,
      sessionKey: request.sessionKey,
      eventType: "turn_start",
      payload: {
        request_id: request.requestId,
      },
      timestampIso: new Date().toISOString(),
    }],
  };
}

class ContractContextAssembler implements TurnContextAssembler {
  private readonly delayMs: number;

  public constructor(delayMs = 0) {
    this.delayMs = delayMs;
  }

  public async assemble(turn: TurnRequest): Promise<string[]> {
    if (this.delayMs > 0) {
      await sleep(this.delayMs);
    }
    return [`context:${turn.requestId}`];
  }
}

class ContractRuntimeClient implements RuntimeClient {
  private readonly delayMs: number;
  public calls = 0;

  public constructor(delayMs = 0) {
    this.delayMs = delayMs;
  }

  public async executeTurn(request: RuntimeRequest): Promise<RuntimeTurnResult> {
    this.calls += 1;
    if (this.delayMs > 0) {
      await sleep(this.delayMs);
    }
    return buildRuntimeResult(request);
  }
}

class ContractVerifier implements TurnVerifier {
  public async verify(): Promise<{ pass: true; checks: [{ name: string; pass: true }] }> {
    return {
      pass: true,
      checks: [{
        name: "contract",
        pass: true,
      }],
    };
  }
}

class ContractPersister implements TurnPersister {
  public reports: TurnExecutionReport[] = [];

  public async persist(report: TurnExecutionReport): Promise<void> {
    this.reports.push(report);
  }
}

function createLoop(input: {
  turnGate: TurnGate;
  contextDelayMs?: number;
  runtimeDelayMs?: number;
  persister?: ContractPersister;
}): {
    loop: AgentLoop;
    runtimeClient: ContractRuntimeClient;
    persister: ContractPersister;
  } {
  const runtimeClient = new ContractRuntimeClient(input.runtimeDelayMs ?? 0);
  const persister = input.persister ?? new ContractPersister();
  return {
    runtimeClient,
    persister,
    loop: new AgentLoop({
      contextAssembler: new ContractContextAssembler(input.contextDelayMs ?? 0),
      runtimeClient,
      verifier: new ContractVerifier(),
      persister,
      turnGate: input.turnGate,
    }),
  };
}

async function main(): Promise<void> {
  const turnGate = new TurnGate();
  const persister = new ContractPersister();
  const sessionA = "feishu:contract:dm:turn-gate-a";
  const sessionB = "feishu:contract:dm:turn-gate-b";
  const loopA = createLoop({
    turnGate,
    runtimeDelayMs: 80,
    persister,
  });
  const loopB = createLoop({
    turnGate,
    runtimeDelayMs: 20,
    persister,
  });

  const firstPromise = loopA.loop.runTurn(buildTurn("req_first", sessionA), migration);
  await sleep(10);
  const activeSnapshot = turnGate.snapshot();
  let reentrantRejected = false;
  let reentrantErrorClass = "";
  try {
    await loopA.loop.runTurn(buildTurn("req_reentrant", sessionA), migration);
  } catch (error) {
    reentrantRejected = error instanceof TurnGateReentrantError;
    reentrantErrorClass = error instanceof TurnGateReentrantError
      ? error.errorClass
      : "";
  }

  const differentSessionReport = await loopB.loop.runTurn(buildTurn("req_other", sessionB), migration);
  const firstReport = await firstPromise;
  const afterSnapshot = turnGate.snapshot();

  const forcedGate = new TurnGate();
  const forcedLease = forcedGate.reserve(sessionA, "req_force");
  forcedGate.start(forcedLease);
  forcedGate.forceEnd(sessionA);
  const staleEndReturned = forcedGate.end(forcedLease);
  const staleSnapshot = forcedGate.snapshot();

  const staleStartGate = new TurnGate();
  const staleStartLease: TurnGateLease = staleStartGate.reserve(sessionA, "req_stale_start");
  staleStartGate.forceEnd(sessionA);
  let staleStartError = false;
  try {
    if (!staleStartGate.start(staleStartLease)) {
      throw new TurnGateStaleLeaseError(staleStartLease);
    }
  } catch (error) {
    staleStartError = error instanceof TurnGateStaleLeaseError
      && error.errorClass === "turn_gate_stale_lease";
  }

  const serialized = serializeTurnGateSnapshot(staleSnapshot);

  assertEqual(activeSnapshot.activeSessions, 1, "first turn should mark session active");
  assertCondition(
    activeSnapshot.sessions.some((session) =>
      session.sessionKey === sessionA && session.status !== "idle"),
    "active snapshot should include running session",
  );
  assertEqual(reentrantRejected, true, "same-session reentrant turn should reject");
  assertEqual(reentrantErrorClass, "turn_gate_reentrant", "reentrant error class");
  assertEqual(differentSessionReport.sessionKey, sessionB, "different session should run");
  assertEqual(firstReport.sessionKey, sessionA, "first session should finish");
  assertEqual(loopA.runtimeClient.calls, 1, "reentrant rejection should not call runtime");
  assertEqual(afterSnapshot.activeSessions, 0, "all sessions should be idle after completion");
  assertEqual(afterSnapshot.rejectedReentrantTotal, 1, "reentrant counter");
  assertEqual(staleEndReturned, false, "stale end should return false");
  assertEqual(staleSnapshot.staleCleanupTotal, 1, "stale cleanup counter");
  assertEqual(staleStartError, true, "stale start should be typed");
  assertEqual(serialized.stale_cleanup_total, 1, "serialized stale cleanup");
  assertEqual(Array.isArray(serialized.sessions), true, "serialized sessions");

  process.stdout.write(`${JSON.stringify({
    first_same_session_active: activeSnapshot.activeSessions === 1,
    reentrant_rejected: reentrantRejected,
    reentrant_error_class: reentrantErrorClass,
    different_session_completed: differentSessionReport.sessionKey === sessionB,
    runtime_call_count_after_reject: loopA.runtimeClient.calls,
    final_active_sessions: afterSnapshot.activeSessions,
    rejected_reentrant_total: afterSnapshot.rejectedReentrantTotal,
    stale_end_returned: staleEndReturned,
    stale_cleanup_total: staleSnapshot.staleCleanupTotal,
    stale_start_typed: staleStartError,
    serialized_has_snake_case:
      typeof serialized.active_sessions === "number"
      && typeof serialized.rejected_reentrant_total === "number",
    persisted_reports: persister.reports.length,
  })}\n`);
}

void main().catch((error) => {
  process.stderr.write(`turn-gate-contract failed: ${String(error)}\n`);
  process.exitCode = 1;
});
