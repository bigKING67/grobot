#!/usr/bin/env bash
set -euo pipefail

BIN_DIR_DEFAULT="${HOME}/.grobot/bin"
BIN_DIR="${GROBOT_INSTALL_BIN_DIR:-$BIN_DIR_DEFAULT}"
LINK_PATH="${BIN_DIR}/grobot"

if [ -L "$LINK_PATH" ] || [ -f "$LINK_PATH" ]; then
  rm -f "$LINK_PATH"
  echo "removed: $LINK_PATH"
else
  echo "not found: $LINK_PATH"
fi
