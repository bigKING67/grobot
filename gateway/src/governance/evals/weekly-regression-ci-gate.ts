import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolveBaseSha } from "./skill-router-baseline-report";

type JsonObject = Record<string, unknown>;
type MetricName = "success_rate" | "first_pass_rate" | "token_cost" | "rollback_rate";

interface ParsedCliArgs {
  eventName: string;
  prBaseSha: string;
  beforeSha: string;
  baselineAvailable: string;
  repoRoot: string;
  outputPath: string;
  contextMemoryReportPath: string;
  contextMemoryBaseReportPath: string;
  runsPath: string;
  ledgerPath: string;
  autoLoopReportPath: string;
  policyPath: string;
  policyBlobPath: string;
  printJson: boolean;
}

interface WeeklyRegressionCiGateInput {
  eventName: string;
  prBaseSha: string;
  beforeSha: string;
  baselineAvailable: unknown;
  repoRoot: string;
  outputPath: string;
  contextMemoryReportPath: string;
  contextMemoryBaseReportPath: string;
  runsPath: string;
  ledgerPath: string;
  autoLoopReportPath: string;
  policyPath: string;
  policyBlobPath: string;
}

interface WeeklyRegressionCiGateResult {
  exit_code: number;
  phase: string;
  trend_mode?: string;
  trend_reason?: string;
}

interface MetricThreshold {
  direction: "higher_better" | "lower_better";
  min: number;
  max: number;
  max_drop: number;
  max_increase: number;
}

interface WeeklyRegressionPolicy {
  schema: string;
  metrics: Record<MetricName, MetricThreshold>;
}

interface MetricSnapshot {
  value: number;
  sample_size: number;
  source: string;
}

interface WeeklySnapshot {
  metrics: Record<MetricName, MetricSnapshot>;
}

interface TrendCompareResult {
  passed: boolean;
  failures: string[];
  baseline: Record<MetricName, number>;
  current: Record<MetricName, number>;
  deltas: Record<MetricName, number>;
}

const METRIC_NAMES: MetricName[] = [
  "success_rate",
  "first_pass_rate",
  "token_cost",
  "rollback_rate",
];

const DEFAULT_POLICY: WeeklyRegressionPolicy = {
  schema: "weekly_regression_policy@v1",
  metrics: {
    success_rate: {
      direction: "higher_better",
      min: 1,
      max: 1,
      max_drop: 0,
      max_increase: 0,
    },
    first_pass_rate: {
      direction: "higher_better",
      min: 1,
      max: 1,
      max_drop: 0,
      max_increase: 0,
    },
    token_cost: {
      direction: "lower_better",
      min: 0,
      max: 0.011,
      max_drop: 0,
      max_increase: 0,
    },
    rollback_rate: {
      direction: "lower_better",
      min: 0,
      max: 0,
      max_drop: 0,
      max_increase: 0,
    },
  },
};

