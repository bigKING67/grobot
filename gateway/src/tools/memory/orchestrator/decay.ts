import type {
  MemoryOrchestratorDecayInput,
  MemoryOrchestratorDecayResult,
  MemoryOrchestratorGaMemoryRecord,
  MemoryOrchestratorPolicySnapshot,
} from "./contract";
import {
  clamp,
  computeAgeHours,
  createMemoryLevelCounter,
} from "./utils";

function resolveDecayMaxAgeHours(
  policy: MemoryOrchestratorPolicySnapshot,
  row: MemoryOrchestratorGaMemoryRecord,
): number {
  let maxAgeByLevel = policy.decayMaxAgeHoursL2;
  if (row.memoryLevel === "L1") {
    maxAgeByLevel = policy.decayMaxAgeHoursL1;
  } else if (row.memoryLevel === "L3") {
    maxAgeByLevel = policy.decayMaxAgeHoursL3;
  } else if (row.memoryLevel === "L4") {
    maxAgeByLevel = policy.decayMaxAgeHoursL4;
  }
  if (!row.executionVerified) {
    return Math.min(maxAgeByLevel, policy.decayUnverifiedMaxAgeHours);
  }
  return maxAgeByLevel;
}

function scoreDecayRetention(input: {
  policy: MemoryOrchestratorPolicySnapshot;
  row: MemoryOrchestratorGaMemoryRecord;
  nowMs: number;
}): number {
  const confidence = clamp(input.row.confidence, 0, 1);
  const ageHours = computeAgeHours(input.nowMs, input.row.createdAt);
  const maxAgeHours = Math.max(
    1,
    resolveDecayMaxAgeHours(input.policy, input.row),
  );
  const freshness = Math.max(0, 1 - Math.min(ageHours, maxAgeHours) / maxAgeHours);
  const levelWeight =
    input.row.memoryLevel === "L4"
      ? 6
      : input.row.memoryLevel === "L3"
      ? 4
      : input.row.memoryLevel === "L2"
      ? 2
      : 1;
  const executionBoost = input.row.executionVerified ? 0.8 : 0;
  return Number((levelWeight + executionBoost + (confidence * 3.2) + freshness).toFixed(6));
}

function buildDecayReason(input: {
  droppedByReason: {
    ageExceeded: number;
    lowConfidence: number;
    capacityTrim: number;
  };
  dropped: number;
}): string {
  if (input.dropped <= 0) {
    return "within_policy";
  }
  return [
    `age_exceeded:${String(input.droppedByReason.ageExceeded)}`,
    `low_confidence:${String(input.droppedByReason.lowConfidence)}`,
    `capacity_trim:${String(input.droppedByReason.capacityTrim)}`,
  ].join(",");
}

export function applyMemoryDecay<T extends MemoryOrchestratorGaMemoryRecord>(
  policy: MemoryOrchestratorPolicySnapshot,
  request: MemoryOrchestratorDecayInput<T>,
): MemoryOrchestratorDecayResult<T> {
  const rows = [...request.rows];
  const droppedByReason = {
    ageExceeded: 0,
    lowConfidence: 0,
    capacityTrim: 0,
  };
  if (!policy.decayEnabled) {
    const keptByLevel = createMemoryLevelCounter();
    for (const row of rows) {
      keptByLevel[row.memoryLevel] += 1;
    }
    return {
      action: "noop",
      reason: "policy_disabled",
      kept: rows.length,
      dropped: 0,
      rows,
      droppedByReason,
      keptByLevel,
    };
  }
  if (rows.length === 0) {
    return {
      action: "noop",
      reason: "empty_rows",
      kept: 0,
      dropped: 0,
      rows,
      droppedByReason,
      keptByLevel: createMemoryLevelCounter(),
    };
  }
  const minRowsToKeep = Math.max(1, Math.floor(policy.decayMinRowsToKeep));
  if (rows.length <= minRowsToKeep) {
    const keptByLevel = createMemoryLevelCounter();
    for (const row of rows) {
      keptByLevel[row.memoryLevel] += 1;
    }
    return {
      action: "noop",
      reason: "below_min_rows_to_keep",
      kept: rows.length,
      dropped: 0,
      rows,
      droppedByReason,
      keptByLevel,
    };
  }
  const nowMs = Number.isFinite(request.nowMs) ? Number(request.nowMs) : Date.now();
  const candidates: Array<{ index: number; score: number; row: T }> = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const ageHours = computeAgeHours(nowMs, row.createdAt);
    const maxAgeHours = resolveDecayMaxAgeHours(policy, row);
    if (ageHours > maxAgeHours) {
      droppedByReason.ageExceeded += 1;
      continue;
    }
    const minConfidence = row.executionVerified
      ? policy.decayMinConfidenceVerified
      : policy.decayMinConfidenceUnverified;
    if (clamp(row.confidence, 0, 1) < minConfidence) {
      droppedByReason.lowConfidence += 1;
      continue;
    }
    candidates.push({
      index,
      score: scoreDecayRetention({
        policy,
        row,
        nowMs,
      }),
      row,
    });
  }
  const maxRows = Math.max(1, Math.floor(policy.decayMaxRowsPerSession));
  let keptCandidates = candidates;
  if (candidates.length > maxRows) {
    const sorted = [...candidates].sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.row.confidence !== right.row.confidence) {
        return right.row.confidence - left.row.confidence;
      }
      return left.index - right.index;
    });
    keptCandidates = sorted.slice(0, maxRows);
    droppedByReason.capacityTrim = Math.max(0, sorted.length - keptCandidates.length);
  }
  const keepIndex = new Set<number>(keptCandidates.map((item) => item.index));
  const keptRows: T[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row && keepIndex.has(index)) {
      keptRows.push(row);
    }
  }
  const keptByLevel = createMemoryLevelCounter();
  for (const row of keptRows) {
    keptByLevel[row.memoryLevel] += 1;
  }
  const dropped = rows.length - keptRows.length;
  return {
    action: dropped > 0 ? "pruned" : "noop",
    reason: buildDecayReason({
      droppedByReason,
      dropped,
    }),
    kept: keptRows.length,
    dropped,
    rows: keptRows,
    droppedByReason,
    keptByLevel,
  };
}
