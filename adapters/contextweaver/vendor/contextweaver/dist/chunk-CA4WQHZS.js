// src/config.ts
import fs from "fs";
import os from "os";
import path from "path";
import dotenv from "dotenv";
var isDev = process.env.NODE_ENV === "dev";
var isMcpMode = process.argv.includes("mcp");
function loadEnv() {
  const candidates = isDev ? [
    path.join(process.cwd(), ".env"),
    // 1. 当前目录（开发用）
    path.join(os.homedir(), ".contextweaver", ".env")
    // 2. 用户配置目录（回退）
  ] : [
    path.join(os.homedir(), ".contextweaver", ".env")
    // 生产环境只用用户配置
  ];
  const envPath = candidates.find((p) => fs.existsSync(p));
  if (envPath) {
    const result = dotenv.config({ path: envPath, quiet: true });
    if (result.error) {
      console.error(`[config] \u52A0\u8F7D\u73AF\u5883\u53D8\u91CF\u5931\u8D25: ${result.error.message}`);
      process.exit(1);
    }
  }
}
loadEnv();
var DEFAULT_API_KEY_PLACEHOLDER = "your-api-key-here";
function checkEmbeddingEnv() {
  const missingVars = [];
  const apiKey = process.env.EMBEDDINGS_API_KEY;
  if (!apiKey || apiKey === DEFAULT_API_KEY_PLACEHOLDER) {
    missingVars.push("EMBEDDINGS_API_KEY");
  }
  if (!process.env.EMBEDDINGS_BASE_URL) {
    missingVars.push("EMBEDDINGS_BASE_URL");
  }
  if (!process.env.EMBEDDINGS_MODEL) {
    missingVars.push("EMBEDDINGS_MODEL");
  }
  return {
    isValid: missingVars.length === 0,
    missingVars
  };
}
function checkRerankerEnv() {
  const missingVars = [];
  const apiKey = process.env.RERANK_API_KEY;
  if (!apiKey || apiKey === DEFAULT_API_KEY_PLACEHOLDER) {
    missingVars.push("RERANK_API_KEY");
  }
  if (!process.env.RERANK_BASE_URL) {
    missingVars.push("RERANK_BASE_URL");
  }
  if (!process.env.RERANK_MODEL) {
    missingVars.push("RERANK_MODEL");
  }
  return {
    isValid: missingVars.length === 0,
    missingVars
  };
}
function getEmbeddingConfig() {
  const apiKey = process.env.EMBEDDINGS_API_KEY;
  const baseUrl = process.env.EMBEDDINGS_BASE_URL;
  const model = process.env.EMBEDDINGS_MODEL;
  const batchSize = parseInt(process.env.EMBEDDINGS_BATCH_SIZE || "10", 10);
  const maxConcurrency = parseInt(process.env.EMBEDDINGS_MAX_CONCURRENCY || "10", 10);
  if (!apiKey) {
    throw new Error("EMBEDDINGS_API_KEY \u73AF\u5883\u53D8\u91CF\u672A\u8BBE\u7F6E");
  }
  if (!baseUrl) {
    throw new Error("EMBEDDINGS_BASE_URL \u73AF\u5883\u53D8\u91CF\u672A\u8BBE\u7F6E");
  }
  if (!model) {
    throw new Error("EMBEDDINGS_MODEL \u73AF\u5883\u53D8\u91CF\u672A\u8BBE\u7F6E");
  }
  const dimensions = parseInt(process.env.EMBEDDINGS_DIMENSIONS || "1024", 10);
  const maxInputTokens = parseInt(process.env.EMBEDDINGS_MAX_INPUT_TOKENS || "8192", 10);
  return {
    apiKey,
    baseUrl,
    model,
    batchSize: Number.isNaN(batchSize) || batchSize < 1 ? 10 : batchSize,
    maxConcurrency: Number.isNaN(maxConcurrency) ? 4 : maxConcurrency,
    dimensions: Number.isNaN(dimensions) ? 1024 : dimensions,
    maxInputTokens: Number.isNaN(maxInputTokens) ? 8192 : maxInputTokens
  };
}
function getRerankerConfig() {
  const apiKey = process.env.RERANK_API_KEY;
  const baseUrl = process.env.RERANK_BASE_URL;
  const model = process.env.RERANK_MODEL;
  const topN = parseInt(process.env.RERANK_TOP_N || "10", 10);
  if (!apiKey) {
    throw new Error("RERANK_API_KEY \u73AF\u5883\u53D8\u91CF\u672A\u8BBE\u7F6E");
  }
  if (!baseUrl) {
    throw new Error("RERANK_BASE_URL \u73AF\u5883\u53D8\u91CF\u672A\u8BBE\u7F6E");
  }
  if (!model) {
    throw new Error("RERANK_MODEL \u73AF\u5883\u53D8\u91CF\u672A\u8BBE\u7F6E");
  }
  return {
    apiKey,
    baseUrl,
    model,
    topN: Number.isNaN(topN) ? 10 : topN
  };
}
var DEFAULT_EXCLUDE_PATTERNS = [
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  ".idea",
  ".vscode",
  ".vs",
  ".venv",
  "venv"
];
function getExcludePatterns() {
  return [...DEFAULT_EXCLUDE_PATTERNS];
}

export {
  isDev,
  isMcpMode,
  checkEmbeddingEnv,
  checkRerankerEnv,
  getEmbeddingConfig,
  getRerankerConfig,
  getExcludePatterns
};
//# sourceMappingURL=chunk-CA4WQHZS.js.map