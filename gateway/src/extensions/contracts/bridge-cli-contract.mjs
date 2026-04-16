import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

function runBridgeTurn(repoRoot, workDir, userMessage) {
  const input = JSON.stringify({
    userMessage,
    session: {
      platform: "feishu",
      tenant: "grobot",
      scope: "dm",
      subject: "bridge-contract-user",
    },
    context: {
      actorId: "contract",
      projectId: "grobot",
    },
    workDir,
  });
  const completed = spawnSync(
    "npx",
    ["--yes", "--package", "tsx@4.20.6", "tsx", "gateway/src/extensions/bridge-cli.ts"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      input,
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const exitCode = typeof completed.status === "number" ? completed.status : 1;
  const stdout = completed.stdout ?? "";
  const stderr = completed.stderr ?? "";
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const tail = lines[lines.length - 1] ?? "";
  let payload = null;
  if (tail.length > 0) {
    payload = JSON.parse(tail);
  }
  return {
    exit_code: exitCode,
    stdout,
    stderr,
    payload,
  };
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonFile(path) {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

function writeJsonFile(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function main() {
  const repoRoot = process.cwd();
  const workDir = mkdtempSync(resolve(tmpdir(), "grobot-bridge-contract-"));

  const noActive = runBridgeTurn(repoRoot, workDir, "/plan apply");
  assert.equal(noActive.exit_code, 1);
  assert.equal(isObject(noActive.payload), true);
  assert.equal(noActive.payload.status, "error");
  assert.equal(noActive.payload.error_code, "PLAN_NO_ACTIVE");

  const entered = runBridgeTurn(repoRoot, workDir, "/plan bridge error code contract smoke");
  assert.equal(entered.exit_code, 0);
  assert.equal(isObject(entered.payload), true);
  assert.equal(entered.payload.status, "ok");
  assert.equal(entered.payload.plan?.mode, "plan_only");
  assert.equal(typeof entered.payload.plan?.active_plan_id, "string");
  assert.equal(String(entered.payload.plan?.active_plan_id).length > 0, true);
  const activePlanPath = String(entered.payload.plan?.active_plan_path ?? "");
  assert.equal(activePlanPath.length > 0, true);
  const planId = String(entered.payload.plan?.active_plan_id ?? "");
  assert.equal(planId.length > 0, true);
  const planDir = dirname(activePlanPath);
  const lockPath = resolve(planDir, ".plan-artifact.lock");
  const indexPath = resolve(planDir, "index.json");

  const guarded = runBridgeTurn(repoRoot, workDir, "append note in bridge plan mode");
  assert.equal(guarded.exit_code, 0);
  assert.equal(isObject(guarded.payload), true);
  assert.equal(guarded.payload.status, "ok");
  assert.equal(guarded.payload.guard_code, "PLAN_GUARD_DENIED");
  assert.equal(guarded.payload.error_code, "PLAN_GUARD_DENIED");

  mkdirSync(lockPath, { recursive: false });
  const appendLockedFailure = runBridgeTurn(repoRoot, workDir, "append note while lock is held");
  rmSync(lockPath, { recursive: true, force: true });
  assert.equal(appendLockedFailure.exit_code, 1);
  assert.equal(isObject(appendLockedFailure.payload), true);
  assert.equal(appendLockedFailure.payload.status, "error");
  assert.equal(appendLockedFailure.payload.error_code, "PLAN_APPEND_NOTE_FAILED");

  const applyReviewFailure = runBridgeTurn(repoRoot, workDir, "/plan apply bridge-review-failure");
  assert.equal(applyReviewFailure.exit_code, 2);
  assert.equal(isObject(applyReviewFailure.payload), true);
  assert.equal(applyReviewFailure.payload.status, "error");
  assert.equal(
    applyReviewFailure.payload.error_code === "PLAN_REVIEW_FAILED" ||
      applyReviewFailure.payload.error_code === "PLAN_REVIEW_BLOCKED",
    true,
  );
  assert.equal(Number(applyReviewFailure.payload.plan?.review_fail_count) >= 1, true);

  const indexPayload = readJsonFile(indexPath);
  assert.equal(isObject(indexPayload), true);
  assert.equal(Array.isArray(indexPayload.entries), true);
  const nextEntries = indexPayload.entries.map((entry) => {
    if (!isObject(entry) || String(entry.plan_id ?? "") !== planId) {
      return entry;
    }
    return {
      ...entry,
      status: "discarded",
    };
  });
  writeJsonFile(indexPath, {
    ...indexPayload,
    active_plan_id: planId,
    entries: nextEntries,
  });

  const applyBlocked = runBridgeTurn(repoRoot, workDir, "/plan apply bridge-blocked");
  assert.equal(applyBlocked.exit_code, 1);
  assert.equal(isObject(applyBlocked.payload), true);
  assert.equal(applyBlocked.payload.status, "error");
  assert.equal(applyBlocked.payload.error_code, "PLAN_APPLY_STATUS_BLOCKED");

  const cancelled = runBridgeTurn(repoRoot, workDir, "/plan cancel");
  assert.equal(cancelled.exit_code, 0);
  assert.equal(isObject(cancelled.payload), true);
  assert.equal(cancelled.payload.status, "ok");

  const statusAfterCancel = runBridgeTurn(repoRoot, workDir, "/plan status");
  assert.equal(statusAfterCancel.exit_code, 0);
  assert.equal(isObject(statusAfterCancel.payload), true);
  assert.equal(statusAfterCancel.payload.status, "ok");
  assert.equal(statusAfterCancel.payload.plan?.mode, "normal");
  assert.equal(statusAfterCancel.payload.plan?.active_plan_id, undefined);

  const output = {
    ok: true,
    no_active_error_code: noActive.payload?.error_code ?? null,
    guard_error_code: guarded.payload?.error_code ?? null,
    append_note_error_code: appendLockedFailure.payload?.error_code ?? null,
    review_error_code: applyReviewFailure.payload?.error_code ?? null,
    review_fail_count: applyReviewFailure.payload?.plan?.review_fail_count ?? null,
    apply_blocked_error_code: applyBlocked.payload?.error_code ?? null,
    status_after_cancel_mode: statusAfterCancel.payload?.plan?.mode ?? null,
    status_after_cancel_active_plan_id: statusAfterCancel.payload?.plan?.active_plan_id ?? null,
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`bridge-cli-contract failed: ${message}\n`);
  process.exitCode = 1;
}
