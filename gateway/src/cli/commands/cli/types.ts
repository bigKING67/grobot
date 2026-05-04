import { type ParsedArgs } from "../../cli-args";

export interface CliDispatchContext {
  writeStdout(message: string): void;
  writeStderr(message: string): void;
}

export interface CliCommandSpec {
  name: string;
  aliases?: readonly string[];
  defaultCommand?: boolean;
  run(parsed: ParsedArgs, context: CliDispatchContext): Promise<number>;
}
