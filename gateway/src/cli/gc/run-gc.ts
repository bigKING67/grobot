import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { OptionValue, hasFlag } from "../cli-args";
import {
  resolveConfigTomlPath,
  resolveHomeDir,
  resolveProjectRoot,
  resolveProjectStateRoot,
  resolveWorkDir,
} from "../services/runtime-paths";
import {
  GcInputError,
  parseGcPositiveIntOption,
  parseGcScopeOption,
  parseGcTomlPositiveInt,
  writeGcInputError,
} from "./input-parsing";

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

function hasOption(options: Record<string, OptionValue>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(options, key);
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
    if (key === "retention_days") {
      next.retentionDays = parseGcTomlPositiveInt({
        value: kvMatch[2],
        field: "retention-days",
        min: 1,
        max: 3650,
      });
      continue;
    }
    if (key === "keep_recent_sessions") {
      next.keepRecentSessions = parseGcTomlPositiveInt({
        value: kvMatch[2],
        field: "keep-recent-sessions",
        min: 1,
        max: 2000,
      });
      continue;
    }
    if (key === "keep_recent_plans_per_session") {
      next.keepRecentPlansPerSession = parseGcTomlPositiveInt({
        value: kvMatch[2],
        field: "keep-recent-plans-per-session",
        min: 1,
        max: 500,
      });
    }
  }
  return next;
}

function resolvePolicy(options: Record<string, OptionValue>, configTomlPath: string | undefined): GcPolicy {
  const fromToml = readCleanupPolicyFromToml(configTomlPath);
  return {
    retentionDays: parseGcPositiveIntOption({
      options,
      key: "retention-days",
      fallback: fromToml.retentionDays ?? DEFAULT_POLICY.retentionDays,
      min: 1,
      max: 3650,
    }),
    keepRecentSessions: parseGcPositiveIntOption({
      options,
      key: "keep-recent-sessions",
      fallback: fromToml.keepRecentSessions ?? DEFAULT_POLICY.keepRecentSessions,
      min: 1,
      max: 2000,
    }),
    keepRecentPlansPerSession: parseGcPositiveIntOption({
      options,
      key: "keep-recent-plans-per-session",
      fallback: fromToml.keepRecentPlansPerSession ?? DEFAULT_POLICY.keepRecentPlansPerSession,
      min: 1,
      max: 500,
    }),
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
  const outputJson = hasOption(options, "json");
  let scope: GcScope = "all";
  let mode: "dry-run" | "apply" = "dry-run";
  let homeDir = "";
  let projectRoot = "";
  let workDir = "";
  let projectStateRoot = "";
  let configTomlPath: string | undefined;
  let policy: GcPolicy = DEFAULT_POLICY;
  try {
    scope = parseGcScopeOption({
      options,
      key: "scope",
      fallback: "all",
      allowed: ["global", "project", "all"],
    });
    const apply = hasFlag(options, "apply");
    const dryRun = hasFlag(options, "dry-run");
    if (apply && dryRun) {
      throw new GcInputError(
        "mode",
        "apply and dry-run cannot be used together",
      );
    }
    mode = apply ? "apply" : "dry-run";

    homeDir = resolveHomeDir(options);
    projectRoot = resolveProjectRoot(options, homeDir);
    workDir = resolveWorkDir(options, projectRoot, homeDir);
    projectStateRoot = resolveProjectStateRoot(workDir);
    configTomlPath = resolveConfigTomlPath(options, homeDir, { workDir, projectRoot });
    policy = resolvePolicy(options, configTomlPath);
  } catch (error) {
    if (error instanceof GcInputError) {
      writeGcInputError(error, outputJson);
      return 2;
    }
    throw error;
  }
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

  if (outputJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  }

  printHuman(summary);
  return 0;
}
