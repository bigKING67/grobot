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

detect_platform_key() {
  local os arch
  os="$(uname -s 2>/dev/null || echo unknown)"
  arch="$(uname -m 2>/dev/null || echo unknown)"
  case "${os}:${arch}" in
    Darwin:arm64) echo "darwin-arm64" ;;
    Darwin:x86_64) echo "darwin-x64" ;;
    Linux:x86_64) echo "linux-x64" ;;
    Linux:aarch64|Linux:arm64) echo "linux-arm64" ;;
    *) echo "" ;;
  esac
}

detect_core_package() {
  local platform_key="$1"
  case "$platform_key" in
    darwin-arm64) echo "@grobot/core-darwin-arm64" ;;
    darwin-x64) echo "@grobot/core-darwin-x64" ;;
    linux-x64) echo "@grobot/core-linux-x64" ;;
    linux-arm64) echo "@grobot/core-linux-arm64" ;;
    *) echo "" ;;
  esac
}

status_line() {
  local label="$1"
  local path="$2"
  local stub_flag="no"
  if [ -x "$path" ] && LC_ALL=C grep -a -F "is not bundled in source checkout" "$path" >/dev/null 2>&1; then
    stub_flag="yes"
  fi
  if [ -x "$path" ]; then
    if [ "$stub_flag" = "yes" ]; then
      echo "  [ok]   $label: $path (stub)"
    else
      echo "  [ok]   $label: $path"
    fi
  else
    echo "  [miss] $label: $path"
  fi
}

json_escape() {
  local raw="$1"
  if command -v node >/dev/null 2>&1; then
    node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$raw"
    return
  fi

  # Shell fallback for environments without node in PATH.
  raw="${raw//\\/\\\\}"
  raw="${raw//\"/\\\"}"
  raw="${raw//$'\n'/\\n}"
  raw="${raw//$'\r'/\\r}"
  raw="${raw//$'\t'/\\t}"
  printf '"%s"' "$raw"
}

GROBOT_HOME_DIR="${GROBOT_HOME:-${HOME}/.grobot}"
PLATFORM_KEY="$(detect_platform_key)"
CORE_PACKAGE="$(detect_core_package "$PLATFORM_KEY")"
OUTPUT_JSON=0
REQUIRE_REAL_CORE=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --json)
      OUTPUT_JSON=1
      shift
      ;;
    --require-real-core)
      REQUIRE_REAL_CORE=1
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage: bash scripts/core-status.sh [options]

Options:
  --json               Emit machine-readable JSON
  --require-real-core  Exit non-zero if active source is not a non-stub core binary
  -h, --help           Show help
EOF
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      exit 1
      ;;
  esac
done

ENV_BIN="${GROBOT_CORE_BIN:-}"
HOME_CURRENT_BIN="${GROBOT_HOME_DIR}/core/current/grobot-core"
HOME_PLATFORM_BIN="${GROBOT_HOME_DIR}/core/${PLATFORM_KEY}/grobot-core"
NODE_BIN=""
if [ -n "$CORE_PACKAGE" ]; then
  NODE_BIN="${REPO_ROOT}/node_modules/${CORE_PACKAGE}/bin/grobot-core"
fi
TS_DEV_CLI_RUNNER="${REPO_ROOT}/scripts/run-ts-dev-cli.sh"

ACTIVE_SOURCE="none"
ACTIVE_PATH=""
if [ -n "$ENV_BIN" ] && [ -x "$ENV_BIN" ]; then
  ACTIVE_SOURCE="env:GROBOT_CORE_BIN"
  ACTIVE_PATH="$ENV_BIN"
elif [ -x "$HOME_CURRENT_BIN" ]; then
  ACTIVE_SOURCE="home:current"
  ACTIVE_PATH="$HOME_CURRENT_BIN"
elif [ -x "$HOME_PLATFORM_BIN" ]; then
  ACTIVE_SOURCE="home:platform"
  ACTIVE_PATH="$HOME_PLATFORM_BIN"
elif [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ]; then
  ACTIVE_SOURCE="node_modules"
  ACTIVE_PATH="$NODE_BIN"
elif [ -x "$TS_DEV_CLI_RUNNER" ]; then
  ACTIVE_SOURCE="source:ts-dev-cli"
  ACTIVE_PATH="$TS_DEV_CLI_RUNNER"
