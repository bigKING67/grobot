#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..", "..");
const contractsRoot = resolve(repoRoot, "gateway/src/extensions/contracts");

const tempDirs = [];

function makeTempDir(prefix) {
  const path = mkdtempSync(resolve(tmpdir(), `${prefix}-`));
  tempDirs.push(path);
  return path;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 180_000,
    input: options.input,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    code: typeof result.status === "number" ? result.status : 1,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

function parseJsonOutput(name, stdout) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${name}: stdout is not valid JSON: ${String(error)}\n${stdout}`);
  }
}

function assertSuccess(name, result) {
  if (result.code !== 0) {
    throw new Error(`${name}: exit=${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
}

function runContract(scriptName, command, args = [], options = {}) {
  const scriptPath = resolve(contractsRoot, scriptName);
  const result = runCommand("node", [scriptPath, command, ...args], options);
  assertSuccess(`${scriptName} ${command}`, result);
  return result;
}

function logStep(name) {
  process.stdout.write(`[ok] ${name}\n`);
}

function reserveFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to reserve free port")));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function runGatewayContractSmoke() {
  const credentialResult = runContract("management-policy-contract.mjs", "build-credential", [
    "--payload",
    JSON.stringify({ token: "ops-read-token", policy_template: "ops_read_only" }),
  ]);
  const credentialPayload = parseJsonOutput("management-policy-contract build-credential", credentialResult.stdout);
  assert.equal(typeof credentialPayload?.credential?.token, "string");
  logStep("management-policy-contract build-credential");

  const actionAllowedResult = runContract("management-policy-contract.mjs", "action-allowed", [
    "--payload",
    JSON.stringify({ token: "ops-read-token", actions: ["config_read"] }),
    "--required-action",
    "config_read",
  ]);
  const actionAllowedPayload = parseJsonOutput("management-policy-contract action-allowed", actionAllowedResult.stdout);
  assert.equal(actionAllowedPayload.allowed, true);
  logStep("management-policy-contract action-allowed");

  const localToolsResult = runContract("local-tools-contract.mjs", "file-mention-enrichment");
  const localToolsPayload = parseJsonOutput("local-tools-contract file-mention-enrichment", localToolsResult.stdout);
  assert.equal(Array.isArray(localToolsPayload.lines), true);
  assert.equal(localToolsPayload.lines.length >= 3, true);
  logStep("local-tools-contract file-mention-enrichment");

  const homeDir = makeTempDir("grobot-home");
  const workDir = makeTempDir("grobot-work");
  const runtimePathsResult = runContract("runtime-paths-contract.mjs", "resolve-runtime-paths", [
    "--home",
    homeDir,
    "--work-dir",
    workDir,
    "--repo-root",
    repoRoot,
  ]);
  const runtimePathsPayload = parseJsonOutput("runtime-paths-contract resolve-runtime-paths", runtimePathsResult.stdout);
  assert.equal(typeof runtimePathsPayload.project_root, "string");
  logStep("runtime-paths-contract resolve-runtime-paths");

  runContract("session-lifecycle-contract.mjs", "parse-args", [
    "--argv",
    JSON.stringify(["start", "--session-scope", "dm", "--session-subject", "smoke-user"]),
  ]);
  logStep("session-lifecycle-contract parse-args");

  const historyCompactionResult = runContract("history-compaction-contract.mjs", "trim", [
    "--payload",
    JSON.stringify({
      history: [{ role: "user", content: "hello" }],
      max_turns: 3,
    }),
  ]);
  const historyCompactionPayload = parseJsonOutput("history-compaction-contract trim", historyCompactionResult.stdout);
  assert.equal(typeof historyCompactionPayload.header, "string");
  logStep("history-compaction-contract trim");

  const handoffSanitizeResult = runContract("handoff-contract.mjs", "sanitize", [
    "--text",
    "api_key=sk-123 token:abc Bearer xyz password = letmein",
  ]);
  const handoffSanitizePayload = parseJsonOutput("handoff-contract sanitize", handoffSanitizeResult.stdout);
  assert.equal(typeof handoffSanitizePayload.sanitized, "string");
  assert.equal(handoffSanitizePayload.sanitized.includes("<redacted>"), true);
  logStep("handoff-contract sanitize");

  runContract("handoff-contract.mjs", "start-defaults");
  logStep("handoff-contract start-defaults");

  runContract("session-store-contract.mjs", "load-fallback-scenario", ["--root", makeTempDir("session-store")]);
  logStep("session-store-contract load-fallback-scenario");

  runContract("session-store-contract.mjs", "save-fallback-scenario", ["--root", makeTempDir("session-store")]);
  logStep("session-store-contract save-fallback-scenario");
}

