export type OptionValue = string | boolean;

export interface ParsedArgs {
  command: string;
  options: Record<string, OptionValue>;
  positionals: string[];
}

export function usage(): string {
  return [
    "Grobot TS dev CLI (source-checkout fallback)",
    "",
    "Commands:",
    "  status [--project <name>] [--work-dir <dir>] [--home <dir>] [--project-root <dir>] [--config <path>] [--provider <name>] [--api-key <key>] [--base-url <url>] [--model <id>] [--probe] [--json] [--context-graph-cache-window-size <n>] [--gateway-impl ts] [--runtime-impl rust] [--shadow-mode|--no-shadow-mode]",
      "  start [--message <text>] [--project <name>] [--work-dir <dir>] [--home <dir>] [--project-root <dir>] [--config <path>] [--provider <name>] [--session-scope dm|group] [--session-subject <id>] [--history-turns <n>] [--handoff-recent-turns <n>] [--handoff-auto-on-exit|--no-handoff-auto-on-exit] [--circuit-failures <n>] [--circuit-cooldown-secs <n>] [--provider-max-inflight <n>] [--provider-requests-per-minute <n>] [--provider-burst <n>] [--session-backend auto|file|redis] [--redis-url <url>] [--gateway-impl ts] [--runtime-impl rust]",
    "  serve [--project <name>] [--work-dir <dir>] [--home <dir>] [--project-root <dir>] [--config <path>] [--bind 127.0.0.1:8080] [--management-token <token>] [--config-read-policy auto|public|auth|disabled] [--session-backend auto|file|redis] [--redis-url <url>] [--gateway-impl ts] [--runtime-impl rust]",
    "",
    "Probe notes:",
    "  --probe uses base_url/api_key from CLI flags first, then GROBOT_BASE_URL/GROBOT_API_KEY.",
    "  --json emits a machine-readable status snapshot.",
    "  --context-graph-cache-window-size controls recent-turn graph cache window size (default 20, env GROBOT_CONTEXT_GRAPH_CACHE_WINDOW_SIZE).",
    "",
    "Optional session args for start:",
    "  --platform feishu|telegram --tenant <id> --scope dm|group --subject <id> (legacy aliases; prefer --session-scope/--session-subject)",
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

export function validateHardCutExecutionOptions(options: Record<string, OptionValue>): string[] {
  const errors: string[] = [];
  if (hasFlag(options, "legacy-python-cli")) {
    errors.push("--legacy-python-cli is removed in TS+Rust hard-cut mode");
  }
  if (isTruthyString(process.env.GROBOT_LEGACY_PYTHON)) {
    errors.push("GROBOT_LEGACY_PYTHON is no longer supported");
  }

  const gatewayRaw = readOptionString(options, "gateway-impl");
  if (gatewayRaw) {
    const gatewayValue = gatewayRaw.trim().toLowerCase();
    if (gatewayValue === "python") {
      errors.push("--gateway-impl=python is no longer supported");
    } else if (gatewayValue !== "ts") {
      errors.push(`invalid --gateway-impl value: ${gatewayRaw}`);
    }
  }

  const runtimeRaw = readOptionString(options, "runtime-impl");
  if (runtimeRaw) {
    const runtimeValue = runtimeRaw.trim().toLowerCase();
    if (runtimeValue === "python") {
      errors.push("--runtime-impl=python is no longer supported");
    } else if (runtimeValue !== "rust") {
      errors.push(`invalid --runtime-impl value: ${runtimeRaw}`);
    }
  }

  return errors;
}
