import { readFileSync } from "node:fs";
import {
  OptionValue,
  readEnvOptionalNonEmptyString,
  readExplicitOptionalNonEmptyString,
  readExplicitOptionalNonEmptyStringAny,
} from "../cli-args";

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
  const raw = readExplicitOptionalNonEmptyString(options, "project-root");
  if (!raw) {
    return removeTrailingSlashes(process.cwd());
  }
  return toAbsolutePath(raw, homeDir, process.cwd());
}

export function resolveWorkDir(options: Record<string, OptionValue>, projectRoot: string, homeDir: string): string {
  const raw = readExplicitOptionalNonEmptyString(options, "work-dir");
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
  const explicit = readExplicitOptionalNonEmptyStringAny(options, ["project-toml", "project-path"]);
  if (explicit) {
    const explicitPath = toAbsolutePath(explicit, homeDir, process.cwd());
    if (fileReadable(explicitPath)) {
      return explicitPath;
    }
  }
  const hasProjectRootOverride = Boolean(readExplicitOptionalNonEmptyString(options, "project-root"));
  if (hasProjectRootOverride) {
    const fromProjectRoot = `${projectRoot}/.grobot/project.toml`;
    if (fileReadable(fromProjectRoot)) {
      return fromProjectRoot;
    }
    const fromWorkDir = `${workDir}/.grobot/project.toml`;
    if (fromWorkDir !== fromProjectRoot && fileReadable(fromWorkDir)) {
      return fromWorkDir;
    }
    return undefined;
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
  const repoRoot = readEnvOptionalNonEmptyString(
    process.env,
    "GROBOT_TS_DEV_REPO_ROOT",
    "ts-dev-repo-root",
  );
  if (repoRoot) {
    const fromRepo = `${removeTrailingSlashes(repoRoot)}/.grobot/project.toml`;
    if (fileReadable(fromRepo)) {
      return fromRepo;
    }
  }
  return undefined;
}

interface ResolveConfigTomlPathContext {
  workDir?: string;
  projectRoot?: string;
}

export function resolveConfigTomlPath(
  options: Record<string, OptionValue>,
  homeDir: string,
  context?: ResolveConfigTomlPathContext,
): string | undefined {
  const explicit = readExplicitOptionalNonEmptyStringAny(options, ["config", "config-path"]);
  if (explicit) {
    const explicitPath = toAbsolutePath(explicit, homeDir, process.cwd());
    if (fileReadable(explicitPath)) {
      return explicitPath;
    }
  }
  const envPath = readEnvOptionalNonEmptyString(process.env, "GROBOT_CONFIG", "config");
  if (typeof envPath === "string") {
    const envConfigPath = toAbsolutePath(envPath, homeDir, process.cwd());
    if (fileReadable(envConfigPath)) {
      return envConfigPath;
    }
  }
  const workDirCandidate = context?.workDir
    ? `${removeTrailingSlashes(context.workDir)}/.grobot/config.toml`
    : `${removeTrailingSlashes(process.cwd())}/.grobot/config.toml`;
  if (fileReadable(workDirCandidate)) {
    return workDirCandidate;
  }
  const projectRootCandidate = context?.projectRoot
    ? `${removeTrailingSlashes(context.projectRoot)}/.grobot/config.toml`
    : undefined;
  if (
    projectRootCandidate &&
    projectRootCandidate !== workDirCandidate &&
    fileReadable(projectRootCandidate)
  ) {
    return projectRootCandidate;
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
  const fromOption = options ? readExplicitOptionalNonEmptyStringAny(options, ["home", "home-dir"]) : undefined;
  if (fromOption) {
    return toAbsolutePath(fromOption, defaultHome, process.cwd());
  }
  const fromEnv = readEnvOptionalNonEmptyString(process.env, "GROBOT_HOME", "home");
  if (typeof fromEnv === "string") {
    return removeTrailingSlashes(fromEnv);
  }
  return defaultHome;
}

export function resolveProjectStateRoot(workDir: string): string {
  return `${removeTrailingSlashes(workDir)}/.grobot`;
}

export function resolveInterruptStorePath(projectStateRoot?: string): string {
  const root = projectStateRoot
    ? removeTrailingSlashes(projectStateRoot)
    : resolveProjectStateRoot(process.cwd());
  return `${root}/sessions/interrupts.json`;
}

export function resolveMemoryStorePath(projectStateRoot?: string): string {
  const root = projectStateRoot
    ? removeTrailingSlashes(projectStateRoot)
    : resolveProjectStateRoot(process.cwd());
  return `${root}/memory/ts-dev-cli-memory.json`;
}

function sanitizePathSegment(value: string | undefined, fallback: string): string {
  const source = typeof value === "string" ? value.trim() : "";
  if (!source) {
    return fallback;
  }
  const normalized = source
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  if (!normalized) {
    return fallback;
  }
  return normalized;
}

export function resolveExperiencePoolPath(
  projectStateRoot?: string,
  scope?: {
    tenant?: string;
    team?: string;
    user?: string;
  },
): string {
  const root = projectStateRoot
    ? removeTrailingSlashes(projectStateRoot)
    : resolveProjectStateRoot(process.cwd());
  const tenant = sanitizePathSegment(scope?.tenant, "default-tenant");
  const team = sanitizePathSegment(scope?.team, "default-team");
  const user = sanitizePathSegment(scope?.user, "default-user");
  return `${root}/experience/tenant/${tenant}/team/${team}/user/${user}/experience-pool.json`;
}

export function resolveLegacyExperiencePoolPath(homeDir?: string): string {
  const root = homeDir ? removeTrailingSlashes(homeDir) : resolveHomeDir();
  return `${root}/runtime/experience/experience-pool.json`;
}

export function resolveLegacyMemoryStorePath(homeDir?: string): string {
  const root = homeDir ? removeTrailingSlashes(homeDir) : resolveHomeDir();
  return `${root}/runtime/memory/ts-dev-cli-memory.json`;
}
