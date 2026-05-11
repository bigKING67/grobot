import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnTsxSync } from "./_shared/run-tsx-script.mjs";

const POLICY_OVERRIDE_ALLOW_ENV = "GROBOT_PLAN_EVENTS_POLICY_OVERRIDE_ALLOW";
const POLICY_OVERRIDE_DENY_ENV = "GROBOT_PLAN_EVENTS_POLICY_OVERRIDE_DENY";

function runGuard(repoRoot, policyPath, reportPath, options = {}) {
  const args = [
    "--policy",
    policyPath,
    "--report",
    reportPath,
  ];
  if (options.printJson !== false) {
    args.push("--print-json");
  }
  const completed = spawnTsxSync("gateway/src/governance/evals/plan-events-policy-guard.ts", args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
  });
  return {
    code: typeof completed.status === "number" ? completed.status : 1,
    stdout: completed.stdout ?? "",
    stderr: completed.stderr ?? "",
  };
}

function parseJsonOutput(stdout, label) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const tail = lines[lines.length - 1] ?? "";
  assert.equal(tail.length > 0, true, `${label} stdout is empty`);
  return JSON.parse(tail);
}

function writeFixtureFiles(tempRoot) {
  const policyPath = resolve(tempRoot, "policy.json");
  const reportPath = resolve(tempRoot, "report.json");
  writeFileSync(
    policyPath,
    `${JSON.stringify({
      schema: "plan_events_policy",
      schema_version: 1,
      profile: "contract",
      gates: {
        min_events_count: 1,
        min_sessions_count: 1,
        min_plan_mode_entered_count: 1,
        min_plan_created_count: 1,
        min_plan_progress_appended_count: 1,
        max_invalid_lines: 0,
        max_missing_files: 0,
        max_review_failed_rate: 0.8,
        max_guard_denied_rate: 0.8,
        max_quality_guard_blocked_rate: 0.8,
        max_idempotent_hit_rate: 0.8,
        max_policy_fail_rate: 0.8,
        max_unknown_phase_rate: 0.8,
        max_stale_recovery_count: 2,
      },
    }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    reportPath,
    `${JSON.stringify({
      totals: {
        events_count: 10,
        sessions_count: 2,
        plan_mode_entered_count: 2,
        plan_created_count: 2,
        plan_progress_appended_count: 4,
        plan_review_passed_count: 1,
        plan_review_failed_count: 1,
        invalid_lines: 0,
        missing_files_count: 0,
        review_failed_rate: 0.5,
        guard_denied_rate: 0.2,
        quality_guard_blocked_rate: 0.1,
        idempotent_hit_rate: 0.1,
        policy_action_fail_count: 1,
        policy_action_degrade_count: 0,
        plan_phase_unknown_count: 1,
        plan_recovered_stale_approved_count: 0,
      },
    }, null, 2)}\n`,
    "utf8",
  );
  return {
    policyPath,
    reportPath,
  };
}

function main() {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(resolve(tmpdir(), "plan-events-policy-guard-contract-"));
  try {
    const fixture = writeFixtureFiles(tempRoot);

    const baseline = runGuard(repoRoot, fixture.policyPath, fixture.reportPath, {
      printJson: true,
      env: {
        [POLICY_OVERRIDE_ALLOW_ENV]: "",
        [POLICY_OVERRIDE_DENY_ENV]: "",
      },
    });
    assert.equal(baseline.code, 0, `baseline guard failed: ${baseline.stderr}`);
    const baselinePayload = parseJsonOutput(baseline.stdout, "baseline");
    assert.equal(baselinePayload.status, "ok");
    assert.equal(baselinePayload.policy_override_scope.allow_source, "default_all");
    assert.equal(baselinePayload.policy_override_scope.deny_source, "default_none");
    assert.equal(Array.isArray(baselinePayload.policy_override_scope.allow_fields), true);
    assert.equal(Array.isArray(baselinePayload.policy_override_scope.deny_fields), true);
    assert.equal(baselinePayload.policy_override_scope.deny_fields.length, 0);
    assert.equal(
      baselinePayload.policy_override_scope.allow_fields.includes("max_review_failed_rate"),
      true,
    );
    assert.equal(
      baselinePayload.policy_override_scope.allow_fields.includes("max_policy_fail_rate"),
      true,
    );
    assert.equal(
      baselinePayload.policy_override_scope.allow_fields.includes("max_quality_guard_blocked_rate"),
      true,
    );
    assert.equal(
      baselinePayload.policy_override_scope.allow_fields.includes("max_unknown_phase_rate"),
      true,
    );
    assert.equal(Number(baselinePayload.metrics.policy_fail_rate), 0.1);
    assert.equal(Number(baselinePayload.metrics.unknown_phase_rate), 0.1);

    const scoped = runGuard(repoRoot, fixture.policyPath, fixture.reportPath, {
      printJson: true,
      env: {
        [POLICY_OVERRIDE_ALLOW_ENV]: "max_guard_denied_rate,max_review_failed_rate,max_policy_fail_rate,max_unknown_phase_rate",
        [POLICY_OVERRIDE_DENY_ENV]: "max_invalid_lines",
        GROBOT_PLAN_EVENTS_MAX_REVIEW_FAILED_RATE: "0.6",
        GROBOT_PLAN_EVENTS_MAX_POLICY_FAIL_RATE: "0.5",
        GROBOT_PLAN_EVENTS_MAX_UNKNOWN_PHASE_RATE: "0.5",
      },
    });
    assert.equal(scoped.code, 0, `scoped guard failed: ${scoped.stderr}`);
    const scopedPayload = parseJsonOutput(scoped.stdout, "scoped");
    assert.equal(scopedPayload.status, "ok");
    assert.equal(scopedPayload.policy_override_scope.allow_source, "env");
    assert.equal(scopedPayload.policy_override_scope.deny_source, "env");
    assert.equal(
      Number(scopedPayload.policy_overrides.max_review_failed_rate),
      0.6,
    );
    assert.equal(
      Number(scopedPayload.policy_overrides.max_policy_fail_rate),
      0.5,
    );
    assert.equal(
      Number(scopedPayload.policy_overrides.max_unknown_phase_rate),
      0.5,
    );
    assert.equal(
      scopedPayload.policy_override_scope.allow_fields.includes("max_review_failed_rate"),
      true,
    );
    assert.equal(
      scopedPayload.policy_override_scope.allow_fields.includes("max_guard_denied_rate"),
      true,
    );
    assert.equal(
      scopedPayload.policy_override_scope.allow_fields.includes("max_policy_fail_rate"),
      true,
    );
    assert.equal(
      scopedPayload.policy_override_scope.allow_fields.includes("max_quality_guard_blocked_rate"),
      false,
    );
    assert.equal(
      scopedPayload.policy_override_scope.allow_fields.includes("max_unknown_phase_rate"),
      true,
    );
    assert.equal(
      scopedPayload.policy_override_scope.deny_fields.includes("max_invalid_lines"),
      true,
    );

    const strictPolicyFail = runGuard(repoRoot, fixture.policyPath, fixture.reportPath, {
      printJson: true,
      env: {
        GROBOT_PLAN_EVENTS_MAX_POLICY_FAIL_RATE: "0.01",
      },
    });
    assert.equal(strictPolicyFail.code !== 0, true);
    const strictPolicyFailPayload = parseJsonOutput(strictPolicyFail.stdout, "strictPolicyFail");
    assert.equal(strictPolicyFailPayload.status, "error");
    assert.equal(
      Array.isArray(strictPolicyFailPayload.violations)
        && strictPolicyFailPayload.violations.some((line) => String(line).includes("max_policy_fail_rate 0.01")),
      true,
    );
    assert.equal(
      Number(strictPolicyFailPayload.policy_overrides.max_policy_fail_rate),
      0.01,
    );

    const overlap = runGuard(repoRoot, fixture.policyPath, fixture.reportPath, {
      printJson: true,
      env: {
        [POLICY_OVERRIDE_ALLOW_ENV]: "max_review_failed_rate,max_guard_denied_rate",
        [POLICY_OVERRIDE_DENY_ENV]: "max_guard_denied_rate",
      },
    });
    assert.equal(overlap.code !== 0, true);
    assert.equal(overlap.stderr.includes(POLICY_OVERRIDE_ALLOW_ENV), true);
    assert.equal(overlap.stderr.includes(POLICY_OVERRIDE_DENY_ENV), true);
    assert.equal(overlap.stderr.includes("max_guard_denied_rate"), true);

    const textMode = runGuard(repoRoot, fixture.policyPath, fixture.reportPath, {
      printJson: false,
      env: {
        [POLICY_OVERRIDE_ALLOW_ENV]: "max_guard_denied_rate,max_review_failed_rate",
        [POLICY_OVERRIDE_DENY_ENV]: "max_invalid_lines",
      },
    });
    assert.equal(textMode.code, 0, `text mode guard failed: ${textMode.stderr}`);
    assert.equal(textMode.stdout.includes("allow="), true);
    assert.equal(textMode.stdout.includes("deny="), true);
    assert.equal(textMode.stdout.includes("overrides="), true);

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        baseline_allow_source: baselinePayload.policy_override_scope.allow_source,
        baseline_deny_source: baselinePayload.policy_override_scope.deny_source,
        scoped_allow_source: scopedPayload.policy_override_scope.allow_source,
        scoped_deny_source: scopedPayload.policy_override_scope.deny_source,
        strict_policy_fail_rejected: true,
        overlap_rejected: true,
        text_mode_has_scope_counts: true,
      })}\n`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`plan-events-policy-guard-contract failed: ${message}\n`);
  process.exitCode = 1;
}
