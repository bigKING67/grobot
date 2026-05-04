import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { HarnessCiSummary, ParsedCliArgs } from "./types";
import {
  asObject,
  dirname,
  normalizeOptionalText,
  parseJsonObject,
  toBool,
  toNumber,
} from "./normalizers";
import {
  extractSuggestedLabels,
  normalizePolicyDriftFieldsForMarkdown,
  renderHarnessCiSummaryMarkdown,
} from "./markdown";
import { buildHarnessCiSummary } from "./normalizers";

function parseArgs(argv: string[]): ParsedCliArgs {
  const args: ParsedCliArgs = {
    traceReportPath: "",
    skillRouterReportPath: "",
    contextMemoryReportPath: undefined,
    weeklyRegressionReportPath: undefined,
    autoLoopReportPath: undefined,
    policyDriftReportPath: undefined,
    outputPath: undefined,
    markdownOutputPath: undefined,
    labelsOutputPath: undefined,
    printJson: false,
    printMarkdown: false,
    printLabels: false,
    emitGithubAnnotations: false,
    failOnOverallFail: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--trace-report") {
      args.traceReportPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--skill-router-report") {
      args.skillRouterReportPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--context-memory-report") {
      args.contextMemoryReportPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--weekly-regression-report") {
      args.weeklyRegressionReportPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--auto-loop-report") {
      args.autoLoopReportPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--policy-drift-report") {
      args.policyDriftReportPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--output") {
      args.outputPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--markdown-output") {
      args.markdownOutputPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--labels-output") {
      args.labelsOutputPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--print-json") {
      args.printJson = true;
      continue;
    }
    if (token === "--print-markdown") {
      args.printMarkdown = true;
      continue;
    }
    if (token === "--print-labels") {
      args.printLabels = true;
      continue;
    }
    if (token === "--emit-github-annotations") {
      args.emitGithubAnnotations = true;
      continue;
    }
    if (token === "--fail-on-overall-fail") {
      args.failOnOverallFail = true;
      continue;
    }
  }

  if (!args.traceReportPath || !args.skillRouterReportPath) {
    throw new Error("missing required args: --trace-report and --skill-router-report");
  }

  return args;
}

function ensureParentDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function writeJsonFile(path: string, payload: unknown): void {
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(payload, undefined, 2)}\n`, "utf8");
}

function writeTextFile(path: string, payload: string): void {
  ensureParentDir(path);
  writeFileSync(path, payload, "utf8");
}

function printGithubAnnotation(summary: HarnessCiSummary): void {
  const skill = asObject(summary.skill_router as unknown);
  const contextMemory = asObject(summary.context_memory as unknown);
  const weeklyRegression = asObject(summary.weekly_regression as unknown);
  const autoLoop = asObject(summary.auto_loop as unknown);
  const trendTag = normalizeOptionalText(skill.trend_decision_tag) ?? "TREND_NOT_REQUESTED";
  const trendSeverity = normalizeOptionalText(skill.trend_decision_severity) ?? "info";
  const trendActionHint = normalizeOptionalText(skill.trend_action_hint) ?? "n/a";
  const trendOwner = normalizeOptionalText(skill.trend_owner) ?? "unknown-owner";
  const drift = normalizePolicyDriftFieldsForMarkdown(asObject(summary.policy_drift as unknown));
  const autoLoopSelectedProposal = normalizeOptionalText(autoLoop.selected_proposal_id) ?? "n/a";
  const autoLoopSelectedVariant = normalizeOptionalText(autoLoop.selected_variant) ?? "n/a";
  const autoLoopPromotionState = normalizeOptionalText(autoLoop.promotion_state) ?? "n/a";
  const autoLoopCircuit = toBool(autoLoop.circuit_breaker_triggered, false);
  const autoLoopCircuitReason = normalizeOptionalText(autoLoop.circuit_breaker_reason) ?? "n/a";
  const contextGatePass = toBool(contextMemory.gate_pass, false);
  const contextTrendTag = normalizeOptionalText(contextMemory.trend_decision_tag) ?? "TREND_NOT_REQUESTED";
  const contextTrendSeverity = normalizeOptionalText(contextMemory.trend_decision_severity) ?? "info";
  const weeklyGatePass = toBool(weeklyRegression.gate_pass, false);
  const weeklyTrendMode = normalizeOptionalText(weeklyRegression.trend_mode) ?? "n/a";
  const weeklyTrendReason = normalizeOptionalText(weeklyRegression.trend_reason) ?? "n/a";
  const weeklySuccessRate = toNumber(weeklyRegression.success_rate, 0).toFixed(4);
  const weeklyFirstPassRate = toNumber(weeklyRegression.first_pass_rate, 0).toFixed(4);
  const weeklyTokenCost = toNumber(weeklyRegression.token_cost, 0).toFixed(6);
  const weeklyRollbackRate = toNumber(weeklyRegression.rollback_rate, 0).toFixed(4);
  const labels = extractSuggestedLabels(summary);
  const labelsText = labels.length > 0 ? labels.join(",") : "n/a";

  const annotationMessage =
    `skill-router trend decision: tag=${trendTag}; severity=${trendSeverity}; owner=${trendOwner}; action=${trendActionHint}; ` +
    `policy_drift=${drift.severity}:${drift.reason}; ` +
    `policy_drift_transition=${drift.transition}; ` +
    `policy_drift_transition_state=${drift.transitionState}; ` +
    `policy_drift_delta=${drift.severityDelta}; ` +
    `policy_drift_owner=${drift.owner}; ` +
    `policy_drift_action=${drift.actionHint}; ` +
    `policy_drift_worsening_streak=${drift.worseningStreak}; ` +
    `policy_drift_worsening_threshold=${drift.worseningAlertThreshold}; ` +
    `policy_drift_worsening_label=${drift.worseningLabel}; ` +
    `policy_drift_worsening_alert=${drift.worseningAlert ? "yes" : "no"}; ` +
    `auto_loop_selected_proposal=${autoLoopSelectedProposal}; ` +
    `auto_loop_selected_variant=${autoLoopSelectedVariant}; ` +
    `auto_loop_promotion_state=${autoLoopPromotionState}; ` +
    `auto_loop_circuit_breaker=${autoLoopCircuit ? "yes" : "no"}; ` +
    `auto_loop_circuit_reason=${autoLoopCircuitReason}; ` +
    `context_memory_gate=${contextGatePass ? "pass" : "fail"}; ` +
    `context_memory_trend_tag=${contextTrendTag}; ` +
    `context_memory_trend_severity=${contextTrendSeverity}; ` +
    `weekly_regression_gate=${weeklyGatePass ? "pass" : "fail"}; ` +
    `weekly_regression_trend_mode=${weeklyTrendMode}; ` +
    `weekly_regression_trend_reason=${weeklyTrendReason}; ` +
    `weekly_success_rate=${weeklySuccessRate}; ` +
    `weekly_first_pass_rate=${weeklyFirstPassRate}; ` +
    `weekly_token_cost=${weeklyTokenCost}; ` +
    `weekly_rollback_rate=${weeklyRollbackRate}; ` +
    `labels=${labelsText}`;

  if (!summary.overall_pass) {
    process.stdout.write(`::error title=Harness Gate Overall Fail::${annotationMessage}\n`);
    return;
  }
  if (drift.worseningAlert && drift.severity === "high") {
    process.stdout.write(`::error title=Policy Drift Worsening::${annotationMessage}\n`);
    return;
  }
  if (drift.worseningAlert) {
    process.stdout.write(`::warning title=Policy Drift Worsening::${annotationMessage}\n`);
    return;
  }
  if (trendSeverity === "error") {
    process.stdout.write(`::error title=Skill Router Trend::${annotationMessage}\n`);
    return;
  }
  if (trendSeverity === "warn") {
    process.stdout.write(`::warning title=Skill Router Trend::${annotationMessage}\n`);
    return;
  }
  process.stdout.write(`::notice title=Skill Router Trend::${annotationMessage}\n`);
}

export function runCiSummaryCli(argv: string[]): number {
  const args = parseArgs(argv);
  const traceReport = parseJsonObject(args.traceReportPath);
  const skillRouterReport = parseJsonObject(args.skillRouterReportPath);
  const contextMemoryReport =
    args.contextMemoryReportPath && existsSync(args.contextMemoryReportPath)
      ? parseJsonObject(args.contextMemoryReportPath)
      : undefined;
  const weeklyRegressionReport =
    args.weeklyRegressionReportPath && existsSync(args.weeklyRegressionReportPath)
      ? parseJsonObject(args.weeklyRegressionReportPath)
      : undefined;
  const autoLoopReport =
    args.autoLoopReportPath && existsSync(args.autoLoopReportPath)
      ? parseJsonObject(args.autoLoopReportPath)
      : undefined;
  const policyDriftReport =
    args.policyDriftReportPath && existsSync(args.policyDriftReportPath)
      ? parseJsonObject(args.policyDriftReportPath)
      : undefined;
  const summary = buildHarnessCiSummary(
    traceReport,
    skillRouterReport,
    contextMemoryReport,
    weeklyRegressionReport,
    autoLoopReport,
    policyDriftReport,
  );
  const markdown = renderHarnessCiSummaryMarkdown(summary);
  const suggestedLabels = extractSuggestedLabels(summary);
  const suggestedLabelsCsv = suggestedLabels.join(",");

  if (args.printJson) {
    process.stdout.write(`${JSON.stringify(summary, undefined, 2)}\n`);
  }
  if (args.printMarkdown) {
    process.stdout.write(markdown);
  }
  if (args.printLabels) {
    process.stdout.write(`${suggestedLabelsCsv}\n`);
  }
  if (!args.printJson && !args.printMarkdown && !args.printLabels) {
    process.stdout.write(`overall=${summary.overall_pass ? "pass" : "fail"}\n`);
  }

  if (args.outputPath) {
    writeJsonFile(args.outputPath, summary);
  }
  if (args.markdownOutputPath) {
    writeTextFile(args.markdownOutputPath, markdown);
  }
  if (args.labelsOutputPath) {
    writeJsonFile(args.labelsOutputPath, suggestedLabels);
  }

  if (args.emitGithubAnnotations) {
    printGithubAnnotation(summary);
  }
  if (args.failOnOverallFail && !summary.overall_pass) {
    return 4;
  }
  return 0;
}
