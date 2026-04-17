import { existsSync, readFileSync } from "node:fs";
import toml from "toml";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePathSegments(pathLike) {
  if (Array.isArray(pathLike)) {
    return pathLike
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  }
  return String(pathLike ?? "")
    .split(".")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readTomlConfig(path, options = {}) {
  const required = options.required === true;
  const filePath = String(path ?? "").trim();
  if (!filePath) {
    if (required) {
      throw new Error("toml path is required");
    }
    return null;
  }
  if (!existsSync(filePath)) {
    if (required) {
      throw new Error(`toml file not found: ${filePath}`);
    }
    return null;
  }
  let raw = "";
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`failed to read toml file (${filePath}): ${String(error?.message ?? error)}`);
  }
  let parsed = {};
  try {
    parsed = toml.parse(raw);
  } catch (error) {
    throw new Error(`failed to parse toml file (${filePath}): ${String(error?.message ?? error)}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`invalid toml root object (${filePath})`);
  }
  return parsed;
}

function getTomlValue(doc, pathLike) {
  if (!isRecord(doc)) {
    return undefined;
  }
  const segments = normalizePathSegments(pathLike);
  if (segments.length === 0) {
    return undefined;
  }
  let cursor = doc;
  for (const segment of segments) {
    if (!isRecord(cursor) || !Object.prototype.hasOwnProperty.call(cursor, segment)) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
}

function hasTomlPath(doc, pathLike) {
  const segments = normalizePathSegments(pathLike);
  if (segments.length === 0 || !isRecord(doc)) {
    return false;
  }
  let cursor = doc;
  for (const segment of segments) {
    if (!isRecord(cursor) || !Object.prototype.hasOwnProperty.call(cursor, segment)) {
      return false;
    }
    cursor = cursor[segment];
  }
  return true;
}

function readTomlString(doc, pathLike) {
  const value = getTomlValue(doc, pathLike);
  return typeof value === "string" ? value.trim() : "";
}

function readTomlBoolean(doc, pathLike) {
  const value = getTomlValue(doc, pathLike);
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return null;
}

function readTomlNumberOrString(doc, pathLike) {
  const value = getTomlValue(doc, pathLike);
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}

export {
  getTomlValue,
  hasTomlPath,
  readTomlBoolean,
  readTomlConfig,
  readTomlNumberOrString,
  readTomlString,
};
