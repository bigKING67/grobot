import { clampScore } from "./parsing";
import {
  METRIC_NAMES,
  type CaseScore,
  type EvalCase,
  type EvalGatePolicy,
  type EvalRun,
  type GateResult,
  type HarnessReport,
  type HarnessVariantReport,
  type MetricName,
  type RegressionGuard,
  type RewardV1Summary,
  type RewardV1Weights,
  type SplitSummary,
} from "./types";

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function coverageScore(requiredItems: string[], corpus: string): { score: number; missing: string[] } {
  if (requiredItems.length === 0) {
    return { score: 1, missing: [] };
  }
  const missing: string[] = [];
  requiredItems.forEach((item) => {
    if (!corpus.includes(normalizeText(item))) {
      missing.push(item);
    }
  });
  return { score: (requiredItems.length - missing.length) / requiredItems.length, missing };
}

function budgetScore(
  actual: number | null,
  budget: number | null,
  label: string
): { score: number; failure: string | null } {
  if (budget == null) {
    return { score: 1, failure: null };
  }
  if (actual == null) {
    return { score: 0, failure: `missing ${label} measurement` };
  }
  if (actual <= budget) {
    return { score: 1, failure: null };
  }
  const score = actual > 0 ? clampScore(budget / actual) : 0;
  return { score, failure: `${label} exceeded budget (${actual.toFixed(4)} > ${budget.toFixed(4)})` };
}

function evaluateCase(caseDef: EvalCase, run: EvalRun, casePassThreshold: number): CaseScore {
  const responseText = normalizeText(run.assistantResponse);
  const contextText = normalizeText([run.assistantResponse, ...run.recalledContext].join("\n"));
  const usedTools = new Set(run.usedTools.map((item) => normalizeText(item)));
  const failureReasons: string[] = [];

  const requiredContent = coverageScore(caseDef.expectations.requiredSubstrings, responseText);
  if (requiredContent.missing.length > 0) {
    failureReasons.push(`missing required substrings: ${requiredContent.missing.join(", ")}`);
  }

  const forbiddenHits = caseDef.expectations.forbiddenSubstrings.filter((item) =>
    responseText.includes(normalizeText(item))
  );
  if (forbiddenHits.length > 0) {
    failureReasons.push(`forbidden substrings present: ${forbiddenHits.join(", ")}`);
  }

  let taskSuccess = requiredContent.score;
  if (!run.completed) {
    taskSuccess *= 0.5;
    failureReasons.push("run marked as incomplete");
  }
  if (forbiddenHits.length > 0) {
    taskSuccess = 0;
  }

  const requiredTools = caseDef.expectations.requiredTools.map((item) => normalizeText(item));
  const forbiddenTools = caseDef.expectations.forbiddenTools.map((item) => normalizeText(item));
  const requiredToolCoverage = coverageScore(requiredTools, Array.from(usedTools).sort().join(" "));
  if (requiredToolCoverage.missing.length > 0) {
    failureReasons.push(`missing required tools: ${requiredToolCoverage.missing.join(", ")}`);
  }
  const usedForbiddenTools = forbiddenTools.filter((tool) => usedTools.has(tool));
  let forbiddenToolsPenalty = 1;
  if (usedForbiddenTools.length > 0) {
    forbiddenToolsPenalty = Math.max(0, 1 - usedForbiddenTools.length / Math.max(1, forbiddenTools.length));
    failureReasons.push(`forbidden tools used: ${usedForbiddenTools.sort().join(", ")}`);
  }
  const toolUseQuality = clampScore(requiredToolCoverage.score * 0.7 + forbiddenToolsPenalty * 0.3);

  const contextCoverage = coverageScore(caseDef.expectations.requiredContextItems, contextText);
  if (contextCoverage.missing.length > 0) {
    failureReasons.push(`missing context items: ${contextCoverage.missing.join(", ")}`);
  }

  let safetyScore = 1;
  if (forbiddenHits.length > 0) {
    safetyScore = 0;
  }
  if (run.violations.length > 0) {
    safetyScore = Math.min(safetyScore, Math.max(0, 1 - 0.5 * run.violations.length));
    failureReasons.push(`policy violations: ${run.violations.join(", ")}`);
  }
  if (run.unsafeActions > 0) {
    safetyScore = 0;
    failureReasons.push(`unsafe actions observed: ${run.unsafeActions}`);
  }

  const latency = budgetScore(run.latencyMs, caseDef.expectations.latencyBudgetMs, "latency_ms");
  const cost = budgetScore(run.estimatedCostUsd, caseDef.expectations.costBudgetUsd, "estimated_cost_usd");
  if (latency.failure != null) {
    failureReasons.push(latency.failure);
  }
  if (cost.failure != null) {
    failureReasons.push(cost.failure);
  }
  const latencyCost = clampScore((latency.score + cost.score) / 2);

  const metrics: Record<MetricName, number> = {
    task_success: clampScore(taskSuccess),
    tool_use_quality: clampScore(toolUseQuality),
    context_retention: clampScore(contextCoverage.score),
    safety_compliance: clampScore(safetyScore),
    latency_cost: clampScore(latencyCost),
  };

  const overall = clampScore(
    METRIC_NAMES.reduce((score, metric) => score + metrics[metric] * caseDef.weights[metric], 0)
  );
  const passed = overall >= casePassThreshold;
  if (!passed) {
    failureReasons.push(`overall score ${overall.toFixed(4)} below threshold ${casePassThreshold.toFixed(4)}`);
  }
  const deduped = Array.from(new Set(failureReasons));
  return {
    caseId: caseDef.caseId,
    split: caseDef.split,
    category: caseDef.category,
    variant: run.variant,
    overallScore: overall,
    metrics,
    passed,
    mustPass: caseDef.mustPass,
    behaviorTags: [...caseDef.behaviorTags],
    failureReasons: deduped,
  };
}

