import { PLAN_BENCHMARK_NO_HINT } from "./constants";
import {
  decodeDetailValue,
  encodeDetailValue,
  extractDetailToken,
} from "./event-detail";
import {
  compactSingleLine,
  nowIsoUtc,
  parseOptionalFiniteNumber,
  parseOptionalNonNegativeInt,
  readText,
} from "./fs-utils";
import { planEventsPath } from "./paths";
import type {
  PlanLatestFailureDiagnostic,
  PlanQualityBenchmarkEventDetailInput,
  PlanQualityBenchmarkHealthSummary,
  PlanQualityBenchmarkHistoryRun,
  PlanQualityBenchmarkHistorySummary,
  PlanQualityBenchmarkRecommendation,
  PlanQualityBenchmarkSemanticCorrelation,
  PlanQualityGuardMode,
} from "./types";

function parseBenchmarkGrade(raw: string | undefined): "A" | "B" | "C" | "D" | "E" | undefined {
  if (raw === "A" || raw === "B" || raw === "C" || raw === "D" || raw === "E") {
    return raw;
  }
  return undefined;
}

function parseAssertPassed(raw: string | undefined): boolean | undefined {
  if (!raw) {
    return undefined;
  }
  if (raw === "yes" || raw === "true" || raw === "1") {
    return true;
  }
  if (raw === "no" || raw === "false" || raw === "0") {
    return false;
  }
  return undefined;
}

function roundRateTo4(value: number): number {
  return Number(value.toFixed(4));
}

function clampPercentageScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 100) {
    return 100;
  }
  return Math.round(value);
}

function parseBenchmarkHistoryRun(record: Record<string, unknown>): PlanQualityBenchmarkHistoryRun | undefined {
  const detail = typeof record.detail === "string" ? record.detail.trim() : "";
  if (!detail) {
    return undefined;
  }
  const comparedCount = parseOptionalNonNegativeInt(extractDetailToken(detail, "compared"));
  const winnerLabel = decodeDetailValue(extractDetailToken(detail, "winner"))?.trim();
  const winnerScore = parseOptionalFiniteNumber(extractDetailToken(detail, "winner_score"));
  const winnerGrade = parseBenchmarkGrade(extractDetailToken(detail, "winner_grade"));
  if (
    typeof comparedCount !== "number"
    || !winnerLabel
    || typeof winnerScore !== "number"
    || !winnerGrade
  ) {
    return undefined;
  }
  const guardModeRaw = extractDetailToken(detail, "guard_mode");
  const guardMode: PlanQualityGuardMode | undefined =
    guardModeRaw === "off" || guardModeRaw === "warn" || guardModeRaw === "strict"
      ? guardModeRaw
      : undefined;
  const winnerTopHint = decodeDetailValue(extractDetailToken(detail, "winner_top_hint"))?.trim();
  const winnerTopRepairAction = decodeDetailValue(extractDetailToken(detail, "winner_top_repair"))?.trim();
  const runnerUpLabel = decodeDetailValue(extractDetailToken(detail, "runner_up"))?.trim();
  const runnerUpScore = parseOptionalFiniteNumber(extractDetailToken(detail, "runner_up_score"));
  const winnerLeadScore = parseOptionalFiniteNumber(extractDetailToken(detail, "winner_lead_score"));
  const planId = typeof record.plan_id === "string" ? record.plan_id.trim() : "";
  return {
    at: typeof record.at === "string" ? record.at : nowIsoUtc(),
    planId: planId || undefined,
    comparedCount,
    winnerLabel,
    winnerScore,
    winnerGrade,
    winnerTopHint: winnerTopHint && winnerTopHint.length > 0 ? winnerTopHint : undefined,
    winnerTopRepairAction: winnerTopRepairAction && winnerTopRepairAction.length > 0
      ? winnerTopRepairAction
      : undefined,
    runnerUpLabel: runnerUpLabel && runnerUpLabel.length > 0 ? runnerUpLabel : undefined,
    runnerUpScore: typeof runnerUpScore === "number" ? runnerUpScore : undefined,
    winnerLeadScore: typeof winnerLeadScore === "number" ? winnerLeadScore : undefined,
    preset: decodeDetailValue(extractDetailToken(detail, "preset")),
    guardMode,
    guardPolicyProfile: decodeDetailValue(extractDetailToken(detail, "guard_profile")),
    assertBest: decodeDetailValue(extractDetailToken(detail, "assert_expected")),
    assertPassed: parseAssertPassed(extractDetailToken(detail, "assert_passed")),
    assertActual: decodeDetailValue(extractDetailToken(detail, "assert_actual")),
  };
}

