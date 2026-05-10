import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  assertSuccess,
  isRecord,
  logStep,
  makeTempDir,
  parseJsonOutput,
  runCommand,
} from "../harness.mjs";
import {
  runRuntimePlanConcurrencyFlowSmoke,
  runRuntimePlanModeFlowSmoke,
} from "./interactive-plan-flow.mjs";

export function runRuntimePlanEventSourceFlowSmoke() {
  return {
    planModeEventsPath: runRuntimePlanModeFlowSmoke(),
    planConcurrencyEventsPath: runRuntimePlanConcurrencyFlowSmoke(),
  };
}

export async function runRuntimePlanEventsPolicySmoke(planEventsPaths) {
  const planEventsReportPath = resolve(makeTempDir("plan-events-report"), "report.json");
  const planEventsReportResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/governance/evals/plan-events-report.ts",
    "--events-path",
    String(planEventsPaths?.planModeEventsPath),
    "--events-path",
    String(planEventsPaths?.planConcurrencyEventsPath),
    "--output",
    planEventsReportPath,
    "--print-json",
  ]);
  assertSuccess("plan-events-report", planEventsReportResult);
  const planEventsReportPayload = parseJsonOutput("plan-events-report", planEventsReportResult.stdout);
  assert.equal(Number(planEventsReportPayload?.totals?.events_count) >= 2, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_mode_entered_count) >= 1, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_created_count) >= 1, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_progress_appended_count) >= 1, true);
  assert.equal(
    Number(planEventsReportPayload?.totals?.plan_apply_succeeded_count)
      <= Number(planEventsReportPayload?.totals?.plan_apply_started_count),
    true,
  );
  assert.equal(Number(planEventsReportPayload?.totals?.files_count), 2);
  assert.equal(Number(planEventsReportPayload?.totals?.missing_files_count), 0);
  assert.equal(Number(planEventsReportPayload?.totals?.invalid_lines), 0);
  assert.equal(Number(planEventsReportPayload?.totals?.sessions_count) >= 1, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_review_failed_count) >= 1, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_review_passed_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_phase_drafting_count) >= 1, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_phase_awaiting_decision_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_phase_applying_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_phase_unknown_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_recovered_stale_apply_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_turn_degraded_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_turn_failed_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_approval_blocked_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_apply_blocked_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_approval_blocked_quality_guard_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_apply_blocked_quality_guard_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.policy_action_fail_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.policy_action_degrade_count) >= 0, true);
  assert.equal(isRecord(planEventsReportPayload?.totals?.block_reason_counts), true);
  assert.equal(isRecord(planEventsReportPayload?.totals?.policy_reason_counts), true);
  assert.equal(isRecord(planEventsReportPayload?.totals?.diagnostic_code_counts), true);
  assert.equal(Number(planEventsReportPayload?.totals?.review_failed_rate ?? 0) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.approval_blocked_rate ?? 0) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.apply_blocked_rate ?? 0) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.quality_guard_blocked_rate ?? 0) >= 0, true);
  logStep("plan-events-report", {
    files: planEventsReportPayload?.totals?.files_count,
    events: planEventsReportPayload?.totals?.events_count,
    sessions: planEventsReportPayload?.totals?.sessions_count,
    phase_drafting: planEventsReportPayload?.totals?.plan_phase_drafting_count,
    phase_awaiting_decision: planEventsReportPayload?.totals?.plan_phase_awaiting_decision_count,
    apply_blocked: planEventsReportPayload?.totals?.plan_apply_blocked_count,
    approval_blocked: planEventsReportPayload?.totals?.plan_approval_blocked_count,
    policy_fail: planEventsReportPayload?.totals?.policy_action_fail_count,
    policy_degrade: planEventsReportPayload?.totals?.policy_action_degrade_count,
  });

  for (const policyPath of [
    "gateway/evals/plan_events_policy.dev.json",
    "gateway/evals/plan_events_policy.ci.json",
    "gateway/evals/plan_events_policy.prod.json",
  ]) {
    const planEventsPolicyGuardResult = runCommand("npx", [
      "--yes",
      "--package",
      "tsx@4.20.6",
      "tsx",
      "gateway/src/governance/evals/plan-events-policy-guard.ts",
      "--policy",
      policyPath,
      "--report",
      planEventsReportPath,
      "--print-json",
    ]);
    assertSuccess(`plan-events-policy-guard ${policyPath}`, planEventsPolicyGuardResult);
    const planEventsPolicyGuardPayload = parseJsonOutput(
      `plan-events-policy-guard ${policyPath}`,
      planEventsPolicyGuardResult.stdout,
    );
    assert.equal(planEventsPolicyGuardPayload?.status, "ok");
    assert.equal(Number(planEventsPolicyGuardPayload?.violations_count), 0);
    assert.equal(
      Number(planEventsPolicyGuardPayload?.metrics?.review_failed_rate ?? 0) >= 0,
      true,
    );
    assert.equal(
      typeof planEventsPolicyGuardPayload?.policy_overrides,
      "object",
    );
    assert.equal(
      typeof planEventsPolicyGuardPayload?.policy_override_scope,
      "object",
    );
    assert.equal(
      planEventsPolicyGuardPayload?.policy_override_scope?.allow_source,
      "default_all",
    );
    assert.equal(
      planEventsPolicyGuardPayload?.policy_override_scope?.deny_source,
      "default_none",
    );
    assert.equal(
      Array.isArray(planEventsPolicyGuardPayload?.policy_override_scope?.allow_fields),
      true,
    );
    assert.equal(
      Array.isArray(planEventsPolicyGuardPayload?.policy_override_scope?.deny_fields),
      true,
    );
    assert.equal(
      planEventsPolicyGuardPayload?.policy_override_scope?.allow_fields?.includes("max_review_failed_rate"),
      true,
    );
    assert.equal(
      planEventsPolicyGuardPayload?.policy_override_scope?.allow_fields?.includes("max_policy_fail_rate"),
      true,
    );
    assert.equal(
      planEventsPolicyGuardPayload?.policy_override_scope?.allow_fields?.includes("max_unknown_phase_rate"),
      true,
    );
    assert.equal(
      Number(planEventsPolicyGuardPayload?.policy_override_scope?.deny_fields?.length ?? 0),
      0,
    );
    logStep("plan-events-policy-guard", {
      profile: planEventsPolicyGuardPayload?.profile,
      policy: policyPath,
      violations: planEventsPolicyGuardPayload?.violations_count,
    });
  }

  const strictPlanEventsPolicyGuardResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/governance/evals/plan-events-policy-guard.ts",
    "--policy",
    "gateway/evals/plan_events_policy.ci.json",
    "--report",
    planEventsReportPath,
    "--print-json",
  ], {
    env: {
      ...process.env,
      GROBOT_PLAN_EVENTS_MAX_REVIEW_FAILED_RATE: "0.2",
    },
  });
  assert.equal(strictPlanEventsPolicyGuardResult.code !== 0, true);
  const strictPlanEventsPolicyGuardPayload = parseJsonOutput(
    "plan-events-policy-guard strict env override",
    strictPlanEventsPolicyGuardResult.stdout,
  );
  assert.equal(strictPlanEventsPolicyGuardPayload?.status, "error");
  assert.equal(Number(strictPlanEventsPolicyGuardPayload?.violations_count) >= 1, true);
  assert.equal(
    Array.isArray(strictPlanEventsPolicyGuardPayload?.violations) &&
      strictPlanEventsPolicyGuardPayload.violations.some((line) => String(line).includes("max_review_failed_rate 0.2")),
    true,
  );
  assert.equal(
    Number(strictPlanEventsPolicyGuardPayload?.policy_overrides?.max_review_failed_rate),
    0.2,
  );
  assert.equal(
    strictPlanEventsPolicyGuardPayload?.policy_override_scope?.allow_source,
    "default_all",
  );
  assert.equal(
    strictPlanEventsPolicyGuardPayload?.policy_override_scope?.deny_source,
    "default_none",
  );
  logStep("plan-events-policy-guard env-override");

  const scopedPlanEventsPolicyGuardResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/governance/evals/plan-events-policy-guard.ts",
    "--policy",
    "gateway/evals/plan_events_policy.ci.json",
    "--report",
    planEventsReportPath,
    "--print-json",
  ], {
    env: {
      ...process.env,
      GROBOT_PLAN_EVENTS_POLICY_OVERRIDE_ALLOW: "max_review_failed_rate,max_guard_denied_rate",
      GROBOT_PLAN_EVENTS_POLICY_OVERRIDE_DENY: "max_invalid_lines",
      GROBOT_PLAN_EVENTS_MAX_REVIEW_FAILED_RATE: "0.99",
    },
  });
  assertSuccess("plan-events-policy-guard scoped-env-override", scopedPlanEventsPolicyGuardResult);
  const scopedPlanEventsPolicyGuardPayload = parseJsonOutput(
    "plan-events-policy-guard scoped env override",
    scopedPlanEventsPolicyGuardResult.stdout,
  );
  assert.equal(scopedPlanEventsPolicyGuardPayload?.status, "ok");
  assert.equal(
    Number(scopedPlanEventsPolicyGuardPayload?.policy_overrides?.max_review_failed_rate),
    0.99,
  );
  assert.equal(
    scopedPlanEventsPolicyGuardPayload?.policy_override_scope?.allow_source,
    "env",
  );
  assert.equal(
    scopedPlanEventsPolicyGuardPayload?.policy_override_scope?.deny_source,
    "env",
  );
  assert.equal(
    scopedPlanEventsPolicyGuardPayload?.policy_override_scope?.allow_fields?.includes("max_review_failed_rate"),
    true,
  );
  assert.equal(
    scopedPlanEventsPolicyGuardPayload?.policy_override_scope?.allow_fields?.includes("max_guard_denied_rate"),
    true,
  );
  assert.equal(
    scopedPlanEventsPolicyGuardPayload?.policy_override_scope?.deny_fields?.includes("max_invalid_lines"),
    true,
  );
  logStep("plan-events-policy-guard scoped-env-override");

  const strictPolicyFailGuardResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/governance/evals/plan-events-policy-guard.ts",
    "--policy",
    "gateway/evals/plan_events_policy.ci.json",
    "--report",
    planEventsReportPath,
    "--print-json",
  ], {
    env: {
      ...process.env,
      GROBOT_PLAN_EVENTS_MAX_POLICY_FAIL_RATE: "0.01",
    },
  });
  assert.equal(strictPolicyFailGuardResult.code !== 0, true);
  const strictPolicyFailGuardPayload = parseJsonOutput(
    "plan-events-policy-guard strict policy-fail override",
    strictPolicyFailGuardResult.stdout,
  );
  assert.equal(strictPolicyFailGuardPayload?.status, "error");
  assert.equal(Number(strictPolicyFailGuardPayload?.violations_count) >= 1, true);
  assert.equal(
    Array.isArray(strictPolicyFailGuardPayload?.violations)
      && strictPolicyFailGuardPayload.violations.some((line) => String(line).includes("max_policy_fail_rate 0.01")),
    true,
  );
  assert.equal(
    Number(strictPolicyFailGuardPayload?.policy_overrides?.max_policy_fail_rate),
    0.01,
  );
  logStep("plan-events-policy-guard strict-policy-fail-override");

  const allowBlockedPolicyGuardResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/governance/evals/plan-events-policy-guard.ts",
    "--policy",
    "gateway/evals/plan_events_policy.ci.json",
    "--report",
    planEventsReportPath,
    "--print-json",
  ], {
    env: {
      ...process.env,
      GROBOT_PLAN_EVENTS_POLICY_OVERRIDE_ALLOW: "max_guard_denied_rate",
      GROBOT_PLAN_EVENTS_MAX_REVIEW_FAILED_RATE: "0.2",
    },
  });
  assert.equal(allowBlockedPolicyGuardResult.code !== 0, true);
  assert.equal(
    allowBlockedPolicyGuardResult.stderr.includes("GROBOT_PLAN_EVENTS_POLICY_OVERRIDE_ALLOW"),
    true,
  );
  assert.equal(
    allowBlockedPolicyGuardResult.stderr.includes("max_review_failed_rate"),
    true,
  );
  logStep("plan-events-policy-guard allowlist-block");

  const denyBlockedPolicyGuardResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/governance/evals/plan-events-policy-guard.ts",
    "--policy",
    "gateway/evals/plan_events_policy.ci.json",
    "--report",
    planEventsReportPath,
    "--print-json",
  ], {
    env: {
      ...process.env,
      GROBOT_PLAN_EVENTS_POLICY_OVERRIDE_DENY: "max_review_failed_rate",
      GROBOT_PLAN_EVENTS_MAX_REVIEW_FAILED_RATE: "0.2",
    },
  });
  assert.equal(denyBlockedPolicyGuardResult.code !== 0, true);
  assert.equal(
    denyBlockedPolicyGuardResult.stderr.includes("GROBOT_PLAN_EVENTS_POLICY_OVERRIDE_DENY"),
    true,
  );
  assert.equal(
    denyBlockedPolicyGuardResult.stderr.includes("max_review_failed_rate"),
    true,
  );
  logStep("plan-events-policy-guard denylist-block");
}
