#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function writeFixtureFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
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
    String(semanticSearchQualityRegressionPayload.index_required_error).includes("semantic_index_required"),
    true,
  );
  assert.equal(
    String(semanticSearchQualityRegressionPayload.zh_index_required_error).includes("semantic_index_required"),
    true,
  );
  assert.equal(
    String(semanticSearchQualityRegressionPayload.legacy_section_error).includes("legacy [context_retrieval]"),
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
  assert.equal(sessionInteractiveDispatchPayload.resume_prefix_miss_hits_run_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_prefix_miss_opened_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_prefix_miss_hits_run_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_prefix_miss_opened_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.model_prefix_miss_hits_run_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.model_prefix_miss_opened_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.plan_prefix_miss_hits_run_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_prefix_miss_entered_plan, false);
  assert.equal(sessionInteractiveDispatchPayload.switch_menu_opened, true);
  assert.equal(sessionInteractiveDispatchPayload.continue_menu_opened, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_menu_opened, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_menu_opened, true);
  assert.equal(sessionInteractiveDispatchPayload.switch_legacy_with_id_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.switch_legacy_with_id_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.switch_legacy_with_id_skips_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.continue_legacy_with_id_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.continue_legacy_with_id_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.continue_legacy_with_id_skips_direct_continue, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_legacy_with_id_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_legacy_with_id_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_legacy_with_id_opened_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.resume_legacy_with_id_tty_warned, false);
  assert.equal(sessionInteractiveDispatchPayload.resume_legacy_with_id_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_legacy_with_id_tty_opened_resume_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.resume_menu_alias_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_prefix_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_keyword_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_keyword_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_compact_title_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_compact_id_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_compact_id_underscore_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_compact_id_space_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_quoted_title_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_updated_at_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_updated_at_digits_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_updated_at_digits_contains_tty_direct_switch, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_separator_only_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_separator_only_tty_direct_switch, false);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_separator_only_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_separator_only_tty_no_match_message, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_search_separator_only_tty_no_match_has_tip, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_active_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_active_tty_direct_switch, false);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_active_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_active_tty_message_has_prefix, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_active_tty_message_has_menu_hint, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_missing_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_missing_tty_direct_switch, false);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_missing_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_missing_tty_no_match_has_tip, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_multiple_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_multiple_tty_direct_switch, false);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_multiple_tty_includes_quick_pick, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_multiple_tty_includes_title_preview, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_multiple_tty_includes_summary_preview, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_multiple_overflow_tty_includes_overflow_line, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_multiple_overflow_tty_includes_quick_pick_header, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_multiple_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_empty_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_empty_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.resume_find_empty_tty_usage_has_updated_at, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_tty_exact_checkpoint, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_tty_opened_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_no_active_session_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_no_active_session_tty_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_no_active_session_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_no_active_session_surface_is_human, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_no_quick_path_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_no_quick_path_tty_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_no_quick_path_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_no_quick_path_surface_is_human, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_missing_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_missing_tty_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_missing_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_missing_tty_no_match_has_tip, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_missing_surface_is_human, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_multiple_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_multiple_tty_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_multiple_tty_includes_quick_pick, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_multiple_tty_includes_assistant_preview, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_multiple_surface_is_human, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_multiple_overflow_tty_includes_overflow_line, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_multiple_overflow_tty_includes_quick_pick_header, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_warning_surfaces_avoid_legacy_marker, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_query_multiple_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_find_query_mode_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_user_text_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_assistant_text_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_user_text_compact_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_checkpoint_id_compact_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_checkpoint_id_underscore_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_checkpoint_id_space_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_checkpoint_id_quoted_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_created_at_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_created_at_digits_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_created_at_digits_contains_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_separator_only_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_separator_only_tty_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_separator_only_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_separator_only_tty_no_match_message, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_search_separator_only_tty_no_match_has_tip, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_find_mode_keyword_query_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_find_mode_keyword_query_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_find_mode_keyword_query_no_match_message, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_find_mode_keyword_query_no_match_has_tip, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_find_mode_keyword_query_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_summarize_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_code_mode_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_query_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_search_created_at_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_search_checkpoint_id_compact_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_search_checkpoint_id_underscore_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_search_checkpoint_id_space_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_search_checkpoint_id_quoted_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_search_created_at_digits_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_search_created_at_digits_contains_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_find_empty_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_find_empty_tty_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.checkpoint_find_empty_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_find_empty_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_find_empty_tty_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_find_empty_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_mode_only_tty_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_mode_only_tty_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_mode_only_tty_opened_menu, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_with_args_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.rewind_with_args_opened_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.rewind_with_args_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.model_menu_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.model_legacy_reset_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.model_legacy_reset_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.plan_root_tty_enters_plan_directly, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_open_alias_tty_enters_plan_when_outside, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_open_alias_tty_skips_editor_when_outside, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_open_alias_tty_in_plan_opened_editor, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_open_alias_tty_in_plan_skips_plan_entry, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_open_alias_non_tty_warned, false);
  assert.equal(sessionInteractiveDispatchPayload.plan_open_alias_non_tty_enters_plan_when_outside, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_open_alias_non_tty_in_plan_dispatched_status, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_goal_tty_enters_plan_directly, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_goal_tty_in_plan_shows_current_plan, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_goal_tty_in_plan_skips_new_plan, true);
  assert.equal(sessionInteractiveDispatchPayload.blocked_plan_mode_command_surface_is_human, true);
  assert.equal(sessionInteractiveDispatchPayload.blocked_plan_mode_command_avoids_legacy_marker, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_natural_execute_in_plan_mode_dispatches_apply, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_natural_execute_in_plan_mode_skips_plan_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_refine_in_plan_mode_dispatches_plan_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_refine_in_plan_mode_passes_input_pause, true);
  assert.equal(sessionInteractiveDispatchPayload.plan_goal_tty_passes_input_pause, true);
  assert.equal(sessionInteractiveDispatchPayload.exit_command_breaks_loop, true);
  assert.equal(sessionInteractiveDispatchPayload.exit_command_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.exit_alias_slash_quit_breaks_loop, true);
  assert.equal(sessionInteractiveDispatchPayload.exit_alias_slash_quit_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.exit_alias_quit_breaks_loop, true);
  assert.equal(sessionInteractiveDispatchPayload.commands_menu_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.commands_list_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.ask_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.ask_unknown_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.ask_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.ask_invalid_args_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.ask_invalid_args_usage_hint, true);
  assert.equal(sessionInteractiveDispatchPayload.ask_invalid_args_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.skill_creator_with_demand_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.skill_creator_with_demand_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.skill_creator_empty_tty_prompted, true);
  assert.equal(sessionInteractiveDispatchPayload.skill_creator_empty_tty_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.skill_creator_empty_non_tty_usage, true);
  assert.equal(sessionInteractiveDispatchPayload.skill_creator_empty_non_tty_surface_is_human, true);
  assert.equal(sessionInteractiveDispatchPayload.skill_creator_empty_non_tty_prompted, false);
  assert.equal(sessionInteractiveDispatchPayload.skill_creator_empty_non_tty_dispatched, false);
  assert.equal(sessionInteractiveDispatchPayload.init_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.init_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.context_dispatched_to_status, true);
  assert.equal(sessionInteractiveDispatchPayload.context_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.memory_dispatched_to_status, true);
  assert.equal(sessionInteractiveDispatchPayload.memory_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.skills_dispatched_to_status, true);
  assert.equal(sessionInteractiveDispatchPayload.skills_dispatched_to_stdout, true);
  assert.equal(sessionInteractiveDispatchPayload.skills_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.mcp_dispatched_to_status, true);
  assert.equal(sessionInteractiveDispatchPayload.mcp_dispatched_to_stdout, true);
  assert.equal(sessionInteractiveDispatchPayload.mcp_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.user_command_checked, true);
  assert.equal(sessionInteractiveDispatchPayload.user_command_hits_run_turn, false);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_blocked_status_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_blocked_status_opened_menu, false);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_blocked_status_hint_has_reply_guidance, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_blocked_status_hint_has_prompt_summary, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_blocked_status_hint_has_short_menu_hint, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_help_allowed, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_help_blocked_warned, false);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_interrupt_allowed, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_sessions_allowed, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_resume_allowed, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_rewind_allowed, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_ask_allowed, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_ask_invalid_args_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_ask_invalid_args_dispatched, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_plain_text_runs_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_plain_text_blocked_warned, false);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_empty_opens_selector, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_empty_selection_runs_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_question_mark_opens_selector, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_question_mark_selection_runs_turn, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_burst_first_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_burst_second_suppressed, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_burst_third_warned, true);
  assert.equal(sessionInteractiveDispatchPayload.pending_ask_burst_third_mentions_suppressed_count, true);
  logStep("session-interactive-dispatch-contract");

  const sessionResumeStartupContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/session-resume-startup-contract.ts",
  ]);
  assertSuccess("session-resume-startup-contract", sessionResumeStartupContractResult);
  const sessionResumeStartupContractPayload = parseJsonOutput(
    "session-resume-startup-contract",
    sessionResumeStartupContractResult.stdout,
  );
  assert.equal(sessionResumeStartupContractPayload.no_intent_skips_resume_target, true);
  assert.equal(sessionResumeStartupContractPayload.no_intent_skips_notice, true);
  assert.equal(sessionResumeStartupContractPayload.resume_default_targets_latest_non_active, true);
  assert.equal(sessionResumeStartupContractPayload.resume_last_targets_latest_non_active, true);
  assert.equal(sessionResumeStartupContractPayload.resume_exact_id_targeted, true);
  assert.equal(sessionResumeStartupContractPayload.resume_single_query_match_targeted, true);
  assert.equal(sessionResumeStartupContractPayload.resume_multiple_query_auto_selects_top, true);
  assert.equal(sessionResumeStartupContractPayload.resume_multiple_query_requires_disambiguation, true);
  assert.equal(sessionResumeStartupContractPayload.resume_multiple_query_candidates_exposed, true);
  assert.equal(sessionResumeStartupContractPayload.resume_multiple_query_notice_contains_tip, true);
  assert.equal(sessionResumeStartupContractPayload.resume_multiple_query_notice_no_autoselect_literal, true);
  assert.equal(
    sessionResumeStartupContractPayload.resume_no_match_fallback_targets_latest_non_active,
    true,
  );
  assert.equal(sessionResumeStartupContractPayload.resume_no_match_fallback_has_notice, true);
  assert.equal(sessionResumeStartupContractPayload.resume_no_match_without_fallback_has_notice, true);
  assert.equal(sessionResumeStartupContractPayload.resume_all_can_match_active_title, true);
  assert.equal(sessionResumeStartupContractPayload.resume_all_flag_only_is_resume_intent, true);
  assert.equal(sessionResumeStartupContractPayload.resume_requested_accepts_false_literal_as_query, true);
  assert.equal(sessionResumeStartupContractPayload.resume_selector_keeps_false_literal, true);
  logStep("session-resume-startup-contract");

  const sessionResumeStartupDisambiguationContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/session-resume-startup-disambiguation-contract.ts",
  ]);
  assertSuccess(
    "session-resume-startup-disambiguation-contract",
    sessionResumeStartupDisambiguationContractResult,
  );
  const sessionResumeStartupDisambiguationContractPayload = parseJsonOutput(
    "session-resume-startup-disambiguation-contract",
    sessionResumeStartupDisambiguationContractResult.stdout,
  );
  assert.equal(
    sessionResumeStartupDisambiguationContractPayload.tty_disambiguation_picks_explicit_session,
    true,
  );
  assert.equal(
    sessionResumeStartupDisambiguationContractPayload.tty_disambiguation_pick_has_no_messages,
    true,
  );
  assert.equal(
    sessionResumeStartupDisambiguationContractPayload.tty_disambiguation_cancel_clears_target,
    true,
  );
  assert.equal(
    sessionResumeStartupDisambiguationContractPayload.tty_disambiguation_cancel_is_silent,
    true,
  );
  assert.equal(sessionResumeStartupDisambiguationContractPayload.non_tty_does_not_call_picker, true);
  assert.equal(sessionResumeStartupDisambiguationContractPayload.non_tty_keeps_auto_selected_target, true);
  assert.equal(
    sessionResumeStartupDisambiguationContractPayload.non_tty_reports_auto_selected_notice,
    true,
  );
  assert.equal(sessionResumeStartupDisambiguationContractPayload.no_disambiguation_keeps_target, true);
  assert.equal(sessionResumeStartupDisambiguationContractPayload.no_disambiguation_has_no_messages, true);
  logStep("session-resume-startup-disambiguation-contract");

  const sessionRewindStartupContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/session-rewind-startup-contract.ts",
  ]);
  assertSuccess("session-rewind-startup-contract", sessionRewindStartupContractResult);
  const sessionRewindStartupContractPayload = parseJsonOutput(
    "session-rewind-startup-contract",
    sessionRewindStartupContractResult.stdout,
  );
  assert.equal(sessionRewindStartupContractPayload.no_intent_skips_rewind_target, true);
  assert.equal(sessionRewindStartupContractPayload.no_intent_skips_notice, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_default_targets_latest, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_exact_id_targeted, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_single_query_match_targeted, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_multiple_query_auto_selects_top, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_multiple_query_requires_disambiguation, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_multiple_query_candidates_exposed, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_multiple_query_notice_contains_tip, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_multiple_query_notice_is_human_surface, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_multiple_query_notice_no_autoselect_literal, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_no_match_fallback_targets_latest, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_no_match_fallback_has_notice, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_no_match_without_fallback_has_notice, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_strict_exact_targeted, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_strict_no_match_skips_target, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_strict_no_match_has_skip_notice, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_startup_notices_avoid_legacy_marker, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_requested_accepts_false_literal_as_query, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_selector_keeps_false_literal, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_mode_default_is_both, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_mode_rewind_files_defaults_code, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_mode_explicit_conversation, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_mode_summary_alias_maps_summarize, true);
  assert.equal(sessionRewindStartupContractPayload.rewind_mode_invalid_falls_back_both, true);
  logStep("session-rewind-startup-contract");

  const sessionRewindStartupDisambiguationContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/session-rewind-startup-disambiguation-contract.ts",
  ]);
  assertSuccess(
    "session-rewind-startup-disambiguation-contract",
    sessionRewindStartupDisambiguationContractResult,
  );
  const sessionRewindStartupDisambiguationContractPayload = parseJsonOutput(
    "session-rewind-startup-disambiguation-contract",
    sessionRewindStartupDisambiguationContractResult.stdout,
  );
  assert.equal(
    sessionRewindStartupDisambiguationContractPayload.tty_disambiguation_picks_explicit_checkpoint,
    true,
  );
  assert.equal(
    sessionRewindStartupDisambiguationContractPayload.tty_disambiguation_pick_has_no_messages,
    true,
  );
  assert.equal(
    sessionRewindStartupDisambiguationContractPayload.tty_disambiguation_cancel_clears_target,
    true,
  );
  assert.equal(
    sessionRewindStartupDisambiguationContractPayload.tty_disambiguation_cancel_is_silent,
    true,
  );
  assert.equal(sessionRewindStartupDisambiguationContractPayload.non_tty_does_not_call_picker, true);
  assert.equal(sessionRewindStartupDisambiguationContractPayload.non_tty_keeps_auto_selected_target, true);
  assert.equal(
    sessionRewindStartupDisambiguationContractPayload.non_tty_reports_auto_selected_notice,
    true,
  );
  assert.equal(
    sessionRewindStartupDisambiguationContractPayload.non_tty_notice_avoids_legacy_marker,
    true,
  );
  assert.equal(sessionRewindStartupDisambiguationContractPayload.no_disambiguation_keeps_target, true);
  assert.equal(sessionRewindStartupDisambiguationContractPayload.no_disambiguation_has_no_messages, true);
  logStep("session-rewind-startup-disambiguation-contract");

  const runStartInputKeybindingContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/run-start-input-keybinding-contract.ts",
  ]);
  assertSuccess("run-start-input-keybinding-contract", runStartInputKeybindingContractResult);
  const runStartInputKeybindingContractPayload = parseJsonOutput(
    "run-start-input-keybinding-contract",
    runStartInputKeybindingContractResult.stdout,
  );
  assert.equal(runStartInputKeybindingContractPayload.menu_enter_is_confirm, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_lf_is_confirm, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_crlf_is_confirm, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_space_is_confirm, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_ctrl_p_is_up, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_ctrl_n_is_down, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_ctrl_g_is_edit_plan, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_escape_is_cancel, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_arrow_up_is_up, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_arrow_down_is_down, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_page_up_is_page_up, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_page_down_is_page_down, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_multi_digits_direct_index, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_digit_coalesced_crlf_direct_index, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_digit_prefix_has_continuation, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_digit_suffix_no_continuation, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_digit_prefix_first_match_index, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_digits_to_index_10, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_digits_reject_leading_zero, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_search_compact_prefers_relevant_item, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_search_digits_match_timestamp_description, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_search_empty_returns_all, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_apply_menu_command, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_apply_commands_menu_submit, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_apply_plan_submit, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_apply_skill_creator_requires_input, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_key_enter_applies_and_submits, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_key_tab_applies_without_submit, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_key_escape_hides_panel, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_key_no_suggestions_noop, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_overlay_partial_selected_highlighted, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_overlay_exact_selected_highlighted, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_overlay_scroll_window_keeps_selected_visible, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_overlay_scroll_window_highlights_selected, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_overlay_scroll_window_uses_restraint_not_bold, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_overlay_selected_has_pointer, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_overlay_scroll_window_does_not_wrap_to_first, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_overlay_scroll_window_has_no_row_up_marker, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_overlay_scroll_window_has_no_row_down_marker, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_overlay_scroll_window_keeps_compact_height, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_overlay_scroll_window_centers_selected_when_possible, true);
  assert.equal(runStartInputKeybindingContractPayload.suggestion_window_reusable_selected_centered, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_overlay_narrow_hides_description, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_overlay_narrow_lines_within_width, true);
  assert.equal(runStartInputKeybindingContractPayload.slash_input_with_args_highlighted, true);
  assert.equal(runStartInputKeybindingContractPayload.submit_return_detected, true);
  assert.equal(runStartInputKeybindingContractPayload.submit_enter_detected, true);
  assert.equal(runStartInputKeybindingContractPayload.submit_legacy_sequence_detected, true);
  assert.equal(runStartInputKeybindingContractPayload.submit_csiu_detected, true);
  assert.equal(runStartInputKeybindingContractPayload.submit_shift_newline, true);
  assert.equal(runStartInputKeybindingContractPayload.submit_meta_newline, true);
  assert.equal(runStartInputKeybindingContractPayload.submit_csiu_shift_newline, true);
  assert.equal(runStartInputKeybindingContractPayload.submit_non_enter_ignored, true);
  assert.equal(runStartInputKeybindingContractPayload.submit_coalesced_detected, true);
  assert.equal(runStartInputKeybindingContractPayload.submit_coalesced_crlf_detected, true);
  assert.equal(runStartInputKeybindingContractPayload.submit_coalesced_lf_detected, true);
  assert.equal(runStartInputKeybindingContractPayload.ask_user_panel_other_submit_text, true);
  assert.equal(runStartInputKeybindingContractPayload.ask_user_panel_other_submit_crlf_text, true);
  assert.equal(runStartInputKeybindingContractPayload.ask_user_panel_other_submit_cjk_text, true);
  assert.equal(runStartInputKeybindingContractPayload.ask_user_panel_numeric_submit_selects_standard_option, true);
  assert.equal(runStartInputKeybindingContractPayload.ask_user_panel_other_numeric_submit_focuses_other, true);
  assert.equal(runStartInputKeybindingContractPayload.ask_user_panel_other_printable_text, true);
  assert.equal(runStartInputKeybindingContractPayload.ask_user_panel_other_backspace, true);
  assert.equal(runStartInputKeybindingContractPayload.submit_coalesced_backslash_ignored, true);
  assert.equal(runStartInputKeybindingContractPayload.submit_coalesced_escape_ignored, true);
  assert.equal(runStartInputKeybindingContractPayload.submit_chunk_only_lf_detected, true);
  assert.equal(runStartInputKeybindingContractPayload.interactive_plain_enter_defers_to_keypress, true);
  assert.equal(runStartInputKeybindingContractPayload.interactive_plain_enter_recent_keypress_ignored, true);
  assert.equal(runStartInputKeybindingContractPayload.interactive_plain_enter_fallback_submits, true);
  assert.equal(runStartInputKeybindingContractPayload.interactive_text_submit_chunk_ignored, true);
  assert.equal(runStartInputKeybindingContractPayload.shortcut_overlay_empty_question_toggles, true);
  assert.equal(runStartInputKeybindingContractPayload.shortcut_overlay_draft_question_inserts, true);
  assert.equal(runStartInputKeybindingContractPayload.shortcut_overlay_slash_question_inserts, true);
  assert.equal(runStartInputKeybindingContractPayload.shortcut_overlay_ctrl_question_ignored, true);
  assert.equal(runStartInputKeybindingContractPayload.footer_draft_hides_shortcut_hint, true);
  assert.equal(runStartInputKeybindingContractPayload.footer_draft_hides_styled_shortcut_hint, true);
  assert.equal(runStartInputKeybindingContractPayload.footer_empty_keeps_shortcut_hint, true);
  assert.equal(runStartInputKeybindingContractPayload.footer_draft_removes_hint_only_line, true);
  assert.equal(runStartInputKeybindingContractPayload.input_chrome_has_open_horizontal_rails, true);
  assert.equal(runStartInputKeybindingContractPayload.input_chrome_has_no_corner_caps, true);
  assert.equal(runStartInputKeybindingContractPayload.input_chrome_has_no_vertical_body_rails, true);
  assert.equal(runStartInputKeybindingContractPayload.input_chrome_prompt_uses_claude_chevron, true);
  assert.equal(runStartInputKeybindingContractPayload.input_chrome_prompt_avoids_thin_chevron, true);
  assert.equal(runStartInputKeybindingContractPayload.input_chrome_has_no_left_gutter, true);
  assert.equal(runStartInputKeybindingContractPayload.input_chrome_border_tracks_body_width, true);
  assert.equal(runStartInputKeybindingContractPayload.input_chrome_cursor_column_matches_open_rails, true);
  assert.equal(runStartInputKeybindingContractPayload.input_chrome_cursor_uses_left_padding, true);
  assert.equal(runStartInputKeybindingContractPayload.submitted_slash_transcript_preserves_command_highlight, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_viewport_keeps_active_visible, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_viewport_scrolls_one_row_down, true);
  assert.equal(runStartInputKeybindingContractPayload.menu_viewport_scrolls_one_row_up, true);
  assert.equal(runStartInputKeybindingContractPayload.select_navigation_page_down_clamps_to_last, true);
  assert.equal(runStartInputKeybindingContractPayload.select_navigation_page_up_returns_by_page, true);
  assert.equal(runStartInputKeybindingContractPayload.select_navigation_wrap_next, true);
  assert.equal(runStartInputKeybindingContractPayload.select_navigation_set_options_clamps_focus, true);
  assert.equal(runStartInputKeybindingContractPayload.prompt_slot_select_menu_owns_focus_without_footer, true);
  assert.equal(runStartInputKeybindingContractPayload.prompt_slot_suggestions_suppress_status, true);
  assert.equal(runStartInputKeybindingContractPayload.prompt_slot_history_preempts_suggestions, true);
  assert.equal(runStartInputKeybindingContractPayload.prompt_slot_pending_ask_preempts_status, true);
  assert.equal(runStartInputKeybindingContractPayload.prompt_slot_running_preempts_status, true);
  assert.equal(runStartInputKeybindingContractPayload.prompt_slot_status_when_input_idle, true);
  assert.equal(runStartInputKeybindingContractPayload.prompt_slot_idle_hint_hidden_for_draft, true);
  assert.equal(runStartInputKeybindingContractPayload.prompt_slot_short_fullscreen_drops_status_first, true);
  assert.equal(runStartInputKeybindingContractPayload.prompt_slot_hidden_input_renders_no_footer, true);
  assert.equal(runStartInputKeybindingContractPayload.prompt_slot_runtime_status_footer_renders, true);
  assert.equal(runStartInputKeybindingContractPayload.prompt_slot_runtime_suggestions_suppress_status_footer, true);
  assert.equal(runStartInputKeybindingContractPayload.prompt_slot_runtime_shortcut_overlay_suppresses_status_footer, true);
  assert.equal(runStartInputKeybindingContractPayload.prompt_slot_runtime_pending_ask_renders_footer, true);
  assert.equal(runStartInputKeybindingContractPayload.prompt_slot_runtime_draft_without_status_hides_footer, true);
  logStep("run-start-input-keybinding-contract");

  const runStartPlanFailurePolicyContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/run-start-plan-failure-policy-contract.ts",
  ]);
  assertSuccess("run-start-plan-failure-policy-contract", runStartPlanFailurePolicyContractResult);
  const runStartPlanFailurePolicyContractPayload = parseJsonOutput(
    "run-start-plan-failure-policy-contract",
    runStartPlanFailurePolicyContractResult.stdout,
  );
  assert.equal(runStartPlanFailurePolicyContractPayload.planning_semantic_degrades, true);
  assert.equal(runStartPlanFailurePolicyContractPayload.planning_semantic_reason_matches, true);
  assert.equal(runStartPlanFailurePolicyContractPayload.planning_semantic_diagnostic_matches, true);
  assert.equal(runStartPlanFailurePolicyContractPayload.planning_semantic_has_hint, true);
  assert.equal(runStartPlanFailurePolicyContractPayload.planning_semantic_stale_fails, true);
  assert.equal(runStartPlanFailurePolicyContractPayload.planning_semantic_stale_diagnostic_matches, true);
  assert.equal(runStartPlanFailurePolicyContractPayload.applying_semantic_still_fails, true);
  assert.equal(runStartPlanFailurePolicyContractPayload.applying_semantic_diagnostic_matches, true);
  assert.equal(
    runStartPlanFailurePolicyContractPayload.planning_provider_failure_reason_matches,
    true,
  );
  assert.equal(
    runStartPlanFailurePolicyContractPayload.planning_provider_failure_keeps_error_class,
    true,
  );
  assert.equal(
    runStartPlanFailurePolicyContractPayload.planning_provider_failure_diagnostic_matches,
    true,
  );
  logStep("run-start-plan-failure-policy-contract");

  const bridgePlanFailurePolicyContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/bridge-plan-failure-policy-contract.ts",
  ]);
  assertSuccess("bridge-plan-failure-policy-contract", bridgePlanFailurePolicyContractResult);
  const bridgePlanFailurePolicyContractPayload = parseJsonOutput(
    "bridge-plan-failure-policy-contract",
    bridgePlanFailurePolicyContractResult.stdout,
  );
  assert.equal(bridgePlanFailurePolicyContractPayload.provider_failure_is_fail, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.provider_failure_reason_matches, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.provider_failure_class_kept, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.provider_failure_provider_kept, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.provider_failure_diagnostic_matches, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.provider_failure_camel_case_extracted, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.provider_failure_snake_case_extracted, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.semantic_failure_diagnostic_matches, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.timeout_failure_reason_matches, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.timeout_failure_diagnostic_matches, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.generic_failure_reason_matches, true);
  assert.equal(bridgePlanFailurePolicyContractPayload.generic_failure_diagnostic_matches, true);
  logStep("bridge-plan-failure-policy-contract");

  const runStartPlanModeContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/run-start-plan-mode-contract.ts",
  ]);
  assertSuccess("run-start-plan-mode-contract", runStartPlanModeContractResult);
  const runStartPlanModeContractPayload = parseJsonOutput(
    "run-start-plan-mode-contract",
    runStartPlanModeContractResult.stdout,
  );
  assert.equal(runStartPlanModeContractPayload.review_passes_for_valid_plan, true);
  assert.equal(runStartPlanModeContractPayload.review_rejects_validation_without_command, true);
  assert.equal(runStartPlanModeContractPayload.review_rejects_validation_without_expected_result, true);
  assert.equal(runStartPlanModeContractPayload.review_rejects_vague_risk, true);
  assert.equal(runStartPlanModeContractPayload.review_rejects_vague_rollback, true);
  assert.equal(runStartPlanModeContractPayload.review_accepts_canonical_proposed_plan_block, true);
  assert.equal(runStartPlanModeContractPayload.enter_plan_message_mode_handled, true);
  assert.equal(runStartPlanModeContractPayload.enter_plan_sets_plan_only, true);
  assert.equal(runStartPlanModeContractPayload.enter_plan_surface_has_relative_planning_path, true);
  assert.equal(runStartPlanModeContractPayload.enter_plan_surface_has_goal, true);
  assert.equal(runStartPlanModeContractPayload.enter_plan_surface_has_read_only_boundary, true);
  assert.equal(runStartPlanModeContractPayload.enter_plan_surface_hides_absolute_plan_path, true);
  assert.equal(runStartPlanModeContractPayload.enter_plan_surface_order_is_stable, true);
  assert.equal(runStartPlanModeContractPayload.draft_plan_surface_handled, true);
  assert.equal(runStartPlanModeContractPayload.draft_plan_surface_uses_status_title, true);
  assert.equal(runStartPlanModeContractPayload.draft_plan_surface_uses_relative_plan_file, true);
  assert.equal(runStartPlanModeContractPayload.draft_plan_surface_has_read_only_boundary, true);
  assert.equal(runStartPlanModeContractPayload.draft_plan_surface_has_refine_hint, true);
  assert.equal(runStartPlanModeContractPayload.draft_plan_surface_hides_absolute_path, true);
  assert.equal(runStartPlanModeContractPayload.draft_plan_surface_hides_required_placeholders, true);
  assert.equal(runStartPlanModeContractPayload.draft_plan_surface_avoids_legacy_empty_message, true);
  assert.equal(runStartPlanModeContractPayload.refine_plan_turn_handled, true);
  assert.equal(runStartPlanModeContractPayload.refine_plan_turn_surface_matches_reference_shape, true);
  assert.equal(runStartPlanModeContractPayload.ready_plan_turn_handled, true);
  assert.equal(runStartPlanModeContractPayload.ready_surface_matches_reference_shape, true);
  assert.equal(runStartPlanModeContractPayload.ready_surface_has_plan_separators, true);
  assert.equal(runStartPlanModeContractPayload.ready_approval_callback_receives_current_plan, true);
  assert.equal(runStartPlanModeContractPayload.ready_approval_keep_planning_skips_fallback_surface, true);
  assert.equal(runStartPlanModeContractPayload.ready_approval_keep_planning_matches_reference_shape, true);
  assert.equal(runStartPlanModeContractPayload.ready_approval_cancel_returns_input_without_status_surface, true);
  assert.equal(runStartPlanModeContractPayload.ready_approval_empty_exit_leaves_plan_mode, true);
  assert.equal(runStartPlanModeContractPayload.ready_approval_empty_exit_does_not_apply, true);
  assert.equal(runStartPlanModeContractPayload.ready_approval_empty_exit_is_quiet, true);
  assert.equal(runStartPlanModeContractPayload.ready_approval_yes_executes_plan, true);
  assert.equal(runStartPlanModeContractPayload.ready_approval_yes_skips_text_fallback, true);
  assert.equal(runStartPlanModeContractPayload.ready_approval_yes_matches_exit_plan_reference, true);
  assert.equal(runStartPlanModeContractPayload.ready_approval_yes_exits_plan_mode, true);
  assert.equal(runStartPlanModeContractPayload.ready_approval_yes_with_feedback_adds_instruction, true);
  assert.equal(runStartPlanModeContractPayload.ready_approval_yes_with_feedback_exits_plan_mode, true);
  assert.equal(runStartPlanModeContractPayload.ready_approval_feedback_runs_followup_plan_turn, true);
  assert.equal(runStartPlanModeContractPayload.ready_approval_feedback_keeps_plan_mode, true);
  assert.equal(runStartPlanModeContractPayload.plan_interrupt_command_normal_mode_is_human, true);
  assert.equal(runStartPlanModeContractPayload.plan_interrupt_idle_plan_mode_is_human, true);
  assert.equal(runStartPlanModeContractPayload.plan_cancel_empty_surface_is_human, true);
  assert.equal(runStartPlanModeContractPayload.plan_cancel_active_surface_is_human, true);
  assert.equal(runStartPlanModeContractPayload.plan_apply_no_active_surface_is_human, true);
  assert.equal(runStartPlanModeContractPayload.plan_apply_already_applying_surface_is_human, true);
  assert.equal(runStartPlanModeContractPayload.plan_apply_invalid_status_surface_is_human, true);
  assert.equal(runStartPlanModeContractPayload.plan_turn_injects_plan_workflow_prompt, true);
  assert.equal(runStartPlanModeContractPayload.plan_turn_prompt_requires_strict_plan_sections, true);
  assert.equal(runStartPlanModeContractPayload.active_plan_path_present, true);
  assert.equal(runStartPlanModeContractPayload.open_plan_surface_handled, true);
  assert.equal(runStartPlanModeContractPayload.open_plan_surface_is_current_plan_display, true);
  assert.equal(runStartPlanModeContractPayload.open_plan_surface_has_editor_hint, true);
  assert.equal(runStartPlanModeContractPayload.open_plan_surface_hides_machine_fields_by_default, true);
  assert.equal(runStartPlanModeContractPayload.verbose_plan_surface_handled, true);
  assert.equal(runStartPlanModeContractPayload.verbose_plan_surface_preserves_machine_fields, true);
  assert.equal(runStartPlanModeContractPayload.open_plan_surface_uses_relative_plan_file, true);
  assert.equal(runStartPlanModeContractPayload.open_plan_surface_hides_absolute_plan_file, true);
  assert.equal(runStartPlanModeContractPayload.script_plan_surface_defaults_to_human_summary, true);
  assert.equal(runStartPlanModeContractPayload.script_plan_surface_has_editor_hint, true);
  assert.equal(runStartPlanModeContractPayload.script_plan_surface_hides_machine_fields_by_default, true);
  assert.equal(runStartPlanModeContractPayload.script_plan_surface_uses_relative_plan_file, true);
  assert.equal(runStartPlanModeContractPayload.script_plan_surface_hides_absolute_plan_file, true);
  assert.equal(runStartPlanModeContractPayload.plan_goal_in_plan_mode_shows_current_plan, true);
  assert.equal(runStartPlanModeContractPayload.plan_goal_in_plan_mode_skips_new_query, true);
  assert.equal(runStartPlanModeContractPayload.execute_natural_language_handled, true);
  assert.equal(runStartPlanModeContractPayload.execute_triggered_runtime_turn, true);
  assert.equal(runStartPlanModeContractPayload.execute_payload_is_not_literal_phrase, true);
  assert.equal(runStartPlanModeContractPayload.execute_payload_has_approved_plan_contract, true);
  assert.equal(runStartPlanModeContractPayload.execute_payload_has_approval_metadata, true);
  assert.equal(runStartPlanModeContractPayload.execute_payload_has_scope_guardrails, true);
  assert.equal(runStartPlanModeContractPayload.execute_payload_contains_approved_plan_snapshot, true);
  assert.equal(runStartPlanModeContractPayload.execute_payload_omits_plain_trigger_as_extra, true);
  assert.equal(runStartPlanModeContractPayload.apply_surface_shows_approved_plan_start, true);
  assert.equal(runStartPlanModeContractPayload.apply_surface_has_saved_plan_hint, true);
  assert.equal(runStartPlanModeContractPayload.apply_surface_renders_plan_card, true);
  assert.equal(runStartPlanModeContractPayload.apply_surface_hides_machine_fields, true);
  assert.equal(runStartPlanModeContractPayload.apply_surface_hides_plan_metadata_preview, true);
  assert.equal(runStartPlanModeContractPayload.apply_surface_does_not_echo_literal_trigger, true);
  assert.equal(runStartPlanModeContractPayload.execute_exits_plan_only, true);
  assert.equal(runStartPlanModeContractPayload.execute_clears_active_plan_meta, true);
  assert.equal(runStartPlanModeContractPayload.events_has_apply_succeeded, true);
  assert.equal(runStartPlanModeContractPayload.events_has_verification_pending, true);
  assert.equal(runStartPlanModeContractPayload.compact_plan_turn_failure_code_preserved, true);
  assert.equal(runStartPlanModeContractPayload.plan_turn_stdout_override_captures_plan_scaffolding, true);
  assert.equal(runStartPlanModeContractPayload.plan_turn_working_notice_has_plan_bullet, true);
  assert.equal(runStartPlanModeContractPayload.compact_plan_turn_failure_surface_human, true);
  assert.equal(runStartPlanModeContractPayload.compact_plan_turn_failure_hides_machine_lines, true);
  assert.equal(runStartPlanModeContractPayload.verbose_plan_turn_failure_preserves_machine_lines, true);
  assert.equal(runStartPlanModeContractPayload.compact_plan_apply_failure_code_preserved, true);
  assert.equal(runStartPlanModeContractPayload.compact_plan_apply_failure_surface_human, true);
  assert.equal(runStartPlanModeContractPayload.compact_plan_apply_failure_hides_machine_lines, true);
  assert.equal(runStartPlanModeContractPayload.stderr_empty_on_success_path, true);
  logStep("run-start-plan-mode-contract");

  const userCommandsContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/user-commands-contract.ts",
  ]);
  assertSuccess("user-commands-contract", userCommandsContractResult);
  const userCommandsContractPayload = parseJsonOutput(
    "user-commands-contract",
    userCommandsContractResult.stdout,
  );
  assert.equal(userCommandsContractPayload.created, true);
  assert.equal(userCommandsContractPayload.first_invocation_handled, true);
  assert.equal(userCommandsContractPayload.first_invocation_prompt, "执行交付：本次发布");
  assert.equal(userCommandsContractPayload.disabled_invocation_handled, true);
  assert.equal(Number(userCommandsContractPayload.prompts_after_disable), 1);
  assert.equal(userCommandsContractPayload.second_invocation_handled, true);
  assert.equal(userCommandsContractPayload.second_invocation_prompt, "第二版：参数B");
  assert.equal(userCommandsContractPayload.builtin_collision_created, false);
  assert.equal(userCommandsContractPayload.skill_creator_collision_created, false);
  assert.equal(userCommandsContractPayload.builtin_delete_blocked, true);
  assert.equal(userCommandsContractPayload.traversal_delete_blocked, true);
  assert.equal(userCommandsContractPayload.traversal_invocation_handled, false);
  assert.equal(userCommandsContractPayload.deleted, true);
  assert.equal(userCommandsContractPayload.failure_marked, false);
  assert.equal(Number(userCommandsContractPayload.stdout_rows_count) >= 1, true);
  assert.equal(userCommandsContractPayload.command_surface_avoids_legacy_marker, true);
  assert.equal(userCommandsContractPayload.command_created_surface_is_human, true);
  assert.equal(userCommandsContractPayload.command_disabled_surface_is_human, true);
  assert.equal(userCommandsContractPayload.command_list_surface_is_human, true);
  assert.equal(userCommandsContractPayload.menu_hint_is_reference_compact, true);
  assert.equal(userCommandsContractPayload.menu_hint_omits_secondary_key_chords, true);
  assert.equal(userCommandsContractPayload.menu_cancel_is_silent, true);
  logStep("user-commands-contract");

  const agentsInstructionsContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/agents-instructions-contract.ts",
  ]);
  assertSuccess("agents-instructions-contract", agentsInstructionsContractResult);
  const agentsInstructionsContractPayload = parseJsonOutput(
    "agents-instructions-contract",
    agentsInstructionsContractResult.stdout,
  );
  assert.equal(Number(agentsInstructionsContractPayload.sources_count), 2);
  assert.equal(Number(agentsInstructionsContractPayload.outside_sources_count), 1);
  assert.equal(agentsInstructionsContractPayload.system_prompt_loaded, true);
  logStep("agents-instructions-contract");

  const runStartSlashSuggestionsContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/run-start-slash-suggestions-contract.ts",
  ]);
  assertSuccess("run-start-slash-suggestions-contract", runStartSlashSuggestionsContractResult);
  const runStartSlashSuggestionsContractPayload = parseJsonOutput(
    "run-start-slash-suggestions-contract",
    runStartSlashSuggestionsContractResult.stdout,
  );
  assert.equal(runStartSlashSuggestionsContractPayload.root_has_builtin_model, true);
  assert.equal(runStartSlashSuggestionsContractPayload.root_model_visible_in_first_page, true);
  assert.equal(runStartSlashSuggestionsContractPayload.root_default_limit_keeps_model, true);
  assert.equal(runStartSlashSuggestionsContractPayload.root_default_limit_size_ok, true);
  assert.equal(runStartSlashSuggestionsContractPayload.root_has_builtin_commands, true);
  assert.equal(runStartSlashSuggestionsContractPayload.root_has_builtin_resume, true);
  assert.equal(runStartSlashSuggestionsContractPayload.root_has_builtin_rewind, true);
  assert.equal(runStartSlashSuggestionsContractPayload.root_has_builtin_skill_creator, true);
  assert.equal(runStartSlashSuggestionsContractPayload.root_has_builtin_init, true);
  assert.equal(runStartSlashSuggestionsContractPayload.root_has_builtin_context, true);
  assert.equal(runStartSlashSuggestionsContractPayload.root_has_builtin_memory, true);
  assert.equal(runStartSlashSuggestionsContractPayload.root_hides_removed_ask_surface, true);
  assert.equal(runStartSlashSuggestionsContractPayload.root_hides_plan_subcommands, true);
  assert.equal(runStartSlashSuggestionsContractPayload.root_has_user_shipit, true);
  assert.equal(runStartSlashSuggestionsContractPayload.root_disabled_marked, true);
  assert.equal(runStartSlashSuggestionsContractPayload.pending_root_hides_removed_ask_surface, true);
  assert.equal(runStartSlashSuggestionsContractPayload.pending_root_keeps_builtin_shape, true);
  assert.equal(runStartSlashSuggestionsContractPayload.model_filter_only_model_related, true);
  assert.equal(runStartSlashSuggestionsContractPayload.ask_filter_empty, true);
  assert.equal(runStartSlashSuggestionsContractPayload.plan_filter_only_plan_related, true);
  assert.equal(runStartSlashSuggestionsContractPayload.plan_filter_has_plan_root, true);
  assert.equal(runStartSlashSuggestionsContractPayload.plan_filter_has_plan_goal, true);
  assert.equal(runStartSlashSuggestionsContractPayload.plan_filter_has_plan_open, true);
  assert.equal(runStartSlashSuggestionsContractPayload.plan_filter_surface_is_current_only, true);
  assert.equal(runStartSlashSuggestionsContractPayload.plan_filter_surface_size_ok, true);
  assert.equal(runStartSlashSuggestionsContractPayload.plan_filter_has_recommendation_text, true);
  assert.equal(runStartSlashSuggestionsContractPayload.plan_mode_filter_hides_plan_root, true);
  assert.equal(runStartSlashSuggestionsContractPayload.plan_mode_filter_hides_goal, true);
  assert.equal(runStartSlashSuggestionsContractPayload.plan_mode_filter_keeps_open, true);
  assert.equal(runStartSlashSuggestionsContractPayload.plan_mode_filter_surface_is_current_only, true);
  assert.equal(runStartSlashSuggestionsContractPayload.plan_open_filter_only_open, true);
  assert.equal(runStartSlashSuggestionsContractPayload.plan_open_filter_has_open_first, true);
  assert.equal(runStartSlashSuggestionsContractPayload.plan_applied_pending_has_state_tag, true);
  assert.equal(runStartSlashSuggestionsContractPayload.ship_filter_has_user_command, true);
  assert.equal(runStartSlashSuggestionsContractPayload.plain_input_returns_empty, true);
  logStep("run-start-slash-suggestions-contract");

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
  assert.equal(bridgeCliContractPayload.open_without_plan_mode, "normal");
  assert.equal(bridgeCliContractPayload.open_without_plan_recommended_next_action, "/plan <goal>");
  assert.equal(bridgeCliContractPayload.entered_plan_mode, "plan_only");
  assert.equal(typeof bridgeCliContractPayload.entered_plan_id, "string");
  assert.equal(String(bridgeCliContractPayload.entered_plan_id).length > 0, true);
  assert.equal(bridgeCliContractPayload.entered_hint_lists_current_surface, true);
  assert.equal(bridgeCliContractPayload.open_with_plan_keeps_active_plan, true);
  assert.equal(bridgeCliContractPayload.open_with_plan_live_phase, "awaiting_decision");
  assert.equal(bridgeCliContractPayload.open_with_plan_live_status, "ready");
  assert.equal(bridgeCliContractPayload.open_with_plan_status_source, "live_snapshot");
  assert.equal(bridgeCliContractPayload.open_with_plan_stored_status, "draft");
  assert.equal(
    bridgeCliContractPayload.open_with_plan_recommended_next_action,
    "Implement the plan.",
  );
  assert.equal(bridgeCliContractPayload.guard_error_code, "PLAN_GUARD_DENIED");
  assert.equal(bridgeCliContractPayload.guard_code, "PLAN_GUARD_DENIED");
  assert.equal(bridgeCliContractPayload.guard_mode_after_note, "plan_only");
  logStep("bridge-cli-contract");

  const bridgePlanApplyFailureContractResult = runCommand("node", [
    "gateway/src/extensions/contracts/bridge-plan-apply-failure-contract.mjs",
  ], {
    timeoutMs: 120_000,
  });
  assertSuccess("bridge-plan-apply-failure-contract", bridgePlanApplyFailureContractResult);
  const bridgePlanApplyFailureContractPayload = parseJsonOutput(
    "bridge-plan-apply-failure-contract",
    bridgePlanApplyFailureContractResult.stdout,
  );
  assert.equal(bridgePlanApplyFailureContractPayload.ok, true);
  assert.equal(bridgePlanApplyFailureContractPayload.apply_failure_error_code, "PLAN_APPLY_EXEC_FAILED");
  assert.equal(bridgePlanApplyFailureContractPayload.apply_failure_policy_action, "fail");
  assert.equal(
    bridgePlanApplyFailureContractPayload.apply_failure_policy_reason === "provider_runtime_failure"
      || bridgePlanApplyFailureContractPayload.apply_failure_policy_reason === "bridge_apply_exec_timeout"
      || bridgePlanApplyFailureContractPayload.apply_failure_policy_reason === "bridge_apply_exec_failed",
    true,
  );
  assert.equal(
    bridgePlanApplyFailureContractPayload.apply_failure_diagnostic_code === "BRIDGE_SEMANTIC_CONTEXT_UNAVAILABLE"
      || bridgePlanApplyFailureContractPayload.apply_failure_diagnostic_code === "BRIDGE_PROVIDER_RUNTIME_FAILURE"
      || bridgePlanApplyFailureContractPayload.apply_failure_diagnostic_code === "BRIDGE_APPLY_EXEC_TIMEOUT"
      || bridgePlanApplyFailureContractPayload.apply_failure_diagnostic_code === "BRIDGE_APPLY_EXEC_FAILED",
    true,
  );
  assert.equal(bridgePlanApplyFailureContractPayload.apply_failure_plan_status, "apply_failed");
  assert.equal(bridgePlanApplyFailureContractPayload.apply_failure_plan_phase, "awaiting_decision");
  assert.equal(bridgePlanApplyFailureContractPayload.status_latest_failure_event, "plan_apply_failed");
  assert.equal(
    bridgePlanApplyFailureContractPayload.status_latest_failure_diagnostic_code === "BRIDGE_SEMANTIC_CONTEXT_UNAVAILABLE"
      || bridgePlanApplyFailureContractPayload.status_latest_failure_diagnostic_code === "BRIDGE_PROVIDER_RUNTIME_FAILURE"
      || bridgePlanApplyFailureContractPayload.status_latest_failure_diagnostic_code === "BRIDGE_APPLY_EXEC_TIMEOUT"
      || bridgePlanApplyFailureContractPayload.status_latest_failure_diagnostic_code === "BRIDGE_APPLY_EXEC_FAILED",
    true,
  );
  assert.equal(bridgePlanApplyFailureContractPayload.events_has_plan_apply_failed, true);
  assert.equal(bridgePlanApplyFailureContractPayload.events_has_policy_action, true);
  assert.equal(bridgePlanApplyFailureContractPayload.events_has_policy_reason, true);
  assert.equal(bridgePlanApplyFailureContractPayload.events_has_diagnostic_code, true);
  logStep("bridge-plan-apply-failure-contract");

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

  const planQualityBenchmarkContractResult = runCommand("node", [
    "gateway/src/extensions/contracts/plan-quality-benchmark-contract.mjs",
  ], {
    timeoutMs: 120_000,
  });
  assertSuccess("plan-quality-benchmark-contract", planQualityBenchmarkContractResult);
  const planQualityBenchmarkContractPayload = parseJsonOutput(
    "plan-quality-benchmark-contract",
    planQualityBenchmarkContractResult.stdout,
  );
  assert.equal(planQualityBenchmarkContractPayload.ok, true);
  assert.equal(planQualityBenchmarkContractPayload.winner_label, "strong");
  assert.equal(Number(planQualityBenchmarkContractPayload.compared_count), 2);
  assert.equal(
    planQualityBenchmarkContractPayload.assert_best_fail_code,
    "PLAN_BENCHMARK_ASSERT_BEST_FAILED",
  );
  logStep("plan-quality-benchmark-contract");

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

  const browserDoctorSchemaResult = runCommand("node", [
    "gateway/src/extensions/contracts/browser-doctor-json-schema-contract.mjs",
  ], {
    timeoutMs: 30_000,
  });
  assertSuccess("browser-doctor-json-schema-contract", browserDoctorSchemaResult);
  const browserDoctorSchemaPayload = parseJsonOutput(
    "browser-doctor-json-schema-contract",
    browserDoctorSchemaResult.stdout,
  );
  assert.equal(browserDoctorSchemaPayload.ok, true);
  assert.equal(browserDoctorSchemaPayload.validated_examples, 2);
  assert.equal(Array.isArray(browserDoctorSchemaPayload.doctor_path_enum), true);
  assert.equal(browserDoctorSchemaPayload.doctor_path_enum.includes("cdp"), true);
  logStep("browser-doctor-json-schema-contract");

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

  const devCliUiRendererContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/dev-cli-ui-renderer-contract.ts",
  ]);
  assertSuccess("dev-cli-ui-renderer-contract", devCliUiRendererContractResult);
  const devCliUiRendererContractPayload = parseJsonOutput(
    "dev-cli-ui-renderer-contract",
    devCliUiRendererContractResult.stdout,
  );
  assert.equal(devCliUiRendererContractPayload.interactive_mode, "interactive_tty");
  assert.equal(devCliUiRendererContractPayload.plain_mode, "plain_tty");
  assert.equal(devCliUiRendererContractPayload.non_tty_mode, "non_tty");
  assert.equal(devCliUiRendererContractPayload.startup_has_title, true);
  assert.equal(devCliUiRendererContractPayload.startup_has_brand_label, true);
  assert.equal(devCliUiRendererContractPayload.startup_has_logo_headline, true);
  assert.equal(devCliUiRendererContractPayload.startup_has_logo_runtime_line, true);
  assert.equal(devCliUiRendererContractPayload.startup_has_session_line, true);
  assert.equal(devCliUiRendererContractPayload.startup_has_no_command_hint, true);
  assert.equal(devCliUiRendererContractPayload.startup_has_tips_title, true);
  assert.equal(devCliUiRendererContractPayload.startup_has_recent_activity_title, true);
  assert.equal(devCliUiRendererContractPayload.startup_has_recent_activity_empty_or_items, true);
  assert.equal(devCliUiRendererContractPayload.startup_has_developed_by_67, true);
  assert.equal(devCliUiRendererContractPayload.startup_has_no_dev_label, true);
  assert.equal(devCliUiRendererContractPayload.startup_interactive_title_has_brand_color, true);
  assert.equal(devCliUiRendererContractPayload.startup_interactive_title_has_muted_version_color, true);
  assert.equal(devCliUiRendererContractPayload.startup_feed_title_uses_brand_color, true);
  assert.equal(devCliUiRendererContractPayload.startup_feed_title_avoids_accent_color, true);
  assert.equal(devCliUiRendererContractPayload.startup_feed_footer_uses_muted_color, true);
  assert.equal(devCliUiRendererContractPayload.startup_feed_footer_avoids_info_color, true);
  assert.equal(devCliUiRendererContractPayload.startup_has_no_join_artifact, true);
  assert.equal(devCliUiRendererContractPayload.startup_has_no_tee_glyph, true);
  assert.equal(devCliUiRendererContractPayload.startup_body_width_consistent, true);
  assert.equal(devCliUiRendererContractPayload.startup_feed_divider_count_expected, true);
  assert.equal(devCliUiRendererContractPayload.startup_brand_symbol_body_length_consistent, true);
  assert.equal(devCliUiRendererContractPayload.startup_brand_symbol_has_claude_like_height, true);
  assert.equal(devCliUiRendererContractPayload.startup_registered_symbol_single_width, true);
  assert.equal(devCliUiRendererContractPayload.menu_interactive_has_ansi, true);
  assert.equal(devCliUiRendererContractPayload.menu_plain_has_ansi, false);
  assert.equal(devCliUiRendererContractPayload.menu_non_tty_has_ansi, false);
  assert.equal(devCliUiRendererContractPayload.menu_plain_has_pointer, true);
  assert.equal(devCliUiRendererContractPayload.menu_plain_has_no_thin_pointer, true);
  assert.equal(devCliUiRendererContractPayload.menu_interactive_has_current_check, true);
  assert.equal(devCliUiRendererContractPayload.menu_plain_has_secondary_description, true);
  assert.equal(devCliUiRendererContractPayload.menu_hint_is_compact, true);
  assert.equal(devCliUiRendererContractPayload.menu_hint_has_escape_back, true);
  assert.equal(devCliUiRendererContractPayload.menu_hint_has_enter_action, true);
  assert.equal(devCliUiRendererContractPayload.menu_hint_has_navigation_hint, true);
  assert.equal(devCliUiRendererContractPayload.menu_hint_omits_secondary_key_chords, true);
  assert.equal(devCliUiRendererContractPayload.menu_viewport_has_full_ordinal, true);
  assert.equal(devCliUiRendererContractPayload.menu_viewport_hides_reset_ordinal, true);
  assert.equal(devCliUiRendererContractPayload.menu_viewport_has_no_row_scroll_arrows, true);
  assert.equal(devCliUiRendererContractPayload.menu_viewport_has_no_more_text, true);
  assert.equal(devCliUiRendererContractPayload.menu_direct_render_has_no_row_scroll_marker, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_has_claude_pointer, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_has_no_thin_pointer, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_has_pane_divider, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_interactive_uses_warm_brand_color, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_has_decimal_index, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_has_no_bracket_index, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_current_uses_check, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_current_not_parenthesized, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_has_default_suffix, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_has_footer_hint, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_has_no_provider_card, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_has_no_startup_badge, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_has_no_current_badge, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_has_no_reset_badge, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_has_no_frame, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_interactive_has_no_current_badge, true);
  assert.equal(devCliUiRendererContractPayload.ask_user_menu_uses_panel_divider, true);
  assert.equal(devCliUiRendererContractPayload.ask_user_menu_uses_warm_brand_color, true);
  assert.equal(devCliUiRendererContractPayload.ask_user_menu_has_progress_title, true);
  assert.equal(devCliUiRendererContractPayload.ask_user_menu_has_input_return_hint, true);
  assert.equal(devCliUiRendererContractPayload.ask_user_menu_preserves_option_descriptions, true);
  assert.equal(devCliUiRendererContractPayload.ask_user_menu_uses_claude_pointer, true);
  assert.equal(devCliUiRendererContractPayload.plan_approval_menu_has_ready_title, true);
  assert.equal(devCliUiRendererContractPayload.plan_approval_menu_embeds_plan_markdown, true);
  assert.equal(devCliUiRendererContractPayload.plan_approval_menu_has_reference_prompt, true);
  assert.equal(devCliUiRendererContractPayload.plan_approval_menu_uses_sticky_footer_order, true);
  assert.equal(devCliUiRendererContractPayload.plan_approval_menu_has_yes_no_options, true);
  assert.equal(devCliUiRendererContractPayload.plan_approval_menu_has_ctrl_g_edit_hint, true);
  assert.equal(devCliUiRendererContractPayload.plan_approval_menu_shows_saved_after_external_edit, true);
  assert.equal(devCliUiRendererContractPayload.plan_approval_menu_shows_keep_planning_feedback_hint, true);
  assert.equal(devCliUiRendererContractPayload.plan_approval_menu_preserves_feedback_after_reopen, true);
  assert.equal(devCliUiRendererContractPayload.plan_approval_menu_uses_plan_mode_color, true);
  assert.equal(devCliUiRendererContractPayload.plan_approval_menu_has_no_default_thin_pointer, true);
  assert.equal(devCliUiRendererContractPayload.plan_approval_empty_uses_exit_title, true);
  assert.equal(devCliUiRendererContractPayload.plan_approval_empty_uses_reference_copy, true);
  assert.equal(devCliUiRendererContractPayload.plan_approval_empty_has_yes_no_only, true);
  assert.equal(devCliUiRendererContractPayload.plan_approval_empty_omits_plan_markdown, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_direct_render_uses_model_visible_count, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_direct_render_shows_hidden_count, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_direct_render_has_no_row_scroll_marker, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_long_rows_within_width, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_long_current_suffix_preserved, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_long_default_suffix_preserved, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_narrow_rows_within_width, true);
  assert.equal(devCliUiRendererContractPayload.model_picker_narrow_hides_description, true);
  assert.equal(devCliUiRendererContractPayload.menu_long_rows_within_width, true);
  assert.equal(devCliUiRendererContractPayload.menu_long_current_suffix_preserved, true);
  logStep("dev-cli-ui-renderer-contract");

  const devCliTurnScreenContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/dev-cli-turn-screen-contract.ts",
  ]);
  assertSuccess("dev-cli-turn-screen-contract", devCliTurnScreenContractResult);
  const devCliTurnScreenContractPayload = parseJsonOutput(
    "dev-cli-turn-screen-contract",
    devCliTurnScreenContractResult.stdout,
  );
  assert.equal(devCliTurnScreenContractPayload.management_interactive_matches, true);
  assert.equal(devCliTurnScreenContractPayload.management_non_interactive_matches, true);
  assert.equal(devCliTurnScreenContractPayload.turn_interrupted_interactive_matches, true);
  assert.equal(devCliTurnScreenContractPayload.turn_interrupted_non_interactive_matches, true);
  assert.equal(devCliTurnScreenContractPayload.turn_interrupted_avoids_machine_prefix, true);
  assert.equal(devCliTurnScreenContractPayload.open_circuit_interactive_is_human_surface, true);
  assert.equal(devCliTurnScreenContractPayload.open_circuit_non_interactive_is_human_surface, true);
  assert.equal(devCliTurnScreenContractPayload.open_circuit_avoids_machine_prefix, true);
  assert.equal(devCliTurnScreenContractPayload.failure_summary_is_human_surface, true);
  assert.equal(devCliTurnScreenContractPayload.failure_summary_has_last_error_detail, true);
  assert.equal(devCliTurnScreenContractPayload.failure_summary_avoids_machine_prefix, true);
  assert.equal(devCliTurnScreenContractPayload.failure_summary_ends_with_newline, true);
  logStep("dev-cli-turn-screen-contract");

  const runStartTuiSurfaceContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/run-start-tui-surface-contract.ts",
  ]);
  assertSuccess("run-start-tui-surface-contract", runStartTuiSurfaceContractResult);
  const runStartTuiSurfaceContractPayload = parseJsonOutput(
    "run-start-tui-surface-contract",
    runStartTuiSurfaceContractResult.stdout,
  );
  assert.equal(runStartTuiSurfaceContractPayload.mcp_strict_failure_is_human_surface, true);
  assert.equal(runStartTuiSurfaceContractPayload.mcp_strict_failure_has_fix_hint, true);
  assert.equal(runStartTuiSurfaceContractPayload.scheduler_tick_error_is_human_surface, true);
  assert.equal(runStartTuiSurfaceContractPayload.scheduler_task_failed_is_human_surface, true);
  assert.equal(runStartTuiSurfaceContractPayload.surfaces_avoid_legacy_machine_markers, true);
  assert.equal(runStartTuiSurfaceContractPayload.surfaces_end_with_newline, true);
  logStep("run-start-tui-surface-contract");

  const devCliActivityFeedContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/dev-cli-activity-feed-contract.ts",
  ]);
  assertSuccess("dev-cli-activity-feed-contract", devCliActivityFeedContractResult);
  const devCliActivityFeedPayload = parseJsonOutput(
    "dev-cli-activity-feed-contract",
    devCliActivityFeedContractResult.stdout,
  );
  assert.equal(devCliActivityFeedPayload.renders_real_tool_rows, true);
  assert.equal(devCliActivityFeedPayload.compact_hides_key_value_details, true);
  assert.equal(devCliActivityFeedPayload.renders_edit_with_diff_stats, true);
  assert.equal(devCliActivityFeedPayload.renders_failed_bash, true);
  assert.equal(devCliActivityFeedPayload.renders_recovery_row, true);
  assert.equal(devCliActivityFeedPayload.nested_payload_supported, true);
  assert.equal(devCliActivityFeedPayload.plan_file_write_uses_reference_label, true);
  assert.equal(devCliActivityFeedPayload.plan_file_edit_hides_path_and_diff_stats, true);
  assert.equal(devCliActivityFeedPayload.plan_file_full_detail_shows_preview_hint, true);
  assert.equal(devCliActivityFeedPayload.none_mode_suppresses_feed, true);
  assert.equal(devCliActivityFeedPayload.env_default_suppresses_feed, true);
  assert.equal(devCliActivityFeedPayload.env_compact_enables_feed, true);
  assert.equal(devCliActivityFeedPayload.env_full_enables_verbose_feed, true);
  assert.equal(devCliActivityFeedPayload.transcript_default_disables_turn_feed, true);
  assert.equal(devCliActivityFeedPayload.transcript_env_enables_separate_turn_feed_chunk, true);
  assert.equal(devCliActivityFeedPayload.transcript_ask_user_suppresses_turn_feed, true);
  assert.equal(devCliActivityFeedPayload.transcript_non_interactive_suppresses_turn_feed, true);
  assert.equal(devCliActivityFeedPayload.transcript_env_resolver, true);
  assert.equal(devCliActivityFeedPayload.empty_without_tool_events, true);
  assert.equal(devCliActivityFeedPayload.rows_within_width, true);
  assert.equal(devCliActivityFeedPayload.no_invalid_tokens, true);
  logStep("dev-cli-activity-feed-contract");

  const devCliActivityStateContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/dev-cli-activity-state-contract.ts",
  ]);
  assertSuccess("dev-cli-activity-state-contract", devCliActivityStateContractResult);
  const devCliActivityStatePayload = parseJsonOutput(
    "dev-cli-activity-state-contract",
    devCliActivityStateContractResult.stdout,
  );
  assert.equal(devCliActivityStatePayload.start_snapshot_visible, true);
  assert.equal(devCliActivityStatePayload.route_diagnostic_visible, true);
  assert.equal(devCliActivityStatePayload.plan_diagnostic_visible, true);
  assert.equal(devCliActivityStatePayload.plan_approval_waiting_has_detail, true);
  assert.equal(devCliActivityStatePayload.plan_mode_start_uses_plan_context, true);
  assert.equal(devCliActivityStatePayload.ok_finish_clears_prompt_activity, true);
  assert.equal(devCliActivityStatePayload.error_finish_remains_visible, true);
  assert.equal(devCliActivityStatePayload.no_done_footer_noise, true);
  logStep("dev-cli-activity-state-contract");

  const devCliStatusLineContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/dev-cli-status-line-contract.ts",
  ]);
  assertSuccess("dev-cli-status-line-contract", devCliStatusLineContractResult);
  const devCliStatusLineContractPayload = parseJsonOutput(
    "dev-cli-status-line-contract",
    devCliStatusLineContractResult.stdout,
  );
  assert.equal(devCliStatusLineContractPayload.wide_has_model, true);
  assert.equal(devCliStatusLineContractPayload.wide_has_project, true);
  assert.equal(devCliStatusLineContractPayload.wide_has_ctx_percent, true);
  assert.equal(devCliStatusLineContractPayload.wide_has_token_counter, true);
  assert.equal(devCliStatusLineContractPayload.wide_has_short_session_id, true);
  assert.equal(devCliStatusLineContractPayload.wide_has_no_s_colon_prefix, true);
  assert.equal(devCliStatusLineContractPayload.wide_has_session_topic, true);
  assert.equal(devCliStatusLineContractPayload.narrow_line_within_width, true);
  assert.equal(devCliStatusLineContractPayload.narrow_has_short_session_id, true);
  assert.equal(devCliStatusLineContractPayload.cjk_line_within_width, true);
  assert.equal(devCliStatusLineContractPayload.cjk_narrow_keeps_context_signal, true);
  assert.equal(devCliStatusLineContractPayload.tiny_line_within_width, true);
  assert.equal(devCliStatusLineContractPayload.tiny_keeps_context_signal, true);
  assert.equal(devCliStatusLineContractPayload.tiny_keeps_token_counter, true);
  assert.equal(devCliStatusLineContractPayload.tiny_keeps_short_session_id, true);
  assert.equal(devCliStatusLineContractPayload.tiny_not_session_only, true);
  assert.equal(devCliStatusLineContractPayload.warning_has_separate_line, true);
  assert.equal(devCliStatusLineContractPayload.warning_line_contains_critical, true);
  assert.equal(devCliStatusLineContractPayload.warning_status_line_unchanged, true);
  assert.equal(devCliStatusLineContractPayload.tokens_segment_toggle_effective, true);
  assert.equal(devCliStatusLineContractPayload.plan_mode_badge_visible, true);
  assert.equal(devCliStatusLineContractPayload.plan_mode_badge_leads_status, true);
  logStep("dev-cli-status-line-contract");

  const terminalTextSanitizerContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/terminal-text-sanitizer-contract.ts",
  ]);
  assertSuccess("terminal-text-sanitizer-contract", terminalTextSanitizerContractResult);
  const terminalTextSanitizerContractPayload = parseJsonOutput(
    "terminal-text-sanitizer-contract",
    terminalTextSanitizerContractResult.stdout,
  );
  assert.equal(terminalTextSanitizerContractPayload.ansi_sequences_removed, true);
  assert.equal(terminalTextSanitizerContractPayload.bidi_controls_removed, true);
  assert.equal(terminalTextSanitizerContractPayload.control_chars_removed, true);
  assert.equal(terminalTextSanitizerContractPayload.title_compacted_and_sanitized, true);
  assert.equal(terminalTextSanitizerContractPayload.title_truncation_uses_ellipsis, true);
  assert.equal(terminalTextSanitizerContractPayload.title_zero_budget_empty, true);
  logStep("terminal-text-sanitizer-contract");

  const devCliStatusIndicatorContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/dev-cli-status-indicator-contract.ts",
  ]);
  assertSuccess("dev-cli-status-indicator-contract", devCliStatusIndicatorContractResult);
  const devCliStatusIndicatorPayload = parseJsonOutput(
    "dev-cli-status-indicator-contract",
    devCliStatusIndicatorContractResult.stdout,
  );
  assert.equal(devCliStatusIndicatorPayload.line_contains_elapsed, true);
  assert.equal(devCliStatusIndicatorPayload.line_uses_braille_spinner, true);
  assert.equal(devCliStatusIndicatorPayload.line_has_brand_shimmer, true);
  assert.equal(devCliStatusIndicatorPayload.line_has_muted_base, true);
  assert.equal(devCliStatusIndicatorPayload.deterministic_for_same_tick, true);
  assert.equal(devCliStatusIndicatorPayload.narrow_keeps_interrupt_hint, true);
  assert.equal(devCliStatusIndicatorPayload.narrow_width_within_columns, true);
  assert.equal(devCliStatusIndicatorPayload.wide_width_within_columns, true);
  assert.equal(devCliStatusIndicatorPayload.reduced_motion_no_brand_sweep, true);
  assert.equal(devCliStatusIndicatorPayload.no_invalid_tokens, true);
  assert.equal(devCliStatusIndicatorPayload.elapsed_formats_minutes, true);
  assert.equal(devCliStatusIndicatorPayload.elapsed_formats_hours, true);
  assert.equal(devCliStatusIndicatorPayload.mode_glyph_requesting_is_up, true);
  assert.equal(devCliStatusIndicatorPayload.mode_glyph_responding_is_down, true);
  assert.equal(devCliStatusIndicatorPayload.thinking_status_formats_active, true);
  assert.equal(devCliStatusIndicatorPayload.thinking_status_formats_completed_duration, true);
  assert.equal(devCliStatusIndicatorPayload.token_count_formats_after_gate, true);
  assert.equal(devCliStatusIndicatorPayload.token_count_hidden_before_gate, true);
  assert.equal(devCliStatusIndicatorPayload.rich_wide_shows_thinking_tokens_elapsed_interrupt, true);
  assert.equal(devCliStatusIndicatorPayload.rich_wide_width_within_columns, true);
  assert.equal(devCliStatusIndicatorPayload.token_gate_hides_tokens_before_30s, true);
  assert.equal(devCliStatusIndicatorPayload.token_gate_shows_down_tokens_after_30s, true);
  assert.equal(devCliStatusIndicatorPayload.requesting_mode_shows_up_token_glyph, true);
  assert.equal(devCliStatusIndicatorPayload.thinking_status_line_shows_effort, true);
  assert.equal(devCliStatusIndicatorPayload.thought_status_line_shows_duration, true);
  assert.equal(devCliStatusIndicatorPayload.rich_narrow_preserves_interrupt_over_optional_parts, true);
  assert.equal(devCliStatusIndicatorPayload.rich_narrow_width_within_columns, true);
  assert.equal(devCliStatusIndicatorPayload.rich_tiny_keeps_interrupt_before_elapsed, true);
  assert.equal(devCliStatusIndicatorPayload.stall_detects_no_token_progress, true);
  assert.equal(devCliStatusIndicatorPayload.stall_active_tools_resets_timer, true);
  assert.equal(devCliStatusIndicatorPayload.stall_token_progress_resets_intensity, true);
  assert.equal(devCliStatusIndicatorPayload.stall_smoothing_is_gradual, true);
  logStep("dev-cli-status-indicator-contract");

  const devCliStatusLineStabilityContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/dev-cli-status-line-stability-contract.ts",
  ]);
  assertSuccess("dev-cli-status-line-stability-contract", devCliStatusLineStabilityContractResult);
  const devCliStatusLineStabilityPayload = parseJsonOutput(
    "dev-cli-status-line-stability-contract",
    devCliStatusLineStabilityContractResult.stdout,
  );
  assert.equal(devCliStatusLineStabilityPayload.deterministic_stable, true);
  assert.equal(devCliStatusLineStabilityPayload.warning_stable, true);
  assert.equal(devCliStatusLineStabilityPayload.widths_within_columns, true);
  assert.equal(devCliStatusLineStabilityPayload.no_invalid_tokens, true);
  assert.equal(devCliStatusLineStabilityPayload.warning_has_separate_line, true);
  assert.equal(Number(devCliStatusLineStabilityPayload.high_frequency_render_count), 2500);
  assert.equal(Number.isFinite(Number(devCliStatusLineStabilityPayload.high_frequency_average_ms)), true);
  assert.equal(devCliStatusLineStabilityPayload.performance_within_soft_budget, true);
  logStep("dev-cli-status-line-stability-contract");

  const devCliInteractiveFrameContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/dev-cli-interactive-frame-contract.ts",
  ]);
  assertSuccess("dev-cli-interactive-frame-contract", devCliInteractiveFrameContractResult);
  const devCliInteractiveFramePayload = parseJsonOutput(
    "dev-cli-interactive-frame-contract",
    devCliInteractiveFrameContractResult.stdout,
  );
  assert.equal(devCliInteractiveFramePayload.prefix_empty, true);
  assert.equal(devCliInteractiveFramePayload.inline_prompt_matches, true);
  assert.equal(devCliInteractiveFramePayload.suffix_has_status_line, true);
  assert.equal(devCliInteractiveFramePayload.suffix_has_activity_line, true);
  assert.equal(devCliInteractiveFramePayload.suffix_has_no_prompt_frame, true);
  logStep("dev-cli-interactive-frame-contract");

  const devCliBottomPaneContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/dev-cli-bottom-pane-contract.ts",
  ]);
  assertSuccess("dev-cli-bottom-pane-contract", devCliBottomPaneContractResult);
  const devCliBottomPanePayload = parseJsonOutput(
    "dev-cli-bottom-pane-contract",
    devCliBottomPaneContractResult.stdout,
  );
  assert.equal(devCliBottomPanePayload.idle_has_no_divider, true);
  assert.equal(devCliBottomPanePayload.idle_keeps_passive_status, true);
  assert.equal(devCliBottomPanePayload.idle_hides_shortcut_hint, true);
  assert.equal(devCliBottomPanePayload.idle_omits_permanent_shift_enter_hint, true);
  assert.equal(devCliBottomPanePayload.idle_footer_has_visual_weight, true);
  assert.equal(devCliBottomPanePayload.idle_footer_uses_muted_not_high_saturation, true);
  assert.equal(devCliBottomPanePayload.idle_footer_style_keeps_plain_text, true);
  assert.equal(devCliBottomPanePayload.idle_narrow_status_dimmed, true);
  assert.equal(devCliBottomPanePayload.idle_narrow_hides_shortcut_hint, true);
  assert.equal(devCliBottomPanePayload.idle_narrow_keeps_status, true);
  assert.equal(devCliBottomPanePayload.idle_narrow_lines_within_width, true);
  assert.equal(devCliBottomPanePayload.plan_mode_idle_badge_leads_status, true);
  assert.equal(devCliBottomPanePayload.pending_has_no_divider, true);
  assert.equal(devCliBottomPanePayload.pending_keeps_status_above_ask, true);
  assert.equal(devCliBottomPanePayload.pending_status_secondary, true);
  assert.equal(devCliBottomPanePayload.pending_narrow_keeps_ask_first, true);
  assert.equal(devCliBottomPanePayload.pending_default_prompt_is_short, true);
  assert.equal(devCliBottomPanePayload.pending_plan_mode_keeps_badge, true);
  assert.equal(devCliBottomPanePayload.pending_plan_mode_keeps_status_above_ask, true);
  assert.equal(devCliBottomPanePayload.pending_plan_mode_narrow_keeps_badge, true);
  assert.equal(devCliBottomPanePayload.pending_plan_mode_narrow_keeps_status_above_ask, true);
  assert.equal(devCliBottomPanePayload.pending_wide_keeps_secondary_status, true);
  assert.equal(devCliBottomPanePayload.pending_narrow_hides_secondary_status, true);
  assert.equal(devCliBottomPanePayload.pending_omits_shift_enter_hint, true);
  assert.equal(devCliBottomPanePayload.pending_warning_kept, true);
  assert.equal(devCliBottomPanePayload.pending_lines_within_width, true);
  assert.equal(devCliBottomPanePayload.pending_narrow_lines_within_width, true);
  assert.equal(devCliBottomPanePayload.pending_plan_mode_lines_within_width, true);
  assert.equal(devCliBottomPanePayload.pending_plan_mode_narrow_lines_within_width, true);
  assert.equal(devCliBottomPanePayload.running_has_activity, true);
  assert.equal(devCliBottomPanePayload.running_fallback_is_localized, true);
  assert.equal(devCliBottomPanePayload.running_plan_mode_fallback_is_planning, true);
  assert.equal(devCliBottomPanePayload.running_activity_has_visual_weight, true);
  assert.equal(devCliBottomPanePayload.running_narrow_keeps_activity_first, true);
  assert.equal(devCliBottomPanePayload.running_narrow_hides_secondary_status, true);
  assert.equal(devCliBottomPanePayload.running_plan_mode_narrow_keeps_badge, true);
  assert.equal(devCliBottomPanePayload.running_plan_mode_narrow_keeps_activity_first, true);
  assert.equal(devCliBottomPanePayload.running_omits_shift_enter_hint, true);
  assert.equal(devCliBottomPanePayload.running_status_secondary, true);
  assert.equal(devCliBottomPanePayload.running_lines_within_width, true);
  assert.equal(devCliBottomPanePayload.running_narrow_lines_within_width, true);
  assert.equal(devCliBottomPanePayload.running_plan_mode_narrow_lines_within_width, true);
  assert.equal(devCliBottomPanePayload.shortcut_overlay_has_commands, true);
  assert.equal(devCliBottomPanePayload.shortcut_overlay_has_shift_enter, true);
  assert.equal(devCliBottomPanePayload.shortcut_overlay_has_history, true);
  assert.equal(devCliBottomPanePayload.shortcut_overlay_has_hide_hint, true);
  assert.equal(devCliBottomPanePayload.shortcut_overlay_aligns_key_column, true);
  assert.equal(devCliBottomPanePayload.shortcut_overlay_has_visual_weight, true);
  assert.equal(devCliBottomPanePayload.shortcut_overlay_style_uses_accent_and_dim, true);
  assert.equal(devCliBottomPanePayload.shortcut_overlay_style_keeps_plain_text, true);
  assert.equal(devCliBottomPanePayload.shortcut_overlay_medium_uses_two_columns, true);
  assert.equal(devCliBottomPanePayload.shortcut_overlay_wide_uses_three_columns, true);
  assert.equal(devCliBottomPanePayload.shortcut_overlay_prioritizes_navigation, true);
  assert.equal(devCliBottomPanePayload.shortcut_overlay_narrow_uses_single_column, true);
  assert.equal(devCliBottomPanePayload.shortcut_overlay_lines_within_width, true);
  assert.equal(devCliBottomPanePayload.shortcut_overlay_wide_lines_within_width, true);
  assert.equal(devCliBottomPanePayload.shortcut_overlay_narrow_lines_within_width, true);
  logStep("dev-cli-bottom-pane-contract");

  const devCliTerminalMarkdownContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/dev-cli-terminal-markdown-contract.ts",
  ]);
  assertSuccess("dev-cli-terminal-markdown-contract", devCliTerminalMarkdownContractResult);
  const devCliTerminalMarkdownPayload = parseJsonOutput(
    "dev-cli-terminal-markdown-contract",
    devCliTerminalMarkdownContractResult.stdout,
  );
  assert.equal(devCliTerminalMarkdownPayload.strong_renders_bold, true);
  assert.equal(devCliTerminalMarkdownPayload.inline_code_renders_dim, true);
  assert.equal(devCliTerminalMarkdownPayload.fenced_code_preserves_markdown_markers, true);
  assert.equal(devCliTerminalMarkdownPayload.heading_preserves_hash_marker, true);
  assert.equal(devCliTerminalMarkdownPayload.plain_text_preserved, true);
  assert.equal(devCliTerminalMarkdownPayload.disabled_preserves_raw_markdown, true);
  assert.equal(devCliTerminalMarkdownPayload.off_mode_preserves_raw_markdown, true);
  assert.equal(devCliTerminalMarkdownPayload.rich_mode_currently_uses_basic_renderer, true);
  assert.equal(devCliTerminalMarkdownPayload.env_off_resolves_off, true);
  assert.equal(devCliTerminalMarkdownPayload.env_basic_default, true);
  assert.equal(devCliTerminalMarkdownPayload.env_rich_resolves_rich, true);
  logStep("dev-cli-terminal-markdown-contract");

  const devCliAskUserPanelContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/dev-cli-ask-user-panel-contract.ts",
  ]);
  assertSuccess("dev-cli-ask-user-panel-contract", devCliAskUserPanelContractResult);
  const devCliAskUserPanelPayload = parseJsonOutput(
    "dev-cli-ask-user-panel-contract",
    devCliAskUserPanelContractResult.stdout,
  );
  assert.equal(devCliAskUserPanelPayload.panel_has_brand_divider, true);
  assert.equal(devCliAskUserPanelPayload.panel_omits_raw_ask_user_label, true);
  assert.equal(devCliAskUserPanelPayload.panel_has_codex_like_progress, true);
  assert.equal(devCliAskUserPanelPayload.panel_plan_mode_shows_planning_path, true);
  assert.equal(devCliAskUserPanelPayload.panel_has_claude_like_question_tabs, true);
  assert.equal(devCliAskUserPanelPayload.panel_question_separate_from_options, true);
  assert.equal(devCliAskUserPanelPayload.panel_preserves_option_descriptions, true);
  assert.equal(devCliAskUserPanelPayload.panel_has_other_type_something_row, true);
  assert.equal(devCliAskUserPanelPayload.panel_has_direct_keyboard_hints, true);
  assert.equal(devCliAskUserPanelPayload.panel_has_notes_affordance, true);
  assert.equal(devCliAskUserPanelPayload.panel_has_chat_about_this_row, true);
  assert.equal(devCliAskUserPanelPayload.panel_has_plan_skip_affordance, true);
  assert.equal(devCliAskUserPanelPayload.panel_review_has_submit_edit_cancel, true);
  assert.equal(devCliAskUserPanelPayload.panel_review_has_answer_summary, true);
  assert.equal(devCliAskUserPanelPayload.panel_text_input_renders_value, true);
  assert.equal(devCliAskUserPanelPayload.panel_secret_text_input_masks_value, true);
  assert.equal(devCliAskUserPanelPayload.panel_narrow_keeps_lines_within_width, true);
  assert.equal(devCliAskUserPanelPayload.panel_wide_keeps_lines_within_width, true);
  assert.equal(devCliAskUserPanelPayload.panel_interactive_uses_warm_brand_color, true);
  assert.equal(devCliAskUserPanelPayload.panel_no_box_frame, true);
  assert.equal(devCliAskUserPanelPayload.panel_narrow_keeps_progress, true);
  logStep("dev-cli-ask-user-panel-contract");

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
  assert.equal(askUserToolContractPayload.resolved_event_has_ask_id, true);
  assert.equal(askUserToolContractPayload.issued_registered, true);
  assert.equal(Number(askUserToolContractPayload.queue_size_after_enqueue), 2);
  assert.equal(askUserToolContractPayload.queue_dedupe_keeps_size, true);
  assert.equal(askUserToolContractPayload.queue_resolve_first_matches_q2, true);
  assert.equal(askUserToolContractPayload.queue_next_after_resolve_is_q3, true);
  assert.equal(Number(askUserToolContractPayload.queue_size_after_resolve), 1);
  assert.equal(askUserToolContractPayload.queue_midway_prompt_deferred, true);
  assert.equal(askUserToolContractPayload.queue_final_prompt_released, true);
  assert.equal(askUserToolContractPayload.queue_empty_after_batch_resolved, true);
  assert.equal(askUserToolContractPayload.answer_numeric_index_maps_option, true);
  assert.equal(askUserToolContractPayload.answer_full_width_index_maps_option, true);
  assert.equal(askUserToolContractPayload.answer_case_insensitive_option_maps_canonical, true);
  assert.equal(askUserToolContractPayload.answer_other_literal_is_custom, true);
  assert.equal(askUserToolContractPayload.answer_other_id_literal_is_custom, true);
  assert.equal(askUserToolContractPayload.answer_out_of_range_index_is_custom, true);
  assert.equal(askUserToolContractPayload.answer_blank_falls_back_default, true);
  assert.equal(askUserToolContractPayload.queue_ttl_prune_removed_expired, true);
  assert.equal(askUserToolContractPayload.queue_ttl_prune_keeps_fresh, true);
  assert.equal(askUserToolContractPayload.issued_display_has_reply_hint, true);
  assert.equal(askUserToolContractPayload.issued_display_has_reply_guide, true);
  assert.equal(askUserToolContractPayload.issued_display_uses_prompt_chevron, true);
  assert.equal(askUserToolContractPayload.issued_display_has_other_type_something, true);
  assert.equal(askUserToolContractPayload.issued_display_shows_question_progress, true);
  assert.equal(askUserToolContractPayload.issued_display_shows_option_description, true);
  assert.equal(askUserToolContractPayload.issued_display_hides_resume_token, true);
  assert.equal(askUserToolContractPayload.issued_display_compact_options, true);
  assert.equal(askUserToolContractPayload.issued_display_hides_log_prefix, true);
  assert.equal(askUserToolContractPayload.issued_display_hides_options_preview, true);
  assert.equal(askUserToolContractPayload.issued_display_overflow_lists_sixth_option, true);
  assert.equal(askUserToolContractPayload.issued_event_has_ask_id, true);
  assert.equal(askUserToolContractPayload.ask_user_menu_title_has_progress, true);
  assert.equal(askUserToolContractPayload.ask_user_menu_hint_returns_to_input, true);
  assert.equal(askUserToolContractPayload.ask_user_menu_omits_noisy_default_descriptions, true);
  assert.equal(askUserToolContractPayload.ask_user_menu_preserves_option_descriptions, true);
  assert.equal(askUserToolContractPayload.ask_user_queue_display_shows_progress, true);
  assert.equal(askUserToolContractPayload.ask_user_queue_display_hides_raw_diagnostics, true);
  assert.equal(askUserToolContractPayload.questionnaire_navigation_prev_stays_in_bounds, true);
  assert.equal(askUserToolContractPayload.questionnaire_navigation_option_wraps, true);
  assert.equal(askUserToolContractPayload.questionnaire_answer_focused_advances, true);
  assert.equal(askUserToolContractPayload.questionnaire_view_has_question_tabs, true);
  assert.equal(askUserToolContractPayload.questionnaire_view_has_other_input_option, true);
  assert.equal(askUserToolContractPayload.questionnaire_review_available, true);
  assert.equal(askUserToolContractPayload.questionnaire_selection_maps_canonical_value, true);
  assert.equal(askUserToolContractPayload.questionnaire_batch_answer_text_is_numbered, true);
  assert.equal(askUserToolContractPayload.questionnaire_review_menu_has_submit_and_edit, true);
  assert.equal(askUserToolContractPayload.batch_numbered_answers_release_prompt, true);
  assert.equal(askUserToolContractPayload.batch_numbered_answers_resolve_all, true);
  assert.equal(askUserToolContractPayload.batch_legacy_numbered_answers_still_resolve_all, true);
  assert.equal(askUserToolContractPayload.batch_partial_numbered_answer_does_not_release_prompt, true);
  assert.equal(askUserToolContractPayload.batch_invalid_numbered_answer_does_not_release_prompt, true);
  assert.equal(askUserToolContractPayload.batch_json_encoded_custom_answer_stays_single_answer, true);
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

  const memoryOrchestratorContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/memory-orchestrator-contract.ts",
  ]);
  assertSuccess("memory-orchestrator-contract", memoryOrchestratorContractResult);
  const memoryOrchestratorContractPayload = parseJsonOutput(
    "memory-orchestrator-contract",
    memoryOrchestratorContractResult.stdout,
  );
  assert.equal(memoryOrchestratorContractPayload.policy_has_override_ratio, true);
  assert.equal(Number(memoryOrchestratorContractPayload.policy_max_section_tokens), 800);
  assert.equal(memoryOrchestratorContractPayload.policy_default_min_tokens, true);
  assert.equal(memoryOrchestratorContractPayload.inject_has_prompt_parts, true);
  assert.equal(memoryOrchestratorContractPayload.inject_budget_positive, true);
  assert.equal(memoryOrchestratorContractPayload.inject_budget_respects_ratio, true);
  assert.equal(memoryOrchestratorContractPayload.reconcile_deduplicated, true);
  assert.equal(memoryOrchestratorContractPayload.reconcile_kept, true);
  assert.equal(memoryOrchestratorContractPayload.reconcile_rows_length, true);
  assert.equal(memoryOrchestratorContractPayload.decay_pruned, true);
  assert.equal(memoryOrchestratorContractPayload.decay_kept, true);
  assert.equal(memoryOrchestratorContractPayload.decay_dropped, true);
  assert.equal(memoryOrchestratorContractPayload.decay_rows_length, true);
  assert.equal(memoryOrchestratorContractPayload.decay_kept_expected_rows, true);
  assert.equal(memoryOrchestratorContractPayload.decay_dropped_age_count, true);
  assert.equal(memoryOrchestratorContractPayload.decay_dropped_confidence_count, true);
  assert.equal(memoryOrchestratorContractPayload.decay_dropped_capacity_count, true);
  assert.equal(memoryOrchestratorContractPayload.decay_reason_present, true);
  assert.equal(memoryOrchestratorContractPayload.decay_reason_has_capacity, true);
  assert.equal(memoryOrchestratorContractPayload.tune_decay_policy_applied_rows, true);
  assert.equal(memoryOrchestratorContractPayload.tune_decay_policy_applied_confidence, true);
  assert.equal(memoryOrchestratorContractPayload.tune_decay_policy_applied_age, true);
  assert.equal(memoryOrchestratorContractPayload.tune_injection_policy_applied, true);
  assert.equal(memoryOrchestratorContractPayload.inject_includes_ga_or_experience, true);
  assert.equal(memoryOrchestratorContractPayload.inject_filters_self_from_team_memory, true);
  assert.equal(memoryOrchestratorContractPayload.inject_emits_event, true);
  assert.equal(memoryOrchestratorContractPayload.feedback_turn_success_calls_ga_once, true);
  assert.equal(memoryOrchestratorContractPayload.feedback_turn_success_calls_experience_once, true);
  assert.equal(memoryOrchestratorContractPayload.feedback_turn_success_emits_publish_event, true);
  assert.equal(memoryOrchestratorContractPayload.feedback_verification_failure_only_hits_experience, true);
  assert.equal(memoryOrchestratorContractPayload.feedback_verification_failure_event, true);
  assert.equal(memoryOrchestratorContractPayload.feedback_turn_failure_calls_ga, true);
  assert.equal(memoryOrchestratorContractPayload.feedback_turn_failure_calls_experience, true);
  assert.equal(memoryOrchestratorContractPayload.feedback_turn_failure_event, true);
  logStep("memory-orchestrator-contract");

  const experiencePoolTaskContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/experience-pool-task-contract.ts",
  ]);
  assertSuccess("experience-pool-task-contract", experiencePoolTaskContractResult);
  const experiencePoolTaskContractPayload = parseJsonOutput(
    "experience-pool-task-contract",
    experiencePoolTaskContractResult.stdout,
  );
  assert.equal(experiencePoolTaskContractPayload.created_record, true);
  assert.equal(experiencePoolTaskContractPayload.failure_matched, true);
  assert.equal(experiencePoolTaskContractPayload.failure_stage_classified_runtime, true);
  assert.equal(experiencePoolTaskContractPayload.guardrails_generated_after_failure, true);
  assert.equal(experiencePoolTaskContractPayload.recovery_success_incremented, true);
  assert.equal(experiencePoolTaskContractPayload.consecutive_failure_reset_after_recovery, true);
  assert.equal(experiencePoolTaskContractPayload.attempt_history_has_both_outcomes, true);
  assert.equal(experiencePoolTaskContractPayload.search_prefers_task_overlap, true);
  assert.equal(experiencePoolTaskContractPayload.search_emits_task_or_scenario_signals, true);
  assert.equal(experiencePoolTaskContractPayload.roundtrip_task_signature_persisted, true);
  assert.equal(experiencePoolTaskContractPayload.roundtrip_attempt_history_persisted, true);
  assert.equal(experiencePoolTaskContractPayload.roundtrip_task_metadata_persisted, true);
  logStep("experience-pool-task-contract");

  const memoryDecayAutotuneContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/memory-decay-autotune-contract.ts",
  ]);
  assertSuccess("memory-decay-autotune-contract", memoryDecayAutotuneContractResult);
  const memoryDecayAutotuneContractPayload = parseJsonOutput(
    "memory-decay-autotune-contract",
    memoryDecayAutotuneContractResult.stdout,
  );
  assert.equal(memoryDecayAutotuneContractPayload.capacity_update_changed, true);
  assert.equal(memoryDecayAutotuneContractPayload.capacity_update_expands_rows, true);
  assert.equal(memoryDecayAutotuneContractPayload.capacity_update_has_reason, true);
  assert.equal(memoryDecayAutotuneContractPayload.confidence_update_changed, true);
  assert.equal(memoryDecayAutotuneContractPayload.confidence_update_tightens_verified, true);
  assert.equal(memoryDecayAutotuneContractPayload.confidence_update_tightens_unverified, true);
  assert.equal(memoryDecayAutotuneContractPayload.confidence_update_has_reason, true);
  assert.equal(memoryDecayAutotuneContractPayload.quality_pressure_update_changed, true);
  assert.equal(memoryDecayAutotuneContractPayload.quality_pressure_update_has_reason, true);
  assert.equal(memoryDecayAutotuneContractPayload.quality_pressure_update_shrinks_rows, true);
  assert.equal(memoryDecayAutotuneContractPayload.quality_pressure_update_tightens_verified, true);
  assert.equal(memoryDecayAutotuneContractPayload.quality_pressure_update_tightens_unverified, true);
  assert.equal(memoryDecayAutotuneContractPayload.quality_signal_update_changed, true);
  assert.equal(memoryDecayAutotuneContractPayload.quality_signal_update_has_reason, true);
  assert.equal(memoryDecayAutotuneContractPayload.quality_signal_update_expands_rows, true);
  assert.equal(memoryDecayAutotuneContractPayload.quality_signal_update_relaxes_verified, true);
  assert.equal(memoryDecayAutotuneContractPayload.quality_signal_update_relaxes_unverified, true);
  assert.equal(memoryDecayAutotuneContractPayload.normalized_invalid_rows_floor, true);
  assert.equal(memoryDecayAutotuneContractPayload.normalized_invalid_verified_confidence_clamped, true);
  assert.equal(memoryDecayAutotuneContractPayload.normalized_invalid_unverified_confidence_clamped, true);
  assert.equal(memoryDecayAutotuneContractPayload.normalized_invalid_alpha_clamped, true);
  assert.equal(memoryDecayAutotuneContractPayload.policy_applied_matches_state, true);
  assert.equal(memoryDecayAutotuneContractPayload.state_roundtrip_updates_kept, true);
  assert.equal(memoryDecayAutotuneContractPayload.state_roundtrip_reason_kept, true);
  logStep("memory-decay-autotune-contract");

  const memoryStrategyAutotuneContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/memory-strategy-autotune-contract.ts",
  ]);
  assertSuccess("memory-strategy-autotune-contract", memoryStrategyAutotuneContractResult);
  const memoryStrategyAutotuneContractPayload = parseJsonOutput(
    "memory-strategy-autotune-contract",
    memoryStrategyAutotuneContractResult.stdout,
  );
  assert.equal(memoryStrategyAutotuneContractPayload.quality_pressure_update_changed, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_pressure_update_has_reason, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_pressure_budget_tightened, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_pressure_section_tightened, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_pressure_score_tightened, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_pressure_alpha_rebalanced, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_relax_update_changed, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_relax_update_has_reason, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_relax_budget_relaxed, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_relax_section_relaxed, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_relax_score_relaxed, true);
  assert.equal(memoryStrategyAutotuneContractPayload.quality_relax_alpha_rebalanced, true);
  assert.equal(memoryStrategyAutotuneContractPayload.pressure_only_update_changed, true);
  assert.equal(memoryStrategyAutotuneContractPayload.pressure_only_update_has_reason, true);
  assert.equal(memoryStrategyAutotuneContractPayload.pressure_only_update_budget_tightened, true);
  assert.equal(memoryStrategyAutotuneContractPayload.pressure_only_update_section_tightened, true);
  assert.equal(memoryStrategyAutotuneContractPayload.pressure_only_update_quality_still_healthy, true);
  assert.equal(memoryStrategyAutotuneContractPayload.cooldown_hold_has_reason, true);
  assert.equal(memoryStrategyAutotuneContractPayload.cooldown_hold_keeps_ratio, true);
  assert.equal(memoryStrategyAutotuneContractPayload.cooldown_hold_decrements_window, true);
  assert.equal(memoryStrategyAutotuneContractPayload.cooldown_release_has_relax_reason, true);
  assert.equal(memoryStrategyAutotuneContractPayload.cooldown_release_ratio_increases, true);
  assert.equal(memoryStrategyAutotuneContractPayload.cooldown_release_direction_relax, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_budget_clamped, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_schema_clamped, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_profile_defaulted, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_section_clamped, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_rows_clamped, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_score_clamped, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_alpha_clamped, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_followup_clamped, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_cooldown_clamped, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_action_scale_clamped, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_pending_defaults, true);
  assert.equal(memoryStrategyAutotuneContractPayload.normalized_invalid_outcome_defaults, true);
  assert.equal(memoryStrategyAutotuneContractPayload.delivery_profile_switched, true);
  assert.equal(memoryStrategyAutotuneContractPayload.delivery_profile_triggers_tighten, true);
  assert.equal(memoryStrategyAutotuneContractPayload.docs_profile_switched, true);
  assert.equal(
    memoryStrategyAutotuneContractPayload.docs_profile_more_conservative_than_delivery,
    true,
  );
  assert.equal(memoryStrategyAutotuneContractPayload.pending_warmup_reason_present, true);
  assert.equal(memoryStrategyAutotuneContractPayload.pending_warmup_turn_decremented, true);
  assert.equal(memoryStrategyAutotuneContractPayload.rollback_update_has_reason, true);
  assert.equal(memoryStrategyAutotuneContractPayload.rollback_update_cooldown_applied, true);
  assert.equal(memoryStrategyAutotuneContractPayload.rollback_update_pending_cleared, true);
  assert.equal(memoryStrategyAutotuneContractPayload.rollback_update_restores_budget_range, true);
  assert.equal(memoryStrategyAutotuneContractPayload.rollback_update_counter_incremented, true);
  assert.equal(memoryStrategyAutotuneContractPayload.rollback_update_outcome_negative, true);
  assert.equal(memoryStrategyAutotuneContractPayload.rollback_update_direction_neutral, true);
  assert.equal(memoryStrategyAutotuneContractPayload.policy_applied_matches_state, true);
  assert.equal(memoryStrategyAutotuneContractPayload.state_roundtrip_updates_kept, true);
  assert.equal(memoryStrategyAutotuneContractPayload.state_roundtrip_reason_kept, true);
  assert.equal(memoryStrategyAutotuneContractPayload.state_roundtrip_profile_kept, true);
  assert.equal(memoryStrategyAutotuneContractPayload.state_roundtrip_schema_kept, true);
  logStep("memory-strategy-autotune-contract");

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
  assert.equal(interactiveBindingsPayload.context_status_has_header, true);
  assert.equal(interactiveBindingsPayload.context_status_has_system_prompt_name, true);
  assert.equal(interactiveBindingsPayload.context_status_keeps_memory_separate, true);
  assert.equal(interactiveBindingsPayload.memory_status_has_header, true);
  assert.equal(interactiveBindingsPayload.skills_status_counts_project_skill, true);
  assert.equal(interactiveBindingsPayload.skills_status_counts_global_skill, true);
  assert.equal(interactiveBindingsPayload.mcp_status_has_server, true);
  assert.equal(interactiveBindingsPayload.mcp_status_instruction_pack_loaded, true);
  assert.equal(interactiveBindingsPayload.init_prompt_targets_agents, true);
  assert.equal(interactiveBindingsPayload.init_prompt_blocks_trellis, true);
  assert.equal(interactiveBindingsPayload.init_prompt_blocks_system_prompt_file, true);
  assert.equal(interactiveBindingsPayload.init_existing_agents_skips, true);
  assert.equal(interactiveBindingsPayload.init_generation_surface_is_human, true);
  assert.equal(interactiveBindingsPayload.manual_handoff_reason, "manual-command");
  assert.equal(interactiveBindingsPayload.manual_handoff_to_stderr, false);
  assert.equal(interactiveBindingsPayload.auto_exit_to_stderr, false);
  assert.equal(Number(interactiveBindingsPayload.history_count), 2);
  assert.equal(interactiveBindingsPayload.help_text, "contract-help");
  assert.equal(interactiveBindingsPayload.active_session_id, "main");
  assert.equal(interactiveBindingsPayload.active_session_topic, "");
  assert.equal(interactiveBindingsPayload.model_snapshot_model, "alpha-model");
  assert.equal(interactiveBindingsPayload.model_snapshot_provider, "alpha");
  assert.equal(Number(interactiveBindingsPayload.prompt_budget_ctx_ratio), 0.42);
  assert.equal(Number(interactiveBindingsPayload.prompt_budget_estimated_tokens), 512);
  assert.equal(Number(interactiveBindingsPayload.prompt_budget_target_tokens), 2048);
  assert.equal(interactiveBindingsPayload.status_menu_cancel_is_silent, true);
  assert.equal(interactiveBindingsPayload.status_menu_hint_is_reference_compact, true);
  assert.equal(interactiveBindingsPayload.history_search_hint_is_reference_fill, true);
  assert.equal(interactiveBindingsPayload.interactive_menu_hints_omit_secondary_key_chords, true);
  assert.equal(interactiveBindingsPayload.ask_status_no_pending_warned, true);
  assert.equal(interactiveBindingsPayload.ask_status_has_clean_question, true);
  assert.equal(interactiveBindingsPayload.ask_status_has_clean_options, true);
  assert.equal(interactiveBindingsPayload.ask_status_has_menu_hint, true);
  assert.equal(interactiveBindingsPayload.ask_status_hides_options_preview, true);
  assert.equal(interactiveBindingsPayload.ask_status_hides_log_prefix, true);
  assert.equal(interactiveBindingsPayload.ask_status_hides_output_mode_full, true);
  assert.equal(interactiveBindingsPayload.ask_status_hides_options_more, true);
  assert.equal(interactiveBindingsPayload.ask_status_has_pending_total, true);
  assert.equal(interactiveBindingsPayload.ask_status_hides_followup_row, true);
  assert.equal(interactiveBindingsPayload.ask_status_hides_reply_direct_log_hint, true);
  assert.equal(interactiveBindingsPayload.ask_status_hides_status_only_log_hint, true);
  assert.equal(interactiveBindingsPayload.ask_queue_hint_hides_log_prefix, true);
  assert.equal(interactiveBindingsPayload.ask_queue_hint_mentions_followup_count, true);
  assert.equal(interactiveBindingsPayload.ask_status_compact_has_header, true);
  assert.equal(interactiveBindingsPayload.ask_status_compact_hides_output_mode, true);
  assert.equal(interactiveBindingsPayload.ask_status_compact_hides_detail_hint, true);
  assert.equal(interactiveBindingsPayload.ask_status_compact_has_pending_total, true);
  assert.equal(interactiveBindingsPayload.ask_status_compact_hides_followup_rows, true);
  assert.equal(interactiveBindingsPayload.ask_status_compact_hides_status_only_hint, true);
  assert.equal(interactiveBindingsPayload.auto_ask_handler_returns_continue, true);
  assert.equal(interactiveBindingsPayload.auto_ask_handler_auto_opens_initial_runtime_ask, true);
  assert.equal(interactiveBindingsPayload.auto_ask_handler_uses_input_pause, true);
  assert.equal(interactiveBindingsPayload.auto_ask_handler_feeds_selected_answer, true);
  assert.equal(interactiveBindingsPayload.auto_ask_handler_keeps_failure_clear, true);
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
  assert.equal(modelOpsContractPayload.initial_snapshot_provider, "provider-main");
  assert.equal(modelOpsContractPayload.initial_snapshot_model, "model-default");
  assert.equal(modelOpsContractPayload.initial_snapshot_source, "config:provider:model");
  assert.equal(modelOpsContractPayload.initial_model, "model-default");
  assert.equal(modelOpsContractPayload.initial_source, "config:provider:model");
  assert.equal(modelOpsContractPayload.initial_session_title, "Main Session");
  assert.equal(
    modelOpsContractPayload.initial_session_summary,
    "Trace model override and reset contract",
  );
  assert.equal(modelOpsContractPayload.main_model_after_use, "model-variant");
  assert.equal(modelOpsContractPayload.main_source_after_use, "config_toml:provider.model");
  assert.equal(modelOpsContractPayload.main_session_id_after_use, "session-main");
  assert.equal(modelOpsContractPayload.main_session_title_after_use, "Main Session");
  assert.equal(
    modelOpsContractPayload.main_session_summary_after_use,
    "Trace model override and reset contract",
  );
  assert.equal(modelOpsContractPayload.main_model_after_reset, "model-default");
  assert.equal(
    modelOpsContractPayload.main_source_after_reset,
    "config_toml:provider.model",
  );
  assert.equal(modelOpsContractPayload.branch_model_after_switch, "model-default");
  assert.equal(
    modelOpsContractPayload.branch_source_after_switch,
    "config_toml:provider.model",
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
  assert.equal(Number(modelOpsContractPayload.list_calls), 4);
  assert.equal(Number(modelOpsContractPayload.persist_call_count), 2);
  assert.equal(modelOpsContractPayload.persist_first_call, "provider-main:model-variant");
  assert.equal(modelOpsContractPayload.persist_second_call, "provider-main:model-default");
  assert.equal(modelOpsContractPayload.list_output_has_current_marker, true);
  assert.equal(modelOpsContractPayload.list_output_has_variant, true);
  assert.equal(Number(modelOpsContractPayload.model_menu_pause_calls), 1);
  assert.equal(modelOpsContractPayload.model_menu_variant, "model_picker");
  assert.equal(modelOpsContractPayload.model_menu_hint_is_reference_compact, true);
  assert.equal(modelOpsContractPayload.model_menu_initial_index_points_to_current, true);
  assert.equal(modelOpsContractPayload.model_menu_current_item_marked, true);
  assert.equal(modelOpsContractPayload.model_menu_meta_current_model, "model-default");
  assert.equal(modelOpsContractPayload.model_menu_meta_startup_model, "model-default");
  assert.equal(modelOpsContractPayload.model_menu_cancel_is_silent, true);
  assert.equal(
    modelOpsContractPayload.runtime_source_after_switch,
    "config_toml:provider.model",
  );
  logStep("run-start-model-ops-contract");

  const modelConfigSyncContractResult = runCommand("npx", [
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    "gateway/src/extensions/contracts/run-start-model-config-sync-contract.ts",
  ]);
  assertSuccess("run-start-model-config-sync-contract", modelConfigSyncContractResult);
  const modelConfigSyncContractPayload = parseJsonOutput(
    "run-start-model-config-sync-contract",
    modelConfigSyncContractResult.stdout,
  );
  assert.equal(modelConfigSyncContractPayload.update_existing_ok, true);
  assert.equal(modelConfigSyncContractPayload.update_existing_previous_model, true);
  assert.equal(modelConfigSyncContractPayload.update_existing_comment_preserved, true);
  assert.equal(modelConfigSyncContractPayload.update_existing_secondary_untouched, true);
  assert.equal(modelConfigSyncContractPayload.insert_missing_ok, true);
  assert.equal(modelConfigSyncContractPayload.insert_missing_previous_model_empty, true);
  assert.equal(modelConfigSyncContractPayload.insert_missing_added_model, true);
  assert.equal(modelConfigSyncContractPayload.fallback_by_workdir_ok, true);
  assert.equal(modelConfigSyncContractPayload.fallback_selected_provider_updated, true);
  assert.equal(modelConfigSyncContractPayload.fallback_non_selected_provider_untouched, true);
  assert.equal(modelConfigSyncContractPayload.missing_config_path_failed, true);
  assert.equal(modelConfigSyncContractPayload.empty_model_failed, true);
  assert.equal(modelConfigSyncContractPayload.missing_file_failed, true);
  logStep("run-start-model-config-sync-contract");

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

  const historyResolveConfigEnvBaseline = {
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
  };
  const historyResolveConfigResult = runContract("history-compaction-contract.mjs", "resolve-config", [
    "--payload",
    JSON.stringify({
      project_toml: {
        retrieval: {
          enabled: true,
          selected_limit: 5,
          candidate_limit: 9,
          base_url: "https://api.siliconflow.cn/v1",
          api_key: "retrieval-key",
          embedding: {
            enabled: true,
            model: "Qwen/Qwen3-Embedding-4B",
            dimensions: 2560,
          },
          rerank: {
            enabled: true,
            model: "Qwen/Qwen3-Reranker-0.6B",
          },
        },
      },
      global_toml: {
        retrieval: {
          base_url: "https://global-should-be-ignored.invalid/v1",
          api_key: "global-should-be-ignored",
          embedding: {
            model: "ignored-global-embedding-model",
          },
          rerank: {
            model: "ignored-global-rerank-model",
          },
        },
      },
    }),
  ], {
    env: {
      ...process.env,
      ...historyResolveConfigEnvBaseline,
    },
  });
  const historyResolveConfigPayload = parseJsonOutput(
    "history-compaction-contract resolve-config",
    historyResolveConfigResult.stdout,
  );
  assert.equal(historyResolveConfigPayload.enabled, true);
  assert.equal(historyResolveConfigPayload.source, "project");
  assert.equal(historyResolveConfigPayload.enabled_source, "project");
  assert.equal(historyResolveConfigPayload.selected_limit, 5);
  assert.equal(historyResolveConfigPayload.candidate_limit, 9);
  assert.equal(historyResolveConfigPayload.selected_limit_source, "project");
  assert.equal(historyResolveConfigPayload.candidate_limit_source, "project");
  assert.equal(historyResolveConfigPayload.shared_base_url, "https://api.siliconflow.cn/v1");
  assert.equal(historyResolveConfigPayload.shared_base_url_source, "project");
  assert.equal(historyResolveConfigPayload.shared_api_key_source, "project");
  assert.equal(historyResolveConfigPayload.embedding?.model, "Qwen/Qwen3-Embedding-4B");
  assert.equal(historyResolveConfigPayload.embedding?.dimensions, 2560);
  assert.equal(historyResolveConfigPayload.embedding?.base_url, "https://api.siliconflow.cn/v1/embeddings");
  assert.equal(historyResolveConfigPayload.embedding_source, "project");
  assert.equal(historyResolveConfigPayload.embedding_dimensions_source, "project");
  assert.equal(historyResolveConfigPayload.rerank?.model, "Qwen/Qwen3-Reranker-0.6B");
  assert.equal(historyResolveConfigPayload.rerank?.base_url, "https://api.siliconflow.cn/v1/rerank");
  assert.equal(historyResolveConfigPayload.rerank_source, "project");
  assert.equal(historyResolveConfigPayload.embedding_api_key_source, "project");
  assert.equal(historyResolveConfigPayload.embedding_base_url_source, "project");
  assert.equal(historyResolveConfigPayload.rerank_api_key_source, "project");
  assert.equal(historyResolveConfigPayload.rerank_base_url_source, "project");
  assert.equal(historyResolveConfigPayload.embedding_disabled_reason, null);
  assert.equal(historyResolveConfigPayload.rerank_disabled_reason, null);
  logStep("history-compaction-contract resolve-config");

  const historyResolveConfigEnvIgnoredResult = runContract("history-compaction-contract.mjs", "resolve-config", [
    "--payload",
    JSON.stringify({
      project_toml: {
        retrieval: {
          enabled: true,
          base_url: "https://project-only.invalid/v1",
          api_key: "project-only-key",
          embedding: {
            model: "Qwen/Qwen3-Embedding-4B",
            dimensions: 2560,
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
      ...historyResolveConfigEnvBaseline,
      CONTEXTWEAVER_API_KEY: "env-shared-key",
      CONTEXTWEAVER_BASE_URL: "https://env-shared.example.com/v1",
      CONTEXTWEAVER_EMBEDDINGS_API_KEY: "env-embed-key",
      CONTEXTWEAVER_EMBEDDINGS_BASE_URL: "https://env-embed.example.com/v1",
      CONTEXTWEAVER_EMBEDDINGS_MODEL: "Qwen/Qwen3-Embedding-0.6B",
      CONTEXTWEAVER_EMBEDDINGS_DIMENSIONS: "1536",
      CONTEXTWEAVER_RERANK_API_KEY: "env-rerank-key",
      CONTEXTWEAVER_RERANK_BASE_URL: "https://env-rerank.example.com/v1",
      CONTEXTWEAVER_RERANK_MODEL: "Qwen/Qwen3-Reranker-8B",
      GROBOT_RETRIEVAL_API_KEY: "env-grobot-key",
      GROBOT_RETRIEVAL_BASE_URL: "https://env-grobot.example.com/v1",
      GROBOT_EMBEDDING_API_KEY: "env-grobot-embedding-key",
      GROBOT_EMBEDDING_BASE_URL: "https://env-grobot-embedding.example.com/v1",
      GROBOT_EMBEDDING_MODEL: "env-grobot-embedding-model",
      GROBOT_EMBEDDING_DIMENSIONS: "1024",
      GROBOT_RERANK_API_KEY: "env-grobot-rerank-key",
      GROBOT_RERANK_BASE_URL: "https://env-grobot-rerank.example.com/v1",
      GROBOT_RERANK_MODEL: "env-grobot-rerank-model",
    },
  });
  const historyResolveConfigEnvIgnoredPayload = parseJsonOutput(
    "history-compaction-contract resolve-config env ignored",
    historyResolveConfigEnvIgnoredResult.stdout,
  );
  assert.equal(historyResolveConfigEnvIgnoredPayload.shared_base_url, "https://project-only.invalid/v1");
  assert.equal(historyResolveConfigEnvIgnoredPayload.shared_base_url_source, "project");
  assert.equal(historyResolveConfigEnvIgnoredPayload.shared_api_key_source, "project");
  assert.equal(historyResolveConfigEnvIgnoredPayload.embedding?.model, "Qwen/Qwen3-Embedding-4B");
  assert.equal(historyResolveConfigEnvIgnoredPayload.embedding?.dimensions, 2560);
  assert.equal(historyResolveConfigEnvIgnoredPayload.embedding?.base_url, "https://project-only.invalid/v1/embeddings");
  assert.equal(historyResolveConfigEnvIgnoredPayload.embedding_source, "project");
  assert.equal(historyResolveConfigEnvIgnoredPayload.rerank?.model, "Qwen/Qwen3-Reranker-0.6B");
  assert.equal(historyResolveConfigEnvIgnoredPayload.rerank?.base_url, "https://project-only.invalid/v1/rerank");
  assert.equal(historyResolveConfigEnvIgnoredPayload.rerank_source, "project");
  logStep("history-compaction-contract resolve-config-env-ignored");

  const historyCompactionContractPath = resolve(contractsRoot, "history-compaction-contract.mjs");
  const historyResolveConfigPlaceholderKeyResult = runCommand("node", [
    historyCompactionContractPath,
    "resolve-config",
    "--payload",
    JSON.stringify({
      project_toml: {
        retrieval: {
          enabled: true,
          base_url: "https://api.siliconflow.cn/v1",
          api_key: "replace-with-retrieval-api-key",
          embedding: {
            model: "Qwen/Qwen3-Embedding-4B",
            dimensions: 2560,
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
      ...historyResolveConfigEnvBaseline,
    },
  });
  assert.notEqual(historyResolveConfigPlaceholderKeyResult.code, 0);
  assert.match(
    historyResolveConfigPlaceholderKeyResult.stderr,
    /invalid \[retrieval\.\*\] in project_toml; missing required fields: retrieval\.api_key/,
  );
  logStep("history-compaction-contract resolve-config-placeholder-key-fails");

  const historyResolveConfigEnvOnlyResult = runCommand("node", [
    historyCompactionContractPath,
    "resolve-config",
    "--payload",
    JSON.stringify({
      project_toml: {},
      global_toml: {},
    }),
  ], {
    env: {
      ...process.env,
      ...historyResolveConfigEnvBaseline,
      CONTEXTWEAVER_API_KEY: "env-shared-key",
      CONTEXTWEAVER_BASE_URL: "https://env-shared.example.com/v1",
      CONTEXTWEAVER_EMBEDDINGS_API_KEY: "env-embed-key",
      CONTEXTWEAVER_EMBEDDINGS_BASE_URL: "https://env-embed.example.com/v1",
      CONTEXTWEAVER_EMBEDDINGS_MODEL: "Qwen/Qwen3-Embedding-0.6B",
      CONTEXTWEAVER_EMBEDDINGS_DIMENSIONS: "1536",
      CONTEXTWEAVER_RERANK_API_KEY: "env-rerank-key",
      CONTEXTWEAVER_RERANK_BASE_URL: "https://env-rerank.example.com/v1",
      CONTEXTWEAVER_RERANK_MODEL: "Qwen/Qwen3-Reranker-8B",
      GROBOT_RETRIEVAL_API_KEY: "env-grobot-key",
      GROBOT_RETRIEVAL_BASE_URL: "https://env-grobot.example.com/v1",
      GROBOT_EMBEDDING_API_KEY: "env-grobot-embedding-key",
      GROBOT_EMBEDDING_BASE_URL: "https://env-grobot-embedding.example.com/v1",
      GROBOT_EMBEDDING_MODEL: "env-grobot-embedding-model",
      GROBOT_EMBEDDING_DIMENSIONS: "1024",
      GROBOT_RERANK_API_KEY: "env-grobot-rerank-key",
      GROBOT_RERANK_BASE_URL: "https://env-grobot-rerank.example.com/v1",
      GROBOT_RERANK_MODEL: "env-grobot-rerank-model",
    },
  });
  assert.notEqual(historyResolveConfigEnvOnlyResult.code, 0);
  assert.match(historyResolveConfigEnvOnlyResult.stderr, /missing \[retrieval\] in project_toml/);
  logStep("history-compaction-contract resolve-config-env-only-fails");

  const historyResolveConfigLegacyKeyResult = runCommand("node", [
    historyCompactionContractPath,
    "resolve-config",
    "--payload",
    JSON.stringify({
      project_toml: {
        context_retrieval: {},
        retrieval: {
          enabled: true,
          base_url: "https://api.siliconflow.cn/v1",
          api_key: "retrieval-key",
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
      ...historyResolveConfigEnvBaseline,
    },
  });
  assert.notEqual(historyResolveConfigLegacyKeyResult.code, 0);
  assert.match(historyResolveConfigLegacyKeyResult.stderr, /legacy \[context_retrieval\] is not supported/);
  logStep("history-compaction-contract resolve-config-legacy-key-fails");

  const historyResolveConfigDisabledResult = runCommand("node", [
    historyCompactionContractPath,
    "resolve-config",
    "--payload",
    JSON.stringify({
      project_toml: {
        retrieval: {
          enabled: false,
          base_url: "https://api.siliconflow.cn/v1",
          api_key: "retrieval-key",
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
      ...historyResolveConfigEnvBaseline,
    },
  });
  assert.notEqual(historyResolveConfigDisabledResult.code, 0);
  assert.match(historyResolveConfigDisabledResult.stderr, /\[retrieval\]\.enabled=false is not supported/);
  logStep("history-compaction-contract resolve-config-disabled-fails");

  const contextEngineTomlDir = makeTempDir("context-engine-contract");
  const contextEngineTomlPath = resolve(contextEngineTomlDir, "project.toml");
  writeFileSync(contextEngineTomlPath, [
    "[context_engine]",
    "enabled = true",
    "profile = \"aggressive\"",
    "context_window_tokens = 64000",
    "reserved_output_tokens = 9000",
    "safety_margin_tokens = 1800",
    "auto_compact_token_limit = 50000",
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
    "prompt_quality_low_quality_threshold = 0.58",
    "prompt_quality_degrade_overall_threshold = 0.61",
    "prompt_quality_degrade_low_quality_rate_threshold = 0.35",
    "prompt_quality_degrade_min_entries = 6",
    "prompt_quality_guard_enabled = true",
    "prompt_quality_guard_adaptive_enabled = false",
    "prompt_quality_guard_adaptive_mode_allowlist = [\"harden\"]",
    "prompt_quality_guard_promote_streak = 2",
    "prompt_quality_guard_severe_promote_streak = 3",
    "prompt_quality_guard_release_streak = 4",
    "prompt_quality_guard_hold_turns = 3",
    "prompt_quality_guard_max_floor_stage = \"forced\"",
    "prompt_quality_guard_severe_overall_threshold = 0.42",
    "prompt_quality_guard_severe_low_quality_rate_threshold = 0.77",
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
  assert.equal(contextEngineResolveConfigPayload.auto_compact_token_limit, 50000);
  assert.equal(contextEngineResolveConfigPayload.target_token_limit, 50000);
  assert.equal(contextEngineResolveConfigPayload.effective_window_tokens, 53200);
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
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.lowQualityThreshold, 0.58);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.degradeOverallThreshold, 0.61);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.degradeLowQualityRateThreshold, 0.35);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.degradeMinEntries, 6);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.guardEnabled, true);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.guardAdaptiveEnabled, false);
  assert.deepEqual(contextEngineResolveConfigPayload.prompt_quality?.guardAdaptiveModeAllowlist, ["harden"]);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.guardPromoteStreak, 2);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.guardSeverePromoteStreak, 3);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.guardReleaseStreak, 4);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.guardHoldTurns, 3);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.guardMaxFloorStage, "forced");
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.guardSevereOverallThreshold, 0.42);
  assert.equal(contextEngineResolveConfigPayload.prompt_quality?.guardSevereLowQualityRateThreshold, 0.77);
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
  assert.equal(
    Number(contextEnginePreparePromptPayload.auto_compact_token_limit) > 0,
    true,
  );
  assert.equal(
    Number(contextEnginePreparePromptPayload.target_token_limit) > 0,
    true,
  );
  assert.equal(
    typeof contextEnginePreparePromptPayload.auto_limit_triggered === "boolean",
    true,
  );
  logStep("context-engine-contract prepare-prompt");

  const contextEngineAutoLimitGuardHistory = Array.from({ length: 8 }).map((_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `auto-limit-guard-${String(index)} ${"context details ".repeat(36)}`,
  }));
  const contextEngineAutoLimitGuardResult = runTsContract("context-engine-contract.ts", "prepare-prompt", [
    "--payload",
    JSON.stringify({
      user_text: "继续处理上下文压缩并保留关键回滚线索",
      history_turns: 6,
      history: contextEngineAutoLimitGuardHistory,
      config: {
        enabled: true,
        profile: "balanced",
        contextWindowTokens: 6400,
        reservedOutputTokens: 500,
        safetyMarginTokens: 200,
        autoCompactTokenLimit: 450,
        thresholds: {
          proactiveRatio: 0.92,
          forcedRatio: 0.96,
          hardRatio: 0.98,
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
  const contextEngineAutoLimitGuardPayload = parseJsonOutput(
    "context-engine-contract prepare-prompt auto-limit-guard",
    contextEngineAutoLimitGuardResult.stdout,
  );
  assert.equal(contextEngineAutoLimitGuardPayload.threshold_stage, "proactive");
  assert.equal(contextEngineAutoLimitGuardPayload.auto_limit_triggered, true);
  logStep("context-engine-contract prepare-prompt auto-limit-guard");

  const contextEngineDownshiftGuardResult = runTsContract("context-engine-contract.ts", "downshift-guard", [
    "--payload",
    JSON.stringify({
      allow_proactive_compaction: true,
      previous_target_token_limit: 6000,
      current_target_token_limit: 4200,
      total_estimated_tokens: 5600,
      selected_stage: "normal",
    }),
  ]);
  const contextEngineDownshiftGuardPayload = parseJsonOutput(
    "context-engine-contract downshift-guard",
    contextEngineDownshiftGuardResult.stdout,
  );
  assert.equal(contextEngineDownshiftGuardPayload.triggered, true);
  assert.equal(contextEngineDownshiftGuardPayload.promoted_stage, "proactive");
  logStep("context-engine-contract downshift-guard");

  const contextEngineTrimRecentTurnsPrompt = [
    "[Conversation Context]",
    "[Compact Context Snapshot v2]",
    "[Architecture decisions]",
    "- keep retry guard strict and observable",
    "[Recent Turns]",
    "user: " + "请继续细化上下文压缩策略并解释回滚方案。".repeat(8),
    "assistant: " + "已补充自动压缩阈值与预算守卫。".repeat(8),
    "user: " + "再细化一下结构化压缩，不要只做头部截断。".repeat(8),
    "assistant: " + "可以先裁剪 Recent Turns，再做 head trim。".repeat(8),
    "",
    "[Current User Message]",
    "继续打磨上下文工程，质量优先。",
  ].join("\n");
  const contextEngineTrimRecentTurnsResult = runTsContract("context-engine-contract.ts", "trim-recent-turns", [
    "--payload",
    JSON.stringify({
      prompt: contextEngineTrimRecentTurnsPrompt,
      target_token_limit: 90,
      min_recent_rows: 1,
    }),
  ]);
  const contextEngineTrimRecentTurnsPayload = parseJsonOutput(
    "context-engine-contract trim-recent-turns",
    contextEngineTrimRecentTurnsResult.stdout,
  );
  assert.equal(contextEngineTrimRecentTurnsPayload.has_recent_turns_section, true);
  assert.equal(contextEngineTrimRecentTurnsPayload.changed, true);
  assert.equal(Number(contextEngineTrimRecentTurnsPayload.removed_recent_rows) >= 1, true);
  assert.equal(
    Number(contextEngineTrimRecentTurnsPayload.trimmed_estimated_tokens)
      < Number(contextEngineTrimRecentTurnsPayload.original_estimated_tokens),
    true,
  );
  logStep("context-engine-contract trim-recent-turns");

  const contextEngineTrimSnapshotSectionsPrompt = [
    "[Conversation Context]",
    "[Compact Context Snapshot v2]",
    "[Architecture decisions]",
    "- payment logging should keep request trace id and retry attempt",
    "[Dependency graph hints]",
    "- web/payment.ts -> api/payments.ts -> service/payment-core.ts -> db/order_log",
    "[Symbol graph hints]",
    "- fn trackPaymentTrace @ service/payment-core.ts:42 refs=3",
    "[Live workspace changes]",
    "- M service/payment-core.ts; M api/payments.ts; A docs/payment-observability.md",
    "[Commit lineage hints]",
    "- a1b2c3d4 refined payment retry envelope and audit fields",
    "[Modified files and key changes]",
    "- service/payment-core.ts added trace_id and retry_count propagation",
    "[Current verification status]",
    "- PASS: npm run check:gateway:ts",
    "[Open TODOs and rollback notes]",
    "- TODO: verify legacy webhook branch fallback",
    "[Tool outputs (pass/fail only)]",
    "- FAIL: payment webhook e2e timeout on staging",
    "[Recent Turns]",
    "user: 请继续强化上下文压缩，优先保留架构和变更链路。",
    "",
    "[Current User Message]",
    "继续打磨压缩策略。",
  ].join("\n");
  const contextEngineTrimSnapshotSectionsResult = runTsContract("context-engine-contract.ts", "trim-snapshot-sections", [
    "--payload",
    JSON.stringify({
      prompt: contextEngineTrimSnapshotSectionsPrompt,
      target_token_limit: 130,
    }),
  ]);
  const contextEngineTrimSnapshotSectionsPayload = parseJsonOutput(
    "context-engine-contract trim-snapshot-sections",
    contextEngineTrimSnapshotSectionsResult.stdout,
  );
  assert.equal(contextEngineTrimSnapshotSectionsPayload.has_snapshot, true);
  assert.equal(contextEngineTrimSnapshotSectionsPayload.changed, true);
  assert.equal(Number(contextEngineTrimSnapshotSectionsPayload.removed_sections_count) >= 1, true);
  assert.equal(
    Number(contextEngineTrimSnapshotSectionsPayload.trimmed_estimated_tokens)
      < Number(contextEngineTrimSnapshotSectionsPayload.original_estimated_tokens),
    true,
  );
  logStep("context-engine-contract trim-snapshot-sections");

  const contextEngineSemanticCompressSnapshotPrompt = [
    "[Conversation Context]",
    "[Compact Context Snapshot v2]",
    "[Architecture decisions]",
    "- keep architecture and changed-files evidence stable first",
    "[Dependency graph hints]",
    "- web/payment.ts -> api/payments.ts -> service/payment-core.ts -> db/order_log -> webhook/notify.ts",
    "- web/refund.ts -> api/refunds.ts -> service/payment-core.ts -> db/refund_log -> webhook/notify.ts",
    "[Symbol graph hints]",
    "- fn trackPaymentTrace(request, envelope, retryAttempt) @ service/payment-core.ts:42 refs=7",
    "- fn emitPaymentAuditTrail(payload, traceId, retryCount) @ service/payment-core.ts:96 refs=5",
    "[Live workspace changes]",
    "- M service/payment-core.ts; M api/payments.ts; M api/refunds.ts; A docs/payment-observability.md",
    "- M gateway/src/tools/context/compress/prompt-compaction.ts; M run-start-turn.ts",
    "[Commit lineage hints]",
    "- a1b2c3d4 refined payment retry envelope and audit fields for webhook retries and observability",
    "- d4e5f6a7 moved webhook retry branch to shared payment-core with unified trace propagation",
    "[Modified files and key changes]",
    "- service/payment-core.ts added trace_id and retry_count propagation",
    "[Current verification status]",
    "- PASS: npm run check:gateway:ts",
    "- FAIL: payment webhook e2e timeout on staging retry branch",
    "[Open TODOs and rollback notes]",
    "- TODO: verify legacy webhook branch fallback after retry envelope migration",
    "- TODO: add contract test for semantic snapshot compression",
    "[Tool outputs (pass/fail only)]",
    "- FAIL: payment webhook e2e timeout on staging with retry_count=5 and trace_id propagation mismatch",
    "- PASS: unit contract for prompt pre-send budget guard",
    "[Recent Turns]",
    "user: 请继续强化上下文压缩，优先保留架构和变更链路。",
    "",
    "[Current User Message]",
    "继续打磨压缩策略。",
  ].join("\n");
  const contextEngineSemanticCompressSnapshotResult = runTsContract(
    "context-engine-contract.ts",
    "semantic-compress-snapshot-sections",
    [
      "--payload",
      JSON.stringify({
        prompt: contextEngineSemanticCompressSnapshotPrompt,
        target_token_limit: 110,
      }),
    ],
  );
  const contextEngineSemanticCompressSnapshotPayload = parseJsonOutput(
    "context-engine-contract semantic-compress-snapshot-sections",
    contextEngineSemanticCompressSnapshotResult.stdout,
  );
  assert.equal(contextEngineSemanticCompressSnapshotPayload.has_snapshot, true);
  assert.equal(contextEngineSemanticCompressSnapshotPayload.changed, true);
  assert.equal(Number(contextEngineSemanticCompressSnapshotPayload.compressed_sections_count) >= 1, true);
  assert.equal(typeof contextEngineSemanticCompressSnapshotPayload.generative_used, "boolean");
  assert.equal(
    Array.isArray(contextEngineSemanticCompressSnapshotPayload.generative_sections),
    true,
  );
  assert.equal(
    typeof contextEngineSemanticCompressSnapshotPayload.generative_sections_count,
    "number",
  );
  assert.equal(Array.isArray(contextEngineSemanticCompressSnapshotPayload.warnings), true);
  logStep("context-engine-contract semantic-compress-snapshot-sections");

  const contextEnginePromptQualityWorkDir = makeTempDir("context-engine-prompt-quality");
  const contextEnginePromptQualityResult = runTsContract("context-engine-contract.ts", "prompt-quality-window", [
    "--payload",
    JSON.stringify({
      work_dir: contextEnginePromptQualityWorkDir,
      session_key: "contract:prompt-quality",
      size: 12,
      low_quality_threshold: 0.6,
      threshold_overall: 0.8,
      threshold_low_quality_rate: 0.2,
      min_entries: 2,
      samples: [
        {
          stage: "proactive",
          prompt: [
            "[Conversation Context]",
            "[Compact Context Snapshot v2]",
            "[Architecture decisions]",
            "- keep deterministic prompt budget routing",
            "[Modified files and key changes]",
            "- gateway/src/tools/context/compress/prompt-compaction.ts",
            "[Current verification status]",
            "- PASS: npm run check:gateway:ts",
            "[Open TODOs and rollback notes]",
            "- TODO: add dedicated prompt quality contract gate",
            "[Recent Turns]",
            "user: 请继续优化上下文压缩策略",
            "assistant: 已补齐 pre-send trim 和状态观测",
            "[Current User Message]",
            "继续打磨。",
          ].join("\\n"),
          target_token_limit: 500,
          pre_send_strategy: "quality_first",
          pre_send_overflow_ratio: 0.04,
          pre_send_pressure_score: 0.26,
        },
        {
          stage: "minimal",
          prompt: [
            "[Conversation Context]",
            "[Compact Context Snapshot v2]",
            "[Architecture decisions]",
            "- minimal fallback only",
            "[Current User Message]",
            "继续。",
          ].join("\\n"),
          target_token_limit: 40,
          pre_send_strategy: "hard_budget",
          pre_send_overflow_ratio: 0.32,
          pre_send_pressure_score: 0.78,
        },
      ],
    }),
  ]);
  const contextEnginePromptQualityPayload = parseJsonOutput(
    "context-engine-contract prompt-quality-window",
    contextEnginePromptQualityResult.stdout,
  );
  assert.equal(Number(contextEnginePromptQualityPayload.wrote_entries), 2);
  assert.equal(Number(contextEnginePromptQualityPayload.summary?.entries) >= 2, true);
  assert.equal(typeof contextEnginePromptQualityPayload.summary?.average_scores?.overall, "number");
  assert.equal(typeof contextEnginePromptQualityPayload.summary?.low_quality?.rate, "number");
  assert.equal(typeof contextEnginePromptQualityPayload.summary?.stage_counts?.proactive, "number");
  assert.equal(typeof contextEnginePromptQualityPayload.summary?.signal_averages?.recent_trim_rows, "number");
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.signal_averages?.snapshot_semantic_compress_sections,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.compression_activity?.snapshot_semantic_compress_rate,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.signal_averages?.pre_send_overflow_ratio,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.signal_averages?.pre_send_pressure_score,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.strategy_activity?.hard_budget_rate,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.strategy_activity?.quality_first_rate,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.token_budget?.average_utilization_ratio,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.strategy_trends?.short?.window_size,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.strategy_trends?.medium?.window_size,
    "number",
  );
  const promptQualityStrategyTrendDeltaHardBudget =
    contextEnginePromptQualityPayload.summary?.strategy_trends?.delta?.hard_budget_rate;
  assert.equal(
    typeof promptQualityStrategyTrendDeltaHardBudget === "number"
      || promptQualityStrategyTrendDeltaHardBudget === null,
    true,
  );
  const promptQualityStrategyOutcomeHardBudgetFollowupDelta =
    contextEnginePromptQualityPayload.summary?.strategy_outcomes?.hard_budget_followup_overall_delta;
  assert.equal(
    typeof promptQualityStrategyOutcomeHardBudgetFollowupDelta === "number"
      || promptQualityStrategyOutcomeHardBudgetFollowupDelta === null,
    true,
  );
  const promptQualityStrategyOutcomeQualityFirstFollowupDelta =
    contextEnginePromptQualityPayload.summary?.strategy_outcomes?.quality_first_followup_overall_delta;
  assert.equal(
    typeof promptQualityStrategyOutcomeQualityFirstFollowupDelta === "number"
      || promptQualityStrategyOutcomeQualityFirstFollowupDelta === null,
    true,
  );
  const promptQualityStrategyOutcomeHardBudgetRecoveryRate =
    contextEnginePromptQualityPayload.summary?.strategy_outcomes?.hard_budget_recovery_rate;
  assert.equal(
    typeof promptQualityStrategyOutcomeHardBudgetRecoveryRate === "number"
      || promptQualityStrategyOutcomeHardBudgetRecoveryRate === null,
    true,
  );
  const promptQualityStrategyOutcomeQualityFirstImprovedRate =
    contextEnginePromptQualityPayload.summary?.strategy_outcomes?.quality_first_improved_rate;
  assert.equal(
    typeof promptQualityStrategyOutcomeQualityFirstImprovedRate === "number"
      || promptQualityStrategyOutcomeQualityFirstImprovedRate === null,
    true,
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.strategy_outcomes?.hard_budget_transition_count,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.strategy_outcomes?.quality_first_transition_count,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.pressure_trends?.short?.window_size,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.pressure_trends?.medium?.window_size,
    "number",
  );
  const promptQualityPressureTrendDeltaUtilization =
    contextEnginePromptQualityPayload.summary?.pressure_trends?.delta?.average_utilization_ratio;
  assert.equal(
    typeof promptQualityPressureTrendDeltaUtilization === "number"
      || promptQualityPressureTrendDeltaUtilization === null,
    true,
  );
  assert.equal(typeof contextEnginePromptQualityPayload.degradation?.degraded, "boolean");
  assert.equal(contextEnginePromptQualityPayload.degradation?.degraded, true);
  assert.equal(
    ["overall_below_threshold", "low_quality_rate_above_threshold"].includes(
      String(contextEnginePromptQualityPayload.degradation?.reason),
    ),
    true,
  );
  logStep("context-engine-contract prompt-quality-window");

  const contextEnginePromptQualityGuardResult = runTsContract("context-engine-contract.ts", "prompt-quality-guard", [
    "--payload",
    JSON.stringify({
      selected_stage: "normal",
      policy: {
        enabled: true,
        promote_streak: 1,
        severe_promote_streak: 2,
        release_streak: 2,
        hold_turns: 1,
        max_floor_stage: "minimal",
        severe_overall_threshold: 0.45,
        severe_low_quality_rate_threshold: 0.7,
      },
      observations: [
        {
          degraded: true,
          reason: "overall_below_threshold",
          observed_overall: 0.7,
          observed_low_quality_rate: 0.2,
        },
        {
          degraded: true,
          reason: "overall_below_threshold",
          observed_overall: 0.32,
          observed_low_quality_rate: 0.6,
        },
        {
          degraded: true,
          reason: "low_quality_rate_above_threshold",
          observed_overall: 0.3,
          observed_low_quality_rate: 0.85,
        },
        {
          degraded: false,
          reason: "healthy",
          observed_overall: 0.82,
          observed_low_quality_rate: 0.1,
        },
        {
          degraded: false,
          reason: "healthy",
          observed_overall: 0.88,
          observed_low_quality_rate: 0.08,
        },
      ],
    }),
  ]);
  const contextEnginePromptQualityGuardPayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard",
    contextEnginePromptQualityGuardResult.stdout,
  );
  assert.equal(Array.isArray(contextEnginePromptQualityGuardPayload.timeline), true);
  assert.equal(contextEnginePromptQualityGuardPayload.timeline.length >= 5, true);
  assert.equal(contextEnginePromptQualityGuardPayload.timeline[0]?.floor_stage, "proactive");
  assert.equal(contextEnginePromptQualityGuardPayload.timeline[1]?.floor_stage, "forced");
  assert.equal(contextEnginePromptQualityGuardPayload.timeline[2]?.floor_stage, "minimal");
  assert.equal(contextEnginePromptQualityGuardPayload.timeline[2]?.severe_escalated, true);
  assert.equal(contextEnginePromptQualityGuardPayload.timeline[4]?.released, true);
  assert.equal(contextEnginePromptQualityGuardPayload.timeline[4]?.floor_stage, "forced");
  logStep("context-engine-contract prompt-quality-guard");

  const contextEnginePromptQualityGuardRuntimeResult = runTsContract(
    "context-engine-contract.ts",
    "prompt-quality-guard-runtime",
    [
      "--payload",
      JSON.stringify({
        policy: {
          enabled: true,
          promote_streak: 2,
          severe_promote_streak: 2,
          release_streak: 3,
          hold_turns: 2,
          max_floor_stage: "minimal",
          severe_overall_threshold: 0.45,
          severe_low_quality_rate_threshold: 0.7,
        },
        state: {
          floorStage: "forced",
          degradedStreak: 2,
          severeStreak: 2,
          healthyStreak: 0,
          holdTurnsRemaining: 2,
          lastReason: "low_quality_rate_above_threshold",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
        degraded: true,
        reason: "low_quality_rate_above_threshold",
        observed_overall: 0.31,
        observed_low_quality_rate: 0.86,
      }),
    ],
  );
  const contextEnginePromptQualityGuardRuntimePayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard-runtime",
    contextEnginePromptQualityGuardRuntimeResult.stdout,
  );
  assert.equal(contextEnginePromptQualityGuardRuntimePayload.assessment?.enabled, true);
  assert.equal(contextEnginePromptQualityGuardRuntimePayload.assessment?.phase, "escalating");
  assert.equal(contextEnginePromptQualityGuardRuntimePayload.assessment?.transition, "promote");
  assert.equal(contextEnginePromptQualityGuardRuntimePayload.assessment?.severe, true);
  assert.equal(contextEnginePromptQualityGuardRuntimePayload.assessment?.floor_stage, "forced");
  assert.equal(contextEnginePromptQualityGuardRuntimePayload.assessment?.proposed_floor_stage, "minimal");
  assert.equal(contextEnginePromptQualityGuardRuntimePayload.assessment?.promote_remaining, 0);
  assert.equal(contextEnginePromptQualityGuardRuntimePayload.assessment?.severe_promote_remaining, 0);
  assert.equal(contextEnginePromptQualityGuardRuntimePayload.assessment?.release_remaining, 3);
  logStep("context-engine-contract prompt-quality-guard-runtime");

  const contextEnginePromptQualityGuardAdaptivePolicyResult = runTsContract(
    "context-engine-contract.ts",
    "prompt-quality-guard-adaptive-policy",
    [
      "--payload",
      JSON.stringify({
        policy: {
          enabled: true,
          promote_streak: 2,
          severe_promote_streak: 2,
          release_streak: 3,
          hold_turns: 2,
          max_floor_stage: "minimal",
          adaptive_mode_allowlist: ["relax"],
        },
        adaptive_enabled: true,
        state: {
          floorStage: "forced",
          degradedStreak: 2,
          severeStreak: 2,
          healthyStreak: 0,
          holdTurnsRemaining: 2,
          lastReason: "low_quality_rate_above_threshold",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
        degraded: true,
        reason: "low_quality_rate_above_threshold",
        low_quality_rate: 0.9,
        average_overall: 0.34,
        observed_overall: 0.3,
        observed_low_quality_rate: 0.9,
      }),
    ],
  );
  const contextEnginePromptQualityGuardAdaptivePolicyPayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard-adaptive-policy",
    contextEnginePromptQualityGuardAdaptivePolicyResult.stdout,
  );
  assert.equal(contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.enabled, true);
  assert.equal(contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.mode, "stable");
  assert.equal(contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.mode_blocked, true);
  assert.equal(contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.blocked_mode, "harden");
  assert.deepEqual(contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.allowlist, ["relax"]);
  assert.equal(
    contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.adjustment?.promote_streak_delta,
    0,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.adjustment?.release_streak_delta,
    0,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.effective_policy?.promote_streak,
    2,
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.outcome_drift_guard
      ?.high_evidence_harden_bias,
    "boolean",
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.outcome_drift_guard
      ?.recommendation,
    "string",
  );
  assert.equal(
    Array.isArray(
      contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.outcome_drift_guard
        ?.recent_auto_action_levels,
    ),
    true,
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.outcome_drift_guard
      ?.window_summary?.entries,
    "number",
  );
  assert.equal(
    ["green", "yellow", "red"].includes(
      String(
        contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.outcome_drift_guard
          ?.window_summary?.alert_level,
      ),
    ),
    true,
  );
  logStep("context-engine-contract prompt-quality-guard-adaptive-policy");

  const contextEnginePromptQualityGuardAdaptiveCompressionPressureResult = runTsContract(
    "context-engine-contract.ts",
    "prompt-quality-guard-adaptive-policy",
    [
      "--payload",
      JSON.stringify({
        policy: {
          enabled: true,
          promote_streak: 2,
          severe_promote_streak: 2,
          release_streak: 3,
          hold_turns: 2,
          max_floor_stage: "minimal",
          adaptive_mode_allowlist: ["harden", "relax"],
        },
        adaptive_enabled: true,
        state: {
          floorStage: "normal",
          degradedStreak: 0,
          severeStreak: 0,
          healthyStreak: 0,
          holdTurnsRemaining: 0,
          lastReason: "healthy",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
        degraded: false,
        reason: "healthy",
        low_quality_rate: 0.2,
        average_overall: 0.8,
        observed_overall: 0.8,
        observed_low_quality_rate: 0.2,
        snapshot_semantic_compress_rate: 0.42,
        auto_limit_triggered_rate: 0.35,
        average_utilization_ratio: 0.92,
        short_snapshot_semantic_compress_rate: 0.58,
        medium_snapshot_semantic_compress_rate: 0.34,
        short_auto_limit_triggered_rate: 0.46,
        medium_auto_limit_triggered_rate: 0.29,
        short_average_utilization_ratio: 0.95,
        medium_average_utilization_ratio: 0.85,
      }),
    ],
  );
  const contextEnginePromptQualityGuardAdaptiveCompressionPressurePayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard-adaptive-policy compression-pressure",
    contextEnginePromptQualityGuardAdaptiveCompressionPressureResult.stdout,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveCompressionPressurePayload.decision?.mode,
    "harden",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveCompressionPressurePayload.decision?.reason,
    "compression_window_pressure",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveCompressionPressurePayload.decision?.mode_blocked,
    false,
  );
  const compressionPressureLearnAlpha = Number(
    contextEnginePromptQualityGuardAdaptiveCompressionPressurePayload.decision?.pressure_policy?.learn_alpha,
  );
  assert.equal(Number.isFinite(compressionPressureLearnAlpha), true);
  assert.equal(compressionPressureLearnAlpha >= 0.18, true);
  assert.equal(compressionPressureLearnAlpha <= 0.68, true);
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveCompressionPressurePayload.decision?.pressure_policy?.trend_momentum,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveCompressionPressurePayload.decision?.pressure_policy?.trend_flip_suppressed,
    "boolean",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveCompressionPressurePayload.decision?.effective_policy?.promote_streak,
    1,
  );
  logStep("context-engine-contract prompt-quality-guard-adaptive-policy compression-pressure");

  const contextEnginePromptQualityGuardAdaptiveStrategyPressureResult = runTsContract(
    "context-engine-contract.ts",
    "prompt-quality-guard-adaptive-policy",
    [
      "--payload",
      JSON.stringify({
        policy: {
          enabled: true,
          promote_streak: 2,
          severe_promote_streak: 2,
          release_streak: 3,
          hold_turns: 2,
          max_floor_stage: "minimal",
          adaptive_mode_allowlist: ["harden", "relax"],
        },
        adaptive_enabled: true,
        state: {
          floorStage: "normal",
          degradedStreak: 0,
          severeStreak: 0,
          healthyStreak: 0,
          holdTurnsRemaining: 0,
          lastReason: "healthy",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
        degraded: false,
        reason: "healthy",
        low_quality_rate: 0.16,
        average_overall: 0.88,
        observed_overall: 0.88,
        observed_low_quality_rate: 0.16,
        snapshot_semantic_compress_rate: 0.21,
        auto_limit_triggered_rate: 0.18,
        average_utilization_ratio: 0.74,
        short_snapshot_semantic_compress_rate: 0.22,
        medium_snapshot_semantic_compress_rate: 0.20,
        short_auto_limit_triggered_rate: 0.19,
        medium_auto_limit_triggered_rate: 0.17,
        short_average_utilization_ratio: 0.76,
        medium_average_utilization_ratio: 0.73,
        hard_budget_strategy_rate: 0.66,
        quality_first_strategy_rate: 0.26,
        average_pre_send_overflow_ratio: 0.23,
        average_pre_send_pressure_score: 0.71,
        short_hard_budget_strategy_rate: 0.78,
        medium_hard_budget_strategy_rate: 0.52,
        short_average_pre_send_overflow_ratio: 0.29,
        medium_average_pre_send_overflow_ratio: 0.18,
        short_average_pre_send_pressure_score: 0.81,
        medium_average_pre_send_pressure_score: 0.63,
      }),
    ],
  );
  const contextEnginePromptQualityGuardAdaptiveStrategyPressurePayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard-adaptive-policy strategy-pressure",
    contextEnginePromptQualityGuardAdaptiveStrategyPressureResult.stdout,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyPressurePayload.decision?.mode,
    "harden",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyPressurePayload.decision?.reason,
    "strategy_window_pressure",
  );
  logStep("context-engine-contract prompt-quality-guard-adaptive-policy strategy-pressure");

  const contextEnginePromptQualityGuardAdaptiveStrategyEffectiveResult = runTsContract(
    "context-engine-contract.ts",
    "prompt-quality-guard-adaptive-policy",
    [
      "--payload",
      JSON.stringify({
        policy: {
          enabled: true,
          promote_streak: 2,
          severe_promote_streak: 2,
          release_streak: 3,
          hold_turns: 2,
          max_floor_stage: "minimal",
          adaptive_mode_allowlist: ["harden", "relax"],
        },
        adaptive_enabled: true,
        state: {
          floorStage: "normal",
          degradedStreak: 0,
          severeStreak: 0,
          healthyStreak: 0,
          holdTurnsRemaining: 0,
          lastReason: "healthy",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
        degraded: false,
        reason: "healthy",
        low_quality_rate: 0.22,
        average_overall: 0.82,
        observed_overall: 0.82,
        observed_low_quality_rate: 0.22,
        snapshot_semantic_compress_rate: 0.18,
        auto_limit_triggered_rate: 0.15,
        average_utilization_ratio: 0.74,
        hard_budget_strategy_rate: 0.72,
        quality_first_strategy_rate: 0.24,
        average_pre_send_overflow_ratio: 0.24,
        average_pre_send_pressure_score: 0.74,
        short_hard_budget_strategy_rate: 0.81,
        medium_hard_budget_strategy_rate: 0.58,
        short_average_pre_send_overflow_ratio: 0.28,
        medium_average_pre_send_overflow_ratio: 0.19,
        short_average_pre_send_pressure_score: 0.83,
        medium_average_pre_send_pressure_score: 0.67,
        hard_budget_followup_overall_delta: 0.07,
        quality_first_followup_overall_delta: 0.02,
        hard_budget_recovery_rate: 0.78,
        quality_first_improved_rate: 0.64,
        hard_budget_transition_count: 6,
        quality_first_transition_count: 5,
      }),
    ],
  );
  const contextEnginePromptQualityGuardAdaptiveStrategyEffectivePayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard-adaptive-policy strategy-effective",
    contextEnginePromptQualityGuardAdaptiveStrategyEffectiveResult.stdout,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyEffectivePayload.decision?.mode,
    "stable",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyEffectivePayload.decision?.reason,
    "window_stable",
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveStrategyEffectivePayload.decision?.outcome_reliability
      ?.required_transitions,
    "number",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyEffectivePayload.decision?.outcome_reliability
      ?.required_transitions,
    6,
  );
  const strategyEffectiveNextRequiredTransitions = Number(
    contextEnginePromptQualityGuardAdaptiveStrategyEffectivePayload.decision?.outcome_reliability
      ?.next_required_transitions,
  );
  assert.equal(Number.isFinite(strategyEffectiveNextRequiredTransitions), true);
  assert.equal(
    strategyEffectiveNextRequiredTransitions <= 3,
    true,
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveStrategyEffectivePayload.decision?.outcome_reliability
      ?.combined_evidence_score,
    "number",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyEffectivePayload.decision?.outcome_reliability
      ?.hard_budget_reliable,
    true,
  );
  logStep("context-engine-contract prompt-quality-guard-adaptive-policy strategy-effective");

  const contextEnginePromptQualityGuardAdaptiveStrategyLowEvidenceResult = runTsContract(
    "context-engine-contract.ts",
    "prompt-quality-guard-adaptive-policy",
    [
      "--payload",
      JSON.stringify({
        policy: {
          enabled: true,
          promote_streak: 2,
          severe_promote_streak: 2,
          release_streak: 3,
          hold_turns: 2,
          max_floor_stage: "minimal",
          adaptive_mode_allowlist: ["harden", "relax"],
        },
        adaptive_enabled: true,
        state: {
          floorStage: "normal",
          degradedStreak: 0,
          severeStreak: 0,
          healthyStreak: 0,
          holdTurnsRemaining: 0,
          lastReason: "healthy",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
        degraded: false,
        reason: "healthy",
        low_quality_rate: 0.22,
        average_overall: 0.82,
        observed_overall: 0.82,
        observed_low_quality_rate: 0.22,
        snapshot_semantic_compress_rate: 0.18,
        auto_limit_triggered_rate: 0.15,
        average_utilization_ratio: 0.74,
        hard_budget_strategy_rate: 0.72,
        quality_first_strategy_rate: 0.24,
        average_pre_send_overflow_ratio: 0.24,
        average_pre_send_pressure_score: 0.74,
        short_hard_budget_strategy_rate: 0.81,
        medium_hard_budget_strategy_rate: 0.58,
        short_average_pre_send_overflow_ratio: 0.28,
        medium_average_pre_send_overflow_ratio: 0.19,
        short_average_pre_send_pressure_score: 0.83,
        medium_average_pre_send_pressure_score: 0.67,
        hard_budget_followup_overall_delta: 0.09,
        quality_first_followup_overall_delta: 0.03,
        hard_budget_recovery_rate: 0.82,
        quality_first_improved_rate: 0.68,
        hard_budget_transition_count: 1,
        quality_first_transition_count: 1,
      }),
    ],
  );
  const contextEnginePromptQualityGuardAdaptiveStrategyLowEvidencePayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard-adaptive-policy strategy-low-evidence",
    contextEnginePromptQualityGuardAdaptiveStrategyLowEvidenceResult.stdout,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyLowEvidencePayload.decision?.mode,
    "harden",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyLowEvidencePayload.decision?.reason,
    "strategy_window_pressure",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyLowEvidencePayload.decision?.outcome_reliability
      ?.hard_budget_reliable,
    false,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyLowEvidencePayload.decision?.outcome_reliability
      ?.required_transitions,
    6,
  );
  const strategyLowEvidenceNextRequiredTransitions = Number(
    contextEnginePromptQualityGuardAdaptiveStrategyLowEvidencePayload.decision?.outcome_reliability
      ?.next_required_transitions,
  );
  assert.equal(Number.isFinite(strategyLowEvidenceNextRequiredTransitions), true);
  assert.equal(
    strategyLowEvidenceNextRequiredTransitions >= strategyEffectiveNextRequiredTransitions,
    true,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyLowEvidencePayload.decision?.outcome_reliability
      ?.quality_first_reliable,
    false,
  );
  logStep("context-engine-contract prompt-quality-guard-adaptive-policy strategy-low-evidence");

  const contextEnginePromptQualityGuardAdaptiveTrendRisingResult = runTsContract(
    "context-engine-contract.ts",
    "prompt-quality-guard-adaptive-policy",
    [
      "--payload",
      JSON.stringify({
        policy: {
          enabled: true,
          promote_streak: 2,
          severe_promote_streak: 2,
          release_streak: 3,
          hold_turns: 2,
          max_floor_stage: "minimal",
          adaptive_mode_allowlist: ["harden", "relax"],
        },
        adaptive_enabled: true,
        state: {
          floorStage: "normal",
          degradedStreak: 0,
          severeStreak: 0,
          healthyStreak: 0,
          holdTurnsRemaining: 0,
          lastReason: "healthy",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
        degraded: false,
        reason: "healthy",
        low_quality_rate: 0.12,
        average_overall: 0.9,
        observed_overall: 0.9,
        observed_low_quality_rate: 0.12,
        snapshot_semantic_compress_rate: 0.26,
        auto_limit_triggered_rate: 0.31,
        average_utilization_ratio: 0.87,
        short_snapshot_semantic_compress_rate: 0.31,
        medium_snapshot_semantic_compress_rate: 0.21,
        short_auto_limit_triggered_rate: 0.35,
        medium_auto_limit_triggered_rate: 0.24,
        short_average_utilization_ratio: 0.90,
        medium_average_utilization_ratio: 0.82,
      }),
    ],
  );
  const contextEnginePromptQualityGuardAdaptiveTrendRisingPayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard-adaptive-policy trend-rising",
    contextEnginePromptQualityGuardAdaptiveTrendRisingResult.stdout,
  );
  const trendRisingLearnAlpha = Number(
    contextEnginePromptQualityGuardAdaptiveTrendRisingPayload.decision?.pressure_policy?.learn_alpha,
  );
  assert.equal(Number.isFinite(trendRisingLearnAlpha), true);
  assert.equal(trendRisingLearnAlpha >= 0.36, true);
  logStep("context-engine-contract prompt-quality-guard-adaptive-policy trend-rising");

  const contextEnginePromptQualityGuardAdaptiveTrendFallingResult = runTsContract(
    "context-engine-contract.ts",
    "prompt-quality-guard-adaptive-policy",
    [
      "--payload",
      JSON.stringify({
        policy: {
          enabled: true,
          promote_streak: 2,
          severe_promote_streak: 2,
          release_streak: 3,
          hold_turns: 2,
          max_floor_stage: "minimal",
          adaptive_mode_allowlist: ["harden", "relax"],
        },
        adaptive_enabled: true,
        state: {
          floorStage: "normal",
          degradedStreak: 0,
          severeStreak: 0,
          healthyStreak: 0,
          holdTurnsRemaining: 0,
          lastReason: "healthy",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
        degraded: false,
        reason: "healthy",
        low_quality_rate: 0.12,
        average_overall: 0.9,
        observed_overall: 0.9,
        observed_low_quality_rate: 0.12,
        snapshot_semantic_compress_rate: 0.26,
        auto_limit_triggered_rate: 0.31,
        average_utilization_ratio: 0.87,
        short_snapshot_semantic_compress_rate: 0.18,
        medium_snapshot_semantic_compress_rate: 0.30,
        short_auto_limit_triggered_rate: 0.17,
        medium_auto_limit_triggered_rate: 0.31,
        short_average_utilization_ratio: 0.80,
        medium_average_utilization_ratio: 0.90,
      }),
    ],
  );
  const contextEnginePromptQualityGuardAdaptiveTrendFallingPayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard-adaptive-policy trend-falling",
    contextEnginePromptQualityGuardAdaptiveTrendFallingResult.stdout,
  );
  const trendFallingLearnAlpha = Number(
    contextEnginePromptQualityGuardAdaptiveTrendFallingPayload.decision?.pressure_policy?.learn_alpha,
  );
  assert.equal(Number.isFinite(trendFallingLearnAlpha), true);
  assert.equal(trendFallingLearnAlpha <= 0.29, true);
  logStep("context-engine-contract prompt-quality-guard-adaptive-policy trend-falling");

  const adaptiveSequenceWindows = [];
  for (let index = 0; index < 40; index += 1) {
    adaptiveSequenceWindows.push({
      degraded: false,
      reason: "healthy",
      low_quality_rate: 0.12,
      average_overall: 0.9,
      observed_overall: 0.9,
      observed_low_quality_rate: 0.12,
      snapshot_semantic_compress_rate: 0.18,
      auto_limit_triggered_rate: 0.12,
      average_utilization_ratio: 0.78,
      short_snapshot_semantic_compress_rate: 0.16,
      medium_snapshot_semantic_compress_rate: 0.20,
      short_auto_limit_triggered_rate: 0.10,
      medium_auto_limit_triggered_rate: 0.14,
      short_average_utilization_ratio: 0.76,
      medium_average_utilization_ratio: 0.80,
    });
  }
  for (let index = 0; index < 40; index += 1) {
    adaptiveSequenceWindows.push({
      degraded: true,
      reason: "compression_window_pressure",
      low_quality_rate: 0.35,
      average_overall: 0.72,
      observed_overall: 0.69,
      observed_low_quality_rate: 0.35,
      snapshot_semantic_compress_rate: 0.46,
      auto_limit_triggered_rate: 0.39,
      average_utilization_ratio: 0.93,
      short_snapshot_semantic_compress_rate: 0.53,
      medium_snapshot_semantic_compress_rate: 0.40,
      short_auto_limit_triggered_rate: 0.45,
      medium_auto_limit_triggered_rate: 0.34,
      short_average_utilization_ratio: 0.96,
      medium_average_utilization_ratio: 0.89,
    });
  }
  for (let index = 0; index < 40; index += 1) {
    adaptiveSequenceWindows.push({
      degraded: false,
      reason: "window_recovered",
      low_quality_rate: 0.14,
      average_overall: 0.88,
      observed_overall: 0.86,
      observed_low_quality_rate: 0.14,
      snapshot_semantic_compress_rate: 0.22,
      auto_limit_triggered_rate: 0.18,
      average_utilization_ratio: 0.81,
      short_snapshot_semantic_compress_rate: 0.19,
      medium_snapshot_semantic_compress_rate: 0.28,
      short_auto_limit_triggered_rate: 0.16,
      medium_auto_limit_triggered_rate: 0.25,
      short_average_utilization_ratio: 0.79,
      medium_average_utilization_ratio: 0.87,
    });
  }
  const contextEnginePromptQualityGuardAdaptiveSequenceResult = runTsContract(
    "context-engine-contract.ts",
    "prompt-quality-guard-adaptive-sequence",
    [
      "--payload",
      JSON.stringify({
        selected_stage: "normal",
        policy: {
          enabled: true,
          promote_streak: 2,
          severe_promote_streak: 2,
          release_streak: 3,
          hold_turns: 2,
          max_floor_stage: "minimal",
          adaptive_mode_allowlist: ["harden", "relax"],
        },
        adaptive_enabled: true,
        windows: adaptiveSequenceWindows,
      }),
    ],
  );
  const contextEnginePromptQualityGuardAdaptiveSequencePayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard-adaptive-sequence",
    contextEnginePromptQualityGuardAdaptiveSequenceResult.stdout,
  );
  assert.equal(contextEnginePromptQualityGuardAdaptiveSequencePayload.turns, 120);
  assert.equal(
    Number.isFinite(Number(contextEnginePromptQualityGuardAdaptiveSequencePayload.mode_transitions?.count)),
    true,
  );
  assert.equal(
    Number(contextEnginePromptQualityGuardAdaptiveSequencePayload.mode_transitions?.count) <= 85,
    true,
  );
  assert.equal(
    Number(contextEnginePromptQualityGuardAdaptiveSequencePayload.pressure_alpha?.min) >= 0.18,
    true,
  );
  assert.equal(
    Number(contextEnginePromptQualityGuardAdaptiveSequencePayload.pressure_alpha?.max) <= 0.68,
    true,
  );
  assert.equal(
    Number(contextEnginePromptQualityGuardAdaptiveSequencePayload.pressure_threshold_steps?.max_utilization_step) <= 0.045,
    true,
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveSequencePayload.final_state?.pressureTrendMomentum,
    "number",
  );
  assert.equal(
    Number.isFinite(
      Number(
        contextEnginePromptQualityGuardAdaptiveSequencePayload.outcome_reliability?.required_transitions?.avg,
      ),
    ),
    true,
  );
  assert.equal(
    Number.isFinite(
      Number(
        contextEnginePromptQualityGuardAdaptiveSequencePayload.outcome_reliability?.next_required_transitions?.avg,
      ),
    ),
    true,
  );
  assert.equal(
    Number(
      contextEnginePromptQualityGuardAdaptiveSequencePayload.outcome_reliability?.next_required_transitions?.transitions,
    ) >= 1,
    true,
  );
  assert.equal(
    Number(
      contextEnginePromptQualityGuardAdaptiveSequencePayload.outcome_reliability?.combined_evidence_score?.avg,
    ) >= 0,
    true,
  );
  assert.equal(
    Number(
      contextEnginePromptQualityGuardAdaptiveSequencePayload.outcome_reliability?.combined_evidence_score?.avg,
    ) <= 1,
    true,
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveSequencePayload.final_state?.outcomeRequiredTransitions,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveSequencePayload.final_state?.outcomeCombinedEvidenceScore,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveSequencePayload.drift_guard?.high_evidence_harden_bias,
    "boolean",
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveSequencePayload.drift_guard?.high_evidence_harden_rate,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveSequencePayload.drift_guard?.recommendation,
    "string",
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveSequencePayload.drift_guard?.auto_action_level,
    "string",
  );
  assert.equal(
    Array.isArray(
      contextEnginePromptQualityGuardAdaptiveSequencePayload.drift_guard?.recent_auto_action_levels,
    ),
    true,
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveSequencePayload.drift_guard?.window_summary?.entries,
    "number",
  );
  assert.equal(
    ["green", "yellow", "red"].includes(
      String(contextEnginePromptQualityGuardAdaptiveSequencePayload.drift_guard?.window_summary?.alert_level),
    ),
    true,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveSequencePayload.drift_guard?.high_evidence_harden_bias,
    false,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveSequencePayload.drift_guard?.recommendation,
    "none",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveSequencePayload.drift_guard?.auto_action_level,
    "none",
  );
  logStep("context-engine-contract prompt-quality-guard-adaptive-sequence");

  const adaptiveSequenceHighEvidenceHardenWindows = [];
  for (let index = 0; index < 24; index += 1) {
    adaptiveSequenceHighEvidenceHardenWindows.push({
      degraded: false,
      reason: "compression_window_pressure",
      low_quality_rate: 0.16,
      average_overall: 0.86,
      observed_overall: 0.84,
      observed_low_quality_rate: 0.16,
      snapshot_semantic_compress_rate: 0.52,
      auto_limit_triggered_rate: 0.43,
      average_utilization_ratio: 0.95,
      short_snapshot_semantic_compress_rate: 0.58,
      medium_snapshot_semantic_compress_rate: 0.44,
      short_auto_limit_triggered_rate: 0.48,
      medium_auto_limit_triggered_rate: 0.37,
      short_average_utilization_ratio: 0.97,
      medium_average_utilization_ratio: 0.90,
      hard_budget_strategy_rate: 0.68,
      quality_first_strategy_rate: 0.24,
      average_pre_send_overflow_ratio: 0.22,
      average_pre_send_pressure_score: 0.69,
      short_hard_budget_strategy_rate: 0.76,
      medium_hard_budget_strategy_rate: 0.52,
      short_average_pre_send_overflow_ratio: 0.27,
      medium_average_pre_send_overflow_ratio: 0.17,
      short_average_pre_send_pressure_score: 0.77,
      medium_average_pre_send_pressure_score: 0.59,
      hard_budget_followup_overall_delta: 0.06,
      quality_first_followup_overall_delta: 0.03,
      hard_budget_recovery_rate: 0.76,
      quality_first_improved_rate: 0.64,
      hard_budget_transition_count: 8,
      quality_first_transition_count: 8,
    });
  }
  const contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardResult = runTsContract(
    "context-engine-contract.ts",
    "prompt-quality-guard-adaptive-sequence",
    [
      "--payload",
      JSON.stringify({
        selected_stage: "normal",
        policy: {
          enabled: true,
          promote_streak: 2,
          severe_promote_streak: 2,
          release_streak: 3,
          hold_turns: 2,
          max_floor_stage: "minimal",
          adaptive_mode_allowlist: ["harden", "relax"],
        },
        adaptive_enabled: true,
        windows: adaptiveSequenceHighEvidenceHardenWindows,
      }),
    ],
  );
  const contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardPayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard-adaptive-sequence drift-guard",
    contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardResult.stdout,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardPayload.drift_guard?.high_evidence_harden_bias,
    true,
  );
  assert.equal(
    Number(
      contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardPayload.drift_guard?.high_evidence_turns,
    ) >= 10,
    true,
  );
  assert.equal(
    Number(
      contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardPayload.drift_guard?.high_evidence_harden_rate,
    ) >= 0.7,
    true,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardPayload.drift_guard?.reason,
    "high_evidence_harden_bias",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardPayload.drift_guard?.recommendation,
    "prefer_relax",
  );
  assert.equal(
    ["soft", "medium", "hard"].includes(
      String(contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardPayload.drift_guard?.auto_action_level),
    ),
    true,
  );
  assert.equal(
    Array.isArray(
      contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardPayload.drift_guard?.recent_auto_action_levels,
    ),
    true,
  );
  assert.equal(
    Number(
      contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardPayload.drift_guard?.window_summary?.entries,
    ) >= 1,
    true,
  );
  assert.equal(
    ["green", "yellow", "red"].includes(
      String(
        contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardPayload.drift_guard?.window_summary
          ?.alert_level,
      ),
    ),
    true,
  );
  logStep("context-engine-contract prompt-quality-guard-adaptive-sequence drift-guard");

  const preSendPlanQualityFirstResult = runTsContract(
    "context-engine-contract.ts",
    "pre-send-compression-plan",
    [
      "--payload",
      JSON.stringify({
        selected_stage: "proactive",
        estimated_tokens: 10_150,
        target_token_limit: 10_000,
        quality_guard_active: false,
        quality_guard_severe: false,
        pressure_trend_momentum: 0.08,
      }),
    ],
  );
  const preSendPlanQualityFirstPayload = parseJsonOutput(
    "context-engine-contract pre-send-compression-plan quality-first",
    preSendPlanQualityFirstResult.stdout,
  );
  assert.equal(preSendPlanQualityFirstPayload.strategy, "quality_first");
  assert.equal(Array.isArray(preSendPlanQualityFirstPayload.order), true);
  assert.equal(preSendPlanQualityFirstPayload.order[0], "recent_trim");
  assert.equal(preSendPlanQualityFirstPayload.order[1], "snapshot_semantic_compress");
  assert.equal(preSendPlanQualityFirstPayload.order[2], "snapshot_trim");
  assert.equal(typeof preSendPlanQualityFirstPayload.overflow_ratio, "number");
  assert.equal(typeof preSendPlanQualityFirstPayload.pressure_score, "number");
  logStep("context-engine-contract pre-send-compression-plan quality-first");

  const preSendPlanHardBudgetResult = runTsContract(
    "context-engine-contract.ts",
    "pre-send-compression-plan",
    [
      "--payload",
      JSON.stringify({
        selected_stage: "minimal",
        estimated_tokens: 13_600,
        target_token_limit: 10_000,
        quality_guard_active: true,
        quality_guard_severe: true,
        pressure_trend_momentum: 0.82,
      }),
    ],
  );
  const preSendPlanHardBudgetPayload = parseJsonOutput(
    "context-engine-contract pre-send-compression-plan hard-budget",
    preSendPlanHardBudgetResult.stdout,
  );
  assert.equal(preSendPlanHardBudgetPayload.strategy, "hard_budget");
  assert.equal(Array.isArray(preSendPlanHardBudgetPayload.order), true);
  assert.equal(preSendPlanHardBudgetPayload.order[0], "recent_trim");
  assert.equal(preSendPlanHardBudgetPayload.order[1], "snapshot_trim");
  assert.equal(preSendPlanHardBudgetPayload.order.includes("snapshot_semantic_compress"), true);
  assert.equal(preSendPlanHardBudgetPayload.order.at(-1), "head_trim");
  assert.equal(Number(preSendPlanHardBudgetPayload.overflow_ratio) >= 0.3, true);
  assert.equal(Number(preSendPlanHardBudgetPayload.pressure_score) >= 0.62, true);
  logStep("context-engine-contract pre-send-compression-plan hard-budget");

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
  assert.equal(
    (contextEngineGraphCachePayload.first_pass?.symbol_rows ?? []).some(
      (row) => String(row).includes("bridge=") && String(row).includes("breadth="),
    ),
    true,
  );
  const firstQuality = contextEngineGraphCachePayload.first_pass?.quality ?? {};
  const secondQuality = contextEngineGraphCachePayload.second_pass?.quality ?? {};
  assert.equal(Number(firstQuality.dependency?.max_chain_depth) >= 2, true);
  assert.equal(Number(firstQuality.dependency?.unique_nodes) >= 2, true);
  assert.equal(
    Number(firstQuality.symbol?.rows_with_bridge)
      >= 1,
    true,
  );
  assert.equal(Number(firstQuality.symbol?.rows_with_breadth) >= 1, true);
  assert.equal(
    Number(secondQuality.dependency?.max_chain_depth)
      >= Number(firstQuality.dependency?.max_chain_depth),
    true,
  );
  assert.equal(
    Number(secondQuality.symbol?.avg_bridge)
      >= Number(firstQuality.symbol?.avg_bridge),
    true,
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

  const contextEngineGraphCacheMultiHopPayloadRaw = JSON.stringify({
    query: "trace payment call chain",
    max_rows: 8,
    snapshot: {
      root_path: "/tmp/context-graph-cache-contract-hop",
      files: [
        {
          path: "src/payments/entry.ts",
          content: [
            "import { settlePayment } from \"./service\";",
            "export const runEntry = async (orderId: string) => settlePayment(orderId);",
          ].join("\n"),
        },
        {
          path: "src/payments/service.ts",
          content: [
            "import { requestPayment } from \"./gateway\";",
            "export const settlePayment = async (orderId: string) => requestPayment(orderId);",
          ].join("\n"),
        },
        {
          path: "src/payments/gateway.ts",
          content: [
            "import { writeLog } from \"../infra/logger\";",
            "export function requestPayment(orderId: string) {",
            "  writeLog(orderId);",
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
  const contextEngineGraphCacheMultiHopResult = runTsContract("context-engine-contract.ts", "graph-cache", [
    "--payload",
    contextEngineGraphCacheMultiHopPayloadRaw,
  ]);
  const contextEngineGraphCacheMultiHopPayload = parseJsonOutput(
    "context-engine-contract graph-cache multi-hop",
    contextEngineGraphCacheMultiHopResult.stdout,
  );
  const multiHopRows = contextEngineGraphCacheMultiHopPayload.first_pass?.dependency_rows ?? [];
  assert.equal(
    multiHopRows.some((row) => String(row).split("->").length >= 3),
    true,
  );
  assert.equal(
    multiHopRows.some((row) => String(row).split("->").length >= 4),
    true,
  );
  const multiHopQuality = contextEngineGraphCacheMultiHopPayload.first_pass?.quality?.dependency ?? {};
  assert.equal(Number(multiHopQuality.max_chain_depth) >= 4, true);
  assert.equal(Number(multiHopQuality.depth_histogram?.depth_4_plus) >= 1, true);
  assert.equal(contextEngineGraphCacheMultiHopPayload.cache_reuse_observed, true);
  assert.deepEqual(
    contextEngineGraphCacheMultiHopPayload.second_pass?.dependency_rows,
    contextEngineGraphCacheMultiHopPayload.first_pass?.dependency_rows,
  );
  logStep("context-engine-contract graph-cache-multi-hop");

  const graphCacheConcurrency = 6;
  const graphCacheConcurrencyRounds = 2;
  const expectedFirstSymbolSignature = JSON.stringify(contextEngineGraphCachePayload.first_pass?.symbol_rows ?? []);
  const expectedFirstDependencySignature = JSON.stringify(contextEngineGraphCachePayload.first_pass?.dependency_rows ?? []);
  const expectedSecondSymbolSignature = JSON.stringify(contextEngineGraphCachePayload.second_pass?.symbol_rows ?? []);
  const expectedSecondDependencySignature = JSON.stringify(contextEngineGraphCachePayload.second_pass?.dependency_rows ?? []);
  for (let round = 1; round <= graphCacheConcurrencyRounds; round += 1) {
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
      assertSuccess(
        `context-engine-contract graph-cache concurrent-r${String(round)}-${String(index + 1)}`,
        concurrentResult,
      );
      const concurrentPayload = parseJsonOutput(
        `context-engine-contract graph-cache concurrent-r${String(round)}-${String(index + 1)}`,
        concurrentResult.stdout,
      );
      assert.equal(concurrentPayload.cache_reuse_observed, true);
      const firstSymbolSignature = JSON.stringify(concurrentPayload.first_pass?.symbol_rows ?? []);
      const firstDependencySignature = JSON.stringify(concurrentPayload.first_pass?.dependency_rows ?? []);
      const secondSymbolSignature = JSON.stringify(concurrentPayload.second_pass?.symbol_rows ?? []);
      const secondDependencySignature = JSON.stringify(concurrentPayload.second_pass?.dependency_rows ?? []);
      assert.equal(firstSymbolSignature, expectedFirstSymbolSignature);
      assert.equal(firstDependencySignature, expectedFirstDependencySignature);
      assert.equal(secondSymbolSignature, expectedSecondSymbolSignature);
      assert.equal(secondDependencySignature, expectedSecondDependencySignature);
      const firstConcurrentStats = concurrentPayload.first_pass?.stats ?? {};
      const secondConcurrentStats = concurrentPayload.second_pass?.stats ?? {};
      assert.equal(
        Number(secondConcurrentStats.symbol_query?.hit)
          > Number(firstConcurrentStats.symbol_query?.hit),
        true,
      );
      assert.equal(
        Number(secondConcurrentStats.dependency_query?.hit)
          > Number(firstConcurrentStats.dependency_query?.hit),
        true,
      );
      const concurrentTiming = concurrentPayload.timing ?? {};
      assert.equal(Number.isFinite(Number(concurrentTiming.first_pass_duration_ms)), true);
      assert.equal(Number.isFinite(Number(concurrentTiming.second_pass_duration_ms)), true);
      assert.equal(
        Number(concurrentTiming.second_pass_duration_ms)
          <= Number(concurrentTiming.first_pass_duration_ms) + 600,
        true,
      );
    }
  }
  logStep("context-engine-contract graph-cache-concurrency", {
    concurrency: graphCacheConcurrency,
    rounds: graphCacheConcurrencyRounds,
  });

  const graphCacheHotLoopResult = runTsContract("context-engine-contract.ts", "graph-cache-hot-loop", [
    "--payload",
    JSON.stringify({
      query: "add payment logging and retry context",
      max_rows: 4,
      repeat: 8,
      burst: 6,
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
    }),
  ]);
  const graphCacheHotLoopPayload = parseJsonOutput(
    "context-engine-contract graph-cache-hot-loop",
    graphCacheHotLoopResult.stdout,
  );
  assert.equal(graphCacheHotLoopPayload.cache_reuse_observed, true);
  assert.equal(Array.isArray(graphCacheHotLoopPayload.turns), true);
  assert.equal(Number(graphCacheHotLoopPayload.turns.length), 8);
  assert.equal(Number(graphCacheHotLoopPayload.burst), 6);
  assert.deepEqual(
    graphCacheHotLoopPayload.last_rows?.symbol_rows,
    graphCacheHotLoopPayload.first_rows?.symbol_rows,
  );
  assert.deepEqual(
    graphCacheHotLoopPayload.last_rows?.dependency_rows,
    graphCacheHotLoopPayload.first_rows?.dependency_rows,
  );
  let prevSymbolHit = -1;
  let prevDependencyHit = -1;
  for (const row of graphCacheHotLoopPayload.turns) {
    const symbolHit = Number(row?.symbol_query?.hit);
    const dependencyHit = Number(row?.dependency_query?.hit);
    assert.equal(Number.isFinite(symbolHit), true);
    assert.equal(Number.isFinite(dependencyHit), true);
    assert.equal(row?.rows_consistent, true);
    if (prevSymbolHit >= 0) {
      assert.equal(symbolHit >= prevSymbolHit + Number(graphCacheHotLoopPayload.burst), true);
    }
    if (prevDependencyHit >= 0) {
      assert.equal(dependencyHit >= prevDependencyHit + Number(graphCacheHotLoopPayload.burst), true);
    }
    prevSymbolHit = symbolHit;
    prevDependencyHit = dependencyHit;
  }
  logStep("context-engine-contract graph-cache-hot-loop");

  const persistentGraphRepoDir = makeTempDir("context-graph-persistent-index");
  const gitInitPersistentGraphResult = runCommand("git", ["init"], { cwd: persistentGraphRepoDir });
  assertSuccess("context-engine-contract graph-persistent-index git-init", gitInitPersistentGraphResult);
  writeFixtureFile(
    resolve(persistentGraphRepoDir, "src/payments/entry.ts"),
    [
      "import { settlePayment } from \"./service\";",
      "export const runEntry = async (orderId: string) => settlePayment(orderId);",
    ].join("\n"),
  );
  writeFixtureFile(
    resolve(persistentGraphRepoDir, "src/payments/service.ts"),
    [
      "import { requestPayment } from \"./gateway\";",
      "export const settlePayment = async (orderId: string) => requestPayment(orderId);",
    ].join("\n"),
  );
  writeFixtureFile(
    resolve(persistentGraphRepoDir, "src/payments/gateway.ts"),
    [
      "import { writeLog } from \"../infra/logger\";",
      "export function requestPayment(orderId: string) {",
      "  writeLog(orderId);",
      "  return `ok:${orderId}`;",
      "}",
    ].join("\n"),
  );
  writeFixtureFile(
    resolve(persistentGraphRepoDir, "src/infra/logger.ts"),
    [
      "export function writeLog(input: string) {",
      "  return input;",
      "}",
    ].join("\n"),
  );
  const persistentGraphPayloadRaw = JSON.stringify({
    work_dir: persistentGraphRepoDir,
    query: "trace payment call chain",
    max_rows: 8,
  });
  const persistentGraphResult = runTsContract("context-engine-contract.ts", "graph-persistent-index", [
    "--payload",
    persistentGraphPayloadRaw,
  ]);
  const persistentGraphPayload = parseJsonOutput(
    "context-engine-contract graph-persistent-index",
    persistentGraphResult.stdout,
  );
  assert.equal(persistentGraphPayload.cache_reuse_observed, true);
  assert.deepEqual(
    persistentGraphPayload.second_pass?.dependency_rows,
    persistentGraphPayload.first_pass?.dependency_rows,
  );
  assert.deepEqual(
    persistentGraphPayload.second_pass?.symbol_rows,
    persistentGraphPayload.first_pass?.symbol_rows,
  );
  const persistentFirstStatus = persistentGraphPayload.first_pass?.status ?? {};
  assert.equal(persistentFirstStatus.enabled, true);
  assert.equal(Number(persistentFirstStatus.file_count) >= 4, true);
  assert.equal(Number(persistentFirstStatus.symbol_count) >= 4, true);
  assert.equal(
    ["cold", "incremental", "steady", "skipped"].includes(
      String(persistentFirstStatus.last_refresh?.mode ?? ""),
    ),
    true,
  );
  const persistentIndexPath = String(persistentFirstStatus.index_path ?? "");
  assert.equal(persistentIndexPath.length > 0, true);
  assert.equal(existsSync(persistentIndexPath), true);

  writeFixtureFile(
    resolve(persistentGraphRepoDir, "src/payments/entry.ts"),
    [
      "import { settlePayment } from \"./service\";",
      "import { sendWebhook } from \"./webhook\";",
      "export const runEntry = async (orderId: string) => {",
      "  const result = await settlePayment(orderId);",
      "  sendWebhook(orderId);",
      "  return result;",
      "};",
    ].join("\n"),
  );
  writeFixtureFile(
    resolve(persistentGraphRepoDir, "src/payments/webhook.ts"),
    [
      "export function sendWebhook(orderId: string) {",
      "  return `webhook:${orderId}`;",
      "}",
    ].join("\n"),
  );
  const persistentGraphAfterUpdateResult = runTsContract("context-engine-contract.ts", "graph-persistent-index", [
    "--payload",
    persistentGraphPayloadRaw,
  ]);
  const persistentGraphAfterUpdatePayload = parseJsonOutput(
    "context-engine-contract graph-persistent-index after-update",
    persistentGraphAfterUpdateResult.stdout,
  );
  const persistentAfterStatus = persistentGraphAfterUpdatePayload.first_pass?.status ?? {};
  assert.equal(persistentAfterStatus.enabled, true);
  assert.equal(Number(persistentAfterStatus.file_count) >= Number(persistentFirstStatus.file_count), true);
  assert.equal(Number(persistentAfterStatus.last_refresh?.parsed_files) >= 1, true);
  assert.equal(
    (persistentGraphAfterUpdatePayload.first_pass?.dependency_rows ?? [])
      .some((row) => String(row).includes("webhook")),
    true,
  );
  assert.equal(
    (persistentGraphAfterUpdatePayload.first_pass?.symbol_rows ?? [])
      .some((row) => String(row).includes("sendWebhook")),
    true,
  );
  const persistentGraphExtraRepoDir = makeTempDir("context-graph-persistent-index-extra");
  const gitInitPersistentGraphExtraResult = runCommand("git", ["init"], {
    cwd: persistentGraphExtraRepoDir,
  });
  assertSuccess(
    "context-engine-contract graph-persistent-index extra git-init",
    gitInitPersistentGraphExtraResult,
  );
  writeFixtureFile(
    resolve(persistentGraphExtraRepoDir, "src/billing/entry.ts"),
    [
      "import { buildInvoice } from \"./service\";",
      "export const runBilling = async (billId: string) => buildInvoice(billId);",
    ].join("\n"),
  );
  writeFixtureFile(
    resolve(persistentGraphExtraRepoDir, "src/billing/service.ts"),
    [
      "import { requestBilling } from \"./gateway\";",
      "export function buildInvoice(billId: string) {",
      "  return requestBilling(billId);",
      "}",
    ].join("\n"),
  );
  writeFixtureFile(
    resolve(persistentGraphExtraRepoDir, "src/billing/gateway.ts"),
    [
      "export function requestBilling(billId: string) {",
      "  return `bill:${billId}`;",
      "}",
    ].join("\n"),
  );
  const persistentGraphCrossRepoResult = runTsContract("context-engine-contract.ts", "graph-persistent-index", [
    "--payload",
    JSON.stringify({
      work_dir: persistentGraphRepoDir,
      extra_work_dirs: [persistentGraphExtraRepoDir],
      query: "trace billing payment call chain",
      max_rows: 8,
    }),
  ]);
  const persistentGraphCrossRepoPayload = parseJsonOutput(
    "context-engine-contract graph-persistent-index cross-repo",
    persistentGraphCrossRepoResult.stdout,
  );
  assert.equal(persistentGraphCrossRepoPayload.cross_repo_observed, true);
  assert.equal(Array.isArray(persistentGraphCrossRepoPayload.extra_roots), true);
  assert.equal(Number(persistentGraphCrossRepoPayload.extra_roots.length) >= 1, true);
  const persistentGraphExtraRoot = persistentGraphCrossRepoPayload.extra_roots[0] ?? {};
  assert.equal(persistentGraphExtraRoot.work_dir, persistentGraphExtraRepoDir);
  assert.equal(persistentGraphExtraRoot.status?.enabled, true);
  assert.equal(
    (persistentGraphExtraRoot.dependency_rows ?? [])
      .some((row) => String(row).toLowerCase().includes("billing")),
    true,
  );
  assert.equal(
    (persistentGraphExtraRoot.symbol_rows ?? [])
      .some((row) => String(row).includes("buildInvoice")),
    true,
  );
  logStep("context-engine-contract graph-persistent-index");

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
    const statusResult = runCommand("node", [
      resolve(contractsRoot, "start-smoke-contract.mjs"),
      "status-ts-rust",
      "--repo-root",
      repoRoot,
    ], {
      timeoutMs: 240_000,
    });
    const isTransientRuntimeDescribeMissing =
      statusResult.code !== 0
      && statusResult.stderr.includes("runtime tool schema projection should be sourced from runtime.tools.describe: missing");
    if (isTransientRuntimeDescribeMissing && attempt < 3) {
      logRetry("start-smoke-contract status-ts-rust", attempt, 3, "transient runtime.tools.describe bootstrap gap");
      await sleepMs(500);
      continue;
    }
    assertSuccess("start-smoke-contract.mjs status-ts-rust", statusResult);
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
  assert.equal(statusPayload.status_has_runtime_tools, true);
  assert.equal(statusPayload.status_has_runtime_tools_quality, true);
  assert.equal(statusPayload.status_runtime_tool_quality_status, "ok");
  assert.equal(statusPayload.status_runtime_tool_quality_schema_version, 1);
  assert.equal(statusPayload.status_runtime_tool_quality_passed_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_quality_runtime_binary_exists_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_quality_runtime_health_ok_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_quality_runtime_describe_source, "runtime.tools.describe");
  assert.equal(statusPayload.status_runtime_tool_quality_schema_budget_status, "passed");
  assert.equal(statusPayload.status_runtime_tool_quality_schema_budget_violations_type, "number");
  assert.equal(statusPayload.status_runtime_tool_quality_schema_drift_active_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_quality_recovery_gate_status, "pass");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_quality_latest_stage_type)),
    true,
  );
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_quality_action_required_type)),
    true,
  );
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_quality_actionable_next_step_type)),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_quality_action_family, "none");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_quality_action_reason_type)),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_quality_failure_reasons_is_array, true);
  assert.equal(statusPayload.status_runtime_tool_quality_warning_reasons_is_array, true);
  assert.equal(statusPayload.status_runtime_tool_surface_profile, "coding");
  assert.equal(statusPayload.status_runtime_tool_surface_source_type, "string");
  assert.equal(statusPayload.status_runtime_tool_policy_version, "v1");
  assert.equal(statusPayload.status_runtime_tool_model_visible_tools_is_array, true);
  assert.equal(statusPayload.status_runtime_tool_model_visible_tool_count, 7);
  assert.equal(statusPayload.status_runtime_tool_dispatch_enabled_tools_is_array, true);
  assert.equal(statusPayload.status_runtime_tool_dispatch_enabled_tool_count, 7);
  assert.equal(statusPayload.status_runtime_tool_model_visible_has_prompt_enhancer, false);
  assert.equal(statusPayload.status_runtime_tool_model_visible_has_web_scan, false);
  assert.equal(statusPayload.status_runtime_tool_model_visible_has_glob, true);
  assert.equal(statusPayload.status_runtime_tool_schema_fingerprint_type, "string");
  assert.equal(statusPayload.status_runtime_tool_schema_estimated_tokens_type, "number");
  assert.equal(statusPayload.status_runtime_tool_advanced_schema_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_present, true);
  assert.equal(statusPayload.status_runtime_tool_schema_projection_source_type, "string");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_per_tool_type, "object");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_visible_args_type, "object");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_suppressed_args_type, "object");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_visible_args_sum, 27);
  assert.equal(statusPayload.status_runtime_tool_schema_projection_suppressed_args_sum, 3);
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_present, true);
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_checked_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_active_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_reason_type, "string");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_runtime_visible_args_type, "object");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_gateway_visible_args_type, "object");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_runtime_suppressed_args_type, "object");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_gateway_suppressed_args_type, "object");
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_runtime_visible_args_sum, 27);
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_gateway_visible_args_sum, 27);
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_runtime_suppressed_args_sum, 3);
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_gateway_suppressed_args_sum, 3);
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_arg_mismatch_details_is_array, true);
  assert.equal(statusPayload.status_runtime_tool_schema_projection_drift_arg_mismatch_details_count, 0);
  assert.equal(statusPayload.status_runtime_tool_surface_decision_present, true);
  assert.equal(statusPayload.status_runtime_tool_surface_decision_profile, "coding");
  assert.equal(statusPayload.status_runtime_tool_surface_decision_reason_type, "string");
  assert.equal(statusPayload.status_runtime_tool_surface_decision_scores_type, "object");
  assert.equal(statusPayload.status_runtime_tool_surface_decision_score_coding_type, "number");
  assert.equal(statusPayload.status_runtime_tool_surface_decision_suppressed_is_array, true);
  assert.equal(statusPayload.status_runtime_tool_surface_decision_suppressed_count, 0);
  assert.equal(statusPayload.status_runtime_tool_metrics_present, true);
  assert.equal(statusPayload.status_runtime_tool_metrics_calls_total_type, "number");
  assert.equal(statusPayload.status_runtime_tool_metrics_failures_type, "object");
  assert.equal(statusPayload.status_runtime_tool_metrics_recovery_stages_type, "object");
  assert.equal(statusPayload.status_runtime_tool_recovery_feedback_present, true);
  assert.equal(statusPayload.status_runtime_tool_recovery_feedback_active_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_recovery_feedback_severity_type, "string");
  assert.equal(statusPayload.status_runtime_tool_recovery_feedback_reason_type, "string");
  assert.equal(
    ["boolean", "object"].includes(String(statusPayload.status_runtime_tool_recovery_feedback_recoverable_type)),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_feedback_requires_user_intervention_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_recovery_feedback_consumed_type, "boolean");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_feedback_consumed_reason_type)),
    true,
  );
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_feedback_observed_at_type)),
    true,
  );
  assert.equal(
    ["number", "object"].includes(String(statusPayload.status_runtime_tool_recovery_feedback_same_tool_error_count_type)),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_feedback_escalated_type, "boolean");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_feedback_escalation_reason_type)),
    true,
  );
  assert.equal(
    ["string", "object"].includes(
      String(statusPayload.status_runtime_tool_recovery_feedback_escalation_policy_version_type),
    ),
    true,
  );
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_feedback_base_recovery_stage_type)),
    true,
  );
  assert.equal(
    ["string", "object"].includes(
      String(statusPayload.status_runtime_tool_recovery_feedback_base_recommended_next_action_type),
    ),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_feedback_runtime_environment_recovery_type),
    ),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_feedback_browser_environment_recovery_type),
    ),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_feedback_mcp_environment_recovery_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_timeline_is_array, true);
  assert.equal(statusPayload.status_runtime_tool_recovery_timeline_count >= 0, true);
  assert.equal(
    ["string", "undefined"].includes(String(statusPayload.status_runtime_tool_recovery_timeline_latest_recovery_key_type)),
    true,
  );
  assert.equal(
    ["boolean", "undefined"].includes(String(statusPayload.status_runtime_tool_recovery_timeline_latest_active_type)),
    true,
  );
  assert.equal(
    ["boolean", "undefined"].includes(String(statusPayload.status_runtime_tool_recovery_timeline_latest_consumed_type)),
    true,
  );
  assert.equal(
    ["string", "object", "undefined"].includes(String(statusPayload.status_runtime_tool_recovery_timeline_latest_stage_type)),
    true,
  );
  assert.equal(
    ["number", "object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_timeline_latest_same_tool_error_count_type),
    ),
    true,
  );
  assert.equal(
    ["boolean", "undefined"].includes(String(statusPayload.status_runtime_tool_recovery_timeline_latest_escalated_type)),
    true,
  );
  assert.equal(
    ["string", "object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_timeline_latest_escalation_reason_type),
    ),
    true,
  );
  assert.equal(
    ["string", "object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_timeline_latest_escalation_policy_version_type),
    ),
    true,
  );
  assert.equal(
    ["string", "object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_timeline_latest_base_recovery_stage_type),
    ),
    true,
  );
  assert.equal(
    ["string", "object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_timeline_latest_base_recommended_next_action_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_health_present, true);
  assert.equal(statusPayload.status_runtime_tool_recovery_health_timeline_count_type, "number");
  assert.equal(statusPayload.status_runtime_tool_recovery_health_score_type, "number");
  assert.equal(statusPayload.status_runtime_tool_recovery_health_level_type, "string");
  assert.equal(statusPayload.status_runtime_tool_recovery_health_reason_type, "string");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_health_recommended_action_type)),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_health_attention_source_type, "string");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_health_attention_key_type)),
    true,
  );
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_health_attention_tool_name_type)),
    true,
  );
  assert.equal(
    statusPayload.status_runtime_tool_recovery_health_attention_requires_user_intervention_type,
    "boolean",
  );
  assert.equal(
    ["number", "object"].includes(String(statusPayload.status_runtime_tool_recovery_health_attention_age_ms_type)),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_health_active_count_type, "number");
  assert.equal(statusPayload.status_runtime_tool_recovery_health_unconsumed_count_type, "number");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_health_latest_key_type)),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_health_has_stuck_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_present, true);
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_version_type, "string");
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_prompt_max_age_ms_type, "number");
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_timeline_max_entries_type, "number");
  assert.equal(
    statusPayload.status_runtime_tool_recovery_policy_adaptation_history_max_entries_type,
    "number",
  );
  assert.equal(
    statusPayload.status_runtime_tool_recovery_policy_recovery_consumption_history_max_entries_type,
    "number",
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_guard_type, "object");
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_guard_repeat_threshold, 2);
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_health_type, "object");
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_escalation_type, "object");
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_escalation_strategy_switch_threshold, 2);
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_escalation_ask_user_threshold, 3);
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_escalation_environment_ask_user_threshold, 2);
  assert.equal(
    statusPayload.status_runtime_tool_recovery_policy_escalation_browser_environment_ask_user_threshold,
    2,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_health_watch_threshold, 85);
  assert.equal(statusPayload.status_runtime_tool_recovery_policy_health_risk_threshold, 60);
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_health_attention_runtime_environment_recovery_type),
    ),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_health_attention_browser_environment_recovery_type),
    ),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_health_attention_mcp_environment_recovery_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_readiness_present, true);
  assert.equal(statusPayload.status_runtime_tool_recovery_readiness_status_type, "string");
  assert.equal(statusPayload.status_runtime_tool_recovery_readiness_ready_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_recovery_readiness_auto_allowed_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_recovery_readiness_operator_action_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_recovery_readiness_reason_type, "string");
  assert.equal(statusPayload.status_runtime_tool_recovery_readiness_policy_version_type, "string");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_readiness_attention_stage_type)),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_readiness_attention_runtime_environment_recovery_type),
    ),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_readiness_attention_browser_environment_recovery_type),
    ),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_readiness_attention_mcp_environment_recovery_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_gate_present, true);
  assert.equal(statusPayload.status_runtime_tool_recovery_gate_status_type, "string");
  assert.equal(statusPayload.status_runtime_tool_recovery_gate_passed_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_recovery_gate_blocking_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_recovery_gate_severity_type, "string");
  assert.equal(statusPayload.status_runtime_tool_recovery_gate_reason_type, "string");
  assert.equal(statusPayload.status_runtime_tool_recovery_gate_blocker_kind_type, "string");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_gate_blocker_code_type)),
    true,
  );
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_gate_blocker_action_type)),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_recovery_gate_readiness_status_type, "string");
  assert.equal(statusPayload.status_runtime_tool_recovery_gate_auto_allowed_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_recovery_gate_operator_action_type, "boolean");
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_recovery_gate_attention_stage_type)),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_gate_attention_runtime_environment_recovery_type),
    ),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_gate_attention_browser_environment_recovery_type),
    ),
    true,
  );
  assert.equal(
    ["object", "undefined"].includes(
      String(statusPayload.status_runtime_tool_recovery_gate_attention_mcp_environment_recovery_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_present, true);
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_active_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_reason_type, "string");
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_from_profile_type, "string");
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_applied_profile_type, "string");
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_auto_blocked_type, "boolean");
  assert.equal(
    ["boolean", "object"].includes(String(statusPayload.status_runtime_tool_surface_adaptation_recoverable_type)),
    true,
  );
  assert.equal(
    ["string", "object"].includes(String(statusPayload.status_runtime_tool_surface_adaptation_observed_at_type)),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_outcome_present, true);
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_outcome_path_type, "string");
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_outcome_recent_count_type, "number");
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_outcome_profile_outcomes_type, "object");
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_outcome_consumption_count_type, "number");
  assert.equal(
    ["object", "undefined"].includes(String(statusPayload.status_runtime_tool_surface_adaptation_outcome_latest_consumption_type)),
    true,
  );
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_guard_present, true);
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_guard_active_type, "boolean");
  assert.equal(statusPayload.status_runtime_tool_surface_adaptation_guard_reason_type, "string");
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
  assert.equal(statusPayload.status_context_graph_cache_autotune_state_present, true);
  assert.equal(statusPayload.status_context_graph_cache_autotune_state_last_direction_type, "string");
  assert.equal(statusPayload.status_context_graph_cache_autotune_state_hold_turns_remaining_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_autotune_state_downshift_warmup_streak_type, "number");
  assert.equal(
    ["string", "null"].includes(
      String(statusPayload.status_context_graph_cache_autotune_state_last_reason_type),
    ),
    true,
  );
  assert.equal(
    ["string", "null"].includes(
      String(statusPayload.status_context_graph_cache_autotune_state_updated_at_type),
    ),
    true,
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_adaptive_cache_threshold_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_adaptive_parsed_max_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_adaptive_reused_min_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_adaptive_removed_max_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_adaptive_alpha_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_adaptive_updates_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_adaptive_source_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_adaptive_action_scale_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_adaptive_action_updates_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_adaptive_action_source_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_graph_cache_autotune_state_persistence_domain_type,
    "string",
  );
  assert.equal(statusPayload.status_has_context_graph_cache_window, true);
  assert.equal(statusPayload.status_context_graph_cache_window_path_type, "string");
  assert.equal(statusPayload.status_context_graph_cache_window_configured_size_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_window_entries_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_window_persistence_domain_type, "string");
  assert.equal(statusPayload.status_context_graph_cache_window_persistence_domain_value, "context");
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
  assert.equal(statusPayload.status_context_graph_cache_window_query_totals_hit_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_window_overall_totals_hit_type, "number");
  assert.equal(
    ["number", "null"].includes(String(statusPayload.status_context_graph_cache_window_query_hit_rate_type)),
    true,
  );
  assert.equal(
    ["number", "null"].includes(String(statusPayload.status_context_graph_cache_window_overall_hit_rate_type)),
    true,
  );
  assert.equal(statusPayload.status_context_graph_cache_window_has_quality, true);
  assert.equal(
    statusPayload.status_context_graph_cache_window_quality_entries_with_quality_type,
    "number",
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_graph_cache_window_quality_dependency_avg_rows_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_graph_cache_window_quality_dependency_avg_max_chain_depth_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_graph_cache_window_quality_dependency_multi_hop_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_graph_cache_window_quality_symbol_bridge_coverage_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_graph_cache_window_quality_symbol_breadth_coverage_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_graph_cache_window_quality_symbol_avg_refs_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_graph_cache_window_quality_symbol_max_refs_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_context_graph_cache_window_has_degradation, true);
  assert.equal(statusPayload.status_context_graph_cache_window_degradation_degraded_type, "boolean");
  assert.equal(statusPayload.status_context_graph_cache_window_degradation_reason_type, "string");
  assert.equal(statusPayload.status_context_graph_cache_window_degradation_threshold_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_window_degradation_min_entries_type, "number");
  assert.equal(statusPayload.status_context_graph_cache_window_degradation_observed_entries_type, "number");
  assert.equal(
    ["number", "null"].includes(String(statusPayload.status_context_graph_cache_window_degradation_observed_query_hit_rate_type)),
    true,
  );
  assert.equal(statusPayload.status_has_context_persistent_graph_index, true);
  assert.equal(statusPayload.status_context_persistent_graph_index_enabled_type, "boolean");
  assert.equal(statusPayload.status_context_persistent_graph_index_root_path_type, "string");
  assert.equal(statusPayload.status_context_persistent_graph_index_index_path_type, "string");
  assert.equal(statusPayload.status_context_persistent_graph_index_persistence_domain_type, "string");
  assert.equal(statusPayload.status_context_persistent_graph_index_persistence_domain_value, "memory");
  assert.equal(
    ["string", "null"].includes(String(statusPayload.status_context_persistent_graph_index_updated_at_type)),
    true,
  );
  assert.equal(statusPayload.status_context_persistent_graph_index_file_count_type, "number");
  assert.equal(statusPayload.status_context_persistent_graph_index_symbol_count_type, "number");
  assert.equal(statusPayload.status_context_persistent_graph_index_edge_count_type, "number");
  assert.equal(statusPayload.status_context_persistent_graph_index_has_last_refresh, true);
  assert.equal(statusPayload.status_context_persistent_graph_index_last_refresh_mode_type, "string");
  assert.equal(statusPayload.status_context_persistent_graph_index_last_refresh_parsed_files_type, "number");
  assert.equal(statusPayload.status_context_persistent_graph_index_last_refresh_reused_files_type, "number");
  assert.equal(statusPayload.status_context_persistent_graph_index_last_refresh_removed_files_type, "number");
  assert.equal(statusPayload.status_context_persistent_graph_index_has_window, true);
  assert.equal(statusPayload.status_context_persistent_graph_index_window_path_type, "string");
  assert.equal(statusPayload.status_context_persistent_graph_index_window_configured_size_type, "number");
  assert.equal(statusPayload.status_context_persistent_graph_index_window_entries_type, "number");
  assert.equal(
    statusPayload.status_context_persistent_graph_index_window_persistence_domain_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_persistent_graph_index_window_persistence_domain_value,
    "memory",
  );
  assert.equal(
    ["string", "null"].includes(String(statusPayload.status_context_persistent_graph_index_window_from_ts_type)),
    true,
  );
  assert.equal(
    ["string", "null"].includes(String(statusPayload.status_context_persistent_graph_index_window_to_ts_type)),
    true,
  );
  assert.equal(
    statusPayload.status_context_persistent_graph_index_window_mode_counts_incremental_type,
    "number",
  );
  assert.equal(statusPayload.status_context_persistent_graph_index_window_totals_parsed_files_type, "number");
  assert.equal(statusPayload.status_context_persistent_graph_index_window_totals_reused_files_type, "number");
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_persistent_graph_index_window_rates_parsed_per_scanned_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_persistent_graph_index_window_rates_reused_per_scanned_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_persistent_graph_index_window_rates_removed_per_scanned_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_context_persistent_graph_index_window_has_latest, true);
  assert.equal(
    ["string", "null"].includes(
      String(statusPayload.status_context_persistent_graph_index_window_latest_mode_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_persistent_graph_index_window_latest_parsed_files_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_persistent_graph_index_window_latest_file_count_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_context_persistent_graph_index_has_degradation, true);
  assert.equal(statusPayload.status_context_persistent_graph_index_degradation_degraded_type, "boolean");
  assert.equal(statusPayload.status_context_persistent_graph_index_degradation_reason_type, "string");
  assert.equal(statusPayload.status_context_persistent_graph_index_degradation_threshold_parsed_type, "number");
  assert.equal(statusPayload.status_context_persistent_graph_index_degradation_threshold_reused_type, "number");
  assert.equal(statusPayload.status_context_persistent_graph_index_degradation_threshold_removed_type, "number");
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_persistent_graph_index_degradation_observed_parsed_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_persistent_graph_index_degradation_observed_reused_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_persistent_graph_index_degradation_observed_removed_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_has_context_engine, true);
  assert.equal(statusPayload.status_context_engine_enabled_type, "boolean");
  assert.equal(statusPayload.status_context_engine_profile_type, "string");
  assert.equal(statusPayload.status_context_engine_auto_limit_type, "number");
  assert.equal(statusPayload.status_context_engine_target_limit_type, "number");
  assert.equal(statusPayload.status_context_engine_effective_window_type, "number");
  assert.equal(statusPayload.status_context_engine_threshold_hard_type, "number");
  assert.equal(statusPayload.status_context_engine_recovery_ptl_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_low_quality_threshold_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_degrade_overall_threshold_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_degrade_low_quality_rate_threshold_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_degrade_min_entries_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_enabled_type, "boolean");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_adaptive_enabled_type, "boolean");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_adaptive_mode_allowlist_type, "array");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_promote_streak_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_severe_promote_streak_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_release_streak_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_hold_turns_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_max_floor_stage_type, "string");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_severe_overall_threshold_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_severe_low_quality_rate_threshold_type, "number");
  assert.equal(statusPayload.status_context_engine_has_prompt_quality_guard_state, true);
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_state_floor_stage_type, "string");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_state_degraded_streak_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_state_severe_streak_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_state_healthy_streak_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_state_hold_turns_remaining_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_state_last_reason_type, "string");
  assert.equal(
    ["string", "null"].includes(String(statusPayload.status_context_engine_prompt_quality_guard_state_updated_at_type)),
    true,
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_pressure_utilization_threshold_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_pressure_semantic_rate_threshold_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_pressure_auto_limit_rate_threshold_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_pressure_joint_rate_threshold_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_pressure_trend_utilization_delta_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_pressure_trend_semantic_delta_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_pressure_trend_auto_limit_delta_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_pressure_trend_momentum_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_outcome_required_transitions_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_outcome_combined_evidence_score_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_outcome_high_evidence_turns_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_outcome_high_evidence_harden_turns_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_outcome_drift_recent_auto_action_levels_type,
    "array",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_state_persistence_domain_type,
    "string",
  );
  assert.equal(statusPayload.status_context_engine_has_prompt_quality_guard_runtime_assessment, true);
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_enabled_type,
    "boolean",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_phase_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_transition_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_degraded_type,
    "boolean",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_severe_type,
    "boolean",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_reason_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_triggered_type,
    "boolean",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_floor_stage_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_proposed_floor_stage_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_promote_remaining_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_severe_promote_remaining_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_release_remaining_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_hold_turns_remaining_type,
    "number",
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_observed_overall_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_guard_runtime_assessment_observed_low_quality_rate_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_context_engine_has_prompt_quality_guard_adaptive_policy, true);
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_mode_type, "string");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_reason_type, "string");
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_allowlist_type, "array");
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_mode_blocked_type,
    "boolean",
  );
  assert.equal(
    ["string", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_blocked_mode_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_base_promote_type, "number");
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_effective_promote_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_effective_release_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_effective_hold_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_adjustment_promote_delta_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_adjustment_release_delta_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_adjustment_hold_delta_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_source_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_updated_type,
    "boolean",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_learn_alpha_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_utilization_threshold_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_semantic_rate_threshold_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_auto_limit_rate_threshold_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_joint_rate_threshold_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_trend_utilization_delta_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_trend_semantic_delta_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_trend_auto_limit_delta_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_trend_momentum_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_pressure_policy_trend_flip_suppressed_type,
    "boolean",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_outcome_required_transitions_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_outcome_next_required_transitions_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_outcome_hard_budget_transitions_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_outcome_quality_first_transitions_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_outcome_hard_budget_evidence_score_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_outcome_quality_first_evidence_score_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_outcome_combined_evidence_score_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_outcome_hard_budget_reliable_type,
    "boolean",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_outcome_quality_first_reliable_type,
    "boolean",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_drift_high_evidence_harden_bias_type,
    "boolean",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_drift_high_evidence_turn_type,
    "boolean",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_drift_high_evidence_turns_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_drift_high_evidence_harden_turns_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_drift_high_evidence_harden_rate_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_drift_threshold_harden_rate_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_drift_min_high_evidence_turns_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_drift_reason_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_drift_auto_action_level_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_drift_recent_auto_action_levels_type,
    "array",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_entries_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_latest_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_dominant_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_alert_level_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_transition_count_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_active_rate_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_medium_or_hard_rate_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_hard_rate_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_drift_window_level_counts_type,
    "object",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_drift_recommendation_type,
    "string",
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_window_semantic_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_window_auto_limit_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_window_avg_utilization_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_window_short_semantic_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_window_medium_semantic_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_window_short_auto_limit_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_window_medium_auto_limit_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_window_short_avg_utilization_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_window_medium_avg_utilization_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_window_hard_budget_strategy_rate_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_window_quality_first_strategy_rate_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_window_avg_pre_send_overflow_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_window_avg_pre_send_pressure_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_window_hard_budget_followup_delta_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_window_quality_first_followup_delta_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_window_hard_budget_recovery_rate_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_window_quality_first_improved_rate_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_window_hard_budget_transition_count_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_guard_adaptive_policy_window_quality_first_transition_count_type,
      ),
    ),
    true,
  );
  assert.equal(statusPayload.status_context_engine_lineage_enabled_type, "boolean");
  assert.equal(statusPayload.status_context_engine_lineage_persistence_domain_type, "string");
  assert.equal(statusPayload.status_context_engine_lineage_persistence_domain_value, "memory");
  assert.equal(statusPayload.status_context_engine_workspace_signals_enabled_type, "boolean");
  assert.equal(statusPayload.status_context_engine_has_prompt_quality_window, true);
  assert.equal(statusPayload.status_context_engine_has_graph_quality_signals, true);
  assert.equal(statusPayload.status_context_engine_graph_quality_combined_state_type, "string");
  assert.equal(statusPayload.status_context_engine_graph_quality_combined_reason_type, "string");
  assert.equal(statusPayload.status_context_engine_graph_quality_combined_recommended_action_type, "string");
  assert.equal(statusPayload.status_context_engine_graph_quality_combined_degraded_sources_type, "array");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_path_type, "string");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_configured_size_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_entries_type, "number");
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_window_persistence_domain_type,
    "string",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_window_persistence_domain_value,
    "context",
  );
  assert.equal(
    ["string", "null"].includes(String(statusPayload.status_context_engine_prompt_quality_window_from_ts_type)),
    true,
  );
  assert.equal(
    ["string", "null"].includes(String(statusPayload.status_context_engine_prompt_quality_window_to_ts_type)),
    true,
  );
  assert.equal(
    ["number", "null"].includes(String(statusPayload.status_context_engine_prompt_quality_window_average_overall_type)),
    true,
  );
  assert.equal(
    ["number", "null"].includes(String(statusPayload.status_context_engine_prompt_quality_window_latest_overall_type)),
    true,
  );
  assert.equal(
    ["number", "null"].includes(String(statusPayload.status_context_engine_prompt_quality_window_low_quality_rate_type)),
    true,
  );
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_low_quality_threshold_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_stage_normal_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_stage_proactive_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_stage_forced_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_stage_minimal_type, "number");
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_signal_avg_recent_trim_rows_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_window_signal_avg_snapshot_semantic_compress_sections_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_signal_avg_pre_send_overflow_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_signal_avg_pre_send_pressure_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_window_compression_snapshot_semantic_rate_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_compression_auto_limit_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_token_budget_avg_utilization_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_strategy_quality_first_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_strategy_hard_budget_rate_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_has_strategy_outcomes, true);
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_window_strategy_outcomes_hard_budget_followup_delta_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_window_strategy_outcomes_quality_first_followup_delta_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_window_strategy_outcomes_hard_budget_recovery_rate_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_window_strategy_outcomes_quality_first_improved_rate_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_window_strategy_outcomes_hard_budget_transition_count_type,
      ),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(
        statusPayload.status_context_engine_prompt_quality_window_strategy_outcomes_quality_first_transition_count_type,
      ),
    ),
    true,
  );
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_has_strategy_trends, true);
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_window_strategy_trends_short_window_size_type,
    "number",
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_strategy_trends_short_hard_budget_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_strategy_trends_short_avg_overflow_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_strategy_trends_short_avg_pressure_type),
    ),
    true,
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_window_strategy_trends_medium_window_size_type,
    "number",
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_strategy_trends_medium_hard_budget_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_strategy_trends_delta_hard_budget_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_strategy_trends_delta_avg_overflow_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_strategy_trends_delta_avg_pressure_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_has_pressure_trends, true);
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_window_pressure_trends_short_window_size_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_window_pressure_trends_short_entries_type,
    "number",
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_pressure_trends_short_semantic_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_pressure_trends_short_auto_limit_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_pressure_trends_short_avg_utilization_type),
    ),
    true,
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_window_pressure_trends_medium_window_size_type,
    "number",
  );
  assert.equal(
    statusPayload.status_context_engine_prompt_quality_window_pressure_trends_medium_entries_type,
    "number",
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_pressure_trends_medium_semantic_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_pressure_trends_medium_auto_limit_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_pressure_trends_medium_avg_utilization_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_pressure_trends_delta_semantic_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_pressure_trends_delta_auto_limit_rate_type),
    ),
    true,
  );
  assert.equal(
    ["number", "null"].includes(
      String(statusPayload.status_context_engine_prompt_quality_window_pressure_trends_delta_avg_utilization_type),
    ),
    true,
  );
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_has_degradation, true);
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_degradation_degraded_type, "boolean");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_degradation_reason_type, "string");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_degradation_threshold_overall_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_degradation_threshold_low_quality_rate_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_degradation_min_entries_type, "number");
  assert.equal(statusPayload.status_context_engine_prompt_quality_window_degradation_observed_entries_type, "number");
  assert.equal(
    ["number", "null"].includes(String(statusPayload.status_context_engine_prompt_quality_window_degradation_observed_overall_type)),
    true,
  );
  assert.equal(
    ["number", "null"].includes(String(statusPayload.status_context_engine_prompt_quality_window_degradation_observed_low_quality_rate_type)),
    true,
  );
  assert.equal(statusPayload.status_route_reason_type, "string");
  logStep("start-smoke-contract status-ts-rust", { attempts: statusAttempts });

  const statusWindowSizeResult = runContract("start-smoke-contract.mjs", "status-ts-rust-window-size", [
    "--repo-root",
    repoRoot,
    "--window-size",
    "7",
  ], {
    timeoutMs: 240_000,
  });
  const statusWindowSizePayload = parseJsonOutput(
    "start-smoke-contract status-ts-rust-window-size",
    statusWindowSizeResult.stdout,
  );
  assert.equal(statusWindowSizePayload.exit_code, 0);
  assert.equal(statusWindowSizePayload.status_json_parse_ok, true);
  assert.equal(statusWindowSizePayload.status_context_graph_cache_window_configured_size_type, "number");
  assert.equal(statusWindowSizePayload.status_context_graph_cache_window_configured_size_value, 7);
  assert.equal(
    statusWindowSizePayload.status_context_persistent_graph_index_window_configured_size_type,
    "number",
  );
  assert.equal(
    statusWindowSizePayload.status_context_persistent_graph_index_window_configured_size_value,
    7,
  );
  logStep("start-smoke-contract status-ts-rust-window-size");

  const statusNonRecoverableResult = runContract("start-smoke-contract.mjs", "status-nonrecoverable-tool-recovery", [
    "--repo-root",
    repoRoot,
  ], {
    timeoutMs: 240_000,
  });
  const statusNonRecoverablePayload = parseJsonOutput(
    "start-smoke-contract status-nonrecoverable-tool-recovery",
    statusNonRecoverableResult.stdout,
  );
  assert.equal(statusNonRecoverablePayload.exit_code, 0);
  assert.equal(statusNonRecoverablePayload.text_exit_code, 0);
  assert.equal(statusNonRecoverablePayload.status_json_parse_ok, true);
  assert.equal(statusNonRecoverablePayload.recovery_feedback_active, true);
  assert.equal(statusNonRecoverablePayload.recovery_feedback_stage, "ask_user");
  assert.equal(statusNonRecoverablePayload.recovery_feedback_recoverable, false);
  assert.equal(statusNonRecoverablePayload.recovery_feedback_requires_user_intervention, true);
  assert.equal(statusNonRecoverablePayload.recovery_feedback_same_tool_error_count, 3);
  assert.equal(statusNonRecoverablePayload.recovery_feedback_escalated, true);
  assert.equal(statusNonRecoverablePayload.recovery_feedback_escalation_reason, "same_tool_error_exhausted");
  assert.equal(statusNonRecoverablePayload.recovery_feedback_escalation_policy_version, "v1");
  assert.equal(statusNonRecoverablePayload.recovery_feedback_base_recovery_stage, "strategy_switch");
  assert.equal(statusNonRecoverablePayload.recovery_feedback_base_recommended_next_action, "switch_tool_strategy");
  assert.equal(statusNonRecoverablePayload.recovery_timeline_count, 2);
  assert.equal(typeof statusNonRecoverablePayload.recovery_timeline_latest_recovery_key, "string");
  assert.equal(statusNonRecoverablePayload.recovery_timeline_latest_active, true);
  assert.equal(statusNonRecoverablePayload.recovery_timeline_latest_consumed, false);
  assert.equal(statusNonRecoverablePayload.recovery_timeline_latest_stage, "ask_user");
  assert.equal(statusNonRecoverablePayload.recovery_timeline_latest_tool_name, "web_scan");
  assert.equal(statusNonRecoverablePayload.recovery_timeline_latest_same_tool_error_count, 3);
  assert.equal(statusNonRecoverablePayload.recovery_timeline_latest_escalated, true);
  assert.equal(statusNonRecoverablePayload.recovery_timeline_latest_escalation_reason, "same_tool_error_exhausted");
  assert.equal(statusNonRecoverablePayload.recovery_timeline_latest_escalation_policy_version, "v1");
  assert.equal(statusNonRecoverablePayload.recovery_timeline_latest_base_recovery_stage, "strategy_switch");
  assert.equal(
    statusNonRecoverablePayload.recovery_timeline_latest_base_recommended_next_action,
    "switch_tool_strategy",
  );
  assert.equal(statusNonRecoverablePayload.recovery_feedback_runtime_error_code, "CONFIG_MISSING");
  assert.equal(
    statusNonRecoverablePayload.recovery_feedback_runtime_action,
    "fix_config_or_switch_provider_and_check_status",
  );
  assert.equal(statusNonRecoverablePayload.recovery_feedback_runtime_retry_allowed, false);
  assert.equal(
    statusNonRecoverablePayload.recovery_feedback_runtime_commands,
    "grobot status --json|grobot status --probe --json",
  );
  assert.equal(statusNonRecoverablePayload.recovery_timeline_latest_runtime_error_code, "CONFIG_MISSING");
  assert.equal(
    statusNonRecoverablePayload.recovery_timeline_latest_runtime_action,
    "fix_config_or_switch_provider_and_check_status",
  );
  assert.equal(statusNonRecoverablePayload.recovery_timeline_previous_tool_name, "read");
  assert.equal(
    statusNonRecoverablePayload.recovery_health_latest_recovery_key,
    statusNonRecoverablePayload.recovery_timeline_latest_recovery_key,
  );
  assert.equal(statusNonRecoverablePayload.recovery_health_score, 36);
  assert.equal(statusNonRecoverablePayload.recovery_health_level, "risk");
  assert.equal(statusNonRecoverablePayload.recovery_health_reason, "active_nonrecoverable_recovery");
  assert.equal(
    statusNonRecoverablePayload.recovery_health_recommended_next_action,
    "ask_user_for_config_or_switch_provider",
  );
  assert.equal(statusNonRecoverablePayload.recovery_health_attention_source, "latest");
  assert.equal(
    statusNonRecoverablePayload.recovery_health_attention_recovery_key,
    statusNonRecoverablePayload.recovery_timeline_latest_recovery_key,
  );
  assert.equal(statusNonRecoverablePayload.recovery_health_attention_tool_name, "web_scan");
  assert.equal(statusNonRecoverablePayload.recovery_health_attention_requires_user_intervention, true);
  assert.equal(statusNonRecoverablePayload.recovery_health_attention_runtime_error_code, "CONFIG_MISSING");
  assert.equal(
    statusNonRecoverablePayload.recovery_health_attention_runtime_action,
    "fix_config_or_switch_provider_and_check_status",
  );
  assert.equal(statusNonRecoverablePayload.recovery_policy_version, "v1");
  assert.equal(statusNonRecoverablePayload.recovery_policy_timeline_max_entries, 20);
  assert.equal(statusNonRecoverablePayload.recovery_policy_escalation_strategy_switch_threshold, 2);
  assert.equal(statusNonRecoverablePayload.recovery_policy_escalation_ask_user_threshold, 3);
  assert.equal(statusNonRecoverablePayload.recovery_policy_escalation_environment_ask_user_threshold, 2);
  assert.equal(statusNonRecoverablePayload.recovery_policy_health_watch_threshold, 85);
  assert.equal(statusNonRecoverablePayload.recovery_policy_health_risk_threshold, 60);
  assert.equal(statusNonRecoverablePayload.recovery_readiness_status, "blocked");
  assert.equal(statusNonRecoverablePayload.recovery_readiness_ready, false);
  assert.equal(statusNonRecoverablePayload.recovery_readiness_auto_allowed, false);
  assert.equal(statusNonRecoverablePayload.recovery_readiness_operator_action_required, true);
  assert.equal(statusNonRecoverablePayload.recovery_readiness_policy_version, "v1");
  assert.equal(statusNonRecoverablePayload.recovery_readiness_watch_threshold, 85);
  assert.equal(statusNonRecoverablePayload.recovery_readiness_risk_threshold, 60);
  assert.equal(statusNonRecoverablePayload.recovery_readiness_attention_stage, "ask_user");
  assert.equal(statusNonRecoverablePayload.recovery_readiness_attention_runtime_error_code, "CONFIG_MISSING");
  assert.equal(
    statusNonRecoverablePayload.recovery_readiness_attention_runtime_action,
    "fix_config_or_switch_provider_and_check_status",
  );
  assert.equal(statusNonRecoverablePayload.recovery_gate_status, "fail");
  assert.equal(statusNonRecoverablePayload.recovery_gate_passed, false);
  assert.equal(statusNonRecoverablePayload.recovery_gate_blocking, true);
  assert.equal(statusNonRecoverablePayload.recovery_gate_severity, "error");
  assert.equal(statusNonRecoverablePayload.recovery_gate_reason, "blocked_operator_action_required");
  assert.equal(statusNonRecoverablePayload.recovery_gate_blocker_kind, "runtime_environment");
  assert.equal(statusNonRecoverablePayload.recovery_gate_blocker_code, "CONFIG_MISSING");
  assert.equal(
    statusNonRecoverablePayload.recovery_gate_blocker_action,
    "fix_config_or_switch_provider_and_check_status",
  );
  assert.equal(statusNonRecoverablePayload.recovery_gate_readiness_status, "blocked");
  assert.equal(statusNonRecoverablePayload.recovery_gate_auto_allowed, false);
  assert.equal(statusNonRecoverablePayload.recovery_gate_operator_action_required, true);
  assert.equal(statusNonRecoverablePayload.recovery_gate_policy_version, "v1");
  assert.equal(statusNonRecoverablePayload.recovery_gate_watch_threshold, 85);
  assert.equal(statusNonRecoverablePayload.recovery_gate_risk_threshold, 60);
  assert.equal(statusNonRecoverablePayload.recovery_gate_attention_stage, "ask_user");
  assert.equal(statusNonRecoverablePayload.recovery_gate_attention_runtime_error_code, "CONFIG_MISSING");
  assert.equal(
    statusNonRecoverablePayload.recovery_gate_attention_runtime_action,
    "fix_config_or_switch_provider_and_check_status",
  );
  assert.equal(statusNonRecoverablePayload.recovery_health_active_recovery_count, 1);
  assert.equal(statusNonRecoverablePayload.recovery_health_active_nonrecoverable_count, 1);
  assert.equal(statusNonRecoverablePayload.recovery_health_unconsumed_count, 2);
  assert.equal(statusNonRecoverablePayload.recovery_health_has_stuck_nonrecoverable, true);
  assert.equal(statusNonRecoverablePayload.surface_adaptation_active, false);
  assert.equal(
    statusNonRecoverablePayload.surface_adaptation_reason,
    "recovery_gate_runtime_environment_config_missing",
  );
  assert.equal(statusNonRecoverablePayload.surface_adaptation_from_profile, "coding");
  assert.equal(statusNonRecoverablePayload.surface_adaptation_applied_profile, "coding");
  assert.equal(statusNonRecoverablePayload.surface_adaptation_auto_adaptation_blocked, true);
  assert.equal(statusNonRecoverablePayload.surface_adaptation_recovery_recoverable, false);
  assert.equal(statusNonRecoverablePayload.text_has_requires_user_intervention, true);
  assert.equal(statusNonRecoverablePayload.text_has_auto_adaptation_blocked, true);
  assert.equal(statusNonRecoverablePayload.text_has_nonrecoverable_reason, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_timeline, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_feedback_runtime_environment, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_readiness_runtime_environment, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_gate_runtime_environment, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_health, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_policy, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_readiness, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_gate, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_feedback_escalation_tuple, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_timeline_escalation_tuple, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_readiness_thresholds, true);
  assert.equal(statusNonRecoverablePayload.text_has_recovery_gate_thresholds, true);
  logStep("start-smoke-contract status-nonrecoverable-tool-recovery");

  const statusBrowserEnvironmentRecoveryResult = runContract(
    "start-smoke-contract.mjs",
    "status-browser-environment-tool-recovery",
    [
      "--repo-root",
      repoRoot,
    ],
    {
      timeoutMs: 240_000,
    },
  );
  const statusBrowserEnvironmentRecoveryPayload = parseJsonOutput(
    "start-smoke-contract status-browser-environment-tool-recovery",
    statusBrowserEnvironmentRecoveryResult.stdout,
  );
  assert.equal(statusBrowserEnvironmentRecoveryPayload.exit_code, 0);
  assert.equal(statusBrowserEnvironmentRecoveryPayload.text_exit_code, 0);
  assert.equal(statusBrowserEnvironmentRecoveryPayload.status_json_parse_ok, true);
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_feedback_active, true);
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_feedback_stage, "ask_user");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_feedback_action, "request_environment_fix");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_feedback_recoverable, false);
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_feedback_requires_user_intervention, true);
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_feedback_same_tool_error_count, 2);
  assert.equal(
    statusBrowserEnvironmentRecoveryPayload.recovery_feedback_escalation_reason,
    "browser_environment_error_repeated",
  );
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_feedback_browser_error_code, "NO_EXTENSION");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_feedback_browser_action, "setup_and_doctor");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_feedback_browser_retry_allowed, false);
  assert.equal(
    statusBrowserEnvironmentRecoveryPayload.recovery_feedback_browser_commands,
    "grobot browser setup|grobot browser doctor",
  );
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_timeline_latest_stage, "ask_user");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_timeline_latest_tool_name, "web_scan");
  assert.equal(
    statusBrowserEnvironmentRecoveryPayload.recovery_timeline_latest_error_class,
    "browser_backend_result_error",
  );
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_timeline_latest_browser_error_code, "NO_EXTENSION");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_timeline_latest_browser_action, "setup_and_doctor");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_timeline_latest_browser_retry_allowed, false);
  assert.equal(
    statusBrowserEnvironmentRecoveryPayload.recovery_timeline_latest_browser_commands,
    "grobot browser setup|grobot browser doctor",
  );
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_health_attention_browser_error_code, "NO_EXTENSION");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_health_attention_browser_action, "setup_and_doctor");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_health_attention_browser_retry_allowed, false);
  assert.equal(
    statusBrowserEnvironmentRecoveryPayload.recovery_health_attention_browser_commands,
    "grobot browser setup|grobot browser doctor",
  );
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_health_latest_browser_error_code, "NO_EXTENSION");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_health_latest_browser_action, "setup_and_doctor");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_readiness_status, "blocked");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_readiness_operator_action_required, true);
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_readiness_attention_browser_error_code, "NO_EXTENSION");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_readiness_attention_browser_action, "setup_and_doctor");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_readiness_attention_browser_retry_allowed, false);
  assert.equal(
    statusBrowserEnvironmentRecoveryPayload.recovery_readiness_attention_browser_commands,
    "grobot browser setup|grobot browser doctor",
  );
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_gate_status, "fail");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_gate_reason, "blocked_operator_action_required");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_gate_blocker_kind, "browser_environment");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_gate_blocker_code, "NO_EXTENSION");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_gate_blocker_action, "setup_and_doctor");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_gate_attention_browser_error_code, "NO_EXTENSION");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_gate_attention_browser_action, "setup_and_doctor");
  assert.equal(statusBrowserEnvironmentRecoveryPayload.recovery_gate_attention_browser_retry_allowed, false);
  assert.equal(
    statusBrowserEnvironmentRecoveryPayload.recovery_gate_attention_browser_commands,
    "grobot browser setup|grobot browser doctor",
  );
  assert.equal(statusBrowserEnvironmentRecoveryPayload.text_has_recovery_feedback_browser_environment, true);
  assert.equal(statusBrowserEnvironmentRecoveryPayload.text_has_recovery_readiness_browser_environment, true);
  assert.equal(statusBrowserEnvironmentRecoveryPayload.text_has_recovery_gate_browser_environment, true);
  logStep("start-smoke-contract status-browser-environment-tool-recovery");

  const statusMcpEnvironmentRecoveryResult = runContract(
    "start-smoke-contract.mjs",
    "status-mcp-environment-tool-recovery",
    [
      "--repo-root",
      repoRoot,
    ],
    {
      timeoutMs: 240_000,
    },
  );
  const statusMcpEnvironmentRecoveryPayload = parseJsonOutput(
    "start-smoke-contract status-mcp-environment-tool-recovery",
    statusMcpEnvironmentRecoveryResult.stdout,
  );
  assert.equal(statusMcpEnvironmentRecoveryPayload.exit_code, 0);
  assert.equal(statusMcpEnvironmentRecoveryPayload.text_exit_code, 0);
  assert.equal(statusMcpEnvironmentRecoveryPayload.status_json_parse_ok, true);
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_active, true);
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_stage, "ask_user");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_action, "request_environment_fix");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_recoverable, false);
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_requires_user_intervention, true);
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_error_code, "SERVER_UNREADY");
  assert.equal(
    statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_action,
    "fix_server_readiness_and_check_status",
  );
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_retry_allowed, false);
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_commands, "grobot status --json");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_server, "grok-search");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_tool_name, "web_search");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_source_path, ".grobot/mcp.toml");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_ready_reason, "command_not_found");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_command, null);
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_available_servers, null);
  assert.equal(
    statusMcpEnvironmentRecoveryPayload.recovery_feedback_mcp_registry_paths,
    "~/.grobot/mcp/servers.toml|.grobot/mcp.toml",
  );
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_timeline_latest_stage, "ask_user");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_timeline_latest_tool_name, "mcp_call");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_timeline_latest_error_class, "mcp_server_unready");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_timeline_latest_mcp_error_code, "SERVER_UNREADY");
  assert.equal(
    statusMcpEnvironmentRecoveryPayload.recovery_timeline_latest_mcp_action,
    "fix_server_readiness_and_check_status",
  );
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_timeline_latest_mcp_retry_allowed, false);
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_health_attention_mcp_error_code, "SERVER_UNREADY");
  assert.equal(
    statusMcpEnvironmentRecoveryPayload.recovery_health_attention_mcp_action,
    "fix_server_readiness_and_check_status",
  );
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_readiness_status, "blocked");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_readiness_operator_action_required, true);
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_readiness_attention_mcp_error_code, "SERVER_UNREADY");
  assert.equal(
    statusMcpEnvironmentRecoveryPayload.recovery_readiness_attention_mcp_action,
    "fix_server_readiness_and_check_status",
  );
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_gate_status, "fail");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_gate_reason, "blocked_operator_action_required");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_gate_blocker_kind, "mcp_environment");
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_gate_blocker_code, "SERVER_UNREADY");
  assert.equal(
    statusMcpEnvironmentRecoveryPayload.recovery_gate_blocker_action,
    "fix_server_readiness_and_check_status",
  );
  assert.equal(statusMcpEnvironmentRecoveryPayload.recovery_gate_attention_mcp_error_code, "SERVER_UNREADY");
  assert.equal(
    statusMcpEnvironmentRecoveryPayload.recovery_gate_attention_mcp_action,
    "fix_server_readiness_and_check_status",
  );
  assert.equal(statusMcpEnvironmentRecoveryPayload.text_has_recovery_feedback_mcp_environment, true);
  assert.equal(statusMcpEnvironmentRecoveryPayload.text_has_recovery_readiness_mcp_environment, true);
  assert.equal(statusMcpEnvironmentRecoveryPayload.text_has_recovery_gate_mcp_environment, true);
  logStep("start-smoke-contract status-mcp-environment-tool-recovery");

  const statusNonRecoverableConsumedResult = runContract(
    "start-smoke-contract.mjs",
    "status-nonrecoverable-tool-recovery-consumed",
    [
      "--repo-root",
      repoRoot,
    ],
    {
      timeoutMs: 240_000,
    },
  );
  const statusNonRecoverableConsumedPayload = parseJsonOutput(
    "start-smoke-contract status-nonrecoverable-tool-recovery-consumed",
    statusNonRecoverableConsumedResult.stdout,
  );
  assert.equal(statusNonRecoverableConsumedPayload.exit_code, 0);
  assert.equal(statusNonRecoverableConsumedPayload.text_exit_code, 0);
  assert.equal(statusNonRecoverableConsumedPayload.status_json_parse_ok, true);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_feedback_active, false);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_feedback_reason, "consumed_nonrecoverable_intervention_prompted");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_feedback_recoverable, false);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_feedback_requires_user_intervention, true);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_feedback_consumed, true);
  assert.equal(
    statusNonRecoverableConsumedPayload.recovery_feedback_consumed_reason,
    "nonrecoverable_intervention_prompted",
  );
  assert.equal(statusNonRecoverableConsumedPayload.recovery_feedback_same_tool_error_count, 3);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_feedback_escalated, true);
  assert.equal(
    statusNonRecoverableConsumedPayload.recovery_feedback_escalation_reason,
    "same_tool_error_exhausted",
  );
  assert.equal(statusNonRecoverableConsumedPayload.recovery_feedback_escalation_policy_version, "v1");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_feedback_base_recovery_stage, "strategy_switch");
  assert.equal(
    statusNonRecoverableConsumedPayload.recovery_feedback_base_recommended_next_action,
    "switch_tool_strategy",
  );
  assert.equal(statusNonRecoverableConsumedPayload.recovery_timeline_count, 2);
  assert.equal(typeof statusNonRecoverableConsumedPayload.recovery_timeline_latest_recovery_key, "string");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_timeline_latest_active, false);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_timeline_latest_consumed, true);
  assert.equal(
    statusNonRecoverableConsumedPayload.recovery_timeline_latest_consumed_reason,
    "nonrecoverable_intervention_prompted",
  );
  assert.equal(statusNonRecoverableConsumedPayload.recovery_timeline_latest_stage, "ask_user");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_timeline_latest_tool_name, "web_scan");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_timeline_latest_same_tool_error_count, 3);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_timeline_latest_escalated, true);
  assert.equal(
    statusNonRecoverableConsumedPayload.recovery_timeline_latest_escalation_reason,
    "same_tool_error_exhausted",
  );
  assert.equal(statusNonRecoverableConsumedPayload.recovery_timeline_latest_escalation_policy_version, "v1");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_timeline_latest_base_recovery_stage, "strategy_switch");
  assert.equal(
    statusNonRecoverableConsumedPayload.recovery_timeline_latest_base_recommended_next_action,
    "switch_tool_strategy",
  );
  assert.equal(statusNonRecoverableConsumedPayload.recovery_timeline_previous_tool_name, "read");
  assert.equal(
    statusNonRecoverableConsumedPayload.recovery_health_latest_recovery_key,
    statusNonRecoverableConsumedPayload.recovery_timeline_latest_recovery_key,
  );
  assert.equal(statusNonRecoverableConsumedPayload.recovery_health_score, 96);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_health_level, "watch");
  assert.equal(
    statusNonRecoverableConsumedPayload.recovery_health_reason,
    "historical_unconsumed_recovery",
  );
  assert.equal(
    statusNonRecoverableConsumedPayload.recovery_health_recommended_next_action,
    "locate_path_with_glob_before_retry",
  );
  assert.equal(statusNonRecoverableConsumedPayload.recovery_health_attention_source, "historical_unconsumed");
  assert.equal(
    statusNonRecoverableConsumedPayload.recovery_health_attention_recovery_key,
    statusNonRecoverableConsumedPayload.recovery_timeline_previous_recovery_key,
  );
  assert.equal(statusNonRecoverableConsumedPayload.recovery_health_attention_tool_name, "read");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_health_attention_requires_user_intervention, false);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_policy_version, "v1");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_policy_timeline_max_entries, 20);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_policy_escalation_strategy_switch_threshold, 2);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_policy_escalation_ask_user_threshold, 3);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_policy_escalation_environment_ask_user_threshold, 2);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_policy_health_watch_threshold, 85);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_policy_health_risk_threshold, 60);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_readiness_status, "degraded");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_readiness_ready, false);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_readiness_auto_allowed, true);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_readiness_operator_action_required, false);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_readiness_policy_version, "v1");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_readiness_watch_threshold, 85);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_readiness_risk_threshold, 60);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_readiness_attention_stage, "local_fix");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_status, "warn");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_passed, true);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_blocking, false);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_severity, "warning");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_reason, "degraded_auto_recovery_allowed");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_readiness_status, "degraded");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_auto_allowed, true);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_operator_action_required, false);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_policy_version, "v1");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_watch_threshold, 85);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_risk_threshold, 60);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_gate_attention_stage, "local_fix");
  assert.equal(statusNonRecoverableConsumedPayload.recovery_health_active_recovery_count, 0);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_health_active_nonrecoverable_count, 0);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_health_unconsumed_count, 1);
  assert.equal(statusNonRecoverableConsumedPayload.recovery_health_has_stuck_nonrecoverable, false);
  assert.equal(statusNonRecoverableConsumedPayload.surface_adaptation_active, false);
  assert.equal(statusNonRecoverableConsumedPayload.surface_adaptation_reason, "consumed_nonrecoverable_intervention_prompted");
  assert.equal(statusNonRecoverableConsumedPayload.surface_adaptation_auto_adaptation_blocked, false);
  assert.equal(statusNonRecoverableConsumedPayload.surface_adaptation_recovery_recoverable, false);
  assert.equal(statusNonRecoverableConsumedPayload.text_has_consumed_nonrecoverable, true);
  assert.equal(statusNonRecoverableConsumedPayload.text_has_recovery_timeline, true);
  assert.equal(statusNonRecoverableConsumedPayload.text_has_recovery_health, true);
  assert.equal(statusNonRecoverableConsumedPayload.text_has_recovery_policy, true);
  assert.equal(statusNonRecoverableConsumedPayload.text_has_recovery_readiness, true);
  assert.equal(statusNonRecoverableConsumedPayload.text_has_recovery_gate, true);
  assert.equal(statusNonRecoverableConsumedPayload.text_has_recovery_feedback_escalation_tuple, true);
  assert.equal(statusNonRecoverableConsumedPayload.text_has_recovery_timeline_escalation_tuple, true);
  assert.equal(statusNonRecoverableConsumedPayload.text_has_recovery_readiness_thresholds, true);
  assert.equal(statusNonRecoverableConsumedPayload.text_has_recovery_gate_thresholds, true);
  logStep("start-smoke-contract status-nonrecoverable-tool-recovery-consumed");

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

  const recoveryGateModel = await startMockModelServer();
  try {
    const recoveryGateResult = await runContractAsync(
      "start-smoke-contract.mjs",
      "start-recovery-gate-blocks-surface-adaptation",
      ["--repo-root", repoRoot],
      {
        timeoutMs: 240_000,
        env: {
          ...process.env,
          GROBOT_BASE_URL: recoveryGateModel.baseUrl,
          GROBOT_API_KEY: "mock-runtime-key",
          GROBOT_MODEL: "mock-runtime-model",
          GROBOT_RUNTIME_HTTP_TIMEOUT_MS: "8000",
        },
      },
    );
    const recoveryGatePayload = parseJsonOutput(
      "start-smoke-contract start-recovery-gate-blocks-surface-adaptation",
      recoveryGateResult.stdout,
    );
    assert.equal(recoveryGatePayload.exit_code, 0);
    assert.equal(recoveryGatePayload.has_gate_blocked_surface, true);
    assert.equal(recoveryGatePayload.has_recovery_gate_blocked_event, true);
    assert.equal(recoveryGatePayload.has_recovery_gate_policy_context, true);
    assert.equal(recoveryGatePayload.has_no_auto_browser_adaptation, true);
    assert.equal(recoveryGatePayload.has_auto_adaptation_blocked, true);
    assert.equal(recoveryGatePayload.has_recoverable_latest_signal, true);
    const recoveryGateCalls = recoveryGateModel.getCalls();
    assert.equal(recoveryGateCalls.length >= 1, true);
    const recoveryGateLastCall = recoveryGateCalls[recoveryGateCalls.length - 1] ?? {};
    assert.equal(String(recoveryGateLastCall.prompt).includes("[Runtime Tool Recovery Hint]"), true);
    assert.equal(String(recoveryGateLastCall.prompt).includes("stage=strategy_switch"), true);
  } finally {
    await recoveryGateModel.close();
  }
  logStep("start-smoke-contract start-recovery-gate-blocks-surface-adaptation");

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
  assert.equal(String(toolCallFailurePayload.stderr).includes("class=tool_not_visible"), true);
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
  assert.equal(String(planModeFlowPayload.plan_active_id || "").length > 0, true);
  assert.equal(planModeFlowPayload.review_failed_marker_seen, true);
  assert.equal(planModeFlowPayload.review_failed_recommends_refine, true);
  assert.equal(planModeFlowPayload.review_failed_avoids_execute_recommendation, true);
  assert.equal(planModeFlowPayload.review_failed_validation_command_gap_seen, true);
  assert.equal(planModeFlowPayload.review_blocked_marker_seen, false);
  assert.equal(planModeFlowPayload.plan_cancelled_marker_seen, false);
  assert.equal(planModeFlowPayload.plan_final_status_line_seen, true);
  assert.equal(planModeFlowPayload.plan_open_script_notice_hidden, true);
  assert.equal(planModeFlowPayload.plan_status_preview_hides_machine_metadata, true);
  assert.equal(planModeFlowPayload.plan_draft_status_seen, true);
  assert.equal(planModeFlowPayload.plan_draft_status_has_path, true);
  assert.equal(planModeFlowPayload.plan_draft_status_has_read_only_boundary, true);
  assert.equal(planModeFlowPayload.plan_draft_status_has_refine_hint, true);
  assert.equal(planModeFlowPayload.plan_draft_status_avoids_legacy_empty_message, true);
  assert.equal(planModeFlowPayload.plan_enter_surface_seen, true);
  assert.equal(planModeFlowPayload.plan_enter_surface_has_path, true);
  assert.equal(planModeFlowPayload.plan_enter_surface_has_goal, true);
  assert.equal(planModeFlowPayload.plan_enter_surface_read_only_seen, true);
  assert.equal(planModeFlowPayload.plan_enter_surface_working_notice_seen, true);
  assert.equal(planModeFlowPayload.plan_enter_surface_hides_absolute_path, true);
  assert.equal(planModeFlowPayload.plan_status_preview_hides_required_placeholder, true);
  assert.equal(planModeFlowPayload.plan_current_display_seen, true);
  assert.equal(planModeFlowPayload.plan_current_display_has_plan_open_hint, true);
  assert.equal(planModeFlowPayload.plan_status_uses_relative_plan_file, true);
  assert.equal(planModeFlowPayload.plan_status_hides_absolute_plan_file, true);
  assert.equal(planModeFlowPayload.plan_status_omits_legacy_next_line, true);
  assert.equal(planModeFlowPayload.plan_status_omits_legacy_focus_line, true);
  assert.equal(planModeFlowPayload.plan_status_omits_quality_noise, true);
  assert.equal(planModeFlowPayload.plan_status_hides_redundant_stored_state, true);
  assert.equal(planModeFlowPayload.plan_status_next_line_avoids_reason_dump, true);
  assert.equal(planModeFlowPayload.plan_last_status, "review_failed");
  assert.equal(Number(planModeFlowPayload.plan_last_review_fail_count) >= 1, true);
  assert.equal(Number(planModeFlowPayload.plan_last_blocked_count), 0);
  assert.equal(planModeFlowPayload.events_has_plan_review_failed, true);
  assert.equal(planModeFlowPayload.events_has_plan_mode_cancelled, false);
  assert.equal(Number(planModeFlowPayload.events_count) >= 1, true);
  assert.equal(typeof planModeFlowPayload.events_path, "string");
  assert.equal(String(planModeFlowPayload.events_path).trim().length > 0, true);
  logStep("start-smoke-contract start-plan-mode-flow", {
    events: planModeFlowPayload.events_count,
  });

  const bareInteractiveFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-bare-interactive-session-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const bareInteractiveFlowPayload = parseJsonOutput(
    "start-smoke-contract start-bare-interactive-session-flow",
    bareInteractiveFlowResult.stdout,
  );
  assert.equal(bareInteractiveFlowPayload.exit_code, 0);
  assert.equal(bareInteractiveFlowPayload.has_start_banner, true);
  assert.equal(bareInteractiveFlowPayload.has_status_snapshot, true);
  assert.equal(bareInteractiveFlowPayload.has_no_command_hint, true);
  assert.equal(bareInteractiveFlowPayload.has_no_unsupported_command_error, true);
  logStep("start-smoke-contract start-bare-interactive-session-flow");

  const interactiveDiagnosticsCompactFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-interactive-diagnostics-compact-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const interactiveDiagnosticsCompactFlowPayload = parseJsonOutput(
    "start-smoke-contract start-interactive-diagnostics-compact-flow",
    interactiveDiagnosticsCompactFlowResult.stdout,
  );
  assert.equal(interactiveDiagnosticsCompactFlowPayload.exit_code, 0);
  assert.equal(interactiveDiagnosticsCompactFlowPayload.diagnostic_mode, "compact");
  assert.equal(interactiveDiagnosticsCompactFlowPayload.has_process_lines, false);
  assert.equal(interactiveDiagnosticsCompactFlowPayload.has_process_summary_lines, false);
  assert.equal(interactiveDiagnosticsCompactFlowPayload.stderr_has_event_lines, false);
  assert.equal(typeof interactiveDiagnosticsCompactFlowPayload.stderr_has_runtime_error, "boolean");
  logStep("start-smoke-contract start-interactive-diagnostics-compact-flow");

  const interactiveDiagnosticsVerboseFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-interactive-diagnostics-verbose-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const interactiveDiagnosticsVerboseFlowPayload = parseJsonOutput(
    "start-smoke-contract start-interactive-diagnostics-verbose-flow",
    interactiveDiagnosticsVerboseFlowResult.stdout,
  );
  assert.equal(interactiveDiagnosticsVerboseFlowPayload.exit_code, 0);
  assert.equal(interactiveDiagnosticsVerboseFlowPayload.diagnostic_mode, "verbose");
  assert.equal(interactiveDiagnosticsVerboseFlowPayload.has_process_lines, true);
  assert.equal(interactiveDiagnosticsVerboseFlowPayload.has_process_summary_lines, false);
  assert.equal(interactiveDiagnosticsVerboseFlowPayload.has_short_process_summary_code, false);
  assert.equal(interactiveDiagnosticsVerboseFlowPayload.stderr_has_event_lines, false);
  assert.equal(interactiveDiagnosticsVerboseFlowPayload.stderr_has_trace_lines, false);
  logStep("start-smoke-contract start-interactive-diagnostics-verbose-flow");

  const interactiveDiagnosticsTraceFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-interactive-diagnostics-trace-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const interactiveDiagnosticsTraceFlowPayload = parseJsonOutput(
    "start-smoke-contract start-interactive-diagnostics-trace-flow",
    interactiveDiagnosticsTraceFlowResult.stdout,
  );
  assert.equal(interactiveDiagnosticsTraceFlowPayload.exit_code, 0);
  assert.equal(interactiveDiagnosticsTraceFlowPayload.diagnostic_mode, "trace");
  assert.equal(interactiveDiagnosticsTraceFlowPayload.has_process_lines, false);
  assert.equal(interactiveDiagnosticsTraceFlowPayload.has_process_summary_lines, false);
  assert.equal(interactiveDiagnosticsTraceFlowPayload.stderr_has_event_lines, true);
  assert.equal(interactiveDiagnosticsTraceFlowPayload.stderr_has_trace_lines, true);
  logStep("start-smoke-contract start-interactive-diagnostics-trace-flow");

  const diagnosticsCommandFlows = [
    {
      contract: "start-interactive-diagnostics-plan-compact-flow",
      mode: "compact",
      markerKey: "has_plan_marker",
    },
    {
      contract: "start-interactive-diagnostics-plan-verbose-flow",
      mode: "verbose",
      markerKey: "has_plan_marker",
    },
    {
      contract: "start-interactive-diagnostics-skill-creator-compact-flow",
      mode: "compact",
      markerKey: "has_skill_creator_marker",
    },
    {
      contract: "start-interactive-diagnostics-skill-creator-verbose-flow",
      mode: "verbose",
      markerKey: "has_skill_creator_marker",
    },
    {
      contract: "start-interactive-diagnostics-user-command-compact-flow",
      mode: "compact",
      markerKey: "has_commands_marker",
    },
    {
      contract: "start-interactive-diagnostics-user-command-verbose-flow",
      mode: "verbose",
      markerKey: "has_commands_marker",
    },
  ];
  for (const flow of diagnosticsCommandFlows) {
    const diagnosticsFlowResult = runContract(
      "start-smoke-contract.mjs",
      flow.contract,
      [
        "--repo-root",
        repoRoot,
      ],
    );
    const diagnosticsFlowPayload = parseJsonOutput(
      `start-smoke-contract ${flow.contract}`,
      diagnosticsFlowResult.stdout,
    );
    assert.equal(diagnosticsFlowPayload.exit_code, 0);
    assert.equal(
      diagnosticsFlowPayload.has_process_lines,
      flow.mode === "verbose",
    );
    if (flow.mode === "compact") {
      assert.equal(diagnosticsFlowPayload.has_process_summary_lines, false);
    }
    if (diagnosticsFlowPayload.has_process_summary_lines) {
      assert.equal(diagnosticsFlowPayload.has_short_process_summary_code, true);
    }
    assert.equal(Boolean(diagnosticsFlowPayload[flow.markerKey]), true);
    if (flow.contract.includes("diagnostics-skill-creator")) {
      assert.equal(diagnosticsFlowPayload.skill_creator_surface_avoids_legacy_marker, true);
      assert.equal(diagnosticsFlowPayload.has_human_skill_creator_surface, true);
    }
    if (flow.contract.includes("diagnostics-user-command")) {
      assert.equal(diagnosticsFlowPayload.command_surface_avoids_legacy_marker, true);
      assert.equal(diagnosticsFlowPayload.has_human_created_command_surface, true);
    }
    if (flow.command_flow === "plan" || flow.contract.includes("diagnostics-plan")) {
      assert.equal(diagnosticsFlowPayload.has_entered_plan_mode_surface, true);
      assert.equal(diagnosticsFlowPayload.has_plan_entry_path_line, true);
      assert.equal(diagnosticsFlowPayload.has_plan_entry_goal_line, true);
      assert.equal(diagnosticsFlowPayload.has_plan_entry_read_only_line, true);
      assert.equal(diagnosticsFlowPayload.has_plan_entry_working_notice, true);
      assert.equal(diagnosticsFlowPayload.has_plan_draft_surface, true);
      assert.equal(diagnosticsFlowPayload.has_plan_draft_refine_hint, true);
      assert.equal(diagnosticsFlowPayload.plan_draft_avoids_legacy_empty_message, true);
    }
    if (flow.mode === "compact") {
      assert.equal(diagnosticsFlowPayload.stderr_has_event_lines, false);
    } else {
      assert.equal(diagnosticsFlowPayload.stderr_has_event_lines, false);
    }
    logStep(`start-smoke-contract ${flow.contract}`);
  }

  const startImOnlyRejectFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-im-only-reject-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const startImOnlyRejectFlowPayload = parseJsonOutput(
    "start-smoke-contract start-im-only-reject-flow",
    startImOnlyRejectFlowResult.stdout,
  );
  assert.equal(Number(startImOnlyRejectFlowPayload.exit_code), 2);
  assert.equal(startImOnlyRejectFlowPayload.has_im_only_error, true);
  assert.equal(startImOnlyRejectFlowPayload.has_im_only_hint_context, true);
  assert.equal(startImOnlyRejectFlowPayload.has_im_only_hint_bare, true);
  assert.equal(startImOnlyRejectFlowPayload.has_start_banner, false);
  logStep("start-smoke-contract start-im-only-reject-flow");

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
  assert.equal(sessionCommandFallbackPayload.has_resume_usage, true);
  assert.equal(sessionCommandFallbackPayload.has_rewind_usage, true);
  assert.equal(sessionCommandFallbackPayload.has_sessions_overview, true);
  assert.equal(sessionCommandFallbackPayload.has_session_title_main, true);
  assert.equal(sessionCommandFallbackPayload.has_session_title_untitled, true);
  assert.equal(sessionCommandFallbackPayload.has_status_snapshot, true);
  assert.equal(sessionCommandFallbackPayload.has_status_theme_set, true);
  assert.equal(sessionCommandFallbackPayload.has_status_layout_set, true);
  assert.equal(sessionCommandFallbackPayload.has_status_tokens_off, true);
  assert.equal(sessionCommandFallbackPayload.has_status_theme_current, true);
  assert.equal(sessionCommandFallbackPayload.has_status_layout_current, true);
  assert.equal(sessionCommandFallbackPayload.has_status_tokens_current_off, true);
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
  assert.equal(sessionMenuViewModelPayload.sessions_title, "会话管理");
  assert.equal(sessionMenuViewModelPayload.switch_title, "切换会话");
  assert.equal(sessionMenuViewModelPayload.continue_title, "从会话继续");
  assert.equal(sessionMenuViewModelPayload.resume_title, "恢复会话");
  assert.equal(sessionMenuViewModelPayload.rewind_title, "回退会话");
  assert.equal(sessionMenuViewModelPayload.sessions_has_create_item, true);
  assert.equal(sessionMenuViewModelPayload.continue_has_create_item, false);
  assert.equal(sessionMenuViewModelPayload.resume_has_create_item, false);
  assert.equal(sessionMenuViewModelPayload.rewind_has_create_item, false);
  assert.equal(sessionMenuViewModelPayload.sessions_summary_visible, true);
  assert.equal(sessionMenuViewModelPayload.switch_includes_session_key, true);
  assert.equal(sessionMenuViewModelPayload.resume_includes_session_key, true);
  assert.equal(sessionMenuViewModelPayload.rewind_includes_session_key, true);
  assert.equal(sessionMenuViewModelPayload.sessions_omits_session_key, true);
  assert.equal(sessionMenuViewModelPayload.continue_current_skip_hint, true);
  assert.equal(sessionMenuViewModelPayload.resume_current_hint, true);
  assert.equal(sessionMenuViewModelPayload.sessions_hint_is_reference_compact, true);
  assert.equal(sessionMenuViewModelPayload.switch_hint_is_reference_compact, true);
  assert.equal(sessionMenuViewModelPayload.continue_hint_is_reference_continue, true);
  assert.equal(sessionMenuViewModelPayload.resume_hint_is_reference_compact, true);
  assert.equal(sessionMenuViewModelPayload.rewind_hint_is_reference_compact, true);
  assert.equal(sessionMenuViewModelPayload.session_hints_omit_secondary_key_chords, true);
  assert.equal(sessionMenuViewModelPayload.session_menu_ops_cancel_is_silent_source, true);
  assert.equal(sessionMenuViewModelPayload.session_menu_ops_rewind_surface_avoids_legacy_marker, true);
  assert.equal(sessionMenuViewModelPayload.session_menu_ops_rewind_file_filter_prompt_is_human, true);
  assert.equal(sessionMenuViewModelPayload.session_ops_rewind_surface_avoids_legacy_marker, true);
  assert.equal(sessionMenuViewModelPayload.rewind_store_summary_avoids_legacy_marker, true);
  assert.equal(Number(sessionMenuViewModelPayload.sessions_initial_index), 1);
  assert.equal(Number(sessionMenuViewModelPayload.continue_initial_index), 0);
  assert.equal(Number(sessionMenuViewModelPayload.resume_initial_index), 0);
  assert.equal(Number(sessionMenuViewModelPayload.rewind_initial_index), 0);
  assert.equal(Number(sessionMenuViewModelPayload.sessions_item_count), 3);
  assert.equal(Number(sessionMenuViewModelPayload.continue_item_count), 2);
  assert.equal(Number(sessionMenuViewModelPayload.resume_item_count), 2);
  assert.equal(Number(sessionMenuViewModelPayload.rewind_item_count), 2);
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
  assert.equal(Number(planEventsReportPayload?.totals?.plan_phase_drafting_count) >= 1, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_phase_awaiting_decision_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_phase_applying_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_phase_unknown_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_recovered_stale_apply_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_turn_degraded_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_turn_failed_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_approval_blocked_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_apply_blocked_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_approval_blocked_quality_guard_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.plan_apply_blocked_quality_guard_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.policy_action_fail_count) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.policy_action_degrade_count) >= 0, true);
  assert.equal(isRecord(planEventsReportPayload?.totals?.block_reason_counts), true);
  assert.equal(isRecord(planEventsReportPayload?.totals?.policy_reason_counts), true);
  assert.equal(isRecord(planEventsReportPayload?.totals?.diagnostic_code_counts), true);
  assert.equal(Number(planEventsReportPayload?.totals?.review_failed_rate ?? 0) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.approval_blocked_rate ?? 0) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.apply_blocked_rate ?? 0) >= 0, true);
  assert.equal(Number(planEventsReportPayload?.totals?.quality_guard_blocked_rate ?? 0) >= 0, true);
  logStep("plan-events-report", {
    files: planEventsReportPayload?.totals?.files_count,
    events: planEventsReportPayload?.totals?.events_count,
    sessions: planEventsReportPayload?.totals?.sessions_count,
    phase_drafting: planEventsReportPayload?.totals?.plan_phase_drafting_count,
    phase_awaiting_decision: planEventsReportPayload?.totals?.plan_phase_awaiting_decision_count,
    apply_blocked: planEventsReportPayload?.totals?.plan_apply_blocked_count,
    approval_blocked: planEventsReportPayload?.totals?.plan_approval_blocked_count,
    policy_fail: planEventsReportPayload?.totals?.policy_action_fail_count,
    policy_degrade: planEventsReportPayload?.totals?.policy_action_degrade_count,
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
      planEventsPolicyGuardPayload?.policy_override_scope?.allow_fields?.includes("max_policy_fail_rate"),
      true,
    );
    assert.equal(
      planEventsPolicyGuardPayload?.policy_override_scope?.allow_fields?.includes("max_unknown_phase_rate"),
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

  const strictPolicyFailGuardResult = runCommand("npx", [
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
      GROBOT_PLAN_EVENTS_MAX_POLICY_FAIL_RATE: "0.01",
    },
  });
  assert.equal(strictPolicyFailGuardResult.code !== 0, true);
  const strictPolicyFailGuardPayload = parseJsonOutput(
    "plan-events-policy-guard strict policy-fail override",
    strictPolicyFailGuardResult.stdout,
  );
  assert.equal(strictPolicyFailGuardPayload?.status, "error");
  assert.equal(Number(strictPolicyFailGuardPayload?.violations_count) >= 1, true);
  assert.equal(
    Array.isArray(strictPolicyFailGuardPayload?.violations)
      && strictPolicyFailGuardPayload.violations.some((line) => String(line).includes("max_policy_fail_rate 0.01")),
    true,
  );
  assert.equal(
    Number(strictPolicyFailGuardPayload?.policy_overrides?.max_policy_fail_rate),
    0.01,
  );
  logStep("plan-events-policy-guard strict-policy-fail-override");

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
  assert.equal(mcpInstructionFlowPayload.strict_failure_exit_code, 1);
  assert.equal(mcpInstructionFlowPayload.strict_failure_human_surface, true);
  assert.equal(mcpInstructionFlowPayload.strict_failure_avoids_machine_surface, true);
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
    Number(preSendHeadTrimPayload.prompt_prepared_recent_trim_rows) >= 0,
    true,
  );
  assert.equal(
    Number(preSendHeadTrimPayload.prompt_prepared_snapshot_trim_sections) >= 0,
    true,
  );
  assert.equal(
    Number(preSendHeadTrimPayload.prompt_prepared_snapshot_semantic_compress_sections) >= 0,
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

  const qualityGuardFlowResult = runContract("start-smoke-contract.mjs", "start-context-quality-guard-flow", [
    "--repo-root",
    repoRoot,
  ]);
  const qualityGuardFlowPayload = parseJsonOutput(
    "start-smoke-contract start-context-quality-guard-flow",
    qualityGuardFlowResult.stdout,
  );
  assert.equal(
    [0, 1].includes(Number(qualityGuardFlowPayload.exit_code)),
    true,
  );
  assert.equal(qualityGuardFlowPayload.quality_guard_seen, true);
  assert.equal(String(qualityGuardFlowPayload.quality_guard_stage), "minimal");
  assert.equal(
    ["overall_below_threshold", "low_quality_rate_above_threshold"].includes(String(qualityGuardFlowPayload.quality_guard_reason)),
    true,
  );
  assert.equal(String(qualityGuardFlowPayload.prompt_prepared_quality_guard), "true");
  logStep("start-smoke-contract start-context-quality-guard-flow");

  const memoryDecayAutotuneQualityFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-context-memory-decay-autotune-quality-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const memoryDecayAutotuneQualityFlowPayload = parseJsonOutput(
    "start-smoke-contract start-context-memory-decay-autotune-quality-flow",
    memoryDecayAutotuneQualityFlowResult.stdout,
  );
  assert.equal(
    [0, 1].includes(Number(memoryDecayAutotuneQualityFlowPayload.start_exit_code)),
    true,
  );
  assert.equal(
    [0, 1].includes(Number(memoryDecayAutotuneQualityFlowPayload.status_exit_code)),
    true,
  );
  assert.equal(memoryDecayAutotuneQualityFlowPayload.maintenance_quality_signal_logged, true);
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.maintenance_autotune_quality_reason_seen,
    true,
  );
  assert.equal(memoryDecayAutotuneQualityFlowPayload.status_json_parse_ok, true);
  assert.equal(memoryDecayAutotuneQualityFlowPayload.status_memory_orchestrator_present, true);
  assert.equal(memoryDecayAutotuneQualityFlowPayload.status_memory_autotune_present, true);
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_strategy_autotune_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_autotune_quality_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_strategy_autotune_quality_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_strategy_autotune_profile_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_strategy_autotune_pending_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_strategy_autotune_outcome_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_autotune_reason_has_quality_tighten,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_strategy_autotune_reason_has_quality_tighten,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_decay_max_rows_tightened,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_decay_confidence_tightened,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_strategy_budget_ratio_tightened,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.status_memory_strategy_section_tightened,
    true,
  );
  assert.equal(memoryDecayAutotuneQualityFlowPayload.state_exists, true);
  assert.equal(memoryDecayAutotuneQualityFlowPayload.state_adaptive_updates_increased, true);
  assert.equal(memoryDecayAutotuneQualityFlowPayload.state_quality_ema_present, true);
  assert.equal(memoryDecayAutotuneQualityFlowPayload.state_last_reason_has_quality_tighten, true);
  assert.equal(memoryDecayAutotuneQualityFlowPayload.strategy_state_exists, true);
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.strategy_state_adaptive_updates_increased,
    true,
  );
  assert.equal(memoryDecayAutotuneQualityFlowPayload.strategy_state_quality_ema_present, true);
  assert.equal(memoryDecayAutotuneQualityFlowPayload.strategy_state_profile_fields_present, true);
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.strategy_state_pending_outcome_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityFlowPayload.strategy_state_last_reason_has_quality_tighten,
    true,
  );
  logStep("start-smoke-contract start-context-memory-decay-autotune-quality-flow");

  const memoryDecayAutotuneQualityRelaxFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-context-memory-decay-autotune-quality-relax-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const memoryDecayAutotuneQualityRelaxFlowPayload = parseJsonOutput(
    "start-smoke-contract start-context-memory-decay-autotune-quality-relax-flow",
    memoryDecayAutotuneQualityRelaxFlowResult.stdout,
  );
  assert.equal(
    [0, 1].includes(Number(memoryDecayAutotuneQualityRelaxFlowPayload.start_exit_code)),
    true,
  );
  assert.equal(
    [0, 1].includes(Number(memoryDecayAutotuneQualityRelaxFlowPayload.status_exit_code)),
    true,
  );
  assert.equal(memoryDecayAutotuneQualityRelaxFlowPayload.maintenance_quality_signal_logged, true);
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.maintenance_autotune_quality_reason_seen,
    true,
  );
  assert.equal(memoryDecayAutotuneQualityRelaxFlowPayload.status_json_parse_ok, true);
  assert.equal(memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_orchestrator_present, true);
  assert.equal(memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_autotune_present, true);
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_strategy_autotune_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_autotune_quality_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_strategy_autotune_quality_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_strategy_autotune_profile_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_strategy_autotune_pending_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_strategy_autotune_outcome_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_autotune_reason_has_quality_relax,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_strategy_autotune_reason_has_quality_relax,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_decay_max_rows_relaxed,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_decay_confidence_relaxed,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_strategy_budget_ratio_relaxed,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.status_memory_strategy_section_relaxed,
    true,
  );
  assert.equal(memoryDecayAutotuneQualityRelaxFlowPayload.state_exists, true);
  assert.equal(memoryDecayAutotuneQualityRelaxFlowPayload.state_adaptive_updates_increased, true);
  assert.equal(memoryDecayAutotuneQualityRelaxFlowPayload.state_quality_ema_present, true);
  assert.equal(memoryDecayAutotuneQualityRelaxFlowPayload.state_last_reason_has_quality_relax, true);
  assert.equal(memoryDecayAutotuneQualityRelaxFlowPayload.strategy_state_exists, true);
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.strategy_state_adaptive_updates_increased,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.strategy_state_quality_ema_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.strategy_state_profile_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.strategy_state_pending_outcome_fields_present,
    true,
  );
  assert.equal(
    memoryDecayAutotuneQualityRelaxFlowPayload.strategy_state_last_reason_has_quality_relax,
    true,
  );
  logStep("start-smoke-contract start-context-memory-decay-autotune-quality-relax-flow");

  const memoryDecayAutotuneHysteresisFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-context-memory-decay-autotune-hysteresis-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const memoryDecayAutotuneHysteresisFlowPayload = parseJsonOutput(
    "start-smoke-contract start-context-memory-decay-autotune-hysteresis-flow",
    memoryDecayAutotuneHysteresisFlowResult.stdout,
  );
  assert.equal(
    [0, 1].includes(Number(memoryDecayAutotuneHysteresisFlowPayload.first_round_start_exit_code)),
    true,
  );
  assert.equal(
    [0, 1].includes(Number(memoryDecayAutotuneHysteresisFlowPayload.first_round_status_exit_code)),
    true,
  );
  assert.equal(memoryDecayAutotuneHysteresisFlowPayload.first_round_has_quality_tighten, true);
  assert.equal(
    Number(memoryDecayAutotuneHysteresisFlowPayload.low_rounds_executed) >= 1,
    true,
  );
  assert.equal(memoryDecayAutotuneHysteresisFlowPayload.no_early_relax, true);
  assert.equal(memoryDecayAutotuneHysteresisFlowPayload.updates_monotonic, true);
  const hysteresisRelaxSeen = Boolean(memoryDecayAutotuneHysteresisFlowPayload.relax_seen);
  if (hysteresisRelaxSeen) {
    assert.equal(
      Number(memoryDecayAutotuneHysteresisFlowPayload.relax_round_index) >= 2,
      true,
    );
    assert.equal(memoryDecayAutotuneHysteresisFlowPayload.relax_rows_expanded, true);
    assert.equal(memoryDecayAutotuneHysteresisFlowPayload.relax_confidence_relaxed, true);
  } else {
    assert.equal(
      memoryDecayAutotuneHysteresisFlowPayload.final_quality_relax_window_reached,
      true,
    );
  }
  logStep("start-smoke-contract start-context-memory-decay-autotune-hysteresis-flow");

  const graphAutotuneFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-context-graph-quality-autotune-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const graphAutotuneFlowPayload = parseJsonOutput(
    "start-smoke-contract start-context-graph-quality-autotune-flow",
    graphAutotuneFlowResult.stdout,
  );
  assert.equal(
    [0, 1].includes(Number(graphAutotuneFlowPayload.exit_code)),
    true,
  );
  assert.equal(graphAutotuneFlowPayload.graph_autotune_seen, true);
  assert.equal(
    ["upshift", "mixed"].includes(String(graphAutotuneFlowPayload.graph_autotune_action)),
    true,
  );
  assert.equal(
    String(graphAutotuneFlowPayload.graph_autotune_suppressed),
    "none",
  );
  assert.equal(
    Number(graphAutotuneFlowPayload.graph_autotune_dep_rows_to)
      >= Number(graphAutotuneFlowPayload.graph_autotune_dep_rows_from),
    true,
  );
  assert.equal(
    Number(graphAutotuneFlowPayload.graph_autotune_symbol_rows_to)
      >= Number(graphAutotuneFlowPayload.graph_autotune_symbol_rows_from),
    true,
  );
  assert.equal(
    Number(graphAutotuneFlowPayload.graph_autotune_entries) >= 2,
    true,
  );
  assert.equal(
    Number(graphAutotuneFlowPayload.graph_autotune_quality_entries) >= 2,
    true,
  );
  assert.equal(
    ["adaptive_ewma", "state_reuse"].includes(
      String(graphAutotuneFlowPayload.graph_autotune_adaptive_source),
    ),
    true,
  );
  assert.equal(
    ["true", "false"].includes(
      String(graphAutotuneFlowPayload.graph_autotune_adaptive_updated),
    ),
    true,
  );
  assert.equal(Number.isFinite(Number(graphAutotuneFlowPayload.graph_autotune_adaptive_alpha)), true);
  assert.equal(Number.isFinite(Number(graphAutotuneFlowPayload.graph_autotune_adaptive_updates)), true);
  assert.equal(
    Number(graphAutotuneFlowPayload.graph_autotune_adaptive_cache_threshold) > 0,
    true,
  );
  assert.equal(
    Number(graphAutotuneFlowPayload.graph_autotune_adaptive_parsed_max) > 0,
    true,
  );
  assert.equal(
    Number(graphAutotuneFlowPayload.graph_autotune_adaptive_reused_min) >= 0,
    true,
  );
  assert.equal(
    Number(graphAutotuneFlowPayload.graph_autotune_adaptive_removed_max) > 0,
    true,
  );
  assert.equal(
    ["adaptive_action_ewma", "adaptive_action_ewma_guarded", "state_reuse"].includes(
      String(graphAutotuneFlowPayload.graph_autotune_adaptive_action_source),
    ),
    true,
  );
  assert.equal(
    ["true", "false"].includes(
      String(graphAutotuneFlowPayload.graph_autotune_adaptive_action_updated),
    ),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneFlowPayload.graph_autotune_adaptive_action_scale)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneFlowPayload.graph_autotune_adaptive_action_updates)),
    true,
  );
  logStep("start-smoke-contract start-context-graph-quality-autotune-flow");

  const graphAutotuneHysteresisFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-context-graph-quality-autotune-hysteresis-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const graphAutotuneHysteresisFlowPayload = parseJsonOutput(
    "start-smoke-contract start-context-graph-quality-autotune-hysteresis-flow",
    graphAutotuneHysteresisFlowResult.stdout,
  );
  assert.equal(
    [0, 1].includes(Number(graphAutotuneHysteresisFlowPayload.exit_code)),
    true,
  );
  assert.equal(graphAutotuneHysteresisFlowPayload.graph_autotune_seen, true);
  assert.equal(
    String(graphAutotuneHysteresisFlowPayload.graph_autotune_action),
    "none",
  );
  assert.equal(
    ["flip_hold", "downshift_warmup"].includes(
      String(graphAutotuneHysteresisFlowPayload.graph_autotune_suppressed),
    ),
    true,
  );
  assert.equal(
    Number(graphAutotuneHysteresisFlowPayload.graph_autotune_dep_rows_to),
    Number(graphAutotuneHysteresisFlowPayload.graph_autotune_dep_rows_from),
  );
  assert.equal(
    Number(graphAutotuneHysteresisFlowPayload.graph_autotune_symbol_rows_to),
    Number(graphAutotuneHysteresisFlowPayload.graph_autotune_symbol_rows_from),
  );
  assert.equal(
    ["adaptive_ewma", "state_reuse"].includes(
      String(graphAutotuneHysteresisFlowPayload.graph_autotune_adaptive_source),
    ),
    true,
  );
  assert.equal(
    ["true", "false"].includes(
      String(graphAutotuneHysteresisFlowPayload.graph_autotune_adaptive_updated),
    ),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneHysteresisFlowPayload.graph_autotune_adaptive_alpha)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneHysteresisFlowPayload.graph_autotune_adaptive_updates)),
    true,
  );
  assert.equal(
    ["adaptive_action_ewma", "adaptive_action_ewma_guarded", "state_reuse"].includes(
      String(graphAutotuneHysteresisFlowPayload.graph_autotune_adaptive_action_source),
    ),
    true,
  );
  assert.equal(
    ["true", "false"].includes(
      String(graphAutotuneHysteresisFlowPayload.graph_autotune_adaptive_action_updated),
    ),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneHysteresisFlowPayload.graph_autotune_adaptive_action_scale)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneHysteresisFlowPayload.graph_autotune_adaptive_action_updates)),
    true,
  );
  logStep("start-smoke-contract start-context-graph-quality-autotune-hysteresis-flow");

  const graphAutotuneAdaptiveSequenceFlowResult = runContract(
    "start-smoke-contract.mjs",
    "start-context-graph-quality-autotune-adaptive-sequence-flow",
    [
      "--repo-root",
      repoRoot,
    ],
  );
  const graphAutotuneAdaptiveSequenceFlowPayload = parseJsonOutput(
    "start-smoke-contract start-context-graph-quality-autotune-adaptive-sequence-flow",
    graphAutotuneAdaptiveSequenceFlowResult.stdout,
  );
  assert.equal(
    [0, 1].includes(Number(graphAutotuneAdaptiveSequenceFlowPayload.first_exit_code)),
    true,
  );
  assert.equal(
    [0, 1].includes(Number(graphAutotuneAdaptiveSequenceFlowPayload.second_exit_code)),
    true,
  );
  assert.equal(
    [0, 1].includes(Number(graphAutotuneAdaptiveSequenceFlowPayload.third_exit_code)),
    true,
  );
  assert.equal(
    graphAutotuneAdaptiveSequenceFlowPayload.first_state_present,
    true,
  );
  assert.equal(
    graphAutotuneAdaptiveSequenceFlowPayload.second_state_present,
    true,
  );
  assert.equal(
    graphAutotuneAdaptiveSequenceFlowPayload.third_state_present,
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.first_state_adaptive_updates)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_updates)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.third_state_adaptive_updates)),
    true,
  );
  assert.equal(
    Number(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_updates)
      > Number(graphAutotuneAdaptiveSequenceFlowPayload.first_state_adaptive_updates),
    true,
  );
  assert.equal(
    Number(graphAutotuneAdaptiveSequenceFlowPayload.third_state_adaptive_updates)
      >= Number(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_updates),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.first_state_adaptive_cache_threshold)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_cache_threshold)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.third_state_adaptive_cache_threshold)),
    true,
  );
  assert.equal(
    Number(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_cache_threshold)
      < Number(graphAutotuneAdaptiveSequenceFlowPayload.first_state_adaptive_cache_threshold),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.first_state_adaptive_alpha)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_alpha)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.third_state_adaptive_alpha)),
    true,
  );
  assert.equal(
    ["adaptive_ewma", "state_reuse"].includes(
      String(graphAutotuneAdaptiveSequenceFlowPayload.first_state_adaptive_source),
    ),
    true,
  );
  assert.equal(
    ["adaptive_ewma", "state_reuse"].includes(
      String(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_source),
    ),
    true,
  );
  assert.equal(
    ["adaptive_ewma", "state_reuse"].includes(
      String(graphAutotuneAdaptiveSequenceFlowPayload.third_state_adaptive_source),
    ),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.first_state_adaptive_action_scale)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_action_scale)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.third_state_adaptive_action_scale)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.first_state_adaptive_action_updates)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_action_updates)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.third_state_adaptive_action_updates)),
    true,
  );
  assert.equal(
    Number(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_action_updates)
      >= Number(graphAutotuneAdaptiveSequenceFlowPayload.first_state_adaptive_action_updates),
    true,
  );
  assert.equal(
    Number(graphAutotuneAdaptiveSequenceFlowPayload.third_state_adaptive_action_updates)
      >= Number(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_action_updates),
    true,
  );
  assert.equal(
    ["adaptive_action_ewma", "adaptive_action_ewma_guarded", "state_reuse", "bootstrap"].includes(
      String(graphAutotuneAdaptiveSequenceFlowPayload.first_state_adaptive_action_source),
    ),
    true,
  );
  assert.equal(
    ["adaptive_action_ewma", "adaptive_action_ewma_guarded", "state_reuse", "bootstrap"].includes(
      String(graphAutotuneAdaptiveSequenceFlowPayload.second_state_adaptive_action_source),
    ),
    true,
  );
  assert.equal(
    ["adaptive_action_ewma", "adaptive_action_ewma_guarded", "state_reuse", "bootstrap"].includes(
      String(graphAutotuneAdaptiveSequenceFlowPayload.third_state_adaptive_action_source),
    ),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.second_minus_first_action_scale)),
    true,
  );
  assert.equal(
    Number.isFinite(Number(graphAutotuneAdaptiveSequenceFlowPayload.third_minus_second_action_scale)),
    true,
  );
  assert.equal(
    Math.abs(Number(graphAutotuneAdaptiveSequenceFlowPayload.second_minus_first_action_scale)) <= 0.29,
    true,
  );
  assert.equal(
    Math.abs(Number(graphAutotuneAdaptiveSequenceFlowPayload.third_minus_second_action_scale)) <= 0.29,
    true,
  );
  logStep("start-smoke-contract start-context-graph-quality-autotune-adaptive-sequence-flow");

  const memoryLegacyFallbackResult = runContract(
    "start-smoke-contract.mjs",
    "status-ts-rust-memory-legacy-fallback",
    ["--repo-root", repoRoot],
  );
  const memoryLegacyFallbackPayload = parseJsonOutput(
    "start-smoke-contract status-ts-rust-memory-legacy-fallback",
    memoryLegacyFallbackResult.stdout,
  );
  assert.equal(memoryLegacyFallbackPayload.status_json_parse_ok, true);
  assert.equal(
    String(memoryLegacyFallbackPayload.graph_autotune_last_reason),
    "legacy_graph_state_seed",
  );
  assert.equal(
    Number(memoryLegacyFallbackPayload.graph_autotune_hold_turns_remaining),
    7,
  );
  assert.equal(
    String(memoryLegacyFallbackPayload.graph_autotune_persistence_domain),
    "memory",
  );
  assert.equal(String(memoryLegacyFallbackPayload.prompt_guard_floor_stage), "forced");
  assert.equal(Number(memoryLegacyFallbackPayload.prompt_guard_degraded_streak), 11);
  assert.equal(
    String(memoryLegacyFallbackPayload.prompt_guard_last_reason),
    "legacy_prompt_guard_seed",
  );
  assert.equal(
    String(memoryLegacyFallbackPayload.prompt_guard_persistence_domain),
    "memory",
  );
  logStep("start-smoke-contract status-ts-rust-memory-legacy-fallback");

  const runtimeDescribeUnavailableResult = runContract(
    "start-smoke-contract.mjs",
    "status-runtime-describe-unavailable",
    ["--repo-root", repoRoot],
  );
  const runtimeDescribeUnavailablePayload = parseJsonOutput(
    "start-smoke-contract status-runtime-describe-unavailable",
    runtimeDescribeUnavailableResult.stdout,
  );
  assert.equal(runtimeDescribeUnavailablePayload.exit_code, 0);
  assert.equal(runtimeDescribeUnavailablePayload.json_exit_code, 0);
  assert.equal(runtimeDescribeUnavailablePayload.status_json_parse_ok, true);
  assert.equal(runtimeDescribeUnavailablePayload.has_gateway_fallback_projection, true);
  assert.equal(runtimeDescribeUnavailablePayload.has_gateway_fallback_suppressed_none, false);
  assert.equal(runtimeDescribeUnavailablePayload.has_gateway_fallback_drift_args_none, true);
  assert.equal(runtimeDescribeUnavailablePayload.has_unavailable_suppressed_args, false);
  assert.equal(runtimeDescribeUnavailablePayload.has_unavailable_describe_reason, true);
  assert.equal(runtimeDescribeUnavailablePayload.quality_status, "fail");
  assert.equal(runtimeDescribeUnavailablePayload.quality_schema_version, 1);
  assert.equal(runtimeDescribeUnavailablePayload.quality_runtime_binary_exists, false);
  assert.equal(runtimeDescribeUnavailablePayload.quality_runtime_health_ok, false);
  assert.equal(runtimeDescribeUnavailablePayload.quality_runtime_describe_source, "start-default");
  assert.equal(runtimeDescribeUnavailablePayload.quality_schema_budget_status, "passed");
  assert.equal(runtimeDescribeUnavailablePayload.quality_action_family, "runtime_environment");
  assert.equal(runtimeDescribeUnavailablePayload.quality_action_reason, "runtime_binary_missing");
  assert.equal(runtimeDescribeUnavailablePayload.quality_action_required, "build_runtime_binary");
  assert.equal(runtimeDescribeUnavailablePayload.quality_actionable_next_step_has_runtime_status, true);
  assert.equal(runtimeDescribeUnavailablePayload.quality_failure_has_runtime_binary_missing, true);
  assert.equal(runtimeDescribeUnavailablePayload.quality_failure_has_runtime_health_failed, true);
  assert.equal(runtimeDescribeUnavailablePayload.quality_warning_has_describe_fallback, true);
  assert.equal(runtimeDescribeUnavailablePayload.text_has_quality_fail, true);
  logStep("start-smoke-contract status-runtime-describe-unavailable");

  const startRuntimeDescribeFallbackDiagnosticResult = runContract(
    "start-smoke-contract.mjs",
    "start-runtime-describe-fallback-diagnostic",
    ["--repo-root", repoRoot],
  );
  const startRuntimeDescribeFallbackDiagnosticPayload = parseJsonOutput(
    "start-smoke-contract start-runtime-describe-fallback-diagnostic",
    startRuntimeDescribeFallbackDiagnosticResult.stdout,
  );
  assert.equal(startRuntimeDescribeFallbackDiagnosticPayload.exit_code, 0);
  assert.equal(startRuntimeDescribeFallbackDiagnosticPayload.has_runtime_tools_fallback_surface, true);
  assert.equal(startRuntimeDescribeFallbackDiagnosticPayload.compact_avoids_tool_surface_event, true);
  assert.equal(startRuntimeDescribeFallbackDiagnosticPayload.compact_avoids_enabled_tools_source_field, true);
  assert.equal(startRuntimeDescribeFallbackDiagnosticPayload.has_describe_reason, true);
  assert.equal(startRuntimeDescribeFallbackDiagnosticPayload.has_status_json_hint, true);
  assert.equal(startRuntimeDescribeFallbackDiagnosticPayload.compact_avoids_fallback_manifest_field, true);
  assert.equal(startRuntimeDescribeFallbackDiagnosticPayload.compact_avoids_schema_profiles_field, true);
  logStep("start-smoke-contract start-runtime-describe-fallback-diagnostic");

  const runtimeDescribeInvalidSchemaStatusResult = runContract(
    "start-smoke-contract.mjs",
    "status-runtime-describe-invalid-schema-profiles",
    ["--repo-root", repoRoot],
  );
  const runtimeDescribeInvalidSchemaStatusPayload = parseJsonOutput(
    "start-smoke-contract status-runtime-describe-invalid-schema-profiles",
    runtimeDescribeInvalidSchemaStatusResult.stdout,
  );
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.exit_code, 0);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.json_exit_code, 0);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.status_json_parse_ok, true);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.has_gateway_fallback_projection, true);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.has_start_default_source, true);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.has_invalid_schema_reason, true);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_status, "fail");
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_schema_version, 1);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_runtime_binary_exists, true);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_runtime_health_ok, false);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_runtime_describe_source, "start-default");
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_schema_budget_status, "passed");
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_action_family, "runtime_environment");
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_action_reason, "runtime_health_failed");
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_action_required, "check_runtime_health");
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_actionable_next_step_has_runtime_status, true);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_failure_has_runtime_health_failed, true);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.quality_warning_has_describe_fallback, true);
  assert.equal(runtimeDescribeInvalidSchemaStatusPayload.text_has_quality_fail, true);
  logStep("start-smoke-contract status-runtime-describe-invalid-schema-profiles");

  const runtimeDescribeInvalidSchemaStartResult = runContract(
    "start-smoke-contract.mjs",
    "start-runtime-describe-invalid-schema-profiles",
    ["--repo-root", repoRoot],
  );
  const runtimeDescribeInvalidSchemaStartPayload = parseJsonOutput(
    "start-smoke-contract start-runtime-describe-invalid-schema-profiles",
    runtimeDescribeInvalidSchemaStartResult.stdout,
  );
  assert.equal(runtimeDescribeInvalidSchemaStartPayload.exit_code, 0);
  assert.equal(runtimeDescribeInvalidSchemaStartPayload.has_runtime_tools_fallback_surface, true);
  assert.equal(runtimeDescribeInvalidSchemaStartPayload.compact_avoids_tool_surface_event, true);
  assert.equal(runtimeDescribeInvalidSchemaStartPayload.compact_avoids_enabled_tools_source_field, true);
  assert.equal(runtimeDescribeInvalidSchemaStartPayload.has_invalid_schema_reason, true);
  assert.equal(runtimeDescribeInvalidSchemaStartPayload.has_status_json_hint, true);
  assert.equal(runtimeDescribeInvalidSchemaStartPayload.compact_avoids_fallback_manifest_field, true);
  assert.equal(runtimeDescribeInvalidSchemaStartPayload.compact_avoids_schema_profiles_field, true);
  logStep("start-smoke-contract start-runtime-describe-invalid-schema-profiles");

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
    "runtime-tool-recovery-readiness-contract.ts",
    "bridge-plan-failure-policy-contract.ts",
    "bridge-plan-apply-failure-contract.mjs",
    "bridge-cli-contract.mjs",
    "bridge-error-codes-schema-contract.mjs",
    "plan-events-policy-guard-contract.mjs",
    "run-start-plan-failure-policy-contract.ts",
    "run-start-slash-suggestions-contract.ts",
    "ask-user-tool-contract.ts",
    "ga-skill-prompt-contract.ts",
    "dev-cli-interactive-frame-contract.ts",
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
