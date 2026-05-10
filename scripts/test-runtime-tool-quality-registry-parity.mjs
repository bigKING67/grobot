#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  readRuntimeToolQualityRegistry,
  resolveRuntimeToolQualitySignal,
} from "./lib/runtime-tool-quality-report.mjs";

const repoRoot = process.cwd();
const tmpDir = mkdtempSync(join(tmpdir(), "grobot-runtime-tool-quality-registry-parity-"));
const registryJson = JSON.parse(readFileSync("shared/contracts/runtime-tool-quality-v1.json", "utf8"));
const releaseRegistry = readRuntimeToolQualityRegistry();

process.on("exit", () => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function fail(message, details = {}) {
  const suffix = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : "";
  throw new Error(`${message}${suffix}`);
}

function expect(condition, message, details = {}) {
  if (!condition) {
    fail(message, details);
  }
}

function localBin(name) {
  const binaryName = process.platform === "win32" ? `${name}.cmd` : name;
  const candidate = resolve(repoRoot, "node_modules", ".bin", binaryName);
  return existsSync(candidate) ? candidate : name;
}

function tsxCommand(scriptPath) {
  const tsxBin = localBin("tsx");
  if (tsxBin !== "tsx") {
    return [tsxBin, scriptPath];
  }
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return [npx, "--yes", "--package", "tsx@4.20.6", "tsx", scriptPath];
}

function reasonRows() {
  return [
    ...registryJson.failure_reasons,
    ...registryJson.warning_reasons,
  ];
}

function reasonsForSurface(surface) {
  return reasonRows()
    .filter((row) => Array.isArray(row.surfaces) && row.surfaces.includes(surface))
    .map((row) => row.reason);
}

function normalizeReleaseSignal(signal) {
  return signal
    ? {
        actionReason: signal.reason,
        actionFamily: signal.actionFamily,
        actionRequired: signal.actionRequired,
        defaultNextStep: signal.defaultNextStep,
        priority: signal.priority,
      }
    : null;
}

function resolveReleaseCase(testCase) {
  try {
    return {
      id: testCase.id,
      ok: true,
      value: normalizeReleaseSignal(
        resolveRuntimeToolQualitySignal(testCase.reasons, testCase.surface, releaseRegistry),
      ),
    };
  } catch (error) {
    return {
      id: testCase.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const statusReasons = reasonsForSurface("status");
const releaseReasons = reasonsForSurface("release");
const cases = [
  {
    id: "status_empty",
    surface: "status",
    reasons: [],
  },
  {
    id: "release_empty",
    surface: "release",
    reasons: [],
  },
  ...statusReasons.map((reason) => ({
    id: `status_single:${reason}`,
    surface: "status",
    reasons: [reason],
  })),
  ...releaseReasons.map((reason) => ({
    id: `release_single:${reason}`,
    surface: "release",
    reasons: [reason],
  })),
  {
    id: "status_all_reasons_priority",
    surface: "status",
    reasons: [...statusReasons].reverse(),
  },
  {
    id: "release_all_reasons_priority",
    surface: "release",
    reasons: [...releaseReasons].reverse(),
  },
  {
    id: "status_wrong_surface_release_reason",
    surface: "status",
    reasons: ["report_parse_error"],
  },
  {
    id: "release_wrong_surface_status_reason",
    surface: "release",
    reasons: ["runtime_health_failed"],
  },
  {
    id: "status_unknown_reason",
    surface: "status",
    reasons: ["unknown_runtime_tool_quality_reason"],
  },
];

const harnessPath = join(tmpDir, "runtime-tool-quality-registry-parity-harness.ts");
writeFileSync(harnessPath, `
import { resolveRuntimeToolQualitySignalFromRegistry } from ${JSON.stringify(resolve(repoRoot, "gateway/src/cli/status/runtime-tool-quality-registry.ts"))};

type RuntimeToolQualitySurface = "status" | "release";
interface TestCase {
  id: string;
  surface: RuntimeToolQualitySurface;
  reasons: string[];
}

function resolveCase(testCase: TestCase) {
  try {
    return {
      id: testCase.id,
      ok: true,
      value: resolveRuntimeToolQualitySignalFromRegistry({
        actionReasons: testCase.reasons,
        surface: testCase.surface,
      }),
    };
  } catch (error) {
    return {
      id: testCase.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const cases = JSON.parse(process.env.RUNTIME_TOOL_QUALITY_PARITY_CASES ?? "[]") as TestCase[];
process.stdout.write(JSON.stringify({
  ok: true,
  results: cases.map(resolveCase),
}) + "\\n");
`, "utf8");

const tsCommand = tsxCommand(harnessPath);
const tsResult = spawnSync(tsCommand[0], tsCommand.slice(1), {
  cwd: repoRoot,
  encoding: "utf8",
  env: {
    ...process.env,
    RUNTIME_TOOL_QUALITY_PARITY_CASES: JSON.stringify(cases),
  },
});

expect(tsResult.status === 0, "TS registry parity harness must pass", {
  status: tsResult.status,
  signal: tsResult.signal,
  stdout: tsResult.stdout.slice(-1000),
  stderr: tsResult.stderr.slice(-1000),
});

let parsedTs = null;
try {
  parsedTs = JSON.parse(tsResult.stdout);
} catch (error) {
  fail("TS registry parity harness must emit JSON", {
    error: error instanceof Error ? error.message : String(error),
    stdout: tsResult.stdout.slice(-1000),
    stderr: tsResult.stderr.slice(-1000),
  });
}

const releaseResults = new Map(cases.map((testCase) => [
  testCase.id,
  resolveReleaseCase(testCase),
]));
const tsResults = new Map(parsedTs.results.map((result) => [result.id, result]));
const mismatches = [];

for (const testCase of cases) {
  const releaseResult = releaseResults.get(testCase.id);
  const statusResult = tsResults.get(testCase.id);
  if (!statusResult) {
    mismatches.push({
      id: testCase.id,
      issue: "missing_ts_result",
      release: releaseResult,
    });
    continue;
  }
  if (JSON.stringify(statusResult) !== JSON.stringify(releaseResult)) {
    mismatches.push({
      id: testCase.id,
      status_result: statusResult,
      release_result: releaseResult,
    });
  }
}

expect(mismatches.length === 0, "status TS resolver and release JS resolver must stay behaviorally identical", {
  mismatches,
});

process.stdout.write(JSON.stringify({
  ok: true,
  parity_case_count: cases.length,
  status_reason_count: statusReasons.length,
  release_reason_count: releaseReasons.length,
  invalid_case_count: 3,
  priority_cases: [
    releaseResults.get("status_all_reasons_priority")?.value?.actionReason,
    releaseResults.get("release_all_reasons_priority")?.value?.actionReason,
  ],
}) + "\n");
