import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateCandidateManifest, CandidateProposal } from "./candidate-generator";
import {
  appendExperimentLedgerRecord,
  ExperimentLedgerRecord,
  loadExperimentLedger,
  newRecordId,
  VariantSnapshot,
} from "./harness-ledger";
import { runHarness } from "./hill-climb";

type JsonObject = Record<string, unknown>;

interface ParsedCliArgs {
  cases: string;
  runs: string[];
  gatePolicy: string | null;
  baselineVariant: string | null;
  output: string;
  manifestOutput: string;
  ledgerPath: string;
  maxCandidates: number;
  maxRounds: number;
  maxParallel: number;
  minOptimizationGain: number;
  allowHoldoutDrop: number;
  consecutiveFailuresToStop: number;
  cooldownHours: number;
  failIfNoSelection: boolean;
  printJson: boolean;
}

interface ProposalEvaluation {
  proposal_id: string;
  source_variant: string;
  status: "selected" | "accepted" | "rejected";
  reason: string;
  optimization_gain: number;
  holdout_drop: number;
  reward_v1_composite: number;
  risk: string;
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

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseVariantSnapshots(reportPayload: unknown): Map<string, VariantSnapshot> {
  const report = asObject(reportPayload);
  if (report == null) {
    throw new Error("auto-loop: report must be object");
  }
  const variants = asObject(report.variants);
  if (variants == null) {
    throw new Error("auto-loop: report.variants must be object");
  }
  const snapshots = new Map<string, VariantSnapshot>();
  Object.entries(variants)
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([variantName, payload]) => {
      const variant = asObject(payload);
      if (variant == null) {
        return;
      }
      const gate = asObject(variant.gate) ?? {};
      const reward = asObject(variant.reward_v1) ?? {};
      const splits = asObject(variant.splits) ?? {};
      const optimization = asObject(splits.optimization) ?? {};
      const holdout = asObject(splits.holdout) ?? {};
      snapshots.set(variantName, {
        variant: variantName,
        gate_passed: gate.passed === true,
        optimization_avg: asNumber(optimization.average_score, 0),
        optimization_pass_rate: asNumber(optimization.pass_rate, 0),
        holdout_avg: asNumber(holdout.average_score, 0),
        holdout_pass_rate: asNumber(holdout.pass_rate, 0),
        reward_v1_composite: asNumber(reward.composite_score, 0),
      });
    });
  return snapshots;
}

function readPolicyHash(path: string | null): string | null {
  if (path == null) {
    return null;
  }
  if (!existsSync(path)) {
    return null;
  }
  const content = readFileSync(path, "utf8");
  return createHash("sha256").update(content).digest("hex");
}

function mergeJsonl(inputPaths: string[], outputPath: string): void {
  const outputRows: string[] = [];
  inputPaths.forEach((path) => {
    const raw = readFileSync(path, "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const stripped = line.trim();
      if (!stripped || stripped.startsWith("#")) {
        return;
      }
      outputRows.push(stripped);
    });
  });
  if (outputRows.length > 0) {
    writeFileSync(outputPath, `${outputRows.join("\n")}\n`, "utf8");
    return;
  }
  writeFileSync(outputPath, "", "utf8");
}

