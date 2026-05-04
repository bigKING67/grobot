import type { HarnessCiSummary, JsonObject, PolicyDriftSeverity } from "./types";
import {
  asObject,
  computePolicyDriftActionHint,
  computePolicyDriftOwner,
  computePolicyDriftTransitionState,
  normalizeOptionalText,
  normalizePolicyDriftSeverity,
  toBool,
  toInt,
  toNumber,
} from "./normalizers";

export function normalizePolicyDriftFieldsForMarkdown(policyDrift: JsonObject): {
  severity: PolicyDriftSeverity;
  reason: string;
  previousSeverity: PolicyDriftSeverity;
  worseningStreak: number;
  worseningAlert: boolean;
  worseningAlertThreshold: number;
  worseningLabel: string;
  transition: string;
  transitionState: string;
  severityDelta: number;
  owner: string;
  actionHint: string;
} {
  const severity = normalizePolicyDriftSeverity(policyDrift.severity);
  const reason = normalizeOptionalText(policyDrift.reason) ?? "shape_ok";
  const previousSeverity = normalizePolicyDriftSeverity(policyDrift.previous_severity);
  let worseningStreak = toInt(policyDrift.worsening_streak, 0);
  if (worseningStreak < 0) {
    worseningStreak = 0;
  }
  const worseningAlert = toBool(policyDrift.worsening_alert, false);
  let worseningAlertThreshold = toInt(policyDrift.worsening_alert_threshold, 2);
  if (worseningAlertThreshold < 1) {
    worseningAlertThreshold = 2;
  }
  const worseningLabel = normalizeOptionalText(policyDrift.worsening_label) ?? "ci/policy-drift-worsening";
  const transition = `${previousSeverity}->${severity}`;
  const computed = computePolicyDriftTransitionState(previousSeverity, severity);
  const transitionState = normalizeOptionalText(policyDrift.transition_state) ?? computed.transitionState;
  const severityDelta = typeof policyDrift.severity_delta === "number" ? toInt(policyDrift.severity_delta, 0) : computed.severityDelta;
  const owner = normalizeOptionalText(policyDrift.owner) ?? computePolicyDriftOwner(severity);
  const actionHint = normalizeOptionalText(policyDrift.action_hint) ?? computePolicyDriftActionHint(severity, reason, transitionState);

  return {
    severity,
    reason,
    previousSeverity,
    worseningStreak,
    worseningAlert,
    worseningAlertThreshold,
    worseningLabel,
    transition,
    transitionState,
    severityDelta,
    owner,
    actionHint,
  };
}

