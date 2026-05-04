import { parseArgs } from "./plan-events-policy-guard/cli-args";
import { readJsonObject } from "./plan-events-policy-guard/json";
import { evaluatePolicy } from "./plan-events-policy-guard/evaluate";
import { applyPolicyEnvOverrides } from "./plan-events-policy-guard/overrides";
import { loadPolicy } from "./plan-events-policy-guard/policy";

function main(argv: string[]): number {
  const cli = parseArgs(argv);
  const policyLoaded = loadPolicy(cli.policyPath);
  const overrideResult = applyPolicyEnvOverrides(policyLoaded);
  const report = readJsonObject(cli.reportPath);
  const result = evaluatePolicy(overrideResult.policy, report);
  const output = {
    ...result,
    policy_overrides: overrideResult.overrides,
    policy_override_scope: overrideResult.scope,
  };
  if (cli.printJson) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } else {
    const overrideCount = Object.keys(overrideResult.overrides).length;
    const allowCount = overrideResult.scope.allow_fields.length;
    const denyCount = overrideResult.scope.deny_fields.length;
    process.stdout.write(
      `[plan-events-policy-guard] status=${result.status} violations=${String(result.violations_count)} overrides=${String(overrideCount)} allow=${String(allowCount)} deny=${String(denyCount)}\n`,
    );
  }
  return result.status === "ok" ? 0 : 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`plan-events-policy-guard failed: ${message}\n`);
  process.exitCode = 1;
}
