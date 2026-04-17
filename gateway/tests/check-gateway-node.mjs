#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startMockModelServer } from "../src/extensions/contracts/_shared/mock-model-server.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..", "..");
const contractsRoot = resolve(repoRoot, "gateway/src/extensions/contracts");

const tempDirs = [];
let runReporter = null;

function nowIso() {
  return new Date().toISOString();
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function parseStepDuration(step) {
  if (!isRecord(step)) {
    return 0;
  }
  return toFiniteNumber(step.step_duration_ms, 0);
}

function parseElapsed(step) {
  if (!isRecord(step)) {
    return 0;
  }
  return toFiniteNumber(step.elapsed_ms, 0);
}

function parseStepName(step) {
  if (!isRecord(step) || typeof step.name !== "string") {
    return "";
  }
  return step.name;
}

function normalizeSteps(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.steps)) {
    return [];
  }
  return payload.steps.filter((entry) => isRecord(entry));
}

function loadBaselineReport(baselinePath) {
  const raw = readFileSync(baselinePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error(`baseline report must be a JSON object: ${baselinePath}`);
  }
  return parsed;
}

function buildStepDurationMap(steps) {
  const map = new Map();
  for (const step of steps) {
    const name = parseStepName(step);
    if (!name || map.has(name)) {
      continue;
    }
    map.set(name, parseStepDuration(step));
  }
  return map;
}

function computeComparisonPayload(currentPayload, baselinePayload, baselinePath) {
  const currentSteps = normalizeSteps(currentPayload);
  const baselineSteps = normalizeSteps(baselinePayload);
  const baselineDurations = buildStepDurationMap(baselineSteps);
  const comparable = [];
  for (const step of currentSteps) {
    const name = parseStepName(step);
    if (!name || !baselineDurations.has(name)) {
      continue;
    }
    const currentDurationMs = parseStepDuration(step);
    const baselineDurationMs = toFiniteNumber(baselineDurations.get(name), 0);
    comparable.push({
      name,
      current_step_duration_ms: currentDurationMs,
      baseline_step_duration_ms: baselineDurationMs,
      delta_ms: currentDurationMs - baselineDurationMs,
      current_elapsed_ms: parseElapsed(step),
    });
  }

  const regressions = comparable
    .filter((entry) => entry.delta_ms > 0)
    .sort((left, right) => right.delta_ms - left.delta_ms)
    .slice(0, 5);
  const improvements = comparable
    .filter((entry) => entry.delta_ms < 0)
    .sort((left, right) => left.delta_ms - right.delta_ms)
    .slice(0, 5)
    .map((entry) => ({
      ...entry,
      gain_ms: Math.abs(entry.delta_ms),
    }));
  const unchangedCount = comparable.filter((entry) => entry.delta_ms === 0).length;
  const currentDurationMs = toFiniteNumber(currentPayload.duration_ms, 0);
  const baselineDurationMs = toFiniteNumber(baselinePayload.duration_ms, 0);
  return {
    baseline_path: baselinePath,
    baseline_status: typeof baselinePayload.status === "string" ? baselinePayload.status : "",
    baseline_step_count: Array.isArray(baselinePayload.steps) ? baselinePayload.steps.length : 0,
    baseline_retry_count: toFiniteNumber(baselinePayload.retry_count, 0),
    duration_delta_ms: currentDurationMs - baselineDurationMs,
    comparable_steps: comparable.length,
    regressions_count: regressions.length,
    improvements_count: improvements.length,
    unchanged_count: unchangedCount,
    top_regressions: regressions,
    top_improvements: improvements,
  };
}

function formatMeta(metadata) {
  if (!isRecord(metadata)) {
    return "";
  }
  const entries = Object.entries(metadata);
  if (entries.length === 0) {
    return "";
  }
  return ` ${entries.map(([key, value]) => `${key}=${String(value)}`).join(" ")}`;
}

function createRunReporter(options = {}) {
  const mode = typeof options.mode === "string" ? options.mode : "full";
  const emitText = options.emitText !== false;
  const failOnRetry = options.failOnRetry === true;
  const startedMs = Date.now();
  const report = {
    mode,
    fail_on_retry: failOnRetry,
    retry_gate_triggered: false,
    started_at: nowIso(),
    completed_at: "",
    duration_ms: 0,
    status: "running",
    error_message: "",
    steps: [],
    retries: [],
  };
  return {
    emitText,
    step(name, metadata = {}) {
      const elapsedMs = Date.now() - startedMs;
      const previousStep = report.steps[report.steps.length - 1] ?? null;
      const previousElapsedMs =
        previousStep && typeof previousStep.elapsed_ms === "number"
          ? previousStep.elapsed_ms
          : 0;
      const stepDurationMs = Math.max(0, elapsedMs - previousElapsedMs);
      report.steps.push({
        name,
        at: nowIso(),
        elapsed_ms: elapsedMs,
        step_duration_ms: stepDurationMs,
        ...(isRecord(metadata) ? metadata : {}),
      });
      if (emitText) {
        process.stdout.write(`[ok] ${name}${formatMeta(metadata)}\n`);
      }
    },
    retry(name, attempt, maxAttempts, reason, metadata = {}) {
      const elapsedMs = Date.now() - startedMs;
      report.retries.push({
        name,
        attempt,
        max_attempts: maxAttempts,
        reason,
        at: nowIso(),
        elapsed_ms: elapsedMs,
        ...(isRecord(metadata) ? metadata : {}),
      });
      if (emitText) {
        process.stdout.write(`[retry] ${name} attempt ${String(attempt)}/${String(maxAttempts)} reason=${reason}\n`);
      }
    },
    finish(status, errorMessage = "") {
      report.status = status;
      report.error_message = errorMessage;
      report.completed_at = nowIso();
      report.duration_ms = Date.now() - startedMs;
    },
    retryCount() {
      return report.retries.length;
    },
    markRetryGateTriggered() {
      report.retry_gate_triggered = true;
    },
    toJSON() {
      const topSlowestSteps = report.steps
        .map((entry, index) => {
          const stepDurationMs =
            typeof entry.step_duration_ms === "number"
              ? entry.step_duration_ms
              : 0;
          const elapsedMs =
            typeof entry.elapsed_ms === "number"
              ? entry.elapsed_ms
              : 0;
          return {
            order: index + 1,
            name: entry.name,
            step_duration_ms: stepDurationMs,
            elapsed_ms: elapsedMs,
          };
        })
        .sort((left, right) => (
          right.step_duration_ms - left.step_duration_ms
        ) || (
          right.elapsed_ms - left.elapsed_ms
        ))
        .slice(0, 5);
      return {
        ...report,
        step_count: report.steps.length,
        retry_count: report.retries.length,
        top_slowest_steps: topSlowestSteps,
      };
    },
  };
}

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

function runCommandAsync(command, args, options = {}) {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timeoutMs = options.timeoutMs ?? 180_000;
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeoutHandle = null;

    const finish = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
      resolveResult(payload);
    };

    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    child.on("error", rejectResult);
    child.on("close", (code) => {
      finish({
        code: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });

    timeoutHandle = setTimeout(() => {
      child.kill("SIGKILL");
      const timeoutMessage = `command timeout after ${String(timeoutMs)}ms`;
      finish({
        code: 1,
        stdout,
        stderr: stderr.length > 0 ? `${stderr}\n${timeoutMessage}` : timeoutMessage,
      });
    }, timeoutMs);

    if (typeof options.input === "string" && child.stdin) {
      child.stdin.write(options.input);
    }
    if (child.stdin) {
      child.stdin.end();
    }
  });
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

function runTsContract(scriptName, command, args = [], options = {}) {
  const scriptPath = resolve(contractsRoot, scriptName);
  const result = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    scriptPath,
    command,
    ...args,
  ], options);
  assertSuccess(`${scriptName} ${command}`, result);
  return result;
}

async function runContractAsync(scriptName, command, args = [], options = {}) {
  const scriptPath = resolve(contractsRoot, scriptName);
  const result = await runCommandAsync("node", [scriptPath, command, ...args], options);
  assertSuccess(`${scriptName} ${command}`, result);
  return result;
}

function logStep(name, metadata = {}) {
  if (runReporter) {
    runReporter.step(name, metadata);
    return;
  }
  process.stdout.write(`[ok] ${name}${formatMeta(metadata)}\n`);
}

function logRetry(name, attempt, maxAttempts, reason) {
  if (runReporter) {
    runReporter.retry(name, attempt, maxAttempts, reason);
    return;
  }
  process.stdout.write(`[retry] ${name} attempt ${String(attempt)}/${String(maxAttempts)} reason=${reason}\n`);
}

function sleepMs(delayMs) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, delayMs));
}

