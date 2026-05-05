import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

function runBridgeTurn(repoRoot, workDir, userMessage, envOverrides = {}) {
  const input = JSON.stringify({
    userMessage,
    session: {
      platform: "feishu",
      tenant: "grobot",
      scope: "dm",
      subject: "bridge-apply-failure-contract-user",
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
      env: {
        ...process.env,
        ...envOverrides,
      },
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

function buildValidPlanMarkdown() {
  const timestamp = new Date().toISOString();
  return [
    "# bridge apply failure contract plan",
    "",
    "- session_id: feishu:grobot:dm:bridge-apply-failure-contract-user",
    "- plan_id: p_contract_bridge_apply_failure",
    "- seq: 1",
    "- status: draft",
    `- created_at: ${timestamp}`,
    `- updated_at: ${timestamp}`,
    "",
    "## Goal",
    "",
    "验证 bridge 自然语言执行计划失败路径的 policy 字段输出。",
    "",
    "## Scope In",
    "",
    "- bridge-cli apply failure payload policy 字段与 event detail 断言。",
    "",
    "## Scope Out",
    "",
    "- 不修改 runtime provider 实际业务行为。",
    "",
    "## Context Snapshot",
    "",
    "- 通过不可执行 runtime binary 强制触发 apply 执行失败。",
    "",
    "## Milestones",
    "",
    "1. [ ] 构造可通过 review 的 plan 文档",
    "   - 完成判据: reviewPlanContent 返回通过。",
    "   - 验证: `Implement the plan.` 能进入执行阶段。",
    "   - 回退: 恢复原 plan 文件内容。",
    "",
    "## Validation",
    "",
    "- 执行 bridge-cli-contract apply 失败场景并断言 policy_action/policy_reason。",
    "",
    "## Risk & Rollback",
    "",
    "- 风险: 合同场景依赖 runtime 启动失败触发。",
    "- 回退: 删除本合同脚本并恢复既有 bridge-cli-contract 断言。",
    "",
    "## Decision Log",
    "",
    `- ${timestamp} 合同初始化。`,
    "",
    "## Plan Progress",
    "",
    `- ${timestamp} 生成可过审计划内容。`,
    "",
  ].join("\n");
}

const LEGACY_STATUS_MARKERS = [
  "[plan]",
  "[plan-status]",
  "plan_id=",
  "latest_failure=",
  "next_action=",
  "status=",
  "phase=",
];

function hidesLegacyStatusMarkers(value) {
  const text = String(value ?? "");
  return LEGACY_STATUS_MARKERS.every((marker) => !text.includes(marker));
}

function main() {
  const repoRoot = process.cwd();
  const workDir = mkdtempSync(resolve(tmpdir(), "grobot-bridge-apply-failure-contract-"));
  try {
    const entered = runBridgeTurn(repoRoot, workDir, "/plan bridge apply failure policy e2e");
    assert.equal(entered.exit_code, 0);
    assert.equal(isObject(entered.payload), true);
    assert.equal(entered.payload.status, "ok");
    const planPath = String(entered.payload.plan?.active_plan_path ?? "");
    assert.equal(planPath.length > 0, true);
    writeFileSync(planPath, `${buildValidPlanMarkdown()}\n`, "utf8");

    const runtimeFailEnv = {
      GROBOT_RUNTIME_BIN: resolve(workDir, "missing-runtime-binary"),
    };
    const applyFailure = runBridgeTurn(
      repoRoot,
      workDir,
      "Implement the plan.",
      runtimeFailEnv,
    );
    assert.equal(applyFailure.exit_code, 1);
    assert.equal(isObject(applyFailure.payload), true);
    assert.equal(applyFailure.payload.status, "error");
    assert.equal(applyFailure.payload.error_code, "PLAN_APPLY_EXEC_FAILED");
    assert.equal(applyFailure.payload.policy_action, "fail");
    assert.equal(
      applyFailure.payload.policy_reason === "provider_runtime_failure"
        || applyFailure.payload.policy_reason === "bridge_apply_exec_timeout"
        || applyFailure.payload.policy_reason === "bridge_apply_exec_failed",
      true,
    );
    assert.equal(
      applyFailure.payload.diagnostic_code === "BRIDGE_SEMANTIC_CONTEXT_UNAVAILABLE"
        || applyFailure.payload.diagnostic_code === "BRIDGE_PROVIDER_RUNTIME_FAILURE"
        || applyFailure.payload.diagnostic_code === "BRIDGE_APPLY_EXEC_TIMEOUT"
        || applyFailure.payload.diagnostic_code === "BRIDGE_APPLY_EXEC_FAILED",
      true,
    );
    assert.equal(applyFailure.payload.plan?.active_plan_status, "apply_failed");
    assert.equal(applyFailure.payload.plan?.active_plan_phase, "awaiting_decision");

    const statusAfterApplyFailure = runBridgeTurn(repoRoot, workDir, "/plan open");
    assert.equal(statusAfterApplyFailure.exit_code, 0);
    assert.equal(isObject(statusAfterApplyFailure.payload), true);
    assert.equal(statusAfterApplyFailure.payload.status, "ok");
    assert.equal(statusAfterApplyFailure.payload.plan?.latest_failure_event, "plan_apply_failed");
    assert.equal(
      statusAfterApplyFailure.payload.plan?.latest_failure_diagnostic_code === "BRIDGE_SEMANTIC_CONTEXT_UNAVAILABLE"
        || statusAfterApplyFailure.payload.plan?.latest_failure_diagnostic_code === "BRIDGE_PROVIDER_RUNTIME_FAILURE"
        || statusAfterApplyFailure.payload.plan?.latest_failure_diagnostic_code === "BRIDGE_APPLY_EXEC_TIMEOUT"
        || statusAfterApplyFailure.payload.plan?.latest_failure_diagnostic_code === "BRIDGE_APPLY_EXEC_FAILED",
      true,
    );
    const statusAfterApplyFailureMessage = String(statusAfterApplyFailure.payload.assistant_message ?? "");
    assert.equal(statusAfterApplyFailureMessage.includes("Current plan"), true);
    assert.equal(statusAfterApplyFailureMessage.includes("latest failure Plan apply failed"), true);
    assert.equal(hidesLegacyStatusMarkers(statusAfterApplyFailureMessage), true);

    const eventsPath = resolve(dirname(planPath), "events.jsonl");
    const eventsRaw = readFileSync(eventsPath, "utf8");
    assert.equal(eventsRaw.includes("\"event\":\"plan_apply_failed\""), true);
    assert.equal(eventsRaw.includes("policy_action=fail"), true);
    assert.equal(eventsRaw.includes("policy_reason="), true);
    assert.equal(eventsRaw.includes("diagnostic_code="), true);

    const payload = {
      ok: true,
      apply_failure_error_code: applyFailure.payload?.error_code ?? null,
      apply_failure_policy_action: applyFailure.payload?.policy_action ?? null,
      apply_failure_policy_reason: applyFailure.payload?.policy_reason ?? null,
      apply_failure_diagnostic_code: applyFailure.payload?.diagnostic_code ?? null,
      apply_failure_error_class_type:
        applyFailure.payload?.error_class == null ? "nullish" : typeof applyFailure.payload?.error_class,
      apply_failure_provider_type:
        applyFailure.payload?.provider == null ? "nullish" : typeof applyFailure.payload?.provider,
      apply_failure_plan_status: applyFailure.payload?.plan?.active_plan_status ?? null,
      apply_failure_plan_phase: applyFailure.payload?.plan?.active_plan_phase ?? null,
      status_latest_failure_event: statusAfterApplyFailure.payload?.plan?.latest_failure_event ?? null,
      status_latest_failure_diagnostic_code:
        statusAfterApplyFailure.payload?.plan?.latest_failure_diagnostic_code ?? null,
      status_after_failure_assistant_message_human:
        statusAfterApplyFailureMessage.includes("Current plan")
        && statusAfterApplyFailureMessage.includes("latest failure Plan apply failed"),
      status_after_failure_assistant_message_hides_machine_fields:
        hidesLegacyStatusMarkers(statusAfterApplyFailureMessage),
      events_has_plan_apply_failed: eventsRaw.includes("\"event\":\"plan_apply_failed\""),
      events_has_policy_action: eventsRaw.includes("policy_action=fail"),
      events_has_policy_reason: eventsRaw.includes("policy_reason="),
      events_has_diagnostic_code: eventsRaw.includes("diagnostic_code="),
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; flaky temp-dir removal should not fail the contract itself.
    }
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`bridge-plan-apply-failure-contract failed: ${message}\n`);
  process.exitCode = 1;
}
