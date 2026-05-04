import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { runHarness } from "./harness";
import { hillClimbFromReport, mergeJsonl } from "./selection";
import { type ParsedCliArgs } from "./types";

function parseArgs(argv: string[]): ParsedCliArgs {
  const args: ParsedCliArgs = {
    cases: "",
    runs: [],
    gatePolicy: null,
    baselineVariant: "",
    minOptimizationGain: 0,
    allowHoldoutDrop: 0,
    output: null,
    printJson: false,
    failIfNoImprovement: false,
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
      case "--runs": {
        const runs: string[] = [];
        for (let cursor = index + 1; cursor < argv.length; cursor += 1) {
          const value = argv[cursor] ?? "";
          if (!value || value.startsWith("--")) {
            break;
          }
          runs.push(value);
          index = cursor;
        }
        args.runs = runs;
        break;
      }
      case "--gate-policy":
        args.gatePolicy = readValue();
        index += 1;
        break;
      case "--baseline-variant":
        args.baselineVariant = readValue();
        index += 1;
        break;
      case "--min-optimization-gain":
        args.minOptimizationGain = Number.parseFloat(readValue());
        if (!Number.isFinite(args.minOptimizationGain)) {
          throw new Error("--min-optimization-gain must be number");
        }
        index += 1;
        break;
      case "--allow-holdout-drop":
        args.allowHoldoutDrop = Number.parseFloat(readValue());
        if (!Number.isFinite(args.allowHoldoutDrop)) {
          throw new Error("--allow-holdout-drop must be number");
        }
        index += 1;
        break;
      case "--output":
        args.output = readValue();
        index += 1;
        break;
      case "--print-json":
        args.printJson = true;
        break;
      case "--fail-if-no-improvement":
        args.failIfNoImprovement = true;
        break;
      default:
        throw new Error(`unknown argument: ${token}`);
    }
  }

  if (!args.cases) {
    throw new Error("missing required args: --cases");
  }
  if (args.runs.length === 0) {
    throw new Error("missing required args: --runs");
  }
  if (!args.baselineVariant) {
    throw new Error("missing required args: --baseline-variant");
  }
  return args;
}

export function runCli(argv: string[]): number {
  const args = parseArgs(argv);
  const tempDir = resolve(process.cwd(), "gateway/evals/data");
  mkdirSync(tempDir, { recursive: true });
  const randomSuffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const mergedRunsPath = resolve(tempDir, `.tmp-hill-climb-runs-${randomSuffix}.jsonl`);

  try {
    mergeJsonl(args.runs, mergedRunsPath);
    const report = runHarness(args.cases, mergedRunsPath, args.gatePolicy);
    const result = hillClimbFromReport(
      report,
      args.baselineVariant,
      args.minOptimizationGain,
      args.allowHoldoutDrop
    );

    const winner = typeof result.winner === "string" ? result.winner : "";
    const baseline = typeof result.baseline === "string" ? result.baseline : "";
    const improved = winner !== baseline;
    const trail = Array.isArray(result.trail) ? result.trail : [];

    process.stdout.write(
      `winner=${winner} baseline=${baseline} improved=${String(improved).toLowerCase()} trail_steps=${trail.length}\n`
    );

    const payload = { result, report };
    if (args.printJson) {
      process.stdout.write(`${JSON.stringify(payload, undefined, 2)}\n`);
    }
    if (args.output != null) {
      writeFileSync(args.output, `${JSON.stringify(payload, undefined, 2)}\n`, "utf8");
    }
    if (args.failIfNoImprovement && !improved) {
      return 2;
    }
    return 0;
  } finally {
    if (existsSync(mergedRunsPath)) {
      unlinkSync(mergedRunsPath);
    }
  }
}
