import { type OptionValue } from "../cli-args";

export class GcInputError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(field: string, detail: string) {
    super(detail);
    this.name = "GcInputError";
    this.code = `invalid_${field.replace(/-/g, "_")}`;
    this.field = field;
  }
}

export function isGcInputError(error: unknown): error is GcInputError {
  return error instanceof GcInputError;
}

export function writeGcInputError(error: GcInputError, outputJson: boolean): void {
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

function hasOption(options: Record<string, OptionValue>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(options, key);
}

function readRawOptionString(
  options: Record<string, OptionValue>,
  key: string,
): string | undefined {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
}

function normalizePositiveInteger(raw: string | undefined, field: string, min: number, max: number): number {
  const label = field;
  const normalized = raw?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) {
    throw new GcInputError(
      field,
      `${label} must be an integer between ${String(min)} and ${String(max)}`,
    );
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new GcInputError(
      field,
      `${label} must be an integer between ${String(min)} and ${String(max)}`,
    );
  }
  return parsed;
}

export function parseGcPositiveIntOption(input: {
  options: Record<string, OptionValue>;
  key: string;
  fallback: number;
  min: number;
  max: number;
}): number {
  if (!hasOption(input.options, input.key)) {
    return input.fallback;
  }
  return normalizePositiveInteger(
    readRawOptionString(input.options, input.key),
    input.key,
    input.min,
    input.max,
  );
}

export function parseGcTomlPositiveInt(input: {
  value: string;
  field: string;
  min: number;
  max: number;
}): number {
  return normalizePositiveInteger(input.value, input.field, input.min, input.max);
}

export function parseGcScopeOption<T extends string>(input: {
  options: Record<string, OptionValue>;
  key: string;
  fallback: T;
  allowed: readonly T[];
}): T {
  if (!hasOption(input.options, input.key)) {
    return input.fallback;
  }
  const normalized = readRawOptionString(input.options, input.key)?.trim().toLowerCase();
  const allowed = input.allowed as readonly string[];
  if (!normalized || !allowed.includes(normalized)) {
    throw new GcInputError(
      input.key,
      `${input.key} must be ${allowed.join(", ")}`,
    );
  }
  return normalized as T;
}
