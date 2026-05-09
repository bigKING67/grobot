import {
  MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT,
  MEMORY_STATE_ACTIVE,
  MEMORY_STATE_ARCHIVED,
  type MemoryMutationResult,
  type MemoryScope,
} from "./contract";
import { memoryScopeMatches, normalizeMemoryState } from "./normalize";

export function forgetMemoryRows(
  memoryRecordsBySession: Map<string, Record<string, unknown>[]>,
  sessionId: string,
  scope: MemoryScope,
  ids: string[],
  reason: string | undefined,
  dryRun: boolean,
): MemoryMutationResult {
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
  if (normalizedIds.length > MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT) {
    return {
      ok: false,
      result: {
        error: "invalid_record_ids_batch_size",
        record_id_count: normalizedIds.length,
        batch_limit: MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT,
      },
    };
  }

  const targetIds = normalizedIds;
  const truncatedCount = 0;
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
}
