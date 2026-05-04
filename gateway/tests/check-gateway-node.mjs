#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { runGatewayContractSmoke } from "./check-gateway-node/gateway-contract-smoke.mjs";
import { runTsRustExecutionSmoke } from "./check-gateway-node/runtime-smoke.mjs";
import {
  assertSuccess,
  contractsRoot,
  createRunReporter,
  emitJsonReport,
  enforceRetryGate,
  loadBaselineReport,
  logStep,
  parseCliOptions,
  repoRoot,
  runCommand,
  setRunReporter,
  tempDirs,
} from "./check-gateway-node/harness.mjs";

function runGovernanceEvalSmoke() {
  const ciLabelPolicy = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/governance/evals/ci-label-policy-guard.ts",
    "--policy",
    "gateway/evals/ci_label_policy.json",
  ]);
  assertSuccess("ci-label-policy-guard", ciLabelPolicy);
  logStep("ci-label-policy-guard");

  const tracePolicy = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/governance/evals/trace-policy-guard.ts",
    "--policy",
    "gateway/evals/trace_pipeline_policy.dev.json",
    "--policy",
    "gateway/evals/trace_pipeline_policy.ci.json",
    "--policy",
    "gateway/evals/trace_pipeline_policy.prod.json",
  ]);
  assertSuccess("trace-policy-guard", tracePolicy);
  logStep("trace-policy-guard");

  const skillRouterPolicy = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/governance/evals/skill-router-policy-guard.ts",
    "--policy",
    "gateway/evals/skill_router_policy.dev.json",
    "--policy",
    "gateway/evals/skill_router_policy.ci.json",
    "--policy",
    "gateway/evals/skill_router_policy.prod.json",
  ]);
  assertSuccess("skill-router-policy-guard", skillRouterPolicy);
  logStep("skill-router-policy-guard");
}

function runWorkflowGuard() {
  const harnessWorkflowPath = resolve(repoRoot, ".github/workflows/harness-gate.yml");
  const coreReleaseWorkflowPath = resolve(repoRoot, ".github/workflows/core-release-gate.yml");
  const corePackagingWorkflowPath = resolve(repoRoot, ".github/workflows/core-packaging-check.yml");
  const legacyPythonCliPath = resolve(repoRoot, "gateway/grobot_cli.py");
  const harnessWorkflow = readFileSync(harnessWorkflowPath, "utf8");
  const coreReleaseWorkflow = readFileSync(coreReleaseWorkflowPath, "utf8");
  const corePackagingWorkflow = readFileSync(corePackagingWorkflowPath, "utf8");

  assert.equal(harnessWorkflow.includes("python3 --version"), false);
  assert.equal(coreReleaseWorkflow.includes("python3 --version"), false);
  assert.equal(corePackagingWorkflow.includes("python3 --version"), false);
  logStep("workflow guard without python3 runtime dependency");

  assert.equal(existsSync(legacyPythonCliPath), false);
  logStep("legacy python cli removed");
}

function ensureContractsExist() {
  const requiredContracts = [
    "management-policy-contract.mjs",
    "local-tools-contract.mjs",
    "runtime-paths-contract.mjs",
    "session-lifecycle-contract.mjs",
    "session-store-contract.mjs",
    "start-smoke-contract.mjs",
    "serve-smoke-contract.mjs",
    "runtime-smoke-contract.mjs",
    "handoff-contract.mjs",
    "history-compaction-contract.mjs",
    "semantic-search-regression-contract.mjs",
    "browser-structured-mcp-contract.mjs",
    "runtime-tool-recovery-readiness-contract.ts",
    "bridge-plan-failure-policy-contract.ts",
    "bridge-plan-apply-failure-contract.mjs",
    "bridge-cli-contract.mjs",
    "bridge-error-codes-schema-contract.mjs",
    "plan-events-policy-guard-contract.mjs",
    "start-plan-failure-policy-contract.ts",
    "start-slash-suggestions-contract.ts",
    "ask-user-tool-contract.ts",
    "ga-skill-prompt-contract.ts",
    "cli-interactive-frame-contract.ts",
    "terminal-text-sanitizer-contract.ts",
  ];
  for (const contractName of requiredContracts) {
    const path = resolve(contractsRoot, contractName);
    if (!existsSync(path)) {
      throw new Error(`missing contract script: ${path}`);
    }
  }
}

async function main() {
  const cli = parseCliOptions(process.argv.slice(2));
  const reporter = createRunReporter({
    mode: cli.mode,
    emitText: !cli.json,
    failOnRetry: cli.fail_on_retry,
  });
  const baselineReportPath = cli.baseline_json
    ? resolve(repoRoot, cli.baseline_json)
    : "";
  const baselineReportPayload = baselineReportPath
    ? loadBaselineReport(baselineReportPath)
    : null;
  setRunReporter(reporter);
  try {
    ensureContractsExist();
    if (cli.mode === "runtime-smoke-only") {
      await runTsRustExecutionSmoke();
      enforceRetryGate(cli, reporter);
      reporter.finish("ok");
      if (cli.json || cli.json_output) {
        emitJsonReport(cli, reporter, baselineReportPath, baselineReportPayload);
      }
      if (!cli.json) {
        process.stdout.write("gateway runtime smoke checks completed.\n");
      }
      return;
    }
    await runGatewayContractSmoke();
    await runTsRustExecutionSmoke();
    runGovernanceEvalSmoke();
    runWorkflowGuard();
    enforceRetryGate(cli, reporter);
    reporter.finish("ok");
    if (cli.json || cli.json_output) {
      emitJsonReport(cli, reporter, baselineReportPath, baselineReportPayload);
    }
    if (!cli.json) {
      process.stdout.write("gateway node checks completed.\n");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reporter.finish("failed", message);
    if (cli.json || cli.json_output) {
      emitJsonReport(cli, reporter, baselineReportPath, baselineReportPayload);
    }
    throw error;
  } finally {
    setRunReporter(null);
  }
}

try {
  await main();
} finally {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