export function buildPlanQualityBenchmarkEventDetail(
  input: PlanQualityBenchmarkEventDetailInput,
): string {
  const comparedCount = Math.max(0, Math.floor(input.comparedCount));
  const winnerLabel = input.winnerLabel.trim().length > 0
    ? input.winnerLabel.trim()
    : "unknown";
  const tokens = [
    `compared=${String(comparedCount)}`,
    `winner=${encodeDetailValue(winnerLabel)}`,
    `winner_score=${String(input.winnerScore)}`,
    `winner_grade=${input.winnerGrade}`,
  ];
  if (input.guardMode) {
    tokens.push(`guard_mode=${input.guardMode}`);
  }
  const preset = input.preset?.trim();
  if (preset) {
    tokens.push(`preset=${encodeDetailValue(preset)}`);
  }
  const guardPolicyProfile = input.guardPolicyProfile?.trim();
  if (guardPolicyProfile) {
    tokens.push(`guard_profile=${encodeDetailValue(guardPolicyProfile)}`);
  }
  const winnerTopHint = input.winnerTopHint?.trim();
  if (winnerTopHint) {
    tokens.push(`winner_top_hint=${encodeDetailValue(winnerTopHint)}`);
  }
  const winnerTopRepairAction = input.winnerTopRepairAction?.trim();
  if (winnerTopRepairAction) {
    tokens.push(`winner_top_repair=${encodeDetailValue(winnerTopRepairAction)}`);
  }
  const runnerUpLabel = input.runnerUpLabel?.trim();
  if (runnerUpLabel) {
    tokens.push(`runner_up=${encodeDetailValue(runnerUpLabel)}`);
  }
  if (typeof input.runnerUpScore === "number" && Number.isFinite(input.runnerUpScore)) {
    tokens.push(`runner_up_score=${String(input.runnerUpScore)}`);
  }
  if (typeof input.winnerLeadScore === "number" && Number.isFinite(input.winnerLeadScore)) {
    tokens.push(`winner_lead_score=${String(input.winnerLeadScore)}`);
  }
  const assertBest = input.assertBest?.trim();
  if (assertBest) {
    tokens.push(`assert_expected=${encodeDetailValue(assertBest)}`);
  }
  if (typeof input.assertPassed === "boolean") {
    tokens.push(`assert_passed=${input.assertPassed ? "yes" : "no"}`);
  }
  const assertActual = input.assertActual?.trim();
  if (assertActual) {
    tokens.push(`assert_actual=${encodeDetailValue(assertActual)}`);
  }
  return tokens.join(" ");
}

function buildWinnerReasonToken(run: PlanQualityBenchmarkHistoryRun): string {
  const label = run.winnerLabel;
  const reason = run.winnerTopHint ?? run.winnerTopRepairAction ?? "";
  if (!reason) {
    return label;
  }
  return `${label}:${compactSingleLine(reason, 40)}`;
}

function resolveBenchmarkWinnerTopHint(run: PlanQualityBenchmarkHistoryRun | undefined): string | undefined {
  if (!run) {
    return undefined;
  }
  const hint = run.winnerTopHint?.trim();
  if (hint) {
    return hint;
  }
  const repairHint = run.winnerTopRepairAction?.trim();
  if (repairHint) {
    return repairHint;
  }
  return PLAN_BENCHMARK_NO_HINT;
}

export function loadPlanQualityBenchmarkHistory(
  workDir: string,
  sessionId: string,
  options?: {
    limit?: number;
  },
): PlanQualityBenchmarkHistorySummary {
  const limit = typeof options?.limit === "number" && options.limit > 0
    ? Math.floor(options.limit)
    : 5;
  const path = planEventsPath(workDir, sessionId);
  const raw = readText(path);
  if (!raw) {
    return emptyBenchmarkHistory();
  }
  const lines = raw.split(/\r?\n/);
  const runs: PlanQualityBenchmarkHistoryRun[] = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      continue;
    }
    const record = parsed as Record<string, unknown>;
    const event = typeof record.event === "string" ? record.event.trim() : "";
    if (event !== "plan_benchmark_run") {
      continue;
    }
    const run = parseBenchmarkHistoryRun(record);
    if (run) {
      runs.push(run);
    }
  }
  if (runs.length === 0) {
    return emptyBenchmarkHistory();
  }
  return summarizeBenchmarkRuns(runs, limit);
}

function emptyBenchmarkHistory(): PlanQualityBenchmarkHistorySummary {
  return {
    totalRuns: 0,
    recentRuns: [],
    winnerSequence: [],
    winnerReasonSequence: [],
    winnerSwitchCount: 0,
    scoreTrend: "none",
    assertCount: 0,
    assertPassCount: 0,
    assertFailCount: 0,
  };
}

function summarizeBenchmarkRuns(
  runs: PlanQualityBenchmarkHistoryRun[],
  limit: number,
): PlanQualityBenchmarkHistorySummary {
  const latest = runs[0];
  const previous = runs[1];
  let scoreTrend: "up" | "down" | "flat" | "none" = "none";
  let deltaFromPrevious: number | undefined;
  let winnerChangedFromPrevious: boolean | undefined;
  if (latest && previous) {
    deltaFromPrevious = latest.winnerScore - previous.winnerScore;
    if (deltaFromPrevious >= 1) {
      scoreTrend = "up";
    } else if (deltaFromPrevious <= -1) {
      scoreTrend = "down";
    } else {
      scoreTrend = "flat";
    }
    winnerChangedFromPrevious = latest.winnerLabel !== previous.winnerLabel;
  }
  let assertCount = 0;
  let assertPassCount = 0;
  let assertFailCount = 0;
  let winnerSwitchCount = 0;
  for (let index = 0; index < runs.length - 1; index += 1) {
    const current = runs[index];
    const next = runs[index + 1];
    if (!current || !next) {
      continue;
    }
    if (current.winnerLabel !== next.winnerLabel) {
      winnerSwitchCount += 1;
    }
  }
  for (const run of runs) {
    if (!run.assertBest) {
      continue;
    }
    assertCount += 1;
    if (run.assertPassed === true) {
      assertPassCount += 1;
    } else if (run.assertPassed === false) {
      assertFailCount += 1;
    }
  }
  return {
    totalRuns: runs.length,
    recentRuns: runs.slice(0, limit),
    latestWinnerLabel: latest.winnerLabel,
    latestWinnerScore: latest.winnerScore,
    latestWinnerGrade: latest.winnerGrade,
    latestWinnerTopHint: resolveBenchmarkWinnerTopHint(latest),
    latestWinnerTopRepairAction: latest.winnerTopRepairAction,
    latestWinnerLeadScore: latest.winnerLeadScore,
    latestRunAt: latest.at,
    winnerChangedFromPrevious,
    winnerSequence: runs.slice(0, limit).map((run) => run.winnerLabel),
    winnerReasonSequence: runs.slice(0, limit).map((run) => buildWinnerReasonToken(run)),
    winnerSwitchCount,
    scoreTrend,
    deltaFromPrevious,
    assertCount,
    assertPassCount,
    assertFailCount,
    assertPassRate: assertCount > 0 ? roundRateTo4(assertPassCount / assertCount) : undefined,
  };
}

function hasSemanticFailureSignal(latestFailure: PlanLatestFailureDiagnostic | undefined): boolean {
  if (!latestFailure) {
    return false;
  }
  if (typeof latestFailure.diagnosticCode === "string" && latestFailure.diagnosticCode.startsWith("PLAN_SEMANTIC_")) {
    return true;
  }
  if (typeof latestFailure.errorClass === "string" && latestFailure.errorClass.startsWith("semantic_")) {
    return true;
  }
  if (typeof latestFailure.policyReason === "string" && latestFailure.policyReason.includes("semantic")) {
    return true;
  }
  return false;
}

export function evaluatePlanQualityBenchmarkSemanticCorrelation(args: {
  latestFailure?: PlanLatestFailureDiagnostic;
  history: PlanQualityBenchmarkHistorySummary;
}): PlanQualityBenchmarkSemanticCorrelation {
  const semanticSignal = hasSemanticFailureSignal(args.latestFailure);
  if (!semanticSignal) {
    return {
      level: "none",
      reason: "no_semantic_failure_signal",
    };
  }
  const trend = args.history.scoreTrend;
  const switched = Boolean(args.history.winnerChangedFromPrevious)
    || args.history.winnerSwitchCount >= 1;
  const benchmarkSparse = args.history.totalRuns < 2;
  const tokens = [
    `diagnostic=${args.latestFailure?.diagnosticCode ?? "unknown"}`,
    `trend=${trend}`,
    `winner_switched=${switched ? "yes" : "no"}`,
    `runs=${String(args.history.totalRuns)}`,
  ];
  if (benchmarkSparse) {
    return {
      level: "watch",
      reason: `${tokens.join(" ")} evidence=low`,
    };
  }
  if (trend === "down" || switched) {
    return {
      level: "high",
      reason: `${tokens.join(" ")} evidence=aligned`,
    };
  }
  return {
    level: "watch",
    reason: `${tokens.join(" ")} evidence=partial`,
  };
}

