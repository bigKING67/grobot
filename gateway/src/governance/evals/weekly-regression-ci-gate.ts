import { parseArgs } from "./weekly-regression-ci-gate/cli";
import { runWeeklyRegressionCiGate } from "./weekly-regression-ci-gate/runner";

export { runWeeklyRegressionCiGate } from "./weekly-regression-ci-gate/runner";
export type {
  WeeklyRegressionCiGateInput,
  WeeklyRegressionCiGateResult,
} from "./weekly-regression-ci-gate/types";

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
