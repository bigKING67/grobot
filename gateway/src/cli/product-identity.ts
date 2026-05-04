import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_CLI_PRODUCT_VERSION = "0.0.0";
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function normalizeRootCandidate(value: string | undefined): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return resolve(value.trim());
}

function readPackageVersionAtRoot(root: string): string | undefined {
  const packageJsonPath = resolve(root, "package.json");
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) {
      return undefined;
    }
    const metadata = parsed as { name?: unknown; version?: unknown };
    if (metadata.name !== "grobot") {
      return undefined;
    }
    const version = metadata.version;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

function resolveCandidateRoots(): string[] {
  const fromSourceRoot = normalizeRootCandidate(process.env.GROBOT_SOURCE_ROOT);
  const candidates = [
    normalizeRootCandidate(process.env.GROBOT_TS_DEV_REPO_ROOT),
    fromSourceRoot,
    fromSourceRoot ? normalizeRootCandidate(`${fromSourceRoot}/..`) : undefined,
    fromSourceRoot ? normalizeRootCandidate(`${fromSourceRoot}/../..`) : undefined,
    normalizeRootCandidate(process.cwd()),
  ];
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    roots.push(candidate);
  }
  return roots;
}

function resolveCliProductVersion(): string {
  for (const candidate of resolveCandidateRoots()) {
    const version = readPackageVersionAtRoot(candidate);
    if (version && SEMVER_PATTERN.test(version)) {
      return version;
    }
  }

  return DEFAULT_CLI_PRODUCT_VERSION;
}

function normalizeVersionPrefix(value: string): string {
  return value.trim().replace(/^v/i, "");
}

function isDevLikeVersion(value: string): boolean {
  return /\bdev\b/i.test(value) || /\blocal\b/i.test(value);
}

export function resolveCliVersionDisplay(
  rawOverride: string | undefined,
  fallback: string = CLI_PRODUCT_VERSION,
): string {
  if (typeof rawOverride === "string") {
    const normalized = normalizeVersionPrefix(rawOverride);
    if (
      normalized.length > 0
      && SEMVER_PATTERN.test(normalized)
      && !isDevLikeVersion(normalized)
    ) {
      return normalized;
    }
  }
  return fallback;
}

export const CLI_PRODUCT_ENGINE = "typescript-gateway";
export const CLI_PRODUCT_NAME = "grobot CLI";
export const CLI_PRODUCT_VERSION = resolveCliProductVersion();
export const CLI_PRODUCT_USER_AGENT = `grobot-cli/${CLI_PRODUCT_VERSION}`;
