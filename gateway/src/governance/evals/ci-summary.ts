import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

type JsonObject = Record<string, unknown>;
type PolicyDriftSeverity = "none" | "low" | "medium" | "high";

interface ParsedCliArgs {
  traceReportPath: string;
  skillRouterReportPath: string;
  autoLoopReportPath: string | undefined;
  policyDriftReportPath: string | undefined;
  outputPath: string | undefined;
  markdownOutputPath: string | undefined;
  labelsOutputPath: string | undefined;
  printJson: boolean;
  printMarkdown: boolean;
  printLabels: boolean;
  emitGithubAnnotations: boolean;
  failOnOverallFail: boolean;
}

interface PolicyDriftSummary {
  severity: PolicyDriftSeverity;
  reason: string;
  label: string;
  previous_severity: PolicyDriftSeverity;
  previous_reason: string;
  worsening_streak: number;
  worsening_alert: boolean;
  worsening_alert_threshold: number;
  worsening_label: string;
  transition: string;
  transition_state: string;
  severity_delta: number;
  owner: string;
  action_hint: string;
}

interface HarnessCiSummary {
  overall_pass: boolean;
  suggested_labels: string[];
  policy_drift: PolicyDriftSummary;
  auto_loop: {
    available: boolean;
    run_id: string | null;
    baseline_variant: string | null;
    proposal_count: number;
    evaluation_count: number;
    selected_proposal_id: string | null;
    selected_variant: string | null;
    promotion_state: string | null;
    circuit_breaker_triggered: boolean;
    circuit_breaker_reason: string | null;
    selected_reward_v1_composite: number | null;
    selected_optimization_gain: number | null;
    selected_holdout_drop: number | null;
  };
  trace: {
    sample_guard_pass: boolean;
    clean_cases: number;
    clean_runs: number;
    split_counts: {
      holdout: number;
      optimization: number;
    };
    policy_hash: string | null;
  };
  skill_router: {
    gate_pass: boolean;
    trend_required: boolean;
    trend_pass: boolean | null;
    trend_mode: string | null;
    trend_reason: string | null;
    trend_decision_tag: string;
    trend_decision_severity: string;
    trend_action_hint: string;
    trend_owner: string;
    suggested_labels: string[];
    baseline_available: unknown;
    policy_blob_match: unknown;
    policy_hash_current: unknown;
    policy_hash_base: unknown;
    policy_hash_match: unknown;
    accuracy: number;
    forbidden_violations: number;
    total_cases: number;
    policy_hash: string | null;
  };
}

const POLICY_DRIFT_SEVERITY_ORDER: Record<PolicyDriftSeverity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function dirname(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function toInt(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  return fallback;
}

function toBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function parseJsonObject(path: string): JsonObject {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return parsed as JsonObject;
  }
  throw new Error(`${path} must be a JSON object`);
}

function normalizePolicyDriftSeverity(value: unknown): PolicyDriftSeverity {
  const normalized = normalizeOptionalText(value);
  if (normalized === "none" || normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }
  return "none";
}

