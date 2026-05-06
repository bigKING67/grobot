import type { RuntimeEvent } from "../../../../models/types";
import { compactSpaces } from "../../terminal/display-width";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeActivityPayload(event: RuntimeEvent): Record<string, unknown> {
  const raw = isRecord(event.payload) ? event.payload : {};
  const nested = isRecord(raw.payload) ? raw.payload : {};
  return {
    ...raw,
    ...nested,
  };
}

export function payloadRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  return isRecord(value) ? value : {};
}

export function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

export function payloadNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function payloadBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key];
  return typeof value === "boolean" ? value : undefined;
}

export function firstString(...values: Array<string | undefined>): string {
  for (const value of values) {
    const normalized = compactSpaces(value ?? "");
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

export function firstRawString(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return "";
}

export function firstNumber(...values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

export function outputSummary(payload: Record<string, unknown>): Record<string, unknown> {
  return isRecord(payload.output_summary) ? payload.output_summary : {};
}

export function normalizeToolName(payload: Record<string, unknown>, summary: Record<string, unknown> = {}): string {
  return firstString(
    payloadString(payload, "tool_name"),
    payloadString(summary, "tool"),
    payloadString(summary, "tool_name"),
  ) || "unknown_tool";
}

export function payloadToolCallId(payload: Record<string, unknown>): string {
  return firstString(
    payloadString(payload, "tool_call_id"),
    payloadString(payload, "tool_use_id"),
    payloadString(payload, "id"),
  );
}

export function humanToolLabel(toolName: string): string {
  switch (toolName) {
    case "search":
    case "semantic_search":
    case "$web_search":
    case "web_search":
      return "Search";
    case "read":
      return "Read";
    case "glob":
    case "list":
      return "Explore";
    case "edit":
      return "Edit";
    case "write":
      return "Write";
    case "bash":
      return "Run";
    default:
      return toolName
        .split(/[_-]+/g)
        .filter(Boolean)
        .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
        .join(" ") || "Tool";
  }
}
