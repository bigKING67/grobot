import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  assertSuccess,
  logRetry,
  logStep,
  repoRoot,
  runCommand,
  sleepMs,
} from "../harness.mjs";

const RUNTIME_EXE_SUFFIX = process.platform === "win32" ? ".exe" : "";
const RUNTIME_BINARY_PATH = resolve(repoRoot, "runtime/target/debug", `grobot-runtime${RUNTIME_EXE_SUFFIX}`);
const RUNTIME_BUILD_LOCK_DIR = resolve(repoRoot, "runtime/target/debug/.grobot-runtime-build.lock");
const RUNTIME_BUILD_LOCK_STALE_MS = 5 * 60 * 1000;
const RUNTIME_BUILD_LOCK_WAIT_MS = 2 * 60 * 1000;
const RUNTIME_BUILD_LOCK_POLL_MS = 200;

function statMtimeMs(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function maxMtimeMs(path) {
  if (!existsSync(path)) {
    return 0;
  }
  const stat = statSync(path);
  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }
  let max = stat.mtimeMs;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name === "target") {
      continue;
    }
    max = Math.max(max, maxMtimeMs(join(path, entry.name)));
  }
  return max;
}

function runtimeSourceMtimeMs() {
  return Math.max(
    statMtimeMs(resolve(repoRoot, "runtime/Cargo.toml")),
    statMtimeMs(resolve(repoRoot, "runtime/Cargo.lock")),
    maxMtimeMs(resolve(repoRoot, "runtime/src")),
  );
}

function runtimeBinaryFreshness() {
  if (!existsSync(RUNTIME_BINARY_PATH)) {
    return {
      binaryMtimeMs: 0,
      fresh: false,
      sourceMtimeMs: runtimeSourceMtimeMs(),
    };
  }
  const binaryMtimeMs = statMtimeMs(RUNTIME_BINARY_PATH);
  const sourceMtimeMs = runtimeSourceMtimeMs();
  return {
    binaryMtimeMs,
    fresh: binaryMtimeMs >= sourceMtimeMs,
    sourceMtimeMs,
  };
}

function removeStaleBuildLock() {
  const lockMtimeMs = statMtimeMs(RUNTIME_BUILD_LOCK_DIR);
  if (!lockMtimeMs || Date.now() - lockMtimeMs < RUNTIME_BUILD_LOCK_STALE_MS) {
    return false;
  }
  rmSync(RUNTIME_BUILD_LOCK_DIR, { recursive: true, force: true });
  return true;
}

async function acquireRuntimeBuildLock() {
  mkdirSync(dirname(RUNTIME_BUILD_LOCK_DIR), { recursive: true });
  const startedAt = Date.now();
  for (;;) {
    const freshness = runtimeBinaryFreshness();
    if (freshness.fresh) {
      return {
        acquired: false,
        freshness,
        waitedMs: Date.now() - startedAt,
      };
    }
    try {
      mkdirSync(RUNTIME_BUILD_LOCK_DIR);
      return {
        acquired: true,
        freshness,
        waitedMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      const removedStaleLock = removeStaleBuildLock();
      if (removedStaleLock) {
        logRetry("runtime build lock", 1, 1, "removed stale runtime build lock");
        continue;
      }
      if (Date.now() - startedAt > RUNTIME_BUILD_LOCK_WAIT_MS) {
        throw new Error(`timed out waiting for runtime build lock: ${RUNTIME_BUILD_LOCK_DIR}`);
      }
      await sleepMs(RUNTIME_BUILD_LOCK_POLL_MS);
    }
  }
}

export async function ensureFreshRuntimeBinary() {
  const freshness = runtimeBinaryFreshness();
  if (freshness.fresh) {
    logStep("runtime build for ts-rust smoke", {
      binary_mtime_ms: Math.trunc(freshness.binaryMtimeMs),
      skipped: "fresh",
      source_mtime_ms: Math.trunc(freshness.sourceMtimeMs),
    });
    return;
  }

  const lock = await acquireRuntimeBuildLock();
  if (!lock.acquired) {
    logStep("runtime build for ts-rust smoke", {
      binary_mtime_ms: Math.trunc(lock.freshness.binaryMtimeMs),
      skipped: "built-by-peer",
      source_mtime_ms: Math.trunc(lock.freshness.sourceMtimeMs),
      wait_ms: lock.waitedMs,
    });
    return;
  }

  try {
    const afterLockFreshness = runtimeBinaryFreshness();
    if (afterLockFreshness.fresh) {
      logStep("runtime build for ts-rust smoke", {
        binary_mtime_ms: Math.trunc(afterLockFreshness.binaryMtimeMs),
        skipped: "fresh-after-lock",
        source_mtime_ms: Math.trunc(afterLockFreshness.sourceMtimeMs),
        wait_ms: lock.waitedMs,
      });
      return;
    }
    const runtimeBuildResult = runCommand("cargo", ["build", "--manifest-path", "runtime/Cargo.toml"], {
      timeoutMs: 240_000,
    });
    assertSuccess("runtime build for ts-rust smoke", runtimeBuildResult);
    logStep("runtime build for ts-rust smoke", { wait_ms: lock.waitedMs });
  } finally {
    rmSync(RUNTIME_BUILD_LOCK_DIR, { recursive: true, force: true });
  }
}
