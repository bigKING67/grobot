import { type ParsedCliArgs } from "./types";

export function parseArgs(argv: string[]): ParsedCliArgs {
  const policies: string[] = [];
  let printJson = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--policy") {
      const value = argv[index + 1] ?? "";
      if (value.trim().length > 0) {
        policies.push(value.trim());
      }
      index += 1;
      continue;
    }
    if (token === "--print-json") {
      printJson = true;
      continue;
    }
  }
  if (policies.length === 0) {
    throw new Error("missing required args: --policy");
  }
  return { policies, printJson };
}