function resolveBenchmarkTrendComponentScore(trend: PlanQualityBenchmarkHistorySummary["scoreTrend"]): number {
  if (trend === "up") {
    return 95;
  }
  if (trend === "flat") {
    return 82;
  }
  if (trend === "down") {
    return 38;
  }
  return 68;
}

function resolveBenchmarkSemanticComponentScore(
  semanticCorrelation: PlanQualityBenchmarkSemanticCorrelation["level"],
): number {
  if (semanticCorrelation === "high") {
    return 35;
  }
  if (semanticCorrelation === "watch") {
    return 70;
  }
  return 100;
}

export function evaluatePlanQualityBenchmarkHealth(args: {
  history: PlanQualityBenchmarkHistorySummary;
  semanticCorrelation: PlanQualityBenchmarkSemanticCorrelation["level"];
}): PlanQualityBenchmarkHealthSummary {
  if (args.history.totalRuns <= 0) {
    return {
      score: 65,
      level: "watch",
      reason: "benchmark_insufficient_runs total_runs=0",
      components: {
        trend: 68,
        stability: 68,
        assertion: 70,
        semantic: resolveBenchmarkSemanticComponentScore(args.semanticCorrelation),
      },
    };
  }
  const trend = resolveBenchmarkTrendComponentScore(args.history.scoreTrend);
  const transitionCount = Math.max(1, args.history.totalRuns - 1);
  const switchRate = args.history.winnerSwitchCount / transitionCount;
  const stability = args.history.totalRuns <= 1
    ? 68
    : clampPercentageScore((1 - switchRate) * 100);
  const assertion = args.history.assertCount <= 0
    ? 70
    : clampPercentageScore(
      (typeof args.history.assertPassRate === "number"
        ? args.history.assertPassRate
        : args.history.assertPassCount / args.history.assertCount) * 100,
    );
  const semantic = resolveBenchmarkSemanticComponentScore(args.semanticCorrelation);
  const score = clampPercentageScore(
    trend * 0.3
      + stability * 0.25
      + assertion * 0.25
      + semantic * 0.2,
  );
  const level: "good" | "watch" | "risk" = score >= 82
    ? "good"
    : score >= 60
      ? "watch"
      : "risk";
  return {
    score,
    level,
    reason: [
      `trend=${args.history.scoreTrend}`,
      `trend_score=${String(trend)}`,
      `stability_score=${String(stability)}`,
      `assertion_score=${String(assertion)}`,
      `semantic_score=${String(semantic)}`,
      `runs=${String(args.history.totalRuns)}`,
      `assert_count=${String(args.history.assertCount)}`,
      `switch_count=${String(args.history.winnerSwitchCount)}`,
    ].join(" "),
    components: {
      trend,
      stability,
      assertion,
      semantic,
    },
  };
}

export function resolvePlanQualityBenchmarkRecommendation(args: {
  history: PlanQualityBenchmarkHistorySummary;
  semanticCorrelation: PlanQualityBenchmarkSemanticCorrelation["level"];
  health: PlanQualityBenchmarkHealthSummary;
}): PlanQualityBenchmarkRecommendation {
  if (args.semanticCorrelation === "high" && args.history.scoreTrend === "down") {
    return {
      action: "Check benchmark baseline mapping (internal diagnostic)",
      reason: "semantic_correlation=high and benchmark_trend=down; verify baseline path mapping before score assertions",
    };
  }
  if (args.history.totalRuns < 2) {
    return {
      action: "Add benchmark baseline samples (internal diagnostic)",
      reason: "benchmark_history_insufficient; run preset benchmark to establish baseline",
    };
  }
  if (args.health.level === "risk") {
    return {
      action: "Confirm benchmark winner expectation (internal diagnostic)",
      reason: "benchmark_health=risk; enforce baseline winner and inspect degraded dimensions",
    };
  }
  if (args.health.level === "watch") {
    return {
      action: "Review benchmark readability and policy alignment (internal diagnostic)",
      reason: "benchmark_health=watch; validate candidate readability and policy alignment before next run",
    };
  }
  if (args.history.assertCount > 0 && args.history.assertPassCount < args.history.assertCount) {
    return {
      action: "Tighten benchmark assertion expectations (internal diagnostic)",
      reason: "benchmark_assert_pass_rate_below_100; tighten expected winner guard",
    };
  }
  return {
    action: "none",
    reason: "benchmark_health_good",
  };
}
