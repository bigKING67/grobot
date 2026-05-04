import {
  MEMORY_CLASSIFICATION_INTERNAL,
  MEMORY_KIND_EPISODIC,
  MEMORY_LEVEL_L1,
  MEMORY_STATE_ARCHIVED,
  type MemoryListOptions,
} from "./contract";
import {
  memoryClassificationVisible,
  memoryMatchesQuery,
  normalizeMemoryClassification,
  normalizeMemoryEvidenceRef,
  normalizeMemoryKind,
  normalizeMemoryLevel,
  tokenizeQuery,
} from "./normalize";

export function listMemoryRows(
  memoryRecordsBySession: Map<string, Record<string, unknown>[]>,
  sessionId: string,
  options: MemoryListOptions,
): Record<string, unknown>[] {
  const includeArchived = options.includeArchived;
  const includeRestricted = options.includeRestricted;
  const includeSecret = options.includeSecret;
  const kindFilter = options.kindFilter;
  const classificationFilter = options.classificationFilter;
  const queryText = options.queryText ?? "";
  const records = memoryRecordsBySession.get(sessionId);
  if (!Array.isArray(records) || records.length === 0) {
    return [];
  }
  const queryTokens = tokenizeQuery(queryText);
  const rows: Record<string, unknown>[] = [];
  for (const record of records) {
    if (typeof record !== "object" || record === null) {
      continue;
    }
    const rawText = String(record.text ?? "").trim();
    if (!rawText) {
      continue;
    }
    const state = String(record.state ?? "active").toLowerCase();
    if (!includeArchived && state === MEMORY_STATE_ARCHIVED) {
      continue;
    }
    const classification =
      normalizeMemoryClassification(String(record.classification ?? MEMORY_CLASSIFICATION_INTERNAL)) ??
      MEMORY_CLASSIFICATION_INTERNAL;
    if (!memoryClassificationVisible(classification, includeRestricted, includeSecret)) {
      continue;
    }
    if (classificationFilter && classification !== classificationFilter) {
      continue;
    }
    const kind = normalizeMemoryKind(String(record.kind ?? MEMORY_KIND_EPISODIC)) ?? MEMORY_KIND_EPISODIC;
    if (kindFilter && kind !== kindFilter) {
      continue;
    }
    if (!memoryMatchesQuery(rawText, queryTokens)) {
      continue;
    }
    rows.push({
      ...record,
      text: rawText,
      state,
      kind,
      classification,
      memory_level:
        normalizeMemoryLevel(typeof record.memory_level === "string" ? record.memory_level : undefined) ??
        MEMORY_LEVEL_L1,
      execution_verified: record.execution_verified === true,
      evidence_ref: normalizeMemoryEvidenceRef(record.evidence_ref),
    });
  }
  return rows;
}
