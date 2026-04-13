import { parseArgs, usage, validateHardCutExecutionOptions } from "./cli-args";
import { runServe } from "./serve/run-serve";
import { runStart } from "./start/run-start";
import { runStatus } from "./status/run-status";

export async function runDevCli(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.command || parsed.command === "help" || parsed.command === "--help" || parsed.command === "-h") {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  const hardCutErrors = validateHardCutExecutionOptions(parsed.options);
  if (hardCutErrors.length > 0) {
    process.stderr.write("error: invalid execution-plane options in TS+Rust hard-cut mode.\n");
    for (const item of hardCutErrors) {
      process.stderr.write(`- ${item}\n`);
    }
    return 2;
  }

  if (parsed.command === "status") {
    return runStatus(parsed.options);
  }
  if (parsed.command === "start") {
    return runStart(parsed.options);
  }
  if (parsed.command === "serve") {
    return runServe(parsed.options);
  }

  process.stderr.write(`error: unsupported command for ts-dev-cli: ${parsed.command}\n`);
  return 3;
}

export async function runDevCliFromProcess(): Promise<void> {
  try {
    const code = await runDevCli(process.argv.slice(2));
    process.exitCode = code;
  } catch (error) {
    process.stderr.write(`ts-dev-cli fatal error: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
