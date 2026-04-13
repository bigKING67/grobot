import { readFileSync } from "node:fs";
import { OptionValue, readOptionString, readOptionStringAny } from "../cli-args";

export function fileReadable(path: string): boolean {
  try {
    const content = readFileSync(path, "utf8");
    return content.length >= 0;
  } catch {
    return false;
  }
}

export function removeTrailingSlashes(value: string): string {
  if (/^[\\/]+$/.test(value)) {
    return value.startsWith("\\") ? "\\" : "/";
  }
  return value.replace(/[\\/]+$/, "");
}

function toAbsolutePath(rawPath: string, homeDir: string, baseDir: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return removeTrailingSlashes(baseDir);
  }
  let expanded = trimmed;
  if (expanded === "~") {
    expanded = homeDir;
  } else if (expanded.startsWith("~/")) {
    expanded = `${homeDir}/${expanded.slice(2)}`;
  }
  if (expanded.startsWith("/") || expanded.startsWith("\\")) {
    return removeTrailingSlashes(expanded);
  }
  return removeTrailingSlashes(`${removeTrailingSlashes(baseDir)}/${expanded}`);
}

export function resolveProjectRoot(options: Record<string, OptionValue>, homeDir: string): string {
  const raw = readOptionString(options, "project-root");
  if (!raw) {
    return removeTrailingSlashes(process.cwd());
  }
  return toAbsolutePath(raw, homeDir, process.cwd());
}

export function resolveWorkDir(options: Record<string, OptionValue>, projectRoot: string, homeDir: string): string {
  const raw = readOptionString(options, "work-dir");
  if (!raw) {
    return projectRoot;
  }
  return toAbsolutePath(raw, homeDir, projectRoot);
}

export function resolveProjectTomlPath(
  options: Record<string, OptionValue>,
  workDir: string,
  projectRoot: string,
  homeDir: string,
): string | undefined {
  const explicit = readOptionStringAny(options, ["project-toml", "project-path"]);
  if (explicit) {
    const explicitPath = toAbsolutePath(explicit, homeDir, process.cwd());
    if (fileReadable(explicitPath)) {
      return explicitPath;
    }
  }
  const hasProjectRootOverride = Boolean(readOptionString(options, "project-root"));
  if (hasProjectRootOverride) {
    const fromProjectRoot = `${projectRoot}/.grobot/project.toml`;
    if (fileReadable(fromProjectRoot)) {
      return fromProjectRoot;
    }
  }
  const fromWorkDir = `${workDir}/.grobot/project.toml`;
  if (fileReadable(fromWorkDir)) {
    return fromWorkDir;
  }
  if (!hasProjectRootOverride) {
    const fromProjectRoot = `${projectRoot}/.grobot/project.toml`;
    if (fromProjectRoot !== fromWorkDir && fileReadable(fromProjectRoot)) {
      return fromProjectRoot;
    }
  }
  const repoRoot = process.env.GROBOT_TS_DEV_REPO_ROOT;
  if (repoRoot) {
    const fromRepo = `${removeTrailingSlashes(repoRoot)}/.grobot/project.toml`;
    if (fileReadable(fromRepo)) {
      return fromRepo;
    }
  }
  return undefined;
}

export function resolveConfigTomlPath(options: Record<string, OptionValue>, homeDir: string): string | undefined {
  const explicit = readOptionStringAny(options, ["config", "config-path"]);
  if (explicit) {
    const explicitPath = toAbsolutePath(explicit, homeDir, process.cwd());
    if (fileReadable(explicitPath)) {
      return explicitPath;
    }
  }
  const envPath = process.env.GROBOT_CONFIG;
  if (typeof envPath === "string" && envPath.trim().length > 0) {
    const envConfigPath = toAbsolutePath(envPath, homeDir, process.cwd());
    if (fileReadable(envConfigPath)) {
      return envConfigPath;
    }
  }
  const fromHome = `${homeDir}/config.toml`;
  if (fileReadable(fromHome)) {
    return fromHome;
  }
  return undefined;
}

export function basenameFromPath(value: string): string {
  const normalized = removeTrailingSlashes(value);
  const tokens = normalized.split(/[\\/]/);
  const last = tokens[tokens.length - 1];
  if (typeof last === "string" && last.length > 0) {
    return last;
  }
  return "grobot";
}

export function resolveHomeDir(options?: Record<string, OptionValue>): string {
  const home = process.env.HOME;
  const defaultHome = typeof home === "string" && home.trim().length > 0
    ? `${removeTrailingSlashes(home.trim())}/.grobot`
    : `${process.cwd()}/.grobot`;
  const fromOption = options ? readOptionStringAny(options, ["home", "home-dir"]) : undefined;
  if (fromOption) {
    return toAbsolutePath(fromOption, defaultHome, process.cwd());
  }
  const fromEnv = process.env.GROBOT_HOME;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return removeTrailingSlashes(fromEnv.trim());
  }
  return defaultHome;
}

export function resolveInterruptStorePath(homeDir?: string): string {
  const root = homeDir ? removeTrailingSlashes(homeDir) : resolveHomeDir();
  return `${root}/runtime/sessions/interrupts.json`;
}

export function resolveMemoryStorePath(homeDir?: string): string {
  const root = homeDir ? removeTrailingSlashes(homeDir) : resolveHomeDir();
  return `${root}/runtime/memory/ts-dev-cli-memory.json`;
}
