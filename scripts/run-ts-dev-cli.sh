#!/usr/bin/env bash
set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  TARGET="$(readlink "$SOURCE")"
  if [[ "$TARGET" != /* ]]; then
    SOURCE="$SCRIPT_DIR/$TARGET"
  else
    SOURCE="$TARGET"
  fi
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "ts-dev-cli bootstrap failed: node is not available." >&2
  exit 86
fi

CACHE_ROOT="${GROBOT_HOME:-${HOME}/.grobot}/cache/ts-dev-cli"
OUT_DIR="${GROBOT_TS_DEV_CLI_OUT_DIR:-$CACHE_ROOT/dist}"
ENTRY="$OUT_DIR/dev-cli.js"
mkdir -p "$OUT_DIR"

NEEDS_BUILD=0
if [ ! -f "$ENTRY" ]; then
  NEEDS_BUILD=1
else
  if [ "$REPO_ROOT/gateway/tsconfig.json" -nt "$ENTRY" ]; then
    NEEDS_BUILD=1
  fi
  if [ "$NEEDS_BUILD" -eq 0 ]; then
    NEWER_TS_FILE="$(
      find "$REPO_ROOT/gateway/src" -type f \( -name "*.ts" -o -name "*.d.ts" \) -newer "$ENTRY" -print -quit
    )"
    if [ -n "$NEWER_TS_FILE" ]; then
      NEEDS_BUILD=1
    fi
  fi
fi

if [ "$NEEDS_BUILD" -eq 1 ]; then
  if ! command -v npx >/dev/null 2>&1; then
    echo "ts-dev-cli bootstrap failed: npx is not available." >&2
    exit 86
  fi
  if ! npx --yes --package typescript@5.6.3 tsc --project "$REPO_ROOT/gateway/tsconfig.json" --outDir "$OUT_DIR" --pretty false >/dev/null; then
    echo "ts-dev-cli bootstrap failed: TypeScript compile error." >&2
    exit 86
  fi
fi

if [ ! -f "$ENTRY" ]; then
  echo "ts-dev-cli bootstrap failed: missing compiled entry $ENTRY" >&2
  exit 86
fi

export GROBOT_TS_DEV_REPO_ROOT="$REPO_ROOT"
exec node "$ENTRY" "$@"
