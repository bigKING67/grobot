import {
  parseArgs,
  usage,
  validateHardCutExecutionOptions,
} from "./cli-args";
import { dispatchDevCliCommand } from "./commands/cli/registry";

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

  return dispatchDevCliCommand(parsed, {
    writeStdout: (message) => {
      process.stdout.write(message);
    },
    writeStderr: (message) => {
      process.stderr.write(message);
    },
  });
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
