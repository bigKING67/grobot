import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

function runBenchmark(repoRoot, args = []) {
  const completed = spawnSync(
    "npx",
    [
      "--yes",
      "--package",
      "tsx@4.20.6",
      "tsx",
      "gateway/src/governance/evals/plan-quality-benchmark.ts",
      ...args,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return {
    code: typeof completed.status === "number" ? completed.status : 1,
    stdout: completed.stdout ?? "",
    stderr: completed.stderr ?? "",
  };
}

function parseJsonOutput(stdout, label) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const tail = lines[lines.length - 1] ?? "";
  assert.equal(tail.length > 0, true, `${label} stdout is empty`);
  return JSON.parse(tail);
}

function writePlanFixtures(tempRoot) {
  const strongPath = resolve(tempRoot, "strong-plan.md");
  const weakPath = resolve(tempRoot, "weak-plan.md");
  const strongPlan = [
    "# Strong Plan",
    "",
    "## Goal",
    "- 把计划质量守门策略外置并接入 status / bridge / report。",
    "",
    "## Scope In",
    "- gateway plan artifact / plan status / bridge payload / contracts。",
    "",
    "## Scope Out",
    "- 不改 runtime 执行层。",
    "",
    "## Milestones",
    "1. [ ] 增加 policy 解析与阈值映射",
    "   - 完成判据: status 输出 profile/source/path。",
    "   - 验证: `npm run check:gateway:ts`。",
    "   - 回退: 恢复策略读取旧逻辑。",
    "2. [ ] 增加 bridge payload 与 contract",
    "   - 完成判据: bridge status 输出 repair actions。",
    "   - 验证: `node gateway/src/extensions/contracts/bridge-cli-contract.mjs`。",
    "   - 回退: 删除新增字段与断言。",
    "",
    "## Validation",
    "- npm run check:gateway:ts；预期: exit 0 且 TypeScript 无报错。",
    "- node gateway/src/extensions/contracts/bridge-cli-contract.mjs；预期: exit 0 且 bridge payload 断言通过。",
    "",
    "## Risk & Rollback",
    "- 风险: 策略文件损坏导致 guard 误判。",
    "- 回退: fallback 到内置默认策略并输出 warning。",
  ].join("\n");
  const weakPlan = [
    "# Weak Plan",
    "",
    "## Goal",
    "- 后面再补。",
    "",
    "## Scope In",
    "- __REQUIRED__",
    "",
    "## Milestones",
    "- TODO",
  ].join("\n");
  writeFileSync(strongPath, `${strongPlan}\n`, "utf8");
  writeFileSync(weakPath, `${weakPlan}\n`, "utf8");
  return {
    strongPath,
    weakPath,
  };
}

function main() {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(resolve(tmpdir(), "plan-quality-benchmark-contract-"));
  try {
    const fixture = writePlanFixtures(tempRoot);
    const base = runBenchmark(repoRoot, [
      "--plan",
      `strong=${fixture.strongPath}`,
      "--plan",
      `weak=${fixture.weakPath}`,
      "--print-json",
    ]);
    assert.equal(base.code, 0, `benchmark base failed: ${base.stderr}`);
    const basePayload = parseJsonOutput(base.stdout, "base");
    assert.equal(basePayload.status, "ok");
    assert.equal(basePayload.winner_label, "strong");
    assert.equal(Number(basePayload.compared_count), 2);
    assert.equal(Array.isArray(basePayload.rows), true);
    assert.equal(basePayload.rows[0]?.label, "strong");
    assert.equal(Number(basePayload.rows[0]?.score) > Number(basePayload.rows[1]?.score), true);
    assert.equal(
      Number(basePayload.rows[0]?.repair_action_count) <= Number(basePayload.rows[1]?.repair_action_count),
      true,
    );
    assert.equal(
      basePayload.guard_policy_profile === "prod"
        || basePayload.guard_policy_profile === "dev"
        || basePayload.guard_policy_profile === "ci",
      true,
    );
    const assertFail = runBenchmark(repoRoot, [
      "--plan",
      `strong=${fixture.strongPath}`,
      "--plan",
      `weak=${fixture.weakPath}`,
      "--assert-best",
      "weak",
      "--print-json",
    ]);
    assert.equal(assertFail.code, 2);
    const assertFailPayload = parseJsonOutput(assertFail.stdout, "assertFail");
    assert.equal(assertFailPayload.status, "error");
    assert.equal(assertFailPayload.error_code, "PLAN_BENCHMARK_ASSERT_BEST_FAILED");
    assert.equal(assertFailPayload.expected_best, "weak");
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        winner_label: basePayload.winner_label,
        winner_score: basePayload.winner_score,
        compared_count: basePayload.compared_count,
        assert_best_fail_code: assertFailPayload.error_code,
      })}\n`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`plan-quality-benchmark-contract failed: ${message}\n`);
  process.exitCode = 1;
}
