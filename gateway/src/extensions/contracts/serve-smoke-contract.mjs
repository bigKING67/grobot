import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildFailoverConfig } from "./start-smoke-contract/config-fixtures.mjs";
import { startMockModelServer } from "./_shared/mock-model-server.mjs";
import { runServeInvalidNamespaceRejectFlow } from "./serve-smoke-contract/namespace-flows.mjs";

function parseArgs(argv) {
  const command = argv[0] ?? "";
  if (!command) {
    throw new Error("missing command");
  }
  const options = new Map();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) {
      throw new Error(`unknown argument: ${token}`);
    }
    const value = argv[index + 1] ?? "";
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${token}`);
    }
    options.set(token.slice(2), value);
    index += 1;
  }
  return { command, options };
}

function requireOption(options, key) {
  const value = options.get(key);
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}

async function sleep(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function requestJson(url, init = {}) {
  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => {
    controller.abort();
  }, init.timeoutMs ?? 2_000);
  try {
    const response = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.headers ?? {},
      body: init.body,
      signal: controller.signal,
    });
    const raw = await response.text();
    let parsed = {};
    if (raw.trim()) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = {};
      }
    }
    return {
      status: response.status,
      body: typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {},
    };
  } catch (error) {
    return {
      status: 0,
      body: {
        error: "request_failed",
        detail: String(error),
      },
    };
  } finally {
    clearTimeout(timeoutTimer);
  }
}

async function waitStatusReady(baseUrl, timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const statusResult = await requestJson(`${baseUrl}/api/v1/status`, { timeoutMs: 500 });
    if (statusResult.status === 200) {
      return statusResult;
    }
    await sleep(100);
  }
  return null;
}

async function runRepoCommand(repoRoot, argv, env = {}, timeoutMs = 120_000) {
  const child = spawn(argv[0], argv.slice(1), {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({
        exit_code: code ?? 1,
        signal_code: signal ?? null,
        stdout,
        stderr,
      });
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({
        exit_code: 1,
        signal_code: null,
        stdout,
        stderr: `${stderr}${String(error)}`,
      });
    });
  });
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : {};
}

function providerRuntimeStatesFromManagementStatus(statusEndpoint) {
  const body = asRecord(statusEndpoint?.body);
  const routeDecision = asRecord(body.route_decision);
  const observed = asRecord(routeDecision.observed);
  return Array.isArray(observed.provider_runtime_states)
    ? observed.provider_runtime_states
    : [];
}

function findProviderState(states, providerName) {
  return asRecord(states.find((state) => asRecord(state).provider_name === providerName));
}

function selectedProviderFromManagementStatus(statusEndpoint) {
  const body = asRecord(statusEndpoint?.body);
  const routeDecision = asRecord(body.route_decision);
  const observed = asRecord(routeDecision.observed);
  return observed.selected_provider ?? null;
}

async function terminateProcess(proc) {
  if (proc.killed || proc.exitCode !== null) {
    proc.unref();
    return;
  }
  proc.kill("SIGTERM");
  const terminated = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, 3_000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  if (terminated) {
    proc.unref();
    return;
  }
  proc.kill("SIGKILL");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve();
    }, 2_000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  proc.unref();
}

async function runConfigReadPolicyAuto(options) {
  const repoRoot = requireOption(options, "repo-root");
  const workDir = requireOption(options, "work-dir");
  const homeDir = requireOption(options, "home-dir");
  const bind = requireOption(options, "bind");
  const baseUrl = `http://${bind}`;

  const proc = spawn(
    "./grobot",
    [
      "serve",
      "--work-dir",
      workDir,
      "--gateway-impl",
      "ts",
      "--ts-dev-cli",
      "--runtime-impl",
      "rust",
      "--bind",
      bind,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        GROBOT_HOME: homeDir,
      },
      stdio: "ignore",
    }
  );

  try {
    const statusResult = await waitStatusReady(baseUrl, 8_000);
    if (statusResult === null) {
      return {
        ready: false,
        exit_code: proc.exitCode,
        signal_code: proc.signalCode,
      };
    }
    const configResult = await requestJson(`${baseUrl}/api/v1/config`, { timeoutMs: 1_000 });
    return {
      ready: true,
      status_endpoint: statusResult,
      config_endpoint: configResult,
    };
  } finally {
    await terminateProcess(proc);
  }
}

