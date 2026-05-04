import { existsSync, readFileSync } from "node:fs";
import type {
  HarnessCiSummary,
  JsonObject,
  PolicyDriftSeverity,
  PolicyDriftSummary,
} from "./types";

const POLICY_DRIFT_SEVERITY_ORDER: Record<PolicyDriftSeverity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export function dirname(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

export function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

export function toInt(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  return fallback;
}

export function toBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

export function parseJsonObject(path: string): JsonObject {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return parsed as JsonObject;
  }
  throw new Error(`${path} must be a JSON object`);
}

export function normalizePolicyDriftSeverity(value: unknown): PolicyDriftSeverity {
  const normalized = normalizeOptionalText(value);
  if (normalized === "none" || normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }
  return "none";
}

export function computePolicyDriftTransitionState(
  previousSeverity: PolicyDriftSeverity,
  severity: PolicyDriftSeverity,
): { transitionState: string; severityDelta: number } {
  const previousOrder = POLICY_DRIFT_SEVERITY_ORDER[previousSeverity];
  const currentOrder = POLICY_DRIFT_SEVERITY_ORDER[severity];
  const delta = currentOrder - previousOrder;
  if (previousOrder === 0 && currentOrder === 0) {
    return { transitionState: "stable_none", severityDelta: 0 };
  }
  if (previousOrder === 0 && currentOrder > 0) {
    return { transitionState: "introduced", severityDelta: delta };
  }
  if (previousOrder > 0 && currentOrder === 0) {
    return { transitionState: "resolved", severityDelta: delta };
  }
  if (delta > 0) {
    return { transitionState: "worsened", severityDelta: delta };
  }
  if (delta < 0) {
    return { transitionState: "improved", severityDelta: delta };
  }
  return { transitionState: "persistent", severityDelta: 0 };
}

export function computePolicyDriftOwner(severity: PolicyDriftSeverity): string {
  if (severity === "high") {
    return "policy-governance";
  }
  if (severity === "medium" || severity === "low") {
    return "policy-maintainers";
  }
  return "release-owner";
}

export function computePolicyDriftActionHint(
  severity: PolicyDriftSeverity,
  reason: string,
  transitionState: string,
): string {
  if (severity === "none") {
    if (transitionState === "resolved") {
      return "policy drift resolved; keep ci_label_policy guard and runtime in sync.";
    }
    return "n/a";
  }

  const reasonHints: Record<string, string> = {
    schema_mismatch: "sync ci_label_policy schema/runtime contract before merge.",
    missing_fields: "add missing required fields and re-run policy guard.",
    unknown_fields: "remove or gate unknown fields, then align policy guard.",
    shape_ok: "re-check policy_drift report generation path.",
  };
  const base = reasonHints[reason] ?? "inspect policy drift diagnostics and align policy definition.";
  if (transitionState === "introduced" || transitionState === "worsened") {
    return `policy drift worsened; ${base}`;
  }
  if (transitionState === "improved") {
    return `policy drift improved but still unresolved; ${base}`;
  }
  return `policy drift persists; ${base}`;
}

export function normalizePolicyDriftReport(policyDriftReport: JsonObject | undefined): PolicyDriftSummary {
  const payload = policyDriftReport ?? {};
  const severity = normalizePolicyDriftSeverity(payload.severity);
  const reason = normalizeOptionalText(payload.reason) ?? "shape_ok";
  const previousSeverity = normalizePolicyDriftSeverity(payload.previous_severity);
  const previousReason = normalizeOptionalText(payload.previous_reason) ?? "shape_ok";
  let worseningStreak = toInt(payload.worsening_streak, 0);
  if (worseningStreak < 0) {
    worseningStreak = 0;
  }
  const worseningAlert = toBool(payload.worsening_alert, false);
  let worseningAlertThreshold = toInt(payload.worsening_alert_threshold, 2);
  if (worseningAlertThreshold < 1) {
    worseningAlertThreshold = 2;
  }
  const worseningLabel = normalizeOptionalText(payload.worsening_label) ?? "ci/policy-drift-worsening";
  const transition = `${previousSeverity}->${severity}`;
  const { transitionState, severityDelta } = computePolicyDriftTransitionState(previousSeverity, severity);
  const owner = computePolicyDriftOwner(severity);
  const actionHint = computePolicyDriftActionHint(severity, reason, transitionState);

  return {
    severity,
    reason,
    label: `${severity}:${reason}`,
    previous_severity: previousSeverity,
    previous_reason: previousReason,
    worsening_streak: worseningStreak,
    worsening_alert: worseningAlert,
    worsening_alert_threshold: worseningAlertThreshold,
    worsening_label: worseningLabel,
    transition,
    transition_state: transitionState,
    severity_delta: severityDelta,
    owner,
    action_hint: actionHint,
  };
}

