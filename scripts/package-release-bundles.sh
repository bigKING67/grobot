#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/package-release-bundles.sh [options]

Build portable Grobot native bundles for macOS, Linux, and Windows.

Options:
  --output-dir <dir>  Output directory
                      (default: /Users/gaoqian/Documents/sixseven/codeproject/grobot-release-bundles)
  --version <tag>     Bundle version (default: v<package.json version>)
  --skip-docker       Only build host macOS artifacts
  --allow-missing     Package platforms with missing build artifacts as skipped reports
  -h, --help          Show help
EOF
}

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="/Users/gaoqian/Documents/sixseven/codeproject/grobot-release-bundles"
VERSION=""
SKIP_DOCKER=0
ALLOW_MISSING=0
RUST_IMAGE="${GROBOT_RELEASE_RUST_IMAGE:-rust:1-bookworm}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output-dir)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --output-dir" >&2
        exit 1
      fi
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --version)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --version" >&2
        exit 1
      fi
      VERSION="$2"
      shift 2
      ;;
    --skip-docker)
      SKIP_DOCKER=1
      shift
      ;;
    --allow-missing)
      ALLOW_MISSING=1
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

if [ -z "$VERSION" ]; then
  VERSION="v$(node -e 'const p=require("./package.json"); process.stdout.write(String(p.version || "0.1.0"));' 2>/dev/null || printf '0.1.0')"
fi

BUILD_ROOT="$REPO_ROOT/dist/release-bundles"
BASE_APP="$BUILD_ROOT/base-app"
LAUNCHER_RS="$BUILD_ROOT/portable-grobot.rs"
ARTIFACTS_DIR="$BUILD_ROOT/artifacts"
STAGE_ROOT="$BUILD_ROOT/stage"

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
  echo "missing shasum/sha256sum" >&2
  exit 1
}

size_file() {
  wc -c < "$1" | awk '{print $1}'
}

ensure_executable() {
  chmod +x "$1"
}

make_launcher_source() {
  mkdir -p "$(dirname "$LAUNCHER_RS")"
  cat >"$LAUNCHER_RS" <<'RS'
use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, ExitStatus};

const VERSION: &str = env!("GROBOT_BUNDLE_VERSION");

fn status_to_exit(status: ExitStatus) -> ExitCode {
    if let Some(code) = status.code() {
        ExitCode::from((code & 0xff) as u8)
    } else {
        ExitCode::from(1)
    }
}

fn run_command(mut command: Command, err_prefix: &str) -> ExitCode {
    match command.status() {
        Ok(status) => status_to_exit(status),
        Err(err) => {
            eprintln!("error: {}: {}", err_prefix, err);
            ExitCode::from(1)
        }
    }
}

fn has_unix_runner(path: &Path) -> bool {
    path.join("scripts").join("run-ts-dev-cli.sh").is_file()
}

fn has_windows_runner(path: &Path) -> bool {
    path.join("scripts").join("run-ts-dev-cli.ps1").is_file()
}

fn has_runner(path: &Path) -> bool {
    has_unix_runner(path) || has_windows_runner(path)
}

fn bundle_root_for_app(app_root: &Path) -> PathBuf {
    if app_root.file_name().and_then(|value| value.to_str()) == Some("app") {
        return app_root.parent().unwrap_or(app_root).to_path_buf();
    }
    app_root.to_path_buf()
}

fn find_app_root() -> Option<PathBuf> {
    if let Ok(raw) = env::var("GROBOT_SOURCE_ROOT") {
        let candidate = PathBuf::from(raw);
        if has_runner(&candidate) {
            return Some(candidate);
        }
    }
    let exe = env::current_exe().ok()?;
    let exe = exe.canonicalize().unwrap_or(exe);
    let exe_dir = exe.parent()?.to_path_buf();
    let candidates = [
        exe_dir.join("app"),
        exe_dir.parent().unwrap_or(&exe_dir).join("app"),
        exe_dir.clone(),
        exe_dir.parent().unwrap_or(&exe_dir).to_path_buf(),
    ];
    for candidate in candidates {
        if has_runner(&candidate) {
            return Some(candidate);
        }
    }
    None
}

