import {
  applyPromptQualityGuardFloor,
  assessPromptQualityGuardRuntime,
  defaultPromptQualityGuardState,
  evaluatePromptQualityGuard,
  normalizePromptQualityGuardState,
  type PromptCompactionStage,
} from "../../../tools/context";
import { isRecord, normalizePromptCompactionStage } from "./prompt-quality-shared";

export function runPromptQualityGuard(payload: Record<string, unknown>): Record<string, unknown> {
  const policy = parsePromptQualityGuardPolicy(payload);
  const selectedStage = normalizePromptCompactionStage(payload.selected_stage);
  const observationsRaw = Array.isArray(payload.observations) ? payload.observations : [];
  if (observationsRaw.length === 0) {
    throw new Error("payload.observations must be a non-empty array");
  }
  let state = isRecord(payload.state)
    ? normalizePromptQualityGuardState(payload.state)
    : defaultPromptQualityGuardState();
  const timeline: Array<Record<string, unknown>> = [];
  for (let index = 0; index < observationsRaw.length; index += 1) {
    const row = observationsRaw[index];
    if (!isRecord(row)) {
      continue;
    }
    const rowSelectedStage = normalizePromptCompactionStage(row.selected_stage ?? selectedStage);
    const observation = {
      degraded: row.degraded === true,
      reason: typeof row.reason === "string" ? row.reason : "unknown",
      observedOverall:
        typeof row.observed_overall === "number" && Number.isFinite(row.observed_overall)
          ? row.observed_overall
          : null,
      observedLowQualityRate:
        typeof row.observed_low_quality_rate === "number"
        && Number.isFinite(row.observed_low_quality_rate)
          ? row.observed_low_quality_rate
          : null,
    };
    const decision = evaluatePromptQualityGuard({
      policy,
      currentState: state,
      observation,
    });
    state = decision.state;
    const appliedStage = applyPromptQualityGuardFloor({
      selectedStage: rowSelectedStage,
      floorStage: decision.floorStage,
    });
    timeline.push({
      index,
      observation,
      floor_stage: decision.floorStage,
      applied_stage: appliedStage,
      triggered: decision.triggered,
      promoted: decision.promoted,
      released: decision.released,
      severe: decision.severe,
      severe_escalated: decision.severeEscalated,
      state: decision.state,
    });
  }
  return {
    policy,
    selected_stage: selectedStage,
    timeline,
    final_state: state,
  };
}

export function parsePromptQualityGuardPolicy(payload: Record<string, unknown>): {
  enabled: boolean;
  promoteStreak: number;
  severePromoteStreak: number;
  releaseStreak: number;
  holdTurns: number;
  maxFloorStage: PromptCompactionStage;
  severeOverallThreshold: number;
  severeLowQualityRateThreshold: number;
} {
  const policyRaw = isRecord(payload.policy) ? payload.policy : {};
  return {
    enabled: policyRaw.enabled !== false,
    promoteStreak:
      typeof policyRaw.promote_streak === "number" && Number.isFinite(policyRaw.promote_streak)
        ? Math.max(1, Math.floor(policyRaw.promote_streak))
        : 2,
    severePromoteStreak:
      typeof policyRaw.severe_promote_streak === "number" && Number.isFinite(policyRaw.severe_promote_streak)
        ? Math.max(1, Math.floor(policyRaw.severe_promote_streak))
        : 2,
    releaseStreak:
      typeof policyRaw.release_streak === "number" && Number.isFinite(policyRaw.release_streak)
        ? Math.max(1, Math.floor(policyRaw.release_streak))
        : 3,
    holdTurns:
      typeof policyRaw.hold_turns === "number" && Number.isFinite(policyRaw.hold_turns)
        ? Math.max(0, Math.floor(policyRaw.hold_turns))
        : 2,
    maxFloorStage: normalizePromptCompactionStage(policyRaw.max_floor_stage ?? "minimal"),
    severeOverallThreshold:
      typeof policyRaw.severe_overall_threshold === "number"
      && Number.isFinite(policyRaw.severe_overall_threshold)
        ? policyRaw.severe_overall_threshold
        : 0.45,
    severeLowQualityRateThreshold:
      typeof policyRaw.severe_low_quality_rate_threshold === "number"
      && Number.isFinite(policyRaw.severe_low_quality_rate_threshold)
        ? policyRaw.severe_low_quality_rate_threshold
        : 0.7,
  };
}

export function parsePromptQualityGuardAdaptiveModeAllowlist(
  payload: Record<string, unknown>,
): Array<"harden" | "relax"> {
  const policyRaw = isRecord(payload.policy) ? payload.policy : {};
  const rawValues = Array.isArray(policyRaw.adaptive_mode_allowlist)
    ? policyRaw.adaptive_mode_allowlist
    : [];
  const unique = new Set<"harden" | "relax">();
  for (const value of rawValues) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (normalized === "harden" || normalized === "relax") {
      unique.add(normalized);
    }
  }
  return Array.from(unique.values());
}

export function runPromptQualityGuardRuntime(payload: Record<string, unknown>): Record<string, unknown> {
  const policy = parsePromptQualityGuardPolicy(payload);
  const state = isRecord(payload.state)
    ? normalizePromptQualityGuardState(payload.state)
    : defaultPromptQualityGuardState();
  const observation = {
    degraded: payload.degraded === true,
    reason: typeof payload.reason === "string" ? payload.reason : "unknown",
    observedOverall:
      typeof payload.observed_overall === "number" && Number.isFinite(payload.observed_overall)
        ? payload.observed_overall
        : null,
    observedLowQualityRate:
      typeof payload.observed_low_quality_rate === "number"
      && Number.isFinite(payload.observed_low_quality_rate)
        ? payload.observed_low_quality_rate
        : null,
  };
  const assessment = assessPromptQualityGuardRuntime({
    policy,
    currentState: state,
    observation,
  });
  return {
    policy,
    state,
    observation,
    assessment: {
      enabled: assessment.enabled,
      phase: assessment.phase,
      transition: assessment.transition,
      degraded: assessment.degraded,
      severe: assessment.severe,
      reason: assessment.reason,
      triggered: assessment.triggered,
      floor_stage: assessment.floorStage,
      proposed_floor_stage: assessment.proposedFloorStage,
      promote_remaining: assessment.promoteRemaining,
      severe_promote_remaining: assessment.severePromoteRemaining,
      release_remaining: assessment.releaseRemaining,
      hold_turns_remaining: assessment.holdTurnsRemaining,
      observed_overall: assessment.observedOverall,
      observed_low_quality_rate: assessment.observedLowQualityRate,
    },
  };
}
