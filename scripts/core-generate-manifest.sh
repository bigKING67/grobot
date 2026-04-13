#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/core-generate-manifest.sh --artifacts-dir <dir> [options]

Options:
  --artifacts-dir <dir>  Directory containing platform binaries (required)
  --output <file>        Output manifest path (default: <artifacts-dir>/core-artifacts.manifest.json)
  --allow-stub           Allow placeholder stub binaries (dev only)
  -h, --help             Show help
EOF
}

ARTIFACTS_DIR=""
OUTPUT_PATH=""
ALLOW_STUB=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --artifacts-dir)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --artifacts-dir" >&2
        exit 1
      fi
      ARTIFACTS_DIR="$2"
      shift 2
      ;;
    --output)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --output" >&2
        exit 1
      fi
      OUTPUT_PATH="$2"
      shift 2
      ;;
    --allow-stub)
      ALLOW_STUB=1
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

if [ -z "$ARTIFACTS_DIR" ]; then
  echo "--artifacts-dir is required" >&2
  usage
  exit 1
fi

if [ ! -d "$ARTIFACTS_DIR" ]; then
  echo "artifacts directory not found: $ARTIFACTS_DIR" >&2
  exit 1
fi

if [ -z "$OUTPUT_PATH" ]; then
  OUTPUT_PATH="$ARTIFACTS_DIR/core-artifacts.manifest.json"
fi

sha256_file() {
  local file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    echo "missing shasum/sha256sum for checksum calculation" >&2
    exit 1
  fi
}

PLATFORMS=(
  "darwin-arm64"
  "darwin-x64"
  "linux-x64"
  "linux-arm64"
)

declare -a PY_ARGS
PY_ARGS=()

for platform in "${PLATFORMS[@]}"; do
  artifact_path="$ARTIFACTS_DIR/grobot-core-$platform"
  if [ ! -f "$artifact_path" ]; then
    echo "missing artifact: $artifact_path" >&2
    exit 1
  fi
  if [ ! -x "$artifact_path" ]; then
    echo "artifact is not executable: $artifact_path" >&2
    exit 1
  fi
  if [ "$ALLOW_STUB" -eq 0 ] && LC_ALL=C grep -a -F "is not bundled in source checkout" "$artifact_path" >/dev/null 2>&1; then
    echo "refusing to include placeholder stub in manifest: $artifact_path" >&2
    echo "hint: use --allow-stub only for local pipeline testing." >&2
    exit 1
  fi

  checksum="$(sha256_file "$artifact_path")"
  size_bytes="$(wc -c < "$artifact_path" | awk '{print $1}')"
  PY_ARGS+=("$platform|$(basename "$artifact_path")|$checksum|$size_bytes")
done

mkdir -p "$(dirname "$OUTPUT_PATH")"

node - "$OUTPUT_PATH" "${PY_ARGS[@]}" <<'NODE'
const fs = require("node:fs");

const outputPath = process.argv[2] ?? "";
const items = {};
for (const raw of process.argv.slice(3)) {
  const [platform = "", fileName = "", sha256 = "", sizeRaw = "0"] = String(raw).split("|", 4);
  if (!platform) {
    continue;
  }
  const sizeBytes = Number.parseInt(sizeRaw, 10);
  items[platform] = {
    file: fileName,
    sha256,
    size_bytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
  };
}
const payload = {
  schema_version: 1,
  generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  artifacts: items,
};
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
NODE

echo "core artifact manifest generated."
echo "  artifacts_dir: $ARTIFACTS_DIR"
echo "  output:        $OUTPUT_PATH"
