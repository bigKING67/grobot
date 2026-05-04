import { readFileSync } from "node:fs";
import type { JsonObject } from "./types";

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readJsonObject(path: string): JsonObject {
  const raw = readFileSync(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error(`json root must be object: ${path}`);
  }
  return parsed;
}

export function parseIntField(raw: unknown, fieldName: string, min = 0): number {
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new Error(`policy field ${fieldName} must be int`);
  }
  if (raw < min) {
    throw new Error(`policy field ${fieldName} must be >= ${String(min)}`);
  }
  return raw;
}

export function parseOptionalRate(raw: unknown, fieldName: string): number | null {
  if (raw == null) {
    return null;
  }
  if (typeof raw !== "number") {
    throw new Error(`policy field ${fieldName} must be number or null`);
  }
  if (raw < 0 || raw > 1) {
    throw new Error(`policy field ${fieldName} must be within [0,1]`);
  }
  return Number(raw);
}

export function parseOptionalInt(raw: unknown, fieldName: string): number | null {
  if (raw == null) {
    return null;
  }
  return parseIntField(raw, fieldName, 0);
}

export function asNumber(record: JsonObject, key: string): number {
  const value = record[key];
  if (typeof value !== "number") {
    throw new Error(`report totals.${key} must be number`);
  }
  return value;
}

export function asNumberWithDefault(record: JsonObject, key: string, fallback = 0): number {
  const value = record[key];
  if (value == null) {
    return fallback;
  }
  if (typeof value !== "number") {
    throw new Error(`report totals.${key} must be number|null`);
  }
  return value;
}

export function asNumberOrNull(record: JsonObject, key: string): number | null {
  const value = record[key];
  if (value == null) {
    return null;
  }
  if (typeof value !== "number") {
    throw new Error(`report totals.${key} must be number|null`);
  }
  return value;
}

export function divideOrNull(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return Number((numerator / denominator).toFixed(4));
}
