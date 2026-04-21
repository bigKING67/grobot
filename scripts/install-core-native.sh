#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: grobot install [options]

Options:
  --binary <path>       Install from a local core binary file
  --version <tag>       Release tag (default: latest)
  --repo <owner/name>   GitHub release repo (default: grolandai/grobot-core)
  --url <https-url>     Direct download URL for core binary
  --sha256 <hex>        Expected SHA256 (required with --url)
  --platform <name>     Target platform key
                        darwin-arm64 | darwin-x64 | linux-x64 | linux-arm64 | windows-x64
  --core-dir <dir>      Core install root (default: ~/.grobot/core)
  --no-current          Do not update ~/.grobot/core/current symlink
  --allow-stub          Allow installing placeholder stub binaries (dev only)
  -h, --help            Show help
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

asset_file_for_platform() {
  local platform="$1"
  case "$platform" in
    windows-x64) echo "grobot-core-windows-x64.exe" ;;
    darwin-arm64|darwin-x64|linux-x64|linux-arm64) echo "grobot-core-${platform}" ;;
    *) echo "" ;;
  esac
}

resolve_latest_tag() {
  local repo="$1"
  local api_url="https://api.github.com/repos/${repo}/releases/latest"
  local release_json
  release_json="$(curl -fsSL "$api_url")"
  node -e '
    try {
      const data = JSON.parse(process.argv[1] || "{}");
      const tag = typeof data.tag_name === "string" ? data.tag_name.trim() : "";
      if (!tag) process.exit(2);
      process.stdout.write(tag);
    } catch {
      process.exit(2);
    }
  ' "$release_json"
}

resolve_manifest_sha256() {
  local manifest_json="$1"
  local platform="$2"
  node -e '
    try {
      const data = JSON.parse(process.argv[1] || "{}");
      const platform = process.argv[2] || "";
      const item = data?.artifacts?.[platform];
      const sha = typeof item?.sha256 === "string" ? item.sha256.trim().toLowerCase() : "";
      if (!/^[0-9a-f]{64}$/.test(sha)) process.exit(2);
      process.stdout.write(sha);
    } catch {
      process.exit(2);
    }
  ' "$manifest_json" "$platform"
}

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_FROM_URL_SCRIPT="${SCRIPT_DIR}/install-core-from-url.sh"
INSTALL_FROM_BINARY_SCRIPT="${SCRIPT_DIR}/install-core-binary.sh"

if [ ! -x "$INSTALL_FROM_URL_SCRIPT" ] || [ ! -x "$INSTALL_FROM_BINARY_SCRIPT" ]; then
  echo "install scripts missing under: ${SCRIPT_DIR}" >&2
  exit 1
fi

CORE_BINARY_PATH=""
VERSION_TAG="latest"
RELEASE_REPO="${GROBOT_CORE_RELEASE_REPO:-grolandai/grobot-core}"
DIRECT_URL=""
EXPECTED_SHA256=""
PLATFORM_KEY="$(detect_platform_key)"
CORE_DIR=""
NO_CURRENT=0
ALLOW_STUB=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --binary)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --binary" >&2
        exit 1
      fi
      CORE_BINARY_PATH="$2"
      shift 2
      ;;
    --version)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --version" >&2
        exit 1
      fi
      VERSION_TAG="$2"
      shift 2
      ;;
    --repo)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --repo" >&2
        exit 1
      fi
      RELEASE_REPO="$2"
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

if [ -n "$CORE_BINARY_PATH" ]; then
  INSTALL_ARGS=(--binary "$CORE_BINARY_PATH" --platform "$PLATFORM_KEY")
  if [ -n "$CORE_DIR" ]; then
    INSTALL_ARGS+=(--core-dir "$CORE_DIR")
  fi
  if [ "$NO_CURRENT" -eq 1 ]; then
    INSTALL_ARGS+=(--no-current)
  fi
  if [ "$ALLOW_STUB" -eq 1 ]; then
    INSTALL_ARGS+=(--allow-stub)
  fi
  bash "$INSTALL_FROM_BINARY_SCRIPT" "${INSTALL_ARGS[@]}"
  echo "migration complete. verify with: grobot --version"
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for download-based install." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required for release metadata parsing." >&2
  exit 1
fi

DOWNLOAD_URL="$DIRECT_URL"
if [ -z "$DOWNLOAD_URL" ]; then
  if [ -z "$RELEASE_REPO" ]; then
    echo "--repo is required when GROBOT_CORE_RELEASE_REPO is empty" >&2
    exit 1
  fi
  RELEASE_TAG="$VERSION_TAG"
  if [ "$RELEASE_TAG" = "latest" ]; then
    RELEASE_TAG="$(resolve_latest_tag "$RELEASE_REPO")"
  fi
  ASSET_FILE="$(asset_file_for_platform "$PLATFORM_KEY")"
  if [ -z "$ASSET_FILE" ]; then
    echo "no asset naming rule for platform: $PLATFORM_KEY" >&2
    exit 1
  fi
  DOWNLOAD_URL="https://github.com/${RELEASE_REPO}/releases/download/${RELEASE_TAG}/${ASSET_FILE}"
  if [ -z "$EXPECTED_SHA256" ]; then
    MANIFEST_URL="https://github.com/${RELEASE_REPO}/releases/download/${RELEASE_TAG}/core-artifacts.manifest.json"
    MANIFEST_JSON="$(curl -fsSL "$MANIFEST_URL")"
    EXPECTED_SHA256="$(resolve_manifest_sha256 "$MANIFEST_JSON" "$PLATFORM_KEY")"
  fi
fi

if [ -z "$EXPECTED_SHA256" ]; then
  echo "--sha256 is required when --url is provided directly" >&2
  exit 1
fi

INSTALL_URL_ARGS=(--url "$DOWNLOAD_URL" --sha256 "$EXPECTED_SHA256" --platform "$PLATFORM_KEY")
if [ -n "$CORE_DIR" ]; then
  INSTALL_URL_ARGS+=(--core-dir "$CORE_DIR")
fi
if [ "$NO_CURRENT" -eq 1 ]; then
  INSTALL_URL_ARGS+=(--no-current)
fi
if [ "$ALLOW_STUB" -eq 1 ]; then
  INSTALL_URL_ARGS+=(--allow-stub)
fi

bash "$INSTALL_FROM_URL_SCRIPT" "${INSTALL_URL_ARGS[@]}"
echo "migration complete. verify with: grobot --version"
