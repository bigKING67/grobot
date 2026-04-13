import { writeFileSync } from "node:fs";
import { runHarness } from "./hill-climb";

type JsonObject = Record<string, unknown>;

interface ParsedCliArgs {
  cases: string;
  runs: string;
  gatePolicy: string | null;
  output: string | null;
  printJson: boolean;
  failOnGate: boolean;
}

function asObject(value: unknown): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function parseArgs(argv: string[]): ParsedCliArgs {
  const args: ParsedCliArgs = {
    cases: "",
    runs: "",
    gatePolicy: null,
    output: null,
    printJson: false,
    failOnGate: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const readValue = (): string => {
      const value = argv[index + 1] ?? "";
      if (!value || value.startsWith("--")) {
        throw new Error(`missing value for ${token}`);
      }
      return value;
    };
    switch (token) {
      case "--cases":
        args.cases = readValue();
        index += 1;
        break;
      case "--runs":
        args.runs = readValue();
        index += 1;
        break;
      case "--gate-policy":
        args.gatePolicy = readValue();
        index += 1;
        break;
      case "--output":
        args.output = readValue();
        index += 1;
        break;
      case "--print-json":
        args.printJson = true;
        break;
      case "--fail-on-gate":
        args.failOnGate = true;
        break;
      default:
        throw new Error(`unknown argument: ${token}`);
    }
  }

  if (!args.cases) {
    throw new Error("missing required args: --cases");
  }
  if (!args.runs) {
    throw new Error("missing required args: --runs");
  }

  return args;
}

function formatNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function reportHasGateFailure(report: JsonObject): boolean {
  const variants = asObject(report.variants);
  if (variants != null) {
    for (const payload of Object.values(variants)) {
      const variant = asObject(payload);
      if (variant == null) {
        continue;
      }
      const gate = asObject(variant.gate);
      if (gate != null && gate.passed !== true) {
        return true;
      }
    }
  }
  const regressionGuard = asObject(report.regression_guard);
  if (regressionGuard != null && regressionGuard.passed !== true) {
    return true;
  }
  return false;
}

function printSummary(report: JsonObject): void {
  const variants = asObject(report.variants);
  if (variants == null) {
    process.stdout.write("no variants evaluated\n");
    return;
  }

  Object.entries(variants)
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([variantName, payload]) => {
      const variant = asObject(payload);
      if (variant == null) {
        return;
      }
      const summary = asObject(variant.summary) ?? {};
      const gate = asObject(variant.gate) ?? {};
      const caseCount = formatNumber(summary.case_count);
      const averageScore = formatNumber(summary.average_score);
      const passRate = formatNumber(summary.pass_rate);
      const gateStatus = gate.passed === true ? "PASS" : "FAIL";
      process.stdout.write(
        `[variant=${variantName}] cases=${Math.trunc(caseCount)} avg_score=${averageScore.toFixed(4)} pass_rate=${passRate.toFixed(4)} gate=${gateStatus}\n`
      );
      const splits = asObject(variant.splits);
      if (splits != null) {
        Object.entries(splits)
          .sort(([left], [right]) => left.localeCompare(right))
          .forEach(([splitName, splitPayload]) => {
            const split = asObject(splitPayload);
            if (split == null) {
              return;
            }
            const splitAverage = formatNumber(split.average_score);
            const splitPassRate = formatNumber(split.pass_rate);
            process.stdout.write(
              `  - split=${splitName} avg_score=${splitAverage.toFixed(4)} pass_rate=${splitPassRate.toFixed(4)}\n`
            );
          });
      }
      const failures = gate.failures;
      if (Array.isArray(failures)) {
        failures.forEach((item) => {
          if (typeof item !== "string") {
            return;
          }
          process.stdout.write(`    gate_failure: ${item}\n`);
        });
      }
    });

  const regressionGuard = asObject(report.regression_guard);
  if (regressionGuard != null) {
    const status = regressionGuard.passed === true ? "PASS" : "FAIL";
    process.stdout.write(`[regression_guard] ${status}\n`);
    const failures = regressionGuard.failures;
    if (Array.isArray(failures)) {
      failures.forEach((item) => {
        if (typeof item !== "string") {
          return;
        }
        process.stdout.write(`  - ${item}\n`);
      });
    }
  }
}

export function runCli(argv: string[]): number {
  const args = parseArgs(argv);
  const report = runHarness(args.cases, args.runs, args.gatePolicy);
  const reportPayload = report as unknown as JsonObject;
  printSummary(reportPayload);

  if (args.printJson) {
    process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`);
  }

  if (args.output != null) {
    writeFileSync(args.output, `${JSON.stringify(report, undefined, 2)}\n`, "utf8");
  }

  if (args.failOnGate && reportHasGateFailure(reportPayload)) {
    return 2;
  }
  return 0;
}

const entryScript = process.argv[1] ?? "";
const shouldRunCli = entryScript.includes("runner");

if (shouldRunCli) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`runner fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
