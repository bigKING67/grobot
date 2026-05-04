import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SESSION_KEY_INSTANCE_SEPARATOR,
  SESSION_REGISTRY_MAIN_ID,
  SESSION_REGISTRY_VERSION,
} from "./constants.mjs";
import {
  isObject,
  normalizeSessionScope,
  nowIsoUtc,
  parseSessionKeyParts,
  pathDirname,
  pathJoin,
  sanitizeSessionKey,
  sanitizeSessionSegment,
} from "./shared.mjs";

export function buildSessionKey(projectName, platform, scopeRaw, subjectRaw) {
  const tenant = sanitizeSessionSegment(projectName, "default", 40);
  const scope = normalizeSessionScope(scopeRaw);
  const subject = sanitizeSessionSegment(subjectRaw, "local", 80);
  return `${platform}:${tenant}:${scope}:${subject}`;
}

function sessionInstanceKey(namespaceKey, sessionId) {
  const parsed = parseSessionKeyParts(namespaceKey);
  if (parsed === null) {
    return namespaceKey;
  }
  const [platform, tenant, scope, subject] = parsed;
  if (sessionId === SESSION_REGISTRY_MAIN_ID) {
    return namespaceKey;
  }
  const safeId = sanitizeSessionSegment(sessionId, SESSION_REGISTRY_MAIN_ID, 24);
  return `${platform}:${tenant}:${scope}:${subject}${SESSION_KEY_INSTANCE_SEPARATOR}${safeId}`;
}

function generateSessionId() {
  const now = /* @__PURE__ */ new Date();
  const stamp = [
    now.getUTCFullYear().toString().padStart(4, "0"),
    (now.getUTCMonth() + 1).toString().padStart(2, "0"),
    now.getUTCDate().toString().padStart(2, "0"),
    now.getUTCHours().toString().padStart(2, "0"),
    now.getUTCMinutes().toString().padStart(2, "0"),
    now.getUTCSeconds().toString().padStart(2, "0"),
  ].join("");
  const rand = Math.floor(Math.random() * 65536).toString(16).padStart(4, "0");
  return `s${stamp}${rand}`;
}

function createSessionRecord(namespaceKey, sessionId) {
  const actualId = sessionId ?? generateSessionId();
  const now = nowIsoUtc();
  return {
    id: actualId,
    session_key: sessionInstanceKey(namespaceKey, actualId),
    created_at: now,
    updated_at: now,
    preview: "",
  };
}

function appendSessionRecord(payload, record) {
  const sessionsRaw = payload.sessions;
  if (!Array.isArray(sessionsRaw)) {
    payload.sessions = [record];
    return;
  }
  sessionsRaw.push(record);
}

function findSessionRecord(payload, sessionId) {
  const sessionsRaw = payload.sessions;
  if (!Array.isArray(sessionsRaw)) {
    return null;
  }
  for (const item of sessionsRaw) {
    if (!isObject(item)) {
      continue;
    }
    if (item.id === sessionId) {
      return item;
    }
  }
  return null;
}

function normalizeSessionRegistryPayload(rawPayload, namespaceKey) {
  const payload = isObject(rawPayload) ? rawPayload : {};
  const sessionsRaw = payload.sessions;
  const sessions = [];
  if (Array.isArray(sessionsRaw)) {
    for (const item of sessionsRaw) {
      if (!isObject(item)) {
        continue;
      }
      const sessionId = typeof item.id === "string" ? item.id.trim() : "";
      const sessionKey = typeof item.session_key === "string" ? item.session_key.trim() : "";
      if (!sessionId || !sessionKey) {
        continue;
      }
      sessions.push({
        id: sessionId,
        session_key: sessionKey,
        created_at: String(item.created_at ?? nowIsoUtc()),
        updated_at: String(item.updated_at ?? nowIsoUtc()),
        preview: String(item.preview ?? ""),
      });
    }
  }
  if (sessions.length === 0) {
    const now = nowIsoUtc();
    sessions.push({
      id: SESSION_REGISTRY_MAIN_ID,
      session_key: namespaceKey,
      created_at: now,
      updated_at: now,
      preview: "",
    });
  }
  const activeIdRaw = typeof payload.active_id === "string" ? payload.active_id : "";
  const activeId = sessions.some((item) => item.id === activeIdRaw)
    ? activeIdRaw
    : String(sessions[0]?.id ?? SESSION_REGISTRY_MAIN_ID);
  return {
    version: SESSION_REGISTRY_VERSION,
    namespace_key: namespaceKey,
    active_id: activeId,
    sessions,
  };
}

