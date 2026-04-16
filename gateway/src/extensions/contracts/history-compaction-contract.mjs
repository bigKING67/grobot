import {
  hasEffectiveCandidate,
  resolveContextWeaverRetrieval,
} from "../../../../shared/retrieval/contextweaver-retrieval.mjs";

const HISTORY_COMPACT_HEADER = "[Compact Context Snapshot v1]";
const SECTION_ARCHITECTURE = "Architecture decisions";
const SECTION_MODIFIED = "Modified files and key changes";
const SECTION_VERIFICATION = "Current verification status";
const SECTION_TODO = "Open TODOs and rollback notes";
const SECTION_TOOL_OUTPUT = "Tool outputs (pass/fail only)";
const DEFAULT_RETRIEVAL_EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-4B";
const DEFAULT_RETRIEVAL_RERANK_MODEL = "Qwen/Qwen3-Reranker-0.6B";
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseJsonArg(raw, argName) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON for ${argName}`);
  }
  if (!isObject(parsed)) {
    throw new Error(`${argName} must be a JSON object`);
  }
  return parsed;
}
function parseArgs(argv) {
  const command = argv[0] ?? "";
  if (!command) {
    throw new Error("missing command");
  }
  const options = /* @__PURE__ */ new Map();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) {
      throw new Error(`unknown argument: ${token}`);
    }
    const value = argv[index + 1] ?? "";
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${token}`);
    }
    options.set(token.slice(2), value);
    index += 1;
  }
  return { command, options };
}
function requireOption(options, key) {
  const value = options.get(key);
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}
function normalizeLine(text) {
  return text.trim();
}
function includeAsPass(line) {
  if (/\bpass(?:ed)?\b/i.test(line) || /通过|成功/.test(line)) {
    return line.startsWith("PASS:") ? line : `PASS: ${line}`;
  }
  return line;
}
function includeAsFail(line) {
  if (/\bfail(?:ed)?\b/i.test(line) || /\berror\b/i.test(line) || /失败|错误|异常|超时/.test(line)) {
    return line.startsWith("FAIL:") ? line : `FAIL: ${line}`;
  }
  return line;
}
function extractSectionsFromHistory(history) {
  const sections = {
    [SECTION_ARCHITECTURE]: [],
    [SECTION_MODIFIED]: [],
    [SECTION_VERIFICATION]: [],
    [SECTION_TODO]: [],
    [SECTION_TOOL_OUTPUT]: []
  };
  for (const row of history) {
    const contentRaw = row.content;
    if (typeof contentRaw !== "string") {
      continue;
    }
    const content = normalizeLine(contentRaw);
    if (!content) {
      continue;
    }
    const lower = content.toLowerCase();
    if (lower.includes("command:")) {
      continue;
    }
    if (lower.includes("architecture decision") || lower.includes("architecture")) {
      sections[SECTION_ARCHITECTURE].push(content);
      continue;
    }
    if (lower.includes("modified files")) {
      sections[SECTION_MODIFIED].push(content);
      continue;
    }
    if (lower.includes("verification") || lower.includes("test")) {
      sections[SECTION_VERIFICATION].push(includeAsPass(content));
      continue;
    }
    if (lower.includes("todo") || lower.includes("rollback")) {
      sections[SECTION_TODO].push(content);
      continue;
    }
    if (lower.includes("stderr") || lower.includes("stdout") || lower.includes("timeout") || lower.includes("error")) {
      sections[SECTION_TOOL_OUTPUT].push(includeAsFail(content));
      continue;
    }
  }
  return sections;
}
function renderCompactSnapshot(sections) {
  const lines = [HISTORY_COMPACT_HEADER, ""];
  const ordered = [
    SECTION_ARCHITECTURE,
    SECTION_MODIFIED,
    SECTION_VERIFICATION,
    SECTION_TODO,
    SECTION_TOOL_OUTPUT
  ];
  for (const section of ordered) {
    lines.push(`[${section}]`);
    const items = sections[section] ?? [];
    if (items.length === 0) {
      lines.push("- (none)");
    } else {
      for (const item of items) {
        lines.push(`- ${item}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
function findExistingSnapshot(rows) {
  for (const row of rows) {
    const content = row.content;
    if (typeof content !== "string") {
      continue;
    }
    if (content.includes(HISTORY_COMPACT_HEADER)) {
      return content;
    }
  }
  return null;
}
function trimHistoryMessages(history, maxTurns) {
  const threshold = Math.max(0, maxTurns) * 2;
  if (history.length <= threshold) {
    return history.map((item) => ({ ...item }));
  }
  const tailCount = Math.max(1, threshold - 1);
  const tail = history.slice(-tailCount).map((item) => ({ ...item }));
  const prefix = history.slice(0, Math.max(0, history.length - tailCount));
  const existing = findExistingSnapshot(prefix);
  const snapshot = existing ?? renderCompactSnapshot(extractSectionsFromHistory(prefix));
  return [{ role: "assistant", content: snapshot }, ...tail];
}
function parseSnapshotSections(snapshot) {
  const sections = {};
  let current = "";
  for (const rawLine of snapshot.split(/\r?\n/)) {
    const line = rawLine.trim();
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      current = sectionMatch[1] ?? "";
      if (!sections[current]) {
        sections[current] = [];
      }
      continue;
    }
    if (!current || !line.startsWith("- ")) {
      continue;
    }
    sections[current].push(line.slice(2));
  }
  return sections;
}
function buildRetrievedContextBlock(history, userPrompt, retrievalConfig) {
  const snapshotRow = history.find((row) => typeof row.content === "string" && String(row.content).includes(HISTORY_COMPACT_HEADER));
  const lines = ["[Retrieved Context]"];
  if (snapshotRow && typeof snapshotRow.content === "string") {
    const sections = parseSnapshotSections(snapshotRow.content);
    const architecture = sections[SECTION_ARCHITECTURE] ?? [];
    const modified = sections[SECTION_MODIFIED] ?? [];
    if (architecture.length > 0) {
      lines.push(`ARCH: ${architecture[0]}`);
    }
    if (modified.length > 0) {
      lines.push(`FILES: ${modified[0]}`);
    }
  }
  const userRows = history.filter((row) => row.role === "user" && typeof row.content === "string");
  if (retrievalConfig?.enabled) {
    if (userRows.length > 0) {
      lines.push(`USER: ${String(userRows[0].content)}`);
    }
  } else {
    const prompt = userPrompt.toLowerCase();
    const hit = userRows.find((row) => String(row.content).toLowerCase().includes("failover") || prompt.includes("failover"));
    if (hit) {
      lines.push(`USER: ${String(hit.content)}`);
    }
  }
  return lines.join("\n");
}
function cosineSimilarity(a, b) {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let index = 0; index < a.length; index += 1) {
    const av = a[index] ?? 0;
    const bv = b[index] ?? 0;
    dot += av * bv;
    aNorm += av * av;
    bNorm += bv * bv;
  }
  if (aNorm <= 0 || bNorm <= 0) {
    return 0;
  }
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}
function parseEmbeddingRows(response) {
  const rows = /* @__PURE__ */ new Map();
  const dataRaw = response.data;
  if (!Array.isArray(dataRaw)) {
    return rows;
  }
  for (const rowRaw of dataRaw) {
    if (!isObject(rowRaw)) {
      continue;
    }
    const index = rowRaw.index;
    const embedding = rowRaw.embedding;
    if (typeof index !== "number" || !Array.isArray(embedding)) {
      continue;
    }
    const vector = embedding.filter((item) => typeof item === "number");
    rows.set(index, vector);
  }
  return rows;
}
function computeEmbeddingSimilarityScores(candidates, response) {
  const rows = parseEmbeddingRows(response);
  const queryEmbedding = rows.get(0) ?? [];
  const scores = {};
  candidates.forEach((candidate, index) => {
    const id = typeof candidate.id === "number" ? candidate.id : index;
    const vector = rows.get(index + 1) ?? [];
    scores[id] = cosineSimilarity(queryEmbedding, vector);
  });
  return scores;
}
function computeRerankScores(candidates, response) {
  const scores = {};
  const rowsRaw = Array.isArray(response.results) ? response.results : Array.isArray(response.data) ? response.data : [];
  for (const rowRaw of rowsRaw) {
    if (!isObject(rowRaw)) {
      continue;
    }
    const index = rowRaw.index;
    const scoreRaw = rowRaw.relevance_score;
    if (typeof index !== "number" || typeof scoreRaw !== "number") {
      continue;
    }
    const candidate = candidates[index];
    if (!isObject(candidate)) {
      continue;
    }
    const id = typeof candidate.id === "number" ? candidate.id : index;
    scores[id] = scoreRaw;
  }
  return scores;
}
function toPositiveInt(raw, fallback) {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  const value = Math.floor(raw);
  return value > 0 ? value : fallback;
}
function readNested(base, key) {
  const value = base[key];
  return isObject(value) ? value : {};
}
function hasOwn(base, key) {
  return Object.prototype.hasOwnProperty.call(base, key);
}
function resolveContextRetrievalConfig(projectToml, fallbackApiKey, globalToml) {
  const projectContextSection = readNested(projectToml, "context_retrieval");
  const projectRetrievalSection = readNested(projectToml, "retrieval");
  const globalSection = readNested(globalToml, "retrieval");
  const envContextWeaverKey = process.env.CONTEXTWEAVER_API_KEY ?? "";
  const envContextWeaverBaseUrl = process.env.CONTEXTWEAVER_BASE_URL ?? "";
  const envContextWeaverEmbeddingKey = process.env.CONTEXTWEAVER_EMBEDDINGS_API_KEY ?? "";
  const envContextWeaverEmbeddingBaseUrl = process.env.CONTEXTWEAVER_EMBEDDINGS_BASE_URL ?? "";
  const envContextWeaverEmbeddingModel = process.env.CONTEXTWEAVER_EMBEDDINGS_MODEL ?? "";
  const envContextWeaverEmbeddingDimensions = process.env.CONTEXTWEAVER_EMBEDDINGS_DIMENSIONS ?? "";
  const envContextWeaverRerankKey = process.env.CONTEXTWEAVER_RERANK_API_KEY ?? "";
  const envContextWeaverRerankBaseUrl = process.env.CONTEXTWEAVER_RERANK_BASE_URL ?? "";
  const envContextWeaverRerankModel = process.env.CONTEXTWEAVER_RERANK_MODEL ?? "";
  const envRetrievalKey = process.env.GROBOT_RETRIEVAL_API_KEY ?? "";
  const envRetrievalBaseUrl = process.env.GROBOT_RETRIEVAL_BASE_URL ?? "";
  const envEmbeddingKey = process.env.GROBOT_EMBEDDING_API_KEY ?? "";
  const envEmbeddingBaseUrl = process.env.GROBOT_EMBEDDING_BASE_URL ?? "";
  const envEmbeddingModel = process.env.GROBOT_EMBEDDING_MODEL ?? "";
  const envEmbeddingDimensions = process.env.GROBOT_EMBEDDING_DIMENSIONS
    ?? process.env.EMBEDDINGS_DIMENSIONS
    ?? "";
  const envRerankKey = process.env.GROBOT_RERANK_API_KEY ?? "";
  const envRerankBaseUrl = process.env.GROBOT_RERANK_BASE_URL ?? "";
  const envRerankModel = process.env.GROBOT_RERANK_MODEL ?? "";
  const hasProjectContext = Object.keys(projectContextSection).length > 0;
  const hasProjectRetrieval = Object.keys(projectRetrievalSection).length > 0;
  const hasGlobal = Object.keys(globalSection).length > 0;
  const hasEnv = hasEffectiveCandidate([
    envContextWeaverKey,
    envContextWeaverBaseUrl,
    envContextWeaverEmbeddingKey,
    envContextWeaverEmbeddingBaseUrl,
    envContextWeaverEmbeddingModel,
    envContextWeaverEmbeddingDimensions,
    envContextWeaverRerankKey,
    envContextWeaverRerankBaseUrl,
    envContextWeaverRerankModel,
    envRetrievalKey,
    envRetrievalBaseUrl,
    envEmbeddingKey,
    envEmbeddingBaseUrl,
    envEmbeddingModel,
    envEmbeddingDimensions,
    envRerankKey,
    envRerankBaseUrl,
    envRerankModel
  ], {
    skipPlaceholders: true
  });
  const source = hasProjectContext || hasProjectRetrieval ? "project" : hasGlobal ? "global" : hasEnv ? "env" : "default";
  const enabledRaw = projectContextSection.enabled ?? projectRetrievalSection.enabled ?? globalSection.enabled;
  const enabled = typeof enabledRaw === "boolean" ? enabledRaw : source !== "default";
  if (!enabled) {
    return {
      enabled,
      candidate_limit: toPositiveInt(projectContextSection.candidate_limit ?? projectRetrievalSection.candidate_limit ?? globalSection.candidate_limit, 8),
      selected_limit: toPositiveInt(projectContextSection.selected_limit ?? projectRetrievalSection.selected_limit ?? globalSection.selected_limit, 4),
      embedding: null,
      rerank: null,
      source,
      enabled_source: source,
      selected_limit_source: hasOwn(projectContextSection, "selected_limit") || hasOwn(projectRetrievalSection, "selected_limit") ? "project" : hasOwn(globalSection, "selected_limit") ? "global" : "default",
      candidate_limit_source: hasOwn(projectContextSection, "candidate_limit") || hasOwn(projectRetrievalSection, "candidate_limit") ? "project" : hasOwn(globalSection, "candidate_limit") ? "global" : "default",
      shared_base_url: "",
      shared_base_url_source: "default",
      shared_api_key_source: "default",
      embedding_base_url_source: "off",
      rerank_base_url_source: "off",
      embedding_api_key_source: "off",
      rerank_api_key_source: "off",
      embedding_dimensions: null,
      embedding_dimensions_source: "off",
      embedding_source: "off",
      rerank_source: "off",
      embedding_disabled_reason: "context_retrieval_disabled",
      rerank_disabled_reason: "context_retrieval_disabled"
    };
  }
  const selectedLimit = toPositiveInt(projectContextSection.selected_limit ?? projectRetrievalSection.selected_limit ?? globalSection.selected_limit, 4);
  const candidateLimit = toPositiveInt(projectContextSection.candidate_limit ?? projectRetrievalSection.candidate_limit ?? globalSection.candidate_limit, 8);
  const selectedLimitSource = hasOwn(projectContextSection, "selected_limit") || hasOwn(projectRetrievalSection, "selected_limit") ? "project" : hasOwn(globalSection, "selected_limit") ? "global" : "default";
  const candidateLimitSource = hasOwn(projectContextSection, "candidate_limit") || hasOwn(projectRetrievalSection, "candidate_limit") ? "project" : hasOwn(globalSection, "candidate_limit") ? "global" : "default";
  const projectContextEmbedding = readNested(projectContextSection, "embedding");
  const projectRetrievalEmbedding = readNested(projectRetrievalSection, "embedding");
  const globalEmbedding = readNested(globalSection, "embedding");
  const projectContextRerank = readNested(projectContextSection, "rerank");
  const projectRetrievalRerank = readNested(projectRetrievalSection, "rerank");
  const globalRerank = readNested(globalSection, "rerank");
  const retrievalResolved = resolveContextWeaverRetrieval({
    defaultEmbeddingModel: DEFAULT_RETRIEVAL_EMBEDDING_MODEL,
    defaultRerankModel: DEFAULT_RETRIEVAL_RERANK_MODEL,
    sharedBaseUrlCandidates: [
      { value: envContextWeaverBaseUrl, source: "env" },
      { value: envRetrievalBaseUrl, source: "env" },
      { value: projectContextSection.base_url, source: "project" },
      { value: projectRetrievalSection.base_url, source: "project" },
      { value: globalSection.base_url, source: "global" }
    ],
    sharedApiKeyCandidates: [
      { value: envContextWeaverKey, source: "env" },
      { value: envRetrievalKey, source: "env" },
      { value: projectContextSection.api_key, source: "project" },
      { value: projectRetrievalSection.api_key, source: "project" },
      { value: globalSection.api_key, source: "global" },
      { value: fallbackApiKey, source: "fallback" }
    ],
    embeddingBaseUrlCandidates: [
      { value: envContextWeaverEmbeddingBaseUrl, source: "env" },
      { value: envContextWeaverBaseUrl, source: "env" },
      { value: envEmbeddingBaseUrl, source: "env" }
    ],
    embeddingApiKeyCandidates: [
      { value: envContextWeaverEmbeddingKey, source: "env" },
      { value: envContextWeaverKey, source: "env" },
      { value: envEmbeddingKey, source: "env" }
    ],
    embeddingModelCandidates: [
      { value: envContextWeaverEmbeddingModel, source: "env" },
      { value: envEmbeddingModel, source: "env" },
      { value: projectContextEmbedding.model, source: "project" },
      { value: projectRetrievalEmbedding.model, source: "project" },
      { value: globalEmbedding.model, source: "global" }
    ],
    embeddingDimensionsCandidates: [
      { value: envContextWeaverEmbeddingDimensions, source: "env" },
      { value: envEmbeddingDimensions, source: "env" },
      { value: projectContextEmbedding.dimensions, source: "project" },
      { value: projectRetrievalEmbedding.dimensions, source: "project" },
      { value: globalEmbedding.dimensions, source: "global" }
    ],
    rerankBaseUrlCandidates: [
      { value: envContextWeaverRerankBaseUrl, source: "env" },
      { value: envContextWeaverBaseUrl, source: "env" },
      { value: envRerankBaseUrl, source: "env" }
    ],
    rerankApiKeyCandidates: [
      { value: envContextWeaverRerankKey, source: "env" },
      { value: envContextWeaverKey, source: "env" },
      { value: envRerankKey, source: "env" }
    ],
    rerankModelCandidates: [
      { value: envContextWeaverRerankModel, source: "env" },
      { value: envRerankModel, source: "env" },
      { value: projectContextRerank.model, source: "project" },
      { value: projectRetrievalRerank.model, source: "project" },
      { value: globalRerank.model, source: "global" }
    ]
  });
  const embedding = retrievalResolved.embedding;
  const rerank = retrievalResolved.rerank;
  return {
    enabled: true,
    candidate_limit: candidateLimit,
    selected_limit: selectedLimit,
    embedding,
    rerank,
    source,
    enabled_source: source,
    selected_limit_source: selectedLimitSource,
    candidate_limit_source: candidateLimitSource,
    shared_base_url: retrievalResolved.sharedBaseUrl,
    shared_base_url_source: retrievalResolved.sharedBaseUrlSource,
    shared_api_key_source: retrievalResolved.sharedApiKeySource,
    embedding_base_url_source: retrievalResolved.embeddingBaseUrlSource,
    rerank_base_url_source: retrievalResolved.rerankBaseUrlSource,
    embedding_api_key_source: retrievalResolved.embeddingApiKeySource,
    rerank_api_key_source: retrievalResolved.rerankApiKeySource,
    embedding_dimensions: retrievalResolved.embeddingDimensions > 0 ? retrievalResolved.embeddingDimensions : null,
    embedding_dimensions_source: retrievalResolved.embeddingDimensions > 0 ? retrievalResolved.embeddingDimensionsSource : "off",
    embedding_source: retrievalResolved.embeddingModelSource,
    rerank_source: retrievalResolved.rerankModelSource,
    embedding_disabled_reason: embedding ? null : "missing_embedding_config",
    rerank_disabled_reason: rerank ? null : "missing_rerank_config"
  };
}
function runCli(argv) {
  const { command, options } = parseArgs(argv);
  const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
  switch (command) {
    case "trim": {
      const historyRaw = payload.history;
      const history = Array.isArray(historyRaw) ? historyRaw.filter((item) => isObject(item)) : [];
      const maxTurns = typeof payload.max_turns === "number" ? payload.max_turns : 3;
      process.stdout.write(`${JSON.stringify({ trimmed: trimHistoryMessages(history, maxTurns), header: HISTORY_COMPACT_HEADER })}
`);
      return 0;
    }
    case "save-history": {
      const historyRaw = payload.history;
      const history = Array.isArray(historyRaw) ? historyRaw.filter((item) => isObject(item)) : [];
      const maxTurns = typeof payload.max_turns === "number" ? payload.max_turns : 3;
      const trimmed = trimHistoryMessages(history, maxTurns);
      const compact = trimmed[0];
      const compactContent = typeof compact.content === "string" ? compact.content : "";
      const sections = parseSnapshotSections(compactContent);
      process.stdout.write(
        `${JSON.stringify({
          warnings: [],
          payload: {
            compact_memory: {
              sections
            }
          }
        })}
`
      );
      return 0;
    }
    case "retrieved-block": {
      const historyRaw = payload.history;
      const history = Array.isArray(historyRaw) ? historyRaw.filter((item) => isObject(item)) : [];
      const prompt = typeof payload.user_prompt === "string" ? payload.user_prompt : "";
      const retrieval = isObject(payload.retrieval_config) ? payload.retrieval_config : null;
      const block = buildRetrievedContextBlock(history, prompt, retrieval);
      process.stdout.write(`${JSON.stringify({ block })}
`);
      return 0;
    }
    case "resolve-config": {
      const projectToml = isObject(payload.project_toml) ? payload.project_toml : {};
      const globalToml = isObject(payload.global_toml) ? payload.global_toml : {};
      const fallbackApiKey = typeof payload.fallback_api_key === "string" ? payload.fallback_api_key : null;
      process.stdout.write(`${JSON.stringify(resolveContextRetrievalConfig(projectToml, fallbackApiKey, globalToml))}
`);
      return 0;
    }
    case "embedding-scores": {
      const candidatesRaw = payload.candidates;
      const response = isObject(payload.response) ? payload.response : {};
      const candidates = Array.isArray(candidatesRaw) ? candidatesRaw.filter((item) => isObject(item)) : [];
      process.stdout.write(`${JSON.stringify({ scores: computeEmbeddingSimilarityScores(candidates, response) })}
`);
      return 0;
    }
    case "rerank-scores": {
      const candidatesRaw = payload.candidates;
      const response = isObject(payload.response) ? payload.response : {};
      const candidates = Array.isArray(candidatesRaw) ? candidatesRaw.filter((item) => isObject(item)) : [];
      process.stdout.write(`${JSON.stringify({ scores: computeRerankScores(candidates, response) })}
`);
      return 0;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}
const entryScript = process.argv[1] ?? "";
const shouldRun = entryScript.includes("history-compaction-contract");
if (shouldRun) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`history-compaction-contract fatal: ${String(error)}
`);
    process.exitCode = 1;
  }
}
export {
  runCli
};
