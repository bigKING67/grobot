#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: grobot install [target] [options]

Targets:
  stable | latest | <version-tag>
  (default: latest)

Options:
  --repo <owner/name>     GitHub release repo (or use GROBOT_CORE_RELEASE_REPO)
  --version <tag>         Same as positional target
  --binary <path>         Install from local binary file
  --url <https-url>       Install from direct URL
  --sha256 <hex>          Required with --url
  --platform <name>       darwin-arm64 | darwin-x64 | linux-x64 | linux-arm64 | windows-x64
  --force                 Reinstall even if target version already exists
  --keep <n>              Keep latest n installed versions (default: 3)
  --bin-dir <dir>         Command link dir (default: ~/.local/bin)
  --install-root <dir>    Version store root (default: ~/.local/share/grobot)
  -h, --help              Show help
EOF
}

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

resolve_github_token() {
  if [ -n "${GROBOT_GITHUB_TOKEN:-}" ]; then
    printf '%s' "${GROBOT_GITHUB_TOKEN}"
    return 0
  fi
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    printf '%s' "${GITHUB_TOKEN}"
    return 0
  fi
  if [ -n "${GH_TOKEN:-}" ]; then
    printf '%s' "${GH_TOKEN}"
    return 0
  fi
}

curl_get() {
  local url="$1"
  local out_file="$2"
  local github_token="$3"
  if [ -n "$github_token" ] && [[ "$url" == *"github.com"* || "$url" == *"api.github.com"* ]]; then
    curl -fsSL -H "Authorization: Bearer ${github_token}" "$url" -o "$out_file"
    return 0
  fi
  curl -fsSL "$url" -o "$out_file"
}

asset_file_for_platform() {
  local platform="$1"
  case "$platform" in
    windows-x64) echo "grobot-core-windows-x64.exe" ;;
    darwin-arm64|darwin-x64|linux-x64|linux-arm64) echo "grobot-core-${platform}" ;;
    *) echo "" ;;
  esac
}

sha256_file() {
  local file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
    return 0
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
    return 0
  fi
  echo "missing shasum/sha256sum for checksum verification" >&2
  exit 1
}

is_stub_binary() {
  local path="$1"
  if [ ! -x "$path" ]; then
    return 1
  fi
  if LC_ALL=C grep -a -F "is not bundled in source checkout" "$path" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

display_path() {
  local path="$1"
  local home_prefix="${HOME}/"
  if [[ "$path" == "${HOME}" ]]; then
    printf '~'
    return 0
  fi
  if [[ "$path" == "$home_prefix"* ]]; then
    printf '~/%s' "${path#${home_prefix}}"
    return 0
  fi
  printf '%s' "$path"
}

find_local_bundle_binary() {
  local platform="$1"
  local asset_file=""
  asset_file="$(asset_file_for_platform "$platform")"
  if [ -z "$asset_file" ]; then
    return 0
  fi

  local roots=()
  roots+=("$(pwd)")
  roots+=("$(cd "$SCRIPT_DIR/.." && pwd)")
  roots+=("$(cd "$SCRIPT_DIR/.." && pwd)/dist/core-artifacts")
  roots+=("$(cd "$SCRIPT_DIR/.." && pwd)/dist/native")

  local root
  for root in "${roots[@]}"; do
    [ -n "$root" ] || continue
    if [ -x "$root/$asset_file" ]; then
      printf '%s' "$root/$asset_file"
      return 0
    fi
    # Only accept the generic launcher name from a portable bundle root. A source
    # checkout also has ./grobot, but installing that wrapper as a core would
    # create a recursive broken install path.
    if [ -x "$root/grobot" ] && [ "$platform" != "windows-x64" ] && [ -f "$root/core-artifacts.manifest.json" ] && [ -f "$root/VERSION" ] && [ -f "$root/app/scripts/run-ts-dev-cli.sh" ]; then
      printf '%s' "$root/grobot"
      return 0
    fi
    if [ -x "$root/grobot.exe" ] && [ "$platform" = "windows-x64" ] && [ -f "$root/core-artifacts.manifest.json" ] && [ -f "$root/VERSION" ] && [ -f "$root/app/scripts/run-ts-dev-cli.ps1" ]; then
      printf '%s' "$root/grobot.exe"
      return 0
    fi
  done
}

resolve_release_tag() {
  local repo="$1"
  local requested_target="$2"
  local token="$3"
  local tmp_json="$4"
  local api_url=""

  case "$requested_target" in
    ""|latest|stable)
      api_url="https://api.github.com/repos/${repo}/releases/latest"
      ;;
    *)
      api_url="https://api.github.com/repos/${repo}/releases/tags/${requested_target}"
      ;;
  esac

  if ! curl_get "$api_url" "$tmp_json" "$token"; then
    echo "failed to query release metadata for repo: ${repo}" >&2
    echo "url: ${api_url}" >&2
    echo "hint: verify repo/tag visibility, or use --binary local install." >&2
    return 1
  fi

  node -e '
    try {
      const fs = require("node:fs");
      const path = process.argv[1];
      const data = JSON.parse(fs.readFileSync(path, "utf8"));
      const tag = typeof data?.tag_name === "string" ? data.tag_name.trim() : "";
      if (!tag) process.exit(2);
      process.stdout.write(tag);
    } catch {
      process.exit(2);
    }
  ' "$tmp_json"
}

