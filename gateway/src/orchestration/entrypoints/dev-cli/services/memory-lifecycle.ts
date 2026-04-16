export const MEMORY_SCOPE_AUTO = "auto";
export const MEMORY_SCOPE_USER = "user";
export const MEMORY_SCOPE_GROUP = "group";
export const MEMORY_SCOPE_ORG = "org";

export const MEMORY_KIND_EPISODIC = "episodic";
export const MEMORY_KIND_SEMANTIC = "semantic";
export const MEMORY_KIND_PREFERENCE = "preference";
export const MEMORY_KIND_POLICY = "policy";

export const MEMORY_CLASSIFICATION_PUBLIC = "public";
export const MEMORY_CLASSIFICATION_INTERNAL = "internal";
export const MEMORY_CLASSIFICATION_RESTRICTED = "restricted";
export const MEMORY_CLASSIFICATION_SECRET = "secret";

export const MEMORY_STATE_ACTIVE = "active";
export const MEMORY_STATE_ARCHIVED = "archived";
export const MEMORY_LEVEL_L1 = "L1";
export const MEMORY_LEVEL_L2 = "L2";
export const MEMORY_LEVEL_L3 = "L3";
export const MEMORY_LEVEL_L4 = "L4";

export const MANAGEMENT_MEMORY_CURSOR_MAX = 200_000;
export const MANAGEMENT_MEMORY_FETCH_MAX = 50_000;
export const MANAGEMENT_MEMORY_IMPORT_MAX_BODY_BYTES = 1024 * 1024;
export const MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT = 200;
export const MANAGEMENT_MEMORY_BATCH_MAX_SESSIONS = 200;
export type MemoryStoreBackend = "file" | "redis";

export interface MemoryStoreRuntime {
  backend: MemoryStoreBackend;
  requestedBackend: MemoryStoreBackend;
  source: string;
  redisUrl?: string;
  fallbackReason?: string;
}

export type MemoryScope =
  | typeof MEMORY_SCOPE_AUTO
  | typeof MEMORY_SCOPE_USER
  | typeof MEMORY_SCOPE_GROUP
  | typeof MEMORY_SCOPE_ORG;

export type MemoryKind =
  | typeof MEMORY_KIND_EPISODIC
  | typeof MEMORY_KIND_SEMANTIC
  | typeof MEMORY_KIND_PREFERENCE
  | typeof MEMORY_KIND_POLICY;

export type MemoryClassification =
  | typeof MEMORY_CLASSIFICATION_PUBLIC
  | typeof MEMORY_CLASSIFICATION_INTERNAL
  | typeof MEMORY_CLASSIFICATION_RESTRICTED
  | typeof MEMORY_CLASSIFICATION_SECRET;

export type MemoryState = typeof MEMORY_STATE_ACTIVE | typeof MEMORY_STATE_ARCHIVED;
export type MemoryLevel =
  | typeof MEMORY_LEVEL_L1
  | typeof MEMORY_LEVEL_L2
  | typeof MEMORY_LEVEL_L3
  | typeof MEMORY_LEVEL_L4;

interface MemoryEvidenceRef {
  trace_id?: string;
  turn_id?: string;
  tool_call_id?: string;
  source?: string;
}

const MEMORY_SCOPES: readonly MemoryScope[] = [
  MEMORY_SCOPE_AUTO,
  MEMORY_SCOPE_USER,
  MEMORY_SCOPE_GROUP,
  MEMORY_SCOPE_ORG,
];

const MEMORY_KINDS: readonly MemoryKind[] = [
  MEMORY_KIND_EPISODIC,
  MEMORY_KIND_SEMANTIC,
  MEMORY_KIND_PREFERENCE,
  MEMORY_KIND_POLICY,
];