export function computeTrendDecisionTag(
  trendRequired: boolean,
  trendMode: string | null,
  trendReason: string | null,
  trendPass: boolean | null,
): string {
  if (trendRequired) {
    if (trendPass === true) {
      return "TREND_REQUIRED_PASS";
    }
    if (trendPass === false) {
      return "TREND_REQUIRED_FAIL";
    }
    return "TREND_REQUIRED_MISSING";
  }

  if (trendMode === "gate_and_trend") {
    if (trendPass === true) {
      return "TREND_EXECUTED_PASS";
    }
    if (trendPass === false) {
      return "TREND_EXECUTED_FAIL";
    }
    return "TREND_EXECUTED_NO_RESULT";
  }

  if (trendMode === "gate_only") {
    const map: Record<string, string> = {
      policy_blob_mismatch: "TREND_SKIPPED_POLICY_CHANGED",
      artifact_missing: "TREND_SKIPPED_ARTIFACT_MISSING",
      baseline_unavailable: "TREND_SKIPPED_BASELINE_UNAVAILABLE",
      baseline_report_missing: "TREND_SKIPPED_BASE_REPORT_MISSING",
      policy_blob_unavailable: "TREND_SKIPPED_POLICY_BLOB_UNAVAILABLE",
      baseline_build_failed: "TREND_SKIPPED_BASELINE_BUILD_FAILED",
      baseline_no_base_sha: "TREND_SKIPPED_NO_BASE_SHA",
      report_schema_mismatch: "TREND_SKIPPED_REPORT_SCHEMA_MISMATCH",
    };
    if (trendReason && map[trendReason]) {
      return map[trendReason];
    }
    return "TREND_SKIPPED_GATE_ONLY";
  }

  if (trendMode === null) {
    return trendPass === null ? "TREND_NOT_REQUESTED" : "TREND_RESULT_WITHOUT_MODE";
  }
  return "TREND_UNKNOWN_MODE";
}

export function computeTrendDecisionSeverity(tag: string): string {
  const errorTags = new Set(["TREND_REQUIRED_FAIL", "TREND_REQUIRED_MISSING", "TREND_EXECUTED_FAIL"]);
  const warnTags = new Set([
    "TREND_EXECUTED_NO_RESULT",
    "TREND_SKIPPED_POLICY_CHANGED",
    "TREND_SKIPPED_ARTIFACT_MISSING",
    "TREND_SKIPPED_BASELINE_UNAVAILABLE",
    "TREND_SKIPPED_BASE_REPORT_MISSING",
    "TREND_SKIPPED_POLICY_BLOB_UNAVAILABLE",
    "TREND_SKIPPED_BASELINE_BUILD_FAILED",
    "TREND_SKIPPED_NO_BASE_SHA",
    "TREND_SKIPPED_REPORT_SCHEMA_MISMATCH",
    "TREND_SKIPPED_GATE_ONLY",
    "TREND_RESULT_WITHOUT_MODE",
    "TREND_UNKNOWN_MODE",
  ]);
  if (errorTags.has(tag)) {
    return "error";
  }
  if (warnTags.has(tag)) {
    return "warn";
  }
  return "info";
}

