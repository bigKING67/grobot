import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { OptionValue, hasFlag, readOptionString } from "../cli-args";
import {
  resolveConfigTomlPath,
  resolveHomeDir,
  resolveProjectRoot,
  resolveProjectStateRoot,
  resolveWorkDir,
} from "../services/runtime-paths";

type GcScope = "global" | "project" | "all";

interface GcPolicy {
  retentionDays: number;
  keepRecentSessions: number;
  keepRecentPlansPerSession: number;
}

interface FileRow {
  path: string;
  size: number;
  mtimeMs: number;
}

interface TargetSummary {
  name: string;
  path: string;
  scanned: number;
  candidates: number;
  deleted: number;
  bytesCandidates: number;
  bytesDeleted: number;
  errors: string[];
}

interface GcSummary {
  mode: "dry-run" | "apply";
  scope: GcScope;
  policy: GcPolicy;
  configTomlPath?: string;
  targets: TargetSummary[];
  totals: {
    scanned: number;
    candidates: number;
    deleted: number;
    bytesCandidates: number;
    bytesDeleted: number;
    errorCount: number;
  };
}

const DEFAULT_POLICY: GcPolicy = {
  retentionDays: 30,
  keepRecentSessions: 40,
  keepRecentPlansPerSession: 12,
};

function clampInteger(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < min) {
    return min;
  }
  if (normalized > max) {
    return max;
  }
  return normalized;
}

function parseInteger(raw: string | undefined): number | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function parseScope(raw: string | undefined): GcScope | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "global" || normalized === "project" || normalized === "all") {
    return normalized;
  }
  return undefined;
}

function parseTomlIntegerValue(raw: string): number | undefined {
  const match = raw.trim().match(/^(-?\d+)$/);
  if (!match || typeof match[1] !== "string") {
    return undefined;
  }
  return Number.parseInt(match[1], 10);
}

function readCleanupPolicyFromToml(configTomlPath: string | undefined): Partial<GcPolicy> {
  if (!configTomlPath || !existsSync(configTomlPath)) {
    return {};
  }
  let raw = "";
  try {
    raw = String(readFileSync(configTomlPath, "utf8"));
  } catch {
    return {};
  }
  const lines = raw.split(/\r?\n/);
  let inSection = false;
  const next: Partial<GcPolicy> = {};
  for (const sourceLine of lines) {
    const line = sourceLine.replace(/\s+#.*$/, "").trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch && typeof sectionMatch[1] === "string") {
      inSection = sectionMatch[1].trim() === "storage.cleanup";
      continue;
    }
    if (!inSection) {
      continue;
    }
    const kvMatch = line.match(/^([a-zA-Z0-9_]+)\s*=\s*(.+)$/);
    if (!kvMatch) {
      continue;
    }
    const key = kvMatch[1];
    const value = parseTomlIntegerValue(kvMatch[2]);
    if (typeof value !== "number") {
      continue;
    }
    if (key === "retention_days") {
      next.retentionDays = clampInteger(value, DEFAULT_POLICY.retentionDays, 1, 3650);
      continue;
    }
    if (key === "keep_recent_sessions") {
      next.keepRecentSessions = clampInteger(value, DEFAULT_POLICY.keepRecentSessions, 1, 2000);
      continue;
    }
    if (key === "keep_recent_plans_per_session") {
      next.keepRecentPlansPerSession = clampInteger(
        value,
        DEFAULT_POLICY.keepRecentPlansPerSession,
        1,
        500,
      );
    }
  }
  return next;
}

function resolvePolicy(options: Record<string, OptionValue>, configTomlPath: string | undefined): GcPolicy {
  const fromToml = readCleanupPolicyFromToml(configTomlPath);
  const cliRetentionDays = parseInteger(readOptionString(options, "retention-days"));
  const cliKeepRecentSessions = parseInteger(readOptionString(options, "keep-recent-sessions"));
  const cliKeepRecentPlans = parseInteger(readOptionString(options, "keep-recent-plans-per-session"));
  return {
    retentionDays: clampInteger(
      typeof cliRetentionDays === "number"
        ? cliRetentionDays
        : fromToml.retentionDays ?? DEFAULT_POLICY.retentionDays,
      DEFAULT_POLICY.retentionDays,
      1,
      3650,
    ),
    keepRecentSessions: clampInteger(
      typeof cliKeepRecentSessions === "number"
        ? cliKeepRecentSessions
        : fromToml.keepRecentSessions ?? DEFAULT_POLICY.keepRecentSessions,
      DEFAULT_POLICY.keepRecentSessions,
      1,
      2000,
    ),
    keepRecentPlansPerSession: clampInteger(
      typeof cliKeepRecentPlans === "number"
        ? cliKeepRecentPlans
        : fromToml.keepRecentPlansPerSession ?? DEFAULT_POLICY.keepRecentPlansPerSession,
      DEFAULT_POLICY.keepRecentPlansPerSession,
      1,
      500,
    ),
  };
}

