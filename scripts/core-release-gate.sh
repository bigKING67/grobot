#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/core-release-gate.sh [options]

Options:
  --allow-stub       Allow placeholder stub binaries (dev only)
  --skip-pack-dryrun Skip npm pack --dry-run checks
  --report <file>    Write JSON report to file
  -h, --help         Show help
EOF
}

ALLOW_STUB=0
SKIP_PACK_DRYRUN=0
REPORT_PATH=""

VERIFY_PACKAGES_PASSED=0
LAUNCHER_LOOKUP_PASSED=0
RUNTIME_TOOL_DESCRIBE_PASSED=0
PACK_DRYRUN_PASSED=0
PACK_DRYRUN_SKIPPED=0
RUNTIME_TOOL_DESCRIBE_REPORT_PATH=""
PACK_LOG=""

EXIT_CODE=0
FAIL_REASON=""

json_bool() {
  if [ "$1" -eq 1 ]; then
    echo "true"
  else
    echo "false"
  fi
}

cleanup() {
  if [ -n "$RUNTIME_TOOL_DESCRIBE_REPORT_PATH" ]; then
    rm -f "$RUNTIME_TOOL_DESCRIBE_REPORT_PATH"
  fi
  if [ -n "$PACK_LOG" ]; then
    rm -f "$PACK_LOG"
  fi
}

trap cleanup EXIT

