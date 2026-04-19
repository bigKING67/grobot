import { writePrefixedWarnings } from "./run-start-warnings";

export interface RunStartOutput {
  writeStdout(message: string): void;
  writeStderr(message: string): void;
  writeSessionWarnings(warnings: readonly string[]): void;
  writeStoreWarnings(warnings: readonly string[]): void;
}

export interface CreateRunStartOutputOptions {
  suppressWarningPatterns?: ReadonlyArray<RegExp>;
}

export function createRunStartOutput(options: CreateRunStartOutputOptions = {}): RunStartOutput {
  const suppressionRules = Array.isArray(options.suppressWarningPatterns)
    ? [...options.suppressWarningPatterns]
    : [];
  const filterWarnings = (warnings: readonly string[]): string[] => {
    if (suppressionRules.length === 0) {
      return [...warnings];
    }
    return warnings.filter((warning) =>
      suppressionRules.every((pattern) => !pattern.test(warning))
    );
  };
  return {
    writeStdout: (message): void => {
      process.stdout.write(message);
    },
    writeStderr: (message): void => {
      process.stderr.write(message);
    },
    writeSessionWarnings: (warnings): void => {
      const filteredWarnings = filterWarnings(warnings);
      writePrefixedWarnings("session", filteredWarnings);
    },
    writeStoreWarnings: (warnings): void => {
      const filteredWarnings = filterWarnings(warnings);
      writePrefixedWarnings("store", filteredWarnings);
    },
  };
}