function parseArgs(argv: string[]): ParsedCliArgs {
  const args: ParsedCliArgs = {
    cases: "",
    runs: [],
    gatePolicy: null,
    baselineVariant: null,
    output: "gateway/evals/data/auto_loop_report.json",
    manifestOutput: "gateway/evals/data/candidate_proposals.json",
    ledgerPath: "gateway/evals/data/experiment_ledger.jsonl",
    maxCandidates: 4,
    maxRounds: 2,
    maxParallel: 2,
    minOptimizationGain: 0,
    allowHoldoutDrop: 0,
    consecutiveFailuresToStop: 2,
    cooldownHours: 12,
    failIfNoSelection: false,
    printJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const readValue = (): string => {
      const value = argv[index + 1] ?? "";
      if (!value || value.startsWith("--")) {
        throw new Error(`auto-loop: missing value for ${token}`);
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
      case "--output":
        args.output = readValue();
        index += 1;
        break;
      case "--manifest-output":
        args.manifestOutput = readValue();
        index += 1;
        break;
      case "--ledger-path":
        args.ledgerPath = readValue();
        index += 1;
        break;
      case "--max-candidates":
        args.maxCandidates = Number.parseInt(readValue(), 10);
        if (!Number.isInteger(args.maxCandidates) || args.maxCandidates < 0) {
          throw new Error("auto-loop: --max-candidates must be integer >= 0");
        }
        index += 1;
        break;
      case "--max-rounds":
        args.maxRounds = Number.parseInt(readValue(), 10);
        if (!Number.isInteger(args.maxRounds) || args.maxRounds <= 0) {
          throw new Error("auto-loop: --max-rounds must be integer > 0");
        }
        index += 1;
        break;
      case "--max-parallel":
        args.maxParallel = Number.parseInt(readValue(), 10);
        if (!Number.isInteger(args.maxParallel) || args.maxParallel <= 0) {
          throw new Error("auto-loop: --max-parallel must be integer > 0");
        }
        index += 1;
        break;
      case "--min-optimization-gain":
        args.minOptimizationGain = Number.parseFloat(readValue());
        if (!Number.isFinite(args.minOptimizationGain)) {
          throw new Error("auto-loop: --min-optimization-gain must be number");
        }
        index += 1;
        break;
      case "--allow-holdout-drop":
        args.allowHoldoutDrop = Number.parseFloat(readValue());
        if (!Number.isFinite(args.allowHoldoutDrop)) {
          throw new Error("auto-loop: --allow-holdout-drop must be number");
        }
        index += 1;
        break;
      case "--consecutive-failures-to-stop":
        args.consecutiveFailuresToStop = Number.parseInt(readValue(), 10);
        if (!Number.isInteger(args.consecutiveFailuresToStop) || args.consecutiveFailuresToStop <= 0) {
          throw new Error("auto-loop: --consecutive-failures-to-stop must be integer > 0");
        }
        index += 1;
        break;
      case "--cooldown-hours":
        args.cooldownHours = Number.parseInt(readValue(), 10);
        if (!Number.isInteger(args.cooldownHours) || args.cooldownHours <= 0) {
          throw new Error("auto-loop: --cooldown-hours must be integer > 0");
        }
        index += 1;
        break;
      case "--fail-if-no-selection":
        args.failIfNoSelection = true;
        break;
      case "--print-json":
        args.printJson = true;
        break;
      default:
        throw new Error(`auto-loop: unknown argument: ${token}`);
    }
  }

  if (!args.cases) {
    throw new Error("auto-loop: missing required args: --cases");
  }
  if (args.runs.length === 0) {
    throw new Error("auto-loop: missing required args: --runs");
  }
  return args;
}

function evaluateProposal(
  proposal: CandidateProposal,
  baseline: VariantSnapshot,
  candidate: VariantSnapshot | undefined,
  thresholds: { minOptimizationGain: number; allowHoldoutDrop: number }
): ProposalEvaluation {
  if (candidate == null) {
    return {
      proposal_id: proposal.proposal_id,
      source_variant: proposal.source_variant,
      status: "rejected",
      reason: "variant_missing",
      optimization_gain: 0,
      holdout_drop: 0,
      reward_v1_composite: 0,
      risk: proposal.risk,
    };
  }
  const optimizationGain = candidate.optimization_avg - baseline.optimization_avg;
  const holdoutDrop = baseline.holdout_avg - candidate.holdout_avg;
  if (!candidate.gate_passed) {
    return {
      proposal_id: proposal.proposal_id,
      source_variant: proposal.source_variant,
      status: "rejected",
      reason: "gate_failed",
      optimization_gain: optimizationGain,
      holdout_drop: holdoutDrop,
      reward_v1_composite: candidate.reward_v1_composite,
      risk: proposal.risk,
    };
  }
  if (holdoutDrop > thresholds.allowHoldoutDrop) {
    return {
      proposal_id: proposal.proposal_id,
      source_variant: proposal.source_variant,
      status: "rejected",
      reason: "holdout_regression",
      optimization_gain: optimizationGain,
      holdout_drop: holdoutDrop,
      reward_v1_composite: candidate.reward_v1_composite,
      risk: proposal.risk,
    };
  }
  if (optimizationGain <= thresholds.minOptimizationGain) {
    return {
      proposal_id: proposal.proposal_id,
      source_variant: proposal.source_variant,
      status: "rejected",
      reason: "insufficient_optimization_gain",
      optimization_gain: optimizationGain,
      holdout_drop: holdoutDrop,
      reward_v1_composite: candidate.reward_v1_composite,
      risk: proposal.risk,
    };
  }
  return {
    proposal_id: proposal.proposal_id,
    source_variant: proposal.source_variant,
    status: "accepted",
    reason: "passed",
    optimization_gain: optimizationGain,
    holdout_drop: holdoutDrop,
    reward_v1_composite: candidate.reward_v1_composite,
    risk: proposal.risk,
  };
}

function buildLedgerRecord(input: {
  runId: string;
  parentRunId: string | null;
  baselineVariant: string;
  selectedProposal: CandidateProposal | null;
  selectedVariant: string | null;
  policyHash: string | null;
  promotionState: ExperimentLedgerRecord["promotion_state"];
  decision: string;
  notes: string | null;
  snapshots: VariantSnapshot[];
}): ExperimentLedgerRecord {
  return {
    record_id: newRecordId("ledger"),
    record_type: "auto_loop_run",
    created_at: new Date().toISOString(),
    run_id: input.runId,
    parent_run_id: input.parentRunId,
    proposal_id: input.selectedProposal?.proposal_id ?? null,
    baseline_variant: input.baselineVariant,
    selected_variant: input.selectedVariant,
    reward_version: "reward_v1",
    policy_hash: input.policyHash,
    decision: input.decision,
    promotion_state: input.promotionState,
    rollback_triggered: false,
    notes: input.notes,
    evidence_refs: input.selectedProposal?.evidence_refs ?? [],
    variant_snapshots: input.snapshots,
  };
}

export function runCli(argv: string[]): number {
  const args = parseArgs(argv);
  const tempDir = resolve(process.cwd(), "gateway/evals/data");
  mkdirSync(tempDir, { recursive: true });
  const randomSuffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const mergedRunsPath = resolve(tempDir, `.tmp-auto-loop-runs-${randomSuffix}.jsonl`);

  try {
    mergeJsonl(args.runs, mergedRunsPath);
    const report = runHarness(args.cases, mergedRunsPath, args.gatePolicy);
    const reportObject = report as unknown;
    const snapshotsMap = parseVariantSnapshots(reportObject);
    const snapshotEntries = Array.from(snapshotsMap.values()).sort((left, right) => left.variant.localeCompare(right.variant));
    const manifest = generateCandidateManifest(reportObject, {
      baselineVariant: args.baselineVariant,
      maxProposals: args.maxCandidates,
    });

    const baseline = snapshotsMap.get(manifest.baseline_variant);
    if (baseline == null) {
      throw new Error(`auto-loop: baseline variant not found: ${manifest.baseline_variant}`);
    }

    const evaluations: ProposalEvaluation[] = [];
    let consecutiveFailures = 0;
    let circuitBreakerReason: string | null = null;
    let selectedProposal: CandidateProposal | null = null;
    let selectedEvaluation: ProposalEvaluation | null = null;

    for (const proposal of manifest.proposals.slice(0, args.maxCandidates)) {
      const evaluation = evaluateProposal(proposal, baseline, snapshotsMap.get(proposal.source_variant), {
        minOptimizationGain: args.minOptimizationGain,
        allowHoldoutDrop: args.allowHoldoutDrop,
      });
      evaluations.push(evaluation);
      if (evaluation.status === "rejected") {
        consecutiveFailures += 1;
        if (consecutiveFailures >= args.consecutiveFailuresToStop) {
          circuitBreakerReason = `consecutive_failures_${consecutiveFailures}`;
          break;
        }
        continue;
      }
      consecutiveFailures = 0;
      if (
        selectedEvaluation == null ||
        evaluation.reward_v1_composite > selectedEvaluation.reward_v1_composite ||
        (Math.abs(evaluation.reward_v1_composite - selectedEvaluation.reward_v1_composite) < 1e-9 &&
          evaluation.optimization_gain > selectedEvaluation.optimization_gain)
      ) {
        selectedProposal = proposal;
        selectedEvaluation = evaluation;
      }
    }

    if (selectedEvaluation != null) {
      selectedEvaluation.status = "selected";
    }

    const policyHash = readPolicyHash(args.gatePolicy);
    const ledger = loadExperimentLedger(args.ledgerPath);
    const parentRunId =
      ledger
        .filter((item) => item.record_type === "auto_loop_run")
        .slice(-1)
        .map((item) => item.run_id)[0] ?? null;
    const runId = newRecordId("run");
    const promotionState = selectedProposal == null ? "evaluated" : "ready_for_manual_promotion";
    const decision = selectedProposal == null ? "no_candidate_selected" : "candidate_selected";
    const notes =
      circuitBreakerReason == null
        ? null
        : `circuit_breaker=${circuitBreakerReason}; cooldown_hours=${args.cooldownHours}`;
    const ledgerRecord = buildLedgerRecord({
      runId,
      parentRunId,
      baselineVariant: manifest.baseline_variant,
      selectedProposal,
      selectedVariant: selectedProposal?.source_variant ?? null,
      policyHash,
      promotionState,
      decision,
      notes,
      snapshots: snapshotEntries,
    });
    appendExperimentLedgerRecord(args.ledgerPath, ledgerRecord);

    mkdirSync(dirname(args.manifestOutput), { recursive: true });
    writeFileSync(args.manifestOutput, `${JSON.stringify(manifest, undefined, 2)}\n`, "utf8");

    const outputPayload = {
      generated_at: new Date().toISOString(),
      run_id: runId,
      baseline_variant: manifest.baseline_variant,
      budget: {
        max_candidates_per_round: args.maxCandidates,
        max_rounds: args.maxRounds,
        max_parallel: args.maxParallel,
        consecutive_failures_to_stop: args.consecutiveFailuresToStop,
        cooldown_hours: args.cooldownHours,
      },
      thresholds: {
        min_optimization_gain: args.minOptimizationGain,
        allow_holdout_drop: args.allowHoldoutDrop,
      },
      manifest_output: args.manifestOutput,
      ledger_path: args.ledgerPath,
      policy_hash: policyHash,
      evaluations,
      selected_proposal_id: selectedProposal?.proposal_id ?? null,
      selected_variant: selectedProposal?.source_variant ?? null,
      promotion_state: promotionState,
      circuit_breaker: {
        triggered: circuitBreakerReason != null,
        reason: circuitBreakerReason,
      },
      report,
    };

    mkdirSync(dirname(args.output), { recursive: true });
    writeFileSync(args.output, `${JSON.stringify(outputPayload, undefined, 2)}\n`, "utf8");
    process.stdout.write(
      `auto_loop run_id=${runId} selected_variant=${selectedProposal?.source_variant ?? "none"} proposals=${manifest.proposals.length} evaluated=${evaluations.length} circuit_breaker=${String(circuitBreakerReason != null).toLowerCase()}\n`
    );
    if (args.printJson) {
      process.stdout.write(`${JSON.stringify(outputPayload, undefined, 2)}\n`);
    }
    if (args.failIfNoSelection && selectedProposal == null) {
      return 2;
    }
    return 0;
  } finally {
    if (existsSync(mergedRunsPath)) {
      unlinkSync(mergedRunsPath);
    }
  }
}

const entryScript = process.argv[1] ?? "";
const shouldRunCli = entryScript.includes("auto-loop");

if (shouldRunCli) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`auto-loop fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
