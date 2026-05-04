import { normalizeGaSessionStateSnapshot, type GaSessionStateSnapshot } from "../../services/ga-mechanism-runtime";
import { compactSingleLine } from "../session-history";
import {
  normalizePlanMeta,
  normalizeProviderRuntimeStates,
  parseOptionalString,
  parsePlanMode,
} from "./normalization";
import { nowIsoUtc } from "./scalars";
import {
  generateSessionId,
  sessionInstanceKey,
} from "./session-key";
import {
  SESSION_REGISTRY_MAIN_ID,
  SESSION_REGISTRY_VERSION,
  type SessionPlanMeta,
  type SessionPlanMode,
  type SessionProviderRuntimeState,
  type SessionRegistryPayload,
  type SessionRegistryRecord,
} from "./types";

export function createSessionRecord(namespaceKey: string, sessionId?: string): SessionRegistryRecord {
  const now = nowIsoUtc();
  const actualId = sessionId ?? generateSessionId();
  return {
    id: actualId,
    session_key: sessionInstanceKey(namespaceKey, actualId),
    created_at: now,
    updated_at: now,
    preview: "",
    plan_mode: "normal",
  };
}

export function normalizeSessionRegistryPayload(raw: unknown, namespaceKey: string): SessionRegistryPayload {
  const payload = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
  const sessionsRaw = payload.sessions;
  const sessions: SessionRegistryRecord[] = [];
  if (Array.isArray(sessionsRaw)) {
    for (const row of sessionsRaw) {
      const normalized = normalizeSessionRegistryRecord(row);
      if (normalized) {
        sessions.push(normalized);
      }
    }
  }
  if (sessions.length === 0) {
    sessions.push(createSessionRecord(namespaceKey, SESSION_REGISTRY_MAIN_ID));
  }
  const activeRaw = typeof payload.active_id === "string" ? payload.active_id.trim() : "";
  const activeId = sessions.some((item) => item.id === activeRaw) ? activeRaw : sessions[0].id;
  return {
    version: SESSION_REGISTRY_VERSION,
    namespace_key: namespaceKey,
    active_id: activeId,
    sessions,
  };
}

function normalizeSessionRegistryRecord(row: unknown): SessionRegistryRecord | undefined {
  if (typeof row !== "object" || row === null) {
    return undefined;
  }
  const record = row as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const sessionKey = typeof record.session_key === "string" ? record.session_key.trim() : "";
  if (!id || !sessionKey) {
    return undefined;
  }
  return {
    id,
    session_key: sessionKey,
    created_at: typeof record.created_at === "string" && record.created_at.trim().length > 0
      ? record.created_at
      : nowIsoUtc(),
    updated_at: typeof record.updated_at === "string" && record.updated_at.trim().length > 0
      ? record.updated_at
      : nowIsoUtc(),
    preview: typeof record.preview === "string" ? record.preview : "",
    sticky_provider: parseOptionalString(record.sticky_provider),
    provider_runtime_states: normalizeProviderRuntimeStates(record.provider_runtime_states),
    plan_mode: parsePlanMode(record.plan_mode),
    plan_meta: normalizePlanMeta(record.plan_meta),
    ga_state: normalizeGaSessionStateSnapshot(sessionKey, record.ga_state),
  };
}

export function findSessionRecord(
  payload: SessionRegistryPayload,
  sessionId: string,
): SessionRegistryRecord | undefined {
  return payload.sessions.find((item) => item.id === sessionId);
}

export function touchSessionRecord(payload: SessionRegistryPayload, sessionId: string, preview?: string): void {
  const index = payload.sessions.findIndex((item) => item.id === sessionId);
  if (index < 0) {
    return;
  }
  const now = nowIsoUtc();
  const record = payload.sessions[index];
  payload.sessions[index] = {
    ...record,
    updated_at: now,
    preview: typeof preview === "string" ? compactSingleLine(preview, 120) : record.preview,
  };
}

export function setSessionProviderRuntime(
  payload: SessionRegistryPayload,
  sessionId: string,
  routing: {
    stickyProvider?: string;
    providerRuntimeStates: readonly SessionProviderRuntimeState[];
  },
): void {
  const index = payload.sessions.findIndex((item) => item.id === sessionId);
  if (index < 0) {
    return;
  }
  const record = payload.sessions[index];
  const stickyProvider = parseOptionalString(routing.stickyProvider);
  const normalizedStates = normalizeProviderRuntimeStates(routing.providerRuntimeStates as unknown);
  payload.sessions[index] = {
    ...record,
    updated_at: nowIsoUtc(),
    sticky_provider: stickyProvider,
    provider_runtime_states: normalizedStates,
  };
}

export function setSessionPlanState(
  payload: SessionRegistryPayload,
  sessionId: string,
  planState: {
    planMode: SessionPlanMode;
    planMeta?: SessionPlanMeta;
  },
): void {
  const index = payload.sessions.findIndex((item) => item.id === sessionId);
  if (index < 0) {
    return;
  }
  const record = payload.sessions[index];
  payload.sessions[index] = {
    ...record,
    updated_at: nowIsoUtc(),
    plan_mode: planState.planMode,
    plan_meta: planState.planMeta,
  };
}

export function setSessionGaState(
  payload: SessionRegistryPayload,
  sessionId: string,
  gaState: GaSessionStateSnapshot | undefined,
): void {
  const index = payload.sessions.findIndex((item) => item.id === sessionId);
  if (index < 0) {
    return;
  }
  const record = payload.sessions[index];
  payload.sessions[index] = {
    ...record,
    updated_at: nowIsoUtc(),
    ga_state: gaState,
  };
}
