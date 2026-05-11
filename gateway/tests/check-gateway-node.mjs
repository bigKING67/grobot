#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  runCoreContracts,
  runSemanticBenchmarkFullContracts,
  runSemanticBenchmarkContracts,
} from "./check-gateway-node/gateway-contract-smoke/core-contracts.mjs";
import { CASES } from "./check-gateway-node/case-definitions.mjs";
import { planCaseBuckets } from "./check-gateway-node/case-bucket-planner.mjs";
import { runCasesInWorkers } from "./check-gateway-node/case-worker-runner.mjs";
import { runSessionContracts } from "./check-gateway-node/gateway-contract-smoke/session-contracts.mjs";
import { runPlanCommandContracts } from "./check-gateway-node/gateway-contract-smoke/plan-command-contracts.mjs";
import { runTuiContracts } from "./check-gateway-node/gateway-contract-smoke/tui-contracts.mjs";
import { runMemoryContracts } from "./check-gateway-node/gateway-contract-smoke/memory-contracts.mjs";
import { runContextHistoryContracts } from "./check-gateway-node/gateway-contract-smoke/context-history-contracts.mjs";
import { runContextPromptQualityContracts } from "./check-gateway-node/gateway-contract-smoke/context-prompt-quality-contracts.mjs";
import { runContextGraphContracts } from "./check-gateway-node/gateway-contract-smoke/context-graph-contracts.mjs";
import { runAstHandoffContracts } from "./check-gateway-node/gateway-contract-smoke/ast-handoff-contracts.mjs";
import { runRuntimeStatusSurfaceSmoke } from "./check-gateway-node/runtime-smoke/status-surface.mjs";
import { runRuntimeRecoverySurfaceSmoke } from "./check-gateway-node/runtime-smoke/recovery-surface.mjs";
import {
  runRuntimeExperienceStateControlSurfaceSmoke,
  runRuntimeFailoverCoreSmoke,
  runRuntimeManagementGcControlSurfaceSmoke,
  runRuntimeModelControlSurfaceSmoke,
  runRuntimeNamespaceControlSurfaceSmoke,
  runRuntimeProviderRoutingSmoke,
  runRuntimeProviderStatusSmoke,
  runRuntimeMcpCallSmoke,
  runRuntimeMcpServerSmoke,
  runRuntimeMcpSessionSmoke,
  runRuntimeStartControlSmoke,
  runRuntimeStatusControlSmoke,
  runRuntimeToolDiagnosticSmoke,
  runRuntimeToolContextControlSurfaceSmoke,
  runRuntimeToolLoopSmoke,
} from "./check-gateway-node/runtime-smoke/failover-and-tools.mjs";
import { runRuntimeInteractivePlanFlowSmoke } from "./check-gateway-node/runtime-smoke/interactive-plan-flow.mjs";
import { runRuntimePlanEventsPolicySmoke } from "./check-gateway-node/runtime-smoke/plan-events-policy.mjs";
import {
  runRuntimeContextQualityFlowSmoke,
} from "./check-gateway-node/runtime-smoke/context-quality-flows.mjs";
import { runRuntimeDescribeFallbackSmoke } from "./check-gateway-node/runtime-smoke/runtime-describe-fallbacks.mjs";
import {
  assertSuccess,
  contractsRoot,
  createRunReporter,
  emitJsonReport,
  enforceRetryGate,
  loadBaselineReport,
  logStep,
  parseCliOptions,
  repoRoot,
  runCommand,
  setRunReporter,
  tempDirs,
} from "./check-gateway-node/harness.mjs";

