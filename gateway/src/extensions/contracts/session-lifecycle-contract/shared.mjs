import { resolve } from "node:path";
import {
  SESSION_SCOPE_ALL,
  SESSION_SCOPE_DM,
} from "./constants.mjs";

export function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonArg(raw, argName) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON for ${argName}`);
  }
  if (!isObject(parsed)) {
    throw new Error(`${argName} must be a JSON object`);
  }
  return parsed;
}

export function parseJsonArrayArg(raw, argName) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON for ${argName}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${argName} must be a JSON array`);
  }
  return parsed;
}

export function parseArgs(argv) {
  const command = argv[0] ?? "";
  if (!command) {
    throw new Error("missing command");
  }
  const options = /* @__PURE__ */ new Map();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) {
      throw new Error(`unknown argument: ${token}`);
    }
    const value = argv[index + 1] ?? "";
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${token}`);
    }
    options.set(token.slice(2), value);
    index += 1;
  }
  return { command, options };
}

export function requireOption(options, key) {
  const value = options.get(key);
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}

export function normalizeBool(raw) {
  const value = raw.trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes") {
    return true;
  }
  if (value === "false" || value === "0" || value === "no") {
    return false;
  }
  throw new Error(`invalid boolean: ${raw}`);
}

export function nowIsoUtc() {
  return (/* @__PURE__ */ new Date()).toISOString();
}

export function pathJoin(...parts) {
  if (parts.length === 0) {
    return ".";
  }
  return resolve(...parts);
}

export function pathDirname(path) {
  const normalized = path.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex < 0) {
    return ".";
  }
  if (slashIndex === 0) {
    return "/";
  }
  return normalized.slice(0, slashIndex);
}

export function pathBasename(path) {
  const normalized = path.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex < 0) {
    return normalized;
  }
  return normalized.slice(slashIndex + 1);
}

export function sanitizeSessionSegment(raw, defaultValue, maxLen = 80) {
  const text = String(raw ?? "").trim();
  const sanitized = text.replace(/[^a-zA-Z0-9._-]/g, "_");
  const resolved = sanitized || defaultValue;
  return resolved.slice(0, Math.max(1, maxLen));
}

export function sanitizeSessionKey(sessionKey) {
  return sessionKey.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function parseSessionKeyParts(sessionKey) {
  const parts = sessionKey.split(":");
  if (parts.length !== 4) {
    return null;
  }
  const [platform, tenant, scope, subject] = parts;
  if (!platform || !tenant || !subject || !SESSION_SCOPE_ALL.includes(scope)) {
    return null;
  }
  return [platform, tenant, scope, subject];
}

export function normalizeSessionScope(scopeRaw) {
  return SESSION_SCOPE_ALL.includes(scopeRaw) ? scopeRaw : SESSION_SCOPE_DM;
}
