import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { newRecordId } from "./harness-ledger";

type JsonObject = Record<string, unknown>;

type ChangeScope = "safety_threshold_tune" | "tool_quality_weight_tune" | "optimization_gate_tune";

interface AtomicChange {
  path: string;
  operation: "increase" | "decrease";
  step: number;
}

interface VariantSnapshot {
  variant: string;
  gatePassed: boolean;
  optimizationAvg: number;
  optimizationPassRate: number;
  holdoutAvg: number;
  holdoutPassRate: number;
  quality: number;
  safety: number;
  toolCorrectness: number;
  latencyCost: number;
  stability: number;
  rewardComposite: number;
  worstCaseIds: string[];
}

export interface CandidateProposal {
  proposal_id: string;
  source_variant: string;
  change_scope: ChangeScope;
  atomic_change: AtomicChange;
  expected_gain: string;
  risk: "low" | "medium" | "high";
  rollback_anchor: string;
  evidence_refs: string[];
}

export interface CandidateManifest {
  generated_at: string;
  report_generated_at: string | null;
  baseline_variant: string;
  proposals: CandidateProposal[];
}

interface ParsedCliArgs {
  reportPath: string;
  outputPath: string;
  baselineVariant: string | null;
  maxProposals: number;
  printJson: boolean;
}

