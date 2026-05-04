export function extractRecentRows(prompt: string): number {
  const lines = prompt.split(/\r?\n/);
  const recentHeaderIndex = lines.findIndex((line) => line.trim() === "[Recent Turns]");
  const userHeaderIndex = lines.findIndex((line) => line.trim() === "[Current User Message]");
  if (recentHeaderIndex < 0 || userHeaderIndex <= recentHeaderIndex + 1) {
    return 0;
  }
  const rows = lines.slice(recentHeaderIndex + 1, userHeaderIndex);
  let count = 0;
  for (const row of rows) {
    const normalized = row.trim().toLowerCase();
    if (normalized.startsWith("user:") || normalized.startsWith("assistant:")) {
      count += 1;
    }
  }
  return count;
}

export function extractSnapshotSectionTitles(prompt: string): string[] {
  const lines = prompt.split(/\r?\n/);
  const snapshotHeaderIndex = lines.findIndex((line) => line.trim() === "[Compact Context Snapshot v2]");
  if (snapshotHeaderIndex < 0) {
    return [];
  }
  const recentHeaderIndex = lines.findIndex((line) => line.trim() === "[Recent Turns]");
  const userHeaderIndex = lines.findIndex((line) => line.trim() === "[Current User Message]");
  const tailIndexCandidates = [recentHeaderIndex, userHeaderIndex].filter((value) => value >= 0);
  const snapshotTailIndex = tailIndexCandidates.length > 0
    ? Math.min(...tailIndexCandidates)
    : lines.length;
  const titles: string[] = [];
  for (let index = snapshotHeaderIndex + 1; index < snapshotTailIndex; index += 1) {
    const trimmed = lines[index]?.trim() ?? "";
    const match = trimmed.match(/^\[(.+)\]$/);
    if (!match || typeof match[1] !== "string") {
      continue;
    }
    titles.push(match[1].trim());
  }
  return titles;
}
