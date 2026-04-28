#!/usr/bin/env node
import { spawnSync } from "node:child_process";
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

function runContract(contract) {
  const startedMs = Date.now();
  const result = spawnSync(
    npxCommand(),
    ["--yes", "--package", "tsx@4.20.6", "tsx", contract.path],
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
  };
}

function emitFailure(result) {
  process.stderr.write(`[runtime-tool-contract] failed ${result.id} status=${String(result.status)}\n`);
  if (result.error_message) {
    process.stderr.write(`${result.error_message}\n`);
  }
  if (result.stdout.trim()) {
    process.stderr.write(`[runtime-tool-contract] stdout ${result.id}\n${result.stdout}`);
    if (!result.stdout.endsWith("\n")) {
      process.stderr.write("\n");
    }
  }
  if (result.stderr.trim()) {
    process.stderr.write(`[runtime-tool-contract] stderr ${result.id}\n${result.stderr}`);
    if (!result.stderr.endsWith("\n")) {
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const contracts = [
    ...gatewayOnlyContracts,
    ...(args.includeRuntimeDescribe ? runtimeDescribeContracts : []),
  ];
  const results = [];
  for (const contract of contracts) {
    const result = runContract(contract);
    results.push(result);
    if (!args.json && result.status === 0) {
      process.stdout.write(`[runtime-tool-contract] ok ${contract.id} duration_ms=${String(result.duration_ms)}\n`);
    }
    if (result.status !== 0) {
      if (!args.json) {
        emitFailure(result);
      }
      break;
    }
  }

  const failed = results.find((result) => result.status !== 0) ?? null;
  const payload = {
    ok: failed === null,
    contract_count: contracts.length,
    completed_count: results.length,
    include_runtime_describe: args.includeRuntimeDescribe,
    failed_contract: failed ? failed.id : null,
    results: results.map(compactResult),
  };
  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    if (failed) {
      emitFailure(failed);
    }
  } else {
    process.stdout.write(`[runtime-tool-contract] summary ${JSON.stringify(payload)}\n`);
  }
  process.exitCode = failed ? 1 : 0;
}

main();