emit_report() {
  if [ -z "$REPORT_PATH" ]; then
    return 0
  fi
  mkdir -p "$(dirname "$REPORT_PATH")"
  node - \
    "$REPORT_PATH" \
    "$EXIT_CODE" \
    "$FAIL_REASON" \
    "$ALLOW_STUB" \
    "$SKIP_PACK_DRYRUN" \
    "$(json_bool "$VERIFY_PACKAGES_PASSED")" \
    "$(json_bool "$LAUNCHER_LOOKUP_PASSED")" \
    "$(json_bool "$RUNTIME_TOOL_DESCRIBE_PASSED")" \
    "$(json_bool "$PACK_DRYRUN_PASSED")" \
    "$(json_bool "$PACK_DRYRUN_SKIPPED")" \
    "$RUNTIME_TOOL_DESCRIBE_REPORT_PATH" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const reportPath = process.argv[2] ?? "";
const exitCode = Number.parseInt(process.argv[3] ?? "1", 10);
const failReason = process.argv[4] ?? "";
const allowStub = (process.argv[5] ?? "0") === "1";
const skipPack = (process.argv[6] ?? "0") === "1";
const verifyPassed = (process.argv[7] ?? "false") === "true";
const launcherPassed = (process.argv[8] ?? "false") === "true";
const runtimeToolDescribePassed = (process.argv[9] ?? "false") === "true";
const packPassed = (process.argv[10] ?? "false") === "true";
const packSkipped = (process.argv[11] ?? "false") === "true";
const runtimeToolDescribeReportPath = process.argv[12] ?? "";
const runtimeToolQualitySchemaVersion = 1;
const runtimeToolQualityFailureReasonCatalog = Object.freeze([
  "report_parse_error",
  "runtime_tool_describe_failed",
  "diagnostics_self_test_failed",
  "runtime_binary_missing",
  "contract_coverage_incomplete",
  "runner_contract_coverage_missing",
  "tmp_fixture_isolation_missing",
  "schema_budget_unknown",
  "schema_budget_violated",
]);
const runtimeToolQualityActionFamilyCatalog = Object.freeze([
  "none",
  "diagnostics",
  "runtime_environment",
  "runner_contract",
  "contract_harness",
  "schema_budget",
]);

function pushRuntimeToolQualityFailureReason(reasons, reason) {
  if (!runtimeToolQualityFailureReasonCatalog.includes(reason)) {
    throw new Error(`unknown runtime_tool_quality failure reason: ${String(reason)}`);
  }
  reasons.push(reason);
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function runtimeToolDescribeData() {
  if (!runtimeToolDescribeReportPath || !fs.existsSync(runtimeToolDescribeReportPath)) {
    return {
      report: null,
      governance_payload: null,
      ownership_payload: null,
      report_parse_error: null,
    };
  }
  try {
    const report = JSON.parse(fs.readFileSync(runtimeToolDescribeReportPath, "utf8"));
    const resultPayload = (id) => {
      const item = Array.isArray(report.results)
        ? report.results.find((row) => row && row.id === id)
        : null;
      return typeof item?.output === "string" ? parseJson(item.output) : null;
    };
    return {
      report,
      governance_payload: resultPayload("runtime-tool-governance"),
      ownership_payload: resultPayload("runtime-tool-suite-ownership"),
      report_parse_error: null,
    };
  } catch (error) {
    return {
      report: null,
      governance_payload: null,
      ownership_payload: null,
      report_parse_error: error instanceof Error ? error.message : String(error),
    };
  }
}

function runtimeToolDescribeSummary(data) {
  const summary = { passed: runtimeToolDescribePassed };
  if (data.report_parse_error) {
    return {
      ...summary,
      report_parse_error: data.report_parse_error,
    };
  }
  if (!data.report) {
    return summary;
  }
  const report = data.report;
  const governancePayload = data.governance_payload;
    return {
      ...summary,
      ok: report.ok === true,
      runner_schema_version: Number.isFinite(report.schema_version) ? report.schema_version : null,
      contract_count: Number.isFinite(report.contract_count) ? report.contract_count : null,
      completed_count: Number.isFinite(report.completed_count) ? report.completed_count : null,
      include_runtime_describe: report.include_runtime_describe === true,
      diagnostics_self_test: report.diagnostics_self_test === true,
      failed_contract: typeof report.failed_contract === "string" ? report.failed_contract : null,
      failed_contract_detail: report.failed_contract_detail
        && typeof report.failed_contract_detail === "object"
        ? report.failed_contract_detail
        : null,
      runtime_binary: report.runtime_binary && typeof report.runtime_binary === "object"
        ? report.runtime_binary
        : null,
      diagnostic_summary: report.diagnostic_summary && typeof report.diagnostic_summary === "object"
        ? report.diagnostic_summary
        : null,
      runtime_recovery_catalog_rows: Number.isFinite(governancePayload?.runtime_recovery_catalog_rows)
        ? governancePayload.runtime_recovery_catalog_rows
        : null,
      runtime_schema_profile_count: Number.isFinite(governancePayload?.runtime_schema_profile_count)
        ? governancePayload.runtime_schema_profile_count
        : null,
      runtime_schema_budget_violations: Number.isFinite(governancePayload?.runtime_schema_budget_violations)
        ? governancePayload.runtime_schema_budget_violations
        : null,
      gateway_only_recovery_actions: Array.isArray(governancePayload?.gateway_only_recovery_actions)
        ? governancePayload.gateway_only_recovery_actions
        : [],
    };
}

function runtimeToolQualitySummary(describeSummary, data) {
  const diagnosticSummary = describeSummary.diagnostic_summary && typeof describeSummary.diagnostic_summary === "object"
    ? describeSummary.diagnostic_summary
    : null;
  const ownershipPayload = data.ownership_payload && typeof data.ownership_payload === "object"
    ? data.ownership_payload
    : null;
  const schemaBudgetViolations = Number.isFinite(describeSummary.runtime_schema_budget_violations)
    ? describeSummary.runtime_schema_budget_violations
    : Number.isFinite(diagnosticSummary?.schema_budget_violations)
      ? diagnosticSummary.schema_budget_violations
      : null;
  const contractCoverageComplete = Number.isFinite(describeSummary.contract_count)
    && Number.isFinite(describeSummary.completed_count)
    && describeSummary.contract_count === describeSummary.completed_count;
  const runnerContractCoverage = typeof ownershipPayload?.runner_covers_all_runtime_tool_contracts === "boolean"
    ? ownershipPayload.runner_covers_all_runtime_tool_contracts
    : null;
  const tmpFixtureIsolation = typeof ownershipPayload?.all_contract_tmp_fixtures_isolated === "boolean"
    ? ownershipPayload.all_contract_tmp_fixtures_isolated
    : null;
  const runtimeBinaryExists = typeof describeSummary.runtime_binary?.exists === "boolean"
    ? describeSummary.runtime_binary.exists
    : null;
  const failureReasons = [];
  if (describeSummary.report_parse_error) {
    pushRuntimeToolQualityFailureReason(failureReasons, "report_parse_error");
  }
  if (describeSummary.passed !== true || describeSummary.ok !== true) {
    pushRuntimeToolQualityFailureReason(failureReasons, "runtime_tool_describe_failed");
  }
  if (describeSummary.diagnostics_self_test !== true) {
    pushRuntimeToolQualityFailureReason(failureReasons, "diagnostics_self_test_failed");
  }
  if (runtimeBinaryExists !== true) {
    pushRuntimeToolQualityFailureReason(failureReasons, "runtime_binary_missing");
  }
  if (!contractCoverageComplete) {
    pushRuntimeToolQualityFailureReason(failureReasons, "contract_coverage_incomplete");
  }
  if (runnerContractCoverage !== true) {
    pushRuntimeToolQualityFailureReason(failureReasons, "runner_contract_coverage_missing");
  }
  if (tmpFixtureIsolation !== true) {
    pushRuntimeToolQualityFailureReason(failureReasons, "tmp_fixture_isolation_missing");
  }
  if (schemaBudgetViolations === null) {
    pushRuntimeToolQualityFailureReason(failureReasons, "schema_budget_unknown");
  } else if (schemaBudgetViolations !== 0) {
    pushRuntimeToolQualityFailureReason(failureReasons, "schema_budget_violated");
  }
  const status = failureReasons.length > 0 ? "fail" : "ok";
  const schemaBudgetStatus = schemaBudgetViolations === null
    ? "unknown"
    : schemaBudgetViolations === 0
      ? "passed"
      : "failed";
  const actionSignals = [
    ["report_parse_error", "diagnostics"],
    ["diagnostics_self_test_failed", "diagnostics"],
    ["runtime_binary_missing", "runtime_environment"],
    ["runtime_tool_describe_failed", "runner_contract"],
    ["contract_coverage_incomplete", "runner_contract"],
    ["runner_contract_coverage_missing", "runner_contract"],
    ["tmp_fixture_isolation_missing", "contract_harness"],
    ["schema_budget_unknown", "schema_budget"],
    ["schema_budget_violated", "schema_budget"],
  ];
  const actionSignal = actionSignals.find(([reason]) => failureReasons.includes(reason)) ?? null;
  if (actionSignal && !runtimeToolQualityActionFamilyCatalog.includes(actionSignal[1])) {
    throw new Error(`unknown runtime_tool_quality action family: ${String(actionSignal[1])}`);
  }
  return {
    quality_schema_version: runtimeToolQualitySchemaVersion,
    status,
    passed: status === "ok",
    source: "runtime_tool_describe",
    failure_reasons: failureReasons,
    warning_reasons: [],
    runner_schema_version: describeSummary.runner_schema_version ?? null,
    diagnostic_summary_status: diagnosticSummary?.status ?? null,
    diagnostics_self_test: describeSummary.diagnostics_self_test === true,
    contract_count: describeSummary.contract_count ?? null,
    completed_count: describeSummary.completed_count ?? null,
    contract_coverage_complete: contractCoverageComplete,
    runner_contract_coverage: runnerContractCoverage,
    tmp_fixture_isolation: tmpFixtureIsolation,
    schema_budget_status: schemaBudgetStatus,
    schema_budget_violations: schemaBudgetViolations,
    runtime_binary_exists: runtimeBinaryExists,
    gateway_only_recovery_actions: Array.isArray(describeSummary.gateway_only_recovery_actions)
      ? describeSummary.gateway_only_recovery_actions
      : [],
    failed_contract: describeSummary.failed_contract ?? null,
    action_family: actionSignal ? actionSignal[1] : "none",
    action_reason: actionSignal ? actionSignal[0] : null,
    actionable_next_step: typeof describeSummary.failed_contract_detail?.suggested_command === "string"
      ? describeSummary.failed_contract_detail.suggested_command
      : typeof diagnosticSummary?.reproduce === "string"
        ? diagnosticSummary.reproduce
        : null,
    report_parse_error: describeSummary.report_parse_error ?? null,
  };
}

const runtimeToolData = runtimeToolDescribeData();
const runtimeToolDescribe = runtimeToolDescribeSummary(runtimeToolData);
const runtimeToolQuality = runtimeToolQualitySummary(runtimeToolDescribe, runtimeToolData);

const payload = {
  schema_version: 1,
  generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  overall_passed: exitCode === 0,
  exit_code: exitCode,
  fail_reason: failReason,
  options: {
    allow_stub: allowStub,
    skip_pack_dryrun: skipPack,
  },
  checks: {
    verify_packages: { passed: verifyPassed },
    launcher_lookup_chain: { passed: launcherPassed },
    runtime_tool_describe: runtimeToolDescribe,
    runtime_tool_quality: runtimeToolQuality,
    pack_dryrun: { passed: packPassed, skipped: packSkipped },
  },
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
NODE
}

fail_exit() {
  local code="$1"
  local reason="$2"
  EXIT_CODE="$code"
  FAIL_REASON="$reason"
  emit_report
  exit "$code"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --allow-stub)
      ALLOW_STUB=1
      shift
      ;;
    --skip-pack-dryrun)
      SKIP_PACK_DRYRUN=1
      shift
      ;;
    --report)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --report" >&2
        exit 1
      fi
      REPORT_PATH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