async function runConfigReadPolicyDisabled(options) {
  const repoRoot = requireOption(options, "repo-root");
  const workDir = requireOption(options, "work-dir");
  const bind = requireOption(options, "bind");
  const managementToken = requireOption(options, "management-token");
  const baseUrl = `http://${bind}`;

  const proc = spawn(
    "./grobot",
    [
      "serve",
      "--work-dir",
      workDir,
      "--gateway-impl",
      "ts",
      "--ts-dev-cli",
      "--runtime-impl",
      "rust",
      "--bind",
      bind,
      "--management-token",
      managementToken,
      "--config-read-policy",
      "disabled",
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
      },
      stdio: "ignore",
    }
  );

  try {
    const statusResult = await waitStatusReady(baseUrl, 8_000);
    if (statusResult === null) {
      return {
        ready: false,
        exit_code: proc.exitCode,
        signal_code: proc.signalCode,
      };
    }
    const configResult = await requestJson(`${baseUrl}/api/v1/config`, {
      timeoutMs: 1_000,
      headers: {
        Authorization: `Bearer ${managementToken}`,
      },
    });
    return {
      ready: true,
      status_endpoint: statusResult,
      config_endpoint: configResult,
    };
  } finally {
    await terminateProcess(proc);
  }
}

async function runSessionStoreRedisUnavailable(options) {
  const repoRoot = requireOption(options, "repo-root");
  const workDir = requireOption(options, "work-dir");
  const bind = requireOption(options, "bind");
  const managementToken = requireOption(options, "management-token");
  const redisUrl = requireOption(options, "redis-url");
  const baseUrl = `http://${bind}`;

  const proc = spawn(
    "./grobot",
    [
      "serve",
      "--work-dir",
      workDir,
      "--gateway-impl",
      "ts",
      "--ts-dev-cli",
      "--runtime-impl",
      "rust",
      "--bind",
      bind,
      "--management-token",
      managementToken,
      "--session-store",
      "redis",
      "--redis-url",
      redisUrl,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
      },
      stdio: "ignore",
    }
  );

  try {
    const statusResult = await waitStatusReady(baseUrl, 8_000);
    if (statusResult === null) {
      return {
        ready: false,
        exit_code: proc.exitCode,
        signal_code: proc.signalCode,
      };
    }
    return {
      ready: true,
      status_endpoint: statusResult,
    };
  } finally {
    await terminateProcess(proc);
  }
}

async function runSessionStoreRedisStatusAndMemoryList(options) {
  const repoRoot = requireOption(options, "repo-root");
  const workDir = requireOption(options, "work-dir");
  const bind = requireOption(options, "bind");
  const managementToken = requireOption(options, "management-token");
  const redisUrl = requireOption(options, "redis-url");
  const sessionId = requireOption(options, "session-id");
  const baseUrl = `http://${bind}`;

  const proc = spawn(
    "./grobot",
    [
      "serve",
      "--work-dir",
      workDir,
      "--gateway-impl",
      "ts",
      "--ts-dev-cli",
      "--runtime-impl",
      "rust",
      "--bind",
      bind,
      "--management-token",
      managementToken,
      "--session-store",
      "redis",
      "--redis-url",
      redisUrl,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
      },
      stdio: "ignore",
    }
  );

  try {
    const statusResult = await waitStatusReady(baseUrl, 8_000);
    if (statusResult === null) {
      return {
        ready: false,
        exit_code: proc.exitCode,
        signal_code: proc.signalCode,
      };
    }
    const encodedSessionId = encodeURIComponent(sessionId);
    const memoryListResult = await requestJson(
      `${baseUrl}/api/v1/sessions/${encodedSessionId}/memory?limit=20`,
      {
        timeoutMs: 1_000,
        headers: {
          Authorization: `Bearer ${managementToken}`,
        },
      }
    );
    return {
      ready: true,
      status_endpoint: statusResult,
      memory_list_endpoint: memoryListResult,
    };
  } finally {
    await terminateProcess(proc);
  }
}