fi

ACTIVE_IS_STUB=0
if [ -n "$ACTIVE_PATH" ] && [ -x "$ACTIVE_PATH" ] && LC_ALL=C grep -a -F "is not bundled in source checkout" "$ACTIVE_PATH" >/dev/null 2>&1; then
  ACTIVE_IS_STUB=1
fi

ACTIVE_IS_REAL_CORE=0
case "$ACTIVE_SOURCE" in
  env:GROBOT_CORE_BIN|home:current|home:platform|node_modules)
    if [ "$ACTIVE_IS_STUB" -eq 0 ]; then
      ACTIVE_IS_REAL_CORE=1
    fi
    ;;
  *)
    ACTIVE_IS_REAL_CORE=0
    ;;
esac

if [ "$OUTPUT_JSON" -eq 1 ]; then
  printf '{\n'
  printf '  "platform_key": %s,\n' "$(json_escape "${PLATFORM_KEY:-unsupported}")"
  printf '  "grobot_home": %s,\n' "$(json_escape "$GROBOT_HOME_DIR")"
  printf '  "active_source": %s,\n' "$(json_escape "$ACTIVE_SOURCE")"
  printf '  "active_path": %s,\n' "$(json_escape "$ACTIVE_PATH")"
  printf '  "active_is_stub": %s,\n' "$([ "$ACTIVE_IS_STUB" -eq 1 ] && echo "true" || echo "false")"
  printf '  "active_is_real_core": %s,\n' "$([ "$ACTIVE_IS_REAL_CORE" -eq 1 ] && echo "true" || echo "false")"
  printf '  "candidates": {\n'
  printf '    "env_bin": %s,\n' "$(json_escape "${ENV_BIN:-}")"
  printf '    "home_current_bin": %s,\n' "$(json_escape "$HOME_CURRENT_BIN")"
  printf '    "home_platform_bin": %s,\n' "$(json_escape "$HOME_PLATFORM_BIN")"
  printf '    "node_bin": %s,\n' "$(json_escape "${NODE_BIN:-}")"
  printf '    "ts_dev_cli_runner": %s\n' "$(json_escape "$TS_DEV_CLI_RUNNER")"
  printf '  }\n'
  printf '}\n'
else
  echo "grobot core status"
  echo "  platform_key: ${PLATFORM_KEY:-unsupported}"
  echo "  grobot_home:  $GROBOT_HOME_DIR"
  echo "  active:       $ACTIVE_SOURCE"
  if [ -n "$ACTIVE_PATH" ]; then
    echo "  active_path:  $ACTIVE_PATH"
  fi
  if [ "$ACTIVE_IS_STUB" -eq 1 ]; then
    echo "  active_stub:  yes"
  fi

  echo
  echo "lookup candidates (same order as launcher):"
  if [ -n "$ENV_BIN" ]; then
    status_line "GROBOT_CORE_BIN" "$ENV_BIN"
  else
    echo "  [skip] GROBOT_CORE_BIN: <unset>"
  fi
  status_line "~/.grobot/core/current/grobot-core" "$HOME_CURRENT_BIN"
  if [ -n "$PLATFORM_KEY" ]; then
    status_line "~/.grobot/core/${PLATFORM_KEY}/grobot-core" "$HOME_PLATFORM_BIN"
  else
    echo "  [skip] ~/.grobot/core/<platform>/grobot-core: platform unsupported"
  fi
  if [ -n "$NODE_BIN" ]; then
    status_line "node_modules/${CORE_PACKAGE}/bin/grobot-core" "$NODE_BIN"
  else
    echo "  [skip] node_modules/@grobot/core-*/bin/grobot-core: platform unsupported"
  fi
  if [ -x "$TS_DEV_CLI_RUNNER" ]; then
    echo "  [ok]   source ts-dev-cli runner: $TS_DEV_CLI_RUNNER"
  else
    echo "  [miss] source ts-dev-cli runner: $TS_DEV_CLI_RUNNER"
  fi
fi

if [ "$REQUIRE_REAL_CORE" -eq 1 ] && [ "$ACTIVE_IS_REAL_CORE" -ne 1 ]; then
  echo "core-status: active source is not a real core binary." >&2
  exit 2
fi
