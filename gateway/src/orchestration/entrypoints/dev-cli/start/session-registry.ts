import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SessionScope } from "../../../../models/types";
import {
  ChatHistoryMessage,
  compactSingleLine,
  normalizeHistoryMessages,
  trimHistoryMessages,
} from "./session-history";

export const SESSION_REGISTRY_VERSION = 1;
export const SESSION_REGISTRY_MAIN_ID = "main";
export const SESSION_KEY_INSTANCE_SEPARATOR = "__s_";
export const HISTORY_STORE_VERSION = 1;
export type SessionPlanMode = "normal" | "plan_only";

export interface SessionPlanMeta {
  active_plan_id?: string;
  active_plan_status?: "draft" | "approved" | "apply_failed" | "applied" | "discarded";
  active_plan_path?: string;
  active_plan_seq?: number;
  active_plan_title?: string;
  updated_at?: string;
}

export interface SessionProviderRuntimeState {
  provider_name: string;
  consecutive_failures: number;
  circuit_open_until_ms: number;
  last_error_class?: string;
  last_error_message?: string;
  last_failed_at?: string;
  last_succeeded_at?: string;
  ewma_latency_ms?: number;
  ewma_error_rate?: number;
}

export interface SessionRegistryRecord {
  id: string;
  session_key: string;
  created_at: string;
  updated_at: string;
  preview: string;
  sticky_provider?: string;
  provider_runtime_states?: SessionProviderRuntimeState[];
  plan_mode?: SessionPlanMode;
  plan_meta?: SessionPlanMeta;
}

export interface SessionRegistryPayload {
  version: number;
  namespace_key: string;
  active_id: string;
  sessions: SessionRegistryRecord[];
}

export interface LoadedSessionRegistry {
  registry: SessionRegistryPayload;
  warnings: string[];
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return undefined;
  }
  return normalized;
}

function parseNonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : 0;
}

function parseOptionalNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  if (value < 0) {
    return undefined;
  }
  return value;
}

function parsePlanMode(value: unknown): SessionPlanMode {
  if (value === "plan_only") {
    return "plan_only";
  }
  return "normal";
}

function parsePlanStatus(value: unknown): "draft" | "approved" | "apply_failed" | "applied" | "discarded" | undefined {
  if (value === "approved") {
    return "approved";
  }
  if (value === "apply_failed") {
    return "apply_failed";
  }
  if (value === "applied") {
    return "applied";
  }
  if (value === "discarded") {
    return "discarded";
  }
  if (value === "draft") {
    return "draft";
  }
  return undefined;
}

function normalizePlanMeta(raw: unknown): SessionPlanMeta | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const activePlanId = parseOptionalString(record.active_plan_id);
  const activePlanStatus = parsePlanStatus(record.active_plan_status);
  const activePlanPath = parseOptionalString(record.active_plan_path);
  const activePlanSeq = parseOptionalPositiveInt(record.active_plan_seq);
  const activePlanTitle = parseOptionalString(record.active_plan_title);
  const updatedAt = parseOptionalString(record.updated_at);
  if (!activePlanId && !activePlanPath && !activePlanSeq && !activePlanTitle && !activePlanStatus && !updatedAt) {
    return undefined;
  }
  return {
    active_plan_id: activePlanId,
    active_plan_status: activePlanStatus,
    active_plan_path: activePlanPath,
    active_plan_seq: activePlanSeq,
    active_plan_title: activePlanTitle,
    updated_at: updatedAt,
  };
}

function normalizeProviderRuntimeStates(raw: unknown): SessionProviderRuntimeState[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const states: SessionProviderRuntimeState[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const providerName = parseOptionalString(record.provider_name);
    if (!providerName) {
      continue;
    }
      states.push({
        provider_name: providerName,
        consecutive_failures: parseNonNegativeInt(record.consecutive_failures),
        circuit_open_until_ms: parseNonNegativeInt(record.circuit_open_until_ms),
        last_error_class: parseOptionalString(record.last_error_class),
        last_error_message: parseOptionalString(record.last_error_message),
        last_failed_at: parseOptionalString(record.last_failed_at),
        last_succeeded_at: parseOptionalString(record.last_succeeded_at),
        ewma_latency_ms: parseOptionalNonNegativeNumber(record.ewma_latency_ms),
        ewma_error_rate: parseOptionalNonNegativeNumber(record.ewma_error_rate),
      });
    }
  if (!states.length) {
    return undefined;
  }
  return states;
}

function fileReadable(path: string): boolean {
  try {
    const content = readFileSync(path, "utf8");
    return content.length >= 0;
  } catch {
    return false;
  }
}

function removeTrailingSlashes(value: string): string {
  if (/^[\\/]+$/.test(value)) {
    return value.startsWith("\\") ? "\\" : "/";
  }
  return value.replace(/[\\/]+$/, "");
}

