import { readFileSync } from "node:fs";

export function parseApprovedPlanContent(
  snapshotPath: string | undefined,
  fallback: string,
): string {
  if (!snapshotPath) {
    return fallback;
  }
  try {
    const snapshot = readFileSync(snapshotPath, "utf8");
    if (snapshot.trim().length > 0) {
      return snapshot;
    }
  } catch {
    // Keep fallback content when the approved snapshot file is unavailable.
  }
  return fallback;
}