fn find_runtime_bin(app_root: &Path) -> Option<PathBuf> {
    let suffix = env::consts::EXE_SUFFIX;
    let names = [
        app_root.join("runtime").join("target").join("release").join(format!("grobot-runtime{}", suffix)),
        app_root.join("runtime").join("target").join("debug").join(format!("grobot-runtime{}", suffix)),
        app_root.join("bin").join(format!("grobot-runtime{}", suffix)),
    ];
    for item in names {
        if item.is_file() {
            return Some(item);
        }
    }
    None
}

fn compiled_out_dir(app_root: &Path) -> Option<PathBuf> {
    let candidate = app_root.join("gateway").join("dist");
    if candidate.join("orchestration").join("dev-cli.js").is_file() {
        return Some(candidate);
    }
    None
}

fn run_powershell_script(script: &Path, args: &[String], app_root: &Path) -> ExitCode {
    let mut command = Command::new("powershell");
    command.arg("-NoProfile");
    command.arg("-ExecutionPolicy");
    command.arg("Bypass");
    command.arg("-File");
    command.arg(script);
    command.args(args);
    command.env("GROBOT_SOURCE_ROOT", app_root);
    command.env("GROBOT_BUNDLE_ROOT", bundle_root_for_app(app_root));
    if let Some(runtime_bin) = find_runtime_bin(app_root) {
        command.env("GROBOT_RUNTIME_BIN", runtime_bin);
    }
    if let Some(out_dir) = compiled_out_dir(app_root) {
        command.env("GROBOT_TS_DEV_CLI_OUT_DIR", out_dir);
    }
    run_command(command, "failed to launch PowerShell runner")
}

fn run_unix_script(script: &Path, args: &[String], app_root: &Path) -> ExitCode {
    let mut command = Command::new(script);
    command.args(args);
    command.env("GROBOT_SOURCE_ROOT", app_root);
    command.env("GROBOT_BUNDLE_ROOT", bundle_root_for_app(app_root));
    if let Some(runtime_bin) = find_runtime_bin(app_root) {
        command.env("GROBOT_RUNTIME_BIN", runtime_bin);
    }
    if let Some(out_dir) = compiled_out_dir(app_root) {
        command.env("GROBOT_TS_DEV_CLI_OUT_DIR", out_dir);
    }
    run_command(command, "failed to launch bundled runner")
}

fn run_installer(app_root: &Path, args: &[String]) -> ExitCode {
    let unix_installer = app_root.join("scripts").join("install-bundle-native.sh");
    let windows_installer = app_root.join("scripts").join("install-bundle-native.ps1");
    if cfg!(windows) {
        if windows_installer.is_file() {
            return run_powershell_script(&windows_installer, args, app_root);
        }
    }
    if unix_installer.is_file() {
        return run_unix_script(&unix_installer, args, app_root);
    }
    if windows_installer.is_file() {
        return run_powershell_script(&windows_installer, args, app_root);
    }
    eprintln!("error: bundled installer is missing under {}", app_root.display());
    ExitCode::from(1)
}

fn run_cli(app_root: &Path, args: &[String]) -> ExitCode {
    if cfg!(windows) {
        let runner = app_root.join("scripts").join("run-ts-dev-cli.ps1");
        if runner.is_file() {
            return run_powershell_script(&runner, args, app_root);
        }
    }
    let runner = app_root.join("scripts").join("run-ts-dev-cli.sh");
    if runner.is_file() {
        return run_unix_script(&runner, args, app_root);
    }
    eprintln!("error: bundled ts-dev-cli runner is missing under {}", app_root.display());
    ExitCode::from(1)
}

