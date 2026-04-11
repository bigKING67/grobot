"use strict";

const fs = require("fs");
const path = require("path");
const {
  loadCiLabelPolicyForComment,
  extractPolicyDriftStateFromCommentBody,
  buildPolicyDriftReport,
} = require("./ci_label_policy_runtime.js");

const buildPolicyDriftReportForPullRequest = async ({
  core,
  github,
  context,
  workspacePath = process.env.GITHUB_WORKSPACE || ".",
}) => {
  const policyPath = path.join(workspacePath, "gateway/evals/ci_label_policy.json");
  const outputPath = path.join(workspacePath, "gateway/evals/data/policy_drift_report.json");

  const policy = loadCiLabelPolicyForComment({ policyPath, core });
  const diagnostics =
    policy.policyDiagnostics && typeof policy.policyDiagnostics === "object"
      ? policy.policyDiagnostics
      : { severity: "none", reason: "shape_ok" };
  const policyDrift =
    policy.policyDrift && typeof policy.policyDrift === "object"
      ? policy.policyDrift
      : { worseningAlertThreshold: 2, worseningLabel: "ci/policy-drift-worsening" };
  let previousState = { severity: "none", reason: "shape_ok", worseningStreak: 0 };
  const marker = policy.commentMarker;

  const issueNumber = context?.payload?.pull_request?.number;
  if (issueNumber) {
    try {
      const comments = await github.paginate(github.rest.issues.listComments, {
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issueNumber,
        per_page: 100,
      });
      const existing = comments.find((comment) => {
        if (typeof comment.body !== "string") {
          return false;
        }
        return comment.body.includes(marker);
      });
      if (existing && typeof existing.body === "string") {
        previousState = extractPolicyDriftStateFromCommentBody({
          commentBody: existing.body,
          core,
        });
      }
    } catch (error) {
      core.warning(`failed to load previous policy drift state from PR comment: ${error}`);
    }
  }

  const report = buildPolicyDriftReport({
    policyDiagnostics: diagnostics,
    policyDrift,
    previousState,
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  core.info(`policy drift report generated: ${JSON.stringify(report)}`);
  return report;
};

module.exports = {
  buildPolicyDriftReportForPullRequest,
};
