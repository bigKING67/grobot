export function resolveTerminalColumns(): number {
  const stdout = process.stdout as unknown as {
    isTTY?: boolean;
    columns?: number;
  };
  if (
    stdout.isTTY
    && typeof stdout.columns === "number"
    && Number.isFinite(stdout.columns)
    && stdout.columns > 0
  ) {
    return Math.floor(stdout.columns);
  }
  return 96;
}

export function resolveTerminalRows(): number | undefined {
  const stdout = process.stdout as unknown as {
    isTTY?: boolean;
    rows?: number;
  };
  if (
    stdout.isTTY
    && typeof stdout.rows === "number"
    && Number.isFinite(stdout.rows)
    && stdout.rows > 0
  ) {
    return Math.floor(stdout.rows);
  }
  return undefined;
}