export const SUITES = Object.freeze({
  "gateway:core": {
    description: "Core management/local-tools/runtime-path contracts.",
    run: runCoreContracts,
  },
  "gateway:semantic-benchmark": {
    description: "Semantic retrieval timing benchmark contract.",
    run: runSemanticBenchmarkContracts,
  },
  "gateway:semantic-benchmark-full": {
    description: "Semantic retrieval full timing benchmark contract.",
    run: runSemanticBenchmarkFullContracts,
  },
  "gateway:session": {
    description: "Session lifecycle and resume/rewind contracts.",
    run: runSessionContracts,
  },
  "gateway:plan": {
    description: "Plan command, bridge, slash suggestion, and policy contracts.",
    run: runPlanCommandContracts,
  },
  "gateway:tui": {
    description: "Terminal UI, browser structured MCP, status line, and ask-user contracts.",
    run: runTuiContracts,
  },
  "gateway:memory": {
    description: "Memory, experience, scheduler, and model config contracts.",
    run: runMemoryContracts,
  },
  "gateway:context": {
    description: "Context history, prompt quality, and context graph contracts.",
    async run() {
      await runContextHistoryContracts();
      await runContextPromptQualityContracts();
      await runContextGraphContracts();
    },
  },
  "gateway:ast-handoff": {
    description: "AST extraction and handoff/session-store contracts.",
    run: runAstHandoffContracts,
  },
  "runtime:status": {
    description: "Runtime build, status, interrupt, event stream, and status surface smoke.",
    run: runRuntimeStatusSurfaceSmoke,
  },
  "runtime:recovery": {
    description: "Runtime recovery surface smoke.",
    run: runRuntimeRecoverySurfaceSmoke,
  },
  "runtime:failover-core": {
    description: "Runtime launcher, failover, and recovery-gate smoke.",
    run: runRuntimeFailoverCoreSmoke,
  },
  "runtime:provider-routing": {
    description: "Provider config passthrough and pool routing smoke.",
    run: runRuntimeProviderRoutingSmoke,
  },
  "runtime:provider-status": {
    description: "Provider failure status, clean alternate, and management API smoke.",
    run: runRuntimeProviderStatusSmoke,
  },
  "runtime:namespace-controls": {
    description: "Runtime start/serve namespace and identity rejection smoke.",
    run: runRuntimeNamespaceControlSurfaceSmoke,
  },
  "runtime:start-controls": {
    description: "Runtime start option control rejection smoke.",
    run: runRuntimeStartControlSmoke,
  },
  "runtime:model-controls": {
    description: "Runtime model config control rejection smoke.",
    run: runRuntimeModelControlSurfaceSmoke,
  },
  "runtime:status-controls": {
    description: "Runtime status option control rejection smoke.",
    run: runRuntimeStatusControlSmoke,
  },
  "runtime:experience-state-controls": {
    description: "Experience, storage, and session control rejection smoke.",
    run: runRuntimeExperienceStateControlSurfaceSmoke,
  },
  "runtime:tool-context-controls": {
    description: "Tool-loop, status tool, and context control rejection smoke.",
    run: runRuntimeToolContextControlSurfaceSmoke,
  },
  "runtime:management-gc-controls": {
    description: "Management config and GC input validation smoke.",
    run: runRuntimeManagementGcControlSurfaceSmoke,
  },
  "runtime:tool-loop": {
    description: "Runtime tool loop fail-fast and success smoke.",
    run: runRuntimeToolLoopSmoke,
  },
  "runtime:mcp-call": {
    description: "Runtime MCP call success and timeout smoke.",
    run: runRuntimeMcpCallSmoke,
  },
  "runtime:mcp-session": {
    description: "Runtime MCP session idle reap smoke.",
    run: runRuntimeMcpSessionSmoke,
  },
  "runtime:mcp-server": {
    description: "Runtime MCP server config success smoke.",
    run: runRuntimeMcpServerSmoke,
  },
  "runtime:tool-diagnostics": {
    description: "Runtime tool diagnostic event smoke.",
    run: runRuntimeToolDiagnosticSmoke,
  },
  "runtime:plan": {
    description: "Interactive plan flow and plan event policy smoke.",
    async run() {
      const planEventsPaths = await runRuntimeInteractivePlanFlowSmoke();
      await runRuntimePlanEventsPolicySmoke(planEventsPaths);
    },
  },
  "runtime:context": {
    description: "Context quality runtime flows.",
    run: runRuntimeContextQualityFlowSmoke,
  },
  "runtime:controls": {
    description: "Runtime control rejection smoke for context, experience, tool surface, runtime bin, MCP, and status line controls.",
    async run() {
      assertContextEngineControlSmoke();
      assertExperienceSchedulerControlSmoke();
      assertExperienceRuntimeControlSmoke();
      assertToolSurfaceProfileControlSmoke();
      assertRuntimeBinControlSmoke();
      assertMcpInstructionControlSmoke();
      assertStatusLineControlSmoke();
    },
  },
  "runtime:describe": {
    description: "Runtime describe fallback and management validation smoke.",
    run: runRuntimeDescribeFallbackSmoke,
  },
  "governance:policy": {
    description: "Governance eval policy smoke.",
    run: runGovernanceEvalSmoke,
  },
  workflow: {
    description: "Workflow guard and legacy Python CLI guard.",
    run: runWorkflowGuard,
  },
});

