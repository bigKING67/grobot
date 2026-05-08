import { type OptionValue } from "../cli-args";

export class CliNumericOptionInputError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(field: string, detail: string) {
    super(detail);
    this.name = "CliNumericOptionInputError";
    this.code = `invalid_${field.replace(/-/g, "_")}`;
    this.field = field;
  }
}

export function isCliNumericOptionInputError(
  error: unknown,
): error is CliNumericOptionInputError {
  return error instanceof CliNumericOptionInputError;
}

export function hasOption(options: Record<string, OptionValue>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(options, key);
}

export function readRawOptionString(
  options: Record<string, OptionValue>,
  key: string,
): string | undefined {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
}

export function parseOptionalPositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

export function parseRequiredPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = parseOptionalPositiveInt(value);
  if (typeof parsed !== "number") {
    return fallback;
  }
  return parsed;
}

export function parseOptionalRatio(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return undefined;
  }
  return parsed;
}

export function parseRequiredRatio(value: string | undefined, fallback: number): number {
  const parsed = parseOptionalRatio(value);
  if (typeof parsed !== "number") {
    return fallback;
  }
  return parsed;
}

export function parseExplicitPositiveIntOption(input: {
  options: Record<string, OptionValue>;
  key: string;
  fallback?: string;
}): number | undefined {
  const provided = hasOption(input.options, input.key);
  const raw = provided
    ? readRawOptionString(input.options, input.key)
    : input.fallback;
  if (raw === undefined) {
    if (provided) {
      throw new CliNumericOptionInputError(
        input.key,
        `${input.key} must be a positive integer`,
      );
    }
    return undefined;
  }
  const parsed = parseOptionalPositiveInt(raw);
  if (typeof parsed !== "number") {
    throw new CliNumericOptionInputError(
      input.key,
      `${input.key} must be a positive integer`,
    );
  }
  return parsed;
}

export function parseExplicitRequiredPositiveIntOption(input: {
  options: Record<string, OptionValue>;
  key: string;
  fallbackValue: number;
  fallback?: string;
}): number {
  return parseExplicitPositiveIntOption(input) ?? input.fallbackValue;
}