async function runMemoryLifecycleRunError(options) {
  const repoRoot = requireOption(options, "repo-root");
  const workDir = requireOption(options, "work-dir");
  const bind = requireOption(options, "bind");
  const managementToken = requireOption(options, "management-token");
  const redisUrl = requireOption(options, "redis-url");
  const sessionId = requireOption(options, "session-id");
  const baseUrl = `http://${bind}`;

  const proc = spawn(
    "./grobot",
    [
      "serve",
      "--work-dir",
      workDir,
      "--gateway-impl",
      "ts",
      "--ts-dev-cli",
      "--runtime-impl",
      "rust",
      "--bind",
      bind,
      "--management-token",
      managementToken,
      "--session-store",
      "redis",
      "--redis-url",
      redisUrl,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
      },
      stdio: "ignore",
    }
  );

  try {
    const statusResult = await waitStatusReady(baseUrl, 8_000);
    if (statusResult === null) {
      return {
        ready: false,
        exit_code: proc.exitCode,
        signal_code: proc.signalCode,
      };
    }
    const lifecycleRunResult = await requestJson(`${baseUrl}/api/v1/memory/lifecycle/run`, {
      method: "POST",
      timeoutMs: 1_000,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${managementToken}`,
      },
      body: JSON.stringify({
        dry_run: false,
        sessions: [sessionId],
      }),
    });
    return {
      ready: true,
      status_endpoint: statusResult,
      lifecycle_run_endpoint: lifecycleRunResult,
    };
  } finally {
    await terminateProcess(proc);
  }
}

async function runReloadMemoryStoreFromProjectToml(options) {
  const repoRoot = requireOption(options, "repo-root");
  const workDir = requireOption(options, "work-dir");
  const bind = requireOption(options, "bind");
  const managementToken = requireOption(options, "management-token");
  const redisUrl = requireOption(options, "redis-url");
  const projectTomlPath = requireOption(options, "project-toml-path");
  const baseUrl = `http://${bind}`;

  const proc = spawn(
    "./grobot",
    [
      "serve",
      "--work-dir",
      workDir,
      "--gateway-impl",
      "ts",
      "--ts-dev-cli",
      "--runtime-impl",
      "rust",
      "--bind",
      bind,
      "--management-token",
      managementToken,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        GROBOT_REDIS_URL: redisUrl,
      },
      stdio: "ignore",
    }
  );

  try {
    const statusBefore = await waitStatusReady(baseUrl, 8_000);
    if (statusBefore === null) {
      return {
        ready: false,
        exit_code: proc.exitCode,
        signal_code: proc.signalCode,
      };
    }

    const currentProjectToml = readFileSync(projectTomlPath, "utf8");
    const runtimeStorageBlock = '\n\n[runtime.storage]\nhot_cache = "redis"\n';
    const nextProjectToml = currentProjectToml.includes("[runtime.storage]")
      ? currentProjectToml
      : `${currentProjectToml.trimEnd()}${runtimeStorageBlock}`;
    writeFileSync(projectTomlPath, nextProjectToml, "utf8");

    const reloadResult = await requestJson(`${baseUrl}/api/v1/reload`, {
      method: "POST",
      timeoutMs: 1_000,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${managementToken}`,
      },
      body: "{}",
    });
    const statusAfter = await requestJson(`${baseUrl}/api/v1/status`, { timeoutMs: 1_000 });
    return {
      ready: true,
      status_before: statusBefore,
      reload_endpoint: reloadResult,
      status_after: statusAfter,
    };
  } finally {
    await terminateProcess(proc);
  }
}

async function runProviderFailureRouteStatusManagementApi(options) {
  const repoRoot = requireOption(options, "repo-root");
  const workDir = requireOption(options, "work-dir");
  const bind = requireOption(options, "bind");
  const baseUrl = `http://${bind}`;
  const sessionSubject = "provider-failure-status-user";
  mkdirSync(workDir, { recursive: true });
  const successModel = await startMockModelServer();
  const configPath = `${workDir}/provider-failover-config.toml`;
  writeFileSync(
    configPath,
    buildFailoverConfig(workDir, {
      successBaseUrl: successModel.baseUrl,
    }),
    "utf8",
  );
  const baseArgs = [
    "--project",
    "grobot",
    "--project-root",
    workDir,
    "--work-dir",
    workDir,
    "--config",
    configPath,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
    "--session-subject",
    sessionSubject,
  ];
  const startResult = await runRepoCommand(
    repoRoot,
    [
      "./grobot",
      "start",
      ...baseArgs,
      "--no-shadow-mode",
      "--provider",
      "failing",
      "--no-handoff-auto-on-exit",
      "--message",
      "provider failure management status should expose route diagnostics",
    ],
    {
      GROBOT_RUNTIME_HTTP_TIMEOUT_MS: "1200",
    },
  );
  const proc = spawn(
    "./grobot",
    [
      "serve",
      ...baseArgs,
      "--bind",
      bind,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
      },
      stdio: "ignore",
    },
  );

  try {
    const statusResult = await waitStatusReady(baseUrl, 8_000);
    if (statusResult === null) {
      return {
        ready: false,
        start_exit_code: startResult.exit_code,
        exit_code: proc.exitCode,
        signal_code: proc.signalCode,
      };
    }
    const aliasedSubjectStatus = await requestJson(
      `${baseUrl}/api/v1/status?scope=dm&subject=${encodeURIComponent(sessionSubject)}`,
      { timeoutMs: 1_000 },
    );
    const unknownSubjectStatus = await requestJson(
      `${baseUrl}/api/v1/status?session-scope=dm&session-subject=${encodeURIComponent("unknown-status-user")}`,
      { timeoutMs: 1_000 },
    );
    const invalidSubjectStatus = await requestJson(
      `${baseUrl}/api/v1/status?session-subject=${encodeURIComponent("bad:subject")}`,
      { timeoutMs: 1_000 },
    );
    const emptySubjectStatus = await requestJson(
      `${baseUrl}/api/v1/status?session-subject=`,
      { timeoutMs: 1_000 },
    );
    const invalidScopeStatus = await requestJson(
      `${baseUrl}/api/v1/status?session-scope=${encodeURIComponent("room")}`,
      { timeoutMs: 1_000 },
    );
    const postInvalidStatus = await requestJson(`${baseUrl}/api/v1/status`, { timeoutMs: 1_000 });
    const body = asRecord(statusResult.body);
    const routeDecision = asRecord(body.route_decision);
    const routeObserved = asRecord(routeDecision.observed);
    const states = providerRuntimeStatesFromManagementStatus(statusResult);
    const failingState = findProviderState(states, "failing");
    const successState = findProviderState(states, "success");
    const failingErrorData = asRecord(failingState.last_error_data);
    const failingErrorHealth = asRecord(failingState.last_error_health);
    const successErrorHealth = asRecord(successState.last_error_health);
    return {
      ready: true,
      start_exit_code: startResult.exit_code,
      status_endpoint: statusResult,
      management_has_route_decision: Object.keys(routeDecision).length > 0,
      management_route_source_type: typeof routeDecision.source,
      management_status_provider_state_count: states.length,
      management_status_has_failing_state: Object.keys(failingState).length > 0,
      management_status_has_success_state: Object.keys(successState).length > 0,
      management_status_selected_provider: routeObserved.selected_provider ?? null,
      management_status_selected_reason: routeObserved.reason ?? null,
      management_alias_query_selected_provider:
        selectedProviderFromManagementStatus(aliasedSubjectStatus),
      management_unknown_subject_selected_provider:
        selectedProviderFromManagementStatus(unknownSubjectStatus),
      management_unknown_subject_selected_reason:
        asRecord(asRecord(asRecord(unknownSubjectStatus.body).route_decision).observed).reason ?? null,
      management_invalid_subject_status: invalidSubjectStatus.status,
      management_invalid_subject_error:
        asRecord(invalidSubjectStatus.body).error ?? null,
      management_invalid_subject_field:
        asRecord(invalidSubjectStatus.body).field ?? null,
      management_empty_subject_status: emptySubjectStatus.status,
      management_empty_subject_error:
        asRecord(emptySubjectStatus.body).error ?? null,
      management_empty_subject_field:
        asRecord(emptySubjectStatus.body).field ?? null,
      management_invalid_scope_status: invalidScopeStatus.status,
      management_invalid_scope_error:
        asRecord(invalidScopeStatus.body).error ?? null,
      management_post_invalid_status: postInvalidStatus.status,
      management_post_invalid_selected_provider:
        selectedProviderFromManagementStatus(postInvalidStatus),
      management_success_last_error_class: successState.last_error_class ?? null,
      management_success_last_error_health_penalty:
        Number.isFinite(Number(successErrorHealth.score_penalty))
          ? Number(successErrorHealth.score_penalty)
          : null,
      management_success_last_succeeded_at_type: typeof successState.last_succeeded_at,
      management_failing_last_error_class: failingState.last_error_class ?? null,
      management_failing_last_error_diagnostic: failingErrorData.diagnostic_kind ?? null,
      management_failing_last_error_source: failingErrorData.source ?? null,
      management_failing_last_error_stage: failingErrorData.stage ?? null,
      management_failing_last_error_retryable: failingErrorData.retryable ?? null,
      management_failing_last_error_health_penalty:
        Number.isFinite(Number(failingErrorHealth.score_penalty))
          ? Number(failingErrorHealth.score_penalty)
          : null,
      management_failing_last_error_health_reason: failingErrorHealth.reason ?? null,
      management_failing_last_error_health_sticky_bypass:
        failingErrorHealth.sticky_bypass_reason ?? null,
      management_failing_redacts_body_preview:
        !Object.prototype.hasOwnProperty.call(failingErrorData, "body_preview"),
      management_failing_redacts_response_headers:
        !Object.prototype.hasOwnProperty.call(failingErrorData, "response_headers"),
    };
  } finally {
    await terminateProcess(proc);
    await successModel.close();
  }
}

async function runCli(argv) {
  const { command, options } = parseArgs(argv);
  switch (command) {
    case "config-read-policy-auto": {
      const payload = await runConfigReadPolicyAuto(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    case "serve-invalid-namespace-reject-flow": {
      const payload = await runServeInvalidNamespaceRejectFlow(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    case "config-read-policy-disabled": {
      const payload = await runConfigReadPolicyDisabled(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    case "session-store-redis-unavailable": {
      const payload = await runSessionStoreRedisUnavailable(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    case "session-store-redis-status-and-memory-list": {
      const payload = await runSessionStoreRedisStatusAndMemoryList(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    case "memory-lifecycle-run-error": {
      const payload = await runMemoryLifecycleRunError(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    case "reload-memory-store-from-project-toml": {
      const payload = await runReloadMemoryStoreFromProjectToml(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    case "provider-failure-route-status-management-api": {
      const payload = await runProviderFailureRouteStatusManagementApi(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

const entryScript = process.argv[1] ?? "";
const shouldRun = entryScript.includes("serve-smoke-contract.mjs");

if (shouldRun) {
  runCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`serve-smoke-contract fatal: ${String(error)}\n`);
      process.exitCode = 1;
    });
}