function suiteIds() {
  return Object.keys(SUITES);
}

function caseIdForSuite(suiteId) {
  return `${suiteId}:full`;
}

function caseIds() {
  return [
    ...Object.keys(CASES),
    ...suiteIds().map(caseIdForSuite),
  ];
}

const TIMINGS_PATH = process.env.GROBOT_GATEWAY_TIMINGS_PATH
  ? isAbsolute(process.env.GROBOT_GATEWAY_TIMINGS_PATH)
    ? process.env.GROBOT_GATEWAY_TIMINGS_PATH
    : resolve(repoRoot, process.env.GROBOT_GATEWAY_TIMINGS_PATH)
  : resolve(repoRoot, ".cache/grobot-quality/gateway-timings.json");
const TIMING_CONTEXT_SUITE_WORKER = "suite-worker";
const TIMING_CONTEXT_DEFAULT = "default";
const TIMING_RECENT_SAMPLE_LIMIT = 24;
const TIMING_EWMA_ALPHA = 0.35;
const TIMING_TRIMMED_MIN_SAMPLES = 8;
const TIMING_LAST_SPIKE_RATIO = 1.25;

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function percentileMs(samples, percentile) {
  const values = samples
    .map((value) => positiveNumber(value))
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  if (values.length === 0) {
    return 0;
  }
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil(values.length * percentile) - 1),
  );
  return values[index];
}

function recentTimingSamples(current) {
  return Array.isArray(current?.recentMs)
    ? current.recentMs.map((value) => positiveNumber(value)).filter((value) => value > 0)
    : [];
}

function trimmedRecentTimingSamples(samples) {
  if (samples.length < TIMING_TRIMMED_MIN_SAMPLES) {
    return samples;
  }
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered.slice(0, -1);
}

function currentTimingContext() {
  const raw = String(process.env.GROBOT_GATEWAY_TIMING_CONTEXT ?? "").trim();
  return raw.length > 0 ? raw : TIMING_CONTEXT_DEFAULT;
}

