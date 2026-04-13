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

export interface SessionRegistryRecord {
  id: string;
  session_key: string;
  created_at: string;
  updated_at: string;
  preview: string;
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
