import { type ParsedArgs } from "../../cli-args";
import { runGc } from "../../gc/run-gc";
import { runInit } from "../../init/run-init";
import { runServe } from "../../serve/run-serve";
import { runStart } from "../../start/run";
import { runStatus } from "../../status/run-status";
import { CLI_PRODUCT_NAME } from "../../product-identity";
import { type CliCommandSpec, type CliDispatchContext } from "./types";

const START_IM_CONTEXT_OPTION_KEYS = [
  "platform",
  "tenant",
  "session-scope",
  "scope",
  "session-subject",
  "subject",
] as const;

function hasOption(options: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(options, key);
}

function hasStartImContext(parsed: ParsedArgs): boolean {
  return START_IM_CONTEXT_OPTION_KEYS.some((key) => hasOption(parsed.options, key));
}

function writeStartImOnlyHint(context: CliDispatchContext): void {
  context.writeStderr("error: `grobot start` is IM-only and requires explicit platform/session context.\n");
  context.writeStderr(
    "hint: pass one of --platform/--tenant/--session-scope/--session-subject (legacy: --scope/--subject).\n",
  );
  context.writeStderr("hint: for local terminal usage, run `grobot` (no subcommand).\n");
}

const CLI_COMMANDS: readonly CliCommandSpec[] = [
  {
    name: "default",
    defaultCommand: true,
    run: async (parsed) => runStart(parsed.options),
  },
  {
    name: "status",
    run: async (parsed) => runStatus(parsed.options),
  },
  {
    name: "init",
    run: async (parsed) => runInit(parsed.options),
  },
  {
    name: "gc",
    run: async (parsed) => runGc(parsed.options),
  },
  {
    name: "start",
    run: async (parsed, context) => {
      if (!hasStartImContext(parsed)) {
        writeStartImOnlyHint(context);
        return 2;
      }
      return runStart(parsed.options);
    },
  },
  {
    name: "serve",
    run: async (parsed) => runServe(parsed.options),
  },
];

function resolveCommandSpec(command: string): CliCommandSpec | undefined {
  if (!command) {
    return CLI_COMMANDS.find((item) => item.defaultCommand);
  }
  return CLI_COMMANDS.find(
    (item) => item.name === command || item.aliases?.includes(command),
  );
}

export async function dispatchCliCommand(
  parsed: ParsedArgs,
  context: CliDispatchContext,
): Promise<number> {
  const command = parsed.command.trim();
  const commandSpec = resolveCommandSpec(command);
  if (!commandSpec) {
    context.writeStderr(`error: unsupported command for ${CLI_PRODUCT_NAME}: ${command}\n`);
    return 3;
  }
  return commandSpec.run(parsed, context);
}
