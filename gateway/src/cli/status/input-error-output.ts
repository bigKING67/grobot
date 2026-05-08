export interface StatusInputError {
  code: string;
  field: string;
  message: string;
}

export function writeStatusInputError(
  error: StatusInputError,
  outputJson: boolean,
): void {
  if (outputJson) {
    process.stdout.write(`${JSON.stringify({
      status: "error",
      error: error.code,
      field: error.field,
      detail: error.message,
    }, null, 2)}\n`);
    return;
  }
  process.stderr.write(`error: ${error.code}: ${error.message}\n`);
}
