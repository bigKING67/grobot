import { existsSync } from "node:fs";
import os from "node:os";
import { isAbsolute, resolve } from "node:path";
import { resolveContextWeaverRetrieval } from "../../../shared/retrieval/contextweaver-retrieval.mjs";
import {
  hasTomlPath,
  readTomlBoolean,
  readTomlConfig,
  readTomlNumberOrString,
  readTomlString,
} from "../../../shared/config/toml-config.mjs";
import { createError, isRecord } from "./common.mjs";

const RETRIEVAL_ENV_KEYS = [
  "EMBEDDINGS_API_KEY",
  "EMBEDDINGS_BASE_URL",
  "EMBEDDINGS_MODEL",
  "EMBEDDINGS_DIMENSIONS",
  "EMBEDDINGS_BATCH_SIZE",
  "EMBEDDINGS_MAX_CONCURRENCY",
  "EMBEDDINGS_MAX_INPUT_TOKENS",
  "RERANK_API_KEY",
  "RERANK_BASE_URL",
  "RERANK_MODEL",
  "RERANK_TOP_N",
  "CONTEXTWEAVER_API_KEY",
  "CONTEXTWEAVER_BASE_URL",
  "CONTEXTWEAVER_EMBEDDINGS_API_KEY",
  "CONTEXTWEAVER_EMBEDDINGS_BASE_URL",
  "CONTEXTWEAVER_EMBEDDINGS_MODEL",
  "CONTEXTWEAVER_EMBEDDINGS_DIMENSIONS",
  "CONTEXTWEAVER_RERANK_API_KEY",
  "CONTEXTWEAVER_RERANK_BASE_URL",
  "CONTEXTWEAVER_RERANK_MODEL",
  "GROBOT_RETRIEVAL_API_KEY",
  "GROBOT_RETRIEVAL_BASE_URL",
  "GROBOT_EMBEDDING_API_KEY",
  "GROBOT_EMBEDDING_BASE_URL",
  "GROBOT_EMBEDDING_MODEL",
  "GROBOT_EMBEDDING_DIMENSIONS",
  "GROBOT_RERANK_API_KEY",
  "GROBOT_RERANK_BASE_URL",
  "GROBOT_RERANK_MODEL",
];

function isContextWeaverEnvKey(key) {
  return key === "HOME"
    || key.startsWith("EMBEDDINGS_")
    || key.startsWith("RERANK_");
}

export function buildContextWeaverEnvPatch(env) {
  if (!isRecord(env)) {
    return {};
  }
  const patch = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") {
      continue;
    }
    if (!isContextWeaverEnvKey(key)) {
      continue;
    }
    patch[key] = value;
  }
  return patch;
}

export function applyContextWeaverEnvToProcess(env) {
  const patch = buildContextWeaverEnvPatch(env);
  for (const [key, value] of Object.entries(patch)) {
    process.env[key] = value;
  }
}

function findProjectRootBySourceRoots(sourceRoots) {
  for (const row of sourceRoots) {
    const rootPath = String(row?.rootPath ?? "").trim();
    if (!rootPath) {
      continue;
    }
    let cursor = isAbsolute(rootPath) ? rootPath : resolve(process.cwd(), rootPath);
    while (true) {
      const projectGrobotConfig = resolve(cursor, ".grobot/config.toml");
      const projectToml = resolve(cursor, ".grobot/project.toml");
      if (existsSync(projectGrobotConfig) || existsSync(projectToml)) {
        return cursor;
      }
      const parent = resolve(cursor, "..");
      if (parent === cursor) {
        break;
      }
      cursor = parent;
    }
  }
  return "";
}

function loadTomlOptional(path) {
  try {
    return readTomlConfig(path, { required: false });
  } catch (error) {
    throw createError(
      "semantic_config_missing",
      String(error?.message ?? error),
    );
  }
}

function loadTomlRequired(path) {
  try {
    return readTomlConfig(path, { required: true });
  } catch (error) {
    throw createError(
      "semantic_config_missing",
      String(error?.message ?? error),
    );
  }
}

function hasLegacyContextRetrievalSection(tomlDoc) {
  if (!isRecord(tomlDoc)) {
    return false;
  }
  return hasTomlPath(tomlDoc, "context_retrieval");
}

