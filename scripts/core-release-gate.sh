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
  node scripts/lib/runtime-tool-quality-report.mjs \
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
    "$RUNTIME_TOOL_DESCRIBE_REPORT_PATH"
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
    + ` tool_count=${governancePayload.runtime_tool_count ?? "unknown"}`
    + ` default_enabled=${governancePayload.runtime_default_enabled_count ?? "unknown"}`
    + ` manifest=${governancePayload.runtime_tool_manifest_fingerprint ?? "unknown"}`
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
