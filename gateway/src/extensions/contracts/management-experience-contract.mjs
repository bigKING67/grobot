import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

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

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

async function requestJson(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
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
    let body = {};
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        body = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
      } catch {
        body = {};
      }
    }
    return {
      status: response.status,
      body,
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
    clearTimeout(timer);
  }
}

async function waitStatusReady(baseUrl, timeoutMs = 8_000) {
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

async function terminateProcess(proc) {
  if (proc.killed || proc.exitCode !== null) {
    proc.unref();
    return;
  }
  proc.kill("SIGTERM");
  const terminated = await new Promise((resolveTerminate) => {
    const timer = setTimeout(() => {
      resolveTerminate(false);
    }, 3_000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolveTerminate(true);
    });
  });
  if (terminated) {
    proc.unref();
    return;
  }
  proc.kill("SIGKILL");
  await new Promise((resolveKill) => {
    const timer = setTimeout(() => {
      resolveKill();
    }, 2_000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolveKill();
    });
  });
  proc.unref();
}

async function runExperienceInputValidation(options) {
  const repoRoot = requireOption(options, "repo-root");
  const workDir = requireOption(options, "work-dir");
  const bind = requireOption(options, "bind");
  const managementToken = requireOption(options, "management-token");
  mkdirSync(workDir, { recursive: true });
  const baseUrl = `http://${bind}`;
  const proc = spawn(
    "./grobot",
    [
      "serve",
      "--project",
      "grobot",
      "--project-root",
      workDir,
      "--work-dir",
      workDir,
      "--gateway-impl",
      "ts",
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
      },
      stdio: "ignore",
    },
  );

  try {
    const statusResult = await waitStatusReady(baseUrl);
    if (statusResult === null) {
      return {
        ready: false,
        exit_code: proc.exitCode,
        signal_code: proc.signalCode,
      };
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${managementToken}`,
    };
    const experienceUrl = `${baseUrl}/api/v1/experience`;
    const invalidLimitAlpha = await requestJson(`${experienceUrl}?limit=nope`, {
      timeoutMs: 1_000,
      headers,
    });
    const invalidLimitZero = await requestJson(`${experienceUrl}?limit=0`, {
      timeoutMs: 1_000,
      headers,
    });
    const invalidLimitOversized = await requestJson(`${experienceUrl}?limit=101`, {
      timeoutMs: 1_000,
      headers,
    });
    const invalidStatesPartial = await requestJson(`${experienceUrl}?states=active,bad`, {
      timeoutMs: 1_000,
      headers,
    });
    const invalidStatesEmpty = await requestJson(`${experienceUrl}?states=`, {
      timeoutMs: 1_000,
      headers,
    });
    const invalidTenantEmpty = await requestJson(`${experienceUrl}?tenant=`, {
      timeoutMs: 1_000,
      headers,
    });
    const invalidTeamEmpty = await requestJson(`${experienceUrl}?team=`, {
      timeoutMs: 1_000,
      headers,
    });
    const invalidUserEmpty = await requestJson(`${experienceUrl}?user=`, {
      timeoutMs: 1_000,
      headers,
    });
    const invalidQueryEmpty = await requestJson(`${experienceUrl}?q=`, {
      timeoutMs: 1_000,
      headers,
    });
    const experienceStateUrl = `${experienceUrl}/missing-record/state`;
    const invalidStateEmpty = await requestJson(experienceStateUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: JSON.stringify({ state: "" }),
    });
    const invalidStateUnknown = await requestJson(experienceStateUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: JSON.stringify({ state: "archived" }),
    });
    const invalidStateNumber = await requestJson(experienceStateUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: JSON.stringify({ state: 67 }),
    });
    const invalidReasonEmpty = await requestJson(experienceStateUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: JSON.stringify({ state: "quarantined", reason: "" }),
    });
    const invalidReasonNumber = await requestJson(experienceStateUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: JSON.stringify({ state: "quarantined", reason: 67 }),
    });
    const validStateMissingRecord = await requestJson(experienceStateUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: JSON.stringify({ state: "quarantined" }),
    });
    const validList = await requestJson(`${experienceUrl}?limit=1&states=active,quarantined`, {
      timeoutMs: 1_000,
      headers,
    });

    return {
      ready: true,
      invalid_limit_alpha_status: invalidLimitAlpha.status,
      invalid_limit_alpha_error: invalidLimitAlpha.body.error ?? null,
      invalid_limit_alpha_field: invalidLimitAlpha.body.field ?? null,
      invalid_limit_zero_status: invalidLimitZero.status,
      invalid_limit_zero_error: invalidLimitZero.body.error ?? null,
      invalid_limit_zero_field: invalidLimitZero.body.field ?? null,
      invalid_limit_oversized_status: invalidLimitOversized.status,
      invalid_limit_oversized_error: invalidLimitOversized.body.error ?? null,
      invalid_limit_oversized_field: invalidLimitOversized.body.field ?? null,
      invalid_states_partial_status: invalidStatesPartial.status,
      invalid_states_partial_error: invalidStatesPartial.body.error ?? null,
      invalid_states_partial_field: invalidStatesPartial.body.field ?? null,
      invalid_states_empty_status: invalidStatesEmpty.status,
      invalid_states_empty_error: invalidStatesEmpty.body.error ?? null,
      invalid_states_empty_field: invalidStatesEmpty.body.field ?? null,
      invalid_tenant_empty_status: invalidTenantEmpty.status,
      invalid_tenant_empty_error: invalidTenantEmpty.body.error ?? null,
      invalid_tenant_empty_field: invalidTenantEmpty.body.field ?? null,
      invalid_team_empty_status: invalidTeamEmpty.status,
      invalid_team_empty_error: invalidTeamEmpty.body.error ?? null,
      invalid_team_empty_field: invalidTeamEmpty.body.field ?? null,
      invalid_user_empty_status: invalidUserEmpty.status,
      invalid_user_empty_error: invalidUserEmpty.body.error ?? null,
      invalid_user_empty_field: invalidUserEmpty.body.field ?? null,
      invalid_query_empty_status: invalidQueryEmpty.status,
      invalid_query_empty_error: invalidQueryEmpty.body.error ?? null,
      invalid_query_empty_field: invalidQueryEmpty.body.field ?? null,
      invalid_state_empty_status: invalidStateEmpty.status,
      invalid_state_empty_error: invalidStateEmpty.body.error ?? null,
      invalid_state_empty_field: invalidStateEmpty.body.field ?? null,
      invalid_state_unknown_status: invalidStateUnknown.status,
      invalid_state_unknown_error: invalidStateUnknown.body.error ?? null,
      invalid_state_unknown_field: invalidStateUnknown.body.field ?? null,
      invalid_state_number_status: invalidStateNumber.status,
      invalid_state_number_error: invalidStateNumber.body.error ?? null,
      invalid_state_number_field: invalidStateNumber.body.field ?? null,
      invalid_reason_empty_status: invalidReasonEmpty.status,
      invalid_reason_empty_error: invalidReasonEmpty.body.error ?? null,
      invalid_reason_empty_field: invalidReasonEmpty.body.field ?? null,
      invalid_reason_number_status: invalidReasonNumber.status,
      invalid_reason_number_error: invalidReasonNumber.body.error ?? null,
      invalid_reason_number_field: invalidReasonNumber.body.field ?? null,
      valid_state_missing_record_status: validStateMissingRecord.status,
      valid_state_missing_record_error: validStateMissingRecord.body.error ?? null,
      valid_list_status: validList.status,
      valid_list_mode: validList.body.mode ?? null,
      valid_list_total_type: typeof validList.body.total,
    };
  } finally {
    await terminateProcess(proc);
  }
}

async function runCli(argv) {
  const { command, options } = parseArgs(argv);
  switch (command) {
    case "experience-input-validation": {
      const payload = await runExperienceInputValidation(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

const entryScript = process.argv[1] ?? "";
if (entryScript.includes("management-experience-contract.mjs")) {
  runCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`management-experience-contract fatal: ${String(error)}\n`);
      process.exitCode = 1;
    });
}