export function buildContextWeaverEnv(sourceRoots) {
  const env = { ...process.env };
  for (const key of RETRIEVAL_ENV_KEYS) {
    delete env[key];
  }

  const projectRoot = findProjectRootBySourceRoots(sourceRoots);
  if (!projectRoot) {
    throw createError(
      "semantic_config_missing",
      "cannot resolve project root for semantic retrieval config",
    );
  }
  const projectGrobotConfigToml = resolve(projectRoot, ".grobot/config.toml");
  if (!existsSync(projectGrobotConfigToml)) {
    throw createError(
      "semantic_config_missing",
      `missing semantic retrieval config: ${projectGrobotConfigToml}`,
    );
  }
  const projectConfigDoc = loadTomlRequired(projectGrobotConfigToml);

  const projectToml = resolve(projectRoot, ".grobot/project.toml");
  const projectConfigToml = resolve(projectRoot, "config.toml");
  const projectTomlDoc = loadTomlOptional(projectToml);
  const projectConfigTomlDoc = loadTomlOptional(projectConfigToml);
  if (
    hasLegacyContextRetrievalSection(projectConfigDoc)
    || hasLegacyContextRetrievalSection(projectTomlDoc)
    || hasLegacyContextRetrievalSection(projectConfigTomlDoc)
  ) {
    throw createError(
      "semantic_config_missing",
      "legacy [context_retrieval] is no longer supported; migrate all retrieval settings to .grobot/config.toml [retrieval.*]",
    );
  }

  const retrievalEnabled = readTomlBoolean(projectConfigDoc, "retrieval.enabled");
  if (retrievalEnabled === false) {
    throw createError(
      "semantic_config_missing",
      "semantic retrieval is disabled in .grobot/config.toml [retrieval].enabled",
    );
  }
  const embeddingEnabled = readTomlBoolean(projectConfigDoc, "retrieval.embedding.enabled");
  if (embeddingEnabled === false) {
    throw createError(
      "semantic_config_missing",
      "semantic retrieval embedding is disabled in .grobot/config.toml [retrieval.embedding].enabled",
    );
  }
  const rerankEnabled = readTomlBoolean(projectConfigDoc, "retrieval.rerank.enabled");
  if (rerankEnabled === false) {
    throw createError(
      "semantic_config_missing",
      "semantic retrieval rerank is disabled in .grobot/config.toml [retrieval.rerank].enabled",
    );
  }

  const retrievalBaseUrl = readTomlString(projectConfigDoc, "retrieval.base_url");
  const retrievalApiKey = readTomlString(projectConfigDoc, "retrieval.api_key");
  const retrievalEmbeddingModel = readTomlString(projectConfigDoc, "retrieval.embedding.model");
  const retrievalEmbeddingDimensions = readTomlNumberOrString(projectConfigDoc, "retrieval.embedding.dimensions");
  const retrievalRerankModel = readTomlString(projectConfigDoc, "retrieval.rerank.model");

  const retrievalResolved = resolveContextWeaverRetrieval({
    sharedBaseUrlCandidates: [
      { value: retrievalBaseUrl, source: "project_config" },
    ],
    sharedApiKeyCandidates: [
      { value: retrievalApiKey, source: "project_config" },
    ],
    embeddingBaseUrlCandidates: [],
    embeddingApiKeyCandidates: [],
    embeddingModelCandidates: [
      { value: retrievalEmbeddingModel, source: "project_config" },
    ],
    embeddingDimensionsCandidates: [
      { value: retrievalEmbeddingDimensions, source: "project_config" },
    ],
    rerankBaseUrlCandidates: [],
    rerankApiKeyCandidates: [],
    rerankModelCandidates: [
      { value: retrievalRerankModel, source: "project_config" },
    ],
  });

  if (!retrievalResolved.embedding || !retrievalResolved.rerank || retrievalResolved.embeddingDimensions <= 0) {
    const missingFields = [];
    if (!retrievalResolved.sharedBaseUrl) {
      missingFields.push("retrieval.base_url");
    }
    if (!retrievalResolved.sharedApiKey) {
      missingFields.push("retrieval.api_key");
    }
    if (!retrievalResolved.embeddingModel) {
      missingFields.push("retrieval.embedding.model");
    }
    if (retrievalResolved.embeddingDimensions <= 0) {
      missingFields.push("retrieval.embedding.dimensions");
    }
    if (!retrievalResolved.rerankModel) {
      missingFields.push("retrieval.rerank.model");
    }
    const missingHint = missingFields.length > 0
      ? `missing required fields: ${missingFields.join(", ")}`
      : "retrieval values are empty or placeholders";
    throw createError(
      "semantic_config_missing",
      `invalid semantic retrieval config in ${projectGrobotConfigToml}; ${missingHint}`,
    );
  }

  if (retrievalResolved.embeddingApiKey) {
    env.EMBEDDINGS_API_KEY = retrievalResolved.embeddingApiKey;
  }
  if (retrievalResolved.embeddingBaseUrl) {
    env.EMBEDDINGS_BASE_URL = retrievalResolved.embeddingBaseUrl;
  }
  if (retrievalResolved.embeddingModel) {
    env.EMBEDDINGS_MODEL = retrievalResolved.embeddingModel;
  }
  if (retrievalResolved.embeddingDimensions > 0) {
    env.EMBEDDINGS_DIMENSIONS = String(retrievalResolved.embeddingDimensions);
  }
  if (retrievalResolved.rerankApiKey) {
    env.RERANK_API_KEY = retrievalResolved.rerankApiKey;
  }
  if (retrievalResolved.rerankBaseUrl) {
    env.RERANK_BASE_URL = retrievalResolved.rerankBaseUrl;
  }
  if (retrievalResolved.rerankModel) {
    env.RERANK_MODEL = retrievalResolved.rerankModel;
  }
  if (!env.HOME) {
    env.HOME = os.homedir();
  }
  return env;
}