function createTargetSummary(name: string, path: string): TargetSummary {
  return {
    name,
    path,
    scanned: 0,
    candidates: 0,
    deleted: 0,
    bytesCandidates: 0,
    bytesDeleted: 0,
    errors: [],
  };
}

function joinPath(base: string, child: string): string {
  const normalizedBase = base.replace(/[\\/]+$/, "");
  const normalizedChild = child.replace(/^[\\/]+/, "");
  if (!normalizedBase) {
    return normalizedChild;
  }
  if (!normalizedChild) {
    return normalizedBase;
  }
  return `${normalizedBase}/${normalizedChild}`;
}

function safeListDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function safeStat(path: string): { size: number; mtimeMs: number; isDirectory: boolean } | undefined {
  try {
    const row = statSync(path);
    const isDirectory = row.isDirectory();
    let size = 0;
    if (!isDirectory) {
      try {
        size = readFileSync(path, "utf8").length;
      } catch {
        size = 0;
      }
    }
    return {
      size,
      mtimeMs: Number.isFinite(row.mtimeMs) ? row.mtimeMs : 0,
      isDirectory,
    };
  } catch {
    return undefined;
  }
}

function removeFile(path: string, apply: boolean): boolean {
  if (!apply) {
    return false;
  }
  try {
    rmSync(path, { force: true });
    return true;
  } catch {
    return false;
  }
}

function maybeRemoveEmptyDir(path: string, apply: boolean): void {
  if (!apply) {
    return;
  }
  try {
    const left = readdirSync(path);
    if (left.length === 0) {
      rmSync(path, { recursive: true, force: true });
    }
  } catch {
    // ignore cleanup failures
  }
}

function collectFilesRecursively(root: string, maxDepth: number): FileRow[] {
  const rows: FileRow[] = [];
  const visit = (path: string, depth: number): void => {
    if (depth > maxDepth) {
      return;
    }
    for (const entryName of safeListDir(path)) {
      const nextPath = joinPath(path, entryName);
      const info = safeStat(nextPath);
      if (!info) {
        continue;
      }
      if (info.isDirectory) {
        visit(nextPath, depth + 1);
        continue;
      }
      rows.push({
        path: nextPath,
        size: info.size,
        mtimeMs: info.mtimeMs,
      });
    }
  };
  if (existsSync(root)) {
    visit(root, 0);
  }
  return rows;
}

function cleanSessionDirectory(args: {
  name: string;
  path: string;
  cutoffMs: number;
  keepRecent: number;
  apply: boolean;
}): TargetSummary {
  const summary = createTargetSummary(args.name, args.path);
  const rows = collectFilesRecursively(args.path, 1)
    .filter((row) => /\.(json|jsonl|cast)$/i.test(row.path))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  summary.scanned = rows.length;
  rows.forEach((row, index) => {
    const keepByCount = index < args.keepRecent;
    const keepByAge = row.mtimeMs >= args.cutoffMs;
    if (keepByCount || keepByAge) {
      return;
    }
    summary.candidates += 1;
    summary.bytesCandidates += row.size;
    const deleted = removeFile(row.path, args.apply);
    if (deleted) {
      summary.deleted += 1;
      summary.bytesDeleted += row.size;
    } else if (args.apply) {
      summary.errors.push(`remove failed: ${row.path}`);
    }
  });
  maybeRemoveEmptyDir(args.path, args.apply);
  return summary;
}

