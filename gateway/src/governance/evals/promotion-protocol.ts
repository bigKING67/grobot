import {
  appendExperimentLedgerRecord,
  ExperimentLedgerRecord,
  findLatestRecordByProposal,
  loadExperimentLedger,
  newRecordId,
  PromotionState,
} from "./harness-ledger";

interface ParsedCliArgs {
  ledgerPath: string;
  proposalId: string;
  action: "shadow-pass" | "promote" | "rollback" | "reject";
  note: string | null;
  printJson: boolean;
}

function parseArgs(argv: string[]): ParsedCliArgs {
  let ledgerPath = "gateway/evals/data/experiment_ledger.jsonl";
  let proposalId = "";
  let action: ParsedCliArgs["action"] | "" = "";
  let note: string | null = null;
  let printJson = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const readValue = (): string => {
      const value = argv[index + 1] ?? "";
      if (!value || value.startsWith("--")) {
        throw new Error(`promotion-protocol: missing value for ${token}`);
      }
      return value;
    };
    switch (token) {
      case "--ledger-path":
        ledgerPath = readValue();
        index += 1;
        break;
      case "--proposal-id":
        proposalId = readValue();
        index += 1;
        break;
      case "--action": {
        const parsed = readValue();
        if (parsed !== "shadow-pass" && parsed !== "promote" && parsed !== "rollback" && parsed !== "reject") {
          throw new Error("promotion-protocol: --action must be shadow-pass|promote|rollback|reject");
        }
        action = parsed;
        index += 1;
        break;
      }
      case "--note":
        note = readValue();
        index += 1;
        break;
      case "--print-json":
        printJson = true;
        break;
      default:
        throw new Error(`promotion-protocol: unknown argument: ${token}`);
    }
  }

  if (!proposalId) {
    throw new Error("promotion-protocol: missing required args: --proposal-id");
  }
  if (!action) {
    throw new Error("promotion-protocol: missing required args: --action");
  }

  return {
    ledgerPath,
    proposalId,
    action,
    note,
    printJson,
  };
}

function resolveTargetState(action: ParsedCliArgs["action"]): PromotionState {
  if (action === "shadow-pass") {
    return "shadow_passed";
  }
  if (action === "promote") {
    return "promoted";
  }
  if (action === "rollback") {
    return "rolled_back";
  }
  return "rejected";
}

function isTransitionAllowed(current: PromotionState, target: PromotionState): boolean {
  if (target === "shadow_passed") {
    return current === "evaluated" || current === "ready_for_manual_promotion" || current === "draft";
  }
  if (target === "promoted") {
    return current === "shadow_passed" || current === "ready_for_manual_promotion";
  }
  if (target === "rolled_back") {
    return current === "shadow_passed" || current === "promoted" || current === "ready_for_manual_promotion";
  }
  if (target === "rejected") {
    return current === "evaluated" || current === "ready_for_manual_promotion" || current === "draft";
  }
  return false;
}

function buildTransitionRecord(
  previous: ExperimentLedgerRecord,
  action: ParsedCliArgs["action"],
  note: string | null
): ExperimentLedgerRecord {
  const targetState = resolveTargetState(action);
  return {
    record_id: newRecordId("ledger"),
    record_type: "promotion_transition",
    created_at: new Date().toISOString(),
    run_id: newRecordId("run"),
    parent_run_id: previous.run_id,
    proposal_id: previous.proposal_id,
    baseline_variant: previous.baseline_variant,
    selected_variant: previous.selected_variant,
    reward_version: "reward_v1",
    policy_hash: previous.policy_hash,
    decision: `promotion_action:${action}`,
    promotion_state: targetState,
    rollback_triggered: targetState === "rolled_back",
    notes: note,
    evidence_refs: [...previous.evidence_refs],
    variant_snapshots: [...previous.variant_snapshots],
  };
}

export function runCli(argv: string[]): number {
  const args = parseArgs(argv);
  const ledger = loadExperimentLedger(args.ledgerPath);
  const previous = findLatestRecordByProposal(ledger, args.proposalId);
  if (previous == null) {
    throw new Error(`promotion-protocol: proposal not found in ledger: ${args.proposalId}`);
  }

  const targetState = resolveTargetState(args.action);
  if (!isTransitionAllowed(previous.promotion_state, targetState)) {
    throw new Error(
      `promotion-protocol: invalid transition ${previous.promotion_state} -> ${targetState} for proposal ${args.proposalId}`
    );
  }

  const record = buildTransitionRecord(previous, args.action, args.note);
  appendExperimentLedgerRecord(args.ledgerPath, record);
  const output = {
    proposal_id: args.proposalId,
    previous_state: previous.promotion_state,
    next_state: record.promotion_state,
    action: args.action,
    record_id: record.record_id,
    ledger_path: args.ledgerPath,
  };
  process.stdout.write(
    `promotion proposal=${args.proposalId} ${previous.promotion_state} -> ${record.promotion_state}\n`
  );
  if (args.printJson) {
    process.stdout.write(`${JSON.stringify(output, undefined, 2)}\n`);
  }
  return 0;
}

const entryScript = process.argv[1] ?? "";
const shouldRunCli = entryScript.includes("promotion-protocol");

if (shouldRunCli) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`promotion-protocol fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
