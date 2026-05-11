import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnTsxSync } from "./_shared/run-tsx-script.mjs";

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runBridgeTurn(repoRoot, workDir, userMessage, options = {}) {
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
  const completed = spawnTsxSync("gateway/src/extensions/bridge-cli.ts", [], {
    cwd: repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    input,
  });
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
    "- node gateway/src/extensions/contracts/bridge-cli-contract.mjs；预期: exit 0 且 recommended_next_action 断言通过。",
    "",
    "## Risk & Rollback",
    "",
    "- 风险: 状态页与持久化状态出现短暂漂移。",
    "- 回退: 保留 stored_status 并恢复旧 active_plan_status 映射。",
    "",
  ].join("\n");
}

const LEGACY_PLAN_SURFACE_MARKERS = [
  "[plan]",
  "[plan-status]",
  "[plan-guard]",
  "plan_id=",
  "file=",
  "latest_failure=",
  "next_action=",
  "●",
];

function hidesLegacyPlanSurfaceMarkers(value) {
  const text = String(value ?? "");
  return LEGACY_PLAN_SURFACE_MARKERS.every((marker) => !text.includes(marker));
}

function main() {
  const repoRoot = process.cwd();
  const workDir = mkdtempSync(resolve(tmpdir(), "grobot-bridge-contract-"));

  try {
    const invalidGuardMode = runBridgeTurn(repoRoot, workDir, "/plan open", {
      env: { GROBOT_PLAN_QUALITY_GUARD_MODE: "banana" },
    });
    assert.equal(invalidGuardMode.exit_code, 2);
    assert.equal(isObject(invalidGuardMode.payload), true);
    assert.equal(invalidGuardMode.payload.status, "error");
    assert.equal(invalidGuardMode.payload.error_code, "invalid_plan_quality_guard_mode");
    assert.equal(invalidGuardMode.payload.field, "plan-quality-guard-mode");
    const emptyGuardMode = runBridgeTurn(repoRoot, workDir, "/plan open", {
      env: { GROBOT_PLAN_QUALITY_GUARD_MODE: "   " },
    });
    assert.equal(emptyGuardMode.exit_code, 2);
    assert.equal(isObject(emptyGuardMode.payload), true);
    assert.equal(emptyGuardMode.payload.status, "error");
    assert.equal(emptyGuardMode.payload.error_code, "invalid_plan_quality_guard_mode");
    assert.equal(emptyGuardMode.payload.field, "plan-quality-guard-mode");

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
    assert.equal(enteredHint.includes("Plan mode entered"), true);
    assert.equal(enteredHint.includes("Plan mode stays read-only until approval."), true);
    assert.equal(enteredHint.includes("Type more details to refine"), true);
    assert.equal(enteredHint.includes("/plan open"), true);
    assert.equal(enteredHint.includes("Implement the plan."), true);
    assert.equal(hidesLegacyPlanSurfaceMarkers(enteredHint), true);
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
    const openWithPlanMessage = String(openWithPlan.payload.assistant_message ?? "");
    assert.equal(openWithPlanMessage.includes("Current plan"), true);
    assert.equal(openWithPlanMessage.includes("status Awaiting approval"), true);
    assert.equal(openWithPlanMessage.includes("phase Awaiting approval"), true);
    assert.equal(openWithPlanMessage.includes("next Implement the plan."), true);
    assert.equal(openWithPlanMessage.includes("status:"), false);
    assert.equal(openWithPlanMessage.includes("phase:"), false);
    assert.equal(openWithPlanMessage.includes("Next:"), false);
    assert.equal(hidesLegacyPlanSurfaceMarkers(openWithPlanMessage), true);

    const guarded = runBridgeTurn(repoRoot, workDir, "append note in bridge plan mode");
    assert.equal(guarded.exit_code, 0);
    assert.equal(isObject(guarded.payload), true);
    assert.equal(guarded.payload.status, "ok");
    assert.equal(guarded.payload.error_code, "PLAN_GUARD_DENIED");
    assert.equal(guarded.payload.guard_code, "PLAN_GUARD_DENIED");
    assert.equal(guarded.payload.plan?.mode, "plan_only");
    assert.equal(guarded.payload.plan?.active_plan_id, enteredPlanId);
    const guardedMessage = String(guarded.payload.assistant_message ?? "");
    assert.equal(guardedMessage.includes("Added to current plan"), true);
    assert.equal(guardedMessage.includes("no code was executed"), true);
    assert.equal(hidesLegacyPlanSurfaceMarkers(guardedMessage), true);

    const output = {
      ok: true,
      open_without_plan_mode: openWithoutPlan.payload?.plan?.mode ?? null,
      open_without_plan_recommended_next_action:
        openWithoutPlan.payload?.recommended_next_action ?? null,
      entered_plan_mode: entered.payload?.plan?.mode ?? null,
      entered_plan_id: enteredPlanId,
      entered_hint_lists_current_surface:
        enteredHint.includes("Type more details to refine")
        && enteredHint.includes("/plan open")
        && enteredHint.includes("Implement the plan."),
      entered_hint_is_human_surface:
        enteredHint.includes("Plan mode entered")
        && enteredHint.includes("Plan mode stays read-only until approval."),
      entered_hint_hides_machine_fields: hidesLegacyPlanSurfaceMarkers(enteredHint),
      open_with_plan_keeps_active_plan: openWithPlan.payload?.plan?.active_plan_id === enteredPlanId,
      open_with_plan_recommended_next_action:
        openWithPlan.payload?.recommended_next_action ?? null,
      open_with_plan_live_phase: openWithPlan.payload?.plan?.active_plan_phase ?? null,
      open_with_plan_live_status: openWithPlan.payload?.plan?.active_plan_status ?? null,
      open_with_plan_status_source: openWithPlan.payload?.plan?.active_plan_status_source ?? null,
      open_with_plan_stored_status: openWithPlan.payload?.plan?.active_plan_stored_status ?? null,
      open_with_plan_assistant_message_human:
        openWithPlanMessage.includes("Current plan")
        && openWithPlanMessage.includes("status Awaiting approval")
        && openWithPlanMessage.includes("phase Awaiting approval")
        && openWithPlanMessage.includes("next Implement the plan.")
        && !openWithPlanMessage.includes("Next:"),
      open_with_plan_assistant_message_hides_machine_fields:
        hidesLegacyPlanSurfaceMarkers(openWithPlanMessage),
      guard_error_code: guarded.payload?.error_code ?? null,
      guard_code: guarded.payload?.guard_code ?? null,
      guard_mode_after_note: guarded.payload?.plan?.mode ?? null,
      guard_assistant_message_human:
        guardedMessage.includes("Added to current plan")
        && guardedMessage.includes("no code was executed"),
      guard_assistant_message_hides_machine_fields:
        hidesLegacyPlanSurfaceMarkers(guardedMessage),
      invalid_guard_mode_exit_code: invalidGuardMode.exit_code,
      invalid_guard_mode_error_code: invalidGuardMode.payload?.error_code ?? null,
      invalid_guard_mode_field: invalidGuardMode.payload?.field ?? null,
      empty_guard_mode_exit_code: emptyGuardMode.exit_code,
      empty_guard_mode_error_code: emptyGuardMode.payload?.error_code ?? null,
      empty_guard_mode_field: emptyGuardMode.payload?.field ?? null,
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
