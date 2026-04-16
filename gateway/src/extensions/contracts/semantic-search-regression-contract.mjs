#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..", "..", "..", "..");
const bridgeScript = resolve(repoRoot, "adapters/contextweaver/bridge/cli.mjs");

function parseArgs(argv) {
  const command = String(argv[0] ?? "").trim();
  if (!command) {
    throw new Error("missing command");
  }
  if (argv.length > 1) {
    throw new Error(`unknown argument: ${String(argv[1] ?? "")}`);
  }
  return { command };
}

function makeTempDir(prefix) {
  return mkdtempSync(resolve(tmpdir(), `${prefix}-`));
}

function writeExecutable(path, content) {
  writeFileSync(path, content, "utf8");
  chmodSync(path, 0o755);
}

function writeFixtureTree(rootPath, sourceCount = 8) {
  const sourceRoots = [];
  for (let index = 1; index <= sourceCount; index += 1) {
    const sourceRoot = resolve(rootPath, `source-${String(index)}`);
    const srcDir = resolve(sourceRoot, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      resolve(srcDir, `module-${String(index)}.ts`),
      `export const marker${String(index)} = "source-${String(index)}";\n`,
      "utf8",
    );
    sourceRoots.push(sourceRoot);
  }
  return sourceRoots;
}

