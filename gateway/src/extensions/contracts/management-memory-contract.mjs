import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT = 200;

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

function jsonBody(payload) {
  return JSON.stringify(payload);
}

function firstInvalidRowField(response) {
  const row = Array.isArray(response.body.invalid_rows) ? response.body.invalid_rows[0] : null;
  const errors = row && Array.isArray(row.errors) ? row.errors : [];
  const first = errors[0];
  return first && typeof first.field === "string" ? first.field : null;
}

async function runMemoryInputValidation(options) {
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
    const sessionPath = encodeURIComponent("feishu:grobot:dm:memory-input-contract");
    const memoryUrl = `${baseUrl}/api/v1/sessions/${sessionPath}/memory`;
    const exportUrl = `${memoryUrl}/export`;
    const importUrl = `${memoryUrl}/import`;
    const forgetUrl = `${memoryUrl}/forget`;
    const lifecycleUrl = `${memoryUrl}/lifecycle`;
    const batchLifecycleUrl = `${baseUrl}/api/v1/memory/lifecycle/run`;

    const invalidListLimit = await requestJson(`${memoryUrl}?limit=nope`, {
      timeoutMs: 1_000,
      headers,
    });
    const invalidListLimitZero = await requestJson(`${memoryUrl}?limit=0`, {
      timeoutMs: 1_000,
      headers,
    });
    const invalidListIncludeArchived = await requestJson(`${memoryUrl}?include_archived=maybe`, {
      timeoutMs: 1_000,
      headers,
    });
    const invalidExportIncludeSecret = await requestJson(`${exportUrl}?include_secret=maybe`, {
      timeoutMs: 1_000,
      headers,
    });
    const invalidImportDryRun = await requestJson(importUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: jsonBody({
        dry_run: "maybe",
        records: [{ text: "x" }],
      }),
    });
    const invalidImportSource = await requestJson(importUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: jsonBody({
        source: "",
        records: [{ text: "x" }],
      }),
    });
    const invalidImportImportance = await requestJson(importUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: jsonBody({
        records: [{ text: "x", importance: "0.8" }],
      }),
    });
    const invalidImportTagsEntry = await requestJson(importUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: jsonBody({
        records: [{ text: "x", tags: ["good", ""] }],
      }),
    });
    const invalidImportEvidenceRef = await requestJson(importUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: jsonBody({
        records: [{ text: "x", evidence_ref: { trace_id: "" } }],
      }),
    });
    const validImportDefaults = await requestJson(importUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: jsonBody({
        records: [{ text: "valid defaulted memory row" }],
      }),
    });
    const oversizedImportRecords = await requestJson(importUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: jsonBody({
        records: Array.from(
          { length: MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT + 1 },
          (_, index) => ({ text: `oversized import ${String(index)}` }),
        ),
      }),
    });
    const invalidForgetDryRun = await requestJson(forgetUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: jsonBody({
        dry_run: 2,
        ids: ["x"],
      }),
    });
    const invalidForgetId = await requestJson(forgetUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: jsonBody({
        id: "",
      }),
    });
    const invalidForgetIdsType = await requestJson(forgetUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: jsonBody({
        ids: "x",
      }),
    });
    const invalidForgetIdsEntry = await requestJson(forgetUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: jsonBody({
        ids: ["x", 67],
      }),
    });
    const invalidForgetReason = await requestJson(forgetUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: jsonBody({
        ids: ["x"],
        reason: "",
      }),
    });
    const oversizedForgetIds = await requestJson(forgetUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: jsonBody({
        ids: Array.from(
          { length: MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT + 1 },
          (_, index) => `forget-${String(index)}`,
        ),
      }),
    });
    const invalidLifecycleDryRun = await requestJson(lifecycleUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: jsonBody({
        dry_run: {},
      }),
    });
    const invalidBatchLimit = await requestJson(batchLifecycleUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: jsonBody({
        dry_run: false,
        limit: "bad",
        sessions: ["feishu:grobot:dm:memory-input-contract"],
      }),
    });
    const oversizedBatchLimit = await requestJson(batchLifecycleUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: jsonBody({
        dry_run: false,
        limit: 999_999,
        sessions: ["feishu:grobot:dm:memory-input-contract"],
      }),
    });
    const invalidBatchSessionsType = await requestJson(batchLifecycleUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: jsonBody({
        dry_run: false,
        sessions: "feishu:grobot:dm:memory-input-contract",
      }),
    });
    const invalidBatchSessionsEntry = await requestJson(batchLifecycleUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: jsonBody({
        dry_run: false,
        sessions: ["feishu:grobot:dm:memory-input-contract", 67],
      }),
    });
    const invalidBatchSessionPrefix = await requestJson(batchLifecycleUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: jsonBody({
        dry_run: false,
        session_prefix: "",
      }),
    });
    const invalidBatchSessionPrefixesEntry = await requestJson(batchLifecycleUrl, {
      method: "POST",
      timeoutMs: 1_000,
      headers,
      body: jsonBody({
        dry_run: false,
        session_prefixes: ["feishu:grobot:dm", ""],
      }),
    });
    const validList = await requestJson(`${memoryUrl}?limit=1&include_archived=true`, {
      timeoutMs: 1_000,
      headers,
    });

    return {
      ready: true,
      invalid_list_limit_status: invalidListLimit.status,
      invalid_list_limit_error: invalidListLimit.body.error ?? null,
      invalid_list_limit_field: invalidListLimit.body.field ?? null,
      invalid_list_limit_zero_status: invalidListLimitZero.status,
      invalid_list_limit_zero_error: invalidListLimitZero.body.error ?? null,
      invalid_list_limit_zero_field: invalidListLimitZero.body.field ?? null,
      invalid_list_include_archived_status: invalidListIncludeArchived.status,
      invalid_list_include_archived_error: invalidListIncludeArchived.body.error ?? null,
      invalid_list_include_archived_field: invalidListIncludeArchived.body.field ?? null,
      invalid_export_include_secret_status: invalidExportIncludeSecret.status,
      invalid_export_include_secret_error: invalidExportIncludeSecret.body.error ?? null,
      invalid_export_include_secret_field: invalidExportIncludeSecret.body.field ?? null,
      invalid_import_dry_run_status: invalidImportDryRun.status,
      invalid_import_dry_run_error: invalidImportDryRun.body.error ?? null,
      invalid_import_dry_run_field: invalidImportDryRun.body.field ?? null,
      invalid_import_source_status: invalidImportSource.status,
      invalid_import_source_error: invalidImportSource.body.error ?? null,
      invalid_import_source_field: invalidImportSource.body.field ?? null,
      invalid_import_importance_status: invalidImportImportance.status,
      invalid_import_importance_error: invalidImportImportance.body.error ?? null,
      invalid_import_importance_detail_error: invalidImportImportance.body.detail_error ?? null,
      invalid_import_importance_field: firstInvalidRowField(invalidImportImportance),
      invalid_import_tags_entry_status: invalidImportTagsEntry.status,
      invalid_import_tags_entry_error: invalidImportTagsEntry.body.error ?? null,
      invalid_import_tags_entry_detail_error: invalidImportTagsEntry.body.detail_error ?? null,
      invalid_import_tags_entry_field: firstInvalidRowField(invalidImportTagsEntry),
      invalid_import_evidence_ref_status: invalidImportEvidenceRef.status,
      invalid_import_evidence_ref_error: invalidImportEvidenceRef.body.error ?? null,
      invalid_import_evidence_ref_detail_error: invalidImportEvidenceRef.body.detail_error ?? null,
      invalid_import_evidence_ref_field: firstInvalidRowField(invalidImportEvidenceRef),
      valid_import_defaults_status: validImportDefaults.status,
      valid_import_defaults_imported_count: validImportDefaults.body.imported_count ?? null,
      oversized_import_records_status: oversizedImportRecords.status,
      oversized_import_records_error: oversizedImportRecords.body.error ?? null,
      oversized_import_records_detail_error: oversizedImportRecords.body.detail_error ?? null,
      oversized_import_records_batch_limit: oversizedImportRecords.body.batch_limit ?? null,
      invalid_forget_dry_run_status: invalidForgetDryRun.status,
      invalid_forget_dry_run_error: invalidForgetDryRun.body.error ?? null,
      invalid_forget_dry_run_field: invalidForgetDryRun.body.field ?? null,
      invalid_forget_id_status: invalidForgetId.status,
      invalid_forget_id_error: invalidForgetId.body.error ?? null,
      invalid_forget_id_field: invalidForgetId.body.field ?? null,
      invalid_forget_ids_type_status: invalidForgetIdsType.status,
      invalid_forget_ids_type_error: invalidForgetIdsType.body.error ?? null,
      invalid_forget_ids_type_field: invalidForgetIdsType.body.field ?? null,
      invalid_forget_ids_entry_status: invalidForgetIdsEntry.status,
      invalid_forget_ids_entry_error: invalidForgetIdsEntry.body.error ?? null,
      invalid_forget_ids_entry_field: invalidForgetIdsEntry.body.field ?? null,
      invalid_forget_reason_status: invalidForgetReason.status,
      invalid_forget_reason_error: invalidForgetReason.body.error ?? null,
      invalid_forget_reason_field: invalidForgetReason.body.field ?? null,
      oversized_forget_ids_status: oversizedForgetIds.status,
      oversized_forget_ids_error: oversizedForgetIds.body.error ?? null,
      oversized_forget_ids_detail_error: oversizedForgetIds.body.detail_error ?? null,
      oversized_forget_ids_batch_limit: oversizedForgetIds.body.batch_limit ?? null,
      invalid_lifecycle_dry_run_status: invalidLifecycleDryRun.status,
      invalid_lifecycle_dry_run_error: invalidLifecycleDryRun.body.error ?? null,
      invalid_lifecycle_dry_run_field: invalidLifecycleDryRun.body.field ?? null,
      invalid_batch_limit_status: invalidBatchLimit.status,
      invalid_batch_limit_error: invalidBatchLimit.body.error ?? null,
      invalid_batch_limit_field: invalidBatchLimit.body.field ?? null,
      oversized_batch_limit_status: oversizedBatchLimit.status,
      oversized_batch_limit_error: oversizedBatchLimit.body.error ?? null,
      oversized_batch_limit_field: oversizedBatchLimit.body.field ?? null,
      invalid_batch_sessions_type_status: invalidBatchSessionsType.status,
      invalid_batch_sessions_type_error: invalidBatchSessionsType.body.error ?? null,
      invalid_batch_sessions_type_field: invalidBatchSessionsType.body.field ?? null,
      invalid_batch_sessions_entry_status: invalidBatchSessionsEntry.status,
      invalid_batch_sessions_entry_error: invalidBatchSessionsEntry.body.error ?? null,
      invalid_batch_sessions_entry_field: invalidBatchSessionsEntry.body.field ?? null,
      invalid_batch_session_prefix_status: invalidBatchSessionPrefix.status,
      invalid_batch_session_prefix_error: invalidBatchSessionPrefix.body.error ?? null,
      invalid_batch_session_prefix_field: invalidBatchSessionPrefix.body.field ?? null,
      invalid_batch_session_prefixes_entry_status: invalidBatchSessionPrefixesEntry.status,
      invalid_batch_session_prefixes_entry_error: invalidBatchSessionPrefixesEntry.body.error ?? null,
      invalid_batch_session_prefixes_entry_field: invalidBatchSessionPrefixesEntry.body.field ?? null,
      valid_list_status: validList.status,
      valid_list_limit: validList.body.limit ?? null,
      valid_list_include_archived: validList.body.include_archived ?? null,
    };
  } finally {
    await terminateProcess(proc);
  }
}

async function runCli(argv) {
  const { command, options } = parseArgs(argv);
  switch (command) {
    case "memory-input-validation": {
      const payload = await runMemoryInputValidation(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

const entryScript = process.argv[1] ?? "";
if (entryScript.includes("management-memory-contract.mjs")) {
  runCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`management-memory-contract fatal: ${String(error)}\n`);
      process.exitCode = 1;
    });
}