function cleanPlansDirectory(args: {
  name: string;
  path: string;
  cutoffMs: number;
  keepRecentPerSession: number;
  apply: boolean;
}): TargetSummary {
  const summary = createTargetSummary(args.name, args.path);
  if (!existsSync(args.path)) {
    return summary;
  }
  const roots = safeListDir(args.path)
    .map((entryName) => joinPath(args.path, entryName))
    .filter((path) => safeStat(path)?.isDirectory === true);

  const rootFiles = collectFilesRecursively(args.path, 0)
    .filter((row) => /\.(md|json|jsonl)$/i.test(row.path))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  summary.scanned += rootFiles.length;
  rootFiles.forEach((row, index) => {
    const keepByCount = index < args.keepRecentPerSession;
    const keepByAge = row.mtimeMs >= args.cutoffMs;
    if (keepByCount || keepByAge) {
      return;
    }
    summary.candidates += 1;
    summary.bytesCandidates += row.size;
    const deleted = removeFile(row.path, args.apply);
    if (deleted) {
      summary.deleted += 1;
      summary.bytesDeleted += row.size;
    } else if (args.apply) {
      summary.errors.push(`remove failed: ${row.path}`);
    }
  });

  for (const bucket of roots) {
    const rows = collectFilesRecursively(bucket, 2)
      .filter((row) => /\.(md|json|jsonl)$/i.test(row.path))
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
    summary.scanned += rows.length;
    rows.forEach((row, index) => {
      const keepByCount = index < args.keepRecentPerSession;
      const keepByAge = row.mtimeMs >= args.cutoffMs;
      if (keepByCount || keepByAge) {
        return;
      }
      summary.candidates += 1;
      summary.bytesCandidates += row.size;
      const deleted = removeFile(row.path, args.apply);
      if (deleted) {
        summary.deleted += 1;
        summary.bytesDeleted += row.size;
      } else if (args.apply) {
        summary.errors.push(`remove failed: ${row.path}`);
      }
    });
    maybeRemoveEmptyDir(bucket, args.apply);
  }

  maybeRemoveEmptyDir(args.path, args.apply);
  return summary;
}

function cleanOldFilesDirectory(args: {
  name: string;
  path: string;
  cutoffMs: number;
  apply: boolean;
}): TargetSummary {
  const summary = createTargetSummary(args.name, args.path);
  const rows = collectFilesRecursively(args.path, 6)
    .filter((row) => row.mtimeMs < args.cutoffMs)
    .sort((left, right) => left.mtimeMs - right.mtimeMs);
  summary.scanned = rows.length;
  for (const row of rows) {
    summary.candidates += 1;
    summary.bytesCandidates += row.size;
    const deleted = removeFile(row.path, args.apply);
    if (deleted) {
      summary.deleted += 1;
      summary.bytesDeleted += row.size;
    } else if (args.apply) {
      summary.errors.push(`remove failed: ${row.path}`);
    }
  }
  maybeRemoveEmptyDir(args.path, args.apply);
  return summary;
}

function resolveDefaultTypescriptRunnerCacheRoot(): string {
  const cacheRootOverride = process.env.GROBOT_TS_DEV_CLI_CACHE_ROOT;
  if (typeof cacheRootOverride === "string" && cacheRootOverride.trim().length > 0) {
    return cacheRootOverride.trim();
  }
  const groupRoot = process.env.GROBOT_TS_DEV_CACHE_ROOT;
  if (typeof groupRoot === "string" && groupRoot.trim().length > 0) {
    return `${groupRoot.trim().replace(/[\\/]+$/, "")}/ts-dev-cli`;
  }

  const home = process.env.HOME?.trim() || process.cwd();
  const osName = (process.env.OSTYPE ?? process.env.GROBOT_OS ?? "").toLowerCase();
  if (osName.includes("darwin") || osName.includes("mac")) {
    return `${home}/Library/Caches/grobot/ts-dev-cli`;
  }
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  if (xdg) {
    return `${xdg.replace(/[\\/]+$/, "")}/grobot/ts-dev-cli`;
  }
  return `${home}/.cache/grobot/ts-dev-cli`;
}

function summarize(targets: TargetSummary[]): GcSummary["totals"] {
  return targets.reduce(
    (acc, item) => ({
      scanned: acc.scanned + item.scanned,
      candidates: acc.candidates + item.candidates,
      deleted: acc.deleted + item.deleted,
      bytesCandidates: acc.bytesCandidates + item.bytesCandidates,
      bytesDeleted: acc.bytesDeleted + item.bytesDeleted,
      errorCount: acc.errorCount + item.errors.length,
    }),
    {
      scanned: 0,
      candidates: 0,
      deleted: 0,
      bytesCandidates: 0,
      bytesDeleted: 0,
      errorCount: 0,
    },
  );
}

