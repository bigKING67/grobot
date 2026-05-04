import { removeTrailingSlashes } from "../../services/runtime-paths";
import { sanitizeSegment } from "./fs-utils";
import type { PlanArtifactEntry } from "./types";

export function sessionPlanDir(workDir: string, sessionId: string): string {
  const root = removeTrailingSlashes(workDir);
  const safeSessionId = sanitizeSegment(sessionId, "main", 64);
  return `${root}/.grobot/plans/${safeSessionId}`;
}

export function planLockPath(workDir: string, sessionId: string): string {
  return `${sessionPlanDir(workDir, sessionId)}/.plan-artifact.lock`;
}

export function planIndexPath(workDir: string, sessionId: string): string {
  return `${sessionPlanDir(workDir, sessionId)}/index.json`;
}

export function activePlanPath(workDir: string, sessionId: string): string {
  return `${sessionPlanDir(workDir, sessionId)}/ACTIVE.md`;
}

export function planEventsPath(workDir: string, sessionId: string): string {
  return `${sessionPlanDir(workDir, sessionId)}/events.jsonl`;
}

export function planPathFromEntry(workDir: string, sessionId: string, entry: PlanArtifactEntry): string {
  return `${sessionPlanDir(workDir, sessionId)}/${entry.filename}`;
}
