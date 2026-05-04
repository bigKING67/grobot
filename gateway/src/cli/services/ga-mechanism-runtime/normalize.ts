import {
  normalizeAskUserEnvelope,
  type AskUserEnvelope,
} from "../../../tools/ask-user";
import {
  type GaMemoryLevel,
  type GaMemoryRecord,
  type GaSessionStateSnapshot,
  type GaSourceEventType,
  type ReflectionTask,
  type SessionFailureState,
  type SkillCard,
} from "./contract";
import {
  ensureStringArray,
  normalizeConfidence,
  normalizeEvidenceRef,
  nowIso,
  parseOptionalFiniteNumber,
  parseOptionalString,
  randomId,
} from "./utils";

function parseMemoryLevel(value: unknown): GaMemoryLevel | undefined {
  if (value === "L1" || value === "L2" || value === "L3" || value === "L4") {
    return value;
  }
  return undefined;
}

function parseSourceEventType(value: unknown): GaSourceEventType | undefined {
  if (
    value === "turn_executed"
    || value === "tool_executed"
    || value === "checkpoint_updated"
    || value === "reflection_generated"
    || value === "ask_user_resolved"
  ) {
    return value;
  }
  return undefined;
}

function normalizeMemoryRecord(raw: unknown, fallbackSessionKey: string): GaMemoryRecord | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const memoryLevel = parseMemoryLevel(record.memoryLevel);
  const sourceEventType = parseSourceEventType(record.sourceEventType);
  const text = parseOptionalString(record.text);
  if (!memoryLevel || !sourceEventType || !text) {
    return undefined;
  }
  return {
    id: parseOptionalString(record.id) ?? randomId("mem"),
    sessionKey: parseOptionalString(record.sessionKey) ?? fallbackSessionKey,
    memoryLevel,
    text,
    sourceEventType,
    executionVerified: Boolean(record.executionVerified),
    evidenceRef: normalizeEvidenceRef(record.evidenceRef),
    tags: ensureStringArray(record.tags, 12),
    confidence: normalizeConfidence(parseOptionalFiniteNumber(record.confidence)),
    createdAt: parseOptionalString(record.createdAt) ?? nowIso(),
  };
}

function normalizeSkillCard(raw: unknown, fallbackSessionKey: string): SkillCard | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const taskSignature = parseOptionalString(record.taskSignature);
  if (!taskSignature) {
    return undefined;
  }
  const evidenceRefs = normalizeEvidenceRefs(record.successEvidenceRefs);
  return {
    id: parseOptionalString(record.id) ?? randomId("sc"),
    sessionKey: parseOptionalString(record.sessionKey) ?? fallbackSessionKey,
    taskSignature,
    preconditions: ensureStringArray(record.preconditions, 24),
    steps: ensureStringArray(record.steps, 32),
    failureSignals: ensureStringArray(record.failureSignals, 24),
    rollback: ensureStringArray(record.rollback, 24),
    successEvidenceRefs: evidenceRefs,
    confidence: normalizeConfidence(parseOptionalFiniteNumber(record.confidence)),
    createdAt: parseOptionalString(record.createdAt) ?? nowIso(),
    updatedAt: parseOptionalString(record.updatedAt) ?? nowIso(),
  };
}

function normalizeEvidenceRefs(raw: unknown): NonNullable<SkillCard["successEvidenceRefs"]> {
  const evidenceRefs: NonNullable<SkillCard["successEvidenceRefs"]> = [];
  if (!Array.isArray(raw)) {
    return evidenceRefs;
  }
  for (const item of raw) {
    const normalized = normalizeEvidenceRef(item);
    if (normalized) {
      evidenceRefs.push(normalized);
    }
  }
  return evidenceRefs;
}

function normalizeReflectionTask(raw: unknown, fallbackSessionKey: string): ReflectionTask | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const triggerType =
    record.triggerType === "verification_failure"
      ? "verification_failure"
      : record.triggerType === "repeated_failure"
        ? "repeated_failure"
        : undefined;
  const nextActionHint = parseOptionalString(record.nextActionHint);
  if (!triggerType || !nextActionHint) {
    return undefined;
  }
  return {
    id: parseOptionalString(record.id) ?? randomId("refl"),
    sessionKey: parseOptionalString(record.sessionKey) ?? fallbackSessionKey,
    triggerType,
    failureBundle: ensureStringArray(record.failureBundle, 24),
    insightSchemaVersion: "v1",
    nextActionHint,
    createdAt: parseOptionalString(record.createdAt) ?? nowIso(),
  };
}

function normalizeFailureState(raw: unknown): SessionFailureState | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const recentErrors = ensureStringArray(record.recentErrors, 8);
  const consecutiveFailures = parseOptionalFiniteNumber(record.consecutiveFailures);
  const lastReflectionAtMs = parseOptionalFiniteNumber(record.lastReflectionAtMs);
  if (typeof consecutiveFailures !== "number" && recentErrors.length === 0 && typeof lastReflectionAtMs !== "number") {
    return undefined;
  }
  return {
    consecutiveFailures:
      typeof consecutiveFailures === "number" && consecutiveFailures > 0 ? Math.floor(consecutiveFailures) : 0,
    recentErrors,
    lastReflectionAtMs: typeof lastReflectionAtMs === "number" && lastReflectionAtMs > 0
      ? Math.floor(lastReflectionAtMs)
      : 0,
  };
}

export function normalizeGaSessionStateSnapshot(
  sessionKey: string,
  raw: unknown,
): GaSessionStateSnapshot | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const memory: GaMemoryRecord[] = [];
  if (Array.isArray(record.memory)) {
    for (const item of record.memory) {
      const normalized = normalizeMemoryRecord(item, sessionKey);
      if (normalized) {
        memory.push(normalized);
      }
    }
  }
  const skillCards: SkillCard[] = [];
  if (Array.isArray(record.skillCards)) {
    for (const item of record.skillCards) {
      const normalized = normalizeSkillCard(item, sessionKey);
      if (normalized) {
        skillCards.push(normalized);
      }
    }
  }
  const reflectionQueue: ReflectionTask[] = [];
  if (Array.isArray(record.reflectionQueue)) {
    for (const item of record.reflectionQueue) {
      const normalized = normalizeReflectionTask(item, sessionKey);
      if (normalized) {
        reflectionQueue.push(normalized);
      }
    }
  }
  const pendingAskQueue: AskUserEnvelope[] = [];
  if (Array.isArray(record.pendingAskQueue)) {
    for (const item of record.pendingAskQueue) {
      const normalized = normalizeAskUserEnvelope(item);
      if (normalized) {
        pendingAskQueue.push(normalized);
      }
    }
  }
  const failureState = normalizeFailureState(record.failureState);
  if (
    memory.length === 0
    && skillCards.length === 0
    && reflectionQueue.length === 0
    && pendingAskQueue.length === 0
    && !failureState
  ) {
    return undefined;
  }
  return {
    memory,
    skillCards,
    reflectionQueue,
    pendingAskQueue: pendingAskQueue.length > 0 ? pendingAskQueue : undefined,
    failureState,
  };
}
