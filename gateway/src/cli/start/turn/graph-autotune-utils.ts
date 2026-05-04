function normalizePathForPrefix(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function isWorkDirWithinRepoRoot(workDir: string, rootPath?: string): boolean {
  if (!rootPath || rootPath.trim().length === 0) {
    return false;
  }
  const normalizedRoot = normalizePathForPrefix(rootPath.trim());
  const normalizedWorkDir = normalizePathForPrefix(workDir.trim());
  if (!normalizedRoot || !normalizedWorkDir) {
    return false;
  }
  return normalizedWorkDir === normalizedRoot || normalizedWorkDir.startsWith(`${normalizedRoot}/`);
}

export function formatOptionalMetric(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "<none>";
  }
  return value.toFixed(3);
}