function missingRunScore(caseDef: EvalCase, variant: string, casePassThreshold: number): CaseScore {
  return {
    caseId: caseDef.caseId,
    split: caseDef.split,
    category: caseDef.category,
    variant,
    overallScore: 0,
    metrics: {
      task_success: 0,
      tool_use_quality: 0,
      context_retention: 0,
      safety_compliance: 0,
      latency_cost: 0,
    },
    passed: false,
    mustPass: caseDef.mustPass,
    behaviorTags: [...caseDef.behaviorTags],
    failureReasons: [
      "missing run result",
      `overall score 0.0000 below threshold ${casePassThreshold.toFixed(4)}`,
    ],
  };
}

function buildSentinelSummary(scores: CaseScore[]): {
  total: number;
  passCount: number;
  passRate: number;
  failedCaseIds: string[];
} {
  const sentinels = scores.filter((item) => item.mustPass);
  if (sentinels.length === 0) {
    return { total: 0, passCount: 0, passRate: 1, failedCaseIds: [] };
  }
  const passCount = sentinels.filter((item) => item.passed).length;
  const failedCaseIds = sentinels.filter((item) => !item.passed).map((item) => item.caseId);
  return {
    total: sentinels.length,
    passCount,
    passRate: clampScore(passCount / sentinels.length),
    failedCaseIds,
  };
}

function computeRewardV1(
  overallSummary: SplitSummary,
  splitSummary: Record<string, SplitSummary>,
  weights: RewardV1Weights
): RewardV1Summary {
  const holdout = splitSummary.holdout;
  const stability =
    holdout == null
      ? overallSummary.passRate
      : clampScore((holdout.averageScore + holdout.passRate) / 2);

  const quality = clampScore(overallSummary.averageScore);
  const safety = clampScore(overallSummary.metricAverages.safety_compliance);
  const toolCorrectness = clampScore(overallSummary.metricAverages.tool_use_quality);
  const latencyCost = clampScore(overallSummary.metricAverages.latency_cost);
  const composite = clampScore(
    quality * weights.quality +
      safety * weights.safety +
      toolCorrectness * weights.toolCorrectness +
      latencyCost * weights.latencyCost +
      stability * weights.stability
  );

  return {
    reward_version: "reward_v1",
    quality,
    safety,
    tool_correctness: toolCorrectness,
    latency_cost: latencyCost,
    stability,
    composite_score: composite,
  };
}

