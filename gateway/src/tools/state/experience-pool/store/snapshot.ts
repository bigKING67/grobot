import {
  EXPERIENCE_POOL_VERSION,
  MAX_CONFLICT_SIGNALS,
  MAX_EVIDENCE,
  MAX_FAILURE_SIGNALS,
  MAX_GUARDRAILS,
  MAX_KEYWORDS,
  MAX_SCENARIO_TAGS,
  MAX_SOP_STEPS,
} from "./constants";
import {
  type ExperienceAttemptRecord,
  type ExperienceEvidence,
  type ExperiencePoolSnapshot,
  type ExperienceRecord,
  type ExperienceRecordState,
} from "../types";
import {
  computeConsecutiveFailureCount,
  computeRecoverySuccessCount,
  normalizeAttemptHistory,
  parseAttemptRecord,
  parseOptionalAttemptStage,
} from "./attempts";
import {
  deriveFailureStage,
  deriveReuseGuardrails,
  deriveScenarioTags,
  deriveTaskSignature,
  deriveTaskType,
} from "./derive";
import {
  deriveLegacyEvidenceRef,
  parseEvidenceRef,
} from "./evidence";
import {
  compactWhitespace,
  normalizeTag,
  normalizeTaskType,
  nowIso,
  parseFiniteFloat,
  parseFiniteInt,
  uniqueTrimmed,
} from "./utils";

function parseRecordState(raw: unknown): ExperienceRecordState {
  if (raw === "active" || raw === "quarantined" || raw === "disabled") {
    return raw;
  }
  return "active";
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const rows: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = compactWhitespace(item);
    if (normalized) {
      rows.push(normalized);
    }
  }
  return rows;
}

function parseEvidenceRows(raw: unknown): ExperienceEvidence[] {
  const evidenceRaw = Array.isArray(raw) ? raw : [];
  const evidence: ExperienceEvidence[] = [];
  for (const item of evidenceRaw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const row = item as Record<string, unknown>;
    const sourceRaw = row.source;
    const source =
      sourceRaw === "turn_success" || sourceRaw === "turn_failure" || sourceRaw === "manual"
        ? sourceRaw
        : "manual";
    evidence.push({
      source,
      traceId: typeof row.traceId === "string" ? row.traceId : undefined,
      providerName: typeof row.providerName === "string" ? row.providerName : undefined,
      errorClass: typeof row.errorClass === "string" ? row.errorClass : undefined,
      capturedAt: typeof row.capturedAt === "string" ? row.capturedAt : nowIso(),
      evidenceRef:
        parseEvidenceRef(row.evidenceRef)
        ?? deriveLegacyEvidenceRef({
          traceId: typeof row.traceId === "string" ? row.traceId : undefined,
          sourceType: source,
          capturedAt: typeof row.capturedAt === "string" ? row.capturedAt : nowIso(),
        }),
    });
  }
  return evidence;
}