resolve_release_asset_url() {
  local release_json="$1"
  local asset_name="$2"
  node -e '
    try {
      const fs = require("node:fs");
      const path = process.argv[1];
      const wanted = process.argv[2];
      const data = JSON.parse(fs.readFileSync(path, "utf8"));
      const assets = Array.isArray(data?.assets) ? data.assets : [];
      const hit = assets.find((item) => String(item?.name || "") === wanted);
      const url = typeof hit?.browser_download_url === "string" ? hit.browser_download_url.trim() : "";
      if (!url) process.exit(2);
      process.stdout.write(url);
    } catch {
      process.exit(2);
    }
  ' "$release_json" "$asset_name"
}

resolve_manifest_sha256() {
  local manifest_json="$1"
  local platform="$2"
  node -e '
    try {
      const fs = require("node:fs");
      const path = process.argv[1];
      const platform = process.argv[2];
      const data = JSON.parse(fs.readFileSync(path, "utf8"));
      const item = data?.artifacts?.[platform];
      const sha = typeof item?.sha256 === "string" ? item.sha256.trim().toLowerCase() : "";
      if (!/^[0-9a-f]{64}$/.test(sha)) process.exit(2);
      process.stdout.write(sha);
    } catch {
      process.exit(2);
    }
  ' "$manifest_json" "$platform"
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
  local active_file="$3"

  if [ ! -d "$versions_dir" ]; then
    return 0
  fi

  local deleted=0
  local seen=0
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    local candidate="${versions_dir}/${entry}"
    [ -f "$candidate" ] || continue
    seen=$((seen + 1))
    if [ "$seen" -le "$keep_count" ]; then
      continue
    fi
    if [ "$candidate" = "$active_file" ]; then
      continue
    fi
    rm -f "$candidate"
    deleted=$((deleted + 1))
  done < <(ls -1t "$versions_dir" 2>/dev/null || true)

  if [ "$deleted" -gt 0 ]; then
    echo "cleaned old versions: ${deleted}"
  fi
}

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_INPUT="latest"
TARGET_OVERRIDE=""
RELEASE_REPO="${GROBOT_CORE_RELEASE_REPO:-}"
CORE_BINARY_PATH=""
DIRECT_URL=""
EXPECTED_SHA256=""
FORCE_INSTALL=0
KEEP_VERSIONS="${GROBOT_KEEP_VERSIONS:-3}"
PLATFORM_KEY="$(detect_platform_key)"
BIN_DIR="${GROBOT_BIN_DIR:-${HOME}/.local/bin}"
INSTALL_ROOT="${GROBOT_INSTALL_ROOT:-${HOME}/.local/share/grobot}"
VERSIONS_DIR="${INSTALL_ROOT}/versions"
ACTIVE_LINK=""
GITHUB_TOKEN_VALUE="$(resolve_github_token)"

ACTIVE_LINK="${BIN_DIR}/grobot"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --repo" >&2
        exit 1
      fi
      RELEASE_REPO="$2"
      shift 2
      ;;
    --version)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --version" >&2
        exit 1
      fi
      TARGET_OVERRIDE="$2"
      shift 2
      ;;
    --binary)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --binary" >&2
        exit 1
      fi
      CORE_BINARY_PATH="$2"
      shift 2
      ;;
    --url)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --url" >&2
        exit 1
      fi
      DIRECT_URL="$2"
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
      ACTIVE_LINK="${BIN_DIR}/grobot"
      shift 2
      ;;
    --install-root)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --install-root" >&2
        exit 1
      fi
      INSTALL_ROOT="$2"
      VERSIONS_DIR="${INSTALL_ROOT}/versions"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "unknown option: $1" >&2
      usage
      exit 1
      ;;
    *)
      if [ "$TARGET_INPUT" != "latest" ]; then
        echo "unexpected extra argument: $1" >&2
        usage
        exit 1
      fi
      TARGET_INPUT="$1"
      shift
      ;;
  esac
