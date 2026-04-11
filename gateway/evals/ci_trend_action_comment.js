"use strict";

const path = require("path");
const {
  loadCiLabelPolicyForComment,
  buildPolicyDriftStateMarker,
} = require("./ci_label_policy_runtime.js");

const _normalizeText = (value, fallback) => {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
};

const _parseIntOr = (value, fallback) => {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const _parsePositiveIntOrZero = (value) => {
  const parsed = _parseIntOr(value, 0);
  return parsed > 0 ? parsed : 0;
};

const _parseBool = (value) => {
  if (typeof value !== "string") {
    return false;
  }
  return value.trim().toLowerCase() === "true";
};

const _normalizeArray = (value) => (Array.isArray(value) ? value : []);

const upsertHarnessGateActionComment = async ({
  core,
  github,
  context,
  env = process.env,
  workspacePath = process.env.GITHUB_WORKSPACE || ".",
}) => {
  const policyPath = path.join(workspacePath, "gateway/evals/ci_label_policy.json");
  const policy = loadCiLabelPolicyForComment({ policyPath, core });

  const issueNumber = context?.payload?.pull_request?.number;
  if (!issueNumber) {
    core.info("No pull_request payload found; skip action comment");
    return { notified: false, reason: "missing_pull_request" };
  }

  const overallState = _normalizeText(env.OVERALL_STATE, "unknown");
  const trendOwner = _normalizeText(env.TREND_OWNER, "unknown-owner");
  const trendTag = _normalizeText(env.TREND_DECISION_TAG, "TREND_UNKNOWN_MODE");
  const trendSeverity = _normalizeText(env.TREND_DECISION_SEVERITY, "warn");
  const trendActionHint = _normalizeText(env.TREND_ACTION_HINT, "n/a");
  const labelsCsv = _normalizeText(env.SUGGESTED_LABELS_CSV || "", "");
  const labelsText = labelsCsv.length > 0 ? labelsCsv : "n/a";

  const commentTrigger =
    policy.commentTrigger && typeof policy.commentTrigger === "object"
      ? policy.commentTrigger
      : { overallStates: [], trendSeverities: [] };
  const commentOverallStates = _normalizeArray(commentTrigger.overallStates);
  const commentTrendSeverities = _normalizeArray(commentTrigger.trendSeverities);
  const marker = _normalizeText(policy.commentMarker, "<!-- harness-gate-summary -->");
  const commentTemplate =
    policy.commentTemplate && typeof policy.commentTemplate === "object"
      ? policy.commentTemplate
      : { title: "### Harness Gate Signal", fields: [] };

  const policyDiagnostics =
    policy.policyDiagnostics && typeof policy.policyDiagnostics === "object"
      ? policy.policyDiagnostics
      : { severity: "unknown", reason: "diagnostics_missing" };
  const policyDrift =
    policy.policyDrift && typeof policy.policyDrift === "object"
      ? policy.policyDrift
      : { commentTriggerSeverities: [], actionHints: {} };

  const outputPolicyDriftSeverityRaw = _normalizeText(env.POLICY_DRIFT_SEVERITY || "", "");
  const outputPolicyDriftReasonRaw = _normalizeText(env.POLICY_DRIFT_REASON || "", "");
  const outputPolicyDriftTransitionRaw = _normalizeText(env.POLICY_DRIFT_TRANSITION || "", "");
  const outputPolicyDriftTransitionStateRaw = _normalizeText(env.POLICY_DRIFT_TRANSITION_STATE || "", "");
  const outputPolicyDriftDeltaRaw = _normalizeText(env.POLICY_DRIFT_SEVERITY_DELTA || "", "");
  const outputPolicyDriftOwnerRaw = _normalizeText(env.POLICY_DRIFT_OWNER || "", "");
  const outputPolicyDriftActionHintRaw = _normalizeText(env.POLICY_DRIFT_ACTION_HINT || "", "");

  const policyDriftSeverity =
    outputPolicyDriftSeverityRaw.length > 0
      ? outputPolicyDriftSeverityRaw
      : _normalizeText(policyDiagnostics.severity || "", "none");
  const policyDriftReason =
    outputPolicyDriftReasonRaw.length > 0
      ? outputPolicyDriftReasonRaw
      : _normalizeText(policyDiagnostics.reason || "", "shape_ok");
  const policyDriftText = `${policyDriftSeverity}:${policyDriftReason}`;
  const policyDriftWorseningStreak = _parsePositiveIntOrZero(env.POLICY_DRIFT_WORSENING_STREAK || "0");
  const policyDriftWorseningAlert = _parseBool(env.POLICY_DRIFT_WORSENING_ALERT || "");
  const policyDriftTransition =
    outputPolicyDriftTransitionRaw.length > 0
      ? outputPolicyDriftTransitionRaw
      : `none->${policyDriftSeverity}`;
  const policyDriftTransitionState =
    outputPolicyDriftTransitionStateRaw.length > 0
      ? outputPolicyDriftTransitionStateRaw
      : "stable_none";
  const policyDriftSeverityDelta = _parseIntOr(outputPolicyDriftDeltaRaw, 0);

  const driftTriggerSeverities = _normalizeArray(policyDrift.commentTriggerSeverities);
  const actionHints =
    policyDrift.actionHints && typeof policyDrift.actionHints === "object"
      ? policyDrift.actionHints
      : {};
  const rawDriftActionHint = actionHints[policyDriftSeverity] || "n/a";
  const fallbackDriftActionHint =
    typeof rawDriftActionHint === "string" && rawDriftActionHint.trim()
      ? rawDriftActionHint.trim()
      : "n/a";
  const driftActionHint =
    outputPolicyDriftActionHintRaw.length > 0
      ? outputPolicyDriftActionHintRaw
      : fallbackDriftActionHint;
  const policyDriftOwner =
    outputPolicyDriftOwnerRaw.length > 0
      ? outputPolicyDriftOwnerRaw
      : policyDriftSeverity === "none"
        ? "release-owner"
        : "policy-maintainers";

  const hintParts = [];
  if (trendActionHint !== "n/a") {
    hintParts.push(trendActionHint);
  }
  if (driftActionHint !== "n/a") {
    hintParts.push(driftActionHint);
  }
  if (policyDriftSeverity !== "none") {
    hintParts.push(
      `policy drift transition=${policyDriftTransition}; state=${policyDriftTransitionState}; delta=${policyDriftSeverityDelta}`
    );
  }
  const mergedActionHint = hintParts.length > 0 ? hintParts.join("; ") : "n/a";
  const finalActionHint =
    policyDriftWorseningAlert && policyDriftWorseningStreak > 0
      ? `${mergedActionHint}; policy drift worsening streak=${policyDriftWorseningStreak}`
      : mergedActionHint;
  const finalOwner = policyDriftSeverity !== "none" ? policyDriftOwner : trendOwner;

  const shouldNotify =
    commentOverallStates.includes(overallState) ||
    commentTrendSeverities.includes(trendSeverity) ||
    driftTriggerSeverities.includes(policyDriftSeverity);

  const policyDriftStateMeta = {
    severity: policyDriftSeverity,
    reason: policyDriftReason,
    worsening_streak: policyDriftWorseningStreak,
  };
  const fieldValues = {
    overall: overallState,
    trend_tag: trendTag,
    trend_severity: trendSeverity,
    policy_drift: policyDriftText,
    owner: finalOwner,
    action: finalActionHint,
    suggested_labels: labelsText,
  };

  const owner = context.repo.owner;
  const repo = context.repo.repo;
  try {
    const comments = await github.paginate(github.rest.issues.listComments, {
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
    });
    const existing = comments.find((comment) => {
      if (typeof comment.body !== "string") {
        return false;
      }
      return comment.body.includes(marker);
    });

    if (!shouldNotify) {
      if (existing) {
        await github.rest.issues.deleteComment({
          owner,
          repo,
          comment_id: existing.id,
        });
        core.notice("Removed stale harness gate summary comment");
        return { notified: false, removedStale: true };
      }
      core.info("Comment trigger not matched; no summary comment needed");
      return { notified: false, removedStale: false };
    }

    const stateMetaMarker = buildPolicyDriftStateMarker(policyDriftStateMeta);
    const bodyLines = [marker, stateMetaMarker, commentTemplate.title, ""];
    const templateFields = _normalizeArray(commentTemplate.fields);
    for (const field of templateFields) {
      const key = field && typeof field === "object" ? field.key : "";
      const label = field && typeof field === "object" ? field.label : "";
      if (typeof key !== "string" || typeof label !== "string") {
        continue;
      }
      const rawValue = Object.prototype.hasOwnProperty.call(fieldValues, key)
        ? fieldValues[key]
        : "n/a";
      const valueText = field.format === "code" ? `\`${rawValue}\`` : String(rawValue);
      bodyLines.push(`- ${label}: ${valueText}`);
    }
    const body = bodyLines.join("\n");

    if (existing) {
      await github.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existing.id,
        body,
      });
      core.notice("Updated existing harness gate summary comment");
      return { notified: true, mode: "updated" };
    }

    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
    core.notice("Created harness gate summary comment");
    return { notified: true, mode: "created" };
  } catch (error) {
    core.warning(`failed to upsert harness gate summary comment: ${error}`);
    return { notified: false, reason: "runtime_error" };
  }
};

module.exports = {
  upsertHarnessGateActionComment,
};
