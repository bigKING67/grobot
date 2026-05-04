import type { RewindFileRecord } from "./contract";
import { normalizeRelativePath } from "./paths";

export function filterFilesByInput(
  changedFiles: readonly RewindFileRecord[],
  fileFilter?: readonly string[],
): {
  selected: RewindFileRecord[];
  skipped: string[];
} {
  if (!Array.isArray(fileFilter) || fileFilter.length === 0) {
    return {
      selected: [...changedFiles],
      skipped: [],
    };
  }
  const normalizedFilter = new Set<string>();
  for (const item of fileFilter) {
    const normalized = normalizeRelativePath(item);
    if (normalized) {
      normalizedFilter.add(normalized);
    }
  }
  if (normalizedFilter.size === 0) {
    return {
      selected: [],
      skipped: changedFiles.map((item) => item.path),
    };
  }
  const selected: RewindFileRecord[] = [];
  const skipped: string[] = [];
  for (const item of changedFiles) {
    if (normalizedFilter.has(item.path)) {
      selected.push(item);
    } else {
      skipped.push(item.path);
    }
  }
  return {
    selected,
    skipped,
  };
}