function computePolicyDriftTransitionState(
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

function computePolicyDriftOwner(severity: PolicyDriftSeverity): string {
  if (severity === "high") {
    return "policy-governance";
  }
  if (severity === "medium" || severity === "low") {
    return "policy-maintainers";
  }
  return "release-owner";
}

function computePolicyDriftActionHint(
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

function normalizePolicyDriftReport(policyDriftReport: JsonObject | undefined): PolicyDriftSummary {
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

function computeTrendDecisionTag(
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

function computeTrendDecisionSeverity(tag: string): string {
  const errorTags = new Set(["TREND_REQUIRED_FAIL", "TREND_REQUIRED_MISSING", "TREND_EXECUTED_FAIL"]);
  const warnTags = new Set([
    "TREND_EXECUTED_NO_RESULT",
    "TREND_SKIPPED_POLICY_CHANGED",
    "TREND_SKIPPED_ARTIFACT_MISSING",
    "TREND_SKIPPED_BASELINE_UNAVAILABLE",
    "TREND_SKIPPED_BASE_REPORT_MISSING",
    "TREND_SKIPPED_POLICY_BLOB_UNAVAILABLE",
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

function computeTrendActionHint(tag: string): string {
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
    TREND_SKIPPED_GATE_ONLY: "trend skipped in gate-only mode",
    TREND_NOT_REQUESTED: "trend not required for this run",
    TREND_RESULT_WITHOUT_MODE: "trend result exists but mode is missing",
    TREND_UNKNOWN_MODE: "trend mode is unknown; check trend_meta payload",
  };
  return hints[tag] ?? "no action hint available";
}

function computeTrendOwner(tag: string): string {
  const policyOwnerTags = new Set(["TREND_SKIPPED_POLICY_CHANGED", "TREND_SKIPPED_POLICY_BLOB_UNAVAILABLE"]);
  const ciOwnerTags = new Set([
    "TREND_SKIPPED_ARTIFACT_MISSING",
    "TREND_SKIPPED_BASELINE_UNAVAILABLE",
    "TREND_SKIPPED_BASE_REPORT_MISSING",
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
  if (trendDecisionSeverity === "error") {
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

function asObject(value: unknown): JsonObject {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

function asStringOrNull(value: unknown): string | null {
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

export function buildHarnessCiSummary(
  traceReport: JsonObject,
  skillRouterReport: JsonObject,
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

  const overallPass = tracePass && skillGatePass && trendPassForOverall;
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
  };
}

function normalizePolicyDriftFieldsForMarkdown(policyDrift: JsonObject): {
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

  const labels = Array.isArray(summary.suggested_labels)
    ? summary.suggested_labels.filter((item) => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
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
  );
  return `${lines.join("\n")}\n`;
}

function extractSuggestedLabels(summary: HarnessCiSummary): string[] {
  if (!Array.isArray(summary.suggested_labels)) {
    return [];
  }
  return summary.suggested_labels
    .filter((item) => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function parseArgs(argv: string[]): ParsedCliArgs {
  const args: ParsedCliArgs = {
    traceReportPath: "",
    skillRouterReportPath: "",
    autoLoopReportPath: undefined,
    policyDriftReportPath: undefined,
    outputPath: undefined,
    markdownOutputPath: undefined,
    labelsOutputPath: undefined,
    printJson: false,
    printMarkdown: false,
    printLabels: false,
    emitGithubAnnotations: false,
    failOnOverallFail: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--trace-report") {
      args.traceReportPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--skill-router-report") {
      args.skillRouterReportPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--auto-loop-report") {
      args.autoLoopReportPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--policy-drift-report") {
      args.policyDriftReportPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--output") {
      args.outputPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--markdown-output") {
      args.markdownOutputPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--labels-output") {
      args.labelsOutputPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--print-json") {
      args.printJson = true;
      continue;
    }
    if (token === "--print-markdown") {
      args.printMarkdown = true;
      continue;
    }
    if (token === "--print-labels") {
      args.printLabels = true;
      continue;
    }
    if (token === "--emit-github-annotations") {
      args.emitGithubAnnotations = true;
      continue;
    }
    if (token === "--fail-on-overall-fail") {
      args.failOnOverallFail = true;
      continue;
    }
  }

  if (!args.traceReportPath || !args.skillRouterReportPath) {
    throw new Error("missing required args: --trace-report and --skill-router-report");
  }

  return args;
}

function ensureParentDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function writeJsonFile(path: string, payload: unknown): void {
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(payload, undefined, 2)}\n`, "utf8");
}

function writeTextFile(path: string, payload: string): void {
  ensureParentDir(path);
  writeFileSync(path, payload, "utf8");
}

function printGithubAnnotation(summary: HarnessCiSummary): void {
  const skill = asObject(summary.skill_router as unknown);
  const autoLoop = asObject(summary.auto_loop as unknown);
  const trendTag = normalizeOptionalText(skill.trend_decision_tag) ?? "TREND_NOT_REQUESTED";
  const trendSeverity = normalizeOptionalText(skill.trend_decision_severity) ?? "info";
  const trendActionHint = normalizeOptionalText(skill.trend_action_hint) ?? "n/a";
  const trendOwner = normalizeOptionalText(skill.trend_owner) ?? "unknown-owner";
  const drift = normalizePolicyDriftFieldsForMarkdown(asObject(summary.policy_drift as unknown));
  const autoLoopSelectedProposal = normalizeOptionalText(autoLoop.selected_proposal_id) ?? "n/a";
  const autoLoopSelectedVariant = normalizeOptionalText(autoLoop.selected_variant) ?? "n/a";
  const autoLoopPromotionState = normalizeOptionalText(autoLoop.promotion_state) ?? "n/a";
  const autoLoopCircuit = toBool(autoLoop.circuit_breaker_triggered, false);
  const autoLoopCircuitReason = normalizeOptionalText(autoLoop.circuit_breaker_reason) ?? "n/a";
  const labels = extractSuggestedLabels(summary);
  const labelsText = labels.length > 0 ? labels.join(",") : "n/a";

  const annotationMessage =
    `skill-router trend decision: tag=${trendTag}; severity=${trendSeverity}; owner=${trendOwner}; action=${trendActionHint}; ` +
    `policy_drift=${drift.severity}:${drift.reason}; ` +
    `policy_drift_transition=${drift.transition}; ` +
    `policy_drift_transition_state=${drift.transitionState}; ` +
    `policy_drift_delta=${drift.severityDelta}; ` +
    `policy_drift_owner=${drift.owner}; ` +
    `policy_drift_action=${drift.actionHint}; ` +
    `policy_drift_worsening_streak=${drift.worseningStreak}; ` +
    `policy_drift_worsening_threshold=${drift.worseningAlertThreshold}; ` +
    `policy_drift_worsening_label=${drift.worseningLabel}; ` +
    `policy_drift_worsening_alert=${drift.worseningAlert ? "yes" : "no"}; ` +
    `auto_loop_selected_proposal=${autoLoopSelectedProposal}; ` +
    `auto_loop_selected_variant=${autoLoopSelectedVariant}; ` +
    `auto_loop_promotion_state=${autoLoopPromotionState}; ` +
    `auto_loop_circuit_breaker=${autoLoopCircuit ? "yes" : "no"}; ` +
    `auto_loop_circuit_reason=${autoLoopCircuitReason}; ` +
    `labels=${labelsText}`;

  if (!summary.overall_pass) {
    process.stdout.write(`::error title=Harness Gate Overall Fail::${annotationMessage}\n`);
    return;
  }
  if (drift.worseningAlert && drift.severity === "high") {
    process.stdout.write(`::error title=Policy Drift Worsening::${annotationMessage}\n`);
    return;
  }
  if (drift.worseningAlert) {
    process.stdout.write(`::warning title=Policy Drift Worsening::${annotationMessage}\n`);
    return;
  }
  if (trendSeverity === "error") {
    process.stdout.write(`::error title=Skill Router Trend::${annotationMessage}\n`);
    return;
  }
  if (trendSeverity === "warn") {
    process.stdout.write(`::warning title=Skill Router Trend::${annotationMessage}\n`);
    return;
  }
  process.stdout.write(`::notice title=Skill Router Trend::${annotationMessage}\n`);
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const traceReport = parseJsonObject(args.traceReportPath);
  const skillRouterReport = parseJsonObject(args.skillRouterReportPath);
  const autoLoopReport =
    args.autoLoopReportPath && existsSync(args.autoLoopReportPath)
      ? parseJsonObject(args.autoLoopReportPath)
      : undefined;
  const policyDriftReport =
    args.policyDriftReportPath && existsSync(args.policyDriftReportPath)
      ? parseJsonObject(args.policyDriftReportPath)
      : undefined;
  const summary = buildHarnessCiSummary(traceReport, skillRouterReport, autoLoopReport, policyDriftReport);
  const markdown = renderHarnessCiSummaryMarkdown(summary);
  const suggestedLabels = extractSuggestedLabels(summary);
  const suggestedLabelsCsv = suggestedLabels.join(",");

  if (args.printJson) {
    process.stdout.write(`${JSON.stringify(summary, undefined, 2)}\n`);
  }
  if (args.printMarkdown) {
    process.stdout.write(markdown);
  }
  if (args.printLabels) {
    process.stdout.write(`${suggestedLabelsCsv}\n`);
  }
  if (!args.printJson && !args.printMarkdown && !args.printLabels) {
    process.stdout.write(`overall=${summary.overall_pass ? "pass" : "fail"}\n`);
  }

  if (args.outputPath) {
    writeJsonFile(args.outputPath, summary);
  }
  if (args.markdownOutputPath) {
    writeTextFile(args.markdownOutputPath, markdown);
  }
  if (args.labelsOutputPath) {
    writeJsonFile(args.labelsOutputPath, suggestedLabels);
  }

  if (args.emitGithubAnnotations) {
    printGithubAnnotation(summary);
  }
  if (args.failOnOverallFail && !summary.overall_pass) {
    return 4;
  }
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`ci-summary fatal: ${String(error)}\n`);
  process.exitCode = 1;
}
