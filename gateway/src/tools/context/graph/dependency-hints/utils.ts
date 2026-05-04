export function clampInteger(value: number, fallback: number, min: number, max: number): number {
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

export function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

export function normalizePath(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
}

export function getDirPath(filePath: string): string {
  const normalized = normalizePath(filePath);
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

export function stripTrailingSlash(rawPath: string): string {
  if (!rawPath) {
    return rawPath;
  }
  return rawPath.replace(/\/+$/, "");
}

export function dedupeRows(rows: readonly string[], maxRows?: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const row of rows) {
    const normalized = row.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
    if (typeof maxRows === "number" && output.length >= maxRows) {
      break;
    }
  }
  return output;
}

export function countPathTokenMatches(path: string, queryTokens: ReadonlySet<string>): number {
  if (queryTokens.size === 0) {
    return 0;
  }
  const pathTokens = new Set(tokenize(path));
  let matched = 0;
  for (const token of queryTokens) {
    if (pathTokens.has(token)) {
      matched += 1;
    }
  }
  return matched;
}
