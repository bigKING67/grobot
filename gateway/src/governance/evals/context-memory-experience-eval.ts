import { writeFileSync } from "node:fs";
import { runHarness } from "./hill-climb";

type HarnessReport = ReturnType<typeof runHarness>;
type HarnessVariantReport = HarnessReport["variants"][string];
type HarnessCaseRow = HarnessVariantReport["cases"][number];

type MetricName =
  | "task_success"
  | "tool_use_quality"
  | "context_retention"
  | "safety_compliance"
  | "latency_cost";

type SaturationMetricName = "task_success" | "tool_use_quality" | "context_retention";
type DimensionName = "context_compression" | "memory_lineage" | "experience_learning";

interface ParsedCliArgs {
  cases: string;
  runs: string;
  gatePolicy: string | null;
  output: string | null;
  printJson: boolean;
  failOnGate: boolean;
}

interface DimensionThreshold {
  minCaseCount: number;
  minAverageScore: number;
  minPassRate: number;
  minPassRateLowerBound: number;
  minMetricAverages: Partial<Record<MetricName, number>>;
}

interface DimensionSummary {
  dimension: DimensionName;
  case_count: number;
  pass_count: number;
  pass_rate: number;
  pass_rate_lower_bound: number;
  average_score: number;
  metric_averages: Record<MetricName, number>;
  failed_case_ids: string[];
}

interface VariantDimensionReport {
  variant: string;
  harness_gate: {
    passed: boolean;
    failures: string[];
  };
  dimension_gate: {
    passed: boolean;
    failures: string[];
  };
  summary: HarnessVariantReport["summary"];
  splits: HarnessVariantReport["splits"];
  reward_v1: HarnessVariantReport["reward_v1"];
  dimensions: Record<DimensionName, DimensionSummary>;
}

interface DimensionDelta {
  baseline_average_score: number;
  candidate_average_score: number;
  average_score_drop: number;
  baseline_pass_rate: number;
  candidate_pass_rate: number;
  pass_rate_drop: number;
}

interface DimensionRegressionGuardReport {
  passed: boolean;
  baseline_variant: string;
  candidate_variant: string;
  max_score_drop: number;
  max_pass_rate_drop: number;
  dimensions: DimensionName[];
  deltas: Record<DimensionName, DimensionDelta>;
  failures: string[];
}

interface SaturationPolicyPayload {
  max_perfect_case_rate: number;
  min_metric_variance: number;
  monitored_metrics: SaturationMetricName[];
}

interface SaturationMetricSnapshot {
  mean: number;
  variance: number;
}

interface VariantSaturationGuardReport {
  variant: string;
  case_count: number;
  perfect_case_count: number;
  perfect_case_rate: number;
  max_metric_variance: number;
  monitored_metrics: Record<SaturationMetricName, SaturationMetricSnapshot>;
  triggered: boolean;
  reasons: string[];
}

interface ContextMemoryEvalReport {
  schema: "context_memory_experience_eval@v2";
  generated_at: string;
  inputs: {
    cases: string;
    runs: string;
    gate_policy: string | null;
  };
  coverage_policy: {
    min_variant_case_count: number;
    min_holdout_case_count: number;
    min_optimization_case_count: number;
  };
  dimension_policy: Record<DimensionName, {
    min_case_count: number;
    min_average_score: number;
    min_pass_rate: number;
    min_pass_rate_lower_bound: number;
    min_metric_averages: Partial<Record<MetricName, number>>;
  }>;
  saturation_policy: SaturationPolicyPayload;
  variants: Record<string, VariantDimensionReport>;
  saturation_guard: Record<string, VariantSaturationGuardReport>;
  harness_regression_guard: HarnessReport["regression_guard"] | null;
  dimension_regression_guard: DimensionRegressionGuardReport;
  overall_gate: {
    passed: boolean;
    failures: string[];
  };
}

const METRIC_NAMES: MetricName[] = [
  "task_success",
  "tool_use_quality",
  "context_retention",
  "safety_compliance",
  "latency_cost",
];

