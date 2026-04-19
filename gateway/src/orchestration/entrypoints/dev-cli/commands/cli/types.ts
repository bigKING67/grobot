import { type ParsedArgs } from "../../cli-args";

export interface DevCliDispatchContext {
  writeStdout(message: string): void;
  writeStderr(message: string): void;
}

export interface DevCliCommandSpec {
  name: string;
  aliases?: readonly string[];
  defaultCommand?: boolean;
  run(parsed: ParsedArgs, context: DevCliDispatchContext): Promise<number>;
}
