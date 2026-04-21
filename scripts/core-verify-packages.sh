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
  "core-windows-x64"
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
  node - "$TOTAL" "$OK_COUNT" "$MISS_COUNT" "$STUB_COUNT" "$ALLOW_STUB" "${SUMMARY_LINES[@]}" <<'NODE'
const total = Number.parseInt(process.argv[2] ?? "0", 10);
const okCount = Number.parseInt(process.argv[3] ?? "0", 10);
const missCount = Number.parseInt(process.argv[4] ?? "0", 10);
const stubCount = Number.parseInt(process.argv[5] ?? "0", 10);
const allowStub = (process.argv[6] ?? "0") === "1";
const items = [];
for (const raw of process.argv.slice(7)) {
  const [pkg = "", status = "", reason = "", itemPath = ""] = String(raw).split("|", 4);
  items.push({
    package: pkg,
    status,
    reason,
    path: itemPath,
  });
}
const payload = {
  total,
  ok_count: okCount,
  missing_or_invalid_count: missCount,
  stub_count: stubCount,
  allow_stub: allowStub,
  items,
};
process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
NODE
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