done

if [ -n "$TARGET_OVERRIDE" ]; then
  TARGET_INPUT="$TARGET_OVERRIDE"
fi

if [ -z "$PLATFORM_KEY" ]; then
  echo "unsupported platform; please pass --platform explicitly" >&2
  exit 1
fi

case "$PLATFORM_KEY" in
  darwin-arm64|darwin-x64|linux-x64|linux-arm64|windows-x64) ;;
  *)
    echo "unsupported --platform value: $PLATFORM_KEY" >&2
    exit 1
    ;;
esac

if ! ensure_positive_integer "$KEEP_VERSIONS"; then
  echo "invalid --keep value: $KEEP_VERSIONS (must be integer >= 1)" >&2
  exit 1
fi

if [ -n "$DIRECT_URL" ] && [ -z "$EXPECTED_SHA256" ]; then
  echo "--sha256 is required with --url" >&2
  exit 1
fi

EXPECTED_SHA256="$(printf '%s' "$EXPECTED_SHA256" | tr '[:upper:]' '[:lower:]')"
if [ -n "$EXPECTED_SHA256" ] && ! printf '%s' "$EXPECTED_SHA256" | LC_ALL=C grep -E '^[0-9a-f]{64}$' >/dev/null 2>&1; then
  echo "invalid --sha256 format: expected 64 hex chars" >&2
  exit 1
fi

if [ -z "$CORE_BINARY_PATH" ] && [ -z "$DIRECT_URL" ] && [ -z "$RELEASE_REPO" ]; then
  LOCAL_BUNDLE_BINARY="$(find_local_bundle_binary "$PLATFORM_KEY")"
  if [ -n "$LOCAL_BUNDLE_BINARY" ]; then
    CORE_BINARY_PATH="$LOCAL_BUNDLE_BINARY"
    LOCAL_BUNDLE_VERSION_FILE="$(dirname "$LOCAL_BUNDLE_BINARY")/VERSION"
    if [ -f "$LOCAL_BUNDLE_VERSION_FILE" ] && { [ "$TARGET_INPUT" = "latest" ] || [ "$TARGET_INPUT" = "stable" ]; }; then
      TARGET_INPUT="$(tr -d '\r\n' < "$LOCAL_BUNDLE_VERSION_FILE")"
    fi
  fi
fi

TMP_DIR="$(mktemp -d)"
TMP_DOWNLOAD_BIN="${TMP_DIR}/grobot-core.download"
TMP_RELEASE_JSON="${TMP_DIR}/release.json"
TMP_MANIFEST_JSON="${TMP_DIR}/manifest.json"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

INSTALL_VERSION=""
SOURCE_BINARY_PATH=""

if [ -n "$CORE_BINARY_PATH" ]; then
  if [ ! -f "$CORE_BINARY_PATH" ]; then
    echo "binary not found: $CORE_BINARY_PATH" >&2
    exit 1
  fi
  if [ ! -x "$CORE_BINARY_PATH" ]; then
    echo "binary is not executable: $CORE_BINARY_PATH" >&2
    exit 1
  fi
  if is_stub_binary "$CORE_BINARY_PATH"; then
    echo "refusing to install placeholder stub binary: $CORE_BINARY_PATH" >&2
    exit 1
  fi
  INSTALL_VERSION="$TARGET_INPUT"
  if [ "$INSTALL_VERSION" = "latest" ] || [ "$INSTALL_VERSION" = "stable" ] || [ -z "$INSTALL_VERSION" ]; then
    INSTALL_VERSION="manual-$(date +%Y%m%d%H%M%S)"
  fi
  SOURCE_BINARY_PATH="$CORE_BINARY_PATH"
