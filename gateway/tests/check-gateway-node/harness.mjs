import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const repoRoot = resolve(__dirname, "..", "..", "..");
export const contractsRoot = resolve(repoRoot, "gateway/src/extensions/contracts");
export const tempDirs = [];

let runReporter = null;

function nowIso() {
  return new Date().toISOString();
}

export function isRecord(value) {
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

export function loadBaselineReport(baselinePath) {
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

export function createRunReporter(options = {}) {
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

export function setRunReporter(reporter) {
  runReporter = reporter;
}

export function makeTempDir(prefix) {
  const path = mkdtempSync(resolve(tmpdir(), `${prefix}-`));
  tempDirs.push(path);
  return path;
}

export function writeFixtureFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function resolveLocalNpxTsxInvocation(command, args = []) {
  const commandName = String(command ?? "").split(/[\\/]/).pop();
  if (commandName !== "npx" && commandName !== "npx.cmd") {
    return { command, args };
  }

  const packageIndex = args.indexOf("--package");
  if (
    packageIndex < 0
    || args[packageIndex + 1] !== "tsx@4.20.6"
    || args[packageIndex + 2] !== "tsx"
  ) {
    return { command, args };
  }

  const prefix = args.slice(0, packageIndex);
  if (!prefix.every((arg) => arg === "--yes" || arg === "-y")) {
    return { command, args };
  }

  const tsxBin = localBin("tsx");
  if (tsxBin === "tsx") {
    return { command, args };
  }
  return {
    command: tsxBin,
    args: args.slice(packageIndex + 3),
  };
}

export function runCommand(command, args, options = {}) {
  const resolved = resolveLocalNpxTsxInvocation(command, args);
  const result = spawnSync(resolved.command, resolved.args, {
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

export function localBin(name) {
  const binaryName = process.platform === "win32" ? `${name}.cmd` : name;
  const candidate = resolve(repoRoot, "node_modules", ".bin", binaryName);
  return existsSync(candidate) ? candidate : name;
}

export function runTsx(scriptPath, args = [], options = {}) {
  const tsxBin = localBin("tsx");
  if (tsxBin !== "tsx") {
    return runCommand(tsxBin, [scriptPath, ...args], options);
  }
  return runCommand("npx", ["--yes", "--package", "tsx@4.20.6", "tsx", scriptPath, ...args], options);
}

export function runCommandAsync(command, args, options = {}) {
  return new Promise((resolveResult, rejectResult) => {
    const resolved = resolveLocalNpxTsxInvocation(command, args);
    const child = spawn(resolved.command, resolved.args, {
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

export function parseJsonOutput(name, stdout) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${name}: stdout is not valid JSON: ${String(error)}\n${stdout}`);
  }
}

export function assertSuccess(name, result) {
  if (result.code !== 0) {
    throw new Error(`${name}: exit=${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
}

export function runContract(scriptName, command, args = [], options = {}) {
  const scriptPath = resolve(contractsRoot, scriptName);
  const result = runCommand("node", [scriptPath, command, ...args], options);
  assertSuccess(`${scriptName} ${command}`, result);
  return result;
}

export function runTsContract(scriptName, command, args = [], options = {}) {
  const scriptPath = resolve(contractsRoot, scriptName);
  const result = runTsx(scriptPath, [command, ...args], options);
  assertSuccess(`${scriptName} ${command}`, result);
  return result;
}

export async function runContractAsync(scriptName, command, args = [], options = {}) {
  const scriptPath = resolve(contractsRoot, scriptName);
  const result = await runCommandAsync("node", [scriptPath, command, ...args], options);
  assertSuccess(`${scriptName} ${command}`, result);
  return result;
}

export function logStep(name, metadata = {}) {
  if (runReporter) {
    runReporter.step(name, metadata);
    return;
  }
  process.stdout.write(`[ok] ${name}${formatMeta(metadata)}\n`);
}

export function logRetry(name, attempt, maxAttempts, reason) {
  if (runReporter) {
    runReporter.retry(name, attempt, maxAttempts, reason);
    return;
  }
  process.stdout.write(`[retry] ${name} attempt ${String(attempt)}/${String(maxAttempts)} reason=${reason}\n`);
}

export function sleepMs(delayMs) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, delayMs));
}

export function parseCliOptions(argv) {
  const options = {
    baseline_json: "",
    fail_on_retry: false,
    json: false,
    json_output: "",
    list_suites: false,
    mode: "full",
    suites: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--runtime-smoke-only") {
      options.mode = "runtime-smoke-only";
      continue;
    }
    if (token === "--list-suites") {
      options.list_suites = true;
      continue;
    }
    if (token === "--suite") {
      const value = argv[index + 1] ?? "";
      if (!value || value.startsWith("--")) {
        throw new Error("missing value for --suite");
      }
      options.suites.push(value);
      index += 1;
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

export function emitJsonReport(cli, reporter, baselineReportPath = "", baselineReportPayload = null) {
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

export function enforceRetryGate(cli, reporter) {
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

export function reserveFreePort() {
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
