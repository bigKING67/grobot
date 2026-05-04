import { existsSync } from "node:fs";
import { resolve } from "node:path";

function normalizePath(raw: string): string {
  return raw.trim().replace(/[\\/]+$/, "");
}

function isRepoRoot(path: string): boolean {
  return existsSync(resolve(path, "grobot"))
    && existsSync(resolve(path, "gateway", "tsconfig.json"))
    && existsSync(resolve(path, "scripts", "install-local.sh"));
}

export function resolveRepoRoot(): string | undefined {
  const fromEnv = process.env.GROBOT_TS_DEV_REPO_ROOT;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    const candidate = normalizePath(fromEnv);
    if (isRepoRoot(candidate)) {
      return candidate;
    }
  }

  const cwd = normalizePath(process.cwd());
  if (isRepoRoot(cwd)) {
    return cwd;
  }

  return undefined;
}