const DIMENSION_TAG_ALIASES: Record<DimensionName, string[]> = {
  context_compression: ["context_compression", "context_compaction", "compression", "budget_control"],
  memory_lineage: ["memory_lineage", "memory_recall", "lineage_recall", "memory_decay", "memory_reconcile"],
  experience_learning: ["experience_learning", "experience_reuse", "strategy_transfer", "self_correction"],
};

const DIMENSION_THRESHOLDS: Record<DimensionName, DimensionThreshold> = {
  context_compression: {
    minCaseCount: 10,
    minAverageScore: 0.82,
    minPassRate: 0.8,
    minPassRateLowerBound: 0.72,
    minMetricAverages: {
      context_retention: 0.86,
      task_success: 0.74,
    },
  },
  memory_lineage: {
    minCaseCount: 10,
    minAverageScore: 0.8,
    minPassRate: 0.75,
    minPassRateLowerBound: 0.68,
    minMetricAverages: {
      context_retention: 0.74,
      task_success: 0.78,
    },
  },
  experience_learning: {
    minCaseCount: 10,
    minAverageScore: 0.78,
    minPassRate: 0.75,
    minPassRateLowerBound: 0.68,
    minMetricAverages: {
      tool_use_quality: 0.82,
      task_success: 0.75,
    },
  },
};

const COVERAGE_POLICY = {
  minVariantCaseCount: 36,
  minHoldoutCaseCount: 16,
  minOptimizationCaseCount: 12,
};

const DIMENSION_REGRESSION_GUARD = {
  baselineVariant: "baseline",
  candidateVariant: "candidate",
  dimensions: ["context_compression", "memory_lineage", "experience_learning"] as DimensionName[],
  maxScoreDrop: 0,
  maxPassRateDrop: 0,
};

