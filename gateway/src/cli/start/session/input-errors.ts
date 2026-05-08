export class StartSessionOptionInputError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(field: string, detail: string) {
    super(detail);
    this.name = "StartSessionOptionInputError";
    this.code = `invalid_${field.replace(/-/g, "_")}`;
    this.field = field;
  }
}

export function isStartSessionOptionInputError(
  error: unknown,
): error is StartSessionOptionInputError {
  return error instanceof StartSessionOptionInputError;
}
