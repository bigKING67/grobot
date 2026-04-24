import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
  const payload = tail.length > 0 ? JSON.parse(tail) : null;
  return {
    exit_code: exitCode,
    stdout,
    stderr,
    payload,
  };
}

function buildValidPlanMarkdown() {
  return [
    "# Bridge Live Snapshot Plan",
    "",
    "- session_id: feishu:grobot:dm:bridge-contract-user",
    "- plan_id: p_bridge_live_snapshot",
    "- seq: 1",
    "- status: draft",
    "",
    "## Goal",
    "",
    "验证 bridge status 会基于当前 plan 文件做 live decision snapshot。",
    "",
    "## Scope In",
    "",
    "- 外部直接改 plan 文件后，/plan open 立即切到待决策态。",
    "- recommended_next_action 直接变成 Implement the plan.",
    "",
    "## Scope Out",
    "",
    "- 不覆盖 runtime 执行路径。",
    "",
    "## Milestones",
    "",
    "1. [ ] 让 bridge plan status 基于当前文件即时计算决策态",
    "   - 完成判据: /plan open 返回 awaiting_decision。",
    "   - 验证: recommended_next_action = Implement the plan.",
    "   - 回退: 恢复旧状态解析并重新评估 live snapshot 方案。",
    "",
    "## Validation",
    "",
    "- node gateway/src/extensions/contracts/bridge-cli-contract.mjs",
    "",
    "## Risk & Rollback",
    "",
    "- 风险: 状态页与持久化状态出现短暂漂移。",
    "- 回退: 保留 stored_status 并恢复旧 active_plan_status 映射。",
    "",
  ].join("\n");
}

function main() {
  const repoRoot = process.cwd();
  const workDir = mkdtempSync(resolve(tmpdir(), "grobot-bridge-contract-"));

  try {
    const openWithoutPlan = runBridgeTurn(repoRoot, workDir, "/plan open");
    assert.equal(openWithoutPlan.exit_code, 0);
    assert.equal(isObject(openWithoutPlan.payload), true);
    assert.equal(openWithoutPlan.payload.status, "ok");
    assert.equal(openWithoutPlan.payload.plan?.mode, "normal");
    assert.equal(typeof openWithoutPlan.payload.recommended_next_action, "string");
    assert.equal(String(openWithoutPlan.payload.recommended_next_action).length > 0, true);

    const entered = runBridgeTurn(repoRoot, workDir, "/plan bridge contract simplify surface");
    assert.equal(entered.exit_code, 0);
    assert.equal(isObject(entered.payload), true);
    assert.equal(entered.payload.status, "ok");
    assert.equal(entered.payload.plan?.mode, "plan_only");
    assert.equal(typeof entered.payload.plan?.active_plan_id, "string");
    assert.equal(String(entered.payload.plan?.active_plan_id).length > 0, true);
    assert.equal(typeof entered.payload.plan?.active_plan_path, "string");
    assert.equal(String(entered.payload.plan?.active_plan_path).length > 0, true);

    const enteredPlanId = String(entered.payload.plan.active_plan_id);
    const enteredHint = String(entered.payload.assistant_message ?? "");
    assert.equal(enteredHint.includes("/plan"), true);
    assert.equal(enteredHint.includes("/plan <goal>"), true);
    assert.equal(enteredHint.includes("/plan open"), true);
    assert.equal(enteredHint.includes("Implement the plan."), true);
    writeFileSync(String(entered.payload.plan.active_plan_path), `${buildValidPlanMarkdown()}\n`, "utf8");

    const openWithPlan = runBridgeTurn(repoRoot, workDir, "/plan open");
    assert.equal(openWithPlan.exit_code, 0);
    assert.equal(isObject(openWithPlan.payload), true);
    assert.equal(openWithPlan.payload.status, "ok");
    assert.equal(openWithPlan.payload.plan?.mode, "plan_only");
    assert.equal(openWithPlan.payload.plan?.active_plan_id, enteredPlanId);
    assert.equal(openWithPlan.payload.plan?.active_plan_phase, "awaiting_decision");
    assert.equal(openWithPlan.payload.plan?.active_plan_status, "ready");
    assert.equal(openWithPlan.payload.plan?.active_plan_status_source, "live_snapshot");
    assert.equal(openWithPlan.payload.plan?.active_plan_stored_status, "draft");
    assert.equal(openWithPlan.payload.plan?.active_plan_decision_ready, true);
    assert.equal(openWithPlan.payload.recommended_next_action, "Implement the plan.");

    const guarded = runBridgeTurn(repoRoot, workDir, "append note in bridge plan mode");
    assert.equal(guarded.exit_code, 0);
    assert.equal(isObject(guarded.payload), true);
    assert.equal(guarded.payload.status, "ok");
    assert.equal(guarded.payload.error_code, "PLAN_GUARD_DENIED");
    assert.equal(guarded.payload.guard_code, "PLAN_GUARD_DENIED");
    assert.equal(guarded.payload.plan?.mode, "plan_only");
    assert.equal(guarded.payload.plan?.active_plan_id, enteredPlanId);

    const output = {
      ok: true,
      open_without_plan_mode: openWithoutPlan.payload?.plan?.mode ?? null,
      open_without_plan_recommended_next_action:
        openWithoutPlan.payload?.recommended_next_action ?? null,
      entered_plan_mode: entered.payload?.plan?.mode ?? null,
      entered_plan_id: enteredPlanId,
      entered_hint_lists_current_surface:
        enteredHint.includes("/plan <goal>")
        && enteredHint.includes("/plan open")
        && enteredHint.includes("Implement the plan."),
      open_with_plan_keeps_active_plan: openWithPlan.payload?.plan?.active_plan_id === enteredPlanId,
      open_with_plan_recommended_next_action:
        openWithPlan.payload?.recommended_next_action ?? null,
      open_with_plan_live_phase: openWithPlan.payload?.plan?.active_plan_phase ?? null,
      open_with_plan_live_status: openWithPlan.payload?.plan?.active_plan_status ?? null,
      open_with_plan_status_source: openWithPlan.payload?.plan?.active_plan_status_source ?? null,
      open_with_plan_stored_status: openWithPlan.payload?.plan?.active_plan_stored_status ?? null,
      guard_error_code: guarded.payload?.error_code ?? null,
      guard_code: guarded.payload?.guard_code ?? null,
      guard_mode_after_note: guarded.payload?.plan?.mode ?? null,
    };
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  const detail = error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
  process.stderr.write(`bridge-cli-contract failed: ${detail}\n`);
  process.exitCode = 1;
}