async function runTsRustExecutionSmoke() {
  const statusResult = runContract("start-smoke-contract.mjs", "status-ts-rust", ["--repo-root", repoRoot], {
    timeoutMs: 240_000,
  });
  const statusPayload = parseJsonOutput("start-smoke-contract status-ts-rust", statusResult.stdout);
  assert.equal(statusPayload.exit_code, 0);
  logStep("start-smoke-contract status-ts-rust");

  const rejectResult = runContract("start-smoke-contract.mjs", "package-launcher-rejects-python", [
    "--repo-root",
    repoRoot,
  ]);
  const rejectPayload = parseJsonOutput("start-smoke-contract package-launcher-rejects-python", rejectResult.stdout);
  assert.equal(rejectPayload.exit_code, 2);
  logStep("start-smoke-contract package-launcher-rejects-python");

  const failoverRejectResult = runContract("start-smoke-contract.mjs", "failover-rejects-python", ["--repo-root", repoRoot]);
  const failoverRejectPayload = parseJsonOutput("start-smoke-contract failover-rejects-python", failoverRejectResult.stdout);
  assert.equal(failoverRejectPayload.exit_code, 2);
  logStep("start-smoke-contract failover-rejects-python");

  const failoverRunsResult = runContract("start-smoke-contract.mjs", "failover-runs-ts-rust", ["--repo-root", repoRoot], {
    timeoutMs: 240_000,
  });
  const failoverRunsPayload = parseJsonOutput("start-smoke-contract failover-runs-ts-rust", failoverRunsResult.stdout);
  assert.equal(failoverRunsPayload.exit_code, 0);
  logStep("start-smoke-contract failover-runs-ts-rust");

  const legacyFlagRejectResult = runContract("start-smoke-contract.mjs", "status-reject-legacy-flag", [
    "--repo-root",
    repoRoot,
  ]);
  const legacyFlagRejectPayload = parseJsonOutput(
    "start-smoke-contract status-reject-legacy-flag",
    legacyFlagRejectResult.stdout,
  );
  assert.equal(legacyFlagRejectPayload.exit_code, 2);
  logStep("start-smoke-contract status-reject-legacy-flag");

  const pythonGatewayRejectResult = runContract("start-smoke-contract.mjs", "status-reject-python-gateway", [
    "--repo-root",
    repoRoot,
  ]);
  const pythonGatewayRejectPayload = parseJsonOutput(
    "start-smoke-contract status-reject-python-gateway",
    pythonGatewayRejectResult.stdout,
  );
  assert.equal(pythonGatewayRejectPayload.exit_code, 2);
  logStep("start-smoke-contract status-reject-python-gateway");

  const legacyEnvRejectResult = runContract("start-smoke-contract.mjs", "status-reject-legacy-env", ["--repo-root", repoRoot]);
  const legacyEnvRejectPayload = parseJsonOutput("start-smoke-contract status-reject-legacy-env", legacyEnvRejectResult.stdout);
  assert.equal(legacyEnvRejectPayload.exit_code, 2);
  logStep("start-smoke-contract status-reject-legacy-env");

  const homeDir = makeTempDir("serve-home");
  const workDir = makeTempDir("serve-work");
  const port = await reserveFreePort();
  runContract(
    "serve-smoke-contract.mjs",
    "config-read-policy-auto",
    [
      "--repo-root",
      repoRoot,
      "--work-dir",
      workDir,
      "--home-dir",
      homeDir,
      "--bind",
      `127.0.0.1:${port}`,
    ],
    { timeoutMs: 240_000 },
  );
  logStep("serve-smoke-contract config-read-policy-auto");

  const disabledPort = await reserveFreePort();
  runContract(
    "serve-smoke-contract.mjs",
    "config-read-policy-disabled",
    [
      "--repo-root",
      repoRoot,
      "--work-dir",
      workDir,
      "--home-dir",
      homeDir,
      "--bind",
      `127.0.0.1:${disabledPort}`,
      "--management-token",
      "ops-token",
    ],
    { timeoutMs: 240_000 },
  );
  logStep("serve-smoke-contract config-read-policy-disabled");
}

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
    "handoff-contract.mjs",
    "history-compaction-contract.mjs",
  ];
  for (const contractName of requiredContracts) {
    const path = resolve(contractsRoot, contractName);
    if (!existsSync(path)) {
      throw new Error(`missing contract script: ${path}`);
    }
  }
}

async function main() {
  ensureContractsExist();
  await runGatewayContractSmoke();
  await runTsRustExecutionSmoke();
  runGovernanceEvalSmoke();
  runWorkflowGuard();
  process.stdout.write("gateway node checks completed.\n");
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
