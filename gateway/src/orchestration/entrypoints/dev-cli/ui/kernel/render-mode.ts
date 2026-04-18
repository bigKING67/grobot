export type CliRenderMode = "interactive_tty" | "plain_tty" | "non_tty";
export type CliEnv = Record<string, string | undefined>;

interface ResolveCliRenderModeInput {
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  env?: CliEnv;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function isPlainColorMode(env: CliEnv): boolean {
  if (isTruthyEnv(env.NO_COLOR) || isTruthyEnv(env.CI)) {
    return true;
  }
  const term = (env.TERM ?? "").trim().toLowerCase();
  if (!term || term === "dumb") {
    return true;
  }
  return false;
}

export function resolveCliRenderMode(input: ResolveCliRenderModeInput = {}): CliRenderMode {
  const env = input.env ?? process.env;
  const stdout = process.stdout as unknown as { isTTY?: boolean };
  const stdinIsTTY = typeof input.stdinIsTTY === "boolean" ? input.stdinIsTTY : Boolean(process.stdin.isTTY);
  const stdoutIsTTY = typeof input.stdoutIsTTY === "boolean" ? input.stdoutIsTTY : Boolean(stdout.isTTY);
  if (!stdinIsTTY || !stdoutIsTTY) {
    return "non_tty";
  }
  if (isPlainColorMode(env)) {
    return "plain_tty";
  }
  return "interactive_tty";
}
