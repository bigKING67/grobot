#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const gatewayOnlyContracts = [
  {
    id: "runtime-tool-suite-ownership",
    path: "gateway/src/extensions/contracts/runtime-tool-suite-ownership-contract.ts",
  },
  {
    id: "runtime-tool-events",
    path: "gateway/src/extensions/contracts/runtime-tool-events-contract.ts",
  },
  {
    id: "runtime-tool-mcp-recovery-eval",
    path: "gateway/src/extensions/contracts/runtime-tool-mcp-recovery-eval-contract.ts",
  },
  {
    id: "runtime-tool-recovery-timeline",
    path: "gateway/src/extensions/contracts/runtime-tool-recovery-timeline-contract.ts",
  },
  {
    id: "runtime-tool-recovery-readiness",
    path: "gateway/src/extensions/contracts/runtime-tool-recovery-readiness-contract.ts",
  },
  {
    id: "runtime-tool-recovery-flow",
    path: "gateway/src/extensions/contracts/runtime-tool-recovery-flow-contract.ts",
  },
  {
    id: "runtime-tool-surface",
    path: "gateway/src/extensions/contracts/runtime-tool-surface-contract.ts",
  },
];

const runtimeDescribeContracts = [
  {
    id: "runtime-tool-governance",
    path: "gateway/src/extensions/contracts/runtime-tool-governance-contract.ts",
  },
];

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    includeRuntimeDescribe: argv.includes("--include-runtime-describe"),
  };
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function runtimeBinaryPath() {
  const envPath = process.env.GROBOT_RUNTIME_BIN;
  if (typeof envPath === "string" && envPath.trim().length > 0) {
    return envPath.trim();
  }
  const exeSuffix = process.platform === "win32" ? ".exe" : "";
  return resolve(repoRoot, "runtime/target/debug", `grobot-runtime${exeSuffix}`);
}

function runtimeBinaryStatus(includeRuntimeDescribe) {
  if (!includeRuntimeDescribe) {
    return null;
  }
  const path = runtimeBinaryPath();
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      source: process.env.GROBOT_RUNTIME_BIN ? "env:GROBOT_RUNTIME_BIN" : "default:runtime/target/debug",
    };
  }
  const stats = statSync(path);
  return {
    path,
    exists: true,
    source: process.env.GROBOT_RUNTIME_BIN ? "env:GROBOT_RUNTIME_BIN" : "default:runtime/target/debug",
    size_bytes: stats.size,
    mtime_ms: Math.trunc(stats.mtimeMs),
    mtime_iso: stats.mtime.toISOString(),
  };
}

function contractCommand(contract) {
  return [
    npxCommand(),
    "--yes",
    "--package",
    "tsx@4.20.6",
    "tsx",
    contract.path,
  ];
}

function suggestedCommand(contract) {
  return contractCommand(contract).join(" ");
}

function tailLines(value, maxLines = 40, maxChars = 6000) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const lineTail = trimmed.split("\n").slice(-maxLines).join("\n");
  if (lineTail.length <= maxChars) {
    return lineTail;
  }
  return lineTail.slice(lineTail.length - maxChars);
}

function parseLastJsonLine(value) {
  const lines = value.trim().split("\n").filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // Keep scanning older lines; contracts may print setup logs first.
    }
  }
  return null;
}

