import { readFileSync, writeFileSync } from "node:fs";

type JsonObject = Record<string, unknown>;

interface ParsedCliArgs {
  reports: string[];
  casesPath: string;
  outputPath: string | null;
  minObservations: number;
  minScore: number;
  maxRetireCount: number;
  printJson: boolean;
}

interface CaseObservation {
  caseId: string;
  score: number;
  passed: boolean;
  variant: string;
  reportIndex: number;
}

interface CaseProfile {
  caseId: string;
  split: string;
  category: string;
  tags: string[];
  behaviorTags: string[];
  mustPass: boolean;
}

function asObject(value: unknown): JsonObject | null {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be string`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must be non-empty string`);
  }
  return normalized;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => typeof item === "string")
    .map((item) => (item as string).trim())
    .filter((item) => item.length > 0);
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function parseArgs(argv: string[]): ParsedCliArgs {
  const args: ParsedCliArgs = {
    reports: [],
    casesPath: "",
    outputPath: null,
    minObservations: 4,
    minScore: 0.98,
    maxRetireCount: 20,
    printJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const readValue = (): string => {
      const value = argv[index + 1] ?? "";
      if (!value || value.startsWith("--")) {
        throw new Error(`eval-retire-saturated: missing value for ${token}`);
      }
      return value;
    };
    switch (token) {
      case "--reports": {
        const reports: string[] = [];
        for (let cursor = index + 1; cursor < argv.length; cursor += 1) {
          const value = argv[cursor] ?? "";
          if (!value || value.startsWith("--")) {
            break;
          }
          reports.push(value);
          index = cursor;
        }
        args.reports = reports;
        break;
      }
      case "--cases":
        args.casesPath = readValue();
        index += 1;
        break;
      case "--output":
        args.outputPath = readValue();
        index += 1;
        break;
      case "--min-observations":
        args.minObservations = Number.parseInt(readValue(), 10);
        if (!Number.isInteger(args.minObservations) || args.minObservations <= 0) {
          throw new Error("eval-retire-saturated: --min-observations must be integer > 0");
        }
        index += 1;
        break;
      case "--min-score":
        args.minScore = Number.parseFloat(readValue());
        if (!Number.isFinite(args.minScore) || args.minScore < 0 || args.minScore > 1) {
          throw new Error("eval-retire-saturated: --min-score must be number in [0,1]");
        }
        index += 1;
        break;
      case "--max-retire-count":
        args.maxRetireCount = Number.parseInt(readValue(), 10);
        if (!Number.isInteger(args.maxRetireCount) || args.maxRetireCount <= 0) {
          throw new Error("eval-retire-saturated: --max-retire-count must be integer > 0");
        }
        index += 1;
        break;
      case "--print-json":
        args.printJson = true;
        break;
      default:
        throw new Error(`eval-retire-saturated: unknown argument: ${token}`);
    }
  }

  if (args.reports.length === 0) {
    throw new Error("eval-retire-saturated: missing required args: --reports");
  }
  if (!args.casesPath) {
    throw new Error("eval-retire-saturated: missing required args: --cases");
  }
  return args;
}

function parseCases(path: string): Map<string, CaseProfile> {
  const rows = readFileSync(path, "utf8").split(/\r?\n/);
  const map = new Map<string, CaseProfile>();
  rows.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`${path}:${index + 1}: invalid JSON: ${String(error)}`);
    }
    const payload = asObject(parsed);
    if (payload == null) {
      throw new Error(`${path}:${index + 1}: row must be object`);
    }
    const caseId = asString(payload.id, `${path}:${index + 1}.id`);
    const tags = asStringList(payload.tags);
    const behaviorTags = asStringList(payload.behavior_tags);
    map.set(caseId, {
      caseId,
      split: asString(payload.split ?? "optimization", `${path}:${index + 1}.split`),
      category: asString(payload.category ?? "general", `${path}:${index + 1}.category`),
      tags,
      behaviorTags: behaviorTags.length > 0 ? behaviorTags : tags,
      mustPass: payload.must_pass === true,
    });
  });
  return map;
}

