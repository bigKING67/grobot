import {
  OptionValue,
  parseArgs,
  readOptionString,
  readOptionStringAny,
  usage,
  validateHardCutExecutionOptions,
} from "./cli-args";
import { runServe } from "./serve/run-serve";
import { runStart } from "./start/run-start";
import { runStatus } from "./status/run-status";

function hasStartImContext(options: Record<string, OptionValue>): boolean {
  return Boolean(
    readOptionString(options, "platform")
      || readOptionString(options, "tenant")
      || readOptionStringAny(options, ["session-scope", "scope"])
      || readOptionStringAny(options, ["session-subject", "subject"]),
  );
}

function writeStartImOnlyHint(): void {
  process.stderr.write("error: `grobot start` is IM-only and requires explicit platform/session context.\n");
  process.stderr.write(
    "hint: pass one of --platform/--tenant/--session-scope/--session-subject (legacy: --scope/--subject).\n",
  );
  process.stderr.write("hint: for local terminal usage, run `grobot` (no subcommand).\n");
}

export async function runDevCli(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const command = parsed.command.trim();
  const hasLongHelpFlag = Object.prototype.hasOwnProperty.call(parsed.options, "help");
  if (command === "help" || command === "--help" || command === "-h" || hasLongHelpFlag) {
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

  if (!command) {
    return runStart(parsed.options);
  }

  if (command === "status") {
    return runStatus(parsed.options);
  }
  if (command === "start") {
    if (!hasStartImContext(parsed.options)) {
      writeStartImOnlyHint();
      return 2;
    }
    return runStart(parsed.options);
  }
  if (command === "serve") {
    return runServe(parsed.options);
  }

  process.stderr.write(`error: unsupported command for ts-dev-cli: ${command}\n`);
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