function runContract(contract) {
  const startedMs = Date.now();
  const command = contractCommand(contract);
  const result = spawnSync(
    command[0],
    command.slice(1),
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  const durationMs = Date.now() - startedMs;
  return {
    id: contract.id,
    path: contract.path,
    status: result.status ?? 1,
    signal: result.signal ?? null,
    duration_ms: durationMs,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error_message: result.error?.message ?? "",
    suggested_command: suggestedCommand(contract),
  };
}

function emitFailure(result) {
  process.stderr.write(`[runtime-tool-contract] failed ${result.id} status=${String(result.status)}\n`);
  process.stderr.write(`[runtime-tool-contract] reproduce ${result.suggested_command}\n`);
  if (result.error_message) {
    process.stderr.write(`${result.error_message}\n`);
  }
  const stdoutTail = tailLines(result.stdout);
  if (stdoutTail) {
    process.stderr.write(`[runtime-tool-contract] stdout_tail ${result.id}\n${stdoutTail}`);
    if (!stdoutTail.endsWith("\n")) {
      process.stderr.write("\n");
    }
  }
  const stderrTail = tailLines(result.stderr);
  if (stderrTail) {
    process.stderr.write(`[runtime-tool-contract] stderr_tail ${result.id}\n${stderrTail}`);
    if (!stderrTail.endsWith("\n")) {
      process.stderr.write("\n");
    }
  }
}

function compactResult(result) {
  const stdout = result.stdout.trim();
  return {
    id: result.id,
    path: result.path,
    status: result.status,
    signal: result.signal,
    duration_ms: result.duration_ms,
    output: stdout ? stdout.split("\n").slice(-1)[0] : "",
  };
}

function failedContractDetail(result) {
  if (!result) {
    return null;
  }
  return {
    id: result.id,
    path: result.path,
    status: result.status,
    signal: result.signal,
    duration_ms: result.duration_ms,
    suggested_command: result.suggested_command,
    error_message: result.error_message || "",
    last_output_json: parseLastJsonLine(result.stdout),
    stdout_tail: tailLines(result.stdout),
    stderr_tail: tailLines(result.stderr),
  };
}

function runDiagnosticsSelfTest() {
  const stdoutLines = [
    "setup log before structured output",
    JSON.stringify({ ok: false, marker: "older_json_line" }),
    "non-json progress line",
    JSON.stringify({ ok: false, marker: "runtime_tool_runner_diagnostics" }),
  ];
  const stderrLines = Array.from({ length: 45 }, (_, index) => `stderr-line-${String(index).padStart(2, "0")}`);
  const detail = failedContractDetail({
    id: "runtime-tool-runner-diagnostics",
    path: "scripts/check-runtime-tool-contracts.mjs",
    status: 42,
    signal: null,
    duration_ms: 7,
    stdout: `${stdoutLines.join("\n")}\n`,
    stderr: `${stderrLines.join("\n")}\n`,
    error_message: "synthetic diagnostics self-test",
    suggested_command: "node scripts/check-runtime-tool-contracts.mjs --json",
  });
  const failures = [];
  if (detail?.last_output_json?.marker !== "runtime_tool_runner_diagnostics") {
    failures.push("last_output_json did not select the last parseable JSON line");
  }
  if (!detail?.stdout_tail.includes("runtime_tool_runner_diagnostics")) {
    failures.push("stdout_tail dropped the decisive structured output");
  }
  if (detail?.stderr_tail.includes("stderr-line-00")) {
    failures.push("stderr_tail did not cap to the configured line budget");
  }
  if (!detail?.stderr_tail.includes("stderr-line-44")) {
    failures.push("stderr_tail dropped the latest diagnostic line");
  }
  if (detail?.suggested_command !== "node scripts/check-runtime-tool-contracts.mjs --json") {
    failures.push("suggested_command was not preserved");
  }
  return {
    passed: failures.length === 0,
    failures,
  };
}

function emitPayload(args, payload, failed) {
  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    if (failed) {
      emitFailure(failed);
    }
    return;
  }
  if (failed) {
    emitFailure(failed);
  }
  process.stdout.write(`[runtime-tool-contract] summary ${JSON.stringify(payload)}\n`);
}

function buildPayload(args, contracts, results, diagnosticsSelfTest) {
  const failed = results.find((result) => result.status !== 0) ?? null;
  return {
    ok: failed === null && diagnosticsSelfTest.passed,
    contract_count: contracts.length,
    completed_count: results.length,
    include_runtime_describe: args.includeRuntimeDescribe,
    diagnostics_self_test: diagnosticsSelfTest.passed,
    failed_contract: failed ? failed.id : null,
    failed_contract_detail: failedContractDetail(failed),
    runtime_binary: runtimeBinaryStatus(args.includeRuntimeDescribe),
    results: results.map(compactResult),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const contracts = [
    ...gatewayOnlyContracts,
    ...(args.includeRuntimeDescribe ? runtimeDescribeContracts : []),
  ];
  const diagnosticsSelfTest = runDiagnosticsSelfTest();
  if (!diagnosticsSelfTest.passed) {
    const failed = {
      id: "runtime-tool-runner-diagnostics",
      path: "scripts/check-runtime-tool-contracts.mjs",
      status: 1,
      signal: null,
      duration_ms: 0,
      stdout: `${JSON.stringify({ ok: false, diagnostics_self_test: diagnosticsSelfTest })}\n`,
      stderr: diagnosticsSelfTest.failures.join("\n"),
      error_message: "runtime-tool runner diagnostics self-test failed",
      suggested_command: "node scripts/check-runtime-tool-contracts.mjs --json",
    };
    const payload = buildPayload(args, contracts, [failed], diagnosticsSelfTest);
    emitPayload(args, payload, failed);
    process.exitCode = 1;
    return;
  }
  const results = [];
  for (const contract of contracts) {
    const result = runContract(contract);
    results.push(result);
    if (!args.json && result.status === 0) {
      process.stdout.write(`[runtime-tool-contract] ok ${contract.id} duration_ms=${String(result.duration_ms)}\n`);
    }
    if (result.status !== 0) {
      break;
    }
  }

  const failed = results.find((result) => result.status !== 0) ?? null;
  const payload = buildPayload(args, contracts, results, diagnosticsSelfTest);
  emitPayload(args, payload, failed);
  process.exitCode = failed ? 1 : 0;
}

main();
