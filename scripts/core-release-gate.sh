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

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function runtimeToolDescribeSummary() {
  const summary = { passed: runtimeToolDescribePassed };
  if (!runtimeToolDescribeReportPath || !fs.existsSync(runtimeToolDescribeReportPath)) {
    return summary;
  }
  try {
    const report = JSON.parse(fs.readFileSync(runtimeToolDescribeReportPath, "utf8"));
    const governance = Array.isArray(report.results)
      ? report.results.find((item) => item && item.id === "runtime-tool-governance")
      : null;
    const governancePayload = typeof governance?.output === "string"
      ? parseJson(governance.output)
      : null;
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
  } catch (error) {
    return {
      ...summary,
      report_parse_error: error instanceof Error ? error.message : String(error),
    };
  }
}

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
    runtime_tool_describe: runtimeToolDescribeSummary(),
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
node - "$RUNTIME_TOOL_DESCRIBE_REPORT_PATH" <<'NODE'
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