const SATURATION_POLICY = {
  maxPerfectCaseRate: 0.95,
  minMetricVariance: 1e-4,
  monitoredMetrics: ["task_success", "tool_use_quality", "context_retention"] as SaturationMetricName[],
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function parseArgs(argv: string[]): ParsedCliArgs {
  const args: ParsedCliArgs = {
    cases: "",
    runs: "",
    gatePolicy: null,
    output: null,
    printJson: false,
    failOnGate: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const readValue = (): string => {
      const value = argv[index + 1] ?? "";
      if (!value || value.startsWith("--")) {
        throw new Error(`missing value for ${token}`);
      }
      return value;
    };

    switch (token) {
      case "--cases":
        args.cases = readValue();
        index += 1;
        break;
      case "--runs":
        args.runs = readValue();
        index += 1;
        break;
      case "--gate-policy":
        args.gatePolicy = readValue();
        index += 1;
        break;
      case "--output":
        args.output = readValue();
        index += 1;
        break;
      case "--print-json":
        args.printJson = true;
        break;
      case "--fail-on-gate":
        args.failOnGate = true;
        break;
      default:
        throw new Error(`unknown argument: ${token}`);
    }
  }

  if (!args.cases) {
    throw new Error("missing required args: --cases");
  }
  if (!args.runs) {
    throw new Error("missing required args: --runs");
  }
  return args;
}

function normalizeTag(value: string): string {
  return value.trim().toLowerCase();
}

function metricAverage(rows: HarnessCaseRow[], metric: MetricName): number {
  if (rows.length === 0) {
    return 0;
  }
  const total = rows.reduce((sum, row) => {
    const metrics = row.metrics as Record<string, unknown>;
    return sum + asNumber(metrics[metric]);
  }, 0);
  return clampScore(total / rows.length);
}

function wilsonLowerBound(passCount: number, total: number, z = 1.96): number {
  if (total <= 0) {
    return 0;
  }
  const p = passCount / total;
  const z2 = z * z;
  const denominator = 1 + (z2 / total);
  const center = p + (z2 / (2 * total));
  const margin = z * Math.sqrt(((p * (1 - p)) + (z2 / (4 * total))) / total);
  return clampScore((center - margin) / denominator);
}

function toMetricAverageRecord(rows: HarnessCaseRow[]): Record<MetricName, number> {
  return {
    task_success: metricAverage(rows, "task_success"),
    tool_use_quality: metricAverage(rows, "tool_use_quality"),
    context_retention: metricAverage(rows, "context_retention"),
    safety_compliance: metricAverage(rows, "safety_compliance"),
    latency_cost: metricAverage(rows, "latency_cost"),
  };
}

function variance(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const squareDiff = values.reduce((sum, value) => {
    const delta = value - mean;
    return sum + delta * delta;
  }, 0);
  return squareDiff / values.length;
}

function buildVariantSaturationGuard(
  variantName: string,
  caseRows: HarnessCaseRow[]
): VariantSaturationGuardReport {
  const epsilon = 1e-9;
  const caseCount = caseRows.length;
  const perfectCaseCount = caseRows.filter((row) => asNumber(row.overall_score) >= 1 - epsilon).length;
  const perfectCaseRate = caseCount > 0 ? perfectCaseCount / caseCount : 0;

  const monitoredMetrics = SATURATION_POLICY.monitoredMetrics.reduce(
    (accumulator, metric) => {
      const metricValues = caseRows.map((row) => {
        const payload = row.metrics as Record<string, unknown>;
        return clampScore(asNumber(payload[metric]));
      });
      const mean = metricValues.length > 0 ? metricValues.reduce((sum, value) => sum + value, 0) / metricValues.length : 0;
      accumulator[metric] = {
        mean: clampScore(mean),
        variance: variance(metricValues),
      };
      return accumulator;
    },
    {} as Record<SaturationMetricName, SaturationMetricSnapshot>
  );

  const maxMetricVariance = SATURATION_POLICY.monitoredMetrics.reduce((currentMax, metric) => {
    const metricVariance = monitoredMetrics[metric]?.variance ?? 0;
    return Math.max(currentMax, metricVariance);
  }, 0);

  const saturationTriggered =
    caseCount > 0 &&
    perfectCaseRate > SATURATION_POLICY.maxPerfectCaseRate &&
    maxMetricVariance < SATURATION_POLICY.minMetricVariance;

  const reasons: string[] = [];
  if (saturationTriggered) {
    reasons.push(
      `perfect_case_rate ${perfectCaseRate.toFixed(4)} > ${SATURATION_POLICY.maxPerfectCaseRate.toFixed(4)} and max_metric_variance ${maxMetricVariance.toExponential(3)} < ${SATURATION_POLICY.minMetricVariance.toExponential(3)}`
    );
  }

  return {
    variant: variantName,
    case_count: caseCount,
    perfect_case_count: perfectCaseCount,
    perfect_case_rate: perfectCaseRate,
    max_metric_variance: maxMetricVariance,
    monitored_metrics: monitoredMetrics,
    triggered: saturationTriggered,
    reasons,
  };
}

function summarizeDimension(dimension: DimensionName, rows: HarnessCaseRow[]): DimensionSummary {
  const caseCount = rows.length;
  const passCount = rows.filter((row) => row.passed === true).length;
  const passRate = caseCount > 0 ? clampScore(passCount / caseCount) : 0;
  const passRateLowerBound = wilsonLowerBound(passCount, caseCount);
  const averageScore =
    caseCount > 0
      ? clampScore(rows.reduce((sum, row) => sum + asNumber(row.overall_score), 0) / caseCount)
      : 0;
  const failedCaseIds = rows
    .filter((row) => row.passed !== true)
    .map((row) => row.case_id)
    .sort((left, right) => left.localeCompare(right));

  return {
    dimension,
    case_count: caseCount,
    pass_count: passCount,
    pass_rate: passRate,
    pass_rate_lower_bound: passRateLowerBound,
    average_score: averageScore,
    metric_averages: toMetricAverageRecord(rows),
    failed_case_ids: failedCaseIds,
  };
}

function selectDimensionRows(variant: HarnessVariantReport, dimension: DimensionName): HarnessCaseRow[] {
  const aliases = new Set(DIMENSION_TAG_ALIASES[dimension].map((item) => normalizeTag(item)));
  return variant.cases.filter((row) => {
    if (!Array.isArray(row.behavior_tags)) {
      return false;
    }
    return row.behavior_tags.some((tag) => aliases.has(normalizeTag(tag)));
  });
}

function evaluateDimensionThreshold(
  summary: DimensionSummary,
  threshold: DimensionThreshold
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  if (summary.case_count === 0) {
    failures.push(`dimension=${summary.dimension} has no coverage cases`);
    return { passed: false, failures };
  }
  if (summary.case_count < threshold.minCaseCount) {
    failures.push(
      `dimension=${summary.dimension} case_count ${summary.case_count} < ${threshold.minCaseCount}`
    );
  }

  if (summary.average_score < threshold.minAverageScore) {
    failures.push(
      `dimension=${summary.dimension} average_score ${summary.average_score.toFixed(4)} < ${threshold.minAverageScore.toFixed(4)}`
    );
  }
  if (summary.pass_rate < threshold.minPassRate) {
    failures.push(
      `dimension=${summary.dimension} pass_rate ${summary.pass_rate.toFixed(4)} < ${threshold.minPassRate.toFixed(4)}`
    );
  }
  if (summary.pass_rate_lower_bound < threshold.minPassRateLowerBound) {
    failures.push(
      `dimension=${summary.dimension} pass_rate_lower_bound ${summary.pass_rate_lower_bound.toFixed(4)} < ${threshold.minPassRateLowerBound.toFixed(4)}`
    );
  }

  METRIC_NAMES.forEach((metric) => {
    if (!(metric in threshold.minMetricAverages)) {
      return;
    }
    const minimum = threshold.minMetricAverages[metric] ?? 0;
    const current = summary.metric_averages[metric] ?? 0;
    if (current < minimum) {
      failures.push(`dimension=${summary.dimension} metric=${metric} ${current.toFixed(4)} < ${minimum.toFixed(4)}`);
    }
  });

  return { passed: failures.length === 0, failures };
}

function evaluateVariant(variantName: string, variant: HarnessVariantReport): VariantDimensionReport {
  const dimensionReports: Record<DimensionName, DimensionSummary> = {
    context_compression: summarizeDimension(
      "context_compression",
      selectDimensionRows(variant, "context_compression")
    ),
    memory_lineage: summarizeDimension("memory_lineage", selectDimensionRows(variant, "memory_lineage")),
    experience_learning: summarizeDimension(
      "experience_learning",
      selectDimensionRows(variant, "experience_learning")
    ),
  };

  const dimensionFailures: string[] = [];
  (Object.keys(dimensionReports) as DimensionName[]).forEach((dimension) => {
    const threshold = DIMENSION_THRESHOLDS[dimension];
    const result = evaluateDimensionThreshold(dimensionReports[dimension], threshold);
    if (!result.passed) {
      dimensionFailures.push(...result.failures);
    }
  });

  return {
    variant: variantName,
    harness_gate: {
      passed: variant.gate.passed === true,
      failures: [...variant.gate.failures],
    },
    dimension_gate: {
      passed: dimensionFailures.length === 0,
      failures: dimensionFailures,
    },
    summary: variant.summary,
    splits: variant.splits,
    reward_v1: variant.reward_v1,
    dimensions: dimensionReports,
  };
}

function compareDimensionRegression(
  variants: Record<string, VariantDimensionReport>
): DimensionRegressionGuardReport {
  const failures: string[] = [];
  const deltas: Record<DimensionName, DimensionDelta> = {
    context_compression: {
      baseline_average_score: 0,
      candidate_average_score: 0,
      average_score_drop: 0,
      baseline_pass_rate: 0,
      candidate_pass_rate: 0,
      pass_rate_drop: 0,
    },
    memory_lineage: {
      baseline_average_score: 0,
      candidate_average_score: 0,
      average_score_drop: 0,
      baseline_pass_rate: 0,
      candidate_pass_rate: 0,
      pass_rate_drop: 0,
    },
    experience_learning: {
      baseline_average_score: 0,
      candidate_average_score: 0,
      average_score_drop: 0,
      baseline_pass_rate: 0,
      candidate_pass_rate: 0,
      pass_rate_drop: 0,
    },
  };

  const baseline = variants[DIMENSION_REGRESSION_GUARD.baselineVariant];
  const candidate = variants[DIMENSION_REGRESSION_GUARD.candidateVariant];

  if (baseline == null || candidate == null) {
    failures.push(
      `dimension regression guard requires variants ${DIMENSION_REGRESSION_GUARD.baselineVariant} and ${DIMENSION_REGRESSION_GUARD.candidateVariant}`
    );
  } else {
    DIMENSION_REGRESSION_GUARD.dimensions.forEach((dimension) => {
      const baselineDim = baseline.dimensions[dimension];
      const candidateDim = candidate.dimensions[dimension];
      const scoreDrop = baselineDim.average_score - candidateDim.average_score;
      const passRateDrop = baselineDim.pass_rate - candidateDim.pass_rate;

      deltas[dimension] = {
        baseline_average_score: baselineDim.average_score,
        candidate_average_score: candidateDim.average_score,
        average_score_drop: scoreDrop,
        baseline_pass_rate: baselineDim.pass_rate,
        candidate_pass_rate: candidateDim.pass_rate,
        pass_rate_drop: passRateDrop,
      };

      if (baselineDim.case_count === 0 || candidateDim.case_count === 0) {
        failures.push(`dimension regression guard missing coverage on ${dimension}`);
        return;
      }

      if (scoreDrop > DIMENSION_REGRESSION_GUARD.maxScoreDrop) {
        failures.push(
          `dimension regression: ${dimension} average_score drop ${scoreDrop.toFixed(4)} > ${DIMENSION_REGRESSION_GUARD.maxScoreDrop.toFixed(4)}`
        );
      }
      if (passRateDrop > DIMENSION_REGRESSION_GUARD.maxPassRateDrop) {
        failures.push(
          `dimension regression: ${dimension} pass_rate drop ${passRateDrop.toFixed(4)} > ${DIMENSION_REGRESSION_GUARD.maxPassRateDrop.toFixed(4)}`
        );
      }
    });
  }

  return {
    passed: failures.length === 0,
    baseline_variant: DIMENSION_REGRESSION_GUARD.baselineVariant,
    candidate_variant: DIMENSION_REGRESSION_GUARD.candidateVariant,
    max_score_drop: DIMENSION_REGRESSION_GUARD.maxScoreDrop,
    max_pass_rate_drop: DIMENSION_REGRESSION_GUARD.maxPassRateDrop,
    dimensions: [...DIMENSION_REGRESSION_GUARD.dimensions],
    deltas,
    failures,
  };
}

function toDimensionPolicyPayload(): ContextMemoryEvalReport["dimension_policy"] {
  return {
    context_compression: {
      min_case_count: DIMENSION_THRESHOLDS.context_compression.minCaseCount,
      min_average_score: DIMENSION_THRESHOLDS.context_compression.minAverageScore,
      min_pass_rate: DIMENSION_THRESHOLDS.context_compression.minPassRate,
      min_pass_rate_lower_bound: DIMENSION_THRESHOLDS.context_compression.minPassRateLowerBound,
      min_metric_averages: DIMENSION_THRESHOLDS.context_compression.minMetricAverages,
    },
    memory_lineage: {
      min_case_count: DIMENSION_THRESHOLDS.memory_lineage.minCaseCount,
      min_average_score: DIMENSION_THRESHOLDS.memory_lineage.minAverageScore,
      min_pass_rate: DIMENSION_THRESHOLDS.memory_lineage.minPassRate,
      min_pass_rate_lower_bound: DIMENSION_THRESHOLDS.memory_lineage.minPassRateLowerBound,
      min_metric_averages: DIMENSION_THRESHOLDS.memory_lineage.minMetricAverages,
    },
    experience_learning: {
      min_case_count: DIMENSION_THRESHOLDS.experience_learning.minCaseCount,
      min_average_score: DIMENSION_THRESHOLDS.experience_learning.minAverageScore,
      min_pass_rate: DIMENSION_THRESHOLDS.experience_learning.minPassRate,
      min_pass_rate_lower_bound: DIMENSION_THRESHOLDS.experience_learning.minPassRateLowerBound,
      min_metric_averages: DIMENSION_THRESHOLDS.experience_learning.minMetricAverages,
    },
  };
}

function buildReport(args: ParsedCliArgs): ContextMemoryEvalReport {
  const harnessReport = runHarness(args.cases, args.runs, args.gatePolicy);
  const sortedVariantEntries = Object.entries(harnessReport.variants).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  const variantReports = Object.fromEntries(
    sortedVariantEntries.map(([variantName, variant]) => [variantName, evaluateVariant(variantName, variant)])
  );

  const saturationGuard = Object.fromEntries(
    sortedVariantEntries.map(([variantName, variant]) => [
      variantName,
      buildVariantSaturationGuard(variantName, variant.cases),
    ])
  );

  const dimensionRegression = compareDimensionRegression(variantReports);

  const failures: string[] = [];
  Object.entries(variantReports).forEach(([variantName, variant]) => {
    if (variant.summary.case_count < COVERAGE_POLICY.minVariantCaseCount) {
      failures.push(
        `variant=${variantName} coverage: case_count ${variant.summary.case_count} < ${COVERAGE_POLICY.minVariantCaseCount}`
      );
    }
    const holdoutCount = variant.splits.holdout?.case_count ?? 0;
    if (holdoutCount < COVERAGE_POLICY.minHoldoutCaseCount) {
      failures.push(
        `variant=${variantName} coverage: holdout case_count ${holdoutCount} < ${COVERAGE_POLICY.minHoldoutCaseCount}`
      );
    }
    const optimizationCount = variant.splits.optimization?.case_count ?? 0;
    if (optimizationCount < COVERAGE_POLICY.minOptimizationCaseCount) {
      failures.push(
        `variant=${variantName} coverage: optimization case_count ${optimizationCount} < ${COVERAGE_POLICY.minOptimizationCaseCount}`
      );
    }
    if (!variant.harness_gate.passed) {
      failures.push(
        ...variant.harness_gate.failures.map((item) => `variant=${variantName} harness_gate: ${item}`)
      );
    }
    if (!variant.dimension_gate.passed) {
      failures.push(
        ...variant.dimension_gate.failures.map((item) => `variant=${variantName} dimension_gate: ${item}`)
      );
    }
    const saturation = saturationGuard[variantName];
    if (saturation?.triggered) {
      failures.push(
        ...saturation.reasons.map((item) => `variant=${variantName} saturation_guard: ${item}`)
      );
    }
  });

  if (harnessReport.regression_guard != null && harnessReport.regression_guard.passed !== true) {
    const details = harnessReport.regression_guard.failures ?? [];
    if (details.length === 0) {
      failures.push("harness regression_guard failed");
    } else {
      failures.push(...details.map((item) => `harness regression_guard: ${item}`));
    }
  }

  if (!dimensionRegression.passed) {
    failures.push(...dimensionRegression.failures);
  }

  return {
    schema: "context_memory_experience_eval@v2",
    generated_at: new Date().toISOString(),
    inputs: {
      cases: args.cases,
      runs: args.runs,
      gate_policy: args.gatePolicy,
    },
    coverage_policy: {
      min_variant_case_count: COVERAGE_POLICY.minVariantCaseCount,
      min_holdout_case_count: COVERAGE_POLICY.minHoldoutCaseCount,
      min_optimization_case_count: COVERAGE_POLICY.minOptimizationCaseCount,
    },
    dimension_policy: toDimensionPolicyPayload(),
    saturation_policy: {
      max_perfect_case_rate: SATURATION_POLICY.maxPerfectCaseRate,
      min_metric_variance: SATURATION_POLICY.minMetricVariance,
      monitored_metrics: [...SATURATION_POLICY.monitoredMetrics],
    },
    variants: variantReports,
    saturation_guard: saturationGuard,
    harness_regression_guard: harnessReport.regression_guard ?? null,
    dimension_regression_guard: dimensionRegression,
    overall_gate: {
      passed: failures.length === 0,
      failures,
    },
  };
}

function printSummary(report: ContextMemoryEvalReport): void {
  Object.entries(report.variants)
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([variantName, variant]) => {
      const harnessStatus = variant.harness_gate.passed ? "PASS" : "FAIL";
      const dimensionStatus = variant.dimension_gate.passed ? "PASS" : "FAIL";
      const saturation = report.saturation_guard[variantName];
      const saturationStatus = saturation?.triggered ? "FAIL" : "PASS";
      process.stdout.write(
        `[variant=${variantName}] harness_gate=${harnessStatus} dimension_gate=${dimensionStatus} avg=${variant.summary.average_score.toFixed(4)} pass_rate=${variant.summary.pass_rate.toFixed(4)} reward=${variant.reward_v1.composite_score.toFixed(4)}\n`
      );
      if (saturation != null) {
        process.stdout.write(
          `  - saturation_guard=${saturationStatus} perfect_rate=${saturation.perfect_case_rate.toFixed(4)} max_metric_variance=${saturation.max_metric_variance.toExponential(3)}\n`
        );
      }
      (Object.keys(variant.dimensions) as DimensionName[]).forEach((dimension) => {
        const data = variant.dimensions[dimension];
        process.stdout.write(
          `  - dimension=${dimension} cases=${data.case_count} avg=${data.average_score.toFixed(4)} pass_rate=${data.pass_rate.toFixed(4)} pass_lb=${data.pass_rate_lower_bound.toFixed(4)} context=${data.metric_averages.context_retention.toFixed(4)}\n`
        );
      });
      variant.dimension_gate.failures.forEach((failure) => {
        process.stdout.write(`    dimension_failure: ${failure}\n`);
      });
      variant.harness_gate.failures.forEach((failure) => {
        process.stdout.write(`    harness_failure: ${failure}\n`);
      });
      saturation?.reasons.forEach((failure) => {
        process.stdout.write(`    saturation_failure: ${failure}\n`);
      });
    });

  const regressionStatus = report.dimension_regression_guard.passed ? "PASS" : "FAIL";
  process.stdout.write(`[dimension_regression_guard] ${regressionStatus}\n`);
  report.dimension_regression_guard.failures.forEach((failure) => {
    process.stdout.write(`  - ${failure}\n`);
  });

  const overallStatus = report.overall_gate.passed ? "PASS" : "FAIL";
  process.stdout.write(`[overall_gate] ${overallStatus}\n`);
  report.overall_gate.failures.forEach((failure) => {
    process.stdout.write(`  - ${failure}\n`);
  });
}

export function runCli(argv: string[]): number {
  const args = parseArgs(argv);
  const report = buildReport(args);
  printSummary(report);

  if (args.printJson) {
    process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`);
  }

  if (args.output != null) {
    writeFileSync(args.output, `${JSON.stringify(report, undefined, 2)}\n`, "utf8");
  }

  if (args.failOnGate && !report.overall_gate.passed) {
    return 2;
  }
  return 0;
}

const entryScript = process.argv[1] ?? "";
const shouldRunCli = entryScript.includes("context-memory-experience-eval");

if (shouldRunCli) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`context-memory-experience-eval fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
