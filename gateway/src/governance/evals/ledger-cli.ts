import { loadExperimentLedger } from "./harness-ledger";

interface ParsedCliArgs {
  ledgerPath: string;
  tail: number;
  printJson: boolean;
}

function parseArgs(argv: string[]): ParsedCliArgs {
  let ledgerPath = "gateway/evals/data/experiment_ledger.jsonl";
  let tail = 20;
  let printJson = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const readValue = (): string => {
      const value = argv[index + 1] ?? "";
      if (!value || value.startsWith("--")) {
        throw new Error(`ledger-cli: missing value for ${token}`);
      }
      return value;
    };
    switch (token) {
      case "--ledger-path":
        ledgerPath = readValue();
        index += 1;
        break;
      case "--tail":
        tail = Number.parseInt(readValue(), 10);
        if (!Number.isInteger(tail) || tail <= 0) {
          throw new Error("ledger-cli: --tail must be integer > 0");
        }
        index += 1;
        break;
      case "--print-json":
        printJson = true;
        break;
      default:
        throw new Error(`ledger-cli: unknown argument: ${token}`);
    }
  }

  return { ledgerPath, tail, printJson };
}

function runCli(argv: string[]): number {
  const args = parseArgs(argv);
  const ledger = loadExperimentLedger(args.ledgerPath);
  const rows = ledger.slice(Math.max(0, ledger.length - args.tail));
  process.stdout.write(`ledger_records=${ledger.length} showing=${rows.length} path=${args.ledgerPath}\n`);
  rows.forEach((item) => {
    process.stdout.write(
      `record=${item.record_id} type=${item.record_type} proposal=${item.proposal_id ?? "none"} state=${item.promotion_state} decision=${item.decision}\n`
    );
  });
  if (args.printJson) {
    process.stdout.write(`${JSON.stringify(rows, undefined, 2)}\n`);
  }
  return 0;
}

const entryScript = process.argv[1] ?? "";
const shouldRunCli = entryScript.includes("ledger-cli");

if (shouldRunCli) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`ledger-cli fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
