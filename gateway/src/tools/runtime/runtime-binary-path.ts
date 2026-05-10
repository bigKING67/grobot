export class RuntimeBinaryPathInputError extends Error {
  readonly code = "invalid_runtime_bin";
  readonly field = "runtime-bin";

  constructor() {
    super("runtime-bin must be a non-empty path");
    this.name = "RuntimeBinaryPathInputError";
  }
}

export function isRuntimeBinaryPathInputError(
  error: unknown,
): error is RuntimeBinaryPathInputError {
  return error instanceof RuntimeBinaryPathInputError;
}

function removeTrailingSlashes(value: string): string {
  if (/^[\\/]+$/.test(value)) {
    return value.startsWith("\\") ? "\\" : "/";
  }
  return value.replace(/[\\/]+$/, "");
}

export interface ResolveRuntimeBinaryPathInput {
  runtimeBinaryPath?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
  platform?: string;
}

export function resolveRuntimeBinaryPath(
  input: ResolveRuntimeBinaryPathInput = {},
): string {
  if (Object.prototype.hasOwnProperty.call(input, "runtimeBinaryPath")) {
    const directPath = input.runtimeBinaryPath;
    if (typeof directPath === "string" && directPath.trim().length > 0) {
      return directPath.trim();
    }
    throw new RuntimeBinaryPathInputError();
  }

  const env = input.env ?? process.env;
  const envPath = env.GROBOT_RUNTIME_BIN;
  if (typeof envPath === "string") {
    if (envPath.trim().length > 0) {
      return envPath.trim();
    }
    throw new RuntimeBinaryPathInputError();
  }

  const platform = input.platform ?? (process as unknown as { platform?: string }).platform;
  const exeSuffix = platform === "win32" ? ".exe" : "";
  const repoRoot = env.GROBOT_TS_DEV_REPO_ROOT;
  if (typeof repoRoot === "string" && repoRoot.trim().length > 0) {
    return `${removeTrailingSlashes(repoRoot)}/runtime/target/debug/grobot-runtime${exeSuffix}`;
  }
  return `${input.cwd ?? process.cwd()}/runtime/target/debug/grobot-runtime${exeSuffix}`;
}
