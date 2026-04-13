#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/core-release-prepare.sh --artifacts-dir <dir> [options]

Options:
  --artifacts-dir <dir>   Directory containing platform binaries (required)
  --manifest-out <file>   Manifest output path (default: <artifacts-dir>/core-artifacts.manifest.json)
  --allow-stub            Allow placeholder stub binaries (dev only)
  --dry-run               Validate pipeline without copying artifacts into packages/
  --skip-gate             Skip final core release gate
  --skip-pack-dryrun      Forward to core release gate
  --report-dir <dir>      Write report JSON files to directory (default: <artifacts-dir>)
  -h, --help              Show help
EOF
}

ARTIFACTS_DIR=""
MANIFEST_OUT=""
ALLOW_STUB=0
DRY_RUN=0
SKIP_GATE=0
SKIP_PACK_DRYRUN=0
REPORT_DIR=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --artifacts-dir)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --artifacts-dir" >&2
        exit 1
      fi
      ARTIFACTS_DIR="$2"
      shift 2
      ;;
    --manifest-out)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --manifest-out" >&2
        exit 1
      fi
      MANIFEST_OUT="$2"
      shift 2
      ;;
    --allow-stub)
      ALLOW_STUB=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --skip-gate)
      SKIP_GATE=1
      shift
      ;;
    --skip-pack-dryrun)
      SKIP_PACK_DRYRUN=1
      shift
      ;;
    --report-dir)
      if [ "$#" -lt 2 ]; then
        echo "missing value for --report-dir" >&2
        exit 1
      fi
      REPORT_DIR="$2"
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

if [ -z "$ARTIFACTS_DIR" ]; then
  echo "--artifacts-dir is required" >&2
  usage
  exit 1
fi

if [ ! -d "$ARTIFACTS_DIR" ]; then
  echo "artifacts directory not found: $ARTIFACTS_DIR" >&2
  exit 1
fi

if [ -z "$MANIFEST_OUT" ]; then
  MANIFEST_OUT="$ARTIFACTS_DIR/core-artifacts.manifest.json"
fi

if [ -z "$REPORT_DIR" ]; then
  REPORT_DIR="$ARTIFACTS_DIR"
fi
mkdir -p "$REPORT_DIR"

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GEN_ARGS=(--artifacts-dir "$ARTIFACTS_DIR" --output "$MANIFEST_OUT")
if [ "$ALLOW_STUB" -eq 1 ]; then
  GEN_ARGS+=(--allow-stub)
fi

STAGE_ARGS=(--artifacts-dir "$ARTIFACTS_DIR" --manifest "$MANIFEST_OUT")
if [ "$ALLOW_STUB" -eq 1 ]; then
  STAGE_ARGS+=(--allow-stub)
fi
if [ "$DRY_RUN" -eq 1 ]; then
  STAGE_ARGS+=(--dry-run)
fi

GATE_ARGS=(--report "$REPORT_DIR/core-release-gate-report.json")
if [ "$ALLOW_STUB" -eq 1 ]; then
  GATE_ARGS+=(--allow-stub)
fi
if [ "$SKIP_PACK_DRYRUN" -eq 1 ]; then
  GATE_ARGS+=(--skip-pack-dryrun)
fi

echo "[prepare] generate manifest"
bash "$SCRIPT_DIR/core-generate-manifest.sh" "${GEN_ARGS[@]}"

echo "[prepare] stage artifacts"
bash "$SCRIPT_DIR/core-stage-artifacts.sh" "${STAGE_ARGS[@]}"

if [ "$SKIP_GATE" -eq 1 ]; then
  echo "[prepare] gate skipped by --skip-gate"
else
  echo "[prepare] run release gate"
  bash "$SCRIPT_DIR/core-release-gate.sh" "${GATE_ARGS[@]}"
fi

SUMMARY_PATH="$REPORT_DIR/core-release-prepare-summary.json"
node - \
  "$SUMMARY_PATH" \
  "$ARTIFACTS_DIR" \
  "$MANIFEST_OUT" \
  "$REPORT_DIR" \
  "$ALLOW_STUB" \
  "$DRY_RUN" \
  "$SKIP_GATE" \
  "$SKIP_PACK_DRYRUN" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const summaryPath = process.argv[2] ?? "";
const artifactsDir = process.argv[3] ?? "";
const manifestOut = process.argv[4] ?? "";
const reportDir = process.argv[5] ?? "";
const allowStub = (process.argv[6] ?? "0") === "1";
const dryRun = (process.argv[7] ?? "0") === "1";
const skipGate = (process.argv[8] ?? "0") === "1";
const skipPackDryrun = (process.argv[9] ?? "0") === "1";

const payload = {
  schema_version: 1,
  generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  artifacts_dir: artifactsDir,
  manifest_out: manifestOut,
  report_dir: reportDir,
  options: {
    allow_stub: allowStub,
    dry_run: dryRun,
    skip_gate: skipGate,
    skip_pack_dryrun: skipPackDryrun,
  },
  reports: {
    prepare_summary: summaryPath,
    gate_report: skipGate ? "" : `${reportDir}/core-release-gate-report.json`,
  },
};

fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(summaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
NODE

echo "core release prepare completed."
echo "  manifest:      $MANIFEST_OUT"
echo "  prepare_report:$SUMMARY_PATH"
if [ "$SKIP_GATE" -eq 0 ]; then
  echo "  gate_report:   $REPORT_DIR/core-release-gate-report.json"
fi
