import { loadEvalCases, loadEvalRuns, loadGatePolicy } from "./parsing";
import { applyRegressionGuard, evaluateVariant, groupRunsByVariant } from "./scoring";
import { type EvalRun, type HarnessReport } from "./types";

export function runHarness(casesPath: string, runsPath: string, gatePolicyPath: string | null): HarnessReport {
  const cases = loadEvalCases(casesPath);
  const runs = loadEvalRuns(runsPath);
  const policy = loadGatePolicy(gatePolicyPath);
  const groupedRuns = groupRunsByVariant(runs);
  if (groupedRuns.size === 0) {
    groupedRuns.set("default", new Map<string, EvalRun>());
  }

  const report: HarnessReport = {
    generated_at: new Date().toISOString(),
    case_file: casesPath,
    run_file: runsPath,
    gate_policy: {
      case_pass_threshold: policy.casePassThreshold,
      split_gates: Object.fromEntries(
        Object.entries(policy.splitGates).map(([split, gate]) => [
          split,
          {
            min_average_score: gate.minAverageScore,
            min_pass_rate: gate.minPassRate,
          },
        ])
      ),
      min_metric_averages: policy.minMetricAverages,
      regression_guard:
        policy.regressionGuard == null
          ? null
          : {
              baseline_variant: policy.regressionGuard.baselineVariant,
              candidate_variant: policy.regressionGuard.candidateVariant,
              splits: [...policy.regressionGuard.splits],
              max_score_drop: policy.regressionGuard.maxScoreDrop,
              max_pass_rate_drop: policy.regressionGuard.maxPassRateDrop,
            },
      fail_on_must_pass: policy.failOnMustPass,
      reward_v1_weights: {
        quality: policy.rewardV1Weights.quality,
        safety: policy.rewardV1Weights.safety,
        tool_correctness: policy.rewardV1Weights.toolCorrectness,
        latency_cost: policy.rewardV1Weights.latencyCost,
        stability: policy.rewardV1Weights.stability,
      },
    },
    variants: {},
  };

  Array.from(groupedRuns.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([variantName, runsByCase]) => {
      report.variants[variantName] = evaluateVariant(variantName, cases, runsByCase, policy);
    });

  if (policy.regressionGuard != null) {
    report.regression_guard = applyRegressionGuard(report, policy.regressionGuard);
  }

  return report;
}
