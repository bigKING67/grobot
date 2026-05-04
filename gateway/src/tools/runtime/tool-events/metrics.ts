import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RuntimeEvent } from "../../../models/types";
import { RUNTIME_TOOL_RECOVERY_POLICY } from "../tool-recovery-policy";
import type { RuntimeToolSurfaceMetricsSnapshot } from "./contract";
import { addMap, increment } from "./counters";
import {
  applyRepeatedRecoveryEscalation,
  recoveryRepeatKey,
  recoveryRepeatKeyFromParts,
} from "./escalation";
import { metricsPathForWorkDir, readState, toSnapshot } from "./state";
import { summarizeRuntimeToolEvents } from "./summary";

export function recordRuntimeToolSurfaceMetrics(input: {
  workDir: string;
  events: readonly RuntimeEvent[];
}): RuntimeToolSurfaceMetricsSnapshot {
  const path = metricsPathForWorkDir(input.workDir);
  const summary = summarizeRuntimeToolEvents(input.events);
  const state = readState(path);
  if (summary.callsTotal === 0 && Object.keys(summary.recoveryStages).length === 0) {
    return toSnapshot(path, state);
  }
  state.updatedAt = new Date().toISOString();
  state.callsTotal += summary.callsTotal;
  state.failedTotal += summary.failedTotal;
  state.deferredTotal += summary.deferredTotal;
  addMap(state.callsByTool, summary.callsByTool);
  addMap(state.failuresByErrorClass, summary.failuresByErrorClass);
  addMap(state.recoveryStages, summary.recoveryStages);
  addMap(state.durationTotalMsByTool, summary.durationTotalMsByTool);
  addMap(state.durationCountByTool, summary.durationCountByTool);
  if (summary.latestRecovery) {
    const repeatKey = recoveryRepeatKey(summary.latestRecovery);
    increment(state.recoveryCountsByKey, repeatKey);
    const sameToolErrorCount =
      state.latestRecoveryRepeatKey === repeatKey
        ? state.latestRecoveryRepeatCount + 1
        : 1;
    state.latestRecoveryRepeatKey = repeatKey;
    state.latestRecoveryRepeatCount = sameToolErrorCount;
    const escalatedRecovery = applyRepeatedRecoveryEscalation({
      recovery: summary.latestRecovery,
      sameToolErrorCount,
    });
    state.recentRecoveries.push({
      ...escalatedRecovery,
      observedAt: state.updatedAt,
    });
    state.recentRecoveries = state.recentRecoveries.slice(-1 * RUNTIME_TOOL_RECOVERY_POLICY.timelineMaxEntries);
  } else {
    state.latestRecoveryRepeatKey = "";
    state.latestRecoveryRepeatCount = 0;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return toSnapshot(path, state);
}

export function readRuntimeToolSurfaceMetrics(workDir: string): RuntimeToolSurfaceMetricsSnapshot {
  const path = metricsPathForWorkDir(workDir);
  return toSnapshot(path, readState(path));
}

export function clearRuntimeToolRecoveryRepeatPressure(input: {
  workDir: string;
  toolName?: string | null;
  errorClass?: string | null;
  nowIso?: string;
}): {
  cleared: boolean;
  snapshot: RuntimeToolSurfaceMetricsSnapshot;
} {
  const path = metricsPathForWorkDir(input.workDir);
  const state = readState(path);
  if (!state.latestRecoveryRepeatKey || state.latestRecoveryRepeatCount <= 0) {
    return {
      cleared: false,
      snapshot: toSnapshot(path, state),
    };
  }
  const expectedKey =
    input.toolName || input.errorClass
      ? recoveryRepeatKeyFromParts({
          toolName: input.toolName,
          errorClass: input.errorClass,
        })
      : "";
  if (expectedKey && expectedKey !== state.latestRecoveryRepeatKey) {
    return {
      cleared: false,
      snapshot: toSnapshot(path, state),
    };
  }
  state.latestRecoveryRepeatKey = "";
  state.latestRecoveryRepeatCount = 0;
  state.updatedAt = input.nowIso ?? new Date().toISOString();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return {
    cleared: true,
    snapshot: toSnapshot(path, state),
  };
}