function parseReportCaseRows(path: string, reportIndex: number): CaseObservation[] {
  const payload = asObject(JSON.parse(readFileSync(path, "utf8")));
  if (payload == null) {
    throw new Error(`eval-retire-saturated: ${path} must be JSON object`);
  }
  const variants = asObject(payload.variants);
  if (variants == null) {
    return [];
  }
  const observations: CaseObservation[] = [];
  Object.entries(variants).forEach(([variantName, variantPayload]) => {
    const variant = asObject(variantPayload);
    if (variant == null) {
      return;
    }
    const cases = variant.cases;
    if (!Array.isArray(cases)) {
      return;
    }
    cases.forEach((item) => {
      const row = asObject(item);
      if (row == null) {
        return;
      }
      const caseId = asString(row.case_id, `${path}.cases.case_id`);
      observations.push({
        caseId,
        score: asNumber(row.overall_score, 0),
        passed: row.passed === true,
        variant: variantName,
        reportIndex,
      });
    });
  });
  return observations;
}

function runCli(argv: string[]): number {
  const args = parseArgs(argv);
  const profiles = parseCases(args.casesPath);
  const observationsByCase = new Map<string, CaseObservation[]>();
  args.reports.forEach((path, index) => {
    const observations = parseReportCaseRows(path, index);
    observations.forEach((row) => {
      const bucket = observationsByCase.get(row.caseId) ?? [];
      bucket.push(row);
      observationsByCase.set(row.caseId, bucket);
    });
  });

  const recommendations = Array.from(observationsByCase.entries())
    .map(([caseId, rows]) => {
      const profile = profiles.get(caseId);
      const observations = rows.length;
      const minScore = rows.reduce((min, item) => Math.min(min, item.score), 1);
      const passRate = rows.length > 0 ? rows.filter((item) => item.passed).length / rows.length : 0;
      const saturated = observations >= args.minObservations && minScore >= args.minScore && passRate >= 1;
      return {
        case_id: caseId,
        split: profile?.split ?? "unknown",
        category: profile?.category ?? "unknown",
        tags: profile?.tags ?? [],
        behavior_tags: profile?.behaviorTags ?? [],
        must_pass: profile?.mustPass ?? false,
        observations,
        min_score: minScore,
        pass_rate: passRate,
        saturated,
      };
    })
    .filter((item) => item.must_pass !== true)
    .sort((left, right) => {
      if (left.saturated !== right.saturated) {
        return left.saturated ? -1 : 1;
      }
      if (Math.abs(left.min_score - right.min_score) > 1e-9) {
        return right.min_score - left.min_score;
      }
      return right.observations - left.observations;
    });

  const saturatedCases = recommendations.filter((item) => item.saturated).slice(0, args.maxRetireCount);
  const payload = {
    generated_at: new Date().toISOString(),
    config: {
      reports: args.reports,
      cases: args.casesPath,
      min_observations: args.minObservations,
      min_score: args.minScore,
      max_retire_count: args.maxRetireCount,
    },
    saturated_case_count: saturatedCases.length,
    saturated_cases: saturatedCases,
    all_candidates: recommendations,
  };

  if (args.outputPath != null) {
    writeFileSync(args.outputPath, `${JSON.stringify(payload, undefined, 2)}\n`, "utf8");
  }
  process.stdout.write(
    `saturated_cases=${saturatedCases.length} candidates=${recommendations.length} min_observations=${args.minObservations} min_score=${args.minScore.toFixed(4)}\n`
  );
  if (args.printJson) {
    process.stdout.write(`${JSON.stringify(payload, undefined, 2)}\n`);
  }
  return 0;
}

const entryScript = process.argv[1] ?? "";
const shouldRunCli = entryScript.includes("eval-retire-saturated");

if (shouldRunCli) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`eval-retire-saturated fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
