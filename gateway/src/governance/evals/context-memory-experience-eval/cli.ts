export interface ParsedCliArgs {
  cases: string;
  runs: string;
  gatePolicy: string | null;
  output: string | null;
  printJson: boolean;
  failOnGate: boolean;
}

export function parseArgs(argv: string[]): ParsedCliArgs {
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