function dirname(path: string): string {
  const normalized = removeTrailingSlashes(path);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function nowIsoUtc(): string {
  return new Date().toISOString();
}

function parseScope(raw: string | undefined): SessionScope {
  if (raw === "group") {
    return "group";
  }
  return "dm";
}

function sanitizeSessionSegment(raw: string, defaultValue: string, maxLen = 80): string {
  const cleaned = String(raw).trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  const resolved = cleaned.length > 0 ? cleaned : defaultValue;
  return resolved.slice(0, Math.max(1, maxLen));
}

function sanitizeSessionKey(sessionKey: string): string {
  return sessionKey.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function parseSessionKeyPartsLoose(
  sessionKey: string,
): [platform: string, tenant: string, scope: SessionScope, subject: string] | undefined {
  const tokens = sessionKey.split(":");
  if (tokens.length !== 4) {
    return undefined;
  }
  const [platform, tenant, scopeRaw, subject] = tokens;
  if (!platform || !tenant || !subject) {
    return undefined;
  }
  const scope = parseScope(scopeRaw);
  return [platform, tenant, scope, subject];
}

function sessionInstanceKey(namespaceKey: string, sessionId: string): string {
  const parsed = parseSessionKeyPartsLoose(namespaceKey);
  if (!parsed) {
    return namespaceKey;
  }
  const [platform, tenant, scope, subject] = parsed;
  if (sessionId === SESSION_REGISTRY_MAIN_ID) {
    return namespaceKey;
  }
  const safeId = sanitizeSessionSegment(sessionId, SESSION_REGISTRY_MAIN_ID, 24);
  return `${platform}:${tenant}:${scope}:${subject}${SESSION_KEY_INSTANCE_SEPARATOR}${safeId}`;
}

function generateSessionId(): string {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear().toString().padStart(4, "0"),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ].join("");
  const rand = Math.floor(Math.random() * 65_536).toString(16).padStart(4, "0");
  return `s${stamp}${rand}`;
}

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
      if (typeof row !== "object" || row === null) {
        continue;
      }
      const record = row as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      const sessionKey = typeof record.session_key === "string" ? record.session_key.trim() : "";
      if (!id || !sessionKey) {
        continue;
      }
      sessions.push({
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
      });
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

function sessionRegistryRoot(homeDir: string): string {
  return `${removeTrailingSlashes(homeDir)}/runtime/sessions`;
}

export function sessionRegistryFilePath(homeDir: string, namespaceKey: string): string {
  const root = sessionRegistryRoot(homeDir);
  return `${root}/${sanitizeSessionKey(namespaceKey)}.sessions.json`;
}

export function historyStoreFilePath(homeDir: string, sessionKey: string): string {
  const root = sessionRegistryRoot(homeDir);
  return `${root}/${sanitizeSessionKey(sessionKey)}.history.json`;
}

export function loadSessionRegistry(homeDir: string, namespaceKey: string): LoadedSessionRegistry {
  const path = sessionRegistryFilePath(homeDir, namespaceKey);
  const warnings: string[] = [];
  let raw: unknown = {};
  if (fileReadable(path)) {
    try {
      raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch (error) {
      warnings.push(`session registry parse failed (${path}): ${String(error)}`);
    }
  }
  const normalized = normalizeSessionRegistryPayload(raw, namespaceKey);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(normalized, undefined, 2)}\n`, "utf8");
  } catch (error) {
    warnings.push(`session registry write failed (${path}): ${String(error)}`);
  }
  return {
    registry: normalized,
    warnings,
  };
}

export function saveSessionRegistry(homeDir: string, namespaceKey: string, payload: SessionRegistryPayload): string[] {
  const warnings: string[] = [];
  const normalized = normalizeSessionRegistryPayload(payload, namespaceKey);
  const path = sessionRegistryFilePath(homeDir, namespaceKey);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(normalized, undefined, 2)}\n`, "utf8");
  } catch (error) {
    warnings.push(`session registry write failed (${path}): ${String(error)}`);
  }
  return warnings;
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

export function loadHistoryMessages(
  homeDir: string,
  sessionKey: string,
  maxTurns: number,
): {
  messages: ChatHistoryMessage[];
  source: "store" | "empty";
  warnings: string[];
} {
  const path = historyStoreFilePath(homeDir, sessionKey);
  const warnings: string[] = [];
  if (!fileReadable(path)) {
    return {
      messages: [],
      source: "empty",
      warnings,
    };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof raw !== "object" || raw === null) {
      return {
        messages: [],
        source: "empty",
        warnings: [`history payload is invalid object (${path})`],
      };
    }
    const payload = raw as Record<string, unknown>;
    const messages = trimHistoryMessages(normalizeHistoryMessages(payload.messages), maxTurns);
    return {
      messages,
      source: messages.length > 0 ? "store" : "empty",
      warnings,
    };
  } catch (error) {
    warnings.push(`history parse failed (${path}): ${String(error)}`);
    return {
      messages: [],
      source: "empty",
      warnings,
    };
  }
}

export function saveHistoryMessages(
  homeDir: string,
  sessionKey: string,
  historyMessages: ChatHistoryMessage[],
  maxTurns: number,
): string[] {
  const warnings: string[] = [];
  const path = historyStoreFilePath(homeDir, sessionKey);
  const normalized = trimHistoryMessages(historyMessages, maxTurns);
  const payload = {
    version: HISTORY_STORE_VERSION,
    session_key: sessionKey,
    updated_at: nowIsoUtc(),
    messages: normalized,
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(payload, undefined, 2)}\n`, "utf8");
  } catch (error) {
    warnings.push(`history write failed (${path}): ${String(error)}`);
  }
  return warnings;
}
