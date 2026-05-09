export type OptionValue = string | boolean;

export interface ParsedArgs {
  command: string;
  options: Record<string, OptionValue>;
  positionals: string[];
}

export function usage(): string {
  return [
    "Grobot",
    "Local interactive agent; run `grobot` to enter the TUI.",
    "",
    "Commands",
    "  • grobot",
    "    ⎿  Enter local interactive TUI",
    "  • grobot status",
    "    ⎿  Show actionable summary; add --json for full snapshot; add --probe to test model channel",
    "  • grobot init --project",
    "    ⎿  Initialize project config; add --global for global config",
    "  • grobot gc --dry-run",
    "    ⎿  Preview session, plan, and runtime cache cleanup; add --apply to confirm",
    "  • grobot serve",
    "    ⎿  Start local management service",
    "",
    "Common options",
    "  • status",
    "    ⎿  --project --work-dir --config --provider --model --probe --json",
    "  • gc",
    "    ⎿  --scope global|project|all --retention-days --keep-recent-sessions --apply --json",
    "  • serve",
    "    ⎿  --bind --management-token --config-read-policy --session-backend --redis-url",
    "",
    "Session recovery",
    "  • grobot --resume <session-id|query>",
    "    ⎿  Resume a matching session at startup; --resume-last picks the latest resumable session",
    "  • grobot --rewind [checkpoint-id|query]",
    "    ⎿  Rewind to a checkpoint at startup; --rewind-mode both|conversation|code|summarize scopes restore",
    "",
    "More",
    "  • Use /help inside the TUI for commands",
    "  • start is reserved for platform session entry; local interactive use should run grobot directly",
  ].join("\n");
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, OptionValue> = {};
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      index += 1;
      continue;
    }

    const eqIndex = token.indexOf("=");
    if (eqIndex >= 0) {
      const key = token.slice(2, eqIndex);
      const value = token.slice(eqIndex + 1);
      options[key] = value;
      index += 1;
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (typeof next === "string" && !next.startsWith("--")) {
      options[key] = next;
      index += 2;
      continue;
    }
    options[key] = true;
    index += 1;
  }

  const command = positionals[0] ?? "";
  return {
    command,
    options,
    positionals: positionals.slice(1),
  };
}

export function readOptionString(options: Record<string, OptionValue>, key: string): string | undefined {
  const value = options[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

export function readOptionStringAny(options: Record<string, OptionValue>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = readOptionString(options, key);
    if (value) {
      return value;
    }
  }
  return undefined;
}

export class CliStringOptionInputError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(field: string, detail: string) {
    super(detail);
    this.name = "CliStringOptionInputError";
    this.code = `invalid_${field.replace(/-/g, "_")}`;
    this.field = field;
  }
}

export function isCliStringOptionInputError(
  error: unknown,
): error is CliStringOptionInputError {
  return error instanceof CliStringOptionInputError;
}

export function readExplicitOptionalNonEmptyString(
  options: Record<string, OptionValue>,
  key: string,
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(options, key)) {
    return undefined;
  }
  const value = options[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CliStringOptionInputError(
      key,
      `${key} must be a non-empty string`,
    );
  }
  return value.trim();
}

export function readExplicitOptionalNonEmptyStringAny(
  options: Record<string, OptionValue>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = readExplicitOptionalNonEmptyString(options, key);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

export function hasFlag(options: Record<string, OptionValue>, key: string): boolean {
  const value = options[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "false" || normalized === "off" || normalized === "0" || normalized === "no") {
      return false;
    }
    return normalized.length > 0;
  }
  return false;
}

function isTruthyString(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

type HardCutExecutionOption =
  | { kind: "omitted" }
  | { kind: "invalid"; displayValue: "<missing>" | "<empty>" }
  | { kind: "value"; value: string };

function readHardCutExecutionOption(
  options: Record<string, OptionValue>,
  key: string,
): HardCutExecutionOption {
  if (!Object.prototype.hasOwnProperty.call(options, key)) {
    return { kind: "omitted" };
  }
  const value = options[key];
  if (typeof value !== "string") {
    return { kind: "invalid", displayValue: "<missing>" };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { kind: "invalid", displayValue: "<empty>" };
  }
  return { kind: "value", value: trimmed };
}

export function validateHardCutExecutionOptions(options: Record<string, OptionValue>): string[] {
  const errors: string[] = [];
  if (hasFlag(options, "legacy-python-cli")) {
    errors.push("--legacy-python-cli is removed in TS+Rust hard-cut mode");
  }
  if (isTruthyString(process.env.GROBOT_LEGACY_PYTHON)) {
    errors.push("GROBOT_LEGACY_PYTHON is no longer supported");
  }

  const gatewayImpl = readHardCutExecutionOption(options, "gateway-impl");
  if (gatewayImpl.kind === "invalid") {
    errors.push(`invalid --gateway-impl value: ${gatewayImpl.displayValue}`);
  } else if (gatewayImpl.kind === "value") {
    const gatewayRaw = gatewayImpl.value;
    const gatewayValue = gatewayRaw.toLowerCase();
    if (gatewayValue === "python") {
      errors.push("--gateway-impl=python is no longer supported");
    } else if (gatewayValue !== "ts") {
      errors.push(`invalid --gateway-impl value: ${gatewayRaw}`);
    }
  }

  const runtimeImpl = readHardCutExecutionOption(options, "runtime-impl");
  if (runtimeImpl.kind === "invalid") {
    errors.push(`invalid --runtime-impl value: ${runtimeImpl.displayValue}`);
  } else if (runtimeImpl.kind === "value") {
    const runtimeRaw = runtimeImpl.value;
    const runtimeValue = runtimeRaw.toLowerCase();
    if (runtimeValue === "python") {
      errors.push("--runtime-impl=python is no longer supported");
    } else if (runtimeValue !== "rust") {
      errors.push(`invalid --runtime-impl value: ${runtimeRaw}`);
    }
  }

  return errors;
}