fn print_version(app_root: &Path) {
    let exe = env::current_exe()
        .ok()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| "<unknown>".to_string());
    println!("grobot 0.1.0");
    println!("Version: {}", VERSION);
    println!("Location: {}", exe);
    println!("Source: portable:native-launcher (real_core=true)");
    println!("App: {}", app_root.display());
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let first = args.first().map(String::as_str).unwrap_or("");
    let app_root = match find_app_root() {
        Some(value) => value,
        None => {
            eprintln!("error: unable to locate bundled Grobot app next to native launcher.");
            eprintln!("hint: reinstall from the original grobot-<platform> bundle.");
            return ExitCode::from(1);
        }
    };

    if first == "install" {
        return run_installer(&app_root, &args[1..]);
    }
    if matches!(first, "--version" | "-V" | "version") {
        print_version(&app_root);
        return ExitCode::from(0);
    }
    run_cli(&app_root, &args)
}
RS
}

prepare_base_app() {
  echo "[bundle] prepare app source"
  rm -rf "$BASE_APP"
  mkdir -p "$BASE_APP"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a \
      --exclude '.git' \
      --exclude '.grobot' \
      --exclude '.codex' \
      --exclude '.agents' \
      --exclude '.trellis' \
      --exclude '.github' \
      --exclude '.tmp' \
      --exclude '.grobot-contract-temp' \
      --exclude 'logs' \
      --exclude 'HANDOFF.md' \
      --exclude 'node_modules' \
      --exclude 'dist' \
      --exclude 'runtime/target' \
      --exclude '.DS_Store' \
      "$REPO_ROOT/" "$BASE_APP/"
  else
    cp -R "$REPO_ROOT/." "$BASE_APP/"
    rm -rf \
      "$BASE_APP/.git" \
      "$BASE_APP/.grobot" \
      "$BASE_APP/.codex" \
      "$BASE_APP/.agents" \
      "$BASE_APP/.trellis" \
      "$BASE_APP/.github" \
      "$BASE_APP/.tmp" \
      "$BASE_APP/.grobot-contract-temp" \
      "$BASE_APP/logs" \
      "$BASE_APP/HANDOFF.md" \
      "$BASE_APP/node_modules" \
      "$BASE_APP/dist" \
      "$BASE_APP/runtime/target"
  fi

  mkdir -p "$BASE_APP/node_modules"
  for dep in toml ws; do
    if [ ! -d "$REPO_ROOT/node_modules/$dep" ]; then
      echo "missing node dependency: node_modules/$dep" >&2
      echo "hint: run npm install before packaging." >&2
      exit 1
    fi
    cp -R "$REPO_ROOT/node_modules/$dep" "$BASE_APP/node_modules/$dep"
  done

  echo "$VERSION" > "$BASE_APP/VERSION"
  ensure_executable "$BASE_APP/scripts/run-ts-dev-cli.sh"
  ensure_executable "$BASE_APP/scripts/install-bundle-native.sh"

  echo "[bundle] compile TypeScript CLI into app/gateway/dist"
  rm -rf "$BASE_APP/gateway/dist"
  npx --yes --package typescript@5.6.3 tsc \
    --project "$REPO_ROOT/gateway/tsconfig.json" \
    --outDir "$BASE_APP/gateway/dist" \
    --pretty false
}

ensure_rust_target() {
  local target="$1"
  if rustup target list --installed | grep -Fx "$target" >/dev/null 2>&1; then
    return 0
  fi
  rustup target add "$target"
}

build_host_platform() {
  local platform="$1"
  local target="$2"
  local launcher_out="$ARTIFACTS_DIR/$platform/grobot"
  local runtime_out="$ARTIFACTS_DIR/$platform/grobot-runtime"

  echo "[build] $platform via host target $target"
  ensure_rust_target "$target"
  mkdir -p "$ARTIFACTS_DIR/$platform"
  GROBOT_BUNDLE_VERSION="$VERSION" rustc --target "$target" "$LAUNCHER_RS" -O -o "$launcher_out"
  cargo build --manifest-path "$REPO_ROOT/runtime/Cargo.toml" --release --target "$target"
  cp "$REPO_ROOT/runtime/target/$target/release/grobot-runtime" "$runtime_out"
  ensure_executable "$launcher_out"
  ensure_executable "$runtime_out"
}

