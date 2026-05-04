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

resolve_default_cache_root() {
  if [ -n "${GROBOT_TS_DEV_CLI_CACHE_ROOT:-}" ]; then
    printf '%s' "${GROBOT_TS_DEV_CLI_CACHE_ROOT}"
    return 0
  fi
  if [ -n "${GROBOT_TS_DEV_CACHE_ROOT:-}" ]; then
    printf '%s/ts-dev-cli' "${GROBOT_TS_DEV_CACHE_ROOT%/}"
    return 0
  fi

  local os_name
  os_name="$(uname -s 2>/dev/null || echo unknown)"
  case "$os_name" in
    Darwin)
      printf '%s/Library/Caches/grobot/ts-dev-cli' "${HOME}"
      ;;
    Linux)
      if [ -n "${XDG_CACHE_HOME:-}" ]; then
        printf '%s/grobot/ts-dev-cli' "${XDG_CACHE_HOME%/}"
      else
        printf '%s/.cache/grobot/ts-dev-cli' "${HOME}"
      fi
      ;;
    *)
      if [ -n "${XDG_CACHE_HOME:-}" ]; then
        printf '%s/grobot/ts-dev-cli' "${XDG_CACHE_HOME%/}"
      else
        printf '%s/.cache/grobot/ts-dev-cli' "${HOME}"
      fi
      ;;
  esac
}

migrate_legacy_cache_root() {
  local target_root="$1"
  local legacy_root="${GROBOT_HOME:-${HOME}/.grobot}/cache/ts-dev-cli"
  if [ "$target_root" = "$legacy_root" ]; then
    return 0
  fi
  if [ ! -d "$legacy_root" ]; then
    return 0
  fi
  if [ -d "$target_root" ]; then
    return 0
  fi
  mkdir -p "$(dirname "$target_root")"
  if mv "$legacy_root" "$target_root" >/dev/null 2>&1; then
    return 0
  fi
  if cp -R "$legacy_root" "$target_root" >/dev/null 2>&1; then
    rm -rf "$legacy_root" >/dev/null 2>&1 || true
  fi
}

CACHE_ROOT="$(resolve_default_cache_root)"
migrate_legacy_cache_root "$CACHE_ROOT"
OUT_DIR="${GROBOT_TS_DEV_CLI_OUT_DIR:-$CACHE_ROOT/dist}"
ENTRY="$OUT_DIR/cli/main.js"
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
      find "$REPO_ROOT/gateway/src" -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.d.ts" \) -newer "$ENTRY" -print -quit
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

  build_ts_dev_cli() {
    npx --yes --package typescript@5.6.3 tsc --project "$REPO_ROOT/gateway/tsconfig.json" --outDir "$OUT_DIR" --pretty false
  }

  if ! build_ts_dev_cli; then
    # One light retry absorbs transient tsc bootstrap flakes while still failing fast.
    sleep 0.2
    if ! build_ts_dev_cli; then
      echo "ts-dev-cli bootstrap failed: TypeScript compile error (see diagnostics above)." >&2
      exit 86
    fi
  fi
fi

if [ ! -f "$ENTRY" ]; then
  echo "ts-dev-cli bootstrap failed: missing compiled entry $ENTRY" >&2
  exit 86
fi

export GROBOT_TS_DEV_REPO_ROOT="$REPO_ROOT"
exec node "$ENTRY" "$@"