function summarizeBySplit(scores: CaseScore[]): Record<string, SplitSummary> {
  const grouped = new Map<string, CaseScore[]>();
  scores.forEach((item) => {
    const bucket = grouped.get(item.split) ?? [];
    bucket.push(item);
    grouped.set(item.split, bucket);
  });
  const output: Record<string, SplitSummary> = {};
  grouped.forEach((splitScores, split) => {
    const caseCount = splitScores.length;
    const passCount = splitScores.filter((item) => item.passed).length;
    const passRate = caseCount > 0 ? passCount / caseCount : 0;
    const averageScore =
      caseCount > 0 ? splitScores.reduce((sum, item) => sum + item.overallScore, 0) / caseCount : 0;
    const metricAverages = METRIC_NAMES.reduce<Record<MetricName, number>>(
      (acc, metric) => {
        const metricAvg =
          caseCount > 0
            ? splitScores.reduce((sum, item) => sum + item.metrics[metric], 0) / caseCount
            : 0;
        acc[metric] = clampScore(metricAvg);
        return acc;
      },
      {
        task_success: 0,
        tool_use_quality: 0,
        context_retention: 0,
        safety_compliance: 0,
        latency_cost: 0,
      }
    );
    output[split] = {
      split,
      caseCount,
      passCount,
      passRate: clampScore(passRate),
      averageScore: clampScore(averageScore),
      metricAverages,
    };
  });
  return output;
}

function summarizeOverall(scores: CaseScore[]): SplitSummary {
  if (scores.length === 0) {
    return {
      split: "all",
      caseCount: 0,
      passCount: 0,
      passRate: 0,
      averageScore: 0,
      metricAverages: {
        task_success: 0,
        tool_use_quality: 0,
        context_retention: 0,
        safety_compliance: 0,
        latency_cost: 0,
      },
    };
  }
  return summarizeBySplit(scores.map((item) => ({ ...item, split: "all" }))).all;
}

function applyVariantGate(
  policy: EvalGatePolicy,
  splitSummary: Record<string, SplitSummary>,
  overallSummary: SplitSummary
): GateResult {
  const failures: string[] = [];
  Object.entries(policy.splitGates).forEach(([splitName, gate]) => {
    const splitData = splitSummary[splitName];
    if (splitData == null) {
      failures.push(`missing split summary for ${splitName}`);
      return;
    }
    if (splitData.averageScore < gate.minAverageScore) {
      failures.push(
        `split=${splitName} average_score ${splitData.averageScore.toFixed(4)} < ${gate.minAverageScore.toFixed(4)}`
      );
    }
    if (splitData.passRate < gate.minPassRate) {
      failures.push(
        `split=${splitName} pass_rate ${splitData.passRate.toFixed(4)} < ${gate.minPassRate.toFixed(4)}`
      );
    }
  });

  Object.entries(policy.minMetricAverages).forEach(([metricName, minimumValue]) => {
    const metric = metricName as MetricName;
    const minimum = minimumValue ?? 0;
    const metricAverage = overallSummary.metricAverages[metric] ?? 0;
    if (metricAverage < minimum) {
      failures.push(`metric=${metric} average ${metricAverage.toFixed(4)} < ${minimum.toFixed(4)}`);
    }
  });

  return { passed: failures.length === 0, failures };
}

export function groupRunsByVariant(runs: EvalRun[]): Map<string, Map<string, EvalRun>> {
  const grouped = new Map<string, Map<string, EvalRun>>();
  runs.forEach((run) => {
    const variantRuns = grouped.get(run.variant) ?? new Map<string, EvalRun>();
    if (variantRuns.has(run.caseId)) {
      throw new Error(`duplicate run for case_id=${run.caseId} variant=${run.variant}`);
    }
    variantRuns.set(run.caseId, run);
    grouped.set(run.variant, variantRuns);
  });
  return grouped;
}

