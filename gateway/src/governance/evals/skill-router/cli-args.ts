export interface SkillRouterEvalCliArgs {
  policyPath: string | null;
  casesPath: string | null;
  globalSkillsDir: string | null;
  projectSkillsDir: string | null;
  projectTomlPath: string | null;
  scoreThreshold: number | null;
  minScoreGap: number | null;
  maxDescriptors: number | null;
  descriptorScanLines: number | null;
  compareReportPath: string | null;
  maxAccuracyDrop: number | null;
  maxForbiddenIncrease: number | null;
  outputPath: string | null;
  printJson: boolean;
  failOnForbidden: boolean;
  minAccuracy: number | null;
  maxForbiddenViolations: number | null;
  failOnGate: boolean;
  dryValidateOnly: boolean;
  failOnTrend: boolean;
}

function readArgValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1] ?? "";
  if (!value || value.startsWith("--")) {
    throw new Error(`missing value for ${flag}`);
  }
  return value;
}

function parseInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${flag} must be int`);
  }
  return parsed;
}

function parseFloatNumber(value: string, flag: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be number`);
  }
  return parsed;
}

export function parseSkillRouterEvalCliArgs(argv: string[]): SkillRouterEvalCliArgs {
  const args: SkillRouterEvalCliArgs = {
    policyPath: null,
    casesPath: null,
    globalSkillsDir: null,
    projectSkillsDir: null,
    projectTomlPath: null,
    scoreThreshold: null,
    minScoreGap: null,
    maxDescriptors: null,
    descriptorScanLines: null,
    compareReportPath: null,
    maxAccuracyDrop: null,
    maxForbiddenIncrease: null,
    outputPath: null,
    printJson: false,
    failOnForbidden: false,
    minAccuracy: null,
    maxForbiddenViolations: null,
    failOnGate: false,
    dryValidateOnly: false,
    failOnTrend: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--policy":
        args.policyPath = readArgValue(argv, index, "--policy");
        index += 1;
        break;
      case "--cases":
        args.casesPath = readArgValue(argv, index, "--cases");
        index += 1;
        break;
      case "--global-skills-dir":
        args.globalSkillsDir = readArgValue(argv, index, "--global-skills-dir");
        index += 1;
        break;
      case "--project-skills-dir":
        args.projectSkillsDir = readArgValue(argv, index, "--project-skills-dir");
        index += 1;
        break;
      case "--project-toml":
        args.projectTomlPath = readArgValue(argv, index, "--project-toml");
        index += 1;
        break;
      case "--score-threshold":
        args.scoreThreshold = parseFloatNumber(readArgValue(argv, index, "--score-threshold"), "--score-threshold");
        index += 1;
        break;
      case "--min-score-gap":
        args.minScoreGap = parseFloatNumber(readArgValue(argv, index, "--min-score-gap"), "--min-score-gap");
        index += 1;
        break;
      case "--max-descriptors":
        args.maxDescriptors = parseInteger(readArgValue(argv, index, "--max-descriptors"), "--max-descriptors");
        index += 1;
        break;
      case "--descriptor-scan-lines":
        args.descriptorScanLines = parseInteger(
          readArgValue(argv, index, "--descriptor-scan-lines"),
          "--descriptor-scan-lines",
        );
        index += 1;
        break;
      case "--compare-report":
        args.compareReportPath = readArgValue(argv, index, "--compare-report");
        index += 1;
        break;
      case "--max-accuracy-drop":
        args.maxAccuracyDrop = parseFloatNumber(
          readArgValue(argv, index, "--max-accuracy-drop"),
          "--max-accuracy-drop",
        );
        index += 1;
        break;
      case "--max-forbidden-increase":
        args.maxForbiddenIncrease = parseInteger(
          readArgValue(argv, index, "--max-forbidden-increase"),
          "--max-forbidden-increase",
        );
        index += 1;
        break;
      case "--output":
        args.outputPath = readArgValue(argv, index, "--output");
        index += 1;
        break;
      case "--print-json":
        args.printJson = true;
        break;
      case "--fail-on-forbidden":
        args.failOnForbidden = true;
        break;
      case "--min-accuracy":
        args.minAccuracy = parseFloatNumber(readArgValue(argv, index, "--min-accuracy"), "--min-accuracy");
        index += 1;
        break;
      case "--max-forbidden-violations":
        args.maxForbiddenViolations = parseInteger(
          readArgValue(argv, index, "--max-forbidden-violations"),
          "--max-forbidden-violations",
        );
        index += 1;
        break;
      case "--fail-on-gate":
        args.failOnGate = true;
        break;
      case "--dry-validate-only":
        args.dryValidateOnly = true;
        break;
      case "--fail-on-trend":
        args.failOnTrend = true;
        break;
      default:
        throw new Error(`unknown argument: ${token ?? ""}`);
    }
  }
  return args;
}
