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
  const runtimeBuildResult = runCommand("cargo", ["build", "--manifest-path", "runtime/Cargo.toml"], {
    timeoutMs: 240_000,
  });
  assertSuccess("runtime build for ts-rust smoke", runtimeBuildResult);
  logStep("runtime build for ts-rust smoke");

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
  assert.equal(String(toolCallFailurePayload.stderr).includes("class=tool_call_not_supported"), true);
  assert.equal(Number(toolCallFailurePayload.runtime_call_count) >= 1, true);
  logStep("runtime-smoke-contract tool-call-fail-fast");

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
