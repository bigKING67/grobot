#!/usr/bin/env bash
set -euo pipefail

BIN_DIR_DEFAULT="${HOME}/.grobot/bin"
BIN_DIR="${GROBOT_INSTALL_BIN_DIR:-$BIN_DIR_DEFAULT}"
LINK_PATH=""

usage() {
  cat <<'EOF'
Usage: bash scripts/uninstall-local.sh [options]

Options:
  --bin-dir <dir>    Remove symlink from custom directory (default: ~/.grobot/bin)
  -h, --help         Show help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --bin-dir)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --bin-dir" >&2
        exit 1
      fi
      BIN_DIR="$2"
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

LINK_PATH="${BIN_DIR}/grobot"

if [ -L "$LINK_PATH" ] || [ -f "$LINK_PATH" ]; then
  rm -f "$LINK_PATH"
  echo "removed: $LINK_PATH"
else
  echo "not found: $LINK_PATH"
fi
