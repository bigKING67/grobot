import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { parseSkillRouterEvalCliArgs } from "./skill-router/cli-args";
import {
  discoverSkillDescriptors,
  loadToml,
  resolveSkillRouterConfig,
} from "./skill-router/descriptor-discovery";
import {
  evaluateSkillRouterCases,
  evaluateSkillRouterGate,
  evaluateSkillRouterTrend,
  loadSkillRouterCases,
} from "./skill-router/routing-evaluation";
import {
  asObject,
  dirname,
  normalizePath,
  pathJoin,
  type JsonObject,
  type SkillRouterPolicyConfig,
} from "./skill-router/shared";
import { computeSkillRouterPolicyFingerprint, loadSkillRouterEvalPolicy } from "./skill-router-policy-guard";

function loadReportSummary(path: string): JsonObject {
  const payloadRaw = JSON.parse(readFileSync(path, "utf8"));
  if (typeof payloadRaw !== "object" || payloadRaw === null || Array.isArray(payloadRaw)) {
    throw new Error("compare report must be JSON object");
  }
  const payload = payloadRaw as JsonObject;
  const summaryRaw = payload.summary;
  if (typeof summaryRaw === "object" && summaryRaw !== null && !Array.isArray(summaryRaw)) {
    return summaryRaw as JsonObject;
  }
  if ("accuracy" in payload || "forbidden_violations" in payload) {
    return payload;
  }
  throw new Error("compare report must include summary or top-level accuracy/forbidden_violations");
}

function withSource(value: unknown, source: string): JsonObject {
  return { value, source };
}

function loadPolicyConfig(path: string): SkillRouterPolicyConfig {
  const policy = loadSkillRouterEvalPolicy(path) as unknown as JsonObject;
  const routerOverrides = asObject(policy.router_overrides);
  const gates = asObject(policy.gates);
  const sourcePath = normalizePath(resolvePath(path));
  const cases = typeof policy.cases === "string" ? policy.cases : "";
  const globalSkillsDir = typeof policy.global_skills_dir === "string" ? policy.global_skills_dir : "";
  const projectSkillsDir = typeof policy.project_skills_dir === "string" ? policy.project_skills_dir : "";
  const projectToml = typeof policy.project_toml === "string" ? policy.project_toml : null;
  const scoreThreshold = typeof routerOverrides.score_threshold === "number" ? routerOverrides.score_threshold : null;
  const minScoreGap = typeof routerOverrides.min_score_gap === "number" ? routerOverrides.min_score_gap : null;
  const maxDescriptors =
    typeof routerOverrides.max_descriptors === "number" && Number.isInteger(routerOverrides.max_descriptors)
      ? routerOverrides.max_descriptors
      : null;
  const descriptorScanLines =
    typeof routerOverrides.descriptor_scan_lines === "number" &&
    Number.isInteger(routerOverrides.descriptor_scan_lines)
      ? routerOverrides.descriptor_scan_lines
      : null;
  const minAccuracy = typeof gates.min_accuracy === "number" ? gates.min_accuracy : null;
  const maxForbiddenViolations =
    typeof gates.max_forbidden_violations === "number" && Number.isInteger(gates.max_forbidden_violations)
      ? gates.max_forbidden_violations
      : null;
  const maxAccuracyDrop = typeof gates.max_accuracy_drop === "number" ? gates.max_accuracy_drop : null;
  const maxForbiddenIncrease =
    typeof gates.max_forbidden_increase === "number" && Number.isInteger(gates.max_forbidden_increase)
      ? gates.max_forbidden_increase
      : null;
  return {
    sourcePath,
    cases,
    globalSkillsDir,
    projectSkillsDir,
    projectToml,
    scoreThreshold,
    minScoreGap,
    maxDescriptors,
    descriptorScanLines,
    minAccuracy,
    maxForbiddenViolations,
    maxAccuracyDrop,
    maxForbiddenIncrease,
  };
}

