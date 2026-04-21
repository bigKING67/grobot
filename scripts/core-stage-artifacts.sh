#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/core-stage-artifacts.sh --artifacts-dir <dir> [options]

Options:
  --artifacts-dir <dir>  Directory containing platform binaries (required)
  --manifest <file>      Manifest path (default: <artifacts-dir>/core-artifacts.manifest.json if exists)
  --allow-stub           Allow placeholder stub binaries (dev only)
  --dry-run              Validate only, do not copy files
  -h, --help             Show help
EOF
}

ARTIFACTS_DIR=""
MANIFEST_PATH=""
ALLOW_STUB=0
DRY_RUN=0

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
    --manifest)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --manifest" >&2
        exit 1
      fi
      MANIFEST_PATH="$2"
      shift 2
      ;;
    --allow-stub)
      ALLOW_STUB=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
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

if [ -z "$MANIFEST_PATH" ] && [ -f "$ARTIFACTS_DIR/core-artifacts.manifest.json" ]; then
  MANIFEST_PATH="$ARTIFACTS_DIR/core-artifacts.manifest.json"
fi

if [ -n "$MANIFEST_PATH" ] && [ ! -f "$MANIFEST_PATH" ]; then
  echo "manifest file not found: $MANIFEST_PATH" >&2
  exit 1
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

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PLATFORMS=(
  "darwin-arm64|core-darwin-arm64"
  "darwin-x64|core-darwin-x64"
  "linux-x64|core-linux-x64"
  "linux-arm64|core-linux-arm64"
  "windows-x64|core-windows-x64"
)

asset_file_for_platform() {
  local platform="$1"
  case "$platform" in
    windows-x64) echo "grobot-core-windows-x64.exe" ;;
    *) echo "grobot-core-$platform" ;;
  esac
}

load_manifest_expected_sha() {
  local manifest="$1"
  local platform="$2"
  node - "$manifest" "$platform" <<'NODE'
const fs = require("node:fs");

const manifestPath = process.argv[2] ?? "";
const platform = process.argv[3] ?? "";
let value = "";
try {
  const raw = fs.readFileSync(manifestPath, "utf8");
  const parsed = JSON.parse(raw);
  if (parsed && typeof parsed === "object") {
    const artifacts = parsed.artifacts;
    if (artifacts && typeof artifacts === "object") {
      const artifact = artifacts[platform];
      if (artifact && typeof artifact === "object" && typeof artifact.sha256 === "string") {
        value = artifact.sha256;
      }
    }
  }
} catch {
  value = "";
}
process.stdout.write(value);
NODE
}

echo "staging core artifacts..."
echo "  artifacts_dir: $ARTIFACTS_DIR"
if [ -n "$MANIFEST_PATH" ]; then
  echo "  manifest:      $MANIFEST_PATH"
else
  echo "  manifest:      <none>"
fi
if [ "$DRY_RUN" -eq 1 ]; then
  echo "  mode:          dry-run"
fi

for pair in "${PLATFORMS[@]}"; do
  platform="${pair%%|*}"
  package_name="${pair##*|}"
  artifact_file="$(asset_file_for_platform "$platform")"
  artifact_path="$ARTIFACTS_DIR/$artifact_file"
  target_path="$REPO_ROOT/packages/$package_name/bin/grobot-core"

  if [ ! -f "$artifact_path" ]; then
    echo "missing artifact: $artifact_path" >&2
    exit 1
  fi
  if [ ! -x "$artifact_path" ]; then
    echo "artifact is not executable: $artifact_path" >&2
    exit 1
  fi
  if [ "$ALLOW_STUB" -eq 0 ] && LC_ALL=C grep -a -F "is not bundled in source checkout" "$artifact_path" >/dev/null 2>&1; then
    echo "refusing to stage placeholder stub: $artifact_path" >&2
    echo "hint: use --allow-stub only for local pipeline testing." >&2
    exit 1
  fi

  actual_sha="$(sha256_file "$artifact_path")"
  if [ -n "$MANIFEST_PATH" ]; then
    expected_sha="$(load_manifest_expected_sha "$MANIFEST_PATH" "$platform")"
    if [ -z "$expected_sha" ]; then
      echo "manifest missing sha256 for platform: $platform" >&2
      exit 1
    fi
    expected_sha="$(printf '%s' "$expected_sha" | tr '[:upper:]' '[:lower:]')"
    if [ "$actual_sha" != "$expected_sha" ]; then
      echo "sha256 mismatch for $platform" >&2
      echo "  expected: $expected_sha" >&2
      echo "  actual:   $actual_sha" >&2
      exit 1
    fi
  fi

  echo "  [ok] $platform sha256=$actual_sha"
  if [ "$DRY_RUN" -eq 1 ]; then
    continue
  fi

  mkdir -p "$(dirname "$target_path")"
  tmp_target="${target_path}.tmp.$$"
  cp "$artifact_path" "$tmp_target"
  chmod +x "$tmp_target"
  mv -f "$tmp_target" "$target_path"
done

if [ "$DRY_RUN" -eq 1 ]; then
  echo "dry-run completed."
else
  echo "core artifacts staged to packages/core-*/bin/grobot-core"
fi