export function computeTrendActionHint(tag: string): string {
  const hints: Record<string, string> = {
    TREND_REQUIRED_PASS: "required trend checks passed",
    TREND_REQUIRED_FAIL: "required trend failed; inspect baseline and current report diff",
    TREND_REQUIRED_MISSING: "required trend missing; ensure compare-report is generated and loaded",
    TREND_EXECUTED_PASS: "trend executed and passed",
    TREND_EXECUTED_FAIL: "trend executed and failed; inspect accuracy/forbidden deltas",
    TREND_EXECUTED_NO_RESULT: "trend execution reported no result; inspect evaluator output",
    TREND_SKIPPED_POLICY_CHANGED: "trend skipped because policy changed between base and head",
    TREND_SKIPPED_ARTIFACT_MISSING: "trend skipped because baseline artifact is missing",
    TREND_SKIPPED_BASELINE_UNAVAILABLE: "trend skipped because base SHA is unavailable",
    TREND_SKIPPED_BASE_REPORT_MISSING: "trend skipped because baseline report file is missing",
    TREND_SKIPPED_POLICY_BLOB_UNAVAILABLE: "trend skipped because policy blob could not be resolved",
    TREND_SKIPPED_BASELINE_BUILD_FAILED: "trend skipped because baseline build step failed",
    TREND_SKIPPED_NO_BASE_SHA: "trend skipped because no base SHA could be resolved",
    TREND_SKIPPED_REPORT_SCHEMA_MISMATCH: "trend skipped because baseline report schema differs from current",
    TREND_SKIPPED_GATE_ONLY: "trend skipped in gate-only mode",
    TREND_NOT_REQUESTED: "trend not required for this run",
    TREND_RESULT_WITHOUT_MODE: "trend result exists but mode is missing",
    TREND_UNKNOWN_MODE: "trend mode is unknown; check trend_meta payload",
  };
  return hints[tag] ?? "no action hint available";
}

export function computeTrendOwner(tag: string): string {
  const policyOwnerTags = new Set(["TREND_SKIPPED_POLICY_CHANGED", "TREND_SKIPPED_POLICY_BLOB_UNAVAILABLE"]);
  const ciOwnerTags = new Set([
    "TREND_SKIPPED_ARTIFACT_MISSING",
    "TREND_SKIPPED_BASELINE_UNAVAILABLE",
    "TREND_SKIPPED_BASE_REPORT_MISSING",
    "TREND_SKIPPED_BASELINE_BUILD_FAILED",
    "TREND_SKIPPED_NO_BASE_SHA",
    "TREND_SKIPPED_REPORT_SCHEMA_MISMATCH",
    "TREND_EXECUTED_NO_RESULT",
    "TREND_RESULT_WITHOUT_MODE",
    "TREND_UNKNOWN_MODE",
  ]);
  const routerOwnerTags = new Set([
    "TREND_REQUIRED_FAIL",
    "TREND_REQUIRED_MISSING",
    "TREND_EXECUTED_FAIL",
    "TREND_REQUIRED_PASS",
    "TREND_EXECUTED_PASS",
  ]);

  if (policyOwnerTags.has(tag)) {
    return "policy-governance";
  }
  if (ciOwnerTags.has(tag)) {
    return "ci-infra";
  }
  if (routerOwnerTags.has(tag)) {
    return "router-evals";
  }
  if (tag === "TREND_SKIPPED_GATE_ONLY" || tag === "TREND_NOT_REQUESTED") {
    return "release-owner";
  }
  return "unknown-owner";
}

function slugifyLabelSegment(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\//g, "-").replace(/_/g, "-");
  const parts: string[] = [];
  for (const raw of normalized.split("-")) {
    const cleaned = raw
      .split("")
      .filter((ch) => /[a-z0-9]/.test(ch))
      .join("");
    if (cleaned.length > 0) {
      parts.push(cleaned);
    }
  }
  return parts.length > 0 ? parts.join("-") : "unknown";
}

function computeSuggestedLabels(
  overallPass: boolean,
  trendDecisionTag: string,
  trendDecisionSeverity: string,
  trendOwner: string,
  autoLoop: HarnessCiSummary["auto_loop"],
): string[] {
  const labels: string[] = [
    `ci/harness-${overallPass ? "pass" : "fail"}`,
    `ci/severity-${slugifyLabelSegment(trendDecisionSeverity)}`,
    `ci/owner-${slugifyLabelSegment(trendOwner)}`,
    `ci/${slugifyLabelSegment(trendDecisionTag)}`,
  ];
  if (autoLoop.available) {
    labels.push(autoLoop.selected_proposal_id ? "ci/auto-loop-ready" : "ci/auto-loop-no-selection");
    if (autoLoop.circuit_breaker_triggered) {
      labels.push("ci/auto-loop-circuit-breaker");
    }
  } else {
    labels.push("ci/auto-loop-missing");
  }
  if (!overallPass || trendDecisionSeverity === "error") {
    labels.push("ci/action-required");
  } else if (trendDecisionSeverity === "warn") {
    labels.push("ci/action-review");
  }
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const label of labels) {
    if (seen.has(label)) {
      continue;
    }
    seen.add(label);
    deduped.push(label);
  }
  return deduped;
}