export function renderHarnessCiSummaryMarkdown(summary: HarnessCiSummary): string {
  const trace = asObject(summary.trace as unknown);
  const skill = asObject(summary.skill_router as unknown);
  const contextMemory = asObject(summary.context_memory as unknown);
  const weeklyRegression = asObject(summary.weekly_regression as unknown);
  const policyDrift = asObject(summary.policy_drift as unknown);
  const autoLoop = asObject(summary.auto_loop as unknown);
  const splitCounts = asObject(trace.split_counts);
  const trendPassValue = skill.trend_pass;
  const trendRequired = toBool(skill.trend_required, false);
  let trendPassText = "n/a";
  if (typeof trendPassValue === "boolean") {
    trendPassText = trendPassValue ? "pass" : "fail";
  }
  const trendMode = normalizeOptionalText(skill.trend_mode) ?? "n/a";
  const trendReason = normalizeOptionalText(skill.trend_reason) ?? "n/a";
  const trendDecisionTag = normalizeOptionalText(skill.trend_decision_tag) ?? "n/a";
  const trendDecisionSeverity = normalizeOptionalText(skill.trend_decision_severity) ?? "n/a";
  const trendActionHint = normalizeOptionalText(skill.trend_action_hint) ?? "n/a";
  const trendOwner = normalizeOptionalText(skill.trend_owner) ?? "n/a";
  const baselineAvailableText =
    typeof skill.baseline_available === "boolean" ? (skill.baseline_available ? "yes" : "no") : "n/a";
  const policyBlobMatchText =
    typeof skill.policy_blob_match === "boolean" ? (skill.policy_blob_match ? "yes" : "no") : "n/a";
  const policyHashMatchText =
    typeof skill.policy_hash_match === "boolean" ? (skill.policy_hash_match ? "yes" : "no") : "n/a";
  const policyHashCurrent = normalizeOptionalText(skill.policy_hash_current) ?? "n/a";
  const policyHashBase = normalizeOptionalText(skill.policy_hash_base) ?? "n/a";

  const contextTrendRequired = toBool(contextMemory.trend_required, false);
  const contextTrendPassValue = contextMemory.trend_pass;
  let contextTrendPassText = "n/a";
  if (typeof contextTrendPassValue === "boolean") {
    contextTrendPassText = contextTrendPassValue ? "pass" : "fail";
  }
  const contextTrendMode = normalizeOptionalText(contextMemory.trend_mode) ?? "n/a";
  const contextTrendReason = normalizeOptionalText(contextMemory.trend_reason) ?? "n/a";
  const contextTrendTag = normalizeOptionalText(contextMemory.trend_decision_tag) ?? "n/a";
  const contextTrendSeverity = normalizeOptionalText(contextMemory.trend_decision_severity) ?? "n/a";
  const contextTrendOwner = normalizeOptionalText(contextMemory.trend_owner) ?? "n/a";
  const contextTrendAction = normalizeOptionalText(contextMemory.trend_action_hint) ?? "n/a";
  const contextBaselineAvailableText =
    typeof contextMemory.baseline_available === "boolean" ? (contextMemory.baseline_available ? "yes" : "no") : "n/a";
  const contextPolicyBlobMatchText =
    typeof contextMemory.policy_blob_match === "boolean" ? (contextMemory.policy_blob_match ? "yes" : "no") : "n/a";
  const contextPolicyHashMatchText =
    typeof contextMemory.policy_hash_match === "boolean" ? (contextMemory.policy_hash_match ? "yes" : "no") : "n/a";
  const contextPolicyHashCurrent = normalizeOptionalText(contextMemory.policy_hash_current) ?? "n/a";
  const contextPolicyHashBase = normalizeOptionalText(contextMemory.policy_hash_base) ?? "n/a";
  const contextPassRate = toNumber(contextMemory.pass_rate, 0).toFixed(4);
  const contextAverageScore = toNumber(contextMemory.average_score, 0).toFixed(4);
  const contextCaseCount = toInt(contextMemory.case_count, 0);

  const weeklyTrendRequired = toBool(weeklyRegression.trend_required, false);
  const weeklyTrendPassValue = weeklyRegression.trend_pass;
  let weeklyTrendPassText = "n/a";
  if (typeof weeklyTrendPassValue === "boolean") {
    weeklyTrendPassText = weeklyTrendPassValue ? "pass" : "fail";
  }
  const weeklyTrendMode = normalizeOptionalText(weeklyRegression.trend_mode) ?? "n/a";
  const weeklyTrendReason = normalizeOptionalText(weeklyRegression.trend_reason) ?? "n/a";
  const weeklySuccessRate = toNumber(weeklyRegression.success_rate, 0).toFixed(4);
  const weeklyFirstPassRate = toNumber(weeklyRegression.first_pass_rate, 0).toFixed(4);
  const weeklyTokenCost = toNumber(weeklyRegression.token_cost, 0).toFixed(6);
  const weeklyRollbackRate = toNumber(weeklyRegression.rollback_rate, 0).toFixed(4);

  const labels = extractSuggestedLabels(summary);
  const labelsText = labels.length > 0 ? labels.join(", ") : "n/a";
  const autoLoopAvailable = toBool(autoLoop.available, false);
  const autoLoopSelectedProposal = normalizeOptionalText(autoLoop.selected_proposal_id) ?? "n/a";
  const autoLoopSelectedVariant = normalizeOptionalText(autoLoop.selected_variant) ?? "n/a";
  const autoLoopPromotionState = normalizeOptionalText(autoLoop.promotion_state) ?? "n/a";
  const autoLoopCircuit = toBool(autoLoop.circuit_breaker_triggered, false);
  const autoLoopCircuitReason = normalizeOptionalText(autoLoop.circuit_breaker_reason) ?? "n/a";
  const autoLoopReward =
    typeof autoLoop.selected_reward_v1_composite === "number"
      ? Number(autoLoop.selected_reward_v1_composite).toFixed(4)
      : "n/a";
  const autoLoopGain =
    typeof autoLoop.selected_optimization_gain === "number"
      ? Number(autoLoop.selected_optimization_gain).toFixed(4)
      : "n/a";
  const autoLoopHoldoutDrop =
    typeof autoLoop.selected_holdout_drop === "number"
      ? Number(autoLoop.selected_holdout_drop).toFixed(4)
      : "n/a";

  const drift = normalizePolicyDriftFieldsForMarkdown(policyDrift);
  const lines: string[] = ["## Harness Gate Summary", ""];
  if (drift.worseningAlert) {
    lines.push(`> [!WARNING] policy_drift worsening alert: streak=${drift.worseningStreak}; transition=${drift.transition}`, "");
  }

  lines.push(
    `- overall: ${summary.overall_pass ? "pass" : "fail"}`,
    `- suggested-labels: ${labelsText}`,
    `- auto-loop: available=${autoLoopAvailable ? "yes" : "no"}; selected_proposal=${autoLoopSelectedProposal}; selected_variant=${autoLoopSelectedVariant}; promotion_state=${autoLoopPromotionState}`,
    `- auto-loop-circuit-breaker: ${autoLoopCircuit ? "yes" : "no"}; reason=${autoLoopCircuitReason}`,
    `- policy-drift: ${drift.severity}:${drift.reason}`,
    `- policy-drift-trend: transition=${drift.transition}; state=${drift.transitionState}; delta=${drift.severityDelta}; streak=${drift.worseningStreak}; alert=${drift.worseningAlert ? "yes" : "no"}; threshold=${drift.worseningAlertThreshold}; worsening_label=${drift.worseningLabel}`,
    `- policy-drift-owner: ${drift.owner}`,
    `- policy-drift-action: ${drift.actionHint}`,
    `- skill-router-trend-tag: ${trendDecisionTag}`,
    `- skill-router-trend-severity: ${trendDecisionSeverity}`,
    `- skill-router-trend-owner: ${trendOwner}`,
    `- skill-router-trend: mode=${trendMode}; required=${trendRequired ? "yes" : "no"}; pass=${trendPassText}; reason=${trendReason}`,
    `- skill-router-trend-action: ${trendActionHint}`,
    `- context-memory-trend-tag: ${contextTrendTag}`,
    `- context-memory-trend-severity: ${contextTrendSeverity}`,
    `- context-memory-trend-owner: ${contextTrendOwner}`,
    `- context-memory-trend: mode=${contextTrendMode}; required=${contextTrendRequired ? "yes" : "no"}; pass=${contextTrendPassText}; reason=${contextTrendReason}`,
    `- context-memory-trend-action: ${contextTrendAction}`,
    `- weekly-regression: gate=${toBool(weeklyRegression.gate_pass, false) ? "pass" : "fail"}; trend_mode=${weeklyTrendMode}; trend_required=${weeklyTrendRequired ? "yes" : "no"}; trend_pass=${weeklyTrendPassText}; trend_reason=${weeklyTrendReason}`,
    `- weekly-regression-metrics: success_rate=${weeklySuccessRate}; first_pass_rate=${weeklyFirstPassRate}; token_cost=${weeklyTokenCost}; rollback_rate=${weeklyRollbackRate}`,
    "",
    "| Domain | Key | Value |",
    "| --- | --- | --- |",
    `| meta | suggested_labels | ${labelsText} |`,
    `| auto_loop | available | ${autoLoopAvailable ? "yes" : "no"} |`,
    `| auto_loop | proposal_count | ${toInt(autoLoop.proposal_count, 0)} |`,
    `| auto_loop | evaluation_count | ${toInt(autoLoop.evaluation_count, 0)} |`,
    `| auto_loop | selected_proposal_id | ${autoLoopSelectedProposal} |`,
    `| auto_loop | selected_variant | ${autoLoopSelectedVariant} |`,
    `| auto_loop | promotion_state | ${autoLoopPromotionState} |`,
    `| auto_loop | selected_reward_v1_composite | ${autoLoopReward} |`,
    `| auto_loop | selected_optimization_gain | ${autoLoopGain} |`,
    `| auto_loop | selected_holdout_drop | ${autoLoopHoldoutDrop} |`,
    `| auto_loop | circuit_breaker_triggered | ${autoLoopCircuit ? "yes" : "no"} |`,
    `| auto_loop | circuit_breaker_reason | ${autoLoopCircuitReason} |`,
    `| policy_drift | severity | ${drift.severity} |`,
    `| policy_drift | reason | ${drift.reason} |`,
    `| policy_drift | transition | ${drift.transition} |`,
    `| policy_drift | transition_state | ${drift.transitionState} |`,
    `| policy_drift | severity_delta | ${drift.severityDelta} |`,
    `| policy_drift | worsening_streak | ${drift.worseningStreak} |`,
    `| policy_drift | worsening_alert | ${drift.worseningAlert ? "yes" : "no"} |`,
    `| policy_drift | worsening_alert_threshold | ${drift.worseningAlertThreshold} |`,
    `| policy_drift | worsening_label | ${drift.worseningLabel} |`,
    `| policy_drift | owner | ${drift.owner} |`,
    `| policy_drift | action_hint | ${drift.actionHint} |`,
    `| trace | sample_guard_pass | ${toBool(trace.sample_guard_pass, false) ? "pass" : "fail"} |`,
    `| trace | clean_cases | ${toInt(trace.clean_cases, 0)} |`,
    `| trace | clean_runs | ${toInt(trace.clean_runs, 0)} |`,
    `| trace | holdout_cases | ${toInt(splitCounts.holdout, 0)} |`,
    `| trace | optimization_cases | ${toInt(splitCounts.optimization, 0)} |`,
    `| skill_router | gate_pass | ${toBool(skill.gate_pass, false) ? "pass" : "fail"} |`,
    `| skill_router | trend_decision_tag | ${trendDecisionTag} |`,
    `| skill_router | trend_decision_severity | ${trendDecisionSeverity} |`,
    `| skill_router | trend_owner | ${trendOwner} |`,
    `| skill_router | trend_action_hint | ${trendActionHint} |`,
    `| skill_router | trend_required | ${trendRequired ? "yes" : "no"} |`,
    `| skill_router | trend_pass | ${trendPassText} |`,
    `| skill_router | trend_mode | ${trendMode} |`,
    `| skill_router | trend_reason | ${trendReason} |`,
    `| skill_router | baseline_available | ${baselineAvailableText} |`,
    `| skill_router | policy_blob_match | ${policyBlobMatchText} |`,
    `| skill_router | policy_hash_match | ${policyHashMatchText} |`,
    `| skill_router | policy_hash_current | ${policyHashCurrent} |`,
    `| skill_router | policy_hash_base | ${policyHashBase} |`,
    `| skill_router | accuracy | ${toNumber(skill.accuracy, 0).toFixed(4)} |`,
    `| skill_router | forbidden_violations | ${toInt(skill.forbidden_violations, 0)} |`,
    `| skill_router | total_cases | ${toInt(skill.total_cases, 0)} |`,
    `| context_memory | gate_pass | ${toBool(contextMemory.gate_pass, false) ? "pass" : "fail"} |`,
    `| context_memory | trend_decision_tag | ${contextTrendTag} |`,
    `| context_memory | trend_decision_severity | ${contextTrendSeverity} |`,
    `| context_memory | trend_owner | ${contextTrendOwner} |`,
    `| context_memory | trend_action_hint | ${contextTrendAction} |`,
    `| context_memory | trend_required | ${contextTrendRequired ? "yes" : "no"} |`,
    `| context_memory | trend_pass | ${contextTrendPassText} |`,
    `| context_memory | trend_mode | ${contextTrendMode} |`,
    `| context_memory | trend_reason | ${contextTrendReason} |`,
    `| context_memory | baseline_available | ${contextBaselineAvailableText} |`,
    `| context_memory | policy_blob_match | ${contextPolicyBlobMatchText} |`,
    `| context_memory | policy_hash_match | ${contextPolicyHashMatchText} |`,
    `| context_memory | policy_hash_current | ${contextPolicyHashCurrent} |`,
    `| context_memory | policy_hash_base | ${contextPolicyHashBase} |`,
    `| context_memory | pass_rate | ${contextPassRate} |`,
    `| context_memory | average_score | ${contextAverageScore} |`,
    `| context_memory | case_count | ${contextCaseCount} |`,
    `| weekly_regression | gate_pass | ${toBool(weeklyRegression.gate_pass, false) ? "pass" : "fail"} |`,
    `| weekly_regression | trend_required | ${weeklyTrendRequired ? "yes" : "no"} |`,
    `| weekly_regression | trend_pass | ${weeklyTrendPassText} |`,
    `| weekly_regression | trend_mode | ${weeklyTrendMode} |`,
    `| weekly_regression | trend_reason | ${weeklyTrendReason} |`,
    `| weekly_regression | success_rate | ${weeklySuccessRate} |`,
    `| weekly_regression | first_pass_rate | ${weeklyFirstPassRate} |`,
    `| weekly_regression | token_cost | ${weeklyTokenCost} |`,
    `| weekly_regression | rollback_rate | ${weeklyRollbackRate} |`,
  );
  return `${lines.join("\n")}\n`;
}

export function extractSuggestedLabels(summary: HarnessCiSummary): string[] {
  if (!Array.isArray(summary.suggested_labels)) {
    return [];
  }
  return summary.suggested_labels
    .filter((item) => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}
