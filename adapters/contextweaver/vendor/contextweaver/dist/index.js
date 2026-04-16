#!/usr/bin/env node
import {
  initProjectConfigCommand,
  installBundledSkills,
  resolveSkillInstallTarget,
  runCleanIndexes,
  runIndexCommand
} from "./chunk-BV4YBNBI.js";
import {
  ScanStageError
} from "./chunk-GYK2PYHT.js";
import {
  EmbeddingFatalError
} from "./chunk-WQHSYTJN.js";
import "./chunk-35HO3GPM.js";
import {
  logger
} from "./chunk-44FXLQ5V.js";
import "./chunk-CA4WQHZS.js";

// src/index.ts
import { promises as fs, realpathSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import cac from "cac";
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var pkgPath = path.resolve(__dirname, "../package.json");
var pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
var cli = cac("contextweaver");
function normalizeCliArgs(argv) {
  if (argv.length === 0) {
    return ["--help"];
  }
  if (argv.length === 1 && argv[0] === "help") {
    return ["--help"];
  }
  return argv;
}
function formatEmbeddingFailureDiagnostics(error) {
  if (!(error instanceof EmbeddingFatalError)) {
    return null;
  }
  const diagnostics = error.diagnostics;
  const endpointPath = sanitizeEndpointPath(diagnostics.endpointPath);
  return [
    `\u9636\u6BB5: ${formatUnknownValue(diagnostics.stage)}`,
    `\u9519\u8BEF\u7C7B\u522B: ${formatUnknownValue(diagnostics.category)}`,
    `HTTP \u72B6\u6001: ${formatUnknownValue(diagnostics.httpStatus)}`,
    `Provider type: ${formatNoneValue(diagnostics.providerType)}`,
    `Provider code: ${formatNoneValue(diagnostics.providerCode)}`,
    `Provider message: ${formatUnknownValue(diagnostics.upstreamMessage)}`,
    `Endpoint: ${formatEndpoint(diagnostics.endpointHost, endpointPath)}`,
    `Model: ${formatUnknownValue(diagnostics.model)}`,
    `Batch size: ${formatUnknownValue(diagnostics.batchSize)}`,
    `Dimensions: ${formatUnknownValue(diagnostics.dimensions)}`,
    `Request items: ${formatUnknownValue(diagnostics.requestCount)}`
  ];
}
function sanitizeEndpointPath(endpointPath) {
  const safePath = endpointPath.split("?")[0] || "/";
  return safePath.startsWith("/") ? safePath : `/${safePath}`;
}
function formatEndpoint(endpointHost, endpointPath) {
  const host = formatUnknownValue(endpointHost);
  const path2 = formatUnknownValue(endpointPath);
  return host === "<unknown>" ? "<unknown>" : `${host}${path2}`;
}
function formatUnknownValue(value) {
  if (value === null || value === void 0) {
    return "<unknown>";
  }
  if (typeof value === "string") {
    return value.trim() === "" ? "<unknown>" : value;
  }
  return String(value);
}
function formatNoneValue(value) {
  if (value === null || value === void 0 || value.trim() === "") {
    return "<none>";
  }
  return value;
}
var SKIP_REASON_LABELS = {
  large_file: "\u5927\u6587\u4EF6",
  binary_file: "\u4E8C\u8FDB\u5236\u6587\u4EF6",
  ignored_json: "\u5FFD\u7565\u7684 JSON",
  no_indexable_chunks: "\u65E0\u53EF\u7D22\u5F15 chunk",
  processing_error: "\u5904\u7406\u5931\u8D25"
};
function formatSkipReasons(skippedByReason) {
  const parts = Object.entries(SKIP_REASON_LABELS).map(([bucket, label]) => {
    const count = skippedByReason[bucket];
    return count && count > 0 ? `${label} ${count}` : null;
  }).filter((part) => part !== null);
  if (parts.length === 0) {
    return null;
  }
  return `\u8DF3\u8FC7\u539F\u56E0: ${parts.join(", ")}`;
}
function formatStatsLine(stats) {
  return `\u603B\u6570:${stats.totalFiles} \u65B0\u589E:${stats.added} \u4FEE\u6539:${stats.modified} \u672A\u53D8:${stats.unchanged} \u5220\u9664:${stats.deleted} \u8DF3\u8FC7:${stats.skipped} \u9519\u8BEF:${stats.errors}`;
}
function formatKnownStatsLine(stats) {
  return `\u5DF2\u77E5\u7EDF\u8BA1: ${formatStatsLine(stats)}`;
}
function getSuccessConclusion(stats) {
  const hasIndexableChanges = stats.added > 0 || stats.modified > 0;
  const hasSyncOnlyWork = !hasIndexableChanges && ((stats.vectorIndex?.deleted ?? 0) > 0 || stats.visibility.selfHealFiles > 0 || stats.deleted > 0);
  if (!hasIndexableChanges && !hasSyncOnlyWork) {
    return "\u7D22\u5F15\u5B8C\u6210\uFF1A\u6CA1\u6709\u68C0\u6D4B\u5230\u65B0\u7684\u53EF\u7D22\u5F15\u53D8\u66F4";
  }
  if (hasSyncOnlyWork) {
    return "\u7D22\u5F15\u5B8C\u6210\uFF1A\u5DF2\u540C\u6B65\u5220\u9664\u6216\u81EA\u6108\uFF0C\u65E0\u65B0\u589E\u5411\u91CF\u5D4C\u5165";
  }
  return "\u7D22\u5F15\u5B8C\u6210\uFF1A\u7D22\u5F15\u5DF2\u66F4\u65B0";
}
function renderSuccessSummary(stats, duration) {
  const lines = [getSuccessConclusion(stats), `\u8017\u65F6: ${duration}s`, formatStatsLine(stats)];
  const skipReasons = stats.skipped > 0 ? formatSkipReasons(stats.skippedByReason) : null;
  if (skipReasons) {
    lines.push(skipReasons);
  }
  return lines;
}
function findEmbeddingFatalError(error) {
  if (error instanceof EmbeddingFatalError) {
    return error;
  }
  if (error instanceof ScanStageError && error.cause instanceof EmbeddingFatalError) {
    return error.cause;
  }
  return null;
}
function renderFailureSummary(error) {
  const source = error;
  const lines = [`\u7D22\u5F15\u5931\u8D25\uFF1A${source.message || "\u672A\u77E5\u9519\u8BEF"}`];
  if (error instanceof ScanStageError) {
    lines.push(`\u5931\u8D25\u9636\u6BB5: ${error.stage}`);
    if (error.partialStats) {
      lines.push(formatKnownStatsLine(error.partialStats));
      const skipReasons = formatSkipReasons(error.partialStats.skippedByReason);
      if (skipReasons) {
        lines.push(skipReasons);
      }
    }
  }
  const fatal = findEmbeddingFatalError(error);
  const diagnosticsLines = fatal ? formatEmbeddingFailureDiagnostics(fatal) : null;
  if (diagnosticsLines) {
    lines.push(...diagnosticsLines);
  }
  return lines;
}
async function runIndexCliCommand(options) {
  const startTime = Date.now();
  const run = options.runIndexCommandFn ?? runIndexCommand;
  const output = options.logger ?? logger;
  const exit = options.exit ?? ((code) => process.exit(code));
  try {
    const stats = await run({
      rootPath: options.rootPath,
      force: options.force,
      yes: options.yes,
      isInteractive: options.isInteractive
    });
    const duration = ((Date.now() - startTime) / 1e3).toFixed(2);
    for (const line of renderSuccessSummary(stats, duration)) {
      output.info(line);
    }
  } catch (err) {
    for (const line of renderFailureSummary(err)) {
      output.error(line);
    }
    exit(1);
  }
}
if (process.argv.includes("-v") || process.argv.includes("--version")) {
  console.log(pkg.version);
  process.exit(0);
}
cli.command("init", "\u521D\u59CB\u5316 ContextWeaver \u914D\u7F6E").action(async () => {
  const configDir = path.join(os.homedir(), ".contextweaver");
  const envFile = path.join(configDir, ".env");
  logger.info("\u5F00\u59CB\u521D\u59CB\u5316 ContextWeaver...");
  try {
    await fs.mkdir(configDir, { recursive: true });
    logger.info(`\u521B\u5EFA\u914D\u7F6E\u76EE\u5F55: ${configDir}`);
  } catch (err) {
    const error = err;
    if (error.code !== "EEXIST") {
      logger.error({ err, stack: error.stack }, `\u521B\u5EFA\u914D\u7F6E\u76EE\u5F55\u5931\u8D25: ${error.message}`);
      process.exit(1);
    }
    logger.info(`\u914D\u7F6E\u76EE\u5F55\u5DF2\u5B58\u5728: ${configDir}`);
  }
  try {
    await fs.access(envFile);
    logger.warn(`.env \u6587\u4EF6\u5DF2\u5B58\u5728: ${envFile}`);
    logger.info("\u521D\u59CB\u5316\u5B8C\u6210\uFF01");
    return;
  } catch {
  }
  const defaultEnvContent = `# ContextWeaver \u793A\u4F8B\u73AF\u5883\u53D8\u91CF\u914D\u7F6E\u6587\u4EF6

# Embedding API \u914D\u7F6E\uFF08\u5FC5\u9700\uFF09
EMBEDDINGS_API_KEY=your-api-key-here
EMBEDDINGS_BASE_URL=https://api.siliconflow.cn/v1/embeddings
EMBEDDINGS_MODEL=BAAI/bge-m3
EMBEDDINGS_BATCH_SIZE=10
EMBEDDINGS_MAX_CONCURRENCY=10
EMBEDDINGS_DIMENSIONS=1024
EMBEDDINGS_MAX_INPUT_TOKENS=8192

# Reranker \u914D\u7F6E\uFF08\u5FC5\u9700\uFF09
RERANK_API_KEY=your-api-key-here
RERANK_BASE_URL=https://api.siliconflow.cn/v1/rerank
RERANK_MODEL=BAAI/bge-reranker-v2-m3
RERANK_TOP_N=20

`;
  try {
    await fs.writeFile(envFile, defaultEnvContent);
    logger.info(`\u521B\u5EFA .env \u6587\u4EF6: ${envFile}`);
  } catch (err) {
    const error = err;
    logger.error({ err, stack: error.stack }, `\u521B\u5EFA .env \u6587\u4EF6\u5931\u8D25: ${error.message}`);
    process.exit(1);
  }
  logger.info("\u4E0B\u4E00\u6B65\u64CD\u4F5C:");
  logger.info(`   1. \u7F16\u8F91\u914D\u7F6E\u6587\u4EF6: ${envFile}`);
  logger.info("   2. \u586B\u5199\u4F60\u7684 API Key \u548C\u5176\u4ED6\u914D\u7F6E");
  logger.info("\u521D\u59CB\u5316\u5B8C\u6210\uFF01");
});
cli.command("index [path]", "\u626B\u63CF\u4EE3\u7801\u5E93\u5E76\u5EFA\u7ACB\u7D22\u5F15").option("-f, --force", "\u5F3A\u5236\u91CD\u65B0\u7D22\u5F15").option("-y, --yes", "\u8DF3\u8FC7\u786E\u8BA4\u9884\u89C8\uFF0C\u76F4\u63A5\u5F00\u59CB\u7D22\u5F15").action(async (targetPath, options) => {
  const rootPath = targetPath ? path.resolve(targetPath) : process.cwd();
  await runIndexCliCommand({
    rootPath,
    force: options.force,
    yes: options.yes,
    isInteractive: Boolean(process.stdin.isTTY && process.stdout.isTTY)
  });
});
cli.command("init-project", "\u521D\u59CB\u5316\u5F53\u524D\u76EE\u5F55\u7684 cwconfig.json").option("-f, --force", "\u8986\u76D6\u5DF2\u6709 cwconfig.json").action(async (options) => {
  try {
    const configPath = await initProjectConfigCommand({
      cwd: process.cwd(),
      force: options.force === true
    });
    logger.info(`\u521B\u5EFA\u9879\u76EE\u914D\u7F6E\u6587\u4EF6: ${configPath}`);
    logger.info("includePatterns \u7701\u7565\u65F6\u8868\u793A\u6309\u9ED8\u8BA4\u89C4\u5219\u7D22\u5F15\u6574\u4E2A\u9879\u76EE");
    logger.info("ignorePatterns \u53EF\u7528\u4E8E\u6392\u9664\u9879\u76EE\u4E2D\u7684\u751F\u6210\u76EE\u5F55\u6216\u4F4E\u4EF7\u503C\u8DEF\u5F84");
  } catch (err) {
    const error = err;
    logger.error({ err, stack: error.stack }, `\u521D\u59CB\u5316\u9879\u76EE\u914D\u7F6E\u5931\u8D25: ${error.message}`);
    process.exit(1);
  }
});
cli.command("install-skills", "\u5B89\u88C5\u5185\u7F6E Skill \u5230\u76EE\u6807\u76EE\u5F55").option("--dir <path>", "\u5B89\u88C5\u76EE\u5F55\uFF08\u9ED8\u8BA4\u5F53\u524D\u76EE\u5F55\uFF09").option("-f, --force", "\u8986\u76D6\u5DF2\u5B58\u5728\u7684 Skill \u76EE\u5F55").action(async (options) => {
  try {
    const resolvedTarget = resolveSkillInstallTarget({
      cwd: process.cwd(),
      targetDir: options.dir
    });
    const installed = await installBundledSkills({
      targetDir: resolvedTarget,
      force: options.force === true
    });
    logger.info(`\u5DF2\u5B89\u88C5 ${installed.length} \u4E2A Skill \u5230: ${resolvedTarget}`);
    for (const skill of installed) {
      logger.info(`- ${skill.name}`);
    }
  } catch (err) {
    const error = err;
    logger.error({ err, stack: error.stack }, `\u5B89\u88C5 Skill \u5931\u8D25: ${error.message}`);
    process.exit(1);
  }
});
cli.command("clean", "\u4EA4\u4E92\u5F0F\u6E05\u7406\u5931\u6548\u7D22\u5F15").option("-y, --yes", "\u8DF3\u8FC7\u786E\u8BA4\uFF0C\u76F4\u63A5\u5220\u9664\u5931\u6548\u7D22\u5F15").option("--dry-run", "\u4EC5\u663E\u793A\u5F85\u6E05\u7406\u7D22\u5F15\uFF0C\u4E0D\u6267\u884C\u5220\u9664").action(async (options) => {
  try {
    const result = await runCleanIndexes({
      isInteractive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
      yes: options.yes,
      dryRun: options.dryRun,
      writeLine: (line) => logger.info(line)
    });
    if (result.deletedProjectIds.length > 0) {
      logger.info(`\u5DF2\u5220\u9664 ${result.deletedProjectIds.length} \u4E2A\u5931\u6548\u7D22\u5F15`);
    }
    if (result.prunedProjectIds.length > 0) {
      logger.info(`\u5DF2\u6E05\u7406 ${result.prunedProjectIds.length} \u6761\u7F3A\u5931\u7D22\u5F15\u8BB0\u5F55`);
    }
    if (result.failedProjectIds.length > 0) {
      throw new Error(`\u90E8\u5206\u7D22\u5F15\u5220\u9664\u5931\u8D25: ${result.failedProjectIds.join(", ")}`);
    }
  } catch (err) {
    const error = err;
    logger.error({ err, stack: error.stack }, `\u6E05\u7406\u5931\u8D25: ${error.message}`);
    process.exit(1);
  }
});
cli.command("search", "\u672C\u5730\u68C0\u7D22\uFF08\u53C2\u6570\u5BF9\u9F50 MCP\uFF09").option("--repo-path <path>", "\u4EE3\u7801\u5E93\u6839\u76EE\u5F55\uFF08\u9ED8\u8BA4\u5F53\u524D\u76EE\u5F55\uFF09").option("--information-request <text>", "\u81EA\u7136\u8BED\u8A00\u95EE\u9898\u63CF\u8FF0\uFF08\u5FC5\u586B\uFF09").option("--technical-terms <terms>", "\u7CBE\u786E\u672F\u8BED\uFF08\u9017\u53F7\u5206\u9694\uFF09").option("--format <type>", "\u8F93\u51FA\u683C\u5F0F (text/json)", { default: "text" }).action(
  async (options) => {
    const repoPath = options.repoPath ? path.resolve(options.repoPath) : process.cwd();
    const informationRequest = options.informationRequest;
    if (!informationRequest) {
      logger.error("\u7F3A\u5C11 --information-request");
      process.exit(1);
    }
    const technicalTerms = (options.technicalTerms || "").split(",").map((t) => t.trim()).filter(Boolean);
    const format = options.format === "json" ? "json" : "text";
    await import("./cli-OVRYLXAB.js").then(
      ({ ensureSearchableProject }) => ensureSearchableProject(repoPath)
    );
    const { renderSearchResult, retrieveCodeContext } = await import("./retrieval-G6II56JG.js");
    const result = await retrieveCodeContext({
      repoPath,
      informationRequest,
      technicalTerms: technicalTerms.length > 0 ? technicalTerms : void 0
    });
    process.stdout.write(renderSearchResult(result, format));
  }
);
cli.command("prompt-context <prompt>", "\u4E3A prompt \u589E\u5F3A\u51C6\u5907\u4ED3\u5E93\u8BC1\u636E\uFF08\u9ED8\u8BA4\u8F93\u51FA text\uFF09").option("--repo-path <path>", "\u4EE3\u7801\u5E93\u6839\u76EE\u5F55\uFF08\u9ED8\u8BA4\u5F53\u524D\u76EE\u5F55\uFF09").option("--paths <paths>", "\u663E\u5F0F\u6587\u4EF6\u8DEF\u5F84\uFF08\u9017\u53F7\u5206\u9694\uFF09").option("--symbols <symbols>", "\u663E\u5F0F\u7B26\u53F7\uFF08\u9017\u53F7\u5206\u9694\uFF09").option("--format <type>", "\u8F93\u51FA\u683C\u5F0F (text/json)", { default: "text" }).action(
  async (prompt, options) => {
    const repoPath = options.repoPath ? path.resolve(options.repoPath) : process.cwd();
    const explicitPaths = (options.paths || "").split(",").map((item) => item.trim()).filter(Boolean);
    const explicitSymbols = (options.symbols || "").split(",").map((item) => item.trim()).filter(Boolean);
    const { buildPromptContext, renderPromptContext } = await import("./promptContext-XM36PCDP.js");
    const result = await buildPromptContext({
      prompt,
      repoPath,
      explicitPaths,
      explicitSymbols
    });
    const format = options.format === "json" ? "json" : "text";
    process.stdout.write(renderPromptContext(result, format));
  }
);
cli.help();
function runCli(argv = process.argv.slice(2), invokedPath = process.argv[1]) {
  const normalizedArgv = normalizeCliArgs(argv);
  const entryPath = invokedPath ?? "contextweaver";
  cli.parse([process.execPath, entryPath, ...normalizedArgv]);
}
function resolveExecutableEntry(entryPath) {
  try {
    return realpathSync(entryPath);
  } catch {
    return path.resolve(entryPath);
  }
}
function isMainModule(invokedPath = process.argv[1]) {
  if (!invokedPath) {
    return false;
  }
  return resolveExecutableEntry(invokedPath) === resolveExecutableEntry(fileURLToPath(import.meta.url));
}
if (isMainModule()) {
  runCli();
}
export {
  normalizeCliArgs,
  runCli,
  runIndexCliCommand
};
//# sourceMappingURL=index.js.map