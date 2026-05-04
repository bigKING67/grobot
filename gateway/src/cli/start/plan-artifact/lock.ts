import { mkdirSync, rmSync, statSync } from "node:fs";
import {
  PLAN_LOCK_STALE_MS,
  PLAN_LOCK_TIMEOUT_MS,
  PLAN_LOCK_WAIT_MS,
} from "./constants";
import {
  planLockPath,
  sessionPlanDir,
} from "./paths";

const SLEEP_SIGNAL = new Int32Array(new SharedArrayBuffer(4));

function sleepBlocking(ms: number): void {
  Atomics.wait(SLEEP_SIGNAL, 0, 0, ms);
}

function lockAgeMs(lockPath: string, nowMs: number): number | undefined {
  try {
    const stats = statSync(lockPath);
    return nowMs - stats.mtimeMs;
  } catch {
    return undefined;
  }
}

export function withSessionPlanLock<T>(workDir: string, sessionId: string, task: () => T): T {
  mkdirSync(sessionPlanDir(workDir, sessionId), { recursive: true });
  const lockPath = planLockPath(workDir, sessionId);
  const deadline = Date.now() + PLAN_LOCK_TIMEOUT_MS;
  while (true) {
    try {
      mkdirSync(lockPath, { recursive: false });
      break;
    } catch (error) {
      const errno = error as Error & { code?: string };
      if (errno.code !== "EEXIST") {
        throw error;
      }
      const nowMs = Date.now();
      const age = lockAgeMs(lockPath, nowMs);
      if (typeof age === "number" && age > PLAN_LOCK_STALE_MS) {
        try {
          rmSync(lockPath, { recursive: true, force: true });
        } catch {
          // Stale-lock cleanup is best effort; retry acquisition below.
        }
      }
      if (nowMs >= deadline) {
        throw new Error(`plan artifact lock timeout: ${lockPath}`);
      }
      sleepBlocking(PLAN_LOCK_WAIT_MS);
    }
  }
  try {
    return task();
  } finally {
    try {
      rmSync(lockPath, { recursive: true, force: true });
    } catch {
      // Lock cleanup is best effort; callers should not fail after the task ran.
    }
  }
}