function loadTimings() {
  if (!existsSync(TIMINGS_PATH)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(TIMINGS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function updateTimingStats(current, durationMs, status) {
  const base = current ?? {
    count: 0,
    failures: 0,
    avgMs: 0,
    maxMs: 0,
  };
  const count = Number(base.count ?? 0) + 1;
  const previousAvg = Number(base.avgMs ?? 0);
  const recentMs = [...recentTimingSamples(base), durationMs].slice(-TIMING_RECENT_SAMPLE_LIMIT);
  const previousEwmaMs = positiveNumber(base.ewmaMs);
  const ewmaMs = Math.round(
    previousEwmaMs > 0
      ? (previousEwmaMs * (1 - TIMING_EWMA_ALPHA)) + (durationMs * TIMING_EWMA_ALPHA)
      : durationMs,
  );
  return {
    count,
    failures: Number(base.failures ?? 0) + (status === "ok" ? 0 : 1),
    avgMs: Math.round(((previousAvg * (count - 1)) + durationMs) / count),
    ewmaMs,
    maxMs: Math.max(Number(base.maxMs ?? 0), durationMs),
    p90Ms: percentileMs(recentMs, 0.9),
    recentMs,
    lastMs: durationMs,
    lastStatus: status,
    updatedAt: new Date().toISOString(),
  };
}

function writeTiming(caseId, durationMs, status) {
  const timings = loadTimings();
  const current = timings[caseId] ?? {};
  const contextKey = currentTimingContext();
  const contexts = current.contexts && typeof current.contexts === "object" && !Array.isArray(current.contexts)
    ? current.contexts
    : {};
  timings[caseId] = {
    ...updateTimingStats(current, durationMs, status),
    contexts: {
      ...contexts,
      [contextKey]: updateTimingStats(contexts[contextKey], durationMs, status),
    },
  };
  mkdirSync(resolve(repoRoot, ".cache/grobot-quality"), { recursive: true });
  writeFileSync(TIMINGS_PATH, `${JSON.stringify(timings, null, 2)}\n`, "utf8");
}

function estimateFromStats(stats, seedEstimateMs) {
  const recentSamples = recentTimingSamples(stats);
  const trimmedRecentSamples = trimmedRecentTimingSamples(recentSamples);
  const trimmedRecentP90Ms = percentileMs(trimmedRecentSamples, 0.9);
  const recentP90Ms = percentileMs(recentSamples, 0.9);
  const historicalEstimateMs = positiveNumber(stats?.avgMs);
  const recentEstimateMs = Math.max(
    positiveNumber(stats?.ewmaMs),
    trimmedRecentP90Ms || positiveNumber(stats?.p90Ms),
    trimmedRecentP90Ms || recentP90Ms,
  );
  const count = positiveNumber(stats?.count);
  const maxEstimateMs = positiveNumber(stats?.maxMs);
  const lowConfidenceSpikeMs = count > 0 && count < 3
    ? Math.min(
      maxEstimateMs,
      Math.round(Math.max(seedEstimateMs, historicalEstimateMs, recentEstimateMs, 1) * 1.5),
    )
    : 0;
  const lastMs = positiveNumber(stats?.lastMs);
  const lastSpikeMs = lastMs > 0 && lastMs <= Math.max(seedEstimateMs, recentEstimateMs, historicalEstimateMs, 1) * TIMING_LAST_SPIKE_RATIO
    ? lastMs
    : 0;
  return Math.max(seedEstimateMs, historicalEstimateMs, recentEstimateMs, lowConfidenceSpikeMs, lastSpikeMs);
}

function estimateCaseMs(caseId, splitCase, timings) {
  const current = timings[caseId] ?? {};
  const seedEstimateMs = positiveNumber(splitCase?.seedMs);
  const contexts = current.contexts && typeof current.contexts === "object" && !Array.isArray(current.contexts)
    ? current.contexts
    : {};
  const currentStatsEstimate = estimateFromStats(current, seedEstimateMs);
  const suiteWorkerStats = contexts[TIMING_CONTEXT_SUITE_WORKER] ?? null;
  if (suiteWorkerStats) {
    return Math.max(currentStatsEstimate, estimateFromStats(suiteWorkerStats, seedEstimateMs));
  }
  const defaultStats = contexts[TIMING_CONTEXT_DEFAULT] ?? null;
  if (defaultStats) {
    return Math.max(currentStatsEstimate, estimateFromStats(defaultStats, seedEstimateMs));
  }
  return currentStatsEstimate;
}

function listCases() {
  const timings = loadTimings();
  return caseIds().map((caseId) => {
    const splitCase = CASES[caseId];
    const suiteId = splitCase?.suite ?? caseId.replace(/:full$/, "");
    return {
      id: caseId,
      suite: suiteId,
      description: splitCase?.description ?? SUITES[suiteId]?.description ?? "",
      estimatedMs: estimateCaseMs(caseId, splitCase, timings),
      isolation: "process",
    };
  });
}

function parseShard(value) {
  const match = String(value ?? "").match(/^(\d+)\/(\d+)$/);
  if (!match) {
    throw new Error("--shard must use N/TOTAL format, for example 1/4");
  }
  const index = Number.parseInt(match[1], 10);
  const total = Number.parseInt(match[2], 10);
  if (!Number.isInteger(index) || !Number.isInteger(total) || index <= 0 || total <= 0 || index > total) {
    throw new Error("--shard must use 1-based N/TOTAL values");
  }
  return { index, total };
}

function shardCases(caseIdsToShard, shardValue) {
  if (!shardValue) {
    return caseIdsToShard;
  }
  const { index, total } = parseShard(shardValue);
  const buckets = planCaseBuckets(caseIdsToShard, total, listCases());
  return buckets[index - 1]?.caseIds ?? [];
}

function suiteIdForCase(caseId) {
  return CASES[caseId]?.suite ?? (caseId.endsWith(":full") ? caseId.replace(/:full$/, "") : "");
}

function expandSuitesToCases(suiteIdsToExpand) {
  return suiteIdsToExpand.flatMap((suiteId) => {
    const splitCaseIds = Object.entries(CASES)
      .filter(([, testCase]) => testCase.suite === suiteId && testCase.run?.aggregateOnly !== true)
      .map(([caseId]) => caseId);
    return splitCaseIds.length > 0 ? splitCaseIds : [caseIdForSuite(suiteId)];
  });
}

function readRunPlan(planPath) {
  const resolvedPath = resolve(repoRoot, planPath);
  const payload = JSON.parse(readFileSync(resolvedPath, "utf8"));
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`run plan must be a JSON object: ${resolvedPath}`);
  }
  if (payload.schema !== 1) {
    throw new Error(`unsupported run plan schema: ${String(payload.schema)}`);
  }
  if (!Array.isArray(payload.cases) || payload.cases.some((caseId) => typeof caseId !== "string" || !caseId)) {
    throw new Error("run plan must contain a cases string array");
  }
  return [...new Set(payload.cases)];
}

function writeRunPlan(planPath, caseIdsToWrite, metadata = {}) {
  const resolvedPath = resolve(repoRoot, planPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(
    resolvedPath,
    `${JSON.stringify({
      schema: 1,
      generatedAt: new Date().toISOString(),
      cases: caseIdsToWrite,
      ...metadata,
    }, null, 2)}\n`,
    "utf8",
  );
  return resolvedPath;
}

function resolveSelectedCases(cli) {
  if (cli.run_plan) {
    return readRunPlan(cli.run_plan);
  }
  if (cli.case_ids.length > 0) {
    return [...new Set(cli.case_ids)];
  }
  if (cli.suites.length > 0) {
    return expandSuitesToCases(cli.suites);
  }
  if (cli.mode === "runtime-smoke-only") {
    return expandSuitesToCases(suiteIds().filter((id) => id.startsWith("runtime:")));
  }
  return expandSuitesToCases(suiteIds());
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
    "management-interrupt-contract.mjs",
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
    "turn-gate-contract.ts",
    "bridge-plan-failure-policy-contract.ts",
    "bridge-plan-apply-failure-contract.mjs",
    "bridge-cli-contract.mjs",
    "bridge-error-codes-schema-contract.mjs",
    "plan-events-policy-guard-contract.mjs",
    "start-plan-failure-policy-contract.ts",
    "start-slash-suggestions-contract.ts",
    "ask-user-tool-contract.ts",
    "ga-skill-prompt-contract.ts",
    "cli-interactive-frame-contract.ts",
    "terminal-text-sanitizer-contract.ts",
    "runtime-stdio-event-stream-contract.ts",
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
  if (cli.list_suites) {
    const payload = suiteIds().map((id) => ({
      description: SUITES[id].description,
      id,
    }));
    if (cli.json) {
      console.log(JSON.stringify({ suites: payload }, null, 2));
    } else {
      for (const suite of payload) {
        console.log(`${suite.id}\t${suite.description}`);
      }
    }
    return;
  }
  if (cli.list_cases) {
    const payload = listCases();
    if (cli.json) {
      console.log(JSON.stringify({ cases: payload }, null, 2));
    } else {
      for (const testCase of payload) {
        console.log(`${testCase.id}\t${testCase.description}`);
      }
    }
    return;
  }
  const reporter = createRunReporter({
    mode: cli.case_ids.length > 0 ? "case" : cli.run_plan ? "run-plan" : cli.suites.length > 0 ? "suite" : cli.mode,
    emitText: !cli.json,
    failOnRetry: cli.fail_on_retry,
  });
  const baselineReportPath = cli.baseline_json
    ? resolve(repoRoot, cli.baseline_json)
    : "";
  const baselineReportPayload = baselineReportPath
    ? loadBaselineReport(baselineReportPath)
    : null;
  setRunReporter(reporter);
  try {
    ensureContractsExist();
    async function runCase(caseId) {
      const splitCase = CASES[caseId];
      const suiteId = suiteIdForCase(caseId);
      const suite = SUITES[suiteId];
      if (!splitCase && (!suite || caseId !== caseIdForSuite(suiteId))) {
        throw new Error(`unknown case: ${caseId}`);
      }
      const startedAt = performance.now();
      try {
        if (splitCase) {
          await splitCase.run();
        } else {
          await suite.run();
        }
        const durationMs = Math.round(performance.now() - startedAt);
        writeTiming(caseId, durationMs, "ok");
        reporter.caseResult({
          id: caseId,
          suite: suiteId,
          status: "ok",
          duration_ms: durationMs,
          split: Boolean(splitCase),
        });
      } catch (error) {
        const durationMs = Math.round(performance.now() - startedAt);
        writeTiming(caseId, durationMs, "failed");
        reporter.caseResult({
          id: caseId,
          suite: suiteId,
          status: "failed",
          duration_ms: durationMs,
          split: Boolean(splitCase),
          error_message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    const rawSelectedCases = resolveSelectedCases(cli);
    const knownCaseIds = new Set(listCases().map((testCase) => testCase.id));
    const unknownCases = rawSelectedCases.filter((caseId) => !knownCaseIds.has(caseId));
    if (unknownCases.length > 0) {
      throw new Error(`unknown case: ${unknownCases.join(", ")}`);
    }
    const selectedCases = shardCases(rawSelectedCases, cli.shard);
    if (cli.write_run_plan) {
      const outputPath = writeRunPlan(cli.write_run_plan, selectedCases, {
        selection: {
          mode: cli.mode,
          suites: cli.suites,
          source: cli.run_plan ? "run-plan" : cli.case_ids.length > 0 ? "case" : cli.suites.length > 0 ? "suite" : cli.mode,
        },
      });
      if (cli.json) {
        console.log(JSON.stringify({ path: outputPath, schema: 1, cases: selectedCases }, null, 2));
      } else {
        process.stdout.write(`gateway run plan written: ${outputPath}\n`);
      }
      return;
    }
    const workerRan = await runCasesInWorkers(selectedCases, cli.workers, listCases(), reporter);
    if (!workerRan) {
      for (const caseId of selectedCases) {
        await runCase(caseId);
      }
    }
    enforceRetryGate(cli, reporter);
    reporter.finish("ok");
    if (cli.json || cli.json_output) {
      emitJsonReport(cli, reporter, baselineReportPath, baselineReportPayload);
    }
    if (!cli.json) {
      if (cli.suites.length > 0) {
        process.stdout.write(`gateway suite checks completed: ${cli.suites.join(", ")}.\n`);
        return;
      }
      if (cli.case_ids.length > 0 || cli.run_plan) {
        process.stdout.write(`gateway case checks completed: ${selectedCases.join(", ")}.\n`);
        return;
      }
      if (cli.mode === "runtime-smoke-only") {
        process.stdout.write("gateway runtime smoke checks completed.\n");
        return;
      }
      process.stdout.write("gateway node checks completed.\n");
    }
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reporter.finish("failed", message);
    if (cli.json || cli.json_output) {
      emitJsonReport(cli, reporter, baselineReportPath, baselineReportPayload);
    }
    throw error;
  } finally {
    setRunReporter(null);
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
