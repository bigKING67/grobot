export type TurnGateStatus = "idle" | "dispatching" | "running";

export interface TurnGateSessionSnapshot {
  sessionKey: string;
  status: TurnGateStatus;
  generation: number;
  activeRequestId?: string;
  activeSinceIso?: string;
  updatedAtIso?: string;
}

export interface TurnGateSnapshot {
  activeSessions: number;
  trackedSessions: number;
  rejectedReentrantTotal: number;
  staleCleanupTotal: number;
  sessions: TurnGateSessionSnapshot[];
}

export interface SerializedTurnGateSessionSnapshot {
  session_key: string;
  status: TurnGateStatus;
  generation: number;
  active_request_id: string | null;
  active_since_iso: string | null;
  updated_at_iso: string | null;
}

export interface SerializedTurnGateSnapshot {
  active_sessions: number;
  tracked_sessions: number;
  rejected_reentrant_total: number;
  stale_cleanup_total: number;
  sessions: SerializedTurnGateSessionSnapshot[];
}

interface TurnGateSessionState {
  status: TurnGateStatus;
  generation: number;
  activeRequestId?: string;
  activeSinceIso?: string;
  updatedAtIso?: string;
}

export interface TurnGateLease {
  sessionKey: string;
  requestId: string;
  generation: number;
}

export class TurnGateReentrantError extends Error {
  public readonly errorClass = "turn_gate_reentrant";
  public readonly sessionKey: string;
  public readonly requestId: string;
  public readonly status: TurnGateStatus;
  public readonly activeRequestId?: string;
  public readonly generation: number;

  public constructor(input: {
    sessionKey: string;
    requestId: string;
    status: TurnGateStatus;
    activeRequestId?: string;
    generation: number;
  }) {
    super(
      `turn gate rejected reentrant turn class=turn_gate_reentrant session=${input.sessionKey} request=${input.requestId} active=${input.activeRequestId ?? "<none>"} status=${input.status}`,
    );
    this.name = "TurnGateReentrantError";
    this.sessionKey = input.sessionKey;
    this.requestId = input.requestId;
    this.status = input.status;
    this.activeRequestId = input.activeRequestId;
    this.generation = input.generation;
  }
}

export class TurnGateStaleLeaseError extends Error {
  public readonly errorClass = "turn_gate_stale_lease";
  public readonly sessionKey: string;
  public readonly requestId: string;
  public readonly generation: number;

  public constructor(input: TurnGateLease) {
    super(
      `turn gate lease became stale class=turn_gate_stale_lease session=${input.sessionKey} request=${input.requestId} generation=${String(input.generation)}`,
    );
    this.name = "TurnGateStaleLeaseError";
    this.sessionKey = input.sessionKey;
    this.requestId = input.requestId;
    this.generation = input.generation;
  }
}

export class TurnGate {
  private readonly sessions = new Map<string, TurnGateSessionState>();
  private rejectedReentrantTotal = 0;
  private staleCleanupTotal = 0;

  public reserve(sessionKey: string, requestId: string): TurnGateLease {
    const state = this.sessions.get(sessionKey) ?? {
      status: "idle" as TurnGateStatus,
      generation: 0,
    };
    if (state.status !== "idle") {
      this.rejectedReentrantTotal += 1;
      throw new TurnGateReentrantError({
        sessionKey,
        requestId,
        status: state.status,
        activeRequestId: state.activeRequestId,
        generation: state.generation,
      });
    }

    const generation = state.generation + 1;
    this.sessions.set(sessionKey, {
      status: "dispatching",
      generation,
      activeRequestId: requestId,
      activeSinceIso: new Date().toISOString(),
      updatedAtIso: new Date().toISOString(),
    });
    return { sessionKey, requestId, generation };
  }

  public start(lease: TurnGateLease): boolean {
    const state = this.sessions.get(lease.sessionKey);
    if (!state || state.generation !== lease.generation) {
      return false;
    }
    if (state.status === "running") {
      return true;
    }
    if (state.status !== "dispatching") {
      return false;
    }
    this.sessions.set(lease.sessionKey, {
      ...state,
      status: "running",
      updatedAtIso: new Date().toISOString(),
    });
    return true;
  }

  public end(lease: TurnGateLease): boolean {
    const state = this.sessions.get(lease.sessionKey);
    if (!state || state.generation !== lease.generation) {
      this.staleCleanupTotal += 1;
      return false;
    }
    if (state.status === "idle") {
      return false;
    }
    this.sessions.set(lease.sessionKey, {
      status: "idle",
      generation: state.generation,
      updatedAtIso: new Date().toISOString(),
    });
    return true;
  }

  public forceEnd(sessionKey: string): void {
    const state = this.sessions.get(sessionKey);
    if (!state) {
      this.sessions.set(sessionKey, {
        status: "idle",
        generation: 1,
        updatedAtIso: new Date().toISOString(),
      });
      return;
    }
    this.sessions.set(sessionKey, {
      status: "idle",
      generation: state.generation + 1,
      updatedAtIso: new Date().toISOString(),
    });
  }

  public snapshot(): TurnGateSnapshot {
    const sessions = [...this.sessions.entries()].map(([sessionKey, state]) => ({
      sessionKey,
      status: state.status,
      generation: state.generation,
      activeRequestId: state.activeRequestId,
      activeSinceIso: state.activeSinceIso,
      updatedAtIso: state.updatedAtIso,
    }));
    return {
      activeSessions: sessions.filter((item) => item.status !== "idle").length,
      trackedSessions: sessions.length,
      rejectedReentrantTotal: this.rejectedReentrantTotal,
      staleCleanupTotal: this.staleCleanupTotal,
      sessions,
    };
  }
}

export const GLOBAL_TURN_GATE = new TurnGate();

export function serializeTurnGateSnapshot(snapshot: TurnGateSnapshot): SerializedTurnGateSnapshot {
  return {
    active_sessions: snapshot.activeSessions,
    tracked_sessions: snapshot.trackedSessions,
    rejected_reentrant_total: snapshot.rejectedReentrantTotal,
    stale_cleanup_total: snapshot.staleCleanupTotal,
    sessions: snapshot.sessions.map((session) => ({
      session_key: session.sessionKey,
      status: session.status,
      generation: session.generation,
      active_request_id: session.activeRequestId ?? null,
      active_since_iso: session.activeSinceIso ?? null,
      updated_at_iso: session.updatedAtIso ?? null,
    })),
  };
}