docker_available() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

build_linux_platform() {
  local platform="$1"
  local docker_platform="$2"
  local launcher_out="dist/release-bundles/artifacts/$platform/grobot"
  local target_dir="dist/release-bundles/cargo-$platform"

  echo "[build] $platform via docker $docker_platform"
  mkdir -p "$ARTIFACTS_DIR/$platform" "$BUILD_ROOT/cargo-$platform"
  docker run --rm \
    --platform "$docker_platform" \
    --user "$(id -u):$(id -g)" \
    -e "CARGO_HOME=/tmp/cargo-home" \
    -e "GROBOT_BUNDLE_VERSION=$VERSION" \
    -v "$REPO_ROOT:/work" \
    -w /work \
    "$RUST_IMAGE" \
    bash -lc "export PATH=/usr/local/cargo/bin:\$PATH; rustc /work/dist/release-bundles/portable-grobot.rs -O -o /work/$launcher_out && CARGO_TARGET_DIR=/work/$target_dir cargo build --manifest-path /work/runtime/Cargo.toml --release"
  cp "$REPO_ROOT/$target_dir/release/grobot-runtime" "$ARTIFACTS_DIR/$platform/grobot-runtime"
  ensure_executable "$ARTIFACTS_DIR/$platform/grobot"
  ensure_executable "$ARTIFACTS_DIR/$platform/grobot-runtime"
}

build_windows_platform() {
  local platform="windows-x64"
  local launcher_out="dist/release-bundles/artifacts/$platform/grobot.exe"
  local target_dir="dist/release-bundles/cargo-$platform"

  echo "[build] $platform via docker linux/amd64 + mingw"
  mkdir -p "$ARTIFACTS_DIR/$platform" "$BUILD_ROOT/cargo-$platform"
  docker run --rm \
    --platform linux/amd64 \
    -e "GROBOT_BUNDLE_VERSION=$VERSION" \
    -v "$REPO_ROOT:/work" \
    -w /work \
    "$RUST_IMAGE" \
    bash -lc "export PATH=/usr/local/cargo/bin:\$PATH; apt-get update >/dev/null && apt-get install -y --no-install-recommends mingw-w64 >/dev/null && rustup target add x86_64-pc-windows-gnu >/dev/null && rustc --target x86_64-pc-windows-gnu /work/dist/release-bundles/portable-grobot.rs -O -o /work/$launcher_out && CARGO_TARGET_DIR=/work/$target_dir cargo build --manifest-path /work/runtime/Cargo.toml --release --target x86_64-pc-windows-gnu && chown -R $(id -u):$(id -g) /work/dist/release-bundles/artifacts/$platform /work/$target_dir"
  cp "$REPO_ROOT/$target_dir/x86_64-pc-windows-gnu/release/grobot-runtime.exe" "$ARTIFACTS_DIR/$platform/grobot-runtime.exe"
}

build_artifacts() {
  rm -rf "$ARTIFACTS_DIR"
  mkdir -p "$ARTIFACTS_DIR"
  make_launcher_source

  build_host_platform "darwin-arm64" "aarch64-apple-darwin"
  build_host_platform "darwin-x64" "x86_64-apple-darwin"

  if [ "$SKIP_DOCKER" -eq 1 ]; then
    echo "[build] docker builds skipped"
    return 0
  fi
  if ! docker_available; then
    if [ "$ALLOW_MISSING" -eq 1 ]; then
      echo "[build] docker unavailable; linux/windows artifacts will be missing" >&2
      return 0
    fi
    echo "docker is required for linux/windows bundles on this host." >&2
    exit 1
  fi
  build_linux_platform "linux-x64" "linux/amd64"
  build_linux_platform "linux-arm64" "linux/arm64"
  build_windows_platform
}

