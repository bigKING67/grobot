export function writePrefixedWarnings(prefix: string, warnings: readonly string[]): void {
  for (const warning of warnings) {
    process.stderr.write(`[${prefix}] ${warning}\n`);
  }
}
