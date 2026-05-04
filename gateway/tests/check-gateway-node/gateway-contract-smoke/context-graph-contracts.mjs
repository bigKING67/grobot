import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertSuccess,
  contractsRoot,
  isRecord,
  logStep,
  makeTempDir,
  parseJsonOutput,
  runCommand,
  runCommandAsync,
  runContract,
  runTsContract,
  writeFixtureFile,
} from "../harness.mjs";
export async function runContextGraphContracts() {
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
}