function readJsonFile(path) {
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function writeJsonFile(path, payload) {
  mkdirSync(pathDirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, void 0, 2)}\n`, "utf8");
}

function sessionRegistryFilePath(root, namespaceKey) {
  return pathJoin(root, `${sanitizeSessionKey(namespaceKey)}.sessions.json`);
}

function loadSessionRegistry(root, namespaceKey) {
  const warnings = [];
  const path = sessionRegistryFilePath(root, namespaceKey);
  const loaded = readJsonFile(path);
  const normalized = normalizeSessionRegistryPayload(loaded, namespaceKey);
  try {
    writeJsonFile(path, normalized);
  } catch (error) {
    warnings.push(`session registry write failed: ${String(error)}`);
  }
  return { registry: normalized, warnings };
}

function saveSessionRegistry(root, namespaceKey, payload) {
  const warnings = [];
  const normalized = normalizeSessionRegistryPayload(payload, namespaceKey);
  const path = sessionRegistryFilePath(root, namespaceKey);
  try {
    writeJsonFile(path, normalized);
  } catch (error) {
    warnings.push(`session registry write failed: ${String(error)}`);
  }
  return warnings;
}

export function runSessionRegistryFlow(root, namespaceKey) {
  const resolvedRoot = resolve(root);
  mkdirSync(resolvedRoot, { recursive: true });
  const initial = loadSessionRegistry(resolvedRoot, namespaceKey);
  const initialActiveId = initial.registry.active_id;
  const initialMain = findSessionRecord(initial.registry, SESSION_REGISTRY_MAIN_ID);
  const newRecord = createSessionRecord(namespaceKey);
  appendSessionRecord(initial.registry, newRecord);
  initial.registry.active_id = newRecord.id;
  const saveWarnings = saveSessionRegistry(resolvedRoot, namespaceKey, initial.registry);
  const restored = loadSessionRegistry(resolvedRoot, namespaceKey);
  const restoredSessions = Array.isArray(restored.registry.sessions) ? restored.registry.sessions : [];
  return {
    initial_warnings: initial.warnings,
    initial_active_id: initialActiveId,
    initial_main_session_key: isObject(initialMain) ? initialMain.session_key : null,
    save_warnings: saveWarnings,
    restored_warnings: restored.warnings,
    restored_active_id: restored.registry.active_id,
    restored_session_count: restoredSessions.length,
    new_record: newRecord,
  };
}

export function prepareRegistry(root, namespaceKey, sessionKey) {
  const resolvedRoot = resolve(root);
  mkdirSync(resolvedRoot, { recursive: true });
  const rawPayload = {
    namespace_key: namespaceKey,
    active_id: SESSION_REGISTRY_MAIN_ID,
    sessions: [
      {
        id: SESSION_REGISTRY_MAIN_ID,
        session_key: sessionKey,
      },
    ],
  };
  const normalized = normalizeSessionRegistryPayload(rawPayload, namespaceKey);
  const warnings = saveSessionRegistry(resolvedRoot, namespaceKey, normalized);
  return {
    warnings,
    registry_path: sessionRegistryFilePath(resolvedRoot, namespaceKey),
    payload: normalized,
  };
}