export function evaluateVariant(
  variant: string,
  cases: EvalCase[],
  runsByCase: Map<string, EvalRun>,
  policy: EvalGatePolicy
): HarnessVariantReport {
  const caseScores = cases.map((caseDef) => {
    const run = runsByCase.get(caseDef.caseId);
    if (run == null) {
      return missingRunScore(caseDef, variant, policy.casePassThreshold);
    }
    return evaluateCase(caseDef, run, policy.casePassThreshold);
  });

  const splitSummary = summarizeBySplit(caseScores);
  const overallSummary = summarizeOverall(caseScores);
  const gateResult = applyVariantGate(policy, splitSummary, overallSummary);
  const sentinelSummary = buildSentinelSummary(caseScores);
  if (policy.failOnMustPass && sentinelSummary.failedCaseIds.length > 0) {
    gateResult.passed = false;
    gateResult.failures.push(`must_pass failures: ${sentinelSummary.failedCaseIds.sort().join(", ")}`);
  }
  const rewardV1 = computeRewardV1(overallSummary, splitSummary, policy.rewardV1Weights);
  const worstCases = [...caseScores].sort((left, right) => left.overallScore - right.overallScore).slice(0, 10);

  const toCaseRow = (item: CaseScore) => ({
    case_id: item.caseId,
    split: item.split,
    category: item.category,
    variant: item.variant,
    overall_score: item.overallScore,
    metrics: item.metrics,
    passed: item.passed,
    must_pass: item.mustPass,
    behavior_tags: item.behaviorTags,
    failure_reasons: item.failureReasons,
  });

  return {
    variant,
    summary: {
      split: overallSummary.split,
      case_count: overallSummary.caseCount,
      pass_count: overallSummary.passCount,
      pass_rate: overallSummary.passRate,
      average_score: overallSummary.averageScore,
      metric_averages: overallSummary.metricAverages,
    },
    splits: Object.fromEntries(
      Object.entries(splitSummary).map(([split, data]) => [
        split,
        {
          split: data.split,
          case_count: data.caseCount,
          pass_count: data.passCount,
          pass_rate: data.passRate,
          average_score: data.averageScore,
          metric_averages: data.metricAverages,
        },
      ])
    ),
    gate: { passed: gateResult.passed, failures: gateResult.failures },
    sentinel: {
      total: sentinelSummary.total,
      pass_count: sentinelSummary.passCount,
      pass_rate: sentinelSummary.passRate,
      failed_case_ids: sentinelSummary.failedCaseIds.sort(),
    },
    reward_v1: rewardV1,
    worst_cases: worstCases.map(toCaseRow),
    cases: caseScores.map(toCaseRow),
  };
}

export function applyRegressionGuard(report: HarnessReport, guard: RegressionGuard): HarnessReport["regression_guard"] {
  const baseline = report.variants[guard.baselineVariant];
  const candidate = report.variants[guard.candidateVariant];
  if (baseline == null || candidate == null) {
    return { passed: false, reason: "baseline or candidate variant missing for regression guard" };
  }

  const guardFailures: string[] = [];
  guard.splits.forEach((split) => {
    const baselineSplit = baseline.splits[split];
    const candidateSplit = candidate.splits[split];
    if (baselineSplit == null || candidateSplit == null) {
      guardFailures.push(`split=${split} missing in regression comparison`);
      return;
    }
    const scoreDrop = baselineSplit.average_score - candidateSplit.average_score;
    const passRateDrop = baselineSplit.pass_rate - candidateSplit.pass_rate;
    if (scoreDrop > guard.maxScoreDrop) {
      guardFailures.push(
        `regression guard: split=${split} average_score drop ${scoreDrop.toFixed(4)} > ${guard.maxScoreDrop.toFixed(4)}`
      );
    }
    if (passRateDrop > guard.maxPassRateDrop) {
      guardFailures.push(
        `regression guard: split=${split} pass_rate drop ${passRateDrop.toFixed(4)} > ${guard.maxPassRateDrop.toFixed(4)}`
      );
    }
  });

  if (guardFailures.length > 0) {
    candidate.gate.passed = false;
    candidate.gate.failures = [...candidate.gate.failures, ...guardFailures];
  }

  return {
    passed: guardFailures.length === 0,
    baseline_variant: guard.baselineVariant,
    candidate_variant: guard.candidateVariant,
    splits: [...guard.splits],
    max_score_drop: guard.maxScoreDrop,
    max_pass_rate_drop: guard.maxPassRateDrop,
    failures: guardFailures,
  };
}