write_readme() {
  local path="$1"
  local platform="$2"
  local command="$3"
  cat >"$path" <<EOF
Grobot portable bundle

Platform: $platform
Version:  $VERSION

Install:
  $command

After install:
  grobot --version
  grobot

Notes:
  - This bundle installs a native launcher plus the bundled Grobot app.
  - Node.js must be available in PATH for this pre-release bundle.
  - The installed command is stored under the current user's home directory.
EOF
}

write_windows_wrapper() {
  local path="$1"
  cat >"$path" <<'EOF'
Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"
$bundleRoot = Split-Path -Parent $PSCommandPath
$appRoot = Join-Path $bundleRoot "app"
$exe = Join-Path $bundleRoot "grobot.exe"
if (-not (Test-Path $exe)) {
  throw "missing bundled launcher: $exe"
}
if ($args.Count -gt 0 -and $args[0] -eq "install") {
  $installer = Join-Path $appRoot "scripts\install-bundle-native.ps1"
  if (-not (Test-Path $installer)) {
    throw "missing bundled installer: $installer"
  }
  $env:GROBOT_BUNDLE_ROOT = $bundleRoot
  & powershell -NoProfile -ExecutionPolicy Bypass -File $installer @($args | Select-Object -Skip 1)
  exit $LASTEXITCODE
}
$env:GROBOT_SOURCE_ROOT = $appRoot
& $exe @args
exit $LASTEXITCODE
EOF
}

write_manifest() {
  local manifest_path="$1"
  local platform="$2"
  shift 2
  node - "$manifest_path" "$VERSION" "$platform" "$@" <<'NODE'
const fs = require("node:fs");
const crypto = require("node:crypto");
const [manifestPath, version, platform, ...files] = process.argv.slice(2);
const artifacts = {};
for (const raw of files) {
  const [name, path] = raw.split("|", 2);
  if (!name || !path) continue;
  const data = fs.readFileSync(path);
  artifacts[name] = {
    file: name,
    sha256: crypto.createHash("sha256").update(data).digest("hex"),
    size_bytes: data.length,
  };
}
fs.writeFileSync(manifestPath, `${JSON.stringify({
  schema_version: 1,
  generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  version,
  platform,
  artifacts,
}, null, 2)}\n`, "utf8");
NODE
}

stage_unix_bundle() {
  local platform="$1"
  local stage="$STAGE_ROOT/grobot-$platform"
  local launcher="$ARTIFACTS_DIR/$platform/grobot"
  local runtime="$ARTIFACTS_DIR/$platform/grobot-runtime"
  if [ ! -x "$launcher" ] || [ ! -x "$runtime" ]; then
    if [ "$ALLOW_MISSING" -eq 1 ]; then
      echo "[skip] missing artifacts for $platform" >&2
      return 0
    fi
    echo "missing build artifacts for $platform" >&2
    exit 1
  fi

  rm -rf "$stage"
  mkdir -p "$stage"
  cp "$launcher" "$stage/grobot"
  cp "$launcher" "$stage/grobot-core-$platform"
  cp -R "$BASE_APP" "$stage/app"
  mkdir -p "$stage/app/runtime/target/debug" "$stage/app/runtime/target/release"
  cp "$runtime" "$stage/app/runtime/target/debug/grobot-runtime"
  cp "$runtime" "$stage/app/runtime/target/release/grobot-runtime"
  echo "$VERSION" > "$stage/VERSION"
  write_readme "$stage/README-FIRST.txt" "$platform" "./grobot install"
  ensure_executable "$stage/grobot"
  ensure_executable "$stage/grobot-core-$platform"
  ensure_executable "$stage/app/runtime/target/debug/grobot-runtime"
  ensure_executable "$stage/app/runtime/target/release/grobot-runtime"
  write_manifest "$stage/core-artifacts.manifest.json" "$platform" \
    "grobot|$stage/grobot" \
    "grobot-core-$platform|$stage/grobot-core-$platform" \
    "grobot-runtime|$stage/app/runtime/target/release/grobot-runtime"

  tar -C "$STAGE_ROOT" -czf "$OUTPUT_DIR/grobot-$platform.tar.gz" "grobot-$platform"
  echo "[bundle] $OUTPUT_DIR/grobot-$platform.tar.gz"
}

