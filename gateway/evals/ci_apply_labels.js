"use strict";

const path = require("path");
const {
  DEFAULT_LABEL_POLICY,
  POLICY_DRIFT_SEVERITIES,
  loadCiLabelPolicyForLabels,
} = require("./ci_label_policy_runtime.js");

const applySuggestedLabelsForPullRequest = async ({
  core,
  github,
  context,
  env = process.env,
  workspacePath = process.env.GITHUB_WORKSPACE || ".",
}) => {
  const policyPath = path.join(workspacePath, "gateway/evals/ci_label_policy.json");
  const policy = loadCiLabelPolicyForLabels({ policyPath, core });

  let safeLabelRegex;
  try {
    safeLabelRegex = new RegExp(policy.safeLabelPattern);
  } catch (error) {
    core.warning(`invalid safe label regex in policy, fallback to default: ${error}`);
    safeLabelRegex = new RegExp(DEFAULT_LABEL_POLICY.safeLabelPattern);
  }
  const sortedRules = [...policy.labelRules].sort((a, b) => b.prefix.length - a.prefix.length);
  const findRule = (label) => sortedRules.find((rule) => label.startsWith(rule.prefix));
  const labelColorFor = (label) => findRule(label)?.color || policy.defaultColor;
  const labelDescriptionFor = (label) =>
    findRule(label)?.description || policy.defaultDescription;

  const rawLabels = env.SUGGESTED_LABELS_JSON || "[]";
  let parsedLabels = [];
  try {
    const parsed = JSON.parse(rawLabels);
    if (Array.isArray(parsed)) {
      parsedLabels = parsed;
    } else {
      core.warning("suggested_labels_json is not an array; skip auto-label");
      return { applied: false, reason: "invalid_suggested_labels_shape" };
    }
  } catch (error) {
    core.warning(`cannot parse suggested_labels_json: ${error}`);
    return { applied: false, reason: "invalid_suggested_labels_json" };
  }

  const policyDiagnostics =
    policy.policyDiagnostics && typeof policy.policyDiagnostics === "object"
      ? policy.policyDiagnostics
      : null;
  const policyDrift =
    policy.policyDrift && typeof policy.policyDrift === "object"
      ? policy.policyDrift
      : { labelPrefix: "ci/policy-drift-", worseningLabel: "ci/policy-drift-worsening" };
  const driftLabelPrefix =
    typeof policyDrift.labelPrefix === "string" && policyDrift.labelPrefix.trim()
      ? policyDrift.labelPrefix.trim()
      : "ci/policy-drift-";
  const driftWorseningLabel =
    typeof policyDrift.worseningLabel === "string" && policyDrift.worseningLabel.trim()
      ? policyDrift.worseningLabel.trim()
      : "ci/policy-drift-worsening";
  const driftSeverityRaw = policyDiagnostics ? policyDiagnostics.severity : null;
  const driftSeverity =
    typeof driftSeverityRaw === "string" ? driftSeverityRaw.trim().toLowerCase() : "";
  const allowedDriftSeverities = new Set(POLICY_DRIFT_SEVERITIES);
  const driftLabels = [];
  if (allowedDriftSeverities.has(driftSeverity)) {
    driftLabels.push(`${driftLabelPrefix}${driftSeverity}`);
    core.info(`Injected policy drift label: ${driftLabelPrefix}${driftSeverity}`);
  } else {
    core.warning(
      `policy diagnostics severity is invalid for drift label: ${String(driftSeverityRaw)}`
    );
  }
  const driftWorseningAlert = (env.POLICY_DRIFT_WORSENING_ALERT || "").trim().toLowerCase() === "true";
  const driftWorseningLabelOutputRaw = (env.POLICY_DRIFT_WORSENING_LABEL || "").trim();
  const driftWorseningLabelOutput =
    driftWorseningLabelOutputRaw.length > 0 ? driftWorseningLabelOutputRaw : driftWorseningLabel;
  if (driftWorseningAlert) {
    if (driftWorseningLabelOutput.length > 0) {
      driftLabels.push(driftWorseningLabelOutput);
      core.info(`Injected policy drift worsening label: ${driftWorseningLabelOutput}`);
    } else {
      core.warning("policy drift worsening label is empty; skip worsening label injection");
    }
  }

  const requestedLabels = [
    ...new Set(
      [...parsedLabels, ...driftLabels]
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    ),
  ];
  if (requestedLabels.length === 0) {
    core.info("No suggested labels from gate-summary and no policy drift label; skip auto-label");
    return { applied: false, reason: "no_requested_labels" };
  }

  const safeLabels = requestedLabels.filter((label) => safeLabelRegex.test(label));
  const droppedUnsafe = requestedLabels.filter((label) => !safeLabelRegex.test(label));
  if (droppedUnsafe.length > 0) {
    core.warning(`Dropped unsafe labels: ${droppedUnsafe.join(", ")}`);
  }
  if (safeLabels.length === 0) {
    core.info("No safe ci/* labels remain after filtering; skip auto-label");
    return { applied: false, reason: "no_safe_labels" };
  }

  const issueNumber = context?.payload?.pull_request?.number;
  if (!issueNumber) {
    core.info("No pull_request payload found; skip auto-label");
    return { applied: false, reason: "missing_pull_request" };
  }
  const owner = context.repo.owner;
  const repo = context.repo.repo;

  const [repoLabels, issueLabels] = await Promise.all([
    github.paginate(github.rest.issues.listLabelsForRepo, {
      owner,
      repo,
      per_page: 100,
    }),
    github.paginate(github.rest.issues.listLabelsOnIssue, {
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
    }),
  ]);
  const repoLabelSet = new Set(repoLabels.map((entry) => entry.name));
  const issueLabelSet = new Set(issueLabels.map((entry) => entry.name));
  const issueLabelNames = issueLabels.map((entry) => entry.name);

  const missingLabels = safeLabels.filter((label) => !repoLabelSet.has(label));
  if (missingLabels.length > 0) {
    core.warning(`Missing labels will be created if possible: ${missingLabels.join(", ")}`);
  }
  for (const missingLabel of missingLabels) {
    try {
      await github.rest.issues.createLabel({
        owner,
        repo,
        name: missingLabel,
        color: labelColorFor(missingLabel),
        description: labelDescriptionFor(missingLabel),
      });
      repoLabelSet.add(missingLabel);
      core.notice(`Created missing label: ${missingLabel}`);
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error ? error.status : undefined;
      const message = String(error);
      if (status === 422 || message.includes("already_exists")) {
        repoLabelSet.add(missingLabel);
        continue;
      }
      core.warning(`failed to create label ${missingLabel}: ${error}`);
    }
  }

  const desiredLabelSet = new Set(safeLabels);
  const staleLabels = issueLabelNames.filter(
    (label) =>
      policy.managedLabelPrefixes.some((prefix) => label.startsWith(prefix)) &&
      !desiredLabelSet.has(label)
  );
  if (staleLabels.length > 0) {
    core.info(`Removing stale managed labels: ${staleLabels.join(", ")}`);
  }
  for (const staleLabel of staleLabels) {
    try {
      await github.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: issueNumber,
        name: staleLabel,
      });
      issueLabelSet.delete(staleLabel);
      core.notice(`Removed stale label: ${staleLabel}`);
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error ? error.status : undefined;
      if (status === 404) {
        issueLabelSet.delete(staleLabel);
        continue;
      }
      core.warning(`failed to remove stale label ${staleLabel}: ${error}`);
    }
  }

  const labelsToAdd = safeLabels.filter(
    (label) => repoLabelSet.has(label) && !issueLabelSet.has(label)
  );
  if (labelsToAdd.length === 0) {
    core.info("No new labels to add");
    return { applied: false, reason: "no_new_labels" };
  }

  try {
    await github.rest.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels: labelsToAdd,
    });
    core.notice(`Applied labels: ${labelsToAdd.join(", ")}`);
    return { applied: true, labelsAdded: labelsToAdd };
  } catch (error) {
    core.warning(`failed to add labels (possibly permission-limited token): ${error}`);
    return { applied: false, reason: "add_labels_failed" };
  }
};

module.exports = {
  applySuggestedLabelsForPullRequest,
};
