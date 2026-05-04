import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  contractsRoot,
  logStep,
  parseJsonOutput,
  runCommand,
  runContract,
} from "../../harness.mjs";

const historyResolveConfigEnvBaseline = {
  CONTEXTWEAVER_API_KEY: "",
  CONTEXTWEAVER_BASE_URL: "",
  CONTEXTWEAVER_EMBEDDINGS_API_KEY: "",
  CONTEXTWEAVER_EMBEDDINGS_BASE_URL: "",
  CONTEXTWEAVER_EMBEDDINGS_MODEL: "",
  CONTEXTWEAVER_EMBEDDINGS_DIMENSIONS: "",
  CONTEXTWEAVER_RERANK_API_KEY: "",
  CONTEXTWEAVER_RERANK_BASE_URL: "",
  CONTEXTWEAVER_RERANK_MODEL: "",
  GROBOT_RETRIEVAL_API_KEY: "",
  GROBOT_RETRIEVAL_BASE_URL: "",
  GROBOT_EMBEDDING_API_KEY: "",
  GROBOT_EMBEDDING_BASE_URL: "",
  GROBOT_EMBEDDING_MODEL: "",
  GROBOT_EMBEDDING_DIMENSIONS: "",
  EMBEDDINGS_DIMENSIONS: "",
  GROBOT_RERANK_API_KEY: "",
  GROBOT_RERANK_BASE_URL: "",
  GROBOT_RERANK_MODEL: "",
};

