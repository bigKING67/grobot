import type { SessionScope } from "../../../models/types";
import {
  SESSION_KEY_INSTANCE_SEPARATOR,
  SESSION_REGISTRY_MAIN_ID,
  type SessionKeyParts,
} from "./types";

function parseScope(raw: string | undefined): SessionScope {
  if (raw === "group") {
    return "group";
  }
  return "dm";
}

export function sanitizeSessionSegment(raw: string, defaultValue: string, maxLen = 80): string {
  const cleaned = String(raw).trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  const resolved = cleaned.length > 0 ? cleaned : defaultValue;
  return resolved.slice(0, Math.max(1, maxLen));
}

export function sanitizeSessionKey(sessionKey: string): string {
  return sessionKey.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function parseSessionKeyPartsLoose(sessionKey: string): SessionKeyParts | undefined {
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

export function sessionInstanceKey(namespaceKey: string, sessionId: string): string {
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

export function generateSessionId(): string {
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
