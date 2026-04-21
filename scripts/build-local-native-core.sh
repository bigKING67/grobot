#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/build-local-native-core.sh [options]

Build a local native launcher binary.
It delegates `install`/`--version` to the repo CLI wrapper, and all other commands
to scripts/run-ts-dev-cli.sh.
This is a stopgap for local native startup before a full standalone grobot-core is published.

Options:
  --output <path>      Output binary path
                       (default: dist/native/grobot-core-<platform>)
  --repo-root <path>   Grobot source root embedded into launcher
                       (default: current repo root)
  -h, --help           Show help
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

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLATFORM_KEY="$(detect_platform_key)"
if [ -z "$PLATFORM_KEY" ]; then
  echo "unsupported platform for local native launcher build" >&2
  exit 1
fi

OUTPUT_PATH="$REPO_ROOT/dist/native/grobot-core-${PLATFORM_KEY}"
EMBEDDED_REPO_ROOT="$REPO_ROOT"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --output" >&2
        exit 1
      fi
      OUTPUT_PATH="$2"
      shift 2
      ;;
    --repo-root)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --repo-root" >&2
        exit 1
      fi
      EMBEDDED_REPO_ROOT="$2"
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

if ! command -v rustc >/dev/null 2>&1; then
  echo "rustc is required to build local native launcher." >&2
  exit 1
fi

if [ ! -x "$EMBEDDED_REPO_ROOT/scripts/run-ts-dev-cli.sh" ]; then
  echo "missing runner under repo root: $EMBEDDED_REPO_ROOT/scripts/run-ts-dev-cli.sh" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_PATH")"
TMP_RS="$(mktemp)"
cleanup() {
  rm -f "$TMP_RS"
}
trap cleanup EXIT

RUST_REPO_ROOT="$EMBEDDED_REPO_ROOT"
RUST_REPO_ROOT="${RUST_REPO_ROOT//\\/\\\\}"
RUST_REPO_ROOT="${RUST_REPO_ROOT//\"/\\\"}"

cat >"$TMP_RS" <<RS
use std::env;
use std::path::Path;
use std::process::{Command, ExitCode};

fn status_to_exit(status: std::process::ExitStatus) -> ExitCode {
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

fn main() -> ExitCode {
    let default_repo = "$RUST_REPO_ROOT";
    let repo_root = env::var("GROBOT_SOURCE_ROOT").unwrap_or_else(|_| default_repo.to_string());
    let args: Vec<String> = env::args().skip(1).collect();
    let first_arg = args.first().map(String::as_str).unwrap_or("");

    if first_arg == "install" {
        let installer = format!("{}/scripts/install-core-native.sh", repo_root);
        if !Path::new(&installer).exists() {
            eprintln!("error: missing installer script: {}", installer);
            eprintln!("hint: set GROBOT_SOURCE_ROOT to a valid grobot source checkout.");
            return ExitCode::from(1);
        }

        let mut cmd = Command::new(&installer);
        cmd.args(args.iter().skip(1));
        cmd.env("GROBOT_SOURCE_ROOT", &repo_root);
        return run_command(cmd, "failed to launch native installer");
    }

    if matches!(first_arg, "--version" | "-V" | "version") {
        let wrapper = format!("{}/packages/cli/bin/grobot", repo_root);
        if Path::new(&wrapper).exists() {
            let mut cmd = Command::new(&wrapper);
            cmd.arg("--version");
            cmd.env("GROBOT_SOURCE_ROOT", &repo_root);
            return run_command(cmd, "failed to show version");
        }
        println!("grobot dev");
        return ExitCode::from(0);
    }

    let runner = format!("{}/scripts/run-ts-dev-cli.sh", repo_root);

    if !Path::new(&runner).exists() {
        eprintln!("error: missing ts-dev-cli runner: {}", runner);
        eprintln!("hint: set GROBOT_SOURCE_ROOT to a valid grobot source checkout.");
        return ExitCode::from(1);
    }

    let mut cmd = Command::new(&runner);
    cmd.args(&args);
    cmd.env("GROBOT_SOURCE_ROOT", &repo_root);
    if env::var("GROBOT_ALLOW_REDIS_FALLBACK").is_err() {
        cmd.env("GROBOT_ALLOW_REDIS_FALLBACK", "1");
    }
    run_command(cmd, "failed to launch ts-dev-cli runner")
}
RS

rustc "$TMP_RS" -O -o "$OUTPUT_PATH"
chmod +x "$OUTPUT_PATH"

echo "local native launcher built."
echo "  platform: $PLATFORM_KEY"
echo "  output:   $OUTPUT_PATH"
echo
echo "next:"
echo "  ./grobot install local-dev --binary \"$OUTPUT_PATH\" --platform \"$PLATFORM_KEY\""