function printHuman(summary: GcSummary): void {
  process.stdout.write(
    `[gc] mode=${summary.mode} scope=${summary.scope} retention_days=${summary.policy.retentionDays} keep_recent_sessions=${summary.policy.keepRecentSessions} keep_recent_plans_per_session=${summary.policy.keepRecentPlansPerSession}\n`,
  );
  for (const target of summary.targets) {
    process.stdout.write(
      `  - ${target.name}: scanned=${target.scanned} candidates=${target.candidates} deleted=${target.deleted} bytes_candidates=${target.bytesCandidates} bytes_deleted=${target.bytesDeleted} path=${target.path}\n`,
    );
    for (const error of target.errors.slice(0, 5)) {
      process.stdout.write(`      error: ${error}\n`);
    }
    if (target.errors.length > 5) {
      process.stdout.write(`      error: ... and ${target.errors.length - 5} more\n`);
    }
  }
  process.stdout.write(
    `[gc] totals: scanned=${summary.totals.scanned} candidates=${summary.totals.candidates} deleted=${summary.totals.deleted} bytes_candidates=${summary.totals.bytesCandidates} bytes_deleted=${summary.totals.bytesDeleted} errors=${summary.totals.errorCount}\n`,
  );
}

export async function runGc(options: Record<string, OptionValue>): Promise<number> {
  const explicitScope = parseScope(readOptionString(options, "scope"));
  if (!explicitScope && typeof readOptionString(options, "scope") === "string") {
    process.stderr.write("error: invalid `--scope`, expected `global`, `project`, or `all`.\n");
    return 2;
  }
  const scope: GcScope = explicitScope ?? "all";

  const apply = hasFlag(options, "apply");
  const dryRun = hasFlag(options, "dry-run");
  if (apply && dryRun) {
    process.stderr.write("error: `--apply` and `--dry-run` cannot be used together.\n");
    return 2;
  }
  const mode: "dry-run" | "apply" = apply ? "apply" : "dry-run";

  const homeDir = resolveHomeDir(options);
  const projectRoot = resolveProjectRoot(options, homeDir);
  const workDir = resolveWorkDir(options, projectRoot, homeDir);
  const projectStateRoot = resolveProjectStateRoot(workDir);
  const configTomlPath = resolveConfigTomlPath(options, homeDir, { workDir, projectRoot });
  const policy = resolvePolicy(options, configTomlPath);
  const cutoffMs = Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000;
  const targets: TargetSummary[] = [];

  const includeGlobal = scope === "global" || scope === "all";
  const includeProject = scope === "project" || scope === "all";

  if (includeGlobal) {
    targets.push(cleanSessionDirectory({
      name: "global_sessions",
      path: joinPath(homeDir, "sessions"),
      cutoffMs,
      keepRecent: policy.keepRecentSessions,
      apply: mode === "apply",
    }));
    targets.push(cleanPlansDirectory({
      name: "global_plans",
      path: joinPath(homeDir, "plans"),
      cutoffMs,
      keepRecentPerSession: policy.keepRecentPlansPerSession,
      apply: mode === "apply",
    }));
    targets.push(cleanOldFilesDirectory({
      name: "global_runtime_internal",
      path: joinPath(homeDir, "runtime"),
      cutoffMs,
      apply: mode === "apply",
    }));
    targets.push(cleanOldFilesDirectory({
      name: "typescript_runner_cache",
      path: resolveDefaultTypescriptRunnerCacheRoot(),
      cutoffMs,
      apply: mode === "apply",
    }));
  }

  if (includeProject) {
    targets.push(cleanSessionDirectory({
      name: "project_sessions",
      path: joinPath(projectStateRoot, "sessions"),
      cutoffMs,
      keepRecent: policy.keepRecentSessions,
      apply: mode === "apply",
    }));
    targets.push(cleanPlansDirectory({
      name: "project_plans",
      path: joinPath(projectStateRoot, "plans"),
      cutoffMs,
      keepRecentPerSession: policy.keepRecentPlansPerSession,
      apply: mode === "apply",
    }));
    targets.push(cleanOldFilesDirectory({
      name: "project_runtime_internal",
      path: joinPath(projectStateRoot, "runtime"),
      cutoffMs,
      apply: mode === "apply",
    }));
  }

  const summary: GcSummary = {
    mode,
    scope,
    policy,
    configTomlPath,
    targets,
    totals: summarize(targets),
  };

  if (hasFlag(options, "json")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  }

  printHuman(summary);
  return 0;
}
