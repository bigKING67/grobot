#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/core-verify-packages.sh [options]

Options:
  --allow-stub   Allow placeholder stub binaries (default: fail if stub found)
  --json         Emit machine-readable JSON summary
  -h, --help     Show help
EOF
}

ALLOW_STUB=0
OUTPUT_JSON=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --allow-stub)
      ALLOW_STUB=1
      shift
      ;;
    --json)
      OUTPUT_JSON=1
      shift
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

PACKAGES=(
  "core-darwin-arm64"
  "core-darwin-x64"
  "core-linux-x64"
  "core-linux-arm64"
)

STUB_MARKER="is not bundled in source checkout"
TOTAL="${#PACKAGES[@]}"
OK_COUNT=0
MISS_COUNT=0
STUB_COUNT=0

SUMMARY_LINES=()

for pkg in "${PACKAGES[@]}"; do
  bin_path="$REPO_ROOT/packages/${pkg}/bin/grobot-core"
  status="ok"
  reason=""

  if [ ! -f "$bin_path" ]; then
    status="missing"
    reason="file_not_found"
    MISS_COUNT=$((MISS_COUNT + 1))
  elif [ ! -x "$bin_path" ]; then
    status="invalid"
    reason="not_executable"
    MISS_COUNT=$((MISS_COUNT + 1))
  elif LC_ALL=C grep -a -F "$STUB_MARKER" "$bin_path" >/dev/null 2>&1; then
    status="stub"
    reason="placeholder_detected"
    STUB_COUNT=$((STUB_COUNT + 1))
    if [ "$ALLOW_STUB" -eq 1 ]; then
      OK_COUNT=$((OK_COUNT + 1))
    fi
  else
    OK_COUNT=$((OK_COUNT + 1))
  fi

  SUMMARY_LINES+=("${pkg}|${status}|${reason}|${bin_path}")
done

if [ "$OUTPUT_JSON" -eq 1 ]; then
  python3 - <<'PY' "$TOTAL" "$OK_COUNT" "$MISS_COUNT" "$STUB_COUNT" "$ALLOW_STUB" "${SUMMARY_LINES[@]}"
import json
import sys

total = int(sys.argv[1])
ok_count = int(sys.argv[2])
miss_count = int(sys.argv[3])
stub_count = int(sys.argv[4])
allow_stub = bool(int(sys.argv[5]))
items = []
for raw in sys.argv[6:]:
    pkg, status, reason, path = raw.split("|", 3)
    items.append(
        {
            "package": pkg,
            "status": status,
            "reason": reason,
            "path": path,
        }
    )

payload = {
    "total": total,
    "ok_count": ok_count,
    "missing_or_invalid_count": miss_count,
    "stub_count": stub_count,
    "allow_stub": allow_stub,
    "items": items,
}
print(json.dumps(payload, ensure_ascii=False, indent=2))
PY
else
  echo "core package verify"
  for line in "${SUMMARY_LINES[@]}"; do
    pkg="${line%%|*}"
    rest="${line#*|}"
    status="${rest%%|*}"
    rest="${rest#*|}"
    reason="${rest%%|*}"
    path="${rest#*|}"
    if [ "$status" = "ok" ]; then
      echo "  [ok]   $pkg -> $path"
    elif [ "$status" = "stub" ]; then
      echo "  [stub] $pkg -> $path ($reason)"
    else
      echo "  [fail] $pkg -> $path ($reason)"
    fi
  done
  echo "summary: total=$TOTAL ok=$OK_COUNT missing_or_invalid=$MISS_COUNT stub=$STUB_COUNT allow_stub=$ALLOW_STUB"
fi

if [ "$MISS_COUNT" -gt 0 ]; then
  exit 2
fi

if [ "$STUB_COUNT" -gt 0 ] && [ "$ALLOW_STUB" -ne 1 ]; then
  exit 3
fi
