import type { JsonObject, MetricSnapshot, WeeklySnapshot } from "./types";
import {
  asNumber,
  asObject,
  clampRate,
  normalizeOptionalText,
  toMetricNumber,
} from "./utils";

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

export function buildWeeklySnapshot(input: {
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

export function buildFallbackBaselineFromCurrent(snapshot: WeeklySnapshot): WeeklySnapshot {
  return {
    metrics: {
      success_rate: { ...snapshot.metrics.success_rate },
      first_pass_rate: { ...snapshot.metrics.first_pass_rate },
      token_cost: { ...snapshot.metrics.token_cost },
      rollback_rate: { ...snapshot.metrics.rollback_rate },
    },
  };
}
