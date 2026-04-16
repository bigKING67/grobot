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

BIN_DIR_DEFAULT="${HOME}/.grobot/bin"
BIN_DIR="${GROBOT_INSTALL_BIN_DIR:-$BIN_DIR_DEFAULT}"
UPDATE_PROFILE=1
RUN_BROWSER_NATIVE_SETUP=1
BROWSER_NATIVE_SETUP_STRICT=0

usage() {
  cat <<'EOF'
Usage: bash scripts/install-local.sh [options]

Options:
  --bin-dir <dir>    Install symlink into custom directory (default: ~/.grobot/bin)
  --no-profile       Do not modify shell profile PATH
  --no-browser-native-setup
                     Skip browser native dependency setup
  --browser-native-setup-strict
                     Fail install when browser native setup fails
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
    --no-profile)
      UPDATE_PROFILE=0
      shift
      ;;
    --no-browser-native-setup)
      RUN_BROWSER_NATIVE_SETUP=0
      shift
      ;;
    --browser-native-setup-strict)
      BROWSER_NATIVE_SETUP_STRICT=1
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

if [ ! -f "$REPO_ROOT/grobot" ]; then
  echo "cannot find grobot launcher under repo root: $REPO_ROOT" >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
chmod +x "$REPO_ROOT/grobot"
LINK_PATH="$BIN_DIR/grobot"
ln -sfn "$REPO_ROOT/grobot" "$LINK_PATH"

profile_for_shell() {
  case "${SHELL:-}" in
    */zsh) echo "${HOME}/.zshrc" ;;
    */bash)
      if [ -f "${HOME}/.bashrc" ]; then
        echo "${HOME}/.bashrc"
      else
        echo "${HOME}/.bash_profile"
      fi
      ;;
    *) echo "" ;;
  esac
}

ensure_path_line() {
  local profile_file="$1"
  local path_line="$2"
  if [ -z "$profile_file" ]; then
    return 0
  fi
  touch "$profile_file"
  if ! grep -F "$path_line" "$profile_file" >/dev/null 2>&1; then
    printf '\n%s\n' "$path_line" >> "$profile_file"
  fi
}

PATH_LINE="export PATH=\"${BIN_DIR}:\$PATH\""
if [ "$UPDATE_PROFILE" -eq 1 ]; then
  PROFILE_FILE="$(profile_for_shell)"
  ensure_path_line "$PROFILE_FILE" "$PATH_LINE"
fi

echo "Grobot source install completed."
echo "  repo_root: $REPO_ROOT"
echo "  symlink:   $LINK_PATH -> $REPO_ROOT/grobot"

case ":$PATH:" in
  *":${BIN_DIR}:"*)
    echo "  path:      active in current shell"
    ;;
  *)
    echo "  path:      not active in current shell"
    echo "  run:       export PATH=\"${BIN_DIR}:\$PATH\""
    ;;
esac

if command -v grobot >/dev/null 2>&1; then
  echo "  verify:    $(command -v grobot)"
fi

run_browser_native_setup() {
  if [ "$RUN_BROWSER_NATIVE_SETUP" -ne 1 ]; then
    echo "  browser:   native setup skipped (--no-browser-native-setup)"
    return 0
  fi

  local setup_script
  setup_script="$REPO_ROOT/adapters/browser-structured-mcp/native-deps-setup.mjs"
  if [ ! -f "$setup_script" ]; then
    echo "  browser:   native setup skipped (script not found: $setup_script)"
    return 0
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "  browser:   native setup skipped (node not found in PATH)"
    return 0
  fi

  echo "  browser:   running native dependency setup..."
  if node "$setup_script" --install --yes --quiet; then
    echo "  browser:   native dependency setup completed"
    return 0
  fi

  echo "  browser:   native dependency setup failed" >&2
  echo "  browser:   run 'npm run browser:native:doctor' for details" >&2
  if [ "$BROWSER_NATIVE_SETUP_STRICT" -eq 1 ]; then
    echo "  browser:   strict mode enabled; aborting install" >&2
    return 1
  fi
  echo "  browser:   continuing install (best-effort mode)" >&2
  return 0
}

run_browser_native_setup
