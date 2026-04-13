import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

interface ParsedCliArgs {
  summaryPath: string;
  githubOutputPath: string | undefined;
  printJson: boolean;
}

interface HarnessGateOutputs {
  overall_state: string;
  trend_owner: string;
  trend_decision_tag: string;
  trend_decision_severity: string;
  trend_action_hint: string;
  policy_drift_state: string;
  policy_drift_severity: string;
  policy_drift_reason: string;
  policy_drift_transition: string;
  policy_drift_transition_state: string;
  policy_drift_severity_delta: string;
  policy_drift_owner: string;
  policy_drift_action_hint: string;
  policy_drift_worsening_streak: string;
  policy_drift_worsening_alert: string;
  policy_drift_worsening_label: string;
  suggested_labels_csv: string;
  suggested_labels_json: string[];
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function dirname(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function parseArgs(argv: string[]): ParsedCliArgs {
  let summaryPath = "gateway/evals/data/harness_ci_summary.json";
  let githubOutputPath: string | undefined;
  let printJson = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--summary") {
      const value = argv[index + 1];
      if (typeof value === "string" && value.trim().length > 0) {
        summaryPath = value.trim();
      }
      index += 1;
      continue;
    }
    if (token === "--github-output") {
      const value = argv[index + 1];
      if (typeof value === "string" && value.trim().length > 0) {
        githubOutputPath = value.trim();
      }
      index += 1;
      continue;
    }
    if (token === "--print-json") {
      printJson = true;
      continue;
    }
  }

  return {
    summaryPath,
    githubOutputPath,
    printJson,
  };
}

function readSummary(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function extractLabels(payload: Record<string, unknown>): string[] {
  const labelsRaw = payload.suggested_labels;
  if (!Array.isArray(labelsRaw)) {
    return [];
  }
  const labels: string[] = [];
  for (const item of labelsRaw) {
    const label = normalizeOptionalText(item);
    if (label) {
      labels.push(label);
    }
  }
  return labels;
}

function stringifyInt(value: unknown, fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return fallback;
}

export function buildHarnessGateOutputs(payload: Record<string, unknown>): HarnessGateOutputs {
  const labels = extractLabels(payload);

  let overallState = "unknown";
  if (typeof payload.overall_pass === "boolean") {
    overallState = payload.overall_pass ? "pass" : "fail";
  }

  const skillRouterRaw = payload.skill_router;
  const skillRouter =
    typeof skillRouterRaw === "object" && skillRouterRaw !== null && !Array.isArray(skillRouterRaw)
      ? (skillRouterRaw as Record<string, unknown>)
      : {};
  const policyDriftRaw = payload.policy_drift;
  const policyDrift =
    typeof policyDriftRaw === "object" && policyDriftRaw !== null && !Array.isArray(policyDriftRaw)
      ? (policyDriftRaw as Record<string, unknown>)
      : {};

  const trendOwner = normalizeOptionalText(skillRouter.trend_owner) ?? "unknown-owner";
  const trendDecisionTag = normalizeOptionalText(skillRouter.trend_decision_tag) ?? "TREND_UNKNOWN_MODE";
  const trendDecisionSeverity = normalizeOptionalText(skillRouter.trend_decision_severity) ?? "warn";
  const trendActionHint = normalizeOptionalText(skillRouter.trend_action_hint) ?? "n/a";

  const policyDriftSeverity = normalizeOptionalText(policyDrift.severity) ?? "none";
  const policyDriftReason = normalizeOptionalText(policyDrift.reason) ?? "shape_ok";
  const policyDriftTransition = normalizeOptionalText(policyDrift.transition) ?? `none->${policyDriftSeverity}`;
  const policyDriftTransitionState = normalizeOptionalText(policyDrift.transition_state) ?? "stable_none";
  const policyDriftSeverityDelta = stringifyInt(policyDrift.severity_delta, "0");
  const policyDriftOwner = normalizeOptionalText(policyDrift.owner) ?? "release-owner";
  const policyDriftActionHint = normalizeOptionalText(policyDrift.action_hint) ?? "n/a";
  const policyDriftWorseningStreak = stringifyInt(policyDrift.worsening_streak, "0");
  const policyDriftWorseningAlert = policyDrift.worsening_alert === true ? "true" : "false";
  const policyDriftWorseningLabel =
    normalizeOptionalText(policyDrift.worsening_label) ?? "ci/policy-drift-worsening";

  return {
    overall_state: overallState,
    trend_owner: trendOwner,
    trend_decision_tag: trendDecisionTag,
    trend_decision_severity: trendDecisionSeverity,
    trend_action_hint: trendActionHint,
    policy_drift_state: `${policyDriftSeverity}:${policyDriftReason}`,
    policy_drift_severity: policyDriftSeverity,
    policy_drift_reason: policyDriftReason,
    policy_drift_transition: policyDriftTransition,
    policy_drift_transition_state: policyDriftTransitionState,
    policy_drift_severity_delta: policyDriftSeverityDelta,
    policy_drift_owner: policyDriftOwner,
    policy_drift_action_hint: policyDriftActionHint,
    policy_drift_worsening_streak: policyDriftWorseningStreak,
    policy_drift_worsening_alert: policyDriftWorseningAlert,
    policy_drift_worsening_label: policyDriftWorseningLabel,
    suggested_labels_csv: labels.join(","),
    suggested_labels_json: labels,
  };
}

function writeGithubOutputs(path: string, outputs: HarnessGateOutputs): void {
  const block = [
    `overall_state=${outputs.overall_state}`,
    `trend_owner=${outputs.trend_owner}`,
    `trend_decision_tag=${outputs.trend_decision_tag}`,
    `trend_decision_severity=${outputs.trend_decision_severity}`,
    `trend_action_hint=${outputs.trend_action_hint}`,
    `policy_drift_state=${outputs.policy_drift_state}`,
    `policy_drift_severity=${outputs.policy_drift_severity}`,
    `policy_drift_reason=${outputs.policy_drift_reason}`,
    `policy_drift_transition=${outputs.policy_drift_transition}`,
    `policy_drift_transition_state=${outputs.policy_drift_transition_state}`,
    `policy_drift_severity_delta=${outputs.policy_drift_severity_delta}`,
    `policy_drift_owner=${outputs.policy_drift_owner}`,
    `policy_drift_action_hint=${outputs.policy_drift_action_hint}`,
    `policy_drift_worsening_streak=${outputs.policy_drift_worsening_streak}`,
    `policy_drift_worsening_alert=${outputs.policy_drift_worsening_alert}`,
    `policy_drift_worsening_label=${outputs.policy_drift_worsening_label}`,
    `suggested_labels_csv=${outputs.suggested_labels_csv}`,
    "suggested_labels_json<<EOF",
    JSON.stringify(outputs.suggested_labels_json, undefined, 0),
    "EOF",
    "",
  ].join("\n");

  mkdirSync(dirname(path), { recursive: true });
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(path, `${previous}${block}`, "utf8");
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const summary = readSummary(args.summaryPath);
  const outputs = buildHarnessGateOutputs(summary);
  const envGithubOutput = normalizeOptionalText(process.env.GITHUB_OUTPUT);
  const githubOutputPath = args.githubOutputPath ?? envGithubOutput;
  if (githubOutputPath) {
    writeGithubOutputs(githubOutputPath, outputs);
  }

  const rendered = JSON.stringify(outputs, undefined, 0);
  process.stdout.write(`${rendered}\n`);
  if (!args.printJson) {
    return 0;
  }
  return 0;
}

process.exitCode = main();