function dirname(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function asObject(value: unknown): JsonObject | null {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function readSplitMetric(payload: JsonObject, split: string, key: string): number {
  const splits = asObject(payload.splits);
  if (splits == null) {
    return 0;
  }
  const splitObject = asObject(splits[split]);
  if (splitObject == null) {
    return 0;
  }
  return asNumber(splitObject[key], 0);
}

function readSummaryMetric(payload: JsonObject, metric: string): number {
  const summary = asObject(payload.summary);
  if (summary == null) {
    return 0;
  }
  const metricAverages = asObject(summary.metric_averages);
  if (metricAverages == null) {
    return 0;
  }
  return asNumber(metricAverages[metric], 0);
}

function parseWorstCases(payload: JsonObject): string[] {
  const rows = payload.worst_cases;
  if (!Array.isArray(rows)) {
    return [];
  }
  const output: string[] = [];
  rows.forEach((item) => {
    const row = asObject(item);
    if (row == null) {
      return;
    }
    const caseId = asString(row.case_id);
    if (caseId == null) {
      return;
    }
    output.push(caseId);
  });
  return output;
}

function parseVariantSnapshot(variantName: string, payload: unknown): VariantSnapshot | null {
  const variant = asObject(payload);
  if (variant == null) {
    return null;
  }
  const gate = asObject(variant.gate) ?? {};
  const reward = asObject(variant.reward_v1) ?? {};
  const quality = asNumber(reward.quality, asNumber(asObject(variant.summary)?.average_score, 0));
  const safety = asNumber(reward.safety, readSummaryMetric(variant, "safety_compliance"));
  const toolCorrectness = asNumber(reward.tool_correctness, readSummaryMetric(variant, "tool_use_quality"));
  const latencyCost = asNumber(reward.latency_cost, readSummaryMetric(variant, "latency_cost"));
  const stability = asNumber(
    reward.stability,
    (readSplitMetric(variant, "holdout", "average_score") + readSplitMetric(variant, "holdout", "pass_rate")) / 2
  );
  return {
    variant: variantName,
    gatePassed: gate.passed === true,
    optimizationAvg: readSplitMetric(variant, "optimization", "average_score"),
    optimizationPassRate: readSplitMetric(variant, "optimization", "pass_rate"),
    holdoutAvg: readSplitMetric(variant, "holdout", "average_score"),
    holdoutPassRate: readSplitMetric(variant, "holdout", "pass_rate"),
    quality,
    safety,
    toolCorrectness,
    latencyCost,
    stability,
    rewardComposite: asNumber(reward.composite_score, 0),
    worstCaseIds: parseWorstCases(variant),
  };
}

function resolveBaselineVariant(report: JsonObject, explicitBaseline: string | null, variants: string[]): string {
  if (explicitBaseline != null && explicitBaseline.length > 0) {
    return explicitBaseline;
  }
  const gatePolicy = asObject(report.gate_policy);
  const regression = gatePolicy == null ? null : asObject(gatePolicy.regression_guard);
  const fromPolicy = regression == null ? null : asString(regression.baseline_variant);
  if (fromPolicy != null && variants.includes(fromPolicy)) {
    return fromPolicy;
  }
  if (variants.length === 0) {
    throw new Error("candidate-generator: report contains no variants");
  }
  return variants[0];
}

function pickAtomicChange(snapshot: VariantSnapshot): { scope: ChangeScope; change: AtomicChange } {
  const dimensions: Array<{ name: string; value: number }> = [
    { name: "safety", value: snapshot.safety },
    { name: "tool", value: snapshot.toolCorrectness },
    { name: "quality", value: snapshot.quality },
  ];
  dimensions.sort((left, right) => left.value - right.value);
  const weakest = dimensions[0]?.name ?? "quality";
  if (weakest === "safety") {
    return {
      scope: "safety_threshold_tune",
      change: {
        path: "gate_policy.min_metric_averages.safety_compliance",
        operation: "increase",
        step: 0.01,
      },
    };
  }
  if (weakest === "tool") {
    return {
      scope: "tool_quality_weight_tune",
      change: {
        path: "reward_v1_weights.tool_correctness",
        operation: "increase",
        step: 0.03,
      },
    };
  }
  return {
    scope: "optimization_gate_tune",
    change: {
      path: "gate_policy.split_gates.optimization.min_average_score",
      operation: "decrease",
      step: 0.01,
    },
  };
}

function estimateRisk(optimizationGain: number, holdoutDelta: number): "low" | "medium" | "high" {
  if (holdoutDelta < 0) {
    return "high";
  }
  if (optimizationGain < 0.01) {
    return "medium";
  }
  return "low";
}

export function generateCandidateManifest(
  reportPayload: unknown,
  options: {
    baselineVariant: string | null;
    maxProposals: number;
  }
): CandidateManifest {
  const report = asObject(reportPayload);
  if (report == null) {
    throw new Error("candidate-generator: report must be object");
  }
  const variantsPayload = asObject(report.variants);
  if (variantsPayload == null) {
    throw new Error("candidate-generator: report.variants must be object");
  }

  const variants = Object.keys(variantsPayload).sort((left, right) => left.localeCompare(right));
  const baselineVariant = resolveBaselineVariant(report, options.baselineVariant, variants);
  const parsedVariants = new Map<string, VariantSnapshot>();
  variants.forEach((name) => {
    const snapshot = parseVariantSnapshot(name, variantsPayload[name]);
    if (snapshot != null) {
      parsedVariants.set(name, snapshot);
    }
  });
  const baseline = parsedVariants.get(baselineVariant);
  if (baseline == null) {
    throw new Error(`candidate-generator: baseline variant not found: ${baselineVariant}`);
  }

  const ranked = Array.from(parsedVariants.values())
    .filter((item) => item.variant !== baselineVariant && item.gatePassed)
    .sort((left, right) => {
      const rewardDiff = right.rewardComposite - left.rewardComposite;
      if (Math.abs(rewardDiff) > 1e-9) {
        return rewardDiff;
      }
      return right.optimizationAvg - left.optimizationAvg;
    });

  const proposals: CandidateProposal[] = ranked.slice(0, Math.max(0, options.maxProposals)).map((item) => {
    const optimizationGain = item.optimizationAvg - baseline.optimizationAvg;
    const holdoutDelta = item.holdoutAvg - baseline.holdoutAvg;
    const atomic = pickAtomicChange(item);
    const evidenceRefs = [`variant:${item.variant}`, ...item.worstCaseIds.slice(0, 3).map((id) => `case:${id}`)];
    return {
      proposal_id: newRecordId("proposal"),
      source_variant: item.variant,
      change_scope: atomic.scope,
      atomic_change: atomic.change,
      expected_gain: `optimization_avg_delta=${optimizationGain.toFixed(4)}, holdout_avg_delta=${holdoutDelta.toFixed(4)}, reward_v1_delta=${(item.rewardComposite - baseline.rewardComposite).toFixed(4)}`,
      risk: estimateRisk(optimizationGain, holdoutDelta),
      rollback_anchor: baselineVariant,
      evidence_refs: evidenceRefs,
    };
  });

  return {
    generated_at: new Date().toISOString(),
    report_generated_at: asString(report.generated_at),
    baseline_variant: baselineVariant,
    proposals,
  };
}

function parseArgs(argv: string[]): ParsedCliArgs {
  let reportPath = "";
  let outputPath = "gateway/evals/data/candidate_proposals.json";
  let baselineVariant: string | null = null;
  let maxProposals = 4;
  let printJson = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const readValue = (): string => {
      const value = argv[index + 1] ?? "";
      if (!value || value.startsWith("--")) {
        throw new Error(`candidate-generator: missing value for ${token}`);
      }
      return value;
    };
    switch (token) {
      case "--report":
        reportPath = readValue();
        index += 1;
        break;
      case "--output":
        outputPath = readValue();
        index += 1;
        break;
      case "--baseline-variant":
        baselineVariant = readValue();
        index += 1;
        break;
      case "--max-proposals":
        maxProposals = Number.parseInt(readValue(), 10);
        if (!Number.isInteger(maxProposals) || maxProposals < 0) {
          throw new Error("candidate-generator: --max-proposals must be integer >= 0");
        }
        index += 1;
        break;
      case "--print-json":
        printJson = true;
        break;
      default:
        throw new Error(`candidate-generator: unknown argument: ${token}`);
    }
  }
  if (!reportPath) {
    throw new Error("candidate-generator: missing required args: --report");
  }
  return { reportPath, outputPath, baselineVariant, maxProposals, printJson };
}

function runCli(argv: string[]): number {
  const args = parseArgs(argv);
  const reportRaw = readFileSync(args.reportPath, "utf8");
  const report = JSON.parse(reportRaw) as unknown;
  const manifest = generateCandidateManifest(report, {
    baselineVariant: args.baselineVariant,
    maxProposals: args.maxProposals,
  });

  mkdirSync(dirname(args.outputPath), { recursive: true });
  writeFileSync(args.outputPath, `${JSON.stringify(manifest, undefined, 2)}\n`, "utf8");
  process.stdout.write(
    `candidate_proposals=${manifest.proposals.length} baseline=${manifest.baseline_variant} output=${args.outputPath}\n`
  );
  if (args.printJson) {
    process.stdout.write(`${JSON.stringify(manifest, undefined, 2)}\n`);
  }
  return 0;
}

const entryScript = process.argv[1] ?? "";
const shouldRunCli = entryScript.includes("candidate-generator");

if (shouldRunCli) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`candidate-generator fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
