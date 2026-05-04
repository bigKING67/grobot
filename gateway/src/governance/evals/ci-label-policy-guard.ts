export {
  computeCiLabelPolicyFingerprint,
  loadCiLabelPolicy,
} from "./ci-label-policy-guard/policy";
export {
  buildPolicyResult,
  validateCiLabelPolicyFile,
} from "./ci-label-policy-guard/result";
export {
  validateCiLabelPolicyConfig,
} from "./ci-label-policy-guard/validate";

import { parseArgs } from "./ci-label-policy-guard/cli-args";
import { buildPolicyResult } from "./ci-label-policy-guard/result";
import { type JsonObject } from "./ci-label-policy-guard/types";

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const results: JsonObject[] = [];
  let hasError = false;
  for (const policyPath of args.policies) {
    const result = buildPolicyResult(policyPath, args.printJson);
    if (result.ok !== true) {
      hasError = true;
    }
    results.push(result);
  }
  const output = { policies: results };
  if (args.printJson) {
    process.stdout.write(`${JSON.stringify(output, undefined, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
  return hasError ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`ci-label-policy-guard fatal: ${String(error)}\n`);
  process.exitCode = 1;
}
