import type {
  MemoryOrchestratorGaMemoryRecord,
  MemoryOrchestratorReconcileInput,
  MemoryOrchestratorReconcileResult,
} from "./contract";
import { normalizeText } from "./utils";

export function reconcileMemoryRows<T extends MemoryOrchestratorGaMemoryRecord>(
  request: MemoryOrchestratorReconcileInput<T>,
): MemoryOrchestratorReconcileResult<T> {
  const dedupe = new Set<string>();
  let deduplicated = 0;
  const rows: T[] = [];
  for (const row of request.rows) {
    const key = `${row.memoryLevel}:${normalizeText(row.text).toLowerCase()}`;
    if (dedupe.has(key)) {
      deduplicated += 1;
      continue;
    }
    dedupe.add(key);
    rows.push(row);
  }
  return {
    deduplicated,
    kept: rows.length,
    rows,
  };
}