const MEMORY_CLASSIFICATIONS: readonly MemoryClassification[] = [
  MEMORY_CLASSIFICATION_PUBLIC,
  MEMORY_CLASSIFICATION_INTERNAL,
  MEMORY_CLASSIFICATION_RESTRICTED,
  MEMORY_CLASSIFICATION_SECRET,
];

const MEMORY_LEVELS: readonly MemoryLevel[] = [
  MEMORY_LEVEL_L1,
  MEMORY_LEVEL_L2,
  MEMORY_LEVEL_L3,
  MEMORY_LEVEL_L4,
];

export function normalizeMemoryScope(raw: string | undefined): MemoryScope | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (MEMORY_SCOPES.includes(normalized as MemoryScope)) {
    return normalized as MemoryScope;
  }
  return undefined;
}

export function normalizeMemoryKind(raw: string | undefined): MemoryKind | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (MEMORY_KINDS.includes(normalized as MemoryKind)) {
    return normalized as MemoryKind;
  }
  return undefined;
}

export function normalizeMemoryClassification(raw: string | undefined): MemoryClassification | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (MEMORY_CLASSIFICATIONS.includes(normalized as MemoryClassification)) {
    return normalized as MemoryClassification;
  }
  return undefined;
}

export function normalizeMemoryState(raw: string | undefined): MemoryState | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === MEMORY_STATE_ACTIVE || normalized === MEMORY_STATE_ARCHIVED) {
    return normalized;
  }
  return undefined;
}

export function normalizeMemoryLevel(raw: string | undefined): MemoryLevel | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toUpperCase();
  if (MEMORY_LEVELS.includes(normalized as MemoryLevel)) {
    return normalized as MemoryLevel;
  }
  return undefined;
}

function normalizeMemoryEvidenceRef(raw: unknown): MemoryEvidenceRef | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const traceId = typeof record.trace_id === "string" ? record.trace_id.trim() : "";
  const turnId = typeof record.turn_id === "string" ? record.turn_id.trim() : "";
  const toolCallId = typeof record.tool_call_id === "string" ? record.tool_call_id.trim() : "";
  const source = typeof record.source === "string" ? record.source.trim() : "";
  if (!traceId && !turnId && !toolCallId && !source) {
    return undefined;
  }
  return {
    trace_id: traceId || undefined,
    turn_id: turnId || undefined,
    tool_call_id: toolCallId || undefined,
    source: source || undefined,
  };
}

function clampUnitNumber(raw: unknown, defaultValue: number): {
  value: number;
  valid: boolean;
} {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return {
      value: defaultValue,
      valid: false,
    };
  }
  if (raw < 0 || raw > 1) {
    return {
      value: defaultValue,
      valid: false,
    };
  }
  return {
    value: raw,
    valid: true,
  };
}

function memoryScopeMatches(recordScopeRaw: unknown, requestedScope: MemoryScope): boolean {
  if (requestedScope === MEMORY_SCOPE_AUTO) {
    return true;
  }
  const recordScope = normalizeMemoryScope(typeof recordScopeRaw === "string" ? recordScopeRaw : undefined);
  return recordScope === requestedScope;
}

function generateMemoryRecordId(): string {
  const nowPart = Date.now().toString(36);
  const randPart = Math.random().toString(36).slice(2, 10);
  return `mm_${nowPart}_${randPart}`;
}

function buildMemoryScopeRoot(sessionId: string, scope: MemoryScope): string {
  return `memory://session/${encodeURIComponent(sessionId)}/${scope}`;
}

