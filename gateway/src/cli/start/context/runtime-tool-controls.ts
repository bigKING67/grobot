export type NoToolFallbackMode = "off" | "safe" | "strict";

const RUNTIME_TOOLS_ALLOW_DETAIL =
  "runtime-tools-allow must be a non-empty array of non-empty strings";

export class RuntimeToolControlInputError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(field: string, detail: string) {
    super(detail);
    this.name = "RuntimeToolControlInputError";
    this.code = `invalid_${field.replace(/-/g, "_")}`;
    this.field = field;
  }
}

export function isRuntimeToolControlInputError(
  error: unknown,
): error is RuntimeToolControlInputError {
  return error instanceof RuntimeToolControlInputError;
}

function parseIntegerControl(input: {
  raw: string | undefined;
  field: string;
  fallback: number;
  min: number;
  max: number;
}): number {
  if (input.raw === undefined || input.raw.trim().length === 0) {
    return input.fallback;
  }
  const normalized = input.raw.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new RuntimeToolControlInputError(
      input.field,
      `${input.field} must be an integer between ${String(input.min)} and ${String(input.max)}`,
    );
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed < input.min || parsed > input.max) {
    throw new RuntimeToolControlInputError(
      input.field,
      `${input.field} must be an integer between ${String(input.min)} and ${String(input.max)}`,
    );
  }
  return parsed;
}

function throwRuntimeToolsAllowError(detail: string): never {
  throw new RuntimeToolControlInputError(
    "runtime-tools-allow",
    `${detail} (source=project_toml)`,
  );
}

export function parseRuntimeToolsAllowlist(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throwRuntimeToolsAllowError(RUNTIME_TOOLS_ALLOW_DETAIL);
  }
  const content = trimmed.slice(1, -1).trim();
  if (!content) {
    throwRuntimeToolsAllowError(RUNTIME_TOOLS_ALLOW_DETAIL);
  }
  const values: string[] = [];
  const seen = new Set<string>();
  for (const token of content.split(",")) {
    const part = token.trim();
    const match = part.match(/^"([^"]*)"$/);
    if (!match || typeof match[1] !== "string") {
      throwRuntimeToolsAllowError(RUNTIME_TOOLS_ALLOW_DETAIL);
    }
    const value = match[1].trim();
    if (!value) {
      throwRuntimeToolsAllowError(RUNTIME_TOOLS_ALLOW_DETAIL);
    }
    if (seen.has(value)) {
      throwRuntimeToolsAllowError("runtime-tools-allow values must be unique");
    }
    seen.add(value);
    values.push(value);
  }
  return values;
}

export function resolveMaxToolRounds(raw = process.env.GROBOT_MAX_TOOL_ROUNDS): number {
  return parseIntegerControl({
    raw,
    field: "max-tool-rounds",
    fallback: 8,
    min: 1,
    max: 32,
  });
}

export function resolveMaxRecoveryRounds(raw = process.env.GROBOT_MAX_RECOVERY_ROUNDS): number {
  return parseIntegerControl({
    raw,
    field: "max-recovery-rounds",
    fallback: 2,
    min: 0,
    max: 8,
  });
}

export function resolveNoToolFallbackMode(
  raw = process.env.GROBOT_NO_TOOL_FALLBACK_MODE,
): NoToolFallbackMode {
  if (raw === undefined || raw.trim().length === 0) {
    return "safe";
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "off" || normalized === "safe" || normalized === "strict") {
    return normalized;
  }
  throw new RuntimeToolControlInputError(
    "no-tool-fallback-mode",
    "no-tool-fallback-mode must be off, safe, or strict",
  );
}
