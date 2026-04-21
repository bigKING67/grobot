#!/usr/bin/env bash
set -euo pipefail

detect_platform_key() {
  local os arch
  os="$(uname -s 2>/dev/null || echo unknown)"
  arch="$(uname -m 2>/dev/null || echo unknown)"
  case "${os}:${arch}" in
    Darwin:arm64) echo "darwin-arm64" ;;
    Darwin:x86_64) echo "darwin-x64" ;;
    Linux:x86_64) echo "linux-x64" ;;
    Linux:aarch64|Linux:arm64) echo "linux-arm64" ;;
    MINGW*:x86_64|MSYS*:x86_64|CYGWIN*:x86_64) echo "windows-x64" ;;
    *) echo "" ;;
  esac
}

usage() {
  cat <<'EOF'
Usage: bash scripts/install-core-binary.sh --binary <path> [options]

Options:
  --binary <path>       Path to grobot-core binary to install (required)
  --platform <name>     Target platform key (default: auto-detect)
                        Supported: darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64
  --core-dir <dir>      Core install root (default: ~/.grobot/core)
  --no-current          Do not update ~/.grobot/core/current symlink
  --allow-stub          Allow installing placeholder stub binaries
  -h, --help            Show help
EOF
}

GROBOT_HOME_DIR="${GROBOT_HOME:-${HOME}/.grobot}"
CORE_DIR="${GROBOT_HOME_DIR}/core"
PLATFORM_KEY="$(detect_platform_key)"
SOURCE_BIN=""
UPDATE_CURRENT=1
ALLOW_STUB=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --binary)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --binary" >&2
        exit 1
      fi
      SOURCE_BIN="$2"
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
      UPDATE_CURRENT=0
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

if [ -z "$SOURCE_BIN" ]; then
  echo "--binary is required" >&2
  usage
  exit 1
fi

if [ -z "$PLATFORM_KEY" ]; then
  echo "unable to detect platform automatically; please pass --platform" >&2
  exit 1
fi

case "$PLATFORM_KEY" in
  darwin-arm64|darwin-x64|linux-x64|linux-arm64|windows-x64) ;;
  *)
    echo "unsupported --platform value: $PLATFORM_KEY" >&2
    exit 1
    ;;
esac

if [ ! -f "$SOURCE_BIN" ]; then
  echo "binary not found: $SOURCE_BIN" >&2
  exit 1
fi

if [ ! -x "$SOURCE_BIN" ]; then
  echo "binary is not executable: $SOURCE_BIN" >&2
  echo "hint: chmod +x \"$SOURCE_BIN\"" >&2
  exit 1
fi

if [ "$ALLOW_STUB" -eq 0 ] && LC_ALL=C grep -a -F "is not bundled in source checkout" "$SOURCE_BIN" >/dev/null 2>&1; then
  echo "refusing to install placeholder stub binary: $SOURCE_BIN" >&2
  echo "hint: pass --allow-stub only for local launcher testing." >&2
  exit 1
fi

mkdir -p "$CORE_DIR/$PLATFORM_KEY"
TARGET_BIN="$CORE_DIR/$PLATFORM_KEY/grobot-core"
TMP_BIN="$CORE_DIR/$PLATFORM_KEY/.grobot-core.tmp.$$"

cp "$SOURCE_BIN" "$TMP_BIN"
chmod +x "$TMP_BIN"
mv -f "$TMP_BIN" "$TARGET_BIN"

if [ "$UPDATE_CURRENT" -eq 1 ]; then
  ln -sfn "$CORE_DIR/$PLATFORM_KEY" "$CORE_DIR/current"
fi

SHA256=""
if command -v shasum >/dev/null 2>&1; then
  SHA256="$(shasum -a 256 "$TARGET_BIN" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  SHA256="$(sha256sum "$TARGET_BIN" | awk '{print $1}')"
fi

echo "core binary installed."
echo "  source:   $SOURCE_BIN"
echo "  target:   $TARGET_BIN"
if [ -n "$SHA256" ]; then
  echo "  sha256:   $SHA256"
fi
if [ "$UPDATE_CURRENT" -eq 1 ]; then
  echo "  current:  $CORE_DIR/current -> $CORE_DIR/$PLATFORM_KEY"
fi