VERIFY_ARGS=()
if [ "$ALLOW_STUB" -eq 1 ]; then
  VERIFY_ARGS+=(--allow-stub)
fi

echo "[gate] verify platform core packages"
if [ "${#VERIFY_ARGS[@]}" -gt 0 ]; then
  if ! bash scripts/core-verify-packages.sh "${VERIFY_ARGS[@]}"; then
    fail_exit 3 "verify_packages_failed"
  fi
else
  if ! bash scripts/core-verify-packages.sh; then
    fail_exit 3 "verify_packages_failed"
  fi
fi
VERIFY_PACKAGES_PASSED=1

echo "[gate] verify launcher uses new core lookup chain"
if ! LC_ALL=C grep -F "core/current/grobot-core" packages/cli/bin/grobot >/dev/null 2>&1; then
  fail_exit 4 "launcher_lookup_chain_missing"
fi
LAUNCHER_LOOKUP_PASSED=1

if ! command -v cargo >/dev/null 2>&1; then
  fail_exit 8 "cargo_missing_for_runtime_tool_describe"
fi
if ! command -v node >/dev/null 2>&1; then
  fail_exit 8 "node_missing_for_runtime_tool_describe"
fi
if ! command -v npx >/dev/null 2>&1; then
  fail_exit 8 "npx_missing_for_runtime_tool_describe"
