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

EXIT_CODE=0
FAIL_REASON=""

json_bool() {
  if [ "$1" -eq 1 ]; then
    echo "true"
  else
    echo "false"
  fi
}

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
    "$(json_bool "$PACK_DRYRUN_SKIPPED")" <<'NODE'
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
    runtime_tool_describe: { passed: runtimeToolDescribePassed },
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

if ! command -v npm >/dev/null 2>&1; then
  fail_exit 5 "npm_missing_for_runtime_tool_describe"
fi

echo "[gate] runtime tools describe compatibility"
if ! npm run check:gateway:runtime-tools:describe; then
  fail_exit 8 "runtime_tool_describe_failed"
fi
RUNTIME_TOOL_DESCRIBE_PASSED=1

if [ "$SKIP_PACK_DRYRUN" -eq 0 ]; then
  PACK_LOG="$(mktemp)"
  cleanup() {
    rm -f "$PACK_LOG"
  }
  trap cleanup EXIT

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