function formatSummaryLine(input: {
  total: number;
  passed: number;
  accuracy: number;
  precision: number;
  recall: number;
  forbiddenViolations: number;
  gatePassed: boolean;
  trendState: string;
}): string {
  return (
    `cases=${input.total} passed=${input.passed} accuracy=${input.accuracy.toFixed(3)} ` +
    `precision=${input.precision.toFixed(3)} recall=${input.recall.toFixed(3)} ` +
    `forbidden_violations=${input.forbiddenViolations} gate=${input.gatePassed ? "pass" : "fail"} trend=${input.trendState}`
  );
}

function writeJsonFile(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, undefined, 2)}\n`, "utf8");
}

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, undefined, 2)}\n`);
}

export function runCli(argv: string[]): number {
  const args = parseSkillRouterEvalCliArgs(argv);

  let policy: SkillRouterPolicyConfig | null = null;
  let policyHash: string | null = null;
  let policyCanonical: JsonObject | null = null;
  if (args.policyPath !== null) {
    policy = loadPolicyConfig(args.policyPath);
    const fingerprint = computeSkillRouterPolicyFingerprint(args.policyPath);
    policyHash = fingerprint.policyHash;
    policyCanonical = fingerprint.canonical;
  }

  const cwd = normalizePath(process.cwd());
  const home = typeof process.env.HOME === "string" ? normalizePath(process.env.HOME) : "";
  const defaultGlobalSkillsDir = home ? pathJoin(home, ".grobot/skills") : ".grobot/skills";
  const defaultProjectSkillsDir = pathJoin(cwd, ".grobot/skills");
  const defaultProjectToml = pathJoin(cwd, ".grobot/project.toml");

  const casesPath = args.casesPath ?? policy?.cases ?? null;
  if (!casesPath) {
    throw new Error("Either --cases or --policy must provide cases path");
  }
  const globalSkillsDir = args.globalSkillsDir ?? policy?.globalSkillsDir ?? defaultGlobalSkillsDir;
  const projectSkillsDir = args.projectSkillsDir ?? policy?.projectSkillsDir ?? defaultProjectSkillsDir;
  const projectTomlPath = args.projectTomlPath ?? policy?.projectToml ?? defaultProjectToml;
  const projectToml = loadToml(projectTomlPath);
  const routerConfig = resolveSkillRouterConfig(projectToml);

  let maxDescriptors = routerConfig.maxDescriptors;
  let maxDescriptorsSource = "project_toml_default";
  if (typeof args.maxDescriptors === "number" && args.maxDescriptors > 0) {
    maxDescriptors = args.maxDescriptors;
    maxDescriptorsSource = "cli";
  } else if (policy !== null && typeof policy.maxDescriptors === "number") {
    maxDescriptors = policy.maxDescriptors;
    maxDescriptorsSource = "policy";
  }

  let descriptorScanLines = routerConfig.descriptorScanLines;
  let descriptorScanLinesSource = "project_toml_default";
  if (typeof args.descriptorScanLines === "number" && args.descriptorScanLines > 0) {
    descriptorScanLines = args.descriptorScanLines;
    descriptorScanLinesSource = "cli";
  } else if (policy !== null && typeof policy.descriptorScanLines === "number") {
    descriptorScanLines = policy.descriptorScanLines;
    descriptorScanLinesSource = "policy";
  }

  let scoreThreshold = routerConfig.scoreThreshold;
  let scoreThresholdSource = "project_toml_default";
  if (typeof args.scoreThreshold === "number") {
    scoreThreshold = args.scoreThreshold;
    scoreThresholdSource = "cli";
  } else if (policy !== null && typeof policy.scoreThreshold === "number") {
    scoreThreshold = policy.scoreThreshold;
    scoreThresholdSource = "policy";
  }

  let minScoreGap = routerConfig.minScoreGap;
  let minScoreGapSource = "project_toml_default";
  if (typeof args.minScoreGap === "number") {
    minScoreGap = args.minScoreGap;
    minScoreGapSource = "cli";
  } else if (policy !== null && typeof policy.minScoreGap === "number") {
    minScoreGap = policy.minScoreGap;
    minScoreGapSource = "policy";
  }

  let minAccuracy = args.minAccuracy;
  let minAccuracySource = "unset";
  if (typeof minAccuracy === "number") {
    minAccuracySource = "cli";
  } else if (policy !== null && typeof policy.minAccuracy === "number") {
    minAccuracy = policy.minAccuracy;
    minAccuracySource = "policy";
  }

  let maxForbiddenViolations = args.maxForbiddenViolations;
  let maxForbiddenViolationsSource = "unset";
  if (typeof maxForbiddenViolations === "number") {
    maxForbiddenViolationsSource = "cli";
  } else if (policy !== null && typeof policy.maxForbiddenViolations === "number") {
    maxForbiddenViolations = policy.maxForbiddenViolations;
    maxForbiddenViolationsSource = "policy";
  }
  if (args.failOnForbidden && maxForbiddenViolations === null) {
    maxForbiddenViolations = 0;
    maxForbiddenViolationsSource = "fail_on_forbidden_flag";
  }

  let maxAccuracyDrop = args.maxAccuracyDrop;
  let maxAccuracyDropSource = "unset";
  if (typeof maxAccuracyDrop === "number") {
    maxAccuracyDropSource = "cli";
  } else if (policy !== null && typeof policy.maxAccuracyDrop === "number") {
    maxAccuracyDrop = policy.maxAccuracyDrop;
    maxAccuracyDropSource = "policy";
  }

  let maxForbiddenIncrease = args.maxForbiddenIncrease;
  let maxForbiddenIncreaseSource = "unset";
  if (typeof maxForbiddenIncrease === "number") {
    maxForbiddenIncreaseSource = "cli";
  } else if (policy !== null && typeof policy.maxForbiddenIncrease === "number") {
    maxForbiddenIncrease = policy.maxForbiddenIncrease;
    maxForbiddenIncreaseSource = "policy";
  }
  if (args.failOnTrend) {
    if (maxAccuracyDrop === null) {
      maxAccuracyDrop = 0.0;
      maxAccuracyDropSource = "fail_on_trend_default";
    }
    if (maxForbiddenIncrease === null) {
      maxForbiddenIncrease = 0;
      maxForbiddenIncreaseSource = "fail_on_trend_default";
    }
  }

  const effectiveSources: JsonObject = {
    score_threshold: withSource(scoreThreshold, scoreThresholdSource),
    min_score_gap: withSource(minScoreGap, minScoreGapSource),
    max_descriptors: withSource(maxDescriptors, maxDescriptorsSource),
    descriptor_scan_lines: withSource(descriptorScanLines, descriptorScanLinesSource),
    min_accuracy: withSource(minAccuracy, minAccuracySource),
    max_forbidden_violations: withSource(maxForbiddenViolations, maxForbiddenViolationsSource),
  };
  const trendConfig: JsonObject = {
    compare_report: args.compareReportPath,
    max_accuracy_drop: maxAccuracyDrop,
    max_forbidden_increase: maxForbiddenIncrease,
  };
  const trendSources: JsonObject = {
    max_accuracy_drop: withSource(maxAccuracyDrop, maxAccuracyDropSource),
    max_forbidden_increase: withSource(maxForbiddenIncrease, maxForbiddenIncreaseSource),
  };

  if (args.dryValidateOnly) {
    const payload: JsonObject = {
      status: "ok",
      effective: {
        cases: casesPath,
        global_skills_dir: globalSkillsDir,
        project_skills_dir: projectSkillsDir,
        project_toml: projectTomlPath,
        score_threshold: scoreThreshold,
        min_score_gap: minScoreGap,
        max_descriptors: maxDescriptors,
        descriptor_scan_lines: descriptorScanLines,
        min_accuracy: minAccuracy,
        max_forbidden_violations: maxForbiddenViolations,
      },
      effective_sources: effectiveSources,
      trend_config: trendConfig,
      trend_sources: trendSources,
      policy: {
        path: policy?.sourcePath ?? null,
        hash: policyHash,
        canonical: policyCanonical,
      },
    };
    if (args.printJson) {
      printJson(payload);
    } else {
      process.stdout.write(
        `validated policy=${policy?.sourcePath ?? "none"} cases=${casesPath} global_skills=${globalSkillsDir} project_skills=${projectSkillsDir}\n`,
      );
    }
    return 0;
  }

  const descriptors = routerConfig.enabled
    ? discoverSkillDescriptors(globalSkillsDir, projectSkillsDir, {
        maxDescriptors,
        descriptorScanLines,
      })
    : [];
  const cases = loadSkillRouterCases(casesPath);
  const report = evaluateSkillRouterCases({
    cases,
    descriptors,
    scoreThreshold,
    minScoreGap,
  });
  const summaryRaw = report.summary;
  const summary =
    typeof summaryRaw === "object" && summaryRaw !== null && !Array.isArray(summaryRaw)
      ? (summaryRaw as JsonObject)
      : {};
  const gate = evaluateSkillRouterGate({
    summary,
    minAccuracy,
    maxForbiddenViolations,
  });

  let trend: JsonObject | null = null;
  if (args.compareReportPath !== null) {
    const baselineSummary = loadReportSummary(args.compareReportPath);
    trend = evaluateSkillRouterTrend({
      currentSummary: summary,
      baselineSummary,
      maxAccuracyDrop,
      maxForbiddenIncrease,
    });
  }

  report.gate = gate;
  report.effective = {
    cases: casesPath,
    global_skills_dir: globalSkillsDir,
    project_skills_dir: projectSkillsDir,
    project_toml: projectTomlPath,
    score_threshold: scoreThreshold,
    min_score_gap: minScoreGap,
    max_descriptors: maxDescriptors,
    descriptor_scan_lines: descriptorScanLines,
    min_accuracy: minAccuracy,
    max_forbidden_violations: maxForbiddenViolations,
  };
  report.effective_sources = effectiveSources;
  report.trend_config = trendConfig;
  report.trend_sources = trendSources;
  report.trend = trend;
  report.policy = {
    path: policy?.sourcePath ?? null,
    hash: policyHash,
    canonical: policyCanonical,
  };

  const trendState = trend === null ? "n/a" : (trend.passed === true ? "pass" : "fail");
  const totalCases = typeof summary.total_cases === "number" ? Math.trunc(summary.total_cases) : 0;
  const passedCases = typeof summary.passed_cases === "number" ? Math.trunc(summary.passed_cases) : 0;
  const accuracy = typeof summary.accuracy === "number" ? summary.accuracy : 0;
  const precision = typeof summary.precision === "number" ? summary.precision : 0;
  const recall = typeof summary.recall === "number" ? summary.recall : 0;
  const forbiddenViolations =
    typeof summary.forbidden_violations === "number" ? Math.trunc(summary.forbidden_violations) : 0;
  const gatePassed = gate.passed === true;
  process.stdout.write(
    `${formatSummaryLine({
      total: totalCases,
      passed: passedCases,
      accuracy,
      precision,
      recall,
      forbiddenViolations,
      gatePassed,
      trendState,
    })}\n`,
  );

  if (args.printJson) {
    printJson(report);
  }
  if (args.outputPath !== null) {
    writeJsonFile(args.outputPath, report);
  }

  if (args.failOnForbidden && forbiddenViolations > 0) {
    return 2;
  }
  if (typeof args.minAccuracy === "number" && accuracy < args.minAccuracy) {
    return 3;
  }
  if (typeof args.maxForbiddenViolations === "number" && forbiddenViolations > args.maxForbiddenViolations) {
    return 5;
  }
  if (args.failOnTrend) {
    if (trend === null) {
      throw new Error("--fail-on-trend requires --compare-report");
    }
    if (trend.passed !== true) {
      return 6;
    }
  }
  if (args.failOnGate && gatePassed !== true) {
    return 4;
  }
  return 0;
}

const entryScript = process.argv[1] ?? "";
const shouldRunCli = entryScript.includes("skill-router-eval");

if (shouldRunCli) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`skill-router-eval fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