else
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required for download-based install." >&2
    exit 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "node is required for release metadata parsing." >&2
    exit 1
  fi

  if [ -n "$DIRECT_URL" ]; then
    INSTALL_VERSION="$TARGET_INPUT"
    if [ "$INSTALL_VERSION" = "latest" ] || [ "$INSTALL_VERSION" = "stable" ] || [ -z "$INSTALL_VERSION" ]; then
      INSTALL_VERSION="manual-url-$(date +%Y%m%d%H%M%S)"
    fi
    if ! curl_get "$DIRECT_URL" "$TMP_DOWNLOAD_BIN" "$GITHUB_TOKEN_VALUE"; then
      echo "download failed for url: $DIRECT_URL" >&2
      exit 1
    fi
  else
    if [ -z "$RELEASE_REPO" ]; then
      echo "release repo is required (use --repo <owner/name> or GROBOT_CORE_RELEASE_REPO)." >&2
      exit 1
    fi
    INSTALL_VERSION="$(resolve_release_tag "$RELEASE_REPO" "$TARGET_INPUT" "$GITHUB_TOKEN_VALUE" "$TMP_RELEASE_JSON")"
    ASSET_FILE="$(asset_file_for_platform "$PLATFORM_KEY")"
    if [ -z "$ASSET_FILE" ]; then
      echo "no asset naming rule for platform: $PLATFORM_KEY" >&2
      exit 1
    fi
    RELEASE_ASSET_URL="$(resolve_release_asset_url "$TMP_RELEASE_JSON" "$ASSET_FILE")"
    MANIFEST_ASSET_URL="$(resolve_release_asset_url "$TMP_RELEASE_JSON" "core-artifacts.manifest.json")"

    if [ -z "$EXPECTED_SHA256" ]; then
      if ! curl_get "$MANIFEST_ASSET_URL" "$TMP_MANIFEST_JSON" "$GITHUB_TOKEN_VALUE"; then
        echo "failed to download release manifest: $MANIFEST_ASSET_URL" >&2
        exit 1
      fi
      EXPECTED_SHA256="$(resolve_manifest_sha256 "$TMP_MANIFEST_JSON" "$PLATFORM_KEY")"
    fi

    if ! curl_get "$RELEASE_ASSET_URL" "$TMP_DOWNLOAD_BIN" "$GITHUB_TOKEN_VALUE"; then
      echo "failed to download release asset: $RELEASE_ASSET_URL" >&2
      exit 1
    fi
  fi

  chmod +x "$TMP_DOWNLOAD_BIN"
  ACTUAL_SHA256="$(sha256_file "$TMP_DOWNLOAD_BIN")"
  if [ -n "$EXPECTED_SHA256" ] && [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
    echo "sha256 mismatch." >&2
    echo "  expected: $EXPECTED_SHA256" >&2
    echo "  actual:   $ACTUAL_SHA256" >&2
    exit 1
  fi

  if is_stub_binary "$TMP_DOWNLOAD_BIN"; then
    echo "refusing to install placeholder stub binary from download source." >&2
    exit 1
  fi
  SOURCE_BINARY_PATH="$TMP_DOWNLOAD_BIN"
fi

if [ -z "$INSTALL_VERSION" ]; then
  INSTALL_VERSION="manual-$(date +%Y%m%d%H%M%S)"
fi

mkdir -p "$VERSIONS_DIR" "$BIN_DIR"
TARGET_BIN="${VERSIONS_DIR}/${INSTALL_VERSION}"

if [ -f "$TARGET_BIN" ] && [ "$FORCE_INSTALL" -ne 1 ]; then
  ln -sfn "$TARGET_BIN" "$ACTIVE_LINK"
  cleanup_old_versions "$VERSIONS_DIR" "$KEEP_VERSIONS" "$TARGET_BIN"
  printf '✔ Grobot successfully installed!\n\n'
  printf '  Version: %s\n\n' "$INSTALL_VERSION"
  printf '  Location: %s\n' "$(display_path "$ACTIVE_LINK")"
  exit 0
fi

TMP_TARGET="${TARGET_BIN}.tmp.$$"
cp "$SOURCE_BINARY_PATH" "$TMP_TARGET"
chmod +x "$TMP_TARGET"
mv -f "$TMP_TARGET" "$TARGET_BIN"
ln -sfn "$TARGET_BIN" "$ACTIVE_LINK"

cleanup_old_versions "$VERSIONS_DIR" "$KEEP_VERSIONS" "$TARGET_BIN"

printf '✔ Grobot successfully installed!\n\n'
printf '  Version: %s\n\n' "$INSTALL_VERSION"
printf '  Location: %s\n' "$(display_path "$ACTIVE_LINK")"
