import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import {
  evaluatePlanQualityBenchmark,
  planQualityGuardModeInputErrorPayload,
  resolvePlanQualityGuardMode,
  resolvePlanQualityGuardPolicy,
} from "../../cli/start/plan-artifact";

interface PlanInput {
  label: string;
  path: string;
}

interface ParsedArgs {
  plans: PlanInput[];
  workDir: string;
  sessionId: string;
  printJson: boolean;
  assertBest?: string;
}

interface BenchRow {
  rank: number;
  label: string;
  path: string;
  score: number;
  grade: "A" | "B" | "C" | "D" | "E";
  finding_count: number;
  blocked: boolean;
  guard_level: "healthy" | "watch" | "critical";
  guard_reason: string;
  repair_action_count: number;
  top_hint: string;
  top_repair_action: string;
}

function parsePlanSpec(raw: string): PlanInput {
  const trimmed = raw.trim();
  const splitIndex = trimmed.indexOf("=");
  if (splitIndex <= 0 || splitIndex >= trimmed.length - 1) {
    throw new Error(`invalid --plan format: ${raw}; expected label=/abs/or/relative/path.md`);
  }
  const label = trimmed.slice(0, splitIndex).trim();
  const pathRaw = trimmed.slice(splitIndex + 1).trim();
  if (!label) {
    throw new Error(`invalid --plan label: ${raw}`);
  }
  if (!pathRaw) {
    throw new Error(`invalid --plan path: ${raw}`);
  }
  return {
    label,
    path: resolvePath(pathRaw),
  };
}

function parseArgs(argv: string[]): ParsedArgs {
  const plans: PlanInput[] = [];
  let workDir = resolvePath(process.cwd());
  let sessionId = "__plan_quality_benchmark__";
  let printJson = false;
  let assertBest: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token) {
      continue;
    }
    if (token === "--plan") {
      const value = argv[index + 1] ?? "";
      if (!value || value.startsWith("--")) {
        throw new Error("missing value for --plan");
      }
      plans.push(parsePlanSpec(value));
      index += 1;
      continue;
    }
    if (token === "--work-dir") {
      const value = argv[index + 1] ?? "";
      if (!value || value.startsWith("--")) {
        throw new Error("missing value for --work-dir");
      }
      workDir = resolvePath(value);
      index += 1;
      continue;
    }
    if (token === "--session-id") {
      const value = argv[index + 1] ?? "";
      if (!value || value.startsWith("--")) {
        throw new Error("missing value for --session-id");
      }
      sessionId = value.trim() || sessionId;
      index += 1;
      continue;
    }
    if (token === "--assert-best") {
      const value = argv[index + 1] ?? "";
      if (!value || value.startsWith("--")) {
        throw new Error("missing value for --assert-best");
      }
      assertBest = value.trim();
      index += 1;
      continue;
    }
    if (token === "--print-json") {
      printJson = true;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (plans.length === 0) {
    throw new Error("at least one --plan label=path is required");
  }
  return {
    plans,
    workDir,
    sessionId,
    printJson,
    assertBest,
  };
}

function runBenchmark(args: ParsedArgs): {
  rows: BenchRow[];
  winner: BenchRow;
  guardPolicyProfile: string;
  guardPolicySource: string;
  guardMode: "off" | "warn" | "strict";
  guardPolicyPath?: string;
  guardPolicyWarning?: string;
} {
  const guardPolicy = resolvePlanQualityGuardPolicy({
    workDir: args.workDir,
  });
  const guardMode = resolvePlanQualityGuardMode(
    process.env.GROBOT_PLAN_QUALITY_GUARD_MODE,
    guardPolicy.policy.defaults.mode,
  );
  const benchmark = evaluatePlanQualityBenchmark({
    workDir: args.workDir,
    sessionId: args.sessionId,
    policy: guardPolicy.policy,
    candidates: args.plans.map((plan) => ({
      label: plan.label,
      content: readFileSync(plan.path, "utf8"),
      sourcePath: plan.path,
    })),
  });
  const ranked = benchmark.rows.map((row) => ({
    rank: row.rank,
    label: row.label,
    path: row.sourcePath ?? "",
    score: row.score,
    grade: row.grade,
    finding_count: row.findingCount,
    blocked: row.blocked,
    guard_level: row.guardLevel,
    guard_reason: row.guardReason,
    repair_action_count: row.repairActionCount,
    top_hint: row.topHint,
    top_repair_action: row.topRepairAction,
  }));
  const winner = ranked[0];
  return {
    rows: ranked,
    winner,
    guardPolicyProfile: guardPolicy.policy.profile,
    guardPolicySource: guardPolicy.source,
    guardMode,
    guardPolicyPath: guardPolicy.policyPath,
    guardPolicyWarning: guardPolicy.warning,
  };
}

function formatConsoleOutput(result: ReturnType<typeof runBenchmark>): string {
  const lines: string[] = [];
  lines.push(
    `[plan-quality-benchmark] winner=${result.winner.label} score=${String(result.winner.score)} grade=${result.winner.grade} guard=${result.winner.guard_level} mode=${result.guardMode} profile=${result.guardPolicyProfile} source=${result.guardPolicySource}`,
  );
  if (result.guardPolicyPath) {
    lines.push(`[plan-quality-benchmark] policy_path=${result.guardPolicyPath}`);
  }
  if (result.guardPolicyWarning) {
    lines.push(`[plan-quality-benchmark] policy_warning=${result.guardPolicyWarning}`);
  }
  for (const row of result.rows) {
    lines.push(
      `[rank ${String(row.rank)}] ${row.label} score=${String(row.score)} grade=${row.grade} findings=${String(row.finding_count)} blocked=${row.blocked ? "yes" : "no"} guard=${row.guard_level} top_hint=${row.top_hint || "<none>"} top_repair=${row.top_repair_action || "<none>"}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function main(argv: string[]): number {
  const args = parseArgs(argv);
  const result = runBenchmark(args);
  const payload = {
    status: "ok" as const,
    compared_count: result.rows.length,
    winner_label: result.winner.label,
    winner_score: result.winner.score,
    winner_grade: result.winner.grade,
    guard_mode: result.guardMode,
    guard_policy_profile: result.guardPolicyProfile,
    guard_policy_source: result.guardPolicySource,
    guard_policy_path: result.guardPolicyPath,
    guard_policy_warning: result.guardPolicyWarning,
    rows: result.rows,
  };
  if (args.assertBest && result.winner.label !== args.assertBest) {
    if (args.printJson) {
      process.stdout.write(`${JSON.stringify({
        ...payload,
        status: "error",
        error_code: "PLAN_BENCHMARK_ASSERT_BEST_FAILED",
        expected_best: args.assertBest,
      })}\n`);
    } else {
      process.stdout.write(formatConsoleOutput(result));
      process.stderr.write(
        `[plan-quality-benchmark] assert-best failed expected=${args.assertBest} actual=${result.winner.label}\n`,
      );
    }
    return 2;
  }
  if (args.printJson) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    process.stdout.write(formatConsoleOutput(result));
  }
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  const planQualityGuardModeError = planQualityGuardModeInputErrorPayload(error);
  if (planQualityGuardModeError) {
    process.stderr.write(
      `plan-quality-benchmark failed: ${planQualityGuardModeError.error_code}: ${planQualityGuardModeError.detail}\n`,
    );
    process.exitCode = 2;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`plan-quality-benchmark failed: ${message}\n`);
    process.exitCode = 1;
  }
}
