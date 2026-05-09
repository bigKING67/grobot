import {
  MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT,
  MEMORY_CLASSIFICATION_INTERNAL,
  MEMORY_CLASSIFICATIONS,
  MEMORY_KIND_EPISODIC,
  MEMORY_KINDS,
  MEMORY_LEVEL_L1,
  MEMORY_LEVELS,
  MEMORY_STATE_ACTIVE,
  MEMORY_STATE_ARCHIVED,
  type MemoryClassification,
  type MemoryKind,
  type MemoryLevel,
  type MemoryMutationResult,
  type MemoryScope,
  type MemoryState,
} from "./contract";
import {
  buildMemoryScopeRoot,
  generateMemoryRecordId,
  normalizeMemoryClassification,
  normalizeMemoryKind,
  normalizeMemoryLevel,
  normalizeMemoryState,
} from "./normalize";

type RowError = Record<string, string>;

const EVIDENCE_REF_FIELDS = ["trace_id", "turn_id", "tool_call_id", "source"] as const;

function parseImportUnitNumber(raw: unknown, defaultValue: number, field: string): {
  value: number;
  error?: RowError;
} {
  if (raw === undefined) {
    return {
      value: defaultValue,
    };
  }
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1) {
    return {
      value: defaultValue,
      error: {
        field,
        reason: "must be number in range [0,1]",
      },
    };
  }
  return {
    value: raw,
  };
}

function parseImportEvidenceRef(raw: unknown): {
  value: Record<string, string> | undefined;
  errors: RowError[];
} {
  if (raw === undefined) {
    return {
      value: undefined,
      errors: [],
    };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      value: undefined,
      errors: [
        {
          field: "evidence_ref",
          reason: "must be object",
        },
      ],
    };
  }

  const record = raw as Record<string, unknown>;
  const value: Record<string, string> = {};
  const errors: RowError[] = [];
  for (const field of EVIDENCE_REF_FIELDS) {
    const fieldValue = record[field];
    if (fieldValue === undefined) {
      continue;
    }
    if (typeof fieldValue !== "string") {
      errors.push({
        field: `evidence_ref.${field}`,
        reason: "must be string",
      });
      continue;
    }
    const cleaned = fieldValue.trim();
    if (!cleaned) {
      errors.push({
        field: `evidence_ref.${field}`,
        reason: "must be non-empty string",
      });
      continue;
    }
    value[field] = cleaned;
  }
  if (Object.keys(value).length === 0 && errors.length === 0) {
    errors.push({
      field: "evidence_ref",
      reason: "must include at least one non-empty field",
    });
  }
  return {
    value: Object.keys(value).length > 0 ? value : undefined,
    errors,
  };
}

export function importMemoryRows(
  memoryRecordsBySession: Map<string, Record<string, unknown>[]>,
  sessionId: string,
  scope: MemoryScope,
  rawRecords: unknown,
  source: string | undefined,
  dryRun: boolean,
): MemoryMutationResult {
  if (!Array.isArray(rawRecords) || rawRecords.length === 0) {
    return {
      ok: false,
      result: {
        error: "records is required",
      },
    };
  }
  if (rawRecords.length > MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT) {
    return {
      ok: false,
      result: {
        error: "invalid_record_batch_size",
        record_count: rawRecords.length,
        batch_limit: MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT,
      },
    };
  }

  const accepted = rawRecords;
  const truncatedCount = 0;
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
    const rowErrors: RowError[] = [];

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

    const importanceParsed = parseImportUnitNumber(row.importance, 0.6, "importance");
    if (importanceParsed.error) {
      rowErrors.push(importanceParsed.error);
    }
    const confidenceParsed = parseImportUnitNumber(row.confidence, 0.6, "confidence");
    if (confidenceParsed.error) {
      rowErrors.push(confidenceParsed.error);
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
          if (!cleanedTag) {
            rowErrors.push({
              field: `tags[${String(tagIdx)}]`,
              reason: "must be non-empty string",
            });
            continue;
          }
          if (!tags.includes(cleanedTag)) {
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

    const evidenceRefResult = parseImportEvidenceRef(row.evidence_ref);
    const evidenceRef = evidenceRefResult.value;
    rowErrors.push(...evidenceRefResult.errors);
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
}
