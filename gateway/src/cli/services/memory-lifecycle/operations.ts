import { forgetMemoryRows } from "./forget";
import { importMemoryRows } from "./import";
import { runMemoryLifecycle, runMemoryLifecycleAcrossSessions } from "./lifecycle";
import { listMemoryRows } from "./list";
import { type MemoryOperations } from "./contract";

export function createMemoryOperations(
  memoryRecordsBySession: Map<string, Record<string, unknown>[]>,
): MemoryOperations {
  return {
    listMemoryRows: (sessionId, options) => listMemoryRows(memoryRecordsBySession, sessionId, options),
    importMemoryRows: (sessionId, scope, rawRecords, source, dryRun) =>
      importMemoryRows(memoryRecordsBySession, sessionId, scope, rawRecords, source, dryRun),
    forgetMemoryRows: (sessionId, scope, ids, reason, dryRun) =>
      forgetMemoryRows(memoryRecordsBySession, sessionId, scope, ids, reason, dryRun),
    runMemoryLifecycle: (sessionId, scope, dryRun) =>
      runMemoryLifecycle(memoryRecordsBySession, sessionId, scope, dryRun),
    runMemoryLifecycleAcrossSessions: (options) => runMemoryLifecycleAcrossSessions(memoryRecordsBySession, options),
  };
}