fi

echo "[gate] runtime tools describe compatibility"
RUNTIME_TOOL_DESCRIBE_REPORT_PATH="$(mktemp)"
if ! cargo build --manifest-path runtime/Cargo.toml; then
  fail_exit 8 "runtime_tool_describe_failed"
fi
if ! node scripts/check-runtime-tool-contracts.mjs --include-runtime-describe --json >"$RUNTIME_TOOL_DESCRIBE_REPORT_PATH"; then
  if [ -s "$RUNTIME_TOOL_DESCRIBE_REPORT_PATH" ]; then
    cat "$RUNTIME_TOOL_DESCRIBE_REPORT_PATH" >&2
  fi
  fail_exit 8 "runtime_tool_describe_failed"
fi
if ! node - "$RUNTIME_TOOL_DESCRIBE_REPORT_PATH" <<'NODE'
const fs = require("node:fs");
const reportPath = process.argv[2] ?? "";
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const governance = Array.isArray(report.results)
  ? report.results.find((item) => item && item.id === "runtime-tool-governance")
  : null;
let governancePayload = {};
try {
  governancePayload = typeof governance?.output === "string" ? JSON.parse(governance.output) : {};
} catch {
  governancePayload = {};
}
process.stdout.write(
  `[gate] runtime tools describe passed contracts=${report.completed_count}/${report.contract_count}`
    + ` schema_budget_violations=${governancePayload.runtime_schema_budget_violations ?? "unknown"}`
    + ` gateway_only_actions=${JSON.stringify(governancePayload.gateway_only_recovery_actions ?? [])}\n`,
);
NODE
then
  fail_exit 8 "runtime_tool_describe_report_invalid"
fi
RUNTIME_TOOL_DESCRIBE_PASSED=1

if [ "$SKIP_PACK_DRYRUN" -eq 0 ]; then
  PACK_LOG="$(mktemp)"

  echo "[gate] npm pack --dry-run"
  npm pack --dry-run >"$PACK_LOG" 2>&1

  if ! LC_ALL=C grep -F "grobot" "$PACK_LOG" >/dev/null 2>&1; then
    fail_exit 6 "pack_dryrun_missing_grobot_entry"
  fi
  if ! LC_ALL=C grep -F "packages/cli/bin/grobot" "$PACK_LOG" >/dev/null 2>&1; then
    fail_exit 7 "pack_dryrun_missing_cli_entry"
  fi
  PACK_DRYRUN_PASSED=1
else
  PACK_DRYRUN_SKIPPED=1
fi

EXIT_CODE=0
FAIL_REASON=""
emit_report
echo "core release gate passed."
