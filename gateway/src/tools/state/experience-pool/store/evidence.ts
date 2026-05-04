import {
  type ExperienceEvidenceRef,
} from "../types";

export function normalizeEvidenceRef(raw: ExperienceEvidenceRef | undefined): ExperienceEvidenceRef | undefined {
  if (!raw) {
    return undefined;
  }
  const traceId = typeof raw.traceId === "string" ? raw.traceId.trim() : "";
  const runId = typeof raw.runId === "string" ? raw.runId.trim() : "";
  const toolCallId = typeof raw.toolCallId === "string" ? raw.toolCallId.trim() : "";
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  const sourceType = typeof raw.sourceType === "string" ? raw.sourceType.trim() : "";
  const capturedAt = typeof raw.capturedAt === "string" ? raw.capturedAt.trim() : "";
  if (!traceId && !runId && !toolCallId && !url && !sourceType && !capturedAt) {
    return undefined;
  }
  return {
    traceId: traceId || undefined,
    runId: runId || undefined,
    toolCallId: toolCallId || undefined,
    url: url || undefined,
    sourceType: sourceType || undefined,
    capturedAt: capturedAt || undefined,
  };
}

export function parseEvidenceRef(raw: unknown): ExperienceEvidenceRef | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  return normalizeEvidenceRef({
    traceId: typeof record.traceId === "string" ? record.traceId : undefined,
    runId: typeof record.runId === "string" ? record.runId : undefined,
    toolCallId: typeof record.toolCallId === "string" ? record.toolCallId : undefined,
    url: typeof record.url === "string" ? record.url : undefined,
    sourceType: typeof record.sourceType === "string" ? record.sourceType : undefined,
    capturedAt: typeof record.capturedAt === "string" ? record.capturedAt : undefined,
  });
}

export function deriveLegacyEvidenceRef(input: {
  traceId?: string;
  sourceType: string;
  capturedAt: string;
}): ExperienceEvidenceRef | undefined {
  const traceId = typeof input.traceId === "string" ? input.traceId.trim() : "";
  if (!traceId) {
    return undefined;
  }
  return {
    traceId,
    sourceType: input.sourceType,
    capturedAt: input.capturedAt,
  };
}
