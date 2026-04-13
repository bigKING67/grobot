import { Platform, SessionKeyParts, SessionScope } from "./types";

const SESSION_KEY_PART_COUNT = 4;

function isPlatform(value: string): value is Platform {
  return value === "feishu" || value === "telegram";
}

function isScope(value: string): value is SessionScope {
  return value === "dm" || value === "group";
}

function assertNoColon(value: string, fieldName: string): void {
  if (!value || value.includes(":")) {
    throw new Error(`Invalid ${fieldName}: "${value}"`);
  }
}

export function buildSessionKey(parts: SessionKeyParts): string {
  assertNoColon(parts.tenant, "tenant");
  assertNoColon(parts.subject, "subject");
  return `${parts.platform}:${parts.tenant}:${parts.scope}:${parts.subject}`;
}

export function parseSessionKey(sessionKey: string): SessionKeyParts {
  const tokens = sessionKey.split(":");
  if (tokens.length !== SESSION_KEY_PART_COUNT) {
    throw new Error(`Invalid session key format: "${sessionKey}"`);
  }

  const [platform, tenant, scope, subject] = tokens;
  if (!isPlatform(platform)) {
    throw new Error(`Unknown platform: "${platform}"`);
  }
  if (!isScope(scope)) {
    throw new Error(`Unknown scope: "${scope}"`);
  }
  if (!tenant || !subject) {
    throw new Error(`Invalid session key content: "${sessionKey}"`);
  }

  return { platform, tenant, scope, subject };
}