function writeQualityFixtures(rootPath) {
  const codeRoot = resolve(rootPath, "code");
  const srcDir = resolve(codeRoot, "src");
  const docsDir = resolve(codeRoot, "docs");
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(
    resolve(srcDir, "retry-policy.ts"),
    [
      "export function resolveRetryPolicy() {",
      "  // retry budget overflow handling",
      "  return \"retry budget overflow handling\";",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    resolve(srcDir, "session-policy.ts"),
    [
      "export const sessionPersistPolicy = \"on_start\";",
      "export function shouldRecover() {",
      "  return sessionPersistPolicy === \"on_start\";",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    resolve(docsDir, "notes.md"),
    [
      "# Notes",
      "retry budget is bounded",
      "overflow is prevented by backoff",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    resolve(docsDir, "retry-guide.zh.md"),
    [
      "# 重试指南",
      "重试预算溢出处理与退避策略。",
      "建议优先启用指数退避并限制最大重试次数。",
      "",
    ].join("\n"),
    "utf8",
  );
  return codeRoot;
}

function writeFakeContextWeaverBin(rootPath) {
  const binPath = resolve(rootPath, "cw-fake.mjs");
  const content = `#!/usr/bin/env node
const command = String(process.argv[2] ?? "").trim();
const mode = String(process.env.CW_FAKE_MODE ?? "semantic").trim();
const indexDelayMs = Number.parseInt(String(process.env.CW_FAKE_INDEX_DELAY_MS ?? "0"), 10);
const searchDelayMs = Number.parseInt(String(process.env.CW_FAKE_SEARCH_DELAY_MS ?? "0"), 10);
const informationRequestIndex = process.argv.indexOf("--information-request");
const informationRequest = informationRequestIndex >= 0
  ? String(process.argv[informationRequestIndex + 1] ?? "").toLowerCase()
  : "";
const preferRetry = informationRequest.includes("retry budget overflow handling");
const sleep = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) {
    return;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.floor(ms));
};
const writeJson = (payload) => {
  process.stdout.write(\`\${JSON.stringify(payload)}\\n\`);
};
if (command === "index") {
  sleep(indexDelayMs);
  writeJson({ indexed: true });
  process.exit(0);
}
if (mode === "index-missing") {
  process.stderr.write("run \\\`cw index\\\` before search\\n");
  process.exit(1);
}
if (mode === "benchmark") {
  sleep(searchDelayMs);
  writeJson({
    files: [{
      path: "src/bench.ts",
      segments: [{
        startLine: 1,
        endLine: 1,
        score: 0.81,
        breadcrumb: "benchmark.mock",
        text: "benchmark evidence",
      }],
    }],
  });
  process.exit(0);
}
if (command === "search") {
  if (mode === "semantic-zh") {
    writeJson({
      files: [
        {
          path: "src/session-policy.ts",
          segments: [
            {
              startLine: 1,
              endLine: 3,
              score: 0.31,
              breadcrumb: "session.policy",
              text: "session persist on_start for fast recovery",
            },
          ],
        },
        {
          path: "docs/retry-guide.zh.md",
          segments: [
            {
              startLine: 2,
              endLine: 3,
              score: 0.92,
              breadcrumb: "docs.retry.zh",
              text: "重试预算溢出处理与退避策略",
            },
          ],
        },
      ],
    });
    process.exit(0);
  }
  writeJson({
    files: [
      {
        path: "src/session-policy.ts",
        segments: [
          {
            startLine: 1,
            endLine: 3,
            score: preferRetry ? 0.51 : 0.93,
            breadcrumb: "session.policy",
            text: "session persist on_start for fast recovery",
          },
          {
            startLine: 4,
            endLine: 6,
            score: 0.41,
            breadcrumb: "session.policy.detail",
            text: "backup evidence",
          },
        ],
      },
      {
        path: "src/retry-policy.ts",
        segments: [
          {
            startLine: 1,
            endLine: 3,
            score: preferRetry ? 0.95 : 0.57,
            breadcrumb: "retry.policy",
            text: "retry budget overflow handling",
          },
          {
            startLine: 1,
            endLine: 3,
            score: 0.22,
            breadcrumb: "retry.policy.duplicate",
            text: "retry budget overflow handling duplicate copy",
          },
        ],
      },
    ],
  });
  process.exit(0);
}
if (command === "prompt-context") {
  writeJson({
    language: "en",
    technicalTerms: ["sessionPersistPolicy", "on_start"],
    retrieval: {
      status: "ok",
      topPaths: ["src/session-policy.ts"],
      evidence: [
        {
          path: "src/session-policy.ts",
          startLine: 1,
          endLine: 3,
          score: 0.9,
          breadcrumb: "session.policy",
          text: "session persist on_start for fast recovery",
        },
      ],
    },
  });
  process.exit(0);
}
process.stderr.write(\`unsupported command: \${command}\\n\`);
process.exit(1);
`;
  writeExecutable(binPath, content);
  return binPath;
}

function runBridge(command, payload, env, cwd, timeoutMs = 120_000) {
  const result = spawnSync(
    process.execPath,
    [bridgeScript, command, "--payload", JSON.stringify(payload), "--timeout-ms", String(timeoutMs)],
    {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.error) {
    throw new Error(`bridge command failed to start: ${String(result.error.message ?? result.error)}`);
  }
  const stdout = String(result.stdout ?? "").trim();
  const stderr = String(result.stderr ?? "").trim();
  const status = typeof result.status === "number" ? result.status : 1;
  if (status !== 0) {
    let parsedError = null;
    if (stderr) {
      try {
        parsedError = JSON.parse(stderr.split(/\r?\n/).filter(Boolean).at(-1) ?? "{}");
      } catch {
        parsedError = null;
      }
    }
    const errorClass = parsedError && typeof parsedError.error_class === "string"
      ? parsedError.error_class
      : "bridge_failed";
    const message = parsedError && typeof parsedError.message === "string"
      ? parsedError.message
      : (stderr || stdout || `bridge exited with code ${String(status)}`);
    throw new Error(`${errorClass}: ${message}`);
  }
  if (!stdout) {
    throw new Error("bridge returned empty stdout");
  }
  return JSON.parse(stdout);
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.max(0, Math.min(sorted.length - 1, rank));
  return sorted[index];
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function runQualityRegression() {
  const tempRoot = makeTempDir("semantic-quality");
  try {
    const codeRoot = writeQualityFixtures(tempRoot);
    const fakeBin = writeFakeContextWeaverBin(tempRoot);
    const semanticPayload = runBridge(
      "semantic-search",
      {
        query: "session persist on_start recovery",
        technicalTerms: ["sessionPersistPolicy", "on_start"],
        sourceRoots: [{ source: "code", rootPath: codeRoot }],
        perSourceLimit: 4,
        maxSegments: 8,
        refresh: "skip",
      },
      {
        CONTEXTWEAVER_BIN: fakeBin,
        CW_FAKE_MODE: "semantic",
      },
      codeRoot,
    );
    assert.equal(semanticPayload.tool, "semantic_search");
    assert.equal(Array.isArray(semanticPayload.matches), true);
    assert.equal(semanticPayload.matches.length >= 1, true);
    const semanticTop = semanticPayload.matches[0];
    assert.equal(String(semanticTop.path ?? ""), "src/session-policy.ts");
    assert.equal(String(semanticTop.text ?? "").includes("on_start"), true);
    assert.equal(Number(semanticPayload.count) >= 3, true);
    assert.equal(Array.isArray(semanticPayload.source_stats), true);
    const semanticSource = Array.isArray(semanticPayload.source_stats) ? semanticPayload.source_stats[0] : null;
    assert.equal(String(semanticSource?.fusion ?? ""), "semantic_only");
    assert.equal(Number(semanticSource?.semantic_count ?? 0) >= 1, true);
    assert.equal(Number(semanticSource?.lexical_count ?? 0), 0);

    const rerankedPayload = runBridge(
      "semantic-search",
      {
        query: "retry budget overflow handling",
        technicalTerms: ["retry", "overflow"],
        sourceRoots: [{ source: "code", rootPath: codeRoot }],
        perSourceLimit: 8,
        maxSegments: 8,
        refresh: "skip",
      },
      {
        CONTEXTWEAVER_BIN: fakeBin,
        CW_FAKE_MODE: "semantic",
      },
      codeRoot,
    );
    assert.equal(rerankedPayload.tool, "semantic_search");
    assert.equal(Array.isArray(rerankedPayload.matches), true);
    assert.equal(rerankedPayload.matches.length >= 1, true);
    assert.equal(Number(rerankedPayload.count) >= 3, true);
    const rerankedTop = rerankedPayload.matches[0];
    assert.equal(String(rerankedTop.path ?? ""), "src/retry-policy.ts");
    assert.equal(String(rerankedTop.text ?? "").includes("retry budget overflow handling"), true);

    const zhPayload = runBridge(
      "semantic-search",
      {
        query: "重试预算溢出处理",
        technicalTerms: ["重试预算", "溢出处理"],
        sourceRoots: [{ source: "code", rootPath: codeRoot }],
        perSourceLimit: 8,
        maxSegments: 8,
        refresh: "skip",
      },
      {
        CONTEXTWEAVER_BIN: fakeBin,
        CW_FAKE_MODE: "semantic-zh",
      },
      codeRoot,
    );
    assert.equal(zhPayload.tool, "semantic_search");
    assert.equal(Array.isArray(zhPayload.matches), true);
    assert.equal(zhPayload.matches.length >= 1, true);
    const zhTop = zhPayload.matches[0];
    assert.equal(String(zhTop.path ?? ""), "docs/retry-guide.zh.md");
    assert.equal(String(zhTop.text ?? "").includes("重试预算溢出处理"), true);

    const fallbackPayload = runBridge(
      "semantic-search",
      {
        query: "retry budget overflow handling",
        sourceRoots: [{ source: "code", rootPath: codeRoot }],
        perSourceLimit: 4,
        maxSegments: 8,
        refresh: "auto",
      },
      {
        CONTEXTWEAVER_BIN: fakeBin,
        CW_FAKE_MODE: "index-missing",
      },
      codeRoot,
    );
    assert.equal(fallbackPayload.tool, "semantic_search");
    assert.equal(Array.isArray(fallbackPayload.matches), true);
    assert.equal(fallbackPayload.matches.length >= 1, true);
    const fallbackTop = fallbackPayload.matches[0];
    assert.equal(String(fallbackTop.path ?? "").endsWith("src/retry-policy.ts"), true);
    assert.equal(String(fallbackTop.breadcrumb ?? ""), "lexical_fallback");
    assert.equal(String(fallbackTop.text ?? "").includes("retry budget overflow handling"), true);

    const zhFallbackPayload = runBridge(
      "semantic-search",
      {
        query: "重试预算溢出处理",
        sourceRoots: [{ source: "code", rootPath: codeRoot }],
        perSourceLimit: 4,
        maxSegments: 8,
        refresh: "auto",
      },
      {
        CONTEXTWEAVER_BIN: fakeBin,
        CW_FAKE_MODE: "index-missing",
      },
      codeRoot,
    );
    assert.equal(zhFallbackPayload.tool, "semantic_search");
    assert.equal(Array.isArray(zhFallbackPayload.matches), true);
    assert.equal(zhFallbackPayload.matches.length >= 1, true);
    const zhFallbackTop = zhFallbackPayload.matches[0];
    assert.equal(String(zhFallbackTop.path ?? "").endsWith("docs/retry-guide.zh.md"), true);
    assert.equal(String(zhFallbackTop.breadcrumb ?? ""), "lexical_fallback");
    assert.equal(String(zhFallbackTop.text ?? "").includes("重试预算溢出处理"), true);

    return {
      passed: true,
      semantic_top_path: semanticTop.path,
      semantic_top_score: semanticTop.score,
      reranked_top_path: rerankedTop.path,
      reranked_top_score: rerankedTop.score,
      reranked_count: rerankedPayload.count,
      zh_top_path: zhTop.path,
      zh_top_score: zhTop.score,
      fallback_top_path: fallbackTop.path,
      fallback_top_score: fallbackTop.score,
      fallback_warning_count: Array.isArray(fallbackPayload.warnings) ? fallbackPayload.warnings.length : 0,
      zh_fallback_top_path: zhFallbackTop.path,
      zh_fallback_top_score: zhFallbackTop.score,
      zh_fallback_warning_count: Array.isArray(zhFallbackPayload.warnings) ? zhFallbackPayload.warnings.length : 0,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runBenchmark() {
  const tempRoot = makeTempDir("semantic-benchmark");
  try {
    const sourceRootsAll = writeFixtureTree(tempRoot, 8);
    const fakeBin = writeFakeContextWeaverBin(tempRoot);
    const sourceCounts = [1, 2, 4, 8];
    const refreshModes = ["skip", "force"];
    const iterations = 8;
    const rows = [];
    for (const refresh of refreshModes) {
      for (const sourceCount of sourceCounts) {
        const sourceRoots = sourceRootsAll
          .slice(0, sourceCount)
          .map((rootPath) => ({ source: "code", rootPath }));
        const samples = [];
        for (let index = 0; index < iterations; index += 1) {
          const startedAt = Date.now();
          const payload = runBridge(
            "semantic-search",
            {
              query: "benchmark query",
              sourceRoots,
              perSourceLimit: 2,
              maxSegments: 2,
              sourceConcurrency: 3,
              refresh,
            },
            {
              CONTEXTWEAVER_BIN: fakeBin,
              CW_FAKE_MODE: "benchmark",
              CW_FAKE_SEARCH_DELAY_MS: "8",
              CW_FAKE_INDEX_DELAY_MS: "18",
            },
            tempRoot,
          );
          assert.equal(payload.tool, "semantic_search");
          samples.push(Date.now() - startedAt);
        }
        const p50 = percentile(samples, 50);
        const p95 = percentile(samples, 95);
        rows.push({
          refresh,
          source_count: sourceCount,
          sample_count: samples.length,
          p50_ms: p50,
          p95_ms: p95,
          min_ms: Math.min(...samples),
          max_ms: Math.max(...samples),
          mean_ms: Number(mean(samples).toFixed(2)),
        });
      }
    }
    const comparisons = sourceCounts.map((sourceCount) => {
      const skipRow = rows.find((row) => row.refresh === "skip" && row.source_count === sourceCount);
      const forceRow = rows.find((row) => row.refresh === "force" && row.source_count === sourceCount);
      const p50Delta = Number((Number(forceRow?.p50_ms ?? 0) - Number(skipRow?.p50_ms ?? 0)).toFixed(2));
      const p95Delta = Number((Number(forceRow?.p95_ms ?? 0) - Number(skipRow?.p95_ms ?? 0)).toFixed(2));
      return {
        source_count: sourceCount,
        p50_delta_ms: p50Delta,
        p95_delta_ms: p95Delta,
      };
    });
    assert.equal(rows.length, sourceCounts.length * refreshModes.length);
    for (const row of rows) {
      assert.equal(Number(row.p50_ms) > 0, true);
      assert.equal(Number(row.p95_ms) >= Number(row.p50_ms), true);
    }
    for (const refresh of refreshModes) {
      const source1 = rows.find((row) => row.refresh === refresh && row.source_count === 1);
      const source8 = rows.find((row) => row.refresh === refresh && row.source_count === 8);
      assert.equal(source1 !== undefined, true);
      assert.equal(source8 !== undefined, true);
      assert.equal(Number(source8?.p50_ms ?? 0) > Number(source1?.p50_ms ?? 0), true);
    }
    const p50PositiveDeltaCount = comparisons.filter((row) => Number(row.p50_delta_ms) > 0).length;
    for (const row of comparisons) {
      // Timing jitter can make tail latency noisy; enforce non-regression on p50.
      assert.equal(Number(row.p50_delta_ms) >= 0, true);
    }
    assert.equal(p50PositiveDeltaCount >= 1, true);
    return {
      passed: true,
      config: {
        iterations,
        source_counts: sourceCounts,
        refresh_modes: refreshModes,
      },
      rows,
      comparisons,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function resolveScenario(command) {
  switch (command) {
    case "quality-regression":
      return runQualityRegression();
    case "benchmark":
      return runBenchmark();
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

function runCli(argv) {
  const { command } = parseArgs(argv);
  const payload = resolveScenario(command);
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  return 0;
}

const entryScript = process.argv[1] ?? "";
const shouldRun = entryScript.includes("semantic-search-regression-contract");
if (shouldRun) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`semantic-search-regression-contract fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}

export { runCli };