function tokenizeQuery(value: string): string[] {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function memoryMatchesQuery(text: string, queryTokens: string[]): boolean {
  if (!queryTokens.length) {
    return true;
  }
  const lowered = text.toLowerCase();
  for (const token of queryTokens) {
    if (!lowered.includes(token)) {
      return false;
    }
  }
  return true;
}

function memoryClassificationVisible(
  classification: MemoryClassification,
  includeRestricted: boolean,
  includeSecret: boolean,
): boolean {
  if (classification === MEMORY_CLASSIFICATION_SECRET) {
    return includeSecret;
  }
  if (classification === MEMORY_CLASSIFICATION_RESTRICTED) {
    return includeRestricted || includeSecret;
  }
  return true;
}

export interface MemoryListOptions {
  includeArchived: boolean;
  includeRestricted: boolean;
  includeSecret: boolean;
  kindFilter?: MemoryKind;
  classificationFilter?: MemoryClassification;
  queryText?: string;
}

export interface MemoryMutationResult {
  ok: boolean;
  result: Record<string, unknown>;
}

export interface MemoryLifecycleResult {
  ok: boolean;
  lines: string[];
}

export interface MemoryBatchLifecycleResult {
  status: "ok" | "partial";
  requestedCount: number;
  successCount: number;
  failedCount: number;
  actions: Record<"promote" | "decay" | "archive", number>;
  scanned: number;
  changed: number;
  discoveryTruncated: boolean;
  results: Array<Record<string, unknown>>;
}

export interface MemoryOperations {
  listMemoryRows: (sessionId: string, options: MemoryListOptions) => Record<string, unknown>[];
  importMemoryRows: (
    sessionId: string,
    scope: MemoryScope,
    rawRecords: unknown,
    source: string | undefined,
    dryRun: boolean,
  ) => MemoryMutationResult;
  forgetMemoryRows: (
    sessionId: string,
    scope: MemoryScope,
    ids: string[],
    reason: string | undefined,
    dryRun: boolean,
  ) => MemoryMutationResult;
  runMemoryLifecycle: (sessionId: string, scope: MemoryScope, dryRun: boolean) => MemoryLifecycleResult;
  runMemoryLifecycleAcrossSessions: (options: {
    scope: MemoryScope;
    dryRun: boolean;
    sessions: string[];
    sessionPrefixes: string[];
    limit: number;
  }) => MemoryBatchLifecycleResult;
}

export function createMemoryOperations(
  memoryRecordsBySession: Map<string, Record<string, unknown>[]>,
): MemoryOperations {
  const listMemoryRows = (
    sessionId: string,
    options: MemoryListOptions,
  ): Record<string, unknown>[] => {
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
        memory_level: normalizeMemoryLevel(typeof record.memory_level === "string" ? record.memory_level : undefined)
          ?? MEMORY_LEVEL_L1,
        execution_verified: record.execution_verified === true,
        evidence_ref: normalizeMemoryEvidenceRef(record.evidence_ref),
      });
    }
    return rows;
  };

  const importMemoryRows = (
    sessionId: string,
    scope: MemoryScope,
    rawRecords: unknown,
    source: string | undefined,
    dryRun: boolean,
  ): MemoryMutationResult => {
    if (!Array.isArray(rawRecords) || rawRecords.length === 0) {
      return {
        ok: false,
        result: {
          error: "records is required",
        },
      };
    }

    const accepted = rawRecords.slice(0, MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT);
    const truncatedCount = Math.max(0, rawRecords.length - accepted.length);
    const invalidRows: Array<Record<string, unknown>> = [];
    const normalizedRows: Array<Record<string, unknown>> = [];
    const scopeRoot = buildMemoryScopeRoot(sessionId, scope);

    for (let idx = 0; idx < accepted.length; idx += 1) {
      const rawRow = accepted[idx];
      if (typeof rawRow !== "object" || rawRow === null || Array.isArray(rawRow)) {
        invalidRows.push({
          index: idx,
          errors: [
            {
              field: "row",
              reason: "must be object",
            },
          ],
        });
        continue;
      }
      const row = rawRow as Record<string, unknown>;
      const rowErrors: Array<Record<string, string>> = [];

      const text = typeof row.text === "string" ? row.text.trim() : "";
      if (!text) {
        rowErrors.push({
          field: "text",
          reason: "must be non-empty string",
        });
      }

      let kind: MemoryKind = MEMORY_KIND_EPISODIC;
      if (row.kind !== undefined) {
        if (typeof row.kind !== "string") {
          rowErrors.push({
            field: "kind",
            reason: "must be string",
          });
        } else {
          const parsedKind = normalizeMemoryKind(row.kind);
          if (!parsedKind) {
            rowErrors.push({
              field: "kind",
              reason: `must be one of ${MEMORY_KINDS.join(",")}`,
            });
          } else {
            kind = parsedKind;
          }
        }
      }

      let classification: MemoryClassification = MEMORY_CLASSIFICATION_INTERNAL;
      if (row.classification !== undefined) {
        if (typeof row.classification !== "string") {
          rowErrors.push({
            field: "classification",
            reason: "must be string",
          });
        } else {
          const parsedClassification = normalizeMemoryClassification(row.classification);
          if (!parsedClassification) {
            rowErrors.push({
              field: "classification",
              reason: `must be one of ${MEMORY_CLASSIFICATIONS.join(",")}`,
            });
          } else {
            classification = parsedClassification;
          }
        }
      }

      let state: MemoryState = MEMORY_STATE_ACTIVE;
      if (row.state !== undefined) {
        if (typeof row.state !== "string") {
          rowErrors.push({
            field: "state",
            reason: "must be string",
          });
        } else {
          const parsedState = normalizeMemoryState(row.state);
          if (!parsedState) {
            rowErrors.push({
              field: "state",
              reason: `must be one of ${MEMORY_STATE_ACTIVE},${MEMORY_STATE_ARCHIVED}`,
            });
          } else {
            state = parsedState;
          }
        }
      }

      const importanceParsed = clampUnitNumber(row.importance, 0.6);
      if (row.importance !== undefined && !importanceParsed.valid) {
        rowErrors.push({
          field: "importance",
          reason: "must be number in range [0,1]",
        });
      }
      const confidenceParsed = clampUnitNumber(row.confidence, 0.6);
      if (row.confidence !== undefined && !confidenceParsed.valid) {
        rowErrors.push({
          field: "confidence",
          reason: "must be number in range [0,1]",
        });
      }

      const tags: string[] = [];
      if (row.tags !== undefined) {
        if (!Array.isArray(row.tags)) {
          rowErrors.push({
            field: "tags",
            reason: "must be array of strings",
          });
        } else {
          for (let tagIdx = 0; tagIdx < row.tags.length; tagIdx += 1) {
            const item = row.tags[tagIdx];
            if (typeof item !== "string") {
              rowErrors.push({
                field: `tags[${String(tagIdx)}]`,
                reason: "must be string",
              });
              continue;
            }
            const cleanedTag = item.trim();
            if (cleanedTag && !tags.includes(cleanedTag)) {
              tags.push(cleanedTag);
            }
          }
        }
      }

      let recordId = "";
      if (row.id !== undefined) {
        if (typeof row.id !== "string") {
          rowErrors.push({
            field: "id",
            reason: "must be string",
          });
        } else {
          const cleanedId = row.id.trim();
          if (!cleanedId) {
            rowErrors.push({
              field: "id",
              reason: "must be non-empty string",
            });
          } else {
            recordId = cleanedId;
          }
        }
      }

      let normalizedSource = source?.trim() || "memory:management_import";
      if (row.source !== undefined) {
        if (typeof row.source !== "string") {
          rowErrors.push({
            field: "source",
            reason: "must be string",
          });
        } else {
          const cleanedSource = row.source.trim();
          if (!cleanedSource) {
            rowErrors.push({
              field: "source",
              reason: "must be non-empty string",
            });
          } else {
            normalizedSource = cleanedSource;
          }
        }
      }

      let memoryLevel: MemoryLevel = MEMORY_LEVEL_L1;
      if (row.memory_level !== undefined) {
        if (typeof row.memory_level !== "string") {
          rowErrors.push({
            field: "memory_level",
            reason: "must be string",
          });
        } else {
          const parsedMemoryLevel = normalizeMemoryLevel(row.memory_level);
          if (!parsedMemoryLevel) {
            rowErrors.push({
              field: "memory_level",
              reason: `must be one of ${MEMORY_LEVELS.join(",")}`,
            });
          } else {
            memoryLevel = parsedMemoryLevel;
          }
        }
      }

      let sourceEventType = "management_import";
      if (row.source_event_type !== undefined) {
        if (typeof row.source_event_type !== "string") {
          rowErrors.push({
            field: "source_event_type",
            reason: "must be string",
          });
        } else {
          const parsedSourceEventType = row.source_event_type.trim();
          if (!parsedSourceEventType) {
            rowErrors.push({
              field: "source_event_type",
              reason: "must be non-empty string",
            });
          } else {
            sourceEventType = parsedSourceEventType;
          }
        }
      }

      let executionVerified = false;
      if (row.execution_verified !== undefined) {
        if (typeof row.execution_verified !== "boolean") {
          rowErrors.push({
            field: "execution_verified",
            reason: "must be boolean",
          });
        } else {
          executionVerified = row.execution_verified;
        }
      }

      const evidenceRef = normalizeMemoryEvidenceRef(row.evidence_ref);
      if (row.evidence_ref !== undefined && !evidenceRef) {
        rowErrors.push({
          field: "evidence_ref",
          reason: "must include at least one non-empty field",
        });
      }
      if (memoryLevel !== MEMORY_LEVEL_L1 && !executionVerified) {
        rowErrors.push({
          field: "execution_verified",
          reason: "L2/L3/L4 memory requires execution_verified=true",
        });
      }
      if (memoryLevel !== MEMORY_LEVEL_L1 && !evidenceRef) {
        rowErrors.push({
          field: "evidence_ref",
          reason: "L2/L3/L4 memory requires evidence_ref",
        });
      }

      if (rowErrors.length > 0) {
        invalidRows.push({
          index: idx,
          errors: rowErrors,
        });
        continue;
      }

      normalizedRows.push({
        id: recordId || generateMemoryRecordId(),
        kind,
        text,
        classification,
        state,
        tags,
        source: normalizedSource,
        source_event_type: sourceEventType,
        importance: importanceParsed.value,
        confidence: confidenceParsed.value,
        scope,
        memory_level: memoryLevel,
        execution_verified: executionVerified,
        evidence_ref: evidenceRef,
      });
    }

    if (invalidRows.length > 0) {
      return {
        ok: false,
        result: {
          error: "invalid_record_schema",
          scope,
          scope_root: scopeRoot,
          dry_run: dryRun,
          accepted_count: accepted.length,
          truncated_count: truncatedCount,
          invalid_count: invalidRows.length,
          invalid_rows: invalidRows.slice(0, 64),
        },
      };
    }

    const importedIds: string[] = [];
    const archivedOnImportIds: string[] = [];
    if (!dryRun) {
      const store = memoryRecordsBySession.get(sessionId) ?? [];
      for (const row of normalizedRows) {
        const rowId = String(row.id ?? "");
        const nowIso = new Date().toISOString();
        const nextRecord: Record<string, unknown> = {
          version: 1,
          id: rowId,
          kind: row.kind,
          scope,
          text: row.text,
          summary: String(row.text ?? "").slice(0, 140),
          tags: row.tags,
          source: row.source,
          source_event_type: row.source_event_type,
          session_key: sessionId,
          classification: row.classification,
          importance: row.importance,
          confidence: row.confidence,
          state: row.state,
          memory_level: row.memory_level,
          execution_verified: row.execution_verified,
          evidence_ref: row.evidence_ref,
          updated_at: nowIso,
        };
        if (row.state === MEMORY_STATE_ARCHIVED) {
          nextRecord.archived_at = nowIso;
          nextRecord.imported_archived = true;
        } else {
          nextRecord.archived_at = "";
        }
        const existingIndex = store.findIndex((record) => String(record.id ?? "") === rowId);
        if (existingIndex >= 0) {
          const existing = store[existingIndex];
          if (typeof existing.created_at === "string" && existing.created_at.trim().length > 0) {
            nextRecord.created_at = existing.created_at;
          } else {
            nextRecord.created_at = nowIso;
          }
          store[existingIndex] = nextRecord;
        } else {
          nextRecord.created_at = nowIso;
          store.push(nextRecord);
        }
        importedIds.push(rowId);
        if (row.state === MEMORY_STATE_ARCHIVED) {
          archivedOnImportIds.push(rowId);
        }
      }
      memoryRecordsBySession.set(sessionId, store);
    } else {
      for (const row of normalizedRows) {
        const rowId = String(row.id ?? "");
        importedIds.push(rowId);
        if (row.state === MEMORY_STATE_ARCHIVED) {
          archivedOnImportIds.push(rowId);
        }
      }
    }

    return {
      ok: true,
      result: {
        scope,
        scope_root: scopeRoot,
        dry_run: dryRun,
        accepted_count: accepted.length,
        truncated_count: truncatedCount,
        imported_count: importedIds.length,
        archived_on_import_count: archivedOnImportIds.length,
        invalid_count: 0,
        imported_ids: importedIds.slice(0, 64),
        archived_on_import_ids: archivedOnImportIds.slice(0, 64),
        invalid_rows: [],
      },
    };
  };

  const forgetMemoryRows = (
    sessionId: string,
    scope: MemoryScope,
    ids: string[],
    reason: string | undefined,
    dryRun: boolean,
  ): MemoryMutationResult => {
    const normalizedIds = ids
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .filter((item, index, arr) => arr.indexOf(item) === index);
    if (!normalizedIds.length) {
      return {
        ok: false,
        result: {
          error: "record_ids is required",
        },
      };
    }

    const targetIds = normalizedIds.slice(0, MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT);
    const truncatedCount = Math.max(0, normalizedIds.length - targetIds.length);
    const store = memoryRecordsBySession.get(sessionId) ?? [];
    const forgottenIds: string[] = [];
    const alreadyArchivedIds: string[] = [];
    const notFoundIds: string[] = [];

    for (const recordId of targetIds) {
      const locatedIndex = store.findIndex((record) => {
        if (String(record.id ?? "") !== recordId) {
          return false;
        }
        return memoryScopeMatches(record.scope, scope);
      });
      if (locatedIndex < 0) {
        notFoundIds.push(recordId);
        continue;
      }
      const located = store[locatedIndex];
      const currentState = normalizeMemoryState(String(located.state ?? MEMORY_STATE_ACTIVE)) ?? MEMORY_STATE_ACTIVE;
      if (currentState === MEMORY_STATE_ARCHIVED) {
        alreadyArchivedIds.push(recordId);
        continue;
      }
      forgottenIds.push(recordId);
      if (!dryRun) {
        const nowIso = new Date().toISOString();
        store[locatedIndex] = {
          ...located,
          state: MEMORY_STATE_ARCHIVED,
          archived_at: nowIso,
          forgotten_by: "management",
          forget_reason: reason ?? "",
          updated_at: nowIso,
        };
      }
    }
    if (!dryRun) {
      memoryRecordsBySession.set(sessionId, store);
    }

    return {
      ok: true,
      result: {
        requested_count: targetIds.length,
        truncated_count: truncatedCount,
        forgotten_count: forgottenIds.length,
        already_archived_count: alreadyArchivedIds.length,
        not_found_count: notFoundIds.length,
        forgotten_ids: forgottenIds,
        already_archived_ids: alreadyArchivedIds,
        not_found_ids: notFoundIds,
        dry_run: dryRun,
      },
    };
  };

  const runMemoryLifecycle = (
    sessionId: string,
    scope: MemoryScope,
    dryRun: boolean,
  ): MemoryLifecycleResult => {
    const store = memoryRecordsBySession.get(sessionId) ?? [];
    let scanned = 0;
    let changed = 0;
    let promoteCount = 0;
    let decayCount = 0;
    let archiveCount = 0;
    const rowsPreview: string[] = [];

    for (let index = 0; index < store.length; index += 1) {
      if (changed >= MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT) {
        break;
      }
      const record = store[index];
      if (!memoryScopeMatches(record.scope, scope)) {
        continue;
      }
      const state = normalizeMemoryState(String(record.state ?? MEMORY_STATE_ACTIVE)) ?? MEMORY_STATE_ACTIVE;
      if (state === MEMORY_STATE_ARCHIVED) {
        continue;
      }
      scanned += 1;

      const importance = clampUnitNumber(record.importance, 0.6).value;
      const confidence = clampUnitNumber(record.confidence, 0.6).value;
      let action: "promote" | "decay" | "archive" | undefined;
      let reason = "";
      if (importance <= 0.2 || confidence <= 0.25) {
        action = "archive";
        reason = `importance=${importance.toFixed(3)}, confidence=${confidence.toFixed(3)}`;
      } else if (importance >= 0.85 && confidence >= 0.85) {
        action = "promote";
        reason = `importance=${importance.toFixed(3)}, confidence=${confidence.toFixed(3)}`;
      } else if (importance > 0.3) {
        action = "decay";
        reason = `importance=${importance.toFixed(3)}`;
      }
      if (!action) {
        continue;
      }

      changed += 1;
      const memoryId = String(record.id ?? "");
      if (action === "promote") {
        promoteCount += 1;
      } else if (action === "decay") {
        decayCount += 1;
      } else {
        archiveCount += 1;
      }
      rowsPreview.push(`- ${action}: ${memoryId} (${reason})`);
      if (dryRun) {
        continue;
      }
      const nowIso = new Date().toISOString();
      if (action === "archive") {
        store[index] = {
          ...record,
          state: MEMORY_STATE_ARCHIVED,
          archived_at: nowIso,
          updated_at: nowIso,
        };
      } else if (action === "decay") {
        const nextImportance = Math.max(0.3, Number((importance * 0.9).toFixed(4)));
        store[index] = {
          ...record,
          importance: nextImportance,
          state: MEMORY_STATE_ACTIVE,
          archived_at: "",
          updated_at: nowIso,
        };
      } else {
        const nextImportance = Math.min(1, Number((importance + 0.05).toFixed(4)));
        store[index] = {
          ...record,
          importance: nextImportance,
          state: MEMORY_STATE_ACTIVE,
          archived_at: "",
          updated_at: nowIso,
        };
      }
    }
    if (!dryRun) {
      memoryRecordsBySession.set(sessionId, store);
    }

    const lines = [
      `memory lifecycle: dry_run=${dryRun ? "on" : "off"}`,
      `roots=1 scanned=${String(scanned)} changed=${String(changed)} batch_limit=${String(MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT)}`,
      `actions=promote:${String(promoteCount)} decay:${String(decayCount)} archive:${String(archiveCount)}`,
    ];
    const previewLimit = 8;
    if (rowsPreview.length > 0) {
      lines.push(...rowsPreview.slice(0, previewLimit));
      if (rowsPreview.length > previewLimit) {
        lines.push(`... (+${String(rowsPreview.length - previewLimit)} more)`);
      }
    }
    return {
      ok: true,
      lines,
    };
  };

  const runMemoryLifecycleAcrossSessions = (
    options: {
      scope: MemoryScope;
      dryRun: boolean;
      sessions: string[];
      sessionPrefixes: string[];
      limit: number;
    },
  ): MemoryBatchLifecycleResult => {
    const requestedSessions: string[] = [];
    const seenSessions = new Set<string>();
    const normalizedLimit = Math.max(1, Math.min(MANAGEMENT_MEMORY_BATCH_MAX_SESSIONS, options.limit));
    for (const rawSession of options.sessions) {
      const cleaned = rawSession.trim();
      if (!cleaned || seenSessions.has(cleaned)) {
        continue;
      }
      seenSessions.add(cleaned);
      requestedSessions.push(cleaned);
      if (requestedSessions.length >= normalizedLimit) {
        break;
      }
    }

    let discoveryTruncated = false;
    if (requestedSessions.length < normalizedLimit && options.sessionPrefixes.length > 0) {
      const availableSessions = Array.from(memoryRecordsBySession.keys());
      for (const prefix of options.sessionPrefixes) {
        const cleanedPrefix = prefix.trim();
        if (!cleanedPrefix) {
          continue;
        }
        for (const sessionId of availableSessions) {
          if (!sessionId.startsWith(cleanedPrefix)) {
            continue;
          }
          if (seenSessions.has(sessionId)) {
            continue;
          }
          seenSessions.add(sessionId);
          requestedSessions.push(sessionId);
          if (requestedSessions.length >= normalizedLimit) {
            discoveryTruncated = true;
            break;
          }
        }
        if (requestedSessions.length >= normalizedLimit) {
          break;
        }
      }
    } else if (requestedSessions.length >= normalizedLimit) {
      discoveryTruncated = true;
    }

    const actions = {
      promote: 0,
      decay: 0,
      archive: 0,
    };
    let scanned = 0;
    let changed = 0;
    let successCount = 0;
    let failedCount = 0;
    const results: Array<Record<string, unknown>> = [];
    const lifecycleLinePattern = /^actions=promote:(\d+)\s+decay:(\d+)\s+archive:(\d+)$/;
    const summaryLinePattern = /^roots=\d+\s+scanned=(\d+)\s+changed=(\d+)\s+batch_limit=\d+$/;
    for (const sessionId of requestedSessions) {
      const startedAtMs = Date.now();
      const lifecycleResult = runMemoryLifecycle(sessionId, options.scope, options.dryRun);
      if (!lifecycleResult.ok) {
        failedCount += 1;
      } else {
        successCount += 1;
      }

      for (const line of lifecycleResult.lines) {
        const summaryMatch = line.match(summaryLinePattern);
        if (summaryMatch) {
          scanned += Number.parseInt(summaryMatch[1] ?? "0", 10) || 0;
          changed += Number.parseInt(summaryMatch[2] ?? "0", 10) || 0;
        }
        const lifecycleMatch = line.match(lifecycleLinePattern);
        if (lifecycleMatch) {
          actions.promote += Number.parseInt(lifecycleMatch[1] ?? "0", 10) || 0;
          actions.decay += Number.parseInt(lifecycleMatch[2] ?? "0", 10) || 0;
          actions.archive += Number.parseInt(lifecycleMatch[3] ?? "0", 10) || 0;
        }
      }

      results.push({
        session_id: sessionId,
        status: lifecycleResult.ok ? "ok" : "error",
        code: lifecycleResult.ok ? 0 : 1,
        duration_ms: Math.max(0, Date.now() - startedAtMs),
        lines: lifecycleResult.lines.slice(0, 12),
      });
    }

    return {
      status: failedCount > 0 ? "partial" : "ok",
      requestedCount: requestedSessions.length,
      successCount,
      failedCount,
      actions,
      scanned,
      changed,
      discoveryTruncated,
      results: results.slice(0, 64),
    };
  };

  return {
    listMemoryRows,
    importMemoryRows,
    forgetMemoryRows,
    runMemoryLifecycle,
    runMemoryLifecycleAcrossSessions,
  };
}
