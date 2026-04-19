import {
  type ParsedArgs,
  readOptionString,
  readOptionStringAny,
} from "../../cli-args";
import { runGc } from "../../gc/run-gc";
import { runInit } from "../../init/run-init";
import { runServe } from "../../serve/run-serve";
import { runStart } from "../../start/run-start";
import { runStatus } from "../../status/run-status";
import { type DevCliCommandSpec, type DevCliDispatchContext } from "./types";

function hasStartImContext(parsed: ParsedArgs): boolean {
  return Boolean(
    readOptionString(parsed.options, "platform")
      || readOptionString(parsed.options, "tenant")
      || readOptionStringAny(parsed.options, ["session-scope", "scope"])
      || readOptionStringAny(parsed.options, ["session-subject", "subject"]),
  );
}

function writeStartImOnlyHint(context: DevCliDispatchContext): void {
  context.writeStderr("error: `grobot start` is IM-only and requires explicit platform/session context.\n");
  context.writeStderr(
    "hint: pass one of --platform/--tenant/--session-scope/--session-subject (legacy: --scope/--subject).\n",
  );
  context.writeStderr("hint: for local terminal usage, run `grobot` (no subcommand).\n");
}

const DEV_CLI_COMMANDS: readonly DevCliCommandSpec[] = [
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

function resolveCommandSpec(command: string): DevCliCommandSpec | undefined {
  if (!command) {
    return DEV_CLI_COMMANDS.find((item) => item.defaultCommand);
  }
  return DEV_CLI_COMMANDS.find(
    (item) => item.name === command || item.aliases?.includes(command),
  );
}

export async function dispatchDevCliCommand(
  parsed: ParsedArgs,
  context: DevCliDispatchContext,
): Promise<number> {
  const command = parsed.command.trim();
  const commandSpec = resolveCommandSpec(command);
  if (!commandSpec) {
    context.writeStderr(`error: unsupported command for ts-dev-cli: ${command}\n`);
    return 3;
  }
  return commandSpec.run(parsed, context);
}
