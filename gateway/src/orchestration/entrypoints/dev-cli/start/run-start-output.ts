import { writePrefixedWarnings } from "./run-start-warnings";

export interface RunStartOutput {
  writeStdout(message: string): void;
  writeStderr(message: string): void;
  writeSessionWarnings(warnings: readonly string[]): void;
  writeStoreWarnings(warnings: readonly string[]): void;
}

export function createRunStartOutput(): RunStartOutput {
  return {
    writeStdout: (message): void => {
      process.stdout.write(message);
    },
    writeStderr: (message): void => {
      process.stderr.write(message);
    },
    writeSessionWarnings: (warnings): void => {
      writePrefixedWarnings("session", warnings);
    },
    writeStoreWarnings: (warnings): void => {
      writePrefixedWarnings("store", warnings);
    },
  };
}
