import { runActiveRecoveryCase } from "./runtime-tool-recovery-timeline-contract/active-case";
import { runBrowserRecoveryCase } from "./runtime-tool-recovery-timeline-contract/browser-case";
import { runCustomPolicyCase } from "./runtime-tool-recovery-timeline-contract/custom-policy-case";
import { runLegacyActionCase } from "./runtime-tool-recovery-timeline-contract/legacy-action-case";
import { runRecoveryStateCases } from "./runtime-tool-recovery-timeline-contract/recovery-state-case";

const active = runActiveRecoveryCase();
const legacy = runLegacyActionCase();
runBrowserRecoveryCase();
const customPolicy = runCustomPolicyCase(active);
const recoveryStates = runRecoveryStateCases(active);

process.stdout.write(JSON.stringify({
  ok: true,
  active_timeline_count: active.activeTimeline.length,
  active_latest_recovery_key: active.activeTimeline[0]?.recoveryKey ?? null,
  active_latest_same_tool_error_count: active.activeTimeline[0]?.sameToolErrorCount ?? null,
  active_latest_escalated: active.activeTimeline[0]?.escalated ?? null,
  active_latest_escalation_reason: active.activeTimeline[0]?.escalationReason ?? null,
  legacy_raw_action: legacy.legacyActionTimeline[0]?.rawRecommendedNextAction ?? null,
  legacy_effective_action: legacy.legacyActionTimeline[0]?.effectiveRecommendedNextAction ?? null,
  active_health_level: active.activeHealth.level,
  active_health_score: active.activeHealth.score,
  active_health_stuck_nonrecoverable: active.activeHealth.hasStuckNonrecoverable,
  active_health_attention_source: active.activeHealth.attentionSource,
  active_readiness_status: active.activeReadiness.status,
  active_readiness_auto_allowed: active.activeReadiness.automaticRecoveryAllowed,
  active_decision_gate_reason: active.activeDecision.gate.reason,
  active_decision_gate_blocker_kind: active.activeDecision.gate.blockerKind,
  active_decision_gate_blocker_code: active.activeDecision.gate.blockerCode,
  active_decision_gate_blocker_action: active.activeDecision.gate.blockerAction,
  consumed_latest_recovery_consumed: recoveryStates.consumedTimeline[0]?.consumed ?? null,
  consumed_latest_same_tool_error_count: recoveryStates.consumedTimeline[0]?.sameToolErrorCount ?? null,
  consumed_latest_escalated: recoveryStates.consumedTimeline[0]?.escalated ?? null,
  consumed_latest_escalation_reason: recoveryStates.consumedTimeline[0]?.escalationReason ?? null,
  consumed_health_level: recoveryStates.consumedHealth.level,
  consumed_health_unconsumed_count: recoveryStates.consumedHealth.unconsumedCount,
  consumed_health_attention_source: recoveryStates.consumedHealth.attentionSource,
  consumed_readiness_status: recoveryStates.consumedReadiness.status,
  consumed_readiness_auto_allowed: recoveryStates.consumedReadiness.automaticRecoveryAllowed,
  consumed_decision_gate_reason: recoveryStates.consumedDecision.gate.reason,
  custom_policy_active_health_score: customPolicy.customPolicyActiveHealth.score,
  custom_policy_decision_policy_version: customPolicy.customPolicyActiveDecision.policy.version,
  custom_policy_decision_watch_threshold: customPolicy.customPolicyActiveDecision.gate.watchScoreThreshold,
  fully_recovered_health_level: recoveryStates.fullyRecoveredDecision.health.level,
  fully_recovered_readiness_status: recoveryStates.fullyRecoveredDecision.readiness.status,
  fully_recovered_gate_status: recoveryStates.fullyRecoveredDecision.gate.status,
}) + "\n");