stage_windows_bundle() {
  local platform="windows-x64"
  local stage="$STAGE_ROOT/grobot-$platform"
  local launcher="$ARTIFACTS_DIR/$platform/grobot.exe"
  local runtime="$ARTIFACTS_DIR/$platform/grobot-runtime.exe"
  if [ ! -f "$launcher" ] || [ ! -f "$runtime" ]; then
    if [ "$ALLOW_MISSING" -eq 1 ]; then
      echo "[skip] missing artifacts for $platform" >&2
      return 0
    fi
    echo "missing build artifacts for $platform" >&2
    exit 1
  fi

  rm -rf "$stage"
  mkdir -p "$stage"
  cp "$launcher" "$stage/grobot.exe"
  cp "$launcher" "$stage/grobot-core-windows-x64.exe"
  cp -R "$BASE_APP" "$stage/app"
  mkdir -p "$stage/app/runtime/target/debug" "$stage/app/runtime/target/release"
  cp "$runtime" "$stage/app/runtime/target/debug/grobot-runtime.exe"
  cp "$runtime" "$stage/app/runtime/target/release/grobot-runtime.exe"
  echo "$VERSION" > "$stage/VERSION"
  write_windows_wrapper "$stage/grobot.ps1"
  write_readme "$stage/README-FIRST.txt" "$platform" ".\\grobot.ps1 install"
  write_manifest "$stage/core-artifacts.manifest.json" "$platform" \
    "grobot.exe|$stage/grobot.exe" \
    "grobot-core-windows-x64.exe|$stage/grobot-core-windows-x64.exe" \
    "grobot-runtime.exe|$stage/app/runtime/target/release/grobot-runtime.exe"

  (cd "$STAGE_ROOT" && zip -qr "$OUTPUT_DIR/grobot-$platform.zip" "grobot-$platform")
  echo "[bundle] $OUTPUT_DIR/grobot-$platform.zip"
}

write_summary() {
  local summary="$OUTPUT_DIR/SHA256SUMS.txt"
  : > "$summary"
  for file in "$OUTPUT_DIR"/grobot-*.tar.gz "$OUTPUT_DIR"/grobot-*.zip; do
    [ -f "$file" ] || continue
    printf '%s  %s\n' "$(sha256_file "$file")" "$(basename "$file")" >> "$summary"
  done
  cat >"$OUTPUT_DIR/README-FIRST.txt" <<EOF
Grobot release bundles

Version: $VERSION

Send the matching archive to the user:
  - macOS Apple Silicon: grobot-darwin-arm64.tar.gz
  - macOS Intel:         grobot-darwin-x64.tar.gz
  - Linux x64:           grobot-linux-x64.tar.gz
  - Linux arm64:         grobot-linux-arm64.tar.gz
  - Windows x64:         grobot-windows-x64.zip

First install:
  - macOS/Linux: ./grobot install
  - Windows PowerShell: .\\grobot.ps1 install

After install:
  grobot --version
  grobot

Pre-release note:
  These bundles include a native launcher and bundled Grobot app. Node.js is
  still required in PATH until the full standalone core is released.
EOF
}

cleanup_success_intermediates() {
  # Keep compiled platform artifacts for quick rebuilds, but remove copied app
  # trees so repository quality gates do not scan generated bundle contents.
  rm -rf "$BASE_APP" "$STAGE_ROOT"
}

main() {
  cd "$REPO_ROOT"
  rm -rf "$STAGE_ROOT"
  mkdir -p "$OUTPUT_DIR" "$BUILD_ROOT" "$STAGE_ROOT"

  prepare_base_app
  build_artifacts

  stage_unix_bundle "darwin-arm64"
  stage_unix_bundle "darwin-x64"
  stage_unix_bundle "linux-x64"
  stage_unix_bundle "linux-arm64"
  stage_windows_bundle
  write_summary
  cleanup_success_intermediates

  echo "release bundles ready:"
  echo "  $OUTPUT_DIR"
}

main
