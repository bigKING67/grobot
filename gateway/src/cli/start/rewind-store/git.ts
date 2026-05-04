import { spawnSync } from "node:child_process";
import { normalizeRelativePath } from "./paths";

export function parseNullSeparatedPathList(buffer: Buffer): string[] {
  const raw = buffer.toString("utf8");
  const entries = raw.split("\0");
  const paths: string[] = [];
  for (const entry of entries) {
    const normalized = normalizeRelativePath(entry);
    if (!normalized) {
      continue;
    }
    if (!paths.includes(normalized)) {
      paths.push(normalized);
    }
  }
  return paths;
}

export function runGitBuffer(workDir: string, args: string[]): {
  ok: boolean;
  stdout: Buffer;
  stderr: string;
} {
  const completed = spawnSync("git", args, {
    cwd: workDir,
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdout = completed.stdout instanceof Buffer
    ? completed.stdout
    : Buffer.from(String(completed.stdout ?? ""), "utf8");
  const stderr = completed.stderr instanceof Buffer
    ? completed.stderr.toString("utf8")
    : String(completed.stderr ?? "");
  return {
    ok: completed.status === 0,
    stdout,
    stderr,
  };
}

export function isGitRepository(workDir: string): boolean {
  const probe = runGitBuffer(workDir, ["rev-parse", "--is-inside-work-tree"]);
  return probe.ok && probe.stdout.toString("utf8").trim() === "true";
}

export function listDirtyPaths(workDir: string): string[] {
  const tracked = runGitBuffer(workDir, ["diff", "--name-only", "-z", "HEAD", "--"]);
  const untracked = runGitBuffer(workDir, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const paths = new Set<string>();
  if (tracked.ok) {
    for (const entry of parseNullSeparatedPathList(tracked.stdout)) {
      paths.add(entry);
    }
  }
  if (untracked.ok) {
    for (const entry of parseNullSeparatedPathList(untracked.stdout)) {
      paths.add(entry);
    }
  }
  return Array.from(paths.values()).sort((left, right) => left.localeCompare(right));
}