export function parseRecord(raw: unknown): ExperienceRecord | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const tenant = typeof record.tenant === "string" ? record.tenant.trim() : "";
  const team = typeof record.team === "string" ? record.team.trim() : "default";
  const user = typeof record.user === "string" ? record.user.trim() : "default";
  const signature = typeof record.signature === "string" ? compactWhitespace(record.signature) : "";
  if (!id || !tenant || !team || !user || !signature) {
    return undefined;
  }
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : nowIso();
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : createdAt;
  const lastUsedAt = typeof record.lastUsedAt === "string" ? record.lastUsedAt : updatedAt;
  const summaryRaw = typeof record.summary === "string" ? compactWhitespace(record.summary) : "";
  const summary = summaryRaw || signature;
  const taskSignatureRaw = typeof record.taskSignature === "string"
    ? compactWhitespace(record.taskSignature)
    : "";
  const taskTypeRaw = typeof record.taskType === "string" ? compactWhitespace(record.taskType) : "";
  const scenarioTagsRaw = parseStringArray(record.scenarioTags).map(normalizeTag);
  const keywords = uniqueTrimmed(parseStringArray(record.keywords), MAX_KEYWORDS);
  const sop = uniqueTrimmed(parseStringArray(record.sop), MAX_SOP_STEPS);
  const failureSignals = uniqueTrimmed(parseStringArray(record.failureSignals), MAX_FAILURE_SIGNALS);
  const conflictSignals = uniqueTrimmed(parseStringArray(record.conflictSignals), MAX_CONFLICT_SIGNALS);
  const evidence = parseEvidenceRows(record.evidence);
  const attemptHistoryRaw = Array.isArray(record.attemptHistory) ? record.attemptHistory : [];
  let attemptHistory = normalizeAttemptHistory(
    attemptHistoryRaw
      .map((item) => parseAttemptRecord(item))
      .filter((item): item is ExperienceAttemptRecord => Boolean(item)),
  );
  if (attemptHistory.length === 0) {
    const synthesizedOutcome = record.lastOutcome === "failure" ? "failure" : "success";
    if (parseFiniteInt(record.successCount, 0) > 0 || parseFiniteInt(record.failureCount, 0) > 0) {
      attemptHistory = [
        {
          capturedAt: lastUsedAt,
          outcome: synthesizedOutcome,
          stage: synthesizedOutcome === "success"
            ? "verification"
            : deriveFailureStage(
              typeof record.lastFailureClass === "string" ? record.lastFailureClass : "",
              failureSignals[0] ?? "",
            ),
          strategy: synthesizedOutcome === "success" ? sop[0] : undefined,
          errorClass: synthesizedOutcome === "failure"
            ? (typeof record.lastFailureClass === "string" ? compactWhitespace(record.lastFailureClass) : undefined)
            : undefined,
          errorMessage: synthesizedOutcome === "failure" ? failureSignals[0] : undefined,
          verificationPass: synthesizedOutcome === "success" ? parseFiniteInt(record.verificationPassCount, 0) > 0 : undefined,
        },
      ];
    }
  }
  const taskSeed = `${signature} ${summary}`;
  const taskSignature = taskSignatureRaw || deriveTaskSignature(taskSeed, "");
  const taskType = taskTypeRaw ? normalizeTaskType(taskTypeRaw) : normalizeTaskType(deriveTaskType(taskSeed));
  const scenarioTags = scenarioTagsRaw.length > 0
    ? uniqueTrimmed(scenarioTagsRaw, MAX_SCENARIO_TAGS)
    : deriveScenarioTags(taskSeed);
  const reuseGuardrailsRaw = uniqueTrimmed(parseStringArray(record.reuseGuardrails), MAX_GUARDRAILS);
  const reuseGuardrails = reuseGuardrailsRaw.length > 0
    ? reuseGuardrailsRaw
    : deriveReuseGuardrails(failureSignals, conflictSignals);
  const lastFailureClassRaw = typeof record.lastFailureClass === "string"
    ? compactWhitespace(record.lastFailureClass)
    : "";
  const inferredLastFailureClass = lastFailureClassRaw
    || (failureSignals[0]?.split(":")[0] ?? "").trim()
    || undefined;
  const lastFailureStage = parseOptionalAttemptStage(record.lastFailureStage)
    ?? deriveFailureStage(inferredLastFailureClass ?? "", failureSignals[0] ?? "");
  const recoverySuccessCount = typeof record.recoverySuccessCount === "number"
    ? parseFiniteInt(record.recoverySuccessCount, 0)
    : computeRecoverySuccessCount(attemptHistory);
  const consecutiveFailureCount = typeof record.consecutiveFailureCount === "number"
    ? parseFiniteInt(record.consecutiveFailureCount, 0)
    : computeConsecutiveFailureCount(attemptHistory);

  return {
    id,
    tenant,
    team,
    user,
    signature,
    taskSignature,
    taskType,
    scenarioTags,
    summary,
    keywords,
    sop,
    failureSignals,
    reuseGuardrails,
    attemptHistory,
    confidence: parseFiniteFloat(record.confidence, 0.55, 0.01, 0.99),
    successCount: parseFiniteInt(record.successCount, 0),
    failureCount: parseFiniteInt(record.failureCount, 0),
    recoverySuccessCount,
    consecutiveFailureCount,
    conflictCount: parseFiniteInt(record.conflictCount, 0),
    verificationPassCount: parseFiniteInt(record.verificationPassCount, 0),
    lastOutcome: record.lastOutcome === "failure" ? "failure" : "success",
    lastFailureClass: inferredLastFailureClass,
    lastFailureStage,
    lastSuccessStrategy: typeof record.lastSuccessStrategy === "string"
      ? compactWhitespace(record.lastSuccessStrategy).slice(0, 220)
      : sop[0],
    state: parseRecordState(record.state),
    createdAt,
    updatedAt,
    lastUsedAt,
    lastConflictAt: typeof record.lastConflictAt === "string" ? record.lastConflictAt : undefined,
    conflictSignals,
    evidence: evidence.slice(0, MAX_EVIDENCE),
  };
}

export function createEmptySnapshot(): ExperiencePoolSnapshot {
  return {
    version: EXPERIENCE_POOL_VERSION,
    updatedAt: nowIso(),
    records: [],
  };
}

export function parseSnapshot(raw: unknown): ExperiencePoolSnapshot {
  if (typeof raw !== "object" || raw === null) {
    return createEmptySnapshot();
  }
  const record = raw as Record<string, unknown>;
  const rows = Array.isArray(record.records) ? record.records : [];
  const records = rows
    .map((item) => parseRecord(item))
    .filter((item): item is ExperienceRecord => Boolean(item));
  return {
    version: EXPERIENCE_POOL_VERSION,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : nowIso(),
    records,
  };
}

export function cloneRecord(record: ExperienceRecord): ExperienceRecord {
  return {
    ...record,
    scenarioTags: [...record.scenarioTags],
    keywords: [...record.keywords],
    sop: [...record.sop],
    failureSignals: [...record.failureSignals],
    reuseGuardrails: [...record.reuseGuardrails],
    attemptHistory: record.attemptHistory.map((attempt) => ({ ...attempt })),
    conflictSignals: [...record.conflictSignals],
    evidence: record.evidence.map((item) => ({
      ...item,
      evidenceRef: item.evidenceRef ? { ...item.evidenceRef } : undefined,
    })),
  };
}

export function sortRecordsInPlace(records: ExperienceRecord[]): void {
  records.sort((left, right) => {
    const confidenceDelta = right.confidence - left.confidence;
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }
    const recoveryDelta = right.recoverySuccessCount - left.recoverySuccessCount;
    if (recoveryDelta !== 0) {
      return recoveryDelta;
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}
