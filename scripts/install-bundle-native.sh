#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./grobot install [options]

Install a portable Grobot native bundle for the current user.

Options:
  --version <tag>       Installed version name (default: bundle VERSION file)
  --force               Reinstall even if the version already exists
  --keep <n>            Keep latest n installed versions (default: 3)
  --bin-dir <dir>       Command link dir (default: ~/.local/bin)
  --install-root <dir>  Version store root (default: ~/.local/share/grobot)
  -h, --help            Show help
EOF
}

display_path() {
  local path="$1"
  local home_prefix="${HOME}/"
  if [[ "$path" == "$HOME" ]]; then
    printf '~'
    return 0
  fi
  if [[ "$path" == "$home_prefix"* ]]; then
    printf '~/%s' "${path#${home_prefix}}"
    return 0
  fi
  printf '%s' "$path"
}

ensure_positive_integer() {
  local raw="$1"
  if ! printf '%s' "$raw" | LC_ALL=C grep -E '^[0-9]+$' >/dev/null 2>&1; then
    return 1
  fi
  if [ "$raw" -lt 1 ]; then
    return 1
  fi
  return 0
}

cleanup_old_versions() {
  local versions_dir="$1"
  local keep_count="$2"
  local active_dir="$3"
  if [ ! -d "$versions_dir" ]; then
    return 0
  fi

  local deleted=0
  local seen=0
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    local candidate="${versions_dir}/${entry}"
    [ -d "$candidate" ] || continue
    seen=$((seen + 1))
    if [ "$seen" -le "$keep_count" ]; then
      continue
    fi
    if [ "$candidate" = "$active_dir" ]; then
      continue
    fi
    rm -rf "$candidate"
    deleted=$((deleted + 1))
  done < <(ls -1t "$versions_dir" 2>/dev/null || true)

  if [ "$deleted" -gt 0 ]; then
    echo "cleaned old versions: ${deleted}"
  fi
}

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLE_ROOT="${GROBOT_BUNDLE_ROOT:-}"
if [ -z "$BUNDLE_ROOT" ]; then
  if [ "$(basename "$APP_ROOT")" = "app" ]; then
    BUNDLE_ROOT="$(cd "$APP_ROOT/.." && pwd)"
  else
    BUNDLE_ROOT="$APP_ROOT"
  fi
fi

VERSION=""
if [ -f "$BUNDLE_ROOT/VERSION" ]; then
  VERSION="$(tr -d '\r\n' < "$BUNDLE_ROOT/VERSION")"
elif [ -f "$APP_ROOT/VERSION" ]; then
  VERSION="$(tr -d '\r\n' < "$APP_ROOT/VERSION")"
else
  VERSION="v0.1.0-portable"
fi

FORCE_INSTALL=0
KEEP_VERSIONS="${GROBOT_KEEP_VERSIONS:-3}"
BIN_DIR="${GROBOT_BIN_DIR:-${HOME}/.local/bin}"
INSTALL_ROOT="${GROBOT_INSTALL_ROOT:-${HOME}/.local/share/grobot}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --version" >&2
        exit 1
      fi
      VERSION="$2"
      shift 2
      ;;
    --force)
      FORCE_INSTALL=1
      shift
      ;;
    --keep)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --keep" >&2
        exit 1
      fi
      KEEP_VERSIONS="$2"
      shift 2
      ;;
    --bin-dir)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --bin-dir" >&2
        exit 1
      fi
      BIN_DIR="$2"
      shift 2
      ;;
    --install-root)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --install-root" >&2
        exit 1
      fi
      INSTALL_ROOT="$2"
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

if ! ensure_positive_integer "$KEEP_VERSIONS"; then
  echo "invalid --keep value: $KEEP_VERSIONS (must be integer >= 1)" >&2
  exit 1
fi

if [ ! -x "$BUNDLE_ROOT/grobot" ]; then
  echo "bundle launcher not found or not executable: $BUNDLE_ROOT/grobot" >&2
  exit 1
fi
if [ ! -x "$APP_ROOT/scripts/run-ts-dev-cli.sh" ]; then
  echo "bundle app is incomplete: missing app/scripts/run-ts-dev-cli.sh" >&2
  exit 1
fi

VERSIONS_DIR="${INSTALL_ROOT}/versions"
TARGET_DIR="${VERSIONS_DIR}/${VERSION}"
ACTIVE_LINK="${BIN_DIR}/grobot"

mkdir -p "$VERSIONS_DIR" "$BIN_DIR"
if [ -d "$TARGET_DIR" ] && [ "$FORCE_INSTALL" -ne 1 ]; then
  ln -sfn "$TARGET_DIR/grobot" "$ACTIVE_LINK"
  cleanup_old_versions "$VERSIONS_DIR" "$KEEP_VERSIONS" "$TARGET_DIR"
  printf '✔ Grobot successfully installed!\n\n'
  printf '  Version: %s\n' "$VERSION"
  printf '  Location: %s\n' "$(display_path "$ACTIVE_LINK")"
  exit 0
fi

TMP_TARGET="${TARGET_DIR}.tmp.$$"
rm -rf "$TMP_TARGET"
mkdir -p "$TMP_TARGET"
cp "$BUNDLE_ROOT/grobot" "$TMP_TARGET/grobot"
chmod +x "$TMP_TARGET/grobot"
cp -R "$APP_ROOT" "$TMP_TARGET/app"

if [ -d "$TARGET_DIR" ]; then
  rm -rf "$TARGET_DIR"
fi
mv "$TMP_TARGET" "$TARGET_DIR"
ln -sfn "$TARGET_DIR/grobot" "$ACTIVE_LINK"
cleanup_old_versions "$VERSIONS_DIR" "$KEEP_VERSIONS" "$TARGET_DIR"

printf '✔ Grobot successfully installed!\n\n'
printf '  Version: %s\n' "$VERSION"
printf '  Location: %s\n' "$(display_path "$ACTIVE_LINK")"
if [[ ":${PATH}:" != *":${BIN_DIR}:"* ]]; then
  printf '\nPATH hint:\n'
  printf '  export PATH="%s:$PATH"\n' "$BIN_DIR"
fi
