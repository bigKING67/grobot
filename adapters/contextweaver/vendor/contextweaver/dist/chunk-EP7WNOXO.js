import {
  getProjectIdentity
} from "./chunk-35HO3GPM.js";
import {
  logger
} from "./chunk-44FXLQ5V.js";

// src/retrieval/index.ts
import fs from "fs";
import os from "os";
import path from "path";
var BASE_DIR = path.join(os.homedir(), ".contextweaver");
var INDEX_LOCK_TIMEOUT_MS = 10 * 60 * 1e3;
var DEFAULT_INDEX_FRESHNESS_WINDOW_MS = 20 * 60 * 1e3;
var INDEX_REGISTRY_PATH = path.join(BASE_DIR, "indexes.json");
var DEFAULT_IMPORT_ADAPTIVE_MIN_SEGMENTS = 3;
var DEFAULT_IMPORT_ADAPTIVE_MIN_TOP_SCORE = 0.55;
var DEFAULT_IMPORT_ADAPTIVE_FILES_PER_SEED = 2;
var DEFAULT_IMPORT_ADAPTIVE_CHUNKS_PER_FILE = 1;
function parsePositiveIntEnv(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}
function parseNonNegativeFloatEnv(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}
function parseBooleanEnv(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return null;
}
function resolveIndexFreshnessWindowMs() {
  const configured = parsePositiveIntEnv(process.env.GROBOT_CONTEXTWEAVER_INDEX_FRESHNESS_WINDOW_MS) ?? parsePositiveIntEnv(process.env.CONTEXTWEAVER_INDEX_FRESHNESS_WINDOW_MS);
  if (configured === null) {
    return DEFAULT_INDEX_FRESHNESS_WINDOW_MS;
  }
  return configured;
}
function resolveImportAdaptiveConfig() {
  const enabled = parseBooleanEnv(process.env.GROBOT_CONTEXTWEAVER_IMPORT_ADAPTIVE) ?? parseBooleanEnv(process.env.CONTEXTWEAVER_IMPORT_ADAPTIVE) ?? false;
  const minSegments = parsePositiveIntEnv(process.env.GROBOT_CONTEXTWEAVER_IMPORT_ADAPTIVE_MIN_SEGMENTS) ?? parsePositiveIntEnv(process.env.CONTEXTWEAVER_IMPORT_ADAPTIVE_MIN_SEGMENTS) ?? DEFAULT_IMPORT_ADAPTIVE_MIN_SEGMENTS;
  const minTopScore = parseNonNegativeFloatEnv(process.env.GROBOT_CONTEXTWEAVER_IMPORT_ADAPTIVE_MIN_TOP_SCORE) ?? parseNonNegativeFloatEnv(process.env.CONTEXTWEAVER_IMPORT_ADAPTIVE_MIN_TOP_SCORE) ?? DEFAULT_IMPORT_ADAPTIVE_MIN_TOP_SCORE;
  const importFilesPerSeed = parsePositiveIntEnv(process.env.GROBOT_CONTEXTWEAVER_IMPORT_ADAPTIVE_FILES_PER_SEED) ?? parsePositiveIntEnv(process.env.CONTEXTWEAVER_IMPORT_ADAPTIVE_FILES_PER_SEED) ?? DEFAULT_IMPORT_ADAPTIVE_FILES_PER_SEED;
  const chunksPerImportFile = parsePositiveIntEnv(process.env.GROBOT_CONTEXTWEAVER_IMPORT_ADAPTIVE_CHUNKS_PER_FILE) ?? parsePositiveIntEnv(process.env.CONTEXTWEAVER_IMPORT_ADAPTIVE_CHUNKS_PER_FILE) ?? DEFAULT_IMPORT_ADAPTIVE_CHUNKS_PER_FILE;
  return {
    enabled,
    minSegments,
    minTopScore,
    importFilesPerSeed,
    chunksPerImportFile
  };
}
function topScoreOf(result) {
  let top = 0;
  for (const file of result.files) {
    for (const segment of file.segments) {
      if (segment.score > top) {
        top = segment.score;
      }
    }
  }
  return top;
}
function shouldRunImportAdaptiveRetry(result, config) {
  if (result.summary.totalSegments <= 0) {
    return true;
  }
  if (result.summary.totalSegments < config.minSegments) {
    return true;
  }
  return topScoreOf(result) < config.minTopScore;
}
function pickPreferredSearchResult(primary, expanded) {
  if (expanded.summary.totalSegments <= 0) {
    return primary;
  }
  const primaryTopScore = topScoreOf(primary);
  const expandedTopScore = topScoreOf(expanded);
  if (expandedTopScore > primaryTopScore + 1e-6) {
    return expanded;
  }
  if (Math.abs(expandedTopScore - primaryTopScore) <= 1e-6 && expanded.summary.totalSegments >= primary.summary.totalSegments) {
    return expanded;
  }
  if (expanded.summary.totalSegments >= primary.summary.totalSegments + 2 && expandedTopScore >= primaryTopScore * 0.9) {
    return expanded;
  }
  return primary;
}
async function runSearchWithConfig(input) {
  const { SearchService } = await import("./SearchService-7OSCIPSY.js");
  const service = new SearchService(input.projectId, input.repoPath, input.configOverride);
  await service.init();
  const pack = await service.buildContextPack(input.query);
  return buildSearchResult(pack);
}
function resolveProjectIndexAgeMs(projectId) {
  let raw = "";
  try {
    raw = fs.readFileSync(INDEX_REGISTRY_PATH, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const indexes = parsed.indexes;
  if (!Array.isArray(indexes)) {
    return null;
  }
  const matched = indexes.find(
    (item) => typeof item === "object" && item !== null && !Array.isArray(item) && item.projectId === projectId
  );
  if (!matched) {
    return null;
  }
  if (typeof matched.confirmedAt !== "string" || !matched.confirmedAt.trim()) {
    return null;
  }
  if (typeof matched.lastIndexedAt !== "string" || !matched.lastIndexedAt.trim()) {
    return null;
  }
  const lastIndexedAtMs = Date.parse(matched.lastIndexedAt);
  if (!Number.isFinite(lastIndexedAtMs)) {
    return null;
  }
  const ageMs = Date.now() - lastIndexedAtMs;
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return null;
  }
  return ageMs;
}
async function ensureDefaultEnvFile() {
  const configDir = BASE_DIR;
  const envFile = path.join(configDir, ".env");
  if (fs.existsSync(envFile)) {
    return;
  }
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    logger.info({ configDir }, "\u521B\u5EFA\u914D\u7F6E\u76EE\u5F55");
  }
  const defaultEnvContent = `# ContextWeaver \u793A\u4F8B\u73AF\u5883\u53D8\u91CF\u914D\u7F6E\u6587\u4EF6

# Embedding API \u914D\u7F6E\uFF08\u5FC5\u9700\uFF09
EMBEDDINGS_API_KEY=your-api-key-here
EMBEDDINGS_BASE_URL=https://api.siliconflow.cn/v1/embeddings
EMBEDDINGS_MODEL=BAAI/bge-m3
EMBEDDINGS_MAX_CONCURRENCY=10
EMBEDDINGS_DIMENSIONS=1024
EMBEDDINGS_MAX_INPUT_TOKENS=8192

# Reranker \u914D\u7F6E\uFF08\u5FC5\u9700\uFF09
RERANK_API_KEY=your-api-key-here
RERANK_BASE_URL=https://api.siliconflow.cn/v1/rerank
RERANK_MODEL=BAAI/bge-reranker-v2-m3
RERANK_TOP_N=20
`;
  fs.writeFileSync(envFile, defaultEnvContent);
  logger.info({ envFile }, "\u5DF2\u521B\u5EFA\u9ED8\u8BA4 .env \u914D\u7F6E\u6587\u4EF6");
}
function isProjectIndexed(projectId) {
  const dbPath = path.join(BASE_DIR, projectId, "index.db");
  return fs.existsSync(dbPath);
}
async function ensureIndexed(repoPath, projectId, onProgress) {
  const { withLock } = await import("./lock-CXBZNMFH.js");
  const { scan } = await import("./scanner-4VZJHZ3S.js");
  await withLock(
    projectId,
    "index",
    async () => {
      const wasIndexed = isProjectIndexed(projectId);
      const freshnessWindowMs = resolveIndexFreshnessWindowMs();
      if (wasIndexed && freshnessWindowMs > 0) {
        const indexAgeMs = resolveProjectIndexAgeMs(projectId);
        if (indexAgeMs !== null && indexAgeMs <= freshnessWindowMs) {
          logger.info(
            {
              projectId: projectId.slice(0, 10),
              freshnessWindowMs,
              indexAgeMs
            },
            "\u7D22\u5F15\u4ECD\u5728\u65B0\u9C9C\u7A97\u53E3\u5185\uFF0C\u8DF3\u8FC7\u626B\u63CF"
          );
          onProgress?.(100, 100, "\u7D22\u5F15\u547D\u4E2D\u65B0\u9C9C\u7A97\u53E3\uFF0C\u8DF3\u8FC7\u626B\u63CF");
          return;
        }
      }
      if (!wasIndexed) {
        logger.info(
          { repoPath, projectId: projectId.slice(0, 10) },
          "\u4EE3\u7801\u5E93\u672A\u521D\u59CB\u5316\uFF0C\u5F00\u59CB\u9996\u6B21\u7D22\u5F15..."
        );
        onProgress?.(0, 100, "\u4EE3\u7801\u5E93\u672A\u7D22\u5F15\uFF0C\u5F00\u59CB\u9996\u6B21\u7D22\u5F15...");
      }
      const startTime = Date.now();
      const stats = await scan(repoPath, { vectorIndex: true, onProgress });
      const elapsed = Date.now() - startTime;
      logger.info(
        {
          projectId: projectId.slice(0, 10),
          isFirstTime: !wasIndexed,
          totalFiles: stats.totalFiles,
          added: stats.added,
          modified: stats.modified,
          deleted: stats.deleted,
          vectorIndex: stats.vectorIndex,
          elapsedMs: elapsed
        },
        "\u7D22\u5F15\u5B8C\u6210"
      );
    },
    INDEX_LOCK_TIMEOUT_MS
  );
}
function buildSearchResult(pack) {
  return {
    summary: {
      query: pack.query,
      seedCount: pack.seeds.length,
      expandedCount: pack.expanded.length,
      fileCount: pack.files.length,
      totalSegments: pack.files.reduce((acc, file) => acc + file.segments.length, 0)
    },
    files: pack.files.map((file) => ({
      path: file.filePath,
      segments: file.segments.map((segment) => buildSearchResultSegment(segment))
    }))
  };
}
function buildSearchResultSegment(segment) {
  return {
    startLine: segment.startLine,
    endLine: segment.endLine,
    score: segment.score,
    language: detectSegmentLanguage(segment.filePath),
    breadcrumb: segment.breadcrumb,
    text: segment.text
  };
}
function renderSearchResult(result, format) {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}
`;
  }
  const fileBlocks = result.files.map(
    (file) => file.segments.map((segment) => {
      const header = `## ${file.path} (L${segment.startLine}-${segment.endLine})`;
      const breadcrumb = segment.breadcrumb ? `> ${segment.breadcrumb}` : "";
      const code = `\`\`\`${segment.language}
${segment.text}
\`\`\``;
      return [header, breadcrumb, code].filter(Boolean).join("\n");
    }).join("\n\n")
  ).join("\n\n---\n\n");
  const summary = [
    `Found ${result.summary.seedCount} relevant code blocks`,
    `Files: ${result.summary.fileCount}`,
    `Total segments: ${result.summary.totalSegments}`
  ].join(" | ");
  return `${summary}

${fileBlocks}
`;
}
async function retrieveCodeContext(input, options) {
  const { checkEmbeddingEnv, checkRerankerEnv } = await import("./config-SRPGGP54.js");
  const embeddingCheck = checkEmbeddingEnv();
  const rerankerCheck = checkRerankerEnv();
  const allMissingVars = [...embeddingCheck.missingVars, ...rerankerCheck.missingVars];
  if (allMissingVars.length > 0) {
    await ensureDefaultEnvFile();
    throw new Error(`ContextWeaver \u73AF\u5883\u53D8\u91CF\u672A\u914D\u7F6E: ${allMissingVars.join(", ")}`);
  }
  const projectId = getProjectIdentity(input.repoPath).projectId;
  await ensureIndexed(input.repoPath, projectId, options?.onProgress);
  const query = [input.informationRequest, ...input.technicalTerms || []].filter(Boolean).join(" ");
  const primary = await runSearchWithConfig({
    projectId,
    repoPath: input.repoPath,
    query,
    configOverride: options?.configOverride
  });
  const adaptiveConfig = resolveImportAdaptiveConfig();
  const hasExplicitImportOverride = typeof options?.configOverride?.importFilesPerSeed === "number" || typeof options?.configOverride?.chunksPerImportFile === "number";
  if (!adaptiveConfig.enabled || hasExplicitImportOverride) {
    return primary;
  }
  if (!shouldRunImportAdaptiveRetry(primary, adaptiveConfig)) {
    return primary;
  }
  const expandedConfigOverride = {
    ...options?.configOverride,
    importFilesPerSeed: adaptiveConfig.importFilesPerSeed,
    chunksPerImportFile: adaptiveConfig.chunksPerImportFile
  };
  try {
    logger.info(
      {
        projectId: projectId.slice(0, 10),
        minSegments: adaptiveConfig.minSegments,
        minTopScore: adaptiveConfig.minTopScore,
        importFilesPerSeed: adaptiveConfig.importFilesPerSeed,
        chunksPerImportFile: adaptiveConfig.chunksPerImportFile
      },
      "\u547D\u4E2D\u4F4E\u53EC\u56DE\u9608\u503C\uFF0C\u89E6\u53D1 import \u81EA\u9002\u5E94\u4E8C\u6B21\u68C0\u7D22"
    );
    const expanded = await runSearchWithConfig({
      projectId,
      repoPath: input.repoPath,
      query,
      configOverride: expandedConfigOverride
    });
    return pickPreferredSearchResult(primary, expanded);
  } catch (error) {
    logger.warn(
      {
        projectId: projectId.slice(0, 10),
        message: error instanceof Error ? error.message : String(error)
      },
      "import \u81EA\u9002\u5E94\u4E8C\u6B21\u68C0\u7D22\u5931\u8D25\uFF0C\u56DE\u9000\u4E3B\u68C0\u7D22\u7ED3\u679C"
    );
    return primary;
  }
}
function detectSegmentLanguage(filePath) {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const langMap = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    rb: "ruby",
    php: "php",
    swift: "swift",
    kt: "kotlin",
    scala: "scala",
    sql: "sql",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    xml: "xml",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    md: "markdown",
    toml: "toml"
  };
  return langMap[ext] || ext || "plaintext";
}

export {
  buildSearchResult,
  renderSearchResult,
  retrieveCodeContext
};
//# sourceMappingURL=chunk-EP7WNOXO.js.map
