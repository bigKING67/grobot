import { resolve as resolvePath } from "node:path";
import type { ParsedCliArgs } from "./types";

export function parseArgs(argv: string[]): ParsedCliArgs {
  let policyPath = "";
  let reportPath = "";
  let printJson = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--policy") {
      policyPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--report") {
      reportPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--print-json") {
      printJson = true;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (!policyPath.trim()) {
    throw new Error("missing --policy");
  }
  if (!reportPath.trim()) {
    throw new Error("missing --report");
  }
  return {
    policyPath: resolvePath(policyPath.trim()),
    reportPath: resolvePath(reportPath.trim()),
    printJson,
  };
}
