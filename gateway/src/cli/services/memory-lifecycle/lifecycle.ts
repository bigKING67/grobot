import {
  MANAGEMENT_MEMORY_BATCH_MAX_SESSIONS,
  MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT,
  MEMORY_STATE_ACTIVE,
  MEMORY_STATE_ARCHIVED,
  type MemoryBatchLifecycleResult,
  type MemoryLifecycleResult,
  type MemoryScope,
} from "./contract";
import { clampUnitNumber, memoryScopeMatches, normalizeMemoryState } from "./normalize";

export function runMemoryLifecycle(
  memoryRecordsBySession: Map<string, Record<string, unknown>[]>,
  sessionId: string,
  scope: MemoryScope,
  dryRun: boolean,
): MemoryLifecycleResult {
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
    `roots=1 scanned=${String(scanned)} changed=${String(changed)} batch_limit=${String(
      MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT,
    )}`,
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
}

export function runMemoryLifecycleAcrossSessions(
  memoryRecordsBySession: Map<string, Record<string, unknown>[]>,
  options: {
    scope: MemoryScope;
    dryRun: boolean;
    sessions: string[];
    sessionPrefixes: string[];
    limit: number;
  },
): MemoryBatchLifecycleResult {
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
    const lifecycleResult = runMemoryLifecycle(memoryRecordsBySession, sessionId, options.scope, options.dryRun);
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
}