function dirname(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function normalizeBool(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return false;
  }
  return value.trim().toLowerCase() === "true";
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function asObject(value: unknown): JsonObject {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function clampRate(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function toMetricNumber(value: number): number {
  return Number(value.toFixed(6));
}

function removeTrailingSlashes(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

function pathJoin(base: string, relative: string): string {
  const trimmedBase = removeTrailingSlashes(base);
  const trimmedRelative = relative.replace(/^[\\/]+/, "");
  return `${trimmedBase}/${trimmedRelative}`;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/");
}

function resolvePathFromRepoRoot(repoRoot: string, path: string): string {
  if (isAbsolutePath(path)) {
    return path;
  }
  return pathJoin(repoRoot, path);
}

function toRepoRelativePath(repoRoot: string, path: string): string | undefined {
  if (!path) {
    return undefined;
  }
  if (!isAbsolutePath(path)) {
    return path.replace(/^[\\/]+/, "");
  }
  const normalizedRoot = removeTrailingSlashes(repoRoot);
  const normalizedPath = path.replace(/[\\]+/g, "/");
  if (normalizedPath === normalizedRoot) {
    return "";
  }
  if (!normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return undefined;
  }
  return normalizedPath.slice(normalizedRoot.length + 1);
}

function runCapture(command: string[]): string | undefined {
  if (command.length === 0) {
    return undefined;
  }
  const result = spawnSync(command[0], command.slice(1), {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.status !== 0) {
    return undefined;
  }
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  return stdout.length > 0 ? stdout : undefined;
}

function parseArgs(argv: string[]): ParsedCliArgs {
  let eventName = "";
  let prBaseSha = "";
  let beforeSha = "";
  let baselineAvailable = "false";
  let repoRoot = ".";
  let outputPath = "gateway/evals/data/weekly_regression_ci_report.json";
  let contextMemoryReportPath = "gateway/evals/data/context_memory_ci_report.json";
  let contextMemoryBaseReportPath = "gateway/evals/data/context_memory_ci_report.base.json";
  let runsPath = "gateway/evals/fixtures/context_memory_runs.ci.jsonl";
  let ledgerPath = "gateway/evals/data/experiment_ledger_ci.jsonl";
  let autoLoopReportPath = "gateway/evals/data/auto_loop_ci_report.json";
  let policyPath = "gateway/evals/weekly_regression_policy.ci.json";
  let policyBlobPath = "gateway/evals/weekly_regression_policy.ci.json";
  let printJson = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--event-name") {
      eventName = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--pr-base-sha") {
      prBaseSha = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--before-sha") {
      beforeSha = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--baseline-available") {
      baselineAvailable = argv[index + 1] ?? "false";
      index += 1;
      continue;
    }
    if (token === "--repo-root") {
      repoRoot = argv[index + 1] ?? ".";
      index += 1;
      continue;
    }
    if (token === "--output") {
      outputPath = argv[index + 1] ?? outputPath;
      index += 1;
      continue;
    }
    if (token === "--context-memory-report") {
      contextMemoryReportPath = argv[index + 1] ?? contextMemoryReportPath;
      index += 1;
      continue;
    }
    if (token === "--context-memory-base-report") {
      contextMemoryBaseReportPath = argv[index + 1] ?? contextMemoryBaseReportPath;
      index += 1;
      continue;
    }
    if (token === "--runs-path") {
      runsPath = argv[index + 1] ?? runsPath;
      index += 1;
      continue;
    }
    if (token === "--ledger-path") {
      ledgerPath = argv[index + 1] ?? ledgerPath;
      index += 1;
      continue;
    }
    if (token === "--auto-loop-report") {
      autoLoopReportPath = argv[index + 1] ?? autoLoopReportPath;
      index += 1;
      continue;
    }
    if (token === "--policy") {
      policyPath = argv[index + 1] ?? policyPath;
      index += 1;
      continue;
    }
    if (token === "--policy-blob-path") {
      policyBlobPath = argv[index + 1] ?? policyBlobPath;
      index += 1;
      continue;
    }
    if (token === "--print-json") {
      printJson = true;
      continue;
    }
  }

  return {
    eventName,
    prBaseSha,
    beforeSha,
    baselineAvailable,
    repoRoot,
    outputPath,
    contextMemoryReportPath,
    contextMemoryBaseReportPath,
    runsPath,
    ledgerPath,
    autoLoopReportPath,
    policyPath,
    policyBlobPath,
    printJson,
  };
}

function parseJsonObject(path: string): JsonObject {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return asObject(parsed);
  } catch {
    return {};
  }
}

function parseJsonLines(path: string): JsonObject[] {
  if (!existsSync(path)) {
    return [];
  }
  try {
    const raw = readFileSync(path, "utf8");
    const rows: JsonObject[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const normalized = line.trim();
      if (!normalized) {
        continue;
      }
      const parsed = JSON.parse(normalized) as unknown;
      rows.push(asObject(parsed));
    }
    return rows;
  } catch {
    return [];
  }
}

function parseJsonLinesContent(raw: string): JsonObject[] {
  const rows: JsonObject[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const normalized = line.trim();
    if (!normalized) {
      continue;
    }
    try {
      const parsed = JSON.parse(normalized) as unknown;
      rows.push(asObject(parsed));
    } catch {
      continue;
    }
  }
  return rows;
}

function readFileAtRevision(repoRoot: string, baseSha: string, repoRelativePath: string): string | undefined {
  if (!repoRelativePath) {
    return undefined;
  }
  const spec = `${baseSha}:${repoRelativePath}`;
  const result = spawnSync("git", ["-C", repoRoot, "show", spec], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.status !== 0) {
    return undefined;
  }
  return typeof result.stdout === "string" ? result.stdout : undefined;
}

function readPolicy(path: string): { policy: WeeklyRegressionPolicy; hash: string | null } {
  if (!existsSync(path)) {
    return {
      policy: DEFAULT_POLICY,
      hash: null,
    };
  }
  try {
    const raw = readFileSync(path, "utf8");
    const payload = asObject(JSON.parse(raw));
    const metrics = asObject(payload.metrics);
    const normalized: Record<MetricName, MetricThreshold> = {
      success_rate: normalizeMetricPolicy(metrics.success_rate, DEFAULT_POLICY.metrics.success_rate),
      first_pass_rate: normalizeMetricPolicy(metrics.first_pass_rate, DEFAULT_POLICY.metrics.first_pass_rate),
      token_cost: normalizeMetricPolicy(metrics.token_cost, DEFAULT_POLICY.metrics.token_cost),
      rollback_rate: normalizeMetricPolicy(metrics.rollback_rate, DEFAULT_POLICY.metrics.rollback_rate),
    };
    return {
      policy: {
        schema: normalizeOptionalText(payload.schema) ?? DEFAULT_POLICY.schema,
        metrics: normalized,
      },
      hash: createHash("sha256").update(raw).digest("hex"),
    };
  } catch {
    return {
      policy: DEFAULT_POLICY,
      hash: null,
    };
  }
}

function normalizeMetricPolicy(raw: unknown, fallback: MetricThreshold): MetricThreshold {
  const payload = asObject(raw);
  const directionRaw = normalizeOptionalText(payload.direction);
  const direction =
    directionRaw === "higher_better" || directionRaw === "lower_better"
      ? directionRaw
      : fallback.direction;
  const min = asNumber(payload.min, fallback.min);
  const max = asNumber(payload.max, fallback.max);
  const maxDrop = asNumber(payload.max_drop, fallback.max_drop);
  const maxIncrease = asNumber(payload.max_increase, fallback.max_increase);
  return {
    direction,
    min,
    max,
    max_drop: Math.max(0, maxDrop),
    max_increase: Math.max(0, maxIncrease),
  };
}

function metricFromContextReport(report: JsonObject): MetricSnapshot {
  const variants = asObject(report.variants);
  const candidate = asObject(variants.candidate);
  const summary = asObject(candidate.summary);
  const passRate = clampRate(asNumber(summary.pass_rate, 0));
  const caseCount = Math.max(0, Math.trunc(asNumber(summary.case_count, 0)));
  return {
    value: toMetricNumber(passRate),
    sample_size: caseCount,
    source: "context_memory_report.candidate.summary.pass_rate",
  };
}

function metricFromRuns(runs: JsonObject[]): {
  firstPassRate: MetricSnapshot;
  tokenCost: MetricSnapshot;
} {
  const candidateRows = runs.filter((row) => normalizeOptionalText(row.variant) === "candidate");
  const total = candidateRows.length;
  const completedCount = candidateRows.filter((row) => row.completed === true).length;
  const firstPassRate = total > 0 ? clampRate(completedCount / total) : 0;

  const costValues = candidateRows
    .map((row) => asNumber(row.estimated_cost_usd, Number.NaN))
    .filter((value) => Number.isFinite(value));
  const avgCost =
    costValues.length > 0 ? costValues.reduce((sum, value) => sum + value, 0) / costValues.length : 0;

  return {
    firstPassRate: {
      value: toMetricNumber(firstPassRate),
      sample_size: total,
      source: "context_memory_runs.candidate.completed",
    },
    tokenCost: {
      value: toMetricNumber(avgCost),
      sample_size: costValues.length,
      source: "context_memory_runs.candidate.estimated_cost_usd",
    },
  };
}

function metricFromRollback(ledger: JsonObject[], autoLoopReport: JsonObject): MetricSnapshot {
  const runId = normalizeOptionalText(autoLoopReport.run_id);
  const loopRows = ledger.filter((row) => normalizeOptionalText(row.record_type) === "auto_loop_run");
  const scoped = runId
    ? (() => {
        const rows = loopRows.filter((row) => normalizeOptionalText(row.run_id) === runId);
        return rows.length > 0 ? rows : loopRows;
      })()
    : loopRows;
  if (scoped.length === 0) {
    return {
      value: 0,
      sample_size: 0,
      source: "experiment_ledger.auto_loop_run",
    };
  }
  const rollbackCount = scoped.filter((row) => {
    if (row.rollback_triggered === true) {
      return true;
    }
    if (normalizeOptionalText(row.promotion_state) === "rolled_back") {
      return true;
    }
    const decision = normalizeOptionalText(row.decision);
    return typeof decision === "string" && decision.toLowerCase().includes("rollback");
  }).length;
  const rate = clampRate(rollbackCount / scoped.length);
  return {
    value: toMetricNumber(rate),
    sample_size: scoped.length,
    source: runId
      ? "experiment_ledger.auto_loop_run(run_id scoped)"
      : "experiment_ledger.auto_loop_run(all)",
  };
}

function buildWeeklySnapshot(input: {
  contextReport: JsonObject;
  runsRows: JsonObject[];
  ledgerRows: JsonObject[];
  autoLoopReport: JsonObject;
}): WeeklySnapshot {
  const successRate = metricFromContextReport(input.contextReport);
  const runMetrics = metricFromRuns(input.runsRows);
  const rollbackRate = metricFromRollback(input.ledgerRows, input.autoLoopReport);
  return {
    metrics: {
      success_rate: successRate,
      first_pass_rate: runMetrics.firstPassRate,
      token_cost: runMetrics.tokenCost,
      rollback_rate: rollbackRate,
    },
  };
}

function evaluateGate(snapshot: WeeklySnapshot, policy: WeeklyRegressionPolicy): {
  passed: boolean;
  failures: string[];
} {
  const failures: string[] = [];
  for (const metric of METRIC_NAMES) {
    const threshold = policy.metrics[metric];
    const value = snapshot.metrics[metric].value;
    if (threshold.direction === "higher_better") {
      if (value < threshold.min) {
        failures.push(`metric=${metric} value ${value.toFixed(6)} < min ${threshold.min.toFixed(6)}`);
      }
    } else if (value > threshold.max) {
      failures.push(`metric=${metric} value ${value.toFixed(6)} > max ${threshold.max.toFixed(6)}`);
    }
  }
  return {
    passed: failures.length === 0,
    failures,
  };
}

function compareTrend(
  current: WeeklySnapshot,
  baseline: WeeklySnapshot,
  policy: WeeklyRegressionPolicy,
): TrendCompareResult {
  const failures: string[] = [];
  const baselineValues: Record<MetricName, number> = {
    success_rate: baseline.metrics.success_rate.value,
    first_pass_rate: baseline.metrics.first_pass_rate.value,
    token_cost: baseline.metrics.token_cost.value,
    rollback_rate: baseline.metrics.rollback_rate.value,
  };
  const currentValues: Record<MetricName, number> = {
    success_rate: current.metrics.success_rate.value,
    first_pass_rate: current.metrics.first_pass_rate.value,
    token_cost: current.metrics.token_cost.value,
    rollback_rate: current.metrics.rollback_rate.value,
  };
  const deltas: Record<MetricName, number> = {
    success_rate: 0,
    first_pass_rate: 0,
    token_cost: 0,
    rollback_rate: 0,
  };
  const epsilon = 1e-9;

  for (const metric of METRIC_NAMES) {
    const threshold = policy.metrics[metric];
    const baseValue = baselineValues[metric];
    const currentValue = currentValues[metric];
    if (threshold.direction === "higher_better") {
      const drop = baseValue - currentValue;
      deltas[metric] = toMetricNumber(drop);
      if (drop - threshold.max_drop > epsilon) {
        failures.push(
          `metric=${metric} drop ${drop.toFixed(6)} > max_drop ${threshold.max_drop.toFixed(6)}`,
        );
      }
    } else {
      const increase = currentValue - baseValue;
      deltas[metric] = toMetricNumber(increase);
      if (increase - threshold.max_increase > epsilon) {
        failures.push(
          `metric=${metric} increase ${increase.toFixed(6)} > max_increase ${threshold.max_increase.toFixed(6)}`,
        );
      }
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    baseline: baselineValues,
    current: currentValues,
    deltas,
  };
}

function buildTrendMeta(input: {
  mode: string;
  reason: string;
  required: boolean;
  baselineAvailable: unknown;
  baseSha: string | undefined;
  currentPolicyBlob: string | undefined;
  basePolicyBlob: string | undefined;
  policyBlobMatch: boolean | null;
  policyHash: string | null;
}): JsonObject {
  return {
    mode: input.mode,
    reason: input.reason,
    required: input.required,
    executed: input.mode === "gate_and_trend",
    baseline_available: normalizeBool(input.baselineAvailable),
    base_sha: input.baseSha ?? null,
    policy_blob_current: input.currentPolicyBlob ?? null,
    policy_blob_base: input.basePolicyBlob ?? null,
    policy_blob_match: input.policyBlobMatch,
    policy_hash_current: input.policyHash,
    policy_hash_base: input.policyHash,
    policy_hash_match: input.policyBlobMatch,
  };
}

function buildFallbackBaselineFromCurrent(snapshot: WeeklySnapshot): WeeklySnapshot {
  return {
    metrics: {
      success_rate: { ...snapshot.metrics.success_rate },
      first_pass_rate: { ...snapshot.metrics.first_pass_rate },
      token_cost: { ...snapshot.metrics.token_cost },
      rollback_rate: { ...snapshot.metrics.rollback_rate },
    },
  };
}

function writeReport(path: string, payload: JsonObject): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, undefined, 2)}\n`, "utf8");
}

export function runWeeklyRegressionCiGate(input: WeeklyRegressionCiGateInput): WeeklyRegressionCiGateResult {
  const repoRoot = removeTrailingSlashes(input.repoRoot);
  const outputPath = resolvePathFromRepoRoot(repoRoot, input.outputPath);
  const contextMemoryReportPath = resolvePathFromRepoRoot(repoRoot, input.contextMemoryReportPath);
  const contextMemoryBaseReportPath = resolvePathFromRepoRoot(repoRoot, input.contextMemoryBaseReportPath);
  const runsPath = resolvePathFromRepoRoot(repoRoot, input.runsPath);
  const ledgerPath = resolvePathFromRepoRoot(repoRoot, input.ledgerPath);
  const autoLoopReportPath = resolvePathFromRepoRoot(repoRoot, input.autoLoopReportPath);
  const policyPath = resolvePathFromRepoRoot(repoRoot, input.policyPath);

  const { policy, hash: policyHash } = readPolicy(policyPath);
  const currentContextReport = parseJsonObject(contextMemoryReportPath);
  const currentRuns = parseJsonLines(runsPath);
  const currentLedger = parseJsonLines(ledgerPath);
  const currentAutoLoop = parseJsonObject(autoLoopReportPath);
  const currentSnapshot = buildWeeklySnapshot({
    contextReport: currentContextReport,
    runsRows: currentRuns,
    ledgerRows: currentLedger,
    autoLoopReport: currentAutoLoop,
  });
  const gate = evaluateGate(currentSnapshot, policy);
  if (!gate.passed) {
    const report: JsonObject = {
      schema: "weekly_regression_ci_gate@v1",
      generated_at: new Date().toISOString(),
      policy: {
        schema: policy.schema,
        hash: policyHash,
      },
      gate,
      trend: null,
      trend_meta: {
        mode: "gate_only",
        reason: "gate_failed",
        required: false,
        executed: false,
      },
      current: currentSnapshot,
      overall_gate: {
        passed: false,
        failures: [...gate.failures],
      },
    };
    writeReport(outputPath, report);
    return {
      exit_code: 5,
      phase: "gate_eval",
      trend_mode: "gate_only",
      trend_reason: "gate_failed",
    };
  }

  const baselineAvailableFlag = normalizeBool(input.baselineAvailable);
  const baseSha = resolveBaseSha({
    eventName: input.eventName,
    prBaseSha: input.prBaseSha,
    beforeSha: input.beforeSha,
  });

  const currentPolicyBlob = runCapture(["git", "-C", repoRoot, "rev-parse", `HEAD:${input.policyBlobPath}`]);
  let basePolicyBlob: string | undefined;
  if (baselineAvailableFlag && typeof baseSha === "string") {
    basePolicyBlob = runCapture(["git", "-C", repoRoot, "rev-parse", `${baseSha}:${input.policyBlobPath}`]);
  }

  let trendMode = "gate_only";
  let trendReason = "baseline_unavailable";
  let trendRequired = false;
  let policyBlobMatch: boolean | null = null;
  let baselineSnapshot = buildFallbackBaselineFromCurrent(currentSnapshot);
  let trend: TrendCompareResult | null = null;

  if (baselineAvailableFlag) {
    trendReason = "baseline_report_missing";
    if (existsSync(contextMemoryBaseReportPath)) {
      trendReason = "policy_blob_unavailable";
      if (typeof currentPolicyBlob === "string" && typeof basePolicyBlob === "string") {
        if (currentPolicyBlob === basePolicyBlob) {
          policyBlobMatch = true;
          trendMode = "gate_and_trend";
          trendReason = "policy_blob_match";
          trendRequired = true;

          const baseContextReport = parseJsonObject(contextMemoryBaseReportPath);
          const runsRepoPath = toRepoRelativePath(repoRoot, runsPath);
          const ledgerRepoPath = toRepoRelativePath(repoRoot, ledgerPath);
          const autoLoopRepoPath = toRepoRelativePath(repoRoot, autoLoopReportPath);
          const baseRunsContent =
            typeof baseSha === "string" && runsRepoPath
              ? readFileAtRevision(repoRoot, baseSha, runsRepoPath)
              : undefined;
          const baseLedgerContent =
            typeof baseSha === "string" && ledgerRepoPath
              ? readFileAtRevision(repoRoot, baseSha, ledgerRepoPath)
              : undefined;
          const baseAutoLoopContent =
            typeof baseSha === "string" && autoLoopRepoPath
              ? readFileAtRevision(repoRoot, baseSha, autoLoopRepoPath)
              : undefined;

          const baseRuns = typeof baseRunsContent === "string" ? parseJsonLinesContent(baseRunsContent) : [];
          const baseLedger = typeof baseLedgerContent === "string" ? parseJsonLinesContent(baseLedgerContent) : [];
          let baseAutoLoop: JsonObject = {};
          if (typeof baseAutoLoopContent === "string") {
            try {
              baseAutoLoop = asObject(JSON.parse(baseAutoLoopContent) as unknown);
            } catch {
              baseAutoLoop = {};
            }
          }

          baselineSnapshot = buildWeeklySnapshot({
            contextReport: baseContextReport,
            runsRows: baseRuns,
            ledgerRows: baseLedger,
            autoLoopReport: baseAutoLoop,
          });
          trend = compareTrend(currentSnapshot, baselineSnapshot, policy);
        } else {
          policyBlobMatch = false;
          trendReason = "policy_blob_mismatch";
        }
      }
    }
  }

  const trendMeta = buildTrendMeta({
    mode: trendMode,
    reason: trendReason,
    required: trendRequired,
    baselineAvailable: input.baselineAvailable,
    baseSha,
    currentPolicyBlob,
    basePolicyBlob,
    policyBlobMatch,
    policyHash,
  });

  const overallFailures: string[] = [];
  overallFailures.push(...gate.failures);
  if (trendRequired) {
    if (!trend || !trend.passed) {
      overallFailures.push(...(trend?.failures ?? ["trend result missing"]));
    }
  }

  const report: JsonObject = {
    schema: "weekly_regression_ci_gate@v1",
    generated_at: new Date().toISOString(),
    policy: {
      schema: policy.schema,
      hash: policyHash,
      metrics: policy.metrics,
    },
    current: currentSnapshot,
    baseline: baselineSnapshot,
    gate,
    trend,
    trend_meta: trendMeta,
    overall_gate: {
      passed: overallFailures.length === 0,
      failures: overallFailures,
    },
  };
  writeReport(outputPath, report);

  if (trendRequired && trend != null && !trend.passed) {
    return {
      exit_code: 6,
      phase: "trend_eval",
      trend_mode: trendMode,
      trend_reason: trendReason,
    };
  }
  return {
    exit_code: 0,
    phase: "done",
    trend_mode: trendMode,
    trend_reason: trendReason,
  };
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const result = runWeeklyRegressionCiGate({
    eventName: args.eventName,
    prBaseSha: args.prBaseSha,
    beforeSha: args.beforeSha,
    baselineAvailable: args.baselineAvailable,
    repoRoot: args.repoRoot,
    outputPath: args.outputPath,
    contextMemoryReportPath: args.contextMemoryReportPath,
    contextMemoryBaseReportPath: args.contextMemoryBaseReportPath,
    runsPath: args.runsPath,
    ledgerPath: args.ledgerPath,
    autoLoopReportPath: args.autoLoopReportPath,
    policyPath: args.policyPath,
    policyBlobPath: args.policyBlobPath,
  });
  if (args.printJson) {
    process.stdout.write(`${JSON.stringify({ weekly_regression_ci_gate: result }, undefined, 0)}\n`);
  }
  return typeof result.exit_code === "number" ? result.exit_code : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`weekly-regression-ci-gate fatal: ${String(error)}\n`);
  process.exitCode = 1;
}