function parseCliOptions(argv) {
  const options = {
    mode: "full",
    json: false,
    json_output: "",
    fail_on_retry: false,
    baseline_json: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--runtime-smoke-only") {
      options.mode = "runtime-smoke-only";
      continue;
    }
    if (token === "--json") {
      options.json = true;
      continue;
    }
    if (token === "--fail-on-retry") {
      options.fail_on_retry = true;
      continue;
    }
    if (token === "--json-output") {
      const value = argv[index + 1] ?? "";
      if (!value || value.startsWith("--")) {
        throw new Error("missing value for --json-output");
      }
      options.json_output = value;
      index += 1;
      continue;
    }
    if (token === "--baseline-json") {
      const value = argv[index + 1] ?? "";
      if (!value || value.startsWith("--")) {
        throw new Error("missing value for --baseline-json");
      }
      options.baseline_json = value;
      index += 1;
      continue;
    }
    if (!token) {
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return options;
}

function buildReportPayload(cli, reporter, baselineReportPath, baselineReportPayload) {
  const payload = reporter.toJSON();
  if (baselineReportPayload && baselineReportPath) {
    payload.comparison = computeComparisonPayload(payload, baselineReportPayload, baselineReportPath);
  }
  return payload;
}

function emitJsonReport(cli, reporter, baselineReportPath = "", baselineReportPayload = null) {
  const payload = buildReportPayload(cli, reporter, baselineReportPath, baselineReportPayload);
  if (cli.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }
  if (cli.json_output) {
    const outputPath = resolve(repoRoot, cli.json_output);
    writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    if (!cli.json) {
      process.stdout.write(`[ok] gateway-check-report-written path=${outputPath}\n`);
    }
  }
}

function enforceRetryGate(cli, reporter) {
  if (!cli.fail_on_retry) {
    return;
  }
  const retryCount = reporter.retryCount();
  if (retryCount <= 0) {
    return;
  }
  reporter.markRetryGateTriggered();
  throw new Error(`retry gate failed: observed ${String(retryCount)} retries`);
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

  const semanticSearchToolResult = runContract("local-tools-contract.mjs", "semantic-search-tool");
  const semanticSearchToolPayload = parseJsonOutput(
    "local-tools-contract semantic-search-tool",
    semanticSearchToolResult.stdout,
  );
  assert.equal(semanticSearchToolPayload.tool, "semantic_search");
  assert.equal(Number(semanticSearchToolPayload.count) >= 1, true);
  assert.equal(Array.isArray(semanticSearchToolPayload.source_stats), true);
  assert.equal(Array.isArray(semanticSearchToolPayload.matches), true);
  logStep("local-tools-contract semantic-search-tool");

  const promptEnhancerToolResult = runContract("local-tools-contract.mjs", "prompt-enhancer-tool");
  const promptEnhancerToolPayload = parseJsonOutput(
    "local-tools-contract prompt-enhancer-tool",
    promptEnhancerToolResult.stdout,
  );
  assert.equal(promptEnhancerToolPayload.tool, "prompt_enhancer");
  assert.equal(Array.isArray(promptEnhancerToolPayload.technical_terms), true);
  assert.equal(Array.isArray(promptEnhancerToolPayload.evidence), true);
  assert.equal(typeof promptEnhancerToolPayload.context_block, "string");
  logStep("local-tools-contract prompt-enhancer-tool");

  const semanticSearchQualityRegressionResult = runContract(
    "semantic-search-regression-contract.mjs",
    "quality-regression",
  );
  const semanticSearchQualityRegressionPayload = parseJsonOutput(
    "semantic-search-regression-contract quality-regression",
    semanticSearchQualityRegressionResult.stdout,
  );
  assert.equal(semanticSearchQualityRegressionPayload.passed, true);
  assert.equal(
    String(semanticSearchQualityRegressionPayload.semantic_top_path),
    "src/session-policy.ts",
  );
  assert.equal(
    String(semanticSearchQualityRegressionPayload.fallback_top_path).endsWith("src/retry-policy.ts"),
    true,
  );
  assert.equal(
    Number(semanticSearchQualityRegressionPayload.fallback_warning_count) >= 1,
    true,
  );
  logStep("semantic-search-regression-contract quality-regression");

  const semanticSearchBenchmarkResult = runContract(
    "semantic-search-regression-contract.mjs",
    "benchmark",
  );
  const semanticSearchBenchmarkPayload = parseJsonOutput(
    "semantic-search-regression-contract benchmark",
    semanticSearchBenchmarkResult.stdout,
  );
  assert.equal(semanticSearchBenchmarkPayload.passed, true);
  assert.equal(Array.isArray(semanticSearchBenchmarkPayload.rows), true);
  assert.equal(Array.isArray(semanticSearchBenchmarkPayload.comparisons), true);
  assert.equal(semanticSearchBenchmarkPayload.rows.length >= 8, true);
  assert.equal(semanticSearchBenchmarkPayload.comparisons.length >= 4, true);
  logStep("semantic-search-regression-contract benchmark", {
    rows: semanticSearchBenchmarkPayload.rows.length,
    comparisons: semanticSearchBenchmarkPayload.comparisons.length,
  });

  const mcpPolicyResult = runContract("local-tools-contract.mjs", "resolve-mcp-call-policy");
  const mcpPolicyPayload = parseJsonOutput("local-tools-contract resolve-mcp-call-policy", mcpPolicyResult.stdout);
  assert.equal(Number(mcpPolicyPayload.max_concurrency_per_server) >= 1, true);
  assert.equal(Number(mcpPolicyPayload.max_queue_per_server) >= 0, true);
  assert.equal(Number(mcpPolicyPayload.failure_threshold) >= 1, true);
  assert.equal(Number(mcpPolicyPayload.cooldown_secs) >= 1, true);
  assert.equal(Number(mcpPolicyPayload.latency_sample_limit) >= 16, true);
  assert.equal(Array.isArray(mcpPolicyPayload.allow_tools), true);
  logStep("local-tools-contract resolve-mcp-call-policy");

  const mcpQueueGateResult = runContract("local-tools-contract.mjs", "mcp-server-slot-queue-full");
  const mcpQueueGatePayload = parseJsonOutput("local-tools-contract mcp-server-slot-queue-full", mcpQueueGateResult.stdout);
  assert.equal(mcpQueueGatePayload.raised, true);
  assert.equal(Number(mcpQueueGatePayload?.snapshot?.gate_rejected_calls), 1);
  logStep("local-tools-contract mcp-server-slot-queue-full");

  const mcpCircuitOpenResult = runContract("local-tools-contract.mjs", "mcp-server-circuit-open");
  const mcpCircuitOpenPayload = parseJsonOutput("local-tools-contract mcp-server-circuit-open", mcpCircuitOpenResult.stdout);
  assert.equal(mcpCircuitOpenPayload.raised, true);
  assert.equal(mcpCircuitOpenPayload.opened_second, true);
  assert.equal(Number(mcpCircuitOpenPayload?.snapshot?.gate_rejected_calls), 1);
  logStep("local-tools-contract mcp-server-circuit-open");

  const mcpServersSummaryResult = runContract("local-tools-contract.mjs", "mcp-servers-summary");
  const mcpServersSummaryPayload = parseJsonOutput("local-tools-contract mcp-servers-summary", mcpServersSummaryResult.stdout);
  assert.equal(Number(mcpServersSummaryPayload?.full?.total), 3);
  assert.equal(Number(mcpServersSummaryPayload?.full?.ready_count), 1);
  assert.equal(Number(mcpServersSummaryPayload?.full?.runtime_summary?.servers_considered), 3);
  assert.equal(Number(mcpServersSummaryPayload?.ready_only?.runtime_summary?.servers_considered), 1);
  logStep("local-tools-contract mcp-servers-summary");

  const mcpCallStdioResult = runContract("local-tools-contract.mjs", "mcp-call-stdio");
  const mcpCallStdioPayload = parseJsonOutput("local-tools-contract mcp-call-stdio", mcpCallStdioResult.stdout);
  assert.equal(mcpCallStdioPayload?.first?.session_reused, false);
  assert.equal(mcpCallStdioPayload?.second?.session_reused, true);
  assert.equal(Number(mcpCallStdioPayload?.second?.runtime_state?.total_calls), 2);
  logStep("local-tools-contract mcp-call-stdio");

  const mcpCallRecoverResult = runContract("local-tools-contract.mjs", "mcp-call-auto-recover");
  const mcpCallRecoverPayload = parseJsonOutput("local-tools-contract mcp-call-auto-recover", mcpCallRecoverResult.stdout);
  assert.equal(mcpCallRecoverPayload?.second?.session_recovered, true);
  assert.equal(Number(mcpCallRecoverPayload?.second?.runtime_state?.recovered_calls), 1);
  logStep("local-tools-contract mcp-call-auto-recover");

  const mcpCallToolFailureResult = runContract("local-tools-contract.mjs", "mcp-call-tool-failure");
  const mcpCallToolFailurePayload = parseJsonOutput("local-tools-contract mcp-call-tool-failure", mcpCallToolFailureResult.stdout);
  assert.equal(mcpCallToolFailurePayload.raised, true);
  assert.equal(Number(mcpCallToolFailurePayload?.snapshot?.tool_failures), 1);
  logStep("local-tools-contract mcp-call-tool-failure");

  const mcpCallAllowToolsResult = runContract("local-tools-contract.mjs", "mcp-call-allow-tools");
  const mcpCallAllowToolsPayload = parseJsonOutput("local-tools-contract mcp-call-allow-tools", mcpCallAllowToolsResult.stdout);
  assert.equal(mcpCallAllowToolsPayload.raised, true);
  assert.equal(Number(mcpCallAllowToolsPayload?.snapshot?.policy_denied_calls), 1);
  logStep("local-tools-contract mcp-call-allow-tools");

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

  const sessionInteractiveDispatchResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/session-interactive-dispatch-contract.ts",
  ]);
  assertSuccess("session-interactive-dispatch-contract", sessionInteractiveDispatchResult);
  const sessionInteractiveDispatchPayload = parseJsonOutput(
    "session-interactive-dispatch-contract",
    sessionInteractiveDispatchResult.stdout,
  );
  assert.equal(sessionInteractiveDispatchPayload.switch_prefix_miss_hits_run_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.switch_prefix_miss_opened_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.continue_prefix_miss_hits_run_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.continue_prefix_miss_opened_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.model_prefix_miss_hits_run_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.model_prefix_miss_opened_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.plan_prefix_miss_hits_run_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_prefix_miss_entered_plan, false);
  assert.equal(sessionInteractiveDispatchPayload.switch_menu_opened, true);
  assert.equal(sessionInteractiveDispatchPayload.continue_menu_opened, true);
  assert.equal(sessionInteractiveDispatchPayload.model_reset_dispatched, true);
  logStep("session-interactive-dispatch-contract");

  const bridgeCliContractResult = runCommand("node", [
    "gateway/src/extensions/contracts/bridge-cli-contract.mjs",
  ], {
    timeoutMs: 120_000,
  });
  assertSuccess("bridge-cli-contract", bridgeCliContractResult);
  const bridgeCliContractPayload = parseJsonOutput(
    "bridge-cli-contract",
    bridgeCliContractResult.stdout,
  );
  assert.equal(bridgeCliContractPayload.ok, true);
  assert.equal(bridgeCliContractPayload.no_active_error_code, "PLAN_NO_ACTIVE");
  assert.equal(bridgeCliContractPayload.guard_error_code, "PLAN_GUARD_DENIED");
  assert.equal(bridgeCliContractPayload.append_note_error_code, "PLAN_APPEND_NOTE_FAILED");
  assert.equal(
    bridgeCliContractPayload.review_error_code === "PLAN_REVIEW_FAILED" ||
      bridgeCliContractPayload.review_error_code === "PLAN_REVIEW_BLOCKED",
    true,
  );
  assert.equal(Number(bridgeCliContractPayload.review_fail_count) >= 1, true);
  assert.equal(bridgeCliContractPayload.apply_blocked_error_code, "PLAN_APPLY_STATUS_BLOCKED");
  assert.equal(bridgeCliContractPayload.status_after_cancel_mode, "normal");
  assert.equal(bridgeCliContractPayload.status_after_cancel_active_plan_id, null);
  logStep("bridge-cli-contract");

  const bridgeErrorCodesSchemaContractResult = runCommand("node", [
    "gateway/src/extensions/contracts/bridge-error-codes-schema-contract.mjs",
  ], {
    timeoutMs: 120_000,
  });
  assertSuccess("bridge-error-codes-schema-contract", bridgeErrorCodesSchemaContractResult);
  const bridgeErrorCodesSchemaContractPayload = parseJsonOutput(
    "bridge-error-codes-schema-contract",
    bridgeErrorCodesSchemaContractResult.stdout,
  );
  assert.equal(bridgeErrorCodesSchemaContractPayload.ok, true);
  assert.equal(Number(bridgeErrorCodesSchemaContractPayload.registry_count) >= 8, true);
  assert.equal(Number(bridgeErrorCodesSchemaContractPayload.source_codes_count) >= 8, true);
  assert.equal(Array.isArray(bridgeErrorCodesSchemaContractPayload.source_codes), true);
  assert.equal(Number(bridgeErrorCodesSchemaContractPayload.missing_in_schema_count), 0);
  assert.equal(Number(bridgeErrorCodesSchemaContractPayload.extra_in_schema_count), 0);
  assert.equal(Array.isArray(bridgeErrorCodesSchemaContractPayload.observed_codes), true);
  assert.equal(bridgeErrorCodesSchemaContractPayload.fatal_error_code, "BRIDGE_FATAL");
  logStep("bridge-error-codes-schema-contract");

  const planEventsPolicyGuardContractResult = runCommand("node", [
    "gateway/src/extensions/contracts/plan-events-policy-guard-contract.mjs",
  ], {
    timeoutMs: 120_000,
  });
  assertSuccess("plan-events-policy-guard-contract", planEventsPolicyGuardContractResult);
  const planEventsPolicyGuardContractPayload = parseJsonOutput(
    "plan-events-policy-guard-contract",
    planEventsPolicyGuardContractResult.stdout,
  );
  assert.equal(planEventsPolicyGuardContractPayload.ok, true);
  assert.equal(planEventsPolicyGuardContractPayload.baseline_allow_source, "default_all");
  assert.equal(planEventsPolicyGuardContractPayload.baseline_deny_source, "default_none");
  assert.equal(planEventsPolicyGuardContractPayload.scoped_allow_source, "env");
  assert.equal(planEventsPolicyGuardContractPayload.scoped_deny_source, "env");
  assert.equal(planEventsPolicyGuardContractPayload.overlap_rejected, true);
  assert.equal(planEventsPolicyGuardContractPayload.text_mode_has_scope_counts, true);
  logStep("plan-events-policy-guard-contract");

  const browserStructuredContractResult = runCommand("node", [
    "gateway/src/extensions/contracts/browser-structured-mcp-contract.mjs",
  ], {
    timeoutMs: 120_000,
  });
  assertSuccess("browser-structured-mcp-contract", browserStructuredContractResult);
  const browserStructuredContractPayload = parseJsonOutput(
    "browser-structured-mcp-contract",
    browserStructuredContractResult.stdout,
  );
  assert.equal(browserStructuredContractPayload.ok, true);
  assert.equal(typeof browserStructuredContractPayload.tool_call_error_code, "string");
  assert.equal(typeof browserStructuredContractPayload.tool_call_retryable, "boolean");
  assert.equal(Array.isArray(browserStructuredContractPayload.tool_call_transport_attempts), true);
  logStep("browser-structured-mcp-contract");

  const providerHealthFormatResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/provider-health-format-contract.ts",
  ]);
  assertSuccess("provider-health-format-contract", providerHealthFormatResult);
  const providerHealthFormatPayload = parseJsonOutput(
    "provider-health-format-contract",
    providerHealthFormatResult.stdout,
  );
  assert.equal(providerHealthFormatPayload.has_header, true);
  assert.equal(providerHealthFormatPayload.has_session, true);
  assert.equal(providerHealthFormatPayload.has_sticky, true);
  assert.equal(providerHealthFormatPayload.has_alpha_closed, true);
  assert.equal(providerHealthFormatPayload.has_beta_open, true);
  assert.equal(providerHealthFormatPayload.has_latency_field, true);
  assert.equal(providerHealthFormatPayload.has_error_rate_field, true);
  assert.equal(providerHealthFormatPayload.has_rpm_field, true);
  logStep("provider-health-format-contract");

  const askUserToolContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/ask-user-tool-contract.ts",
  ]);
  assertSuccess("ask-user-tool-contract", askUserToolContractResult);
  const askUserToolContractPayload = parseJsonOutput(
    "ask-user-tool-contract",
    askUserToolContractResult.stdout,
  );
  assert.equal(askUserToolContractPayload.protocol_prefix_removed, true);
  assert.equal(askUserToolContractPayload.resolution_prompt_injected, true);
  assert.equal(askUserToolContractPayload.resolution_prompt_builder_works, true);
  assert.equal(askUserToolContractPayload.resolved_answer, "fast");
  assert.equal(askUserToolContractPayload.resolved_event_has_question_id, true);
  assert.equal(askUserToolContractPayload.issued_registered, true);
  assert.equal(askUserToolContractPayload.issued_display_has_reply_hint, true);
  assert.equal(askUserToolContractPayload.issued_event_has_question_id, true);
  logStep("ask-user-tool-contract");

  const gaSkillPromptContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/ga-skill-prompt-contract.ts",
  ]);
  assertSuccess("ga-skill-prompt-contract", gaSkillPromptContractResult);
  const gaSkillPromptContractPayload = parseJsonOutput(
    "ga-skill-prompt-contract",
    gaSkillPromptContractResult.stdout,
  );
  assert.equal(gaSkillPromptContractPayload.direct_has_header, true);
  assert.equal(Number(gaSkillPromptContractPayload.direct_matched) >= 1, true);
  assert.equal(Number(gaSkillPromptContractPayload.direct_total), 2);
  assert.equal(gaSkillPromptContractPayload.apply_keeps_existing_prefix, true);
  assert.equal(gaSkillPromptContractPayload.apply_has_ga_prompt, true);
  assert.equal(gaSkillPromptContractPayload.apply_has_experience_prompt, true);
  assert.equal(gaSkillPromptContractPayload.apply_has_ga_event, true);
  assert.equal(gaSkillPromptContractPayload.apply_has_experience_event, true);
  assert.equal(gaSkillPromptContractPayload.no_match_skips_ga_prompt, true);
  assert.equal(gaSkillPromptContractPayload.no_match_no_events, true);
  logStep("ga-skill-prompt-contract");

  const interactiveBindingsResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/run-start-interactive-bindings-contract.ts",
  ]);
  assertSuccess("run-start-interactive-bindings-contract", interactiveBindingsResult);
  const interactiveBindingsPayload = parseJsonOutput(
    "run-start-interactive-bindings-contract",
    interactiveBindingsResult.stdout,
  );
  assert.equal(interactiveBindingsPayload.pass_through_project_name, true);
  assert.equal(interactiveBindingsPayload.pass_through_session_runtime, true);
  assert.equal(Number(interactiveBindingsPayload.switch_calls), 2);
  assert.equal(interactiveBindingsPayload.switch_first_call, "session-a:switch");
  assert.equal(interactiveBindingsPayload.switch_second_call, "session-b:switch");
  assert.equal(Number(interactiveBindingsPayload.model_override_count), 1);
  assert.equal(interactiveBindingsPayload.health_has_header, true);
  assert.equal(interactiveBindingsPayload.health_has_sticky_provider, true);
  assert.equal(interactiveBindingsPayload.health_has_provider_row, true);
  assert.equal(interactiveBindingsPayload.manual_handoff_reason, "manual-command");
  assert.equal(interactiveBindingsPayload.manual_handoff_to_stderr, false);
  assert.equal(interactiveBindingsPayload.auto_exit_to_stderr, false);
  assert.equal(Number(interactiveBindingsPayload.history_count), 2);
  assert.equal(interactiveBindingsPayload.help_text, "contract-help");
  logStep("run-start-interactive-bindings-contract");

  const modelOpsContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/run-start-model-ops-contract.ts",
  ]);
  assertSuccess("run-start-model-ops-contract", modelOpsContractResult);
  const modelOpsContractPayload = parseJsonOutput(
    "run-start-model-ops-contract",
    modelOpsContractResult.stdout,
  );
  assert.equal(modelOpsContractPayload.initial_model, "model-default");
  assert.equal(modelOpsContractPayload.initial_source, "config:provider:model");
  assert.equal(modelOpsContractPayload.initial_session_title, "Main Session");
  assert.equal(
    modelOpsContractPayload.initial_session_summary,
    "Trace model override and reset contract",
  );
  assert.equal(modelOpsContractPayload.main_model_after_use, "model-variant");
  assert.equal(modelOpsContractPayload.main_source_after_use, "session:/model");
  assert.equal(modelOpsContractPayload.main_session_id_after_use, "session-main");
  assert.equal(modelOpsContractPayload.main_session_title_after_use, "Main Session");
  assert.equal(
    modelOpsContractPayload.main_session_summary_after_use,
    "Trace model override and reset contract",
  );
  assert.equal(modelOpsContractPayload.main_model_after_reset, "model-default");
  assert.equal(
    modelOpsContractPayload.main_source_after_reset,
    "config:provider:model",
  );
  assert.equal(modelOpsContractPayload.branch_model_after_switch, "model-default");
  assert.equal(
    modelOpsContractPayload.branch_source_after_switch,
    "config:provider:model",
  );
  assert.equal(
    modelOpsContractPayload.branch_session_id_after_switch,
    "session-branch",
  );
  assert.equal(
    modelOpsContractPayload.branch_session_title_after_switch,
    "Branch Session",
  );
  assert.equal(
    modelOpsContractPayload.branch_session_summary_after_switch,
    "Follow-up fallback regression",
  );
  assert.equal(Number(modelOpsContractPayload.list_calls), 2);
  assert.equal(modelOpsContractPayload.list_output_has_current_marker, true);
  assert.equal(modelOpsContractPayload.list_output_has_variant, true);
  assert.equal(
    modelOpsContractPayload.runtime_source_after_switch,
    "config:provider:model",
  );
  logStep("run-start-model-ops-contract");

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

  const historyResolveConfigResult = runContract("history-compaction-contract.mjs", "resolve-config", [
    "--payload",
    JSON.stringify({
      project_toml: {
        retrieval: {
          enabled: true,
          base_url: "https://api.siliconflow.cn/v1",
          api_key: "retrieval-key",
        },
      },
      global_toml: {},
    }),
  ], {
    env: {
      ...process.env,
      CONTEXTWEAVER_API_KEY: "",
      CONTEXTWEAVER_BASE_URL: "",
      CONTEXTWEAVER_EMBEDDINGS_API_KEY: "",
      CONTEXTWEAVER_EMBEDDINGS_BASE_URL: "",
      CONTEXTWEAVER_EMBEDDINGS_MODEL: "",
      CONTEXTWEAVER_EMBEDDINGS_DIMENSIONS: "",
      CONTEXTWEAVER_RERANK_API_KEY: "",
      CONTEXTWEAVER_RERANK_BASE_URL: "",
      CONTEXTWEAVER_RERANK_MODEL: "",
      GROBOT_RETRIEVAL_API_KEY: "",
      GROBOT_RETRIEVAL_BASE_URL: "",
      GROBOT_EMBEDDING_API_KEY: "",
      GROBOT_EMBEDDING_BASE_URL: "",
      GROBOT_EMBEDDING_MODEL: "",
      GROBOT_EMBEDDING_DIMENSIONS: "",
      EMBEDDINGS_DIMENSIONS: "",
      GROBOT_RERANK_API_KEY: "",
      GROBOT_RERANK_BASE_URL: "",
      GROBOT_RERANK_MODEL: "",
    },
  });
  const historyResolveConfigPayload = parseJsonOutput(
    "history-compaction-contract resolve-config",
    historyResolveConfigResult.stdout,
  );
  assert.equal(historyResolveConfigPayload.enabled, true);
  assert.equal(historyResolveConfigPayload.shared_base_url, "https://api.siliconflow.cn/v1");
  assert.equal(historyResolveConfigPayload.shared_base_url_source, "project");
  assert.equal(historyResolveConfigPayload.shared_api_key_source, "project");
  assert.equal(historyResolveConfigPayload.embedding?.model, "Qwen/Qwen3-Embedding-4B");
  assert.equal(historyResolveConfigPayload.embedding?.dimensions, 2560);
  assert.equal(historyResolveConfigPayload.embedding?.base_url, "https://api.siliconflow.cn/v1/embeddings");
  assert.equal(historyResolveConfigPayload.embedding_source, "default");
  assert.equal(historyResolveConfigPayload.embedding_dimensions_source, "inferred");
  assert.equal(historyResolveConfigPayload.rerank?.model, "Qwen/Qwen3-Reranker-0.6B");
  assert.equal(historyResolveConfigPayload.rerank?.base_url, "https://api.siliconflow.cn/v1/rerank");
  assert.equal(historyResolveConfigPayload.rerank_source, "default");
  logStep("history-compaction-contract resolve-config");

  const historyResolveConfigContextweaverEnvResult = runContract("history-compaction-contract.mjs", "resolve-config", [
    "--payload",
    JSON.stringify({
      project_toml: {
        retrieval: {
          enabled: true,
          base_url: "https://project-only.invalid/v1",
          api_key: "project-only-key",
          embedding: {
            model: "Qwen/Qwen3-Embedding-4B",
          },
          rerank: {
            model: "Qwen/Qwen3-Reranker-0.6B",
          },
        },
      },
      global_toml: {},
    }),
  ], {
    env: {
      ...process.env,
      CONTEXTWEAVER_API_KEY: "env-shared-key",
      CONTEXTWEAVER_BASE_URL: "https://env-shared.example.com/v1",
      CONTEXTWEAVER_EMBEDDINGS_API_KEY: "env-embed-key",
      CONTEXTWEAVER_EMBEDDINGS_BASE_URL: "https://env-embed.example.com/v1",
      CONTEXTWEAVER_EMBEDDINGS_MODEL: "Qwen/Qwen3-Embedding-0.6B",
      CONTEXTWEAVER_EMBEDDINGS_DIMENSIONS: "1536",
      CONTEXTWEAVER_RERANK_API_KEY: "",
      CONTEXTWEAVER_RERANK_BASE_URL: "https://env-rerank.example.com/v1",
      CONTEXTWEAVER_RERANK_MODEL: "Qwen/Qwen3-Reranker-8B",
      GROBOT_RETRIEVAL_API_KEY: "",
      GROBOT_RETRIEVAL_BASE_URL: "",
      GROBOT_EMBEDDING_API_KEY: "",
      GROBOT_EMBEDDING_BASE_URL: "",
      GROBOT_EMBEDDING_MODEL: "",
      GROBOT_EMBEDDING_DIMENSIONS: "",
      EMBEDDINGS_DIMENSIONS: "",
      GROBOT_RERANK_API_KEY: "",
      GROBOT_RERANK_BASE_URL: "",
      GROBOT_RERANK_MODEL: "",
    },
  });
  const historyResolveConfigContextweaverEnvPayload = parseJsonOutput(
    "history-compaction-contract resolve-config contextweaver env",
    historyResolveConfigContextweaverEnvResult.stdout,
  );
  assert.equal(historyResolveConfigContextweaverEnvPayload.shared_base_url, "https://env-shared.example.com/v1");
  assert.equal(historyResolveConfigContextweaverEnvPayload.shared_base_url_source, "env");
  assert.equal(historyResolveConfigContextweaverEnvPayload.shared_api_key_source, "env");
  assert.equal(historyResolveConfigContextweaverEnvPayload.embedding?.model, "Qwen/Qwen3-Embedding-0.6B");
  assert.equal(historyResolveConfigContextweaverEnvPayload.embedding?.dimensions, 1536);
  assert.equal(historyResolveConfigContextweaverEnvPayload.embedding?.base_url, "https://env-embed.example.com/v1/embeddings");
  assert.equal(historyResolveConfigContextweaverEnvPayload.embedding_source, "env");
  assert.equal(historyResolveConfigContextweaverEnvPayload.embedding_dimensions_source, "env");
  assert.equal(historyResolveConfigContextweaverEnvPayload.embedding_api_key_source, "env");
  assert.equal(historyResolveConfigContextweaverEnvPayload.embedding_base_url_source, "env");
  assert.equal(historyResolveConfigContextweaverEnvPayload.rerank?.model, "Qwen/Qwen3-Reranker-8B");
  assert.equal(historyResolveConfigContextweaverEnvPayload.rerank?.base_url, "https://env-rerank.example.com/v1/rerank");
  assert.equal(historyResolveConfigContextweaverEnvPayload.rerank_source, "env");
  assert.equal(historyResolveConfigContextweaverEnvPayload.rerank_api_key_source, "env");
  assert.equal(historyResolveConfigContextweaverEnvPayload.rerank_base_url_source, "env");
  logStep("history-compaction-contract resolve-config-contextweaver-env");

  const historyResolveConfigPlaceholderKeyResult = runContract("history-compaction-contract.mjs", "resolve-config", [
    "--payload",
    JSON.stringify({
      project_toml: {
        retrieval: {
          enabled: true,
          base_url: "https://api.siliconflow.cn/v1",
          api_key: "replace-with-retrieval-api-key",
        },
      },
      global_toml: {},
      fallback_api_key: "replace-with-retrieval-api-key",
    }),
  ], {
    env: {
      ...process.env,
      CONTEXTWEAVER_API_KEY: "",
      CONTEXTWEAVER_BASE_URL: "",
      CONTEXTWEAVER_EMBEDDINGS_API_KEY: "",
      CONTEXTWEAVER_EMBEDDINGS_BASE_URL: "",
      CONTEXTWEAVER_EMBEDDINGS_MODEL: "",
      CONTEXTWEAVER_EMBEDDINGS_DIMENSIONS: "",
      CONTEXTWEAVER_RERANK_API_KEY: "",
      CONTEXTWEAVER_RERANK_BASE_URL: "",
      CONTEXTWEAVER_RERANK_MODEL: "",
      GROBOT_RETRIEVAL_API_KEY: "",
      GROBOT_RETRIEVAL_BASE_URL: "",
      GROBOT_EMBEDDING_API_KEY: "",
      GROBOT_EMBEDDING_BASE_URL: "",
      GROBOT_EMBEDDING_MODEL: "",
      GROBOT_EMBEDDING_DIMENSIONS: "",
      EMBEDDINGS_DIMENSIONS: "",
      GROBOT_RERANK_API_KEY: "",
      GROBOT_RERANK_BASE_URL: "",
      GROBOT_RERANK_MODEL: "",
    },
  });
  const historyResolveConfigPlaceholderKeyPayload = parseJsonOutput(
    "history-compaction-contract resolve-config placeholder-key",
    historyResolveConfigPlaceholderKeyResult.stdout,
  );
  assert.equal(historyResolveConfigPlaceholderKeyPayload.shared_api_key_source, "default");
  assert.equal(historyResolveConfigPlaceholderKeyPayload.embedding, null);
  assert.equal(historyResolveConfigPlaceholderKeyPayload.rerank, null);
  assert.equal(historyResolveConfigPlaceholderKeyPayload.embedding_api_key_source, "off");
  assert.equal(historyResolveConfigPlaceholderKeyPayload.rerank_api_key_source, "off");
  assert.equal(historyResolveConfigPlaceholderKeyPayload.embedding_disabled_reason, "missing_embedding_config");
  assert.equal(historyResolveConfigPlaceholderKeyPayload.rerank_disabled_reason, "missing_rerank_config");
  logStep("history-compaction-contract resolve-config-placeholder-key");

  const historyResolveConfigPlaceholderEnvOnlyResult = runContract("history-compaction-contract.mjs", "resolve-config", [
    "--payload",
    JSON.stringify({
      project_toml: {},
      global_toml: {},
      fallback_api_key: "replace-with-retrieval-api-key",
    }),
  ], {
    env: {
      ...process.env,
      CONTEXTWEAVER_API_KEY: "replace-with-contextweaver-key",
      CONTEXTWEAVER_BASE_URL: "replace-with-contextweaver-base-url",
      CONTEXTWEAVER_EMBEDDINGS_API_KEY: "replace-with-embeddings-key",
      CONTEXTWEAVER_EMBEDDINGS_BASE_URL: "replace-with-embeddings-base-url",
      CONTEXTWEAVER_EMBEDDINGS_MODEL: "replace-with-embedding-model",
      CONTEXTWEAVER_EMBEDDINGS_DIMENSIONS: "",
      CONTEXTWEAVER_RERANK_API_KEY: "replace-with-rerank-key",
      CONTEXTWEAVER_RERANK_BASE_URL: "replace-with-rerank-base-url",
      CONTEXTWEAVER_RERANK_MODEL: "replace-with-rerank-model",
      GROBOT_RETRIEVAL_API_KEY: "replace-with-retrieval-api-key",
      GROBOT_RETRIEVAL_BASE_URL: "replace-with-retrieval-base-url",
      GROBOT_EMBEDDING_API_KEY: "replace-with-embedding-key",
      GROBOT_EMBEDDING_BASE_URL: "replace-with-embedding-base-url",
      GROBOT_EMBEDDING_MODEL: "replace-with-embedding-model",
      GROBOT_EMBEDDING_DIMENSIONS: "",
      EMBEDDINGS_DIMENSIONS: "",
      GROBOT_RERANK_API_KEY: "replace-with-rerank-key",
      GROBOT_RERANK_BASE_URL: "replace-with-rerank-base-url",
      GROBOT_RERANK_MODEL: "replace-with-rerank-model",
    },
  });
  const historyResolveConfigPlaceholderEnvOnlyPayload = parseJsonOutput(
    "history-compaction-contract resolve-config placeholder-env-only",
    historyResolveConfigPlaceholderEnvOnlyResult.stdout,
  );
  assert.equal(historyResolveConfigPlaceholderEnvOnlyPayload.source, "default");
  assert.equal(historyResolveConfigPlaceholderEnvOnlyPayload.enabled, false);
  assert.equal(historyResolveConfigPlaceholderEnvOnlyPayload.enabled_source, "default");
  assert.equal(historyResolveConfigPlaceholderEnvOnlyPayload.embedding, null);
  assert.equal(historyResolveConfigPlaceholderEnvOnlyPayload.rerank, null);
  logStep("history-compaction-contract resolve-config-placeholder-env-only");

  const contextEngineTomlDir = makeTempDir("context-engine-contract");
  const contextEngineTomlPath = resolve(contextEngineTomlDir, "project.toml");
  writeFileSync(contextEngineTomlPath, [
    "[context_engine]",
    "enabled = true",
    "profile = \"aggressive\"",
    "context_window_tokens = 64000",
    "reserved_output_tokens = 9000",
    "safety_margin_tokens = 1800",
    "proactive_ratio = 0.82",
    "forced_ratio = 0.89",
    "hard_ratio = 0.95",
    "reactive_max_retries = 2",
    "ptl_max_retries = 4",
    "circuit_breaker_failures = 5",
    "reactive_on_prompt_too_long = true",
    "lineage_enabled = false",
    "lineage_max_rows = 2",
    "workspace_signals_enabled = false",
    "workspace_signals_max_rows = 2",
    "dependency_graph_enabled = false",
    "dependency_graph_max_rows = 2",
    "symbol_graph_enabled = false",
    "symbol_graph_max_rows = 2",
    "semantic_prefetch_enabled = true",
    "semantic_prefetch_timeout_ms = 4200",
    "semantic_prefetch_max_evidence = 9",
  ].join("\n"), "utf8");
  const contextEngineResolveConfigResult = runTsContract("context-engine-contract.ts", "resolve-config", [
    "--payload",
    JSON.stringify({
      project_toml_path: contextEngineTomlPath,
      runtime_model_config: {
        providerKind: "openai_compatible",
      },
    }),
  ]);
  const contextEngineResolveConfigPayload = parseJsonOutput(
    "context-engine-contract resolve-config",
    contextEngineResolveConfigResult.stdout,
  );
  assert.equal(contextEngineResolveConfigPayload.enabled, true);
  assert.equal(contextEngineResolveConfigPayload.profile, "aggressive");
  assert.equal(contextEngineResolveConfigPayload.context_window_tokens, 64000);
  assert.equal(contextEngineResolveConfigPayload.reserved_output_tokens, 9000);
  assert.equal(contextEngineResolveConfigPayload.safety_margin_tokens, 1800);
  assert.equal(contextEngineResolveConfigPayload.proactive_ratio, 0.82);
  assert.equal(contextEngineResolveConfigPayload.forced_ratio, 0.89);
  assert.equal(contextEngineResolveConfigPayload.hard_ratio, 0.95);
  assert.equal(contextEngineResolveConfigPayload.reactive_max_retries, 2);
  assert.equal(contextEngineResolveConfigPayload.ptl_max_retries, 4);
  assert.equal(contextEngineResolveConfigPayload.circuit_breaker_failures, 5);
  assert.equal(contextEngineResolveConfigPayload.reactive_on_prompt_too_long, true);
  assert.equal(contextEngineResolveConfigPayload.lineage?.enabled, false);
  assert.equal(contextEngineResolveConfigPayload.workspace_signals?.enabled, false);
  assert.equal(contextEngineResolveConfigPayload.dependency_graph?.enabled, false);
  assert.equal(contextEngineResolveConfigPayload.symbol_graph?.enabled, false);
  assert.equal(contextEngineResolveConfigPayload.semantic_prefetch?.enabled, true);
  assert.equal(contextEngineResolveConfigPayload.semantic_prefetch?.timeoutMs, 4200);
  assert.equal(contextEngineResolveConfigPayload.semantic_prefetch?.maxEvidence, 9);
  logStep("context-engine-contract resolve-config");

  const contextEnginePreparePromptHistory = Array.from({ length: 12 }).map((_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `turn-${String(index)}: please keep detailed architecture notes, modified files list, verification matrix, and rollback checklist for context engine hard-limit compaction regression coverage.`,
  }));
  const contextEnginePreparePromptResult = runTsContract("context-engine-contract.ts", "prepare-prompt", [
    "--payload",
    JSON.stringify({
      user_text: "请继续修复 context engine 的压缩失败，并保持关键文件和验证结论。",
      history_turns: 6,
      history: contextEnginePreparePromptHistory,
      config: {
        enabled: true,
        profile: "balanced",
        contextWindowTokens: 160,
        reservedOutputTokens: 60,
        safetyMarginTokens: 20,
        thresholds: {
          proactiveRatio: 0.7,
          forcedRatio: 0.8,
          hardRatio: 0.9,
        },
        recovery: {
          reactiveMaxRetries: 1,
          ptlMaxRetries: 2,
          circuitBreakerFailures: 3,
        },
        lineage: {
          enabled: false,
          maxRows: 1,
          maxCommits: 20,
          cacheTtlMs: 1000,
        },
        workspaceSignals: {
          enabled: false,
          maxRows: 1,
          includeUntracked: false,
          cacheTtlMs: 200,
        },
        semanticPrefetch: {
          enabled: false,
          timeoutMs: 500,
          maxEvidence: 2,
        },
        dependencyGraph: {
          enabled: false,
          maxRows: 1,
        },
        symbolGraph: {
          enabled: false,
          maxRows: 1,
        },
        reactiveOnPromptTooLong: true,
      },
    }),
  ]);
  const contextEnginePreparePromptPayload = parseJsonOutput(
    "context-engine-contract prepare-prompt",
    contextEnginePreparePromptResult.stdout,
  );
  assert.equal(
    ["normal", "proactive", "forced", "minimal"].includes(String(contextEnginePreparePromptPayload.selected_stage)),
    true,
  );
  assert.equal(
    ["normal", "proactive", "forced", "minimal"].includes(String(contextEnginePreparePromptPayload.threshold_stage)),
    true,
  );
  assert.equal(
    ["threshold", "budget_guard"].includes(String(contextEnginePreparePromptPayload.selection_reason)),
    true,
  );
  assert.equal(
    Number(contextEnginePreparePromptPayload.variant_tokens?.normal)
      >= Number(contextEnginePreparePromptPayload.variant_tokens?.proactive),
    true,
  );
  assert.equal(
    Number(contextEnginePreparePromptPayload.variant_tokens?.proactive)
      >= Number(contextEnginePreparePromptPayload.variant_tokens?.forced),
    true,
  );
  assert.equal(
    Number(contextEnginePreparePromptPayload.variant_tokens?.forced)
      >= Number(contextEnginePreparePromptPayload.variant_tokens?.minimal),
    true,
  );
  assert.equal(
    Number(contextEnginePreparePromptPayload.selected_utilization)
      <= Number(contextEnginePreparePromptPayload.utilization),
    true,
  );
  assert.equal(
    Number(contextEnginePreparePromptPayload.effective_window_tokens) > 0,
    true,
  );
  logStep("context-engine-contract prepare-prompt");

  const contextEngineGraphCacheContractPayload = JSON.stringify({
    query: "add payment logging and retry context",
    max_rows: 4,
    snapshot: {
      root_path: "/tmp/context-graph-cache-contract",
      files: [
        {
          path: "src/payments/service.ts",
          content: [
            "import { requestPayment } from \"./gateway\";",
            "import { writeLog } from \"../infra/logger\";",
            "export async function processPayment(orderId: string) {",
            "  writeLog(orderId);",
            "  return requestPayment(orderId);",
            "}",
            "export const processRetry = async (orderId: string) => processPayment(orderId);",
          ].join("\n"),
        },
        {
          path: "src/payments/gateway.ts",
          content: [
            "export function requestPayment(orderId: string) {",
            "  return `ok:${orderId}`;",
            "}",
          ].join("\n"),
        },
        {
          path: "src/infra/logger.ts",
          content: [
            "export function writeLog(input: string) {",
            "  return input;",
            "}",
          ].join("\n"),
        },
      ],
    },
  });
  const contextEngineGraphCacheResult = runTsContract("context-engine-contract.ts", "graph-cache", [
    "--payload",
    contextEngineGraphCacheContractPayload,
  ]);
  const contextEngineGraphCachePayload = parseJsonOutput(
    "context-engine-contract graph-cache",
    contextEngineGraphCacheResult.stdout,
  );
  assert.equal(Array.isArray(contextEngineGraphCachePayload.first_pass?.symbol_rows), true);
  assert.equal(Array.isArray(contextEngineGraphCachePayload.first_pass?.dependency_rows), true);
  assert.equal(
    Array.isArray(contextEngineGraphCachePayload.second_pass?.symbol_rows),
    true,
  );
  assert.equal(
    Array.isArray(contextEngineGraphCachePayload.second_pass?.dependency_rows),
    true,
  );
  assert.deepEqual(
    contextEngineGraphCachePayload.second_pass?.symbol_rows,
    contextEngineGraphCachePayload.first_pass?.symbol_rows,
  );
  assert.deepEqual(
    contextEngineGraphCachePayload.second_pass?.dependency_rows,
    contextEngineGraphCachePayload.first_pass?.dependency_rows,
  );
  const firstStats = contextEngineGraphCachePayload.first_pass?.stats ?? {};
  const secondStats = contextEngineGraphCachePayload.second_pass?.stats ?? {};
  assert.equal(Number(firstStats.symbol_query?.miss) >= 1, true);
  assert.equal(Number(firstStats.dependency_query?.miss) >= 1, true);
  assert.equal(
    Number(secondStats.symbol_query?.hit)
      > Number(firstStats.symbol_query?.hit),
    true,
  );
  assert.equal(
    Number(secondStats.dependency_query?.hit)
      > Number(firstStats.dependency_query?.hit),
    true,
  );
  assert.equal(contextEngineGraphCachePayload.cache_reuse_observed, true);
  const graphCacheTiming = contextEngineGraphCachePayload.timing ?? {};
  assert.equal(Number.isFinite(Number(graphCacheTiming.first_pass_duration_ms)), true);
  assert.equal(Number.isFinite(Number(graphCacheTiming.second_pass_duration_ms)), true);
  assert.equal(
    Number(graphCacheTiming.second_pass_duration_ms)
      <= Number(graphCacheTiming.first_pass_duration_ms) + 500,
    true,
  );
  logStep("context-engine-contract graph-cache");

  const graphCacheConcurrency = 4;
  const graphCacheConcurrentResults = await Promise.all(
    Array.from({ length: graphCacheConcurrency }).map(() => runCommandAsync("npx", [
      "--yes",
      "--package",
      "tsx@4.20.6",
      "tsx",
      "gateway/src/extensions/contracts/context-engine-contract.ts",
      "graph-cache",
      "--payload",
      contextEngineGraphCacheContractPayload,
    ], { timeoutMs: 120_000 })),
  );
  for (let index = 0; index < graphCacheConcurrentResults.length; index += 1) {
    const concurrentResult = graphCacheConcurrentResults[index];
    assertSuccess(`context-engine-contract graph-cache concurrent-${String(index + 1)}`, concurrentResult);
    const concurrentPayload = parseJsonOutput(
      `context-engine-contract graph-cache concurrent-${String(index + 1)}`,
      concurrentResult.stdout,
    );
    assert.equal(concurrentPayload.cache_reuse_observed, true);
    assert.deepEqual(
      concurrentPayload.first_pass?.symbol_rows,
      contextEngineGraphCachePayload.first_pass?.symbol_rows,
    );
    assert.deepEqual(
      concurrentPayload.first_pass?.dependency_rows,
      contextEngineGraphCachePayload.first_pass?.dependency_rows,
    );
    assert.deepEqual(
      concurrentPayload.second_pass?.symbol_rows,
      contextEngineGraphCachePayload.second_pass?.symbol_rows,
    );
    assert.deepEqual(
      concurrentPayload.second_pass?.dependency_rows,
      contextEngineGraphCachePayload.second_pass?.dependency_rows,
    );
    const concurrentTiming = concurrentPayload.timing ?? {};
    assert.equal(Number.isFinite(Number(concurrentTiming.first_pass_duration_ms)), true);
    assert.equal(Number.isFinite(Number(concurrentTiming.second_pass_duration_ms)), true);
  }
  logStep("context-engine-contract graph-cache-concurrency", {
    concurrency: graphCacheConcurrency,
  });

  const symbolAstExtractResult = runTsContract("symbol-ast-contract.ts", "extract", [
    "--payload",
    JSON.stringify({
      file_path: "sample.ts",
      content: [
        "export interface ReportInput {",
        "  id: string;",
        "}",
        "export type ReportMode = \"fast\" | \"safe\";",
        "export enum ReportState { Draft, Done }",
        "export class ReportBuilder {}",
        "export function buildReport(input: ReportInput) {",
        "  return input.id;",
        "}",
        "const runAsync = async () => buildReport({ id: \"1\" });",
      ].join("\n"),
    }),
  ]);
  const symbolAstExtractPayload = parseJsonOutput(
    "symbol-ast-contract extract",
    symbolAstExtractResult.stdout,
  );
  assert.equal(typeof symbolAstExtractPayload.ast_runtime_available, "boolean");
  assert.equal(Array.isArray(symbolAstExtractPayload.symbols), true);
  if (symbolAstExtractPayload.ast_runtime_available === true) {
    const symbolPairs = new Set(
      symbolAstExtractPayload.symbols.map(
        (row) => `${String(row.kind)}:${String(row.symbol)}`,
      ),
    );
    assert.equal(symbolPairs.has("interface:ReportInput"), true);
    assert.equal(symbolPairs.has("type:ReportMode"), true);
    assert.equal(symbolPairs.has("enum:ReportState"), true);
    assert.equal(symbolPairs.has("class:ReportBuilder"), true);
    assert.equal(symbolPairs.has("fn:buildReport"), true);
    assert.equal(symbolPairs.has("const-fn:runAsync"), true);
  }
  logStep("symbol-ast-contract extract");

  const dependencyAstExtractResult = runTsContract("dependency-ast-contract.ts", "extract", [
    "--payload",
    JSON.stringify({
      file_path: "sample.ts",
      content: [
        "import fs from \"node:fs\";",
        "export { run } from \"./runner\";",
        "const pkg = require(\"./pkg\");",
        "async function load() {",
        "  return import(\"./lazy\");",
        "}",
        "void fs;",
        "void pkg;",
        "void load;",
      ].join("\n"),
    }),
  ]);
  const dependencyAstExtractPayload = parseJsonOutput(
    "dependency-ast-contract extract",
    dependencyAstExtractResult.stdout,
  );
  assert.equal(typeof dependencyAstExtractPayload.ast_runtime_available, "boolean");
  assert.equal(Array.isArray(dependencyAstExtractPayload.targets), true);
  if (dependencyAstExtractPayload.ast_runtime_available === true) {
    const targets = new Set(
      dependencyAstExtractPayload.targets.map((row) => String(row)),
    );
    assert.equal(targets.has("node:fs"), true);
    assert.equal(targets.has("./runner"), true);
    assert.equal(targets.has("./pkg"), true);
    assert.equal(targets.has("./lazy"), true);
  }
  logStep("dependency-ast-contract extract");

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
  const runtimeBuildResult = runCommand("cargo", ["build", "--manifest-path", "runtime/Cargo.toml"], {
    timeoutMs: 240_000,
  });
  assertSuccess("runtime build for ts-rust smoke", runtimeBuildResult);
  logStep("runtime build for ts-rust smoke");

  const runtimeInterruptContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/runtime-interrupt-contract.ts",
  ]);
  assertSuccess("runtime-interrupt-contract", runtimeInterruptContractResult);
  const runtimeInterruptContractPayload = parseJsonOutput(
    "runtime-interrupt-contract",
    runtimeInterruptContractResult.stdout,
  );
  assert.equal(runtimeInterruptContractPayload.interrupted, true);
  assert.equal(
    String(runtimeInterruptContractPayload.error).includes("class=turn_interrupted"),
    true,
  );
  assert.equal(Number(runtimeInterruptContractPayload.duration_ms) < 6_000, true);
  logStep("runtime-interrupt-contract", {
    duration_ms: runtimeInterruptContractPayload.duration_ms,
    call_count: runtimeInterruptContractPayload.call_count,
  });

  let statusPayload = null;
  let statusAttempts = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    statusAttempts = attempt;
    const statusResult = runContract("start-smoke-contract.mjs", "status-ts-rust", ["--repo-root", repoRoot], {
      timeoutMs: 240_000,
    });
    statusPayload = parseJsonOutput("start-smoke-contract status-ts-rust", statusResult.stdout);
    if (statusPayload.exit_code === 0) {
      break;
    }
    const isTransientTsBootstrap =
      statusPayload.exit_code === 86 &&
      String(statusPayload.stderr).includes("ts-dev-cli bootstrap failed");
    if (!isTransientTsBootstrap || attempt === 3) {
      break;
    }
    logRetry("start-smoke-contract status-ts-rust", attempt, 3, "transient ts-dev-cli bootstrap flake");
    await sleepMs(500);
  }
  assert.equal(statusPayload !== null, true);
  assert.equal(statusPayload.exit_code, 0);
  assert.equal(statusPayload.status_json_parse_ok, true);
  assert.equal(statusPayload.status_has_route_decision, true);
  assert.equal(statusPayload.status_has_route_observed, true);
  assert.equal(statusPayload.status_has_route_observed_provider_runtime_states, true);
  assert.equal(statusPayload.status_has_route_ordered_providers, true);
  assert.equal(statusPayload.status_has_route_failover, true);
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_route_observed_source_type)),
    true,
  );
  assert.equal(statusPayload.status_has_runtime_health_cache_stats, true);
  assert.equal(statusPayload.status_has_top_level_cache_stats, false);
  assert.equal(statusPayload.status_cache_stats_location, "runtime_health.cache_stats");
  assert.equal(statusPayload.status_prompt_cache_hint_attempted_type, "number");
  assert.equal(statusPayload.status_prompt_cache_window_hint_attempted_type, "number");
  assert.equal(statusPayload.status_has_context_graph_cache_stats, true);
  assert.equal(statusPayload.status_symbol_query_cache_hit_type, "number");
  assert.equal(statusPayload.status_symbol_declaration_cache_write_type, "number");
  assert.equal(statusPayload.status_dependency_query_cache_miss_type, "number");
  assert.equal(statusPayload.status_dependency_import_cache_evict_type, "number");
  assert.equal(statusPayload.status_has_context_graph_cache_window, true);
  assert.equal(statusPayload.status_context_graph_cache_window_path_type, "string");
  assert.equal(statusPayload.status_context_graph_cache_window_configured_size_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_window_entries_type, "number");
  assert.equal(
    ["string", "null"].includes(String(statusPayload.status_context_graph_cache_window_from_ts_type)),
    true,
  );
  assert.equal(
    ["string", "null"].includes(String(statusPayload.status_context_graph_cache_window_to_ts_type)),
    true,
  );
  assert.equal(statusPayload.status_context_graph_cache_window_delta_symbol_query_hit_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_window_delta_symbol_declaration_write_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_window_delta_dependency_query_miss_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_window_delta_dependency_import_evict_type, "number");
  assert.equal(statusPayload.status_has_context_engine, true);
  assert.equal(statusPayload.status_context_engine_enabled_type, "boolean");
  assert.equal(statusPayload.status_context_engine_profile_type, "string");
  assert.equal(statusPayload.status_context_engine_effective_window_type, "number");
  assert.equal(statusPayload.status_context_engine_threshold_hard_type, "number");
  assert.equal(statusPayload.status_context_engine_recovery_ptl_type, "number");
  assert.equal(statusPayload.status_context_engine_lineage_enabled_type, "boolean");
  assert.equal(statusPayload.status_context_engine_workspace_signals_enabled_type, "boolean");
  assert.equal(statusPayload.status_route_reason_type, "string");
  logStep("start-smoke-contract status-ts-rust", { attempts: statusAttempts });

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

  let failoverRunsPayload = null;
  let failoverRunsCalls = [];
  let failoverRunsAttempts = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    failoverRunsAttempts = attempt;
    const mockModel = await startMockModelServer();
    try {
      const failoverRunsResult = await runContractAsync(
        "start-smoke-contract.mjs",
        "failover-runs-ts-rust",
        ["--repo-root", repoRoot],
        {
          timeoutMs: 240_000,
          env: {
            ...process.env,
            GROBOT_BASE_URL: mockModel.baseUrl,
            GROBOT_API_KEY: "mock-runtime-key",
            GROBOT_MODEL: "mock-runtime-model",
            GROBOT_RUNTIME_HTTP_TIMEOUT_MS: "8000",
          },
        },
      );
      failoverRunsPayload = parseJsonOutput("start-smoke-contract failover-runs-ts-rust", failoverRunsResult.stdout);
      failoverRunsCalls = mockModel.getCalls();
      const isSuccess =
        failoverRunsPayload.exit_code === 0 &&
        String(failoverRunsPayload.stdout).includes("MOCK_RUNTIME_OK") &&
        failoverRunsCalls.length >= 1;
      if (isSuccess) {
        break;
      }
      if (attempt < 3) {
        const retryReason = `exit=${String(failoverRunsPayload.exit_code)} calls=${String(failoverRunsCalls.length)}`;
        logRetry("start-smoke-contract failover-runs-ts-rust", attempt, 3, retryReason);
        await sleepMs(500);
      }
    } finally {
      await mockModel.close();
    }
  }
  assert.equal(failoverRunsPayload !== null, true);
  assert.equal(failoverRunsPayload.exit_code, 0);
  assert.equal(String(failoverRunsPayload.stdout).includes("MOCK_RUNTIME_OK"), true);
  assert.equal(failoverRunsCalls.length >= 1, true);
  const lastCall = failoverRunsCalls[failoverRunsCalls.length - 1] ?? {};
  assert.equal(lastCall.method, "POST");
  assert.equal(lastCall.path, "/v1/chat/completions");
  assert.equal(lastCall.model, "mock-runtime-model");
  assert.equal(String(lastCall.authorization).startsWith("Bearer "), true);
  assert.equal(String(lastCall.prompt).includes("ts rust hard-cut"), true);
  logStep("start-smoke-contract failover-runs-ts-rust", { attempts: failoverRunsAttempts });

  const providerConfigResult = runContract(
    "runtime-smoke-contract.mjs",
    "provider-config-passthrough",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const providerConfigPayload = parseJsonOutput(
    "runtime-smoke-contract provider-config-passthrough",
    providerConfigResult.stdout,
  );
  assert.equal(providerConfigPayload.exit_code, 0);
  assert.equal(String(providerConfigPayload.stdout).includes("CONFIG_PROVIDER_OK"), true);
    assert.equal(Number(providerConfigPayload.runtime_call_count) >= 1, true);
    assert.equal(providerConfigPayload.runtime_last_call?.model, "provider-config-model");
    assert.equal(String(providerConfigPayload.runtime_last_call?.authorization), "Bearer provider-config-key");
    logStep("runtime-smoke-contract provider-config-passthrough");

    const providerPoolResult = runContract(
      "runtime-smoke-contract.mjs",
      "provider-pool-load-balance",
      ["--repo-root", repoRoot],
      { timeoutMs: 240_000 },
    );
    const providerPoolPayload = parseJsonOutput(
      "runtime-smoke-contract provider-pool-load-balance",
      providerPoolResult.stdout,
    );
    assert.equal(providerPoolPayload.exit_code, 0);
    assert.equal(Number(providerPoolPayload.runtime_call_count) >= Number(providerPoolPayload.turn_count), true);
    assert.equal(Number(providerPoolPayload.unique_authorization_count) >= 3, true);
    logStep("runtime-smoke-contract provider-pool-load-balance", {
      unique_keys: providerPoolPayload.unique_authorization_count,
      calls: providerPoolPayload.runtime_call_count,
    });

    const upstreamFailureResult = runContract("start-smoke-contract.mjs", "failover-runs-ts-rust", ["--repo-root", repoRoot], {
      timeoutMs: 240_000,
      env: {
      ...process.env,
      GROBOT_BASE_URL: "http://127.0.0.1:9/v1",
      GROBOT_API_KEY: "mock-runtime-key",
      GROBOT_MODEL: "mock-runtime-model",
      GROBOT_RUNTIME_HTTP_TIMEOUT_MS: "1200",
    },
  });
  const upstreamFailurePayload = parseJsonOutput("start-smoke-contract failover-runs-ts-rust upstream-failure", upstreamFailureResult.stdout);
  assert.equal(upstreamFailurePayload.exit_code !== 0, true);
  assert.equal(String(upstreamFailurePayload.stderr).includes("runtime rpc error -32001"), true);
  assert.equal(String(upstreamFailurePayload.stderr).includes("class=upstream_connect_failed"), true);
  logStep("start-smoke-contract failover-runs-ts-rust-upstream-failure");

  const toolCallFailureResult = runContract(
    "runtime-smoke-contract.mjs",
    "tool-call-fail-fast",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const toolCallFailurePayload = parseJsonOutput(
    "runtime-smoke-contract tool-call-fail-fast",
    toolCallFailureResult.stdout,
  );
  assert.equal(toolCallFailurePayload.exit_code !== 0, true);
  assert.equal(String(toolCallFailurePayload.stderr).includes("class=tool_disabled"), true);
  assert.equal(Number(toolCallFailurePayload.runtime_call_count) >= 1, true);
  logStep("runtime-smoke-contract tool-call-fail-fast");

  const toolCallSuccessResult = runContract(
    "runtime-smoke-contract.mjs",
    "tool-call-success",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const toolCallSuccessPayload = parseJsonOutput(
    "runtime-smoke-contract tool-call-success",
    toolCallSuccessResult.stdout,
  );
  assert.equal(toolCallSuccessPayload.exit_code, 0);
  assert.equal(String(toolCallSuccessPayload.stdout).includes("TOOL_LOOP_RUNTIME_OK"), true);
  assert.equal(Number(toolCallSuccessPayload.runtime_call_count) >= 2, true);
  logStep("runtime-smoke-contract tool-call-success");

  const mcpCallSuccessResult = runContract(
    "runtime-smoke-contract.mjs",
    "mcp-call-success",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const mcpCallSuccessPayload = parseJsonOutput(
    "runtime-smoke-contract mcp-call-success",
    mcpCallSuccessResult.stdout,
  );
  assert.equal(mcpCallSuccessPayload.exit_code, 0);
  assert.equal(String(mcpCallSuccessPayload.assistant_message).includes("MCP_CALL_RUNTIME_OK"), true);
  assert.equal(Number(mcpCallSuccessPayload.runtime_call_count) >= 2, true);
  assert.equal(String(mcpCallSuccessPayload.runtime_last_body).includes("echo:hello-mcp"), true);
  logStep("runtime-smoke-contract mcp-call-success");

  const mcpCallTimeoutResult = runContract(
    "runtime-smoke-contract.mjs",
    "mcp-call-timeout",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const mcpCallTimeoutPayload = parseJsonOutput(
    "runtime-smoke-contract mcp-call-timeout",
    mcpCallTimeoutResult.stdout,
  );
  assert.equal(mcpCallTimeoutPayload.exit_code, 0);
  assert.equal(mcpCallTimeoutPayload.error_code, -32001);
  assert.equal(mcpCallTimeoutPayload.error_class, "mcp_timeout");
  assert.equal(Number(mcpCallTimeoutPayload.runtime_call_count) >= 1, true);
  logStep("runtime-smoke-contract mcp-call-timeout");

  const mcpSessionIdleReapResult = runContract(
    "runtime-smoke-contract.mjs",
    "mcp-session-idle-reap",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const mcpSessionIdleReapPayload = parseJsonOutput(
    "runtime-smoke-contract mcp-session-idle-reap",
    mcpSessionIdleReapResult.stdout,
  );
  assert.equal(mcpSessionIdleReapPayload.exit_code, 0);
  assert.equal(Number(mcpSessionIdleReapPayload.rpc_count), 2);
  assert.equal(Number(mcpSessionIdleReapPayload.tool_payload_count), 2);
  assert.equal(mcpSessionIdleReapPayload.first_error_code, null);
  assert.equal(mcpSessionIdleReapPayload.second_error_code, null);
  assert.equal(mcpSessionIdleReapPayload.first_session_reused, false);
  assert.equal(mcpSessionIdleReapPayload.second_session_reused, false);
  assert.equal(
    Number(mcpSessionIdleReapPayload.first_session_pid) > 0 &&
      Number(mcpSessionIdleReapPayload.second_session_pid) > 0,
    true,
  );
  assert.equal(
    Number(mcpSessionIdleReapPayload.first_session_pid) !== Number(mcpSessionIdleReapPayload.second_session_pid),
    true,
  );
  logStep("runtime-smoke-contract mcp-session-idle-reap");

  const mcpServersSuccessResult = runContract(
    "runtime-smoke-contract.mjs",
    "mcp-servers-success",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const mcpServersSuccessPayload = parseJsonOutput(
    "runtime-smoke-contract mcp-servers-success",
    mcpServersSuccessResult.stdout,
  );
  assert.equal(mcpServersSuccessPayload.exit_code, 0);
  assert.equal(String(mcpServersSuccessPayload.assistant_message).includes("MCP_SERVERS_RUNTIME_OK"), true);
  assert.equal(Number(mcpServersSuccessPayload.runtime_call_count) >= 2, true);
  assert.equal(String(mcpServersSuccessPayload.runtime_last_body).includes("\\\"ready_count\\\":1"), true);
  logStep("runtime-smoke-contract mcp-servers-success");

  const toolCallDiagnosticResult = runContract(
    "runtime-smoke-contract.mjs",
    "tool-call-diagnostic-events",
    ["--repo-root", repoRoot],
    { timeoutMs: 240_000 },
  );
  const toolCallDiagnosticPayload = parseJsonOutput(
    "runtime-smoke-contract tool-call-diagnostic-events",
    toolCallDiagnosticResult.stdout,
  );
  assert.equal(toolCallDiagnosticPayload.exit_code, 0);
  assert.equal(toolCallDiagnosticPayload.error_code, -32001);
  assert.equal(toolCallDiagnosticPayload.error_class, "tool_call_not_supported");
  assert.equal(Array.isArray(toolCallDiagnosticPayload.event_types), true);
  assert.equal(toolCallDiagnosticPayload.event_types.includes("tool_start"), true);
  assert.equal(toolCallDiagnosticPayload.event_types.includes("tool_end"), true);
  assert.equal(toolCallDiagnosticPayload.event_types.includes("turn_failed"), true);
  logStep("runtime-smoke-contract tool-call-diagnostic-events");

  const planModeFlowResult = runContract("start-smoke-contract.mjs", "start-plan-mode-flow", [
    "--repo-root",
    repoRoot,
  ]);
  const planModeFlowPayload = parseJsonOutput(
    "start-smoke-contract start-plan-mode-flow",
    planModeFlowResult.stdout,
  );
  assert.equal(planModeFlowPayload.exit_code, 0);
  assert.equal(Number(planModeFlowPayload.plan_entry_count) >= 1, true);
  assert.equal(planModeFlowPayload.plan_active_exists, true);
  assert.equal(String(planModeFlowPayload.plan_active_id || "").length === 0, true);
  assert.equal(planModeFlowPayload.review_failed_marker_seen, true);
  assert.equal(planModeFlowPayload.review_blocked_marker_seen, false);
  assert.equal(planModeFlowPayload.plan_cancelled_marker_seen, true);
  assert.equal(planModeFlowPayload.plan_final_status_line_seen, true);
  assert.equal(planModeFlowPayload.plan_last_status, "discarded");
  assert.equal(Number(planModeFlowPayload.plan_last_review_fail_count) >= 1, true);
  assert.equal(Number(planModeFlowPayload.plan_last_blocked_count), 0);
  assert.equal(planModeFlowPayload.events_has_plan_review_failed, true);
  assert.equal(planModeFlowPayload.events_has_plan_mode_cancelled, true);
  assert.equal(Number(planModeFlowPayload.events_count) >= 1, true);
  assert.equal(typeof planModeFlowPayload.events_path, "string");
  assert.equal(String(planModeFlowPayload.events_path).trim().length > 0, true);
  logStep("start-smoke-contract start-plan-mode-flow", {
    events: planModeFlowPayload.events_count,
  });

  const sessionCommandFallbackResult = runContract(
    "start-smoke-contract.mjs",
    "start-interactive-session-commands-fallback-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const sessionCommandFallbackPayload = parseJsonOutput(
    "start-smoke-contract start-interactive-session-commands-fallback-flow",
    sessionCommandFallbackResult.stdout,
  );
  assert.equal(sessionCommandFallbackPayload.exit_code, 0);
  assert.equal(Number(sessionCommandFallbackPayload.session_count) >= 2, true);
  assert.equal(sessionCommandFallbackPayload.has_switch_usage, true);
  assert.equal(sessionCommandFallbackPayload.has_continue_usage, true);
  assert.equal(sessionCommandFallbackPayload.has_sessions_overview, true);
  assert.equal(sessionCommandFallbackPayload.has_session_title_main, true);
  assert.equal(sessionCommandFallbackPayload.has_session_title_untitled, true);
  logStep("start-smoke-contract start-interactive-session-commands-fallback-flow");

  const sessionMenuViewModelResult = runContract(
    "start-smoke-contract.mjs",
    "start-session-menu-view-model-contract",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const sessionMenuViewModelPayload = parseJsonOutput(
    "start-smoke-contract start-session-menu-view-model-contract",
    sessionMenuViewModelResult.stdout,
  );
  assert.equal(sessionMenuViewModelPayload.exit_code, 0);
  assert.equal(sessionMenuViewModelPayload.sessions_title, "Session Manager");
  assert.equal(sessionMenuViewModelPayload.switch_title, "Switch Session");
  assert.equal(sessionMenuViewModelPayload.continue_title, "Continue From Session");
  assert.equal(sessionMenuViewModelPayload.sessions_has_create_item, true);
  assert.equal(sessionMenuViewModelPayload.continue_has_create_item, false);
  assert.equal(sessionMenuViewModelPayload.sessions_summary_visible, true);
  assert.equal(sessionMenuViewModelPayload.switch_includes_session_key, true);
  assert.equal(sessionMenuViewModelPayload.sessions_omits_session_key, true);
  assert.equal(sessionMenuViewModelPayload.continue_current_skip_hint, true);
  assert.equal(Number(sessionMenuViewModelPayload.sessions_initial_index), 1);
  assert.equal(Number(sessionMenuViewModelPayload.continue_initial_index), 0);
  assert.equal(Number(sessionMenuViewModelPayload.sessions_item_count), 3);
  assert.equal(Number(sessionMenuViewModelPayload.continue_item_count), 2);
  logStep("start-smoke-contract start-session-menu-view-model-contract");

  const planConcurrencyFlowResult = runContract("start-smoke-contract.mjs", "start-plan-concurrency-flow", [
    "--repo-root",
    repoRoot,
  ]);
  const planConcurrencyPayload = parseJsonOutput(
    "start-smoke-contract start-plan-concurrency-flow",
    planConcurrencyFlowResult.stdout,
  );
  assert.equal(planConcurrencyPayload.exit_code, 0);
  assert.equal(Number(planConcurrencyPayload.append_attempts) >= 4, true);
  assert.equal(Number(planConcurrencyPayload.append_hits), Number(planConcurrencyPayload.append_attempts));
  assert.equal(Number(planConcurrencyPayload.lock_timeout_count), 0);
  assert.equal(Number(planConcurrencyPayload.events_count) >= 1, true);
  assert.equal(typeof planConcurrencyPayload.events_path, "string");
  assert.equal(String(planConcurrencyPayload.events_path).trim().length > 0, true);
  logStep("start-smoke-contract start-plan-concurrency-flow", {
    attempts: planConcurrencyPayload.append_attempts,
    hits: planConcurrencyPayload.append_hits,
  });

  const planEventsReportPath = resolve(makeTempDir("plan-events-report"), "report.json");
  const planEventsReportResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/governance/evals/plan-events-report.ts",
    "--events-path",
    String(planModeFlowPayload.events_path),
    "--events-path",
    String(planConcurrencyPayload.events_path),
    "--output",
    planEventsReportPath,
    "--print-json",
  ]);
  assertSuccess("plan-events-report", planEventsReportResult);
  const planEventsReportPayload = parseJsonOutput("plan-events-report", planEventsReportResult.stdout);
  assert.equal(Number(planEventsReportPayload?.totals?.events_count) >= 2, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_mode_entered_count) >= 1, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_created_count) >= 1, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_progress_appended_count) >= 1, true);
  assert.equal(
    Number(planEventsReportPayload?.totals?.plan_apply_succeeded_count)
      <= Number(planEventsReportPayload?.totals?.plan_apply_started_count),
    true,
  );
  assert.equal(Number(planEventsReportPayload?.totals?.files_count), 2);
  assert.equal(Number(planEventsReportPayload?.totals?.missing_files_count), 0);
  assert.equal(Number(planEventsReportPayload?.totals?.invalid_lines), 0);
  assert.equal(Number(planEventsReportPayload?.totals?.sessions_count) >= 1, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_review_failed_count) >= 1, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_review_passed_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.review_failed_rate ?? 0) >= 0, true);
  logStep("plan-events-report", {
    files: planEventsReportPayload?.totals?.files_count,
    events: planEventsReportPayload?.totals?.events_count,
    sessions: planEventsReportPayload?.totals?.sessions_count,
  });

  for (const policyPath of [
    "gateway/evals/plan_events_policy.dev.json",
    "gateway/evals/plan_events_policy.ci.json",
    "gateway/evals/plan_events_policy.prod.json",
  ]) {
    const planEventsPolicyGuardResult = runCommand("npx", [
      "--yes",
      "--package",
      "tsx@4.20.6",
      "tsx",
      "gateway/src/governance/evals/plan-events-policy-guard.ts",
      "--policy",
      policyPath,
      "--report",
      planEventsReportPath,
      "--print-json",
    ]);
    assertSuccess(`plan-events-policy-guard ${policyPath}`, planEventsPolicyGuardResult);
    const planEventsPolicyGuardPayload = parseJsonOutput(
      `plan-events-policy-guard ${policyPath}`,
      planEventsPolicyGuardResult.stdout,
    );
    assert.equal(planEventsPolicyGuardPayload?.status, "ok");
    assert.equal(Number(planEventsPolicyGuardPayload?.violations_count), 0);
    assert.equal(
      Number(planEventsPolicyGuardPayload?.metrics?.review_failed_rate ?? 0) >= 0,
      true,
    );
    assert.equal(
      typeof planEventsPolicyGuardPayload?.policy_overrides,
      "object",
    );
    assert.equal(
      typeof planEventsPolicyGuardPayload?.policy_override_scope,
      "object",
    );
    assert.equal(
      planEventsPolicyGuardPayload?.policy_override_scope?.allow_source,
      "default_all",
    );
    assert.equal(
      planEventsPolicyGuardPayload?.policy_override_scope?.deny_source,
      "default_none",
    );
    assert.equal(
      Array.isArray(planEventsPolicyGuardPayload?.policy_override_scope?.allow_fields),
      true,
    );
    assert.equal(
      Array.isArray(planEventsPolicyGuardPayload?.policy_override_scope?.deny_fields),
      true,
    );
    assert.equal(
      planEventsPolicyGuardPayload?.policy_override_scope?.allow_fields?.includes("max_review_failed_rate"),
      true,
    );
    assert.equal(
      Number(planEventsPolicyGuardPayload?.policy_override_scope?.deny_fields?.length ?? 0),
      0,
    );
    logStep("plan-events-policy-guard", {
      profile: planEventsPolicyGuardPayload?.profile,
      policy: policyPath,
      violations: planEventsPolicyGuardPayload?.violations_count,
    });
  }

  const strictPlanEventsPolicyGuardResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/governance/evals/plan-events-policy-guard.ts",
    "--policy",
    "gateway/evals/plan_events_policy.ci.json",
    "--report",
    planEventsReportPath,
    "--print-json",
  ], {
    env: {
      ...process.env,
      GROBOT_PLAN_EVENTS_MAX_REVIEW_FAILED_RATE: "0.2",
    },
  });
  assert.equal(strictPlanEventsPolicyGuardResult.code !== 0, true);
  const strictPlanEventsPolicyGuardPayload = parseJsonOutput(
    "plan-events-policy-guard strict env override",
    strictPlanEventsPolicyGuardResult.stdout,
  );
  assert.equal(strictPlanEventsPolicyGuardPayload?.status, "error");
  assert.equal(Number(strictPlanEventsPolicyGuardPayload?.violations_count) >= 1, true);
  assert.equal(
    Array.isArray(strictPlanEventsPolicyGuardPayload?.violations) &&
      strictPlanEventsPolicyGuardPayload.violations.some((line) => String(line).includes("max_review_failed_rate 0.2")),
    true,
  );
  assert.equal(
    Number(strictPlanEventsPolicyGuardPayload?.policy_overrides?.max_review_failed_rate),
    0.2,
  );
  assert.equal(
    strictPlanEventsPolicyGuardPayload?.policy_override_scope?.allow_source,
    "default_all",
  );
  assert.equal(
    strictPlanEventsPolicyGuardPayload?.policy_override_scope?.deny_source,
    "default_none",
  );
  logStep("plan-events-policy-guard env-override");

  const scopedPlanEventsPolicyGuardResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/governance/evals/plan-events-policy-guard.ts",
    "--policy",
    "gateway/evals/plan_events_policy.ci.json",
    "--report",
    planEventsReportPath,
    "--print-json",
  ], {
    env: {
      ...process.env,
      GROBOT_PLAN_EVENTS_POLICY_OVERRIDE_ALLOW: "max_review_failed_rate,max_guard_denied_rate",
      GROBOT_PLAN_EVENTS_POLICY_OVERRIDE_DENY: "max_invalid_lines",
      GROBOT_PLAN_EVENTS_MAX_REVIEW_FAILED_RATE: "0.99",
    },
  });
  assertSuccess("plan-events-policy-guard scoped-env-override", scopedPlanEventsPolicyGuardResult);
  const scopedPlanEventsPolicyGuardPayload = parseJsonOutput(
    "plan-events-policy-guard scoped env override",
    scopedPlanEventsPolicyGuardResult.stdout,
  );
  assert.equal(scopedPlanEventsPolicyGuardPayload?.status, "ok");
  assert.equal(
    Number(scopedPlanEventsPolicyGuardPayload?.policy_overrides?.max_review_failed_rate),
    0.99,
  );
  assert.equal(
    scopedPlanEventsPolicyGuardPayload?.policy_override_scope?.allow_source,
    "env",
  );
  assert.equal(
    scopedPlanEventsPolicyGuardPayload?.policy_override_scope?.deny_source,
    "env",
  );
  assert.equal(
    scopedPlanEventsPolicyGuardPayload?.policy_override_scope?.allow_fields?.includes("max_review_failed_rate"),
    true,
  );
  assert.equal(
    scopedPlanEventsPolicyGuardPayload?.policy_override_scope?.allow_fields?.includes("max_guard_denied_rate"),
    true,
  );
  assert.equal(
    scopedPlanEventsPolicyGuardPayload?.policy_override_scope?.deny_fields?.includes("max_invalid_lines"),
    true,
  );
  logStep("plan-events-policy-guard scoped-env-override");

  const allowBlockedPolicyGuardResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/governance/evals/plan-events-policy-guard.ts",
    "--policy",
    "gateway/evals/plan_events_policy.ci.json",
    "--report",
    planEventsReportPath,
    "--print-json",
  ], {
    env: {
      ...process.env,
      GROBOT_PLAN_EVENTS_POLICY_OVERRIDE_ALLOW: "max_guard_denied_rate",
      GROBOT_PLAN_EVENTS_MAX_REVIEW_FAILED_RATE: "0.2",
    },
  });
  assert.equal(allowBlockedPolicyGuardResult.code !== 0, true);
  assert.equal(
    allowBlockedPolicyGuardResult.stderr.includes("GROBOT_PLAN_EVENTS_POLICY_OVERRIDE_ALLOW"),
    true,
  );
  assert.equal(
    allowBlockedPolicyGuardResult.stderr.includes("max_review_failed_rate"),
    true,
  );
  logStep("plan-events-policy-guard allowlist-block");

  const denyBlockedPolicyGuardResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/governance/evals/plan-events-policy-guard.ts",
    "--policy",
    "gateway/evals/plan_events_policy.ci.json",
    "--report",
    planEventsReportPath,
    "--print-json",
  ], {
    env: {
      ...process.env,
      GROBOT_PLAN_EVENTS_POLICY_OVERRIDE_DENY: "max_review_failed_rate",
      GROBOT_PLAN_EVENTS_MAX_REVIEW_FAILED_RATE: "0.2",
    },
  });
  assert.equal(denyBlockedPolicyGuardResult.code !== 0, true);
  assert.equal(
    denyBlockedPolicyGuardResult.stderr.includes("GROBOT_PLAN_EVENTS_POLICY_OVERRIDE_DENY"),
    true,
  );
  assert.equal(
    denyBlockedPolicyGuardResult.stderr.includes("max_review_failed_rate"),
    true,
  );
  logStep("plan-events-policy-guard denylist-block");

  const mcpInstructionFlowResult = runContract("start-smoke-contract.mjs", "start-mcp-instruction-events-flow", [
    "--repo-root",
    repoRoot,
  ]);
  const mcpInstructionFlowPayload = parseJsonOutput(
    "start-smoke-contract start-mcp-instruction-events-flow",
    mcpInstructionFlowResult.stdout,
  );
  assert.equal(mcpInstructionFlowPayload.project_pack_loaded_project, true);
  assert.equal(mcpInstructionFlowPayload.project_prompt_injected, true);
  assert.equal(mcpInstructionFlowPayload.fallback_used, true);
  assert.equal(mcpInstructionFlowPayload.fallback_pack_loaded_global, true);
  assert.equal(mcpInstructionFlowPayload.fallback_prompt_injected, true);
  assert.equal(mcpInstructionFlowPayload.missing_pack_event, true);
  assert.equal(mcpInstructionFlowPayload.missing_prompt_injected, false);
  assert.equal(mcpInstructionFlowPayload.strict_failure_seen, false);
  logStep("start-smoke-contract start-mcp-instruction-events-flow");

  const preSendHeadTrimResult = runContract("start-smoke-contract.mjs", "start-context-pre-send-head-trim-flow", [
    "--repo-root",
    repoRoot,
  ]);
  const preSendHeadTrimPayload = parseJsonOutput(
    "start-smoke-contract start-context-pre-send-head-trim-flow",
    preSendHeadTrimResult.stdout,
  );
  assert.equal(preSendHeadTrimPayload.pre_send_head_trim_seen, true);
  assert.equal(
    Number(preSendHeadTrimPayload.pre_send_head_trim_retries) >= 1,
    true,
  );
  assert.equal(
    Number(preSendHeadTrimPayload.prompt_prepared_pretrim_retries) >= 1,
    true,
  );
  assert.equal(
    Number(preSendHeadTrimPayload.pre_send_estimated_tokens)
      > Number(preSendHeadTrimPayload.pre_send_effective_window),
    true,
  );
  assert.equal(
    ["normal", "proactive", "forced", "minimal"].includes(
      String(preSendHeadTrimPayload.pre_send_head_trim_stage),
    ),
    true,
  );
  logStep("start-smoke-contract start-context-pre-send-head-trim-flow");

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
    "runtime-smoke-contract.mjs",
    "handoff-contract.mjs",
      "history-compaction-contract.mjs",
      "semantic-search-regression-contract.mjs",
      "browser-structured-mcp-contract.mjs",
      "bridge-cli-contract.mjs",
      "bridge-error-codes-schema-contract.mjs",
      "plan-events-policy-guard-contract.mjs",
      "ask-user-tool-contract.ts",
      "ga-skill-prompt-contract.ts",
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
  runReporter = reporter;
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
    runReporter = null;
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
