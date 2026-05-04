import {
  parseArgs,
  usage,
  validateHardCutExecutionOptions,
} from "./cli-args";
import { dispatchCliCommand } from "./commands/cli/registry";
import { CLI_PRODUCT_NAME } from "./product-identity";

export async function runCli(argv: string[]): Promise<number> {
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

  return dispatchCliCommand(parsed, {
    writeStdout: (message) => {
      process.stdout.write(message);
    },
    writeStderr: (message) => {
      process.stderr.write(message);
    },
  });
}

export async function runCliFromProcess(): Promise<void> {
  try {
    const code = await runCli(process.argv.slice(2));
    process.exitCode = code;
  } catch (error) {
    process.stderr.write(`${CLI_PRODUCT_NAME} fatal error: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