export function asObject(value: unknown): JsonObject {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

export function asStringOrNull(value: unknown): string | null {
  const text = normalizeOptionalText(value);
  return text ?? null;
}

function normalizeAutoLoopReport(autoLoopReport: JsonObject | undefined): HarnessCiSummary["auto_loop"] {
  if (autoLoopReport == null || Object.keys(autoLoopReport).length === 0) {
    return {
      available: false,
      run_id: null,
      baseline_variant: null,
      proposal_count: 0,
      evaluation_count: 0,
      selected_proposal_id: null,
      selected_variant: null,
      promotion_state: null,
      circuit_breaker_triggered: false,
      circuit_breaker_reason: null,
      selected_reward_v1_composite: null,
      selected_optimization_gain: null,
      selected_holdout_drop: null,
    };
  }

  const evaluationsRaw = autoLoopReport.evaluations;
  const evaluations = Array.isArray(evaluationsRaw)
    ? evaluationsRaw.filter((item) => typeof item === "object" && item !== null && !Array.isArray(item))
    : [];
  const selectedProposalId = asStringOrNull(autoLoopReport.selected_proposal_id);
  let selectedEval: JsonObject | null = null;
  if (selectedProposalId != null) {
    for (const item of evaluations) {
      const payload = item as JsonObject;
      if (asStringOrNull(payload.proposal_id) === selectedProposalId) {
        selectedEval = payload;
        break;
      }
    }
  }
  if (selectedEval == null) {
    for (const item of evaluations) {
      const payload = item as JsonObject;
      if (asStringOrNull(payload.status) === "selected") {
        selectedEval = payload;
        break;
      }
    }
  }

  const manifestPath = asStringOrNull(autoLoopReport.manifest_output);
  let proposalCount = 0;
  if (manifestPath && existsSync(manifestPath)) {
    try {
      const manifest = parseJsonObject(manifestPath);
      const proposals = manifest.proposals;
      if (Array.isArray(proposals)) {
        proposalCount = proposals.length;
      }
    } catch {
      proposalCount = 0;
    }
  } else {
    proposalCount = evaluations.length;
  }

  const circuit = asObject(autoLoopReport.circuit_breaker);
  return {
    available: true,
    run_id: asStringOrNull(autoLoopReport.run_id),
    baseline_variant: asStringOrNull(autoLoopReport.baseline_variant),
    proposal_count: proposalCount,
    evaluation_count: evaluations.length,
    selected_proposal_id: selectedProposalId,
    selected_variant: asStringOrNull(autoLoopReport.selected_variant),
    promotion_state: asStringOrNull(autoLoopReport.promotion_state),
    circuit_breaker_triggered: toBool(circuit?.triggered, false),
    circuit_breaker_reason: asStringOrNull(circuit?.reason),
    selected_reward_v1_composite:
      selectedEval == null ? null : toNumber((selectedEval as JsonObject).reward_v1_composite, 0),
    selected_optimization_gain:
      selectedEval == null ? null : toNumber((selectedEval as JsonObject).optimization_gain, 0),
    selected_holdout_drop:
      selectedEval == null ? null : toNumber((selectedEval as JsonObject).holdout_drop, 0),
  };
}

function normalizeContextMemoryReport(contextMemoryReport: JsonObject | undefined): HarnessCiSummary["context_memory"] {
  const payload = contextMemoryReport ?? {};
  const variants = asObject(payload.variants);
  const candidate = asObject(variants.candidate);
  const summary = asObject(candidate.summary);
  const gate = asObject(payload.overall_gate);
  const trend = asObject(payload.trend);
  const trendMeta = asObject(payload.trend_meta);
  const policy = asObject(payload.policy);

  const trendRequired = toBool(trendMeta.required, false);
  const trendMode = asStringOrNull(trendMeta.mode);
  const trendReason = asStringOrNull(trendMeta.reason);
  let trendPass: boolean | null = null;
  if (Object.keys(trend).length > 0) {
    trendPass = toBool(trend.passed, false);
  }
  if (trendRequired && trendPass === null) {
    trendPass = false;
  }

  const trendDecisionTag = computeTrendDecisionTag(trendRequired, trendMode, trendReason, trendPass);
  const trendDecisionSeverity = computeTrendDecisionSeverity(trendDecisionTag);
  const trendActionHint = computeTrendActionHint(trendDecisionTag);
  const trendOwner = computeTrendOwner(trendDecisionTag);

  return {
    gate_pass: toBool(gate.passed, false),
    trend_required: trendRequired,
    trend_pass: trendPass,
    trend_mode: trendMode,
    trend_reason: trendReason,
    trend_decision_tag: trendDecisionTag,
    trend_decision_severity: trendDecisionSeverity,
    trend_action_hint: trendActionHint,
    trend_owner: trendOwner,
    baseline_available: trendMeta.baseline_available,
    policy_blob_match: trendMeta.policy_blob_match,
    policy_hash_current: trendMeta.policy_hash_current,
    policy_hash_base: trendMeta.policy_hash_base,
    policy_hash_match: trendMeta.policy_hash_match,
    pass_rate: toNumber(summary.pass_rate, 0),
    average_score: toNumber(summary.average_score, 0),
    case_count: toInt(summary.case_count, 0),
    policy_hash: asStringOrNull(policy.hash),
  };
}

function normalizeWeeklyRegressionReport(
  weeklyRegressionReport: JsonObject | undefined,
): HarnessCiSummary["weekly_regression"] {
  const payload = weeklyRegressionReport ?? {};
  const gate = asObject(payload.gate);
  const trend = asObject(payload.trend);
  const trendMeta = asObject(payload.trend_meta);
  const policy = asObject(payload.policy);
  const current = asObject(payload.current);
  const metrics = asObject(current.metrics);

  const trendRequired = toBool(trendMeta.required, false);
  const trendMode = asStringOrNull(trendMeta.mode);
  const trendReason = asStringOrNull(trendMeta.reason);
  let trendPass: boolean | null = null;
  if (Object.keys(trend).length > 0) {
    trendPass = toBool(trend.passed, false);
  }
  if (trendRequired && trendPass === null) {
    trendPass = false;
  }

  const successRate = toNumber(asObject(metrics.success_rate).value, 0);
  const firstPassRate = toNumber(asObject(metrics.first_pass_rate).value, 0);
  const tokenCost = toNumber(asObject(metrics.token_cost).value, 0);
  const rollbackRate = toNumber(asObject(metrics.rollback_rate).value, 0);

  return {
    gate_pass: toBool(gate.passed, false),
    trend_required: trendRequired,
    trend_pass: trendPass,
    trend_mode: trendMode,
    trend_reason: trendReason,
    success_rate: successRate,
    first_pass_rate: firstPassRate,
    token_cost: tokenCost,
    rollback_rate: rollbackRate,
    policy_hash: asStringOrNull(policy.hash),
  };
}

export function buildHarnessCiSummary(
  traceReport: JsonObject,
  skillRouterReport: JsonObject,
  contextMemoryReport?: JsonObject,
  weeklyRegressionReport?: JsonObject,
  autoLoopReport?: JsonObject,
  policyDriftReport?: JsonObject,
): HarnessCiSummary {
  let traceCleanStats = asObject(traceReport.clean_stats);
  if (Object.keys(traceCleanStats).length === 0) {
    const cleanPayload = asObject(traceReport.clean);
    traceCleanStats = asObject(cleanPayload.stats);
  }
  const traceSampleGuard = asObject(traceReport.sample_guard);
  const traceSplit = asObject(traceSampleGuard.split);
  const traceSplitCounts = asObject(traceSplit.counts);

  const skillSummary = asObject(skillRouterReport.summary);
  const skillGate = asObject(skillRouterReport.gate);
  const trend = asObject(skillRouterReport.trend);
  const trendMeta = asObject(skillRouterReport.trend_meta);

  const tracePass = toBool(traceSampleGuard.pass, false);
  const skillGatePass = toBool(skillGate.passed, false);
  const normalizedPolicyDrift = normalizePolicyDriftReport(policyDriftReport);
  const trendRequired = toBool(trendMeta.required, false);
  const trendMode = asStringOrNull(trendMeta.mode);
  const trendReason = asStringOrNull(trendMeta.reason);

  let skillTrendPass: boolean | null = null;
  if (Object.keys(trend).length > 0) {
    skillTrendPass = toBool(trend.passed, false);
  }
  if (trendRequired && skillTrendPass === null) {
    skillTrendPass = false;
  }

  const trendDecisionTag = computeTrendDecisionTag(trendRequired, trendMode, trendReason, skillTrendPass);
  const trendDecisionSeverity = computeTrendDecisionSeverity(trendDecisionTag);
  const trendActionHint = computeTrendActionHint(trendDecisionTag);
  const trendOwner = computeTrendOwner(trendDecisionTag);
  const trendPassForOverall = skillTrendPass === null ? true : skillTrendPass;
  const autoLoopSummary = normalizeAutoLoopReport(autoLoopReport);
  const contextMemorySummary = normalizeContextMemoryReport(contextMemoryReport);
  const weeklyRegressionSummary = normalizeWeeklyRegressionReport(weeklyRegressionReport);
  const contextTrendPassForOverall =
    contextMemorySummary.trend_pass === null ? true : contextMemorySummary.trend_pass;
  const weeklyTrendPassForOverall =
    weeklyRegressionSummary.trend_pass === null ? true : weeklyRegressionSummary.trend_pass;

  const overallPass = tracePass
    && skillGatePass
    && trendPassForOverall
    && contextMemorySummary.gate_pass
    && contextTrendPassForOverall
    && weeklyRegressionSummary.gate_pass
    && weeklyTrendPassForOverall;
  const suggestedLabels = computeSuggestedLabels(
    overallPass,
    trendDecisionTag,
    trendDecisionSeverity,
    trendOwner,
    autoLoopSummary,
  );

  let tracePolicyHash: string | null = asStringOrNull(traceReport.policy_hash);
  if (tracePolicyHash === null) {
    const tracePolicy = asObject(traceReport.policy);
    tracePolicyHash = asStringOrNull(tracePolicy.hash);
  }

  const skillPolicy = asObject(skillRouterReport.policy);
  const skillPolicyHash = asStringOrNull(skillPolicy.hash);

  return {
    overall_pass: overallPass,
    suggested_labels: suggestedLabels,
    policy_drift: normalizedPolicyDrift,
    auto_loop: autoLoopSummary,
    trace: {
      sample_guard_pass: tracePass,
      clean_cases: toInt(traceCleanStats.output_cases, 0),
      clean_runs: toInt(traceCleanStats.output_runs, 0),
      split_counts: {
        holdout: toInt(traceSplitCounts.holdout, 0),
        optimization: toInt(traceSplitCounts.optimization, 0),
      },
      policy_hash: tracePolicyHash,
    },
    skill_router: {
      gate_pass: skillGatePass,
      trend_required: trendRequired,
      trend_pass: skillTrendPass,
      trend_mode: trendMode,
      trend_reason: trendReason,
      trend_decision_tag: trendDecisionTag,
      trend_decision_severity: trendDecisionSeverity,
      trend_action_hint: trendActionHint,
      trend_owner: trendOwner,
      suggested_labels: suggestedLabels,
      baseline_available: trendMeta.baseline_available,
      policy_blob_match: trendMeta.policy_blob_match,
      policy_hash_current: trendMeta.policy_hash_current,
      policy_hash_base: trendMeta.policy_hash_base,
      policy_hash_match: trendMeta.policy_hash_match,
      accuracy: toNumber(skillSummary.accuracy, 0),
      forbidden_violations: toInt(skillSummary.forbidden_violations, 0),
      total_cases: toInt(skillSummary.total_cases, 0),
      policy_hash: skillPolicyHash,
    },
    context_memory: contextMemorySummary,
    weekly_regression: weeklyRegressionSummary,
  };
}
