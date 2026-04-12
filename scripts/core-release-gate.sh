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
  python3 - <<'PY' \
    "$REPORT_PATH" \
    "$EXIT_CODE" \
    "$FAIL_REASON" \
    "$ALLOW_STUB" \
    "$SKIP_PACK_DRYRUN" \
    "$(json_bool "$VERIFY_PACKAGES_PASSED")" \
    "$(json_bool "$LAUNCHER_LOOKUP_PASSED")" \
    "$(json_bool "$PACK_DRYRUN_PASSED")" \
    "$(json_bool "$PACK_DRYRUN_SKIPPED")"
import json
import sys
from datetime import datetime, timezone

report_path = sys.argv[1]
exit_code = int(sys.argv[2])
fail_reason = sys.argv[3]
allow_stub = bool(int(sys.argv[4]))
skip_pack = bool(int(sys.argv[5]))
verify_passed = sys.argv[6] == "true"
launcher_passed = sys.argv[7] == "true"
pack_passed = sys.argv[8] == "true"
pack_skipped = sys.argv[9] == "true"

payload = {
    "schema_version": 1,
    "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    "overall_passed": exit_code == 0,
    "exit_code": exit_code,
    "fail_reason": fail_reason,
    "options": {
        "allow_stub": allow_stub,
        "skip_pack_dryrun": skip_pack,
    },
    "checks": {
        "verify_packages": {"passed": verify_passed},
        "launcher_lookup_chain": {"passed": launcher_passed},
        "pack_dryrun": {"passed": pack_passed, "skipped": pack_skipped},
    },
}

with open(report_path, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY
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

if [ "$SKIP_PACK_DRYRUN" -eq 0 ]; then
  if ! command -v npm >/dev/null 2>&1; then
    fail_exit 5 "npm_missing_for_pack_dryrun"
  fi
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