export function runHistoryRetrievalConfigContracts() {
  const historyResolveConfigResult = runContract("history-compaction-contract.mjs", "resolve-config", [
    "--payload",
    JSON.stringify({
      project_toml: {
        retrieval: {
          enabled: true,
          selected_limit: 5,
          candidate_limit: 9,
          base_url: "https://api.siliconflow.cn/v1",
          api_key: "retrieval-key",
          embedding: {
            enabled: true,
            model: "Qwen/Qwen3-Embedding-4B",
            dimensions: 2560,
          },
          rerank: {
            enabled: true,
            model: "Qwen/Qwen3-Reranker-0.6B",
          },
        },
      },
      global_toml: {
        retrieval: {
          base_url: "https://global-should-be-ignored.invalid/v1",
          api_key: "global-should-be-ignored",
          embedding: {
            model: "ignored-global-embedding-model",
          },
          rerank: {
            model: "ignored-global-rerank-model",
          },
        },
      },
    }),
  ], {
    env: {
      ...process.env,
      ...historyResolveConfigEnvBaseline,
    },
  });
  const historyResolveConfigPayload = parseJsonOutput(
    "history-compaction-contract resolve-config",
    historyResolveConfigResult.stdout,
  );
  assert.equal(historyResolveConfigPayload.enabled, true);
  assert.equal(historyResolveConfigPayload.source, "project");
  assert.equal(historyResolveConfigPayload.enabled_source, "project");
  assert.equal(historyResolveConfigPayload.selected_limit, 5);
  assert.equal(historyResolveConfigPayload.candidate_limit, 9);
  assert.equal(historyResolveConfigPayload.selected_limit_source, "project");
  assert.equal(historyResolveConfigPayload.candidate_limit_source, "project");
  assert.equal(historyResolveConfigPayload.shared_base_url, "https://api.siliconflow.cn/v1");
  assert.equal(historyResolveConfigPayload.shared_base_url_source, "project");
  assert.equal(historyResolveConfigPayload.shared_api_key_source, "project");
  assert.equal(historyResolveConfigPayload.embedding?.model, "Qwen/Qwen3-Embedding-4B");
  assert.equal(historyResolveConfigPayload.embedding?.dimensions, 2560);
  assert.equal(historyResolveConfigPayload.embedding?.base_url, "https://api.siliconflow.cn/v1/embeddings");
  assert.equal(historyResolveConfigPayload.embedding_source, "project");
  assert.equal(historyResolveConfigPayload.embedding_dimensions_source, "project");
  assert.equal(historyResolveConfigPayload.rerank?.model, "Qwen/Qwen3-Reranker-0.6B");
  assert.equal(historyResolveConfigPayload.rerank?.base_url, "https://api.siliconflow.cn/v1/rerank");
  assert.equal(historyResolveConfigPayload.rerank_source, "project");
  assert.equal(historyResolveConfigPayload.embedding_api_key_source, "project");
  assert.equal(historyResolveConfigPayload.embedding_base_url_source, "project");
  assert.equal(historyResolveConfigPayload.rerank_api_key_source, "project");
  assert.equal(historyResolveConfigPayload.rerank_base_url_source, "project");
  assert.equal(historyResolveConfigPayload.embedding_disabled_reason, null);
  assert.equal(historyResolveConfigPayload.rerank_disabled_reason, null);
  logStep("history-compaction-contract resolve-config");

  const historyResolveConfigEnvIgnoredResult = runContract("history-compaction-contract.mjs", "resolve-config", [
    "--payload",
    JSON.stringify({
      project_toml: {
        retrieval: {
          enabled: true,
          base_url: "https://project-only.invalid/v1",
          api_key: "project-only-key",
          embedding: {
            model: "Qwen/Qwen3-Embedding-4B",
            dimensions: 2560,
          },
          rerank: {
            model: "Qwen/Qwen3-Reranker-0.6B",
          },
        },
      },
      global_toml: {},
    }),
  ], {
    env: {
      ...process.env,
      ...historyResolveConfigEnvBaseline,
      CONTEXTWEAVER_API_KEY: "env-shared-key",
      CONTEXTWEAVER_BASE_URL: "https://env-shared.example.com/v1",
      CONTEXTWEAVER_EMBEDDINGS_API_KEY: "env-embed-key",
      CONTEXTWEAVER_EMBEDDINGS_BASE_URL: "https://env-embed.example.com/v1",
      CONTEXTWEAVER_EMBEDDINGS_MODEL: "Qwen/Qwen3-Embedding-0.6B",
      CONTEXTWEAVER_EMBEDDINGS_DIMENSIONS: "1536",
      CONTEXTWEAVER_RERANK_API_KEY: "env-rerank-key",
      CONTEXTWEAVER_RERANK_BASE_URL: "https://env-rerank.example.com/v1",
      CONTEXTWEAVER_RERANK_MODEL: "Qwen/Qwen3-Reranker-8B",
      GROBOT_RETRIEVAL_API_KEY: "env-grobot-key",
      GROBOT_RETRIEVAL_BASE_URL: "https://env-grobot.example.com/v1",
      GROBOT_EMBEDDING_API_KEY: "env-grobot-embedding-key",
      GROBOT_EMBEDDING_BASE_URL: "https://env-grobot-embedding.example.com/v1",
      GROBOT_EMBEDDING_MODEL: "env-grobot-embedding-model",
      GROBOT_EMBEDDING_DIMENSIONS: "1024",
      GROBOT_RERANK_API_KEY: "env-grobot-rerank-key",
      GROBOT_RERANK_BASE_URL: "https://env-grobot-rerank.example.com/v1",
      GROBOT_RERANK_MODEL: "env-grobot-rerank-model",
    },
  });
  const historyResolveConfigEnvIgnoredPayload = parseJsonOutput(
    "history-compaction-contract resolve-config env ignored",
    historyResolveConfigEnvIgnoredResult.stdout,
  );
  assert.equal(historyResolveConfigEnvIgnoredPayload.shared_base_url, "https://project-only.invalid/v1");
  assert.equal(historyResolveConfigEnvIgnoredPayload.shared_base_url_source, "project");
  assert.equal(historyResolveConfigEnvIgnoredPayload.shared_api_key_source, "project");
  assert.equal(historyResolveConfigEnvIgnoredPayload.embedding?.model, "Qwen/Qwen3-Embedding-4B");
  assert.equal(historyResolveConfigEnvIgnoredPayload.embedding?.dimensions, 2560);
  assert.equal(historyResolveConfigEnvIgnoredPayload.embedding?.base_url, "https://project-only.invalid/v1/embeddings");
  assert.equal(historyResolveConfigEnvIgnoredPayload.embedding_source, "project");
  assert.equal(historyResolveConfigEnvIgnoredPayload.rerank?.model, "Qwen/Qwen3-Reranker-0.6B");
  assert.equal(historyResolveConfigEnvIgnoredPayload.rerank?.base_url, "https://project-only.invalid/v1/rerank");
  assert.equal(historyResolveConfigEnvIgnoredPayload.rerank_source, "project");
  logStep("history-compaction-contract resolve-config-env-ignored");

  const historyCompactionContractPath = resolve(contractsRoot, "history-compaction-contract.mjs");
  const historyResolveConfigPlaceholderKeyResult = runCommand("node", [
    historyCompactionContractPath,
    "resolve-config",
    "--payload",
    JSON.stringify({
      project_toml: {
        retrieval: {
          enabled: true,
          base_url: "https://api.siliconflow.cn/v1",
          api_key: "replace-with-retrieval-api-key",
          embedding: {
            model: "Qwen/Qwen3-Embedding-4B",
            dimensions: 2560,
          },
          rerank: {
            model: "Qwen/Qwen3-Reranker-0.6B",
          },
        },
      },
      global_toml: {},
    }),
  ], {
    env: {
      ...process.env,
      ...historyResolveConfigEnvBaseline,
    },
  });
  assert.notEqual(historyResolveConfigPlaceholderKeyResult.code, 0);
  assert.match(
    historyResolveConfigPlaceholderKeyResult.stderr,
    /invalid \[retrieval\.\*\] in project_toml; missing required fields: retrieval\.api_key/,
  );
  logStep("history-compaction-contract resolve-config-placeholder-key-fails");

  const historyResolveConfigEnvOnlyResult = runCommand("node", [
    historyCompactionContractPath,
    "resolve-config",
    "--payload",
    JSON.stringify({
      project_toml: {},
      global_toml: {},
    }),
  ], {
    env: {
      ...process.env,
      ...historyResolveConfigEnvBaseline,
      CONTEXTWEAVER_API_KEY: "env-shared-key",
      CONTEXTWEAVER_BASE_URL: "https://env-shared.example.com/v1",
      CONTEXTWEAVER_EMBEDDINGS_API_KEY: "env-embed-key",
      CONTEXTWEAVER_EMBEDDINGS_BASE_URL: "https://env-embed.example.com/v1",
      CONTEXTWEAVER_EMBEDDINGS_MODEL: "Qwen/Qwen3-Embedding-0.6B",
      CONTEXTWEAVER_EMBEDDINGS_DIMENSIONS: "1536",
      CONTEXTWEAVER_RERANK_API_KEY: "env-rerank-key",
      CONTEXTWEAVER_RERANK_BASE_URL: "https://env-rerank.example.com/v1",
      CONTEXTWEAVER_RERANK_MODEL: "Qwen/Qwen3-Reranker-8B",
      GROBOT_RETRIEVAL_API_KEY: "env-grobot-key",
      GROBOT_RETRIEVAL_BASE_URL: "https://env-grobot.example.com/v1",
      GROBOT_EMBEDDING_API_KEY: "env-grobot-embedding-key",
      GROBOT_EMBEDDING_BASE_URL: "https://env-grobot-embedding.example.com/v1",
      GROBOT_EMBEDDING_MODEL: "env-grobot-embedding-model",
      GROBOT_EMBEDDING_DIMENSIONS: "1024",
      GROBOT_RERANK_API_KEY: "env-grobot-rerank-key",
      GROBOT_RERANK_BASE_URL: "https://env-grobot-rerank.example.com/v1",
      GROBOT_RERANK_MODEL: "env-grobot-rerank-model",
    },
  });
  assert.notEqual(historyResolveConfigEnvOnlyResult.code, 0);
  assert.match(historyResolveConfigEnvOnlyResult.stderr, /missing \[retrieval\] in project_toml/);
  logStep("history-compaction-contract resolve-config-env-only-fails");

  const historyResolveConfigLegacyKeyResult = runCommand("node", [
    historyCompactionContractPath,
    "resolve-config",
    "--payload",
    JSON.stringify({
      project_toml: {
        context_retrieval: {},
        retrieval: {
          enabled: true,
          base_url: "https://api.siliconflow.cn/v1",
          api_key: "retrieval-key",
          embedding: {
            model: "Qwen/Qwen3-Embedding-4B",
          },
          rerank: {
            model: "Qwen/Qwen3-Reranker-0.6B",
          },
        },
      },
      global_toml: {},
    }),
  ], {
    env: {
      ...process.env,
      ...historyResolveConfigEnvBaseline,
    },
  });
  assert.notEqual(historyResolveConfigLegacyKeyResult.code, 0);
  assert.match(historyResolveConfigLegacyKeyResult.stderr, /legacy \[context_retrieval\] is not supported/);
  logStep("history-compaction-contract resolve-config-legacy-key-fails");

  const historyResolveConfigDisabledResult = runCommand("node", [
    historyCompactionContractPath,
    "resolve-config",
    "--payload",
    JSON.stringify({
      project_toml: {
        retrieval: {
          enabled: false,
          base_url: "https://api.siliconflow.cn/v1",
          api_key: "retrieval-key",
          embedding: {
            model: "Qwen/Qwen3-Embedding-4B",
          },
          rerank: {
            model: "Qwen/Qwen3-Reranker-0.6B",
          },
        },
      },
      global_toml: {},
    }),
  ], {
    env: {
      ...process.env,
      ...historyResolveConfigEnvBaseline,
    },
  });
  assert.notEqual(historyResolveConfigDisabledResult.code, 0);
  assert.match(historyResolveConfigDisabledResult.stderr, /\[retrieval\]\.enabled=false is not supported/);
  logStep("history-compaction-contract resolve-config-disabled-fails");
}
