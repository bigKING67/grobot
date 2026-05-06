import type { RuntimeEvent } from "../../../models/types";

export interface RuntimeActivitySignalState {
  activeToolCallIds: readonly string[];
  anonymousActiveToolCount: number;
  tokenLength: number;
  tokenCount?: number;
}

export interface RuntimeActivitySignalSnapshot {
  hasActiveTools: boolean;
  tokenLength: number;
  tokenCount?: number;
}

export function createRuntimeActivitySignalState(): RuntimeActivitySignalState {
  return {
    activeToolCallIds: [],
    anonymousActiveToolCount: 0,
    tokenLength: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePayload(event: RuntimeEvent): Record<string, unknown> {
  const raw = isRecord(event.payload) ? event.payload : {};
  const nested = isRecord(raw.payload) ? raw.payload : {};
  return {
    ...raw,
    ...nested,
  };
}

function payloadRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  return isRecord(value) ? value : {};
}

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function payloadNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstString(...values: string[]): string {
  for (const value of values) {
    const normalized = value.trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function firstNumber(...values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function payloadToolCallId(payload: Record<string, unknown>): string {
  return firstString(
    payloadString(payload, "tool_call_id"),
    payloadString(payload, "tool_use_id"),
    payloadString(payload, "id"),
  );
}

function removeToolCallId(ids: readonly string[], id: string): string[] {
  if (!id) {
    return [...ids];
  }
  return ids.filter((candidate) => candidate !== id);
}

function resolveStreamTextDelta(payload: Record<string, unknown>): string {
  const delta = payloadRecord(payload, "delta");
  const content = payloadRecord(payload, "content");
  return firstString(
    payloadString(payload, "text"),
    payloadString(payload, "delta"),
    payloadString(payload, "chunk"),
    payloadString(payload, "content"),
    payloadString(payload, "output_text"),
    payloadString(delta, "text"),
    payloadString(delta, "content"),
    payloadString(delta, "output_text"),
    payloadString(content, "text"),
  );
}

function resolveStreamTokenCount(payload: Record<string, unknown>): number | undefined {
  const usage = payloadRecord(payload, "usage");
  return firstNumber(
    payloadNumber(payload, "token_count"),
    payloadNumber(payload, "tokens_count"),
    payloadNumber(payload, "output_tokens"),
    payloadNumber(payload, "output_token_count"),
    payloadNumber(usage, "output_tokens"),
  );
}

function addToolStart(state: RuntimeActivitySignalState, payload: Record<string, unknown>): RuntimeActivitySignalState {
  const toolCallId = payloadToolCallId(payload);
  if (!toolCallId) {
    return {
      ...state,
      anonymousActiveToolCount: state.anonymousActiveToolCount + 1,
    };
  }
  if (state.activeToolCallIds.includes(toolCallId)) {
    return state;
  }
  return {
    ...state,
    activeToolCallIds: [...state.activeToolCallIds, toolCallId],
  };
}

function addToolEnd(state: RuntimeActivitySignalState, payload: Record<string, unknown>): RuntimeActivitySignalState {
  const toolCallId = payloadToolCallId(payload);
  if (!toolCallId) {
    return {
      ...state,
      anonymousActiveToolCount: Math.max(0, state.anonymousActiveToolCount - 1),
    };
  }
  return {
    ...state,
    activeToolCallIds: removeToolCallId(state.activeToolCallIds, toolCallId),
  };
}

function addStreamChunk(state: RuntimeActivitySignalState, payload: Record<string, unknown>): RuntimeActivitySignalState {
  const textDelta = resolveStreamTextDelta(payload);
  const tokenCount = resolveStreamTokenCount(payload);
  const next = {
    activeToolCallIds: state.activeToolCallIds,
    anonymousActiveToolCount: state.anonymousActiveToolCount,
    tokenLength: state.tokenLength + textDelta.length,
  };
  if (typeof tokenCount === "number") {
    return {
      ...next,
      tokenCount,
    };
  }
  if (typeof state.tokenCount === "number") {
    return {
      ...next,
      tokenCount: state.tokenCount,
    };
  }
  return next;
}

export function reduceRuntimeActivitySignalState(
  state: RuntimeActivitySignalState,
  event: RuntimeEvent,
): RuntimeActivitySignalState {
  const payload = normalizePayload(event);
  if (event.eventType === "turn_start") {
    return createRuntimeActivitySignalState();
  }
  if (event.eventType === "tool_start") {
    return addToolStart(state, payload);
  }
  if (event.eventType === "tool_end") {
    return addToolEnd(state, payload);
  }
  if (event.eventType === "turn_stream_chunk") {
    return addStreamChunk(state, payload);
  }
  if (event.eventType === "turn_end" || event.eventType === "turn_failed" || event.eventType === "turn_interrupted") {
    return {
      ...state,
      activeToolCallIds: [],
      anonymousActiveToolCount: 0,
    };
  }
  return state;
}

export function readRuntimeActivitySignalSnapshot(
  state: RuntimeActivitySignalState,
): RuntimeActivitySignalSnapshot {
  const tokenCount = firstNumber(state.tokenCount);
  const snapshot = {
    hasActiveTools: state.activeToolCallIds.length + state.anonymousActiveToolCount > 0,
    tokenLength: Math.max(0, Math.floor(state.tokenLength)),
  };
  if (typeof tokenCount === "number") {
    return {
      ...snapshot,
      tokenCount,
    };
  }
  return {
    ...snapshot,
  };
}
