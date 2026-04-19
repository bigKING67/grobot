import { mkdirSync } from "node:fs";
import {
  applyMemoryDecayAutotuneToPolicy,
  defaultMemoryDecayAutotuneState,
  defaultMemoryOrchestratorPolicy,
  deriveMemoryDecayAutotuneState,
  normalizeMemoryDecayAutotuneState,
  readMemoryDecayAutotuneState,
  writeMemoryDecayAutotuneState,
} from "../../tools/memory";

const basePolicy = defaultMemoryOrchestratorPolicy();
const baseState = defaultMemoryDecayAutotuneState(basePolicy);

const capacityUpdate = deriveMemoryDecayAutotuneState({
  basePolicy,
  currentState: {
    ...baseState,
    capacityTrimRatioEma: 0.9,
  },
  stats: {
    sessionsScanned: 4,
    totalRowsBefore: 80,
    totalRowsAfter: 55,
    droppedRows: 25,
    droppedByAge: 4,
    droppedByConfidence: 3,
    droppedByCapacity: 18,
  },
  nowIso: "2026-04-19T09:00:00.000Z",
});

const confidenceUpdate = deriveMemoryDecayAutotuneState({
  basePolicy,
  currentState: {
    ...capacityUpdate.state,
    lowConfidenceRatioEma: 0.9,
  },
  stats: {
    sessionsScanned: 4,
    totalRowsBefore: 60,
    totalRowsAfter: 44,
    droppedRows: 16,
    droppedByAge: 1,
    droppedByConfidence: 12,
    droppedByCapacity: 3,
  },
  nowIso: "2026-04-19T09:05:00.000Z",
});

const qualityPressureUpdate = deriveMemoryDecayAutotuneState({
  basePolicy,
  currentState: {
    ...baseState,
    qualityLowRateEma: 0.68,
    qualityPressureEma: 0.72,
    hardBudgetFollowupDeltaEma: -0.12,
  },
  stats: {
    sessionsScanned: 1,
    totalRowsBefore: 0,
    totalRowsAfter: 0,
    droppedRows: 0,
    droppedByAge: 0,
    droppedByConfidence: 0,
    droppedByCapacity: 0,
  },
  quality: {
    lowQualityRate: 0.8,
    averagePreSendPressureScore: 0.86,
    hardBudgetFollowupOverallDelta: -0.22,
    qualityFirstFollowupOverallDelta: -0.01,
    hardBudgetRate: 0.71,
    qualityFirstImprovedRate: 0.29,
  },
  nowIso: "2026-04-19T09:08:00.000Z",
});

const qualitySignalUpdate = deriveMemoryDecayAutotuneState({
  basePolicy,
  currentState: {
    ...baseState,
    qualityLowRateEma: 0.08,
    qualityPressureEma: 0.16,
    qualityFirstFollowupDeltaEma: 0.05,
  },
  stats: {
    sessionsScanned: 1,
    totalRowsBefore: 0,
    totalRowsAfter: 0,
    droppedRows: 0,
    droppedByAge: 0,
    droppedByConfidence: 0,
    droppedByCapacity: 0,
  },
  quality: {
    lowQualityRate: 0.05,
    averagePreSendPressureScore: 0.21,
    hardBudgetFollowupOverallDelta: -0.01,
    qualityFirstFollowupOverallDelta: 0.09,
    hardBudgetRate: 0.11,
    qualityFirstImprovedRate: 0.86,
  },
  nowIso: "2026-04-19T09:10:00.000Z",
});

const normalizedInvalid = normalizeMemoryDecayAutotuneState(
  {
    maxRowsPerSession: -20,
    minConfidenceVerified: 8,
    minConfidenceUnverified: -1,
    unverifiedMaxAgeHours: "bad",
    adaptiveLearnAlpha: 99,
    adaptiveUpdates: -7,
  },
  basePolicy,
);

const policyAfterAutotune = applyMemoryDecayAutotuneToPolicy({
  basePolicy,
  state: confidenceUpdate.state,
});

const tempWorkDir = `${process.cwd()}/.grobot/tmp/memory-decay-autotune-contract`;
mkdirSync(tempWorkDir, { recursive: true });
writeMemoryDecayAutotuneState({
  workDir: tempWorkDir,
  basePolicy,
  state: confidenceUpdate.state,
});
const reloaded = readMemoryDecayAutotuneState({
  workDir: tempWorkDir,
  basePolicy,
});

const payload = {
  capacity_update_changed: capacityUpdate.changed,
  capacity_update_expands_rows:
    capacityUpdate.state.maxRowsPerSession > baseState.maxRowsPerSession,
  capacity_update_has_reason: capacityUpdate.reason.includes("capacity_pressure_expand"),
  confidence_update_changed: confidenceUpdate.changed,
  confidence_update_tightens_verified:
    confidenceUpdate.state.minConfidenceVerified > capacityUpdate.state.minConfidenceVerified,
  confidence_update_tightens_unverified:
    confidenceUpdate.state.minConfidenceUnverified > capacityUpdate.state.minConfidenceUnverified,
  confidence_update_has_reason:
    confidenceUpdate.reason.includes("confidence_gate_tighten"),
  quality_pressure_update_changed: qualityPressureUpdate.changed,
  quality_pressure_update_has_reason:
    qualityPressureUpdate.reason.includes("quality_pressure_tighten"),
  quality_pressure_update_shrinks_rows:
    qualityPressureUpdate.state.maxRowsPerSession < baseState.maxRowsPerSession,
  quality_pressure_update_tightens_verified:
    qualityPressureUpdate.state.minConfidenceVerified > baseState.minConfidenceVerified,
  quality_pressure_update_tightens_unverified:
    qualityPressureUpdate.state.minConfidenceUnverified > baseState.minConfidenceUnverified,
  quality_signal_update_changed: qualitySignalUpdate.changed,
  quality_signal_update_has_reason:
    qualitySignalUpdate.reason.includes("quality_signal_relax"),
  quality_signal_update_expands_rows:
    qualitySignalUpdate.state.maxRowsPerSession > baseState.maxRowsPerSession,
  quality_signal_update_relaxes_verified:
    qualitySignalUpdate.state.minConfidenceVerified <= baseState.minConfidenceVerified,
  quality_signal_update_relaxes_unverified:
    qualitySignalUpdate.state.minConfidenceUnverified <= baseState.minConfidenceUnverified,
  normalized_invalid_rows_floor:
    normalizedInvalid.maxRowsPerSession >= Math.max(basePolicy.decayMinRowsToKeep + 2, 16),
  normalized_invalid_verified_confidence_clamped:
    normalizedInvalid.minConfidenceVerified <= 0.75,
  normalized_invalid_unverified_confidence_clamped:
    normalizedInvalid.minConfidenceUnverified >= 0.2,
  normalized_invalid_alpha_clamped:
    normalizedInvalid.adaptiveLearnAlpha <= 0.5,
  policy_applied_matches_state:
    policyAfterAutotune.decayMaxRowsPerSession === confidenceUpdate.state.maxRowsPerSession
    && policyAfterAutotune.decayMinConfidenceVerified === confidenceUpdate.state.minConfidenceVerified
    && policyAfterAutotune.decayMinConfidenceUnverified === confidenceUpdate.state.minConfidenceUnverified,
  state_roundtrip_updates_kept:
    reloaded.adaptiveUpdates === confidenceUpdate.state.adaptiveUpdates,
  state_roundtrip_reason_kept:
    reloaded.lastReason === confidenceUpdate.state.lastReason,
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
