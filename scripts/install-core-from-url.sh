#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/install-core-from-url.sh --url <https-url> --sha256 <hex> [options]

Options:
  --url <url>           Download URL for grobot-core binary (required)
  --sha256 <hex>        Expected SHA256 checksum (required)
  --platform <name>     Target platform key (forwarded)
  --core-dir <dir>      Core install root (forwarded)
  --no-current          Do not update ~/.grobot/core/current symlink
  --allow-stub          Allow installing placeholder stub binaries
  -h, --help            Show help
EOF
}

DOWNLOAD_URL=""
EXPECTED_SHA256=""
PLATFORM_KEY=""
CORE_DIR=""
NO_CURRENT=0
ALLOW_STUB=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --url)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --url" >&2
        exit 1
      fi
      DOWNLOAD_URL="$2"
      shift 2
      ;;
    --sha256)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --sha256" >&2
        exit 1
      fi
      EXPECTED_SHA256="$2"
      shift 2
      ;;
    --platform)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --platform" >&2
        exit 1
      fi
      PLATFORM_KEY="$2"
      shift 2
      ;;
    --core-dir)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --core-dir" >&2
        exit 1
      fi
      CORE_DIR="$2"
      shift 2
      ;;
    --no-current)
      NO_CURRENT=1
      shift
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

if [ -z "$DOWNLOAD_URL" ]; then
  echo "--url is required" >&2
  usage
  exit 1
fi

if [ -z "$EXPECTED_SHA256" ]; then
  echo "--sha256 is required" >&2
  usage
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required but not found in PATH." >&2
  exit 1
fi

EXPECTED_SHA256="$(printf '%s' "$EXPECTED_SHA256" | tr '[:upper:]' '[:lower:]')"
if ! printf '%s' "$EXPECTED_SHA256" | LC_ALL=C grep -E '^[0-9a-f]{64}$' >/dev/null 2>&1; then
  echo "invalid --sha256 format: expected 64 hex chars" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
TMP_BIN="$TMP_DIR/grobot-core.download"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "downloading core binary..."
echo "  url: $DOWNLOAD_URL"
curl -fsSL "$DOWNLOAD_URL" -o "$TMP_BIN"
chmod +x "$TMP_BIN"

ACTUAL_SHA256=""
if command -v shasum >/dev/null 2>&1; then
  ACTUAL_SHA256="$(shasum -a 256 "$TMP_BIN" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA256="$(sha256sum "$TMP_BIN" | awk '{print $1}')"
else
  echo "neither shasum nor sha256sum is available for checksum verification." >&2
  exit 1
fi

if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
  echo "sha256 mismatch." >&2
  echo "  expected: $EXPECTED_SHA256" >&2
  echo "  actual:   $ACTUAL_SHA256" >&2
  exit 1
fi

echo "checksum verified."
echo "  sha256: $ACTUAL_SHA256"

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_ARGS=(--binary "$TMP_BIN")
if [ -n "$PLATFORM_KEY" ]; then
  INSTALL_ARGS+=(--platform "$PLATFORM_KEY")
fi
if [ -n "$CORE_DIR" ]; then
  INSTALL_ARGS+=(--core-dir "$CORE_DIR")
fi
if [ "$NO_CURRENT" -eq 1 ]; then
  INSTALL_ARGS+=(--no-current)
fi
if [ "$ALLOW_STUB" -eq 1 ]; then
  INSTALL_ARGS+=(--allow-stub)
fi

bash "$SCRIPT_DIR/install-core-binary.sh" "${INSTALL_ARGS[@]}"
