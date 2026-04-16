import {
  batchDeleteFileChunksFts,
  batchUpdateVectorIndexHash,
  batchUpsertChunkFts,
  clearVectorIndexHash,
  isChunksFtsInitialized
} from "./chunk-35HO3GPM.js";
import {
  logger
} from "./chunk-44FXLQ5V.js";
import {
  getEmbeddingConfig
} from "./chunk-CA4WQHZS.js";

// src/api/embedding/types.ts
var EmbeddingFatalError = class extends Error {
  stage = "embed";
  diagnostics;
  constructor(message, options) {
    super(message, options);
    this.name = "EmbeddingFatalError";
    this.diagnostics = options?.diagnostics ?? createFallbackDiagnostics({
      upstreamMessage: message
    });
  }
};
function createFallbackDiagnostics(options) {
  return {
    stage: "embed",
    category: options.category ?? "unknown",
    httpStatus: null,
    providerType: null,
    providerCode: null,
    upstreamMessage: options.upstreamMessage,
    endpointHost: "<unknown>",
    endpointPath: "/",
    model: "<unknown>",
    batchSize: 0,
    dimensions: 0,
    requestCount: 0
  };
}

// src/api/shared/sleep.ts
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/api/embedding/errors.ts
function isNetworkError(err) {
  const error = err;
  const message = (error?.message || "").toLowerCase();
  const code = error?.code || "";
  const networkErrorPatterns = [
    "terminated",
    "econnreset",
    "etimedout",
    "enotfound",
    "econnrefused",
    "fetch failed",
    "socket hang up",
    "network",
    "aborted"
  ];
  for (const pattern of networkErrorPatterns) {
    if (message.includes(pattern)) {
      return true;
    }
  }
  const networkErrorCodes = ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "EPIPE"];
  return networkErrorCodes.includes(code);
}
function isTimeoutError(err) {
  const error = err;
  const message = (error?.message || "").toLowerCase();
  const code = (error?.code || "").toUpperCase();
  const name = error?.name || "";
  return name === "AbortError" || code === "ETIMEDOUT" || message.includes("timeout") || message.includes("timed out");
}
function classifyEmbeddingFailure(httpStatus, providerType, providerCode, upstreamMessage, err) {
  const signal = `${providerType ?? ""} ${providerCode ?? ""} ${upstreamMessage}`.toLowerCase();
  if (httpStatus === 401 || httpStatus === 403 || hasAnySignal(signal, ["auth", "api_key", "unauthorized", "forbidden"])) {
    return "authentication";
  }
  if (httpStatus === 429 || hasAnySignal(signal, ["rate", "quota", "too many requests"])) {
    return "rate_limit";
  }
  if ((httpStatus === 400 || httpStatus === 413) && hasAnySignal(signal, ["batch", "too large", "max input", "payload too large"])) {
    return "batch_too_large";
  }
  if (hasAnySignal(signal, ["dimension"])) {
    return "dimension_mismatch";
  }
  if (isTimeoutError(err) || hasAnySignal(signal, ["timeout", "timed out"])) {
    return "timeout";
  }
  if (isNetworkError(err) || hasAnySignal(signal, ["econnreset", "enotfound", "fetch failed"])) {
    return "network";
  }
  if (httpStatus === 200 && hasAnySignal(signal, ["\u7F3A\u5C11 data", "\u975E\u6570\u503C\u5411\u91CF", "\u8D8A\u754C\u7684\u7ED3\u679C\u7D22\u5F15", "\u7EF4\u5EA6\u4E0D\u5339\u914D"])) {
    return "incompatible_response";
  }
  if (hasAnySignal(signal, ["response", "payload", "embedding"])) {
    if (hasAnySignal(signal, ["\u7F3A\u5C11 data", "\u975E\u6570\u503C\u5411\u91CF", "\u8D8A\u754C\u7684\u7ED3\u679C\u7D22\u5F15", "\u7EF4\u5EA6\u4E0D\u5339\u914D"])) {
      return "incompatible_response";
    }
  }
  return "unknown";
}
function createFailureDiagnostics(requestContext, details, err) {
  return {
    stage: "embed",
    category: details.category ?? classifyEmbeddingFailure(
      details.httpStatus,
      details.providerType,
      details.providerCode,
      details.upstreamMessage,
      err
    ),
    httpStatus: details.httpStatus,
    providerType: details.providerType,
    providerCode: details.providerCode,
    upstreamMessage: details.upstreamMessage,
    endpointHost: requestContext.endpointHost,
    endpointPath: requestContext.endpointPath,
    model: requestContext.model,
    batchSize: requestContext.batchSize,
    dimensions: requestContext.dimensions,
    requestCount: requestContext.requestCount
  };
}
function getUpstreamMessage(err) {
  if (err instanceof Error) {
    const diagnostics = err;
    if (diagnostics.diagnostics?.upstreamMessage) {
      return diagnostics.diagnostics.upstreamMessage;
    }
    return err.message;
  }
  return String(err);
}
function formatEmbeddingErrorMessage(err) {
  const upstreamMessage = getUpstreamMessage(err);
  return upstreamMessage.startsWith("Embedding API \u9519\u8BEF:") ? upstreamMessage : `Embedding API \u9519\u8BEF: ${upstreamMessage}`;
}
function hasAnySignal(text, signals) {
  return signals.some((signal) => text.includes(signal));
}

// src/api/embedding/fragments.ts
var EMBEDDING_TOKEN_SAFETY_MARGIN_RATIO = 0.05;
function planEmbeddingFragments(texts, maxInputTokens) {
  const allFragments = [];
  const fragmentMap = [];
  const splitTexts = [];
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (isWithinEmbeddingTokenBudget(text, maxInputTokens)) {
      fragmentMap.push([allFragments.length]);
      allFragments.push(text);
      continue;
    }
    const fragments = splitOversizedText(text, maxInputTokens);
    const indices = [];
    for (const fragment of fragments) {
      indices.push(allFragments.length);
      allFragments.push(fragment);
    }
    fragmentMap.push(indices);
    splitTexts.push({
      textIndex: i,
      originalLength: text.length,
      fragmentCount: fragments.length
    });
  }
  return {
    allFragments,
    fragmentMap,
    splitTexts
  };
}
function aggregateFragmentEmbeddings(texts, fragmentMap, flatResults) {
  const results = [];
  for (let i = 0; i < texts.length; i++) {
    const indices = fragmentMap[i];
    if (indices.length === 1) {
      results.push({
        text: texts[i],
        embedding: flatResults[indices[0]].embedding,
        index: i
      });
      continue;
    }
    results.push({
      text: texts[i],
      embedding: averageEmbeddings(indices.map((index) => flatResults[index].embedding)),
      index: i
    });
  }
  return results;
}
function estimateEmbeddingTokens(text) {
  const utf8Bytes = Buffer.byteLength(text, "utf8");
  return Math.max(text.length, Math.ceil(utf8Bytes / 2));
}
function getEmbeddingTokenBudget(maxInputTokens) {
  const safetyMarginTokens = Math.max(
    1,
    Math.ceil(maxInputTokens * EMBEDDING_TOKEN_SAFETY_MARGIN_RATIO)
  );
  return {
    maxInputTokens,
    safetyMarginTokens,
    effectiveTokenBudget: Math.max(1, maxInputTokens - safetyMarginTokens)
  };
}
function isWithinEmbeddingTokenBudget(text, maxInputTokens) {
  return estimateEmbeddingTokens(text) <= getEmbeddingTokenBudget(maxInputTokens).effectiveTokenBudget;
}
function assertWithinEmbeddingTokenBudget(text, maxInputTokens) {
  const estimatedTokens = estimateEmbeddingTokens(text);
  const budget = getEmbeddingTokenBudget(maxInputTokens);
  if (estimatedTokens <= budget.effectiveTokenBudget) {
    return;
  }
  throw new Error(
    `\u6587\u672C\u4F30\u7B97 token \u8D85\u8FC7 embedding \u5B89\u5168\u9884\u7B97: estimated=${estimatedTokens}, effectiveBudget=${budget.effectiveTokenBudget}, maxInputTokens=${budget.maxInputTokens}, safetyMargin=${budget.safetyMarginTokens}`
  );
}
function splitOversizedText(text, maxInputTokens) {
  if (isWithinEmbeddingTokenBudget(text, maxInputTokens)) {
    return [text];
  }
  const lines = text.split("\n");
  const fragments = [];
  let current = "";
  for (const line of lines) {
    const candidate = current.length === 0 ? line : `${current}
${line}`;
    if (isWithinEmbeddingTokenBudget(candidate, maxInputTokens)) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      fragments.push(current);
      current = "";
    }
    if (line.length === 0) {
      current = line;
      continue;
    }
    let remaining = line;
    while (remaining.length > 0) {
      const clipped = clipTextToBudget(remaining, maxInputTokens);
      fragments.push(clipped);
      remaining = remaining.slice(clipped.length);
    }
  }
  if (current.length > 0) {
    fragments.push(current);
  }
  if (fragments.length === 0) {
    return [clipTextToBudget(text, maxInputTokens)];
  }
  for (const fragment of fragments) {
    assertWithinEmbeddingTokenBudget(fragment, maxInputTokens);
  }
  return fragments;
}
function clipTextToBudget(text, maxInputTokens) {
  if (text.length === 0) {
    return text;
  }
  let low = 1;
  let high = text.length;
  let bestFit = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = text.slice(0, mid);
    if (isWithinEmbeddingTokenBudget(candidate, maxInputTokens)) {
      bestFit = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return text.slice(0, Math.max(1, bestFit));
}
function averageEmbeddings(embeddings) {
  const dimensions = embeddings[0].length;
  const result = new Array(dimensions).fill(0);
  for (const embedding of embeddings) {
    for (let i = 0; i < dimensions; i++) {
      result[i] += embedding[i];
    }
  }
  for (let i = 0; i < dimensions; i++) {
    result[i] /= embeddings.length;
  }
  return result;
}

// src/api/embedding/progressTracker.ts
var ProgressTracker = class {
  completed = 0;
  total;
  totalTokens = 0;
  startTime;
  lastLogTime = 0;
  logIntervalMs = 2e3;
  onProgress;
  skipLogs;
  constructor(total, onProgress) {
    this.total = total;
    this.startTime = Date.now();
    this.onProgress = onProgress;
    this.skipLogs = total <= 1;
  }
  recordBatch(tokens) {
    this.completed++;
    this.totalTokens += tokens;
    this.onProgress?.(this.completed, this.total);
    const now = Date.now();
    if (now - this.lastLogTime >= this.logIntervalMs) {
      this.logProgress();
      this.lastLogTime = now;
    }
  }
  complete() {
    if (this.skipLogs) {
      return;
    }
    const elapsed = (Date.now() - this.startTime) / 1e3;
    logger.info(
      {
        batches: this.total,
        tokens: this.totalTokens,
        elapsed: `${elapsed.toFixed(1)}s`,
        avgTokensPerBatch: Math.round(this.totalTokens / this.total)
      },
      "Embedding \u5B8C\u6210"
    );
  }
  logProgress() {
    if (this.skipLogs) {
      return;
    }
    const elapsed = (Date.now() - this.startTime) / 1e3;
    const percent = Math.round(this.completed / this.total * 100);
    const rate = this.completed / elapsed;
    const eta = rate > 0 ? Math.round((this.total - this.completed) / rate) : 0;
    logger.info(
      {
        progress: `${this.completed}/${this.total}`,
        percent: `${percent}%`,
        tokens: this.totalTokens,
        elapsed: `${elapsed.toFixed(1)}s`,
        eta: `${eta}s`
      },
      "Embedding \u8FDB\u5EA6"
    );
  }
};

// src/api/embedding/rateLimitController.ts
var RateLimitController = class {
  isPaused = false;
  pausePromise = null;
  currentConcurrency;
  maxConcurrency;
  activeRequests = 0;
  consecutiveSuccesses = 0;
  backoffMs = 5e3;
  successesPerConcurrencyIncrease = 3;
  minBackoffMs = 5e3;
  maxBackoffMs = 6e4;
  constructor(maxConcurrency) {
    this.maxConcurrency = maxConcurrency;
    this.currentConcurrency = maxConcurrency;
  }
  async acquire() {
    if (this.pausePromise) {
      await this.pausePromise;
    }
    while (this.activeRequests >= this.currentConcurrency) {
      await sleep(50);
      if (this.pausePromise) {
        await this.pausePromise;
      }
    }
    this.activeRequests++;
  }
  releaseSuccess() {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    this.consecutiveSuccesses++;
    if (this.currentConcurrency < this.maxConcurrency && this.consecutiveSuccesses >= this.successesPerConcurrencyIncrease) {
      this.currentConcurrency++;
      this.consecutiveSuccesses = 0;
    }
    if (this.consecutiveSuccesses > 0 && this.consecutiveSuccesses % 10 === 0) {
      this.backoffMs = Math.max(this.minBackoffMs, this.backoffMs / 2);
    }
  }
  releaseFailure() {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
  }
  releaseForRetry() {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    this.consecutiveSuccesses = 0;
  }
  async triggerRateLimit() {
    if (this.isPaused && this.pausePromise) {
      logger.debug("\u901F\u7387\u9650\u5236\uFF1A\u7B49\u5F85\u73B0\u6709\u6682\u505C\u7ED3\u675F");
      await this.pausePromise;
      return;
    }
    this.isPaused = true;
    this.consecutiveSuccesses = 0;
    const previousConcurrency = this.currentConcurrency;
    this.currentConcurrency = 1;
    logger.warn(
      {
        backoffMs: this.backoffMs,
        previousConcurrency,
        newConcurrency: this.currentConcurrency,
        activeRequests: this.activeRequests
      },
      "\u901F\u7387\u9650\u5236\uFF1A\u89E6\u53D1 429\uFF0C\u6682\u505C\u6240\u6709\u8BF7\u6C42"
    );
    let resumeResolve = () => {
    };
    this.pausePromise = new Promise((resolve) => {
      resumeResolve = resolve;
    });
    await sleep(this.backoffMs);
    this.backoffMs = Math.min(this.maxBackoffMs, this.backoffMs * 2);
    this.isPaused = false;
    this.pausePromise = null;
    resumeResolve();
    logger.info({ waitMs: this.backoffMs }, "\u901F\u7387\u9650\u5236\uFF1A\u6062\u590D\u8BF7\u6C42");
  }
  getStatus() {
    return {
      isPaused: this.isPaused,
      currentConcurrency: this.currentConcurrency,
      maxConcurrency: this.maxConcurrency,
      activeRequests: this.activeRequests,
      backoffMs: this.backoffMs
    };
  }
};
var globalRateLimitController = null;
function getRateLimitController(maxConcurrency) {
  if (!globalRateLimitController) {
    globalRateLimitController = new RateLimitController(maxConcurrency);
  }
  return globalRateLimitController;
}

// src/api/embedding/transport.ts
async function processEmbeddingBatch(options) {
  const { config, texts, startIndex, batchSize, session } = options;
  if (session.fatalError) {
    throw session.fatalError;
  }
  for (const text of texts) {
    try {
      assertWithinEmbeddingTokenBudget(text, config.maxInputTokens);
    } catch (err) {
      throw new EmbeddingFatalError(
        `Embedding \u8BF7\u6C42\u5728\u53D1\u9001\u524D\u9884\u7B97\u6821\u9A8C\u5931\u8D25: ${err.message}`
      );
    }
  }
  const requestBody = {
    model: config.model,
    input: texts,
    encoding_format: "float"
  };
  const requestContext = createRequestContext(config, batchSize, texts.length);
  const controller = new AbortController();
  session.controllers.add(controller);
  try {
    const response = await fetch(config.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    const data = await readEmbeddingResponse(response, requestContext);
    if (!response.ok || data.error) {
      const upstreamMessage = data.error?.message || `HTTP ${response.status}`;
      throw new EmbeddingFatalError(`Embedding API \u9519\u8BEF: ${upstreamMessage}`, {
        diagnostics: createFailureDiagnostics(requestContext, {
          httpStatus: response.status,
          providerType: data.error?.type ?? null,
          providerCode: data.error?.code ?? null,
          upstreamMessage
        })
      });
    }
    if (session.fatalError) {
      throw session.fatalError;
    }
    assertCompatibleResponse(data, texts, requestContext, config.dimensions);
    return {
      results: data.data.map((item) => ({
        text: texts[item.index],
        embedding: item.embedding,
        index: startIndex + item.index
      })),
      totalTokens: data.usage?.total_tokens || 0
    };
  } catch (err) {
    if (err instanceof EmbeddingFatalError) {
      throw err;
    }
    throw new EmbeddingFatalError(formatEmbeddingErrorMessage(err), {
      cause: err,
      diagnostics: createFailureDiagnostics(
        requestContext,
        {
          httpStatus: null,
          providerType: null,
          providerCode: null,
          upstreamMessage: getUpstreamMessage(err)
        },
        err
      )
    });
  } finally {
    session.controllers.delete(controller);
  }
}
function createRequestContext(config, batchSize, requestCount) {
  const endpoint = parseEndpoint(config.baseUrl);
  return {
    endpointHost: endpoint.host,
    endpointPath: endpoint.path,
    model: config.model,
    batchSize,
    dimensions: config.dimensions,
    requestCount
  };
}
async function readEmbeddingResponse(response, requestContext) {
  try {
    return await response.json();
  } catch (err) {
    throw new EmbeddingFatalError("Embedding API \u8FD4\u56DE\u4E86\u4E0D\u53EF\u89E3\u6790\u7684\u54CD\u5E94", {
      cause: err,
      diagnostics: createFailureDiagnostics(
        requestContext,
        {
          httpStatus: response.status,
          providerType: null,
          providerCode: null,
          upstreamMessage: "Embedding API \u8FD4\u56DE\u4E86\u4E0D\u53EF\u89E3\u6790\u7684\u54CD\u5E94",
          category: "incompatible_response"
        },
        err
      )
    });
  }
}
function assertCompatibleResponse(data, texts, requestContext, expectedDimensions) {
  if (!Array.isArray(data.data)) {
    throw new EmbeddingFatalError("Embedding API \u8FD4\u56DE\u7F3A\u5C11 data \u6570\u7EC4", {
      diagnostics: createFailureDiagnostics(requestContext, {
        httpStatus: 200,
        providerType: null,
        providerCode: null,
        upstreamMessage: "Embedding API \u8FD4\u56DE\u7F3A\u5C11 data \u6570\u7EC4",
        category: "incompatible_response"
      })
    });
  }
  for (const item of data.data) {
    if (typeof item?.index !== "number" || item.index < 0 || item.index >= texts.length) {
      throw new EmbeddingFatalError("Embedding API \u8FD4\u56DE\u4E86\u8D8A\u754C\u7684\u7ED3\u679C\u7D22\u5F15", {
        diagnostics: createFailureDiagnostics(requestContext, {
          httpStatus: 200,
          providerType: null,
          providerCode: null,
          upstreamMessage: "Embedding API \u8FD4\u56DE\u4E86\u8D8A\u754C\u7684\u7ED3\u679C\u7D22\u5F15",
          category: "incompatible_response"
        })
      });
    }
    if (!Array.isArray(item.embedding) || item.embedding.some((value) => typeof value !== "number")) {
      throw new EmbeddingFatalError("Embedding API \u8FD4\u56DE\u4E86\u975E\u6570\u503C\u5411\u91CF", {
        diagnostics: createFailureDiagnostics(requestContext, {
          httpStatus: 200,
          providerType: null,
          providerCode: null,
          upstreamMessage: "Embedding API \u8FD4\u56DE\u4E86\u975E\u6570\u503C\u5411\u91CF",
          category: "incompatible_response"
        })
      });
    }
    if (item.embedding.length !== expectedDimensions) {
      throw new EmbeddingFatalError(
        `Embedding \u5411\u91CF\u7EF4\u5EA6\u4E0D\u5339\u914D: expected ${expectedDimensions}, got ${item.embedding.length}`,
        {
          diagnostics: createFailureDiagnostics(requestContext, {
            httpStatus: 200,
            providerType: null,
            providerCode: null,
            upstreamMessage: `Embedding \u5411\u91CF\u7EF4\u5EA6\u4E0D\u5339\u914D: expected ${expectedDimensions}, got ${item.embedding.length}`,
            category: "incompatible_response"
          })
        }
      );
    }
  }
}
function parseEndpoint(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return {
      host: url.host,
      path: url.pathname || "/"
    };
  } catch {
    return {
      host: "<invalid-url>",
      path: "/"
    };
  }
}

// src/api/embedding/client.ts
var EmbeddingClient = class {
  config;
  rateLimiter;
  constructor(config) {
    this.config = config || getEmbeddingConfig();
    this.rateLimiter = getRateLimitController(this.config.maxConcurrency);
  }
  async embed(text) {
    const results = await this.embedBatch([text]);
    return results[0].embedding;
  }
  async embedBatch(texts, batchSize = this.config.batchSize, onProgress) {
    if (texts.length === 0) {
      return [];
    }
    const budget = getEmbeddingTokenBudget(this.config.maxInputTokens);
    const fragmentPlan = planEmbeddingFragments(texts, this.config.maxInputTokens);
    for (const splitText of fragmentPlan.splitTexts) {
      logger.warn(
        {
          textIndex: splitText.textIndex,
          originalLength: splitText.originalLength,
          effectiveTokenBudget: budget.effectiveTokenBudget,
          maxInputTokens: budget.maxInputTokens,
          safetyMarginTokens: budget.safetyMarginTokens,
          fragmentCount: splitText.fragmentCount
        },
        "\u6587\u672C\u8D85\u8FC7 embedding \u6A21\u578B\u8F93\u5165\u4E0A\u9650\uFF0C\u5DF2\u62C6\u5206\u4E3A\u591A\u4E2A\u5B50\u7247\u6BB5"
      );
    }
    const flatResults = await this.embedFragments(fragmentPlan.allFragments, batchSize, onProgress);
    return aggregateFragmentEmbeddings(texts, fragmentPlan.fragmentMap, flatResults);
  }
  getConfig() {
    return { ...this.config };
  }
  getRateLimiterStatus() {
    return this.rateLimiter.getStatus();
  }
  async embedFragments(texts, batchSize, onProgress) {
    const batches = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      batches.push(texts.slice(i, i + batchSize));
    }
    const progress = new ProgressTracker(batches.length, onProgress);
    const session = {
      fatalError: null,
      controllers: /* @__PURE__ */ new Set()
    };
    const batchResults = await Promise.all(
      batches.map(
        (batch, batchIndex) => this.processWithRateLimit(batch, batchIndex * batchSize, batchSize, progress, session)
      )
    );
    progress.complete();
    return batchResults.flat();
  }
  async processWithRateLimit(texts, startIndex, batchSize, progress, session) {
    const MAX_NETWORK_RETRIES = 3;
    const MAX_RATE_LIMIT_RETRIES = 3;
    let networkRetries = 0;
    let rateLimitRetries = 0;
    while (true) {
      if (session.fatalError) {
        throw session.fatalError;
      }
      await this.rateLimiter.acquire();
      if (session.fatalError) {
        this.rateLimiter.releaseFailure();
        throw session.fatalError;
      }
      try {
        const result = await this.processBatch(texts, startIndex, batchSize, progress, session);
        if (session.fatalError) {
          this.rateLimiter.releaseFailure();
          throw session.fatalError;
        }
        this.rateLimiter.releaseSuccess();
        return result;
      } catch (err) {
        if (session.fatalError) {
          this.rateLimiter.releaseFailure();
          throw session.fatalError;
        }
        const fatalError = err instanceof EmbeddingFatalError ? err : null;
        const error = err;
        const errorMessage = fatalError?.diagnostics.upstreamMessage || error?.message || "";
        const isRateLimited = fatalError?.diagnostics.httpStatus === 429 || errorMessage.includes("429") || errorMessage.includes("rate");
        const timeoutError = isTimeoutError(fatalError?.cause ?? err);
        const networkError = isNetworkError(fatalError?.cause ?? err);
        if (isRateLimited) {
          if (rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
            rateLimitRetries++;
            this.rateLimiter.releaseForRetry();
            await this.rateLimiter.triggerRateLimit();
            networkRetries = 0;
          } else {
            const sessionError = this.failSession(session, err);
            this.rateLimiter.releaseFailure();
            throw sessionError;
          }
        } else if (!timeoutError && networkError && networkRetries < MAX_NETWORK_RETRIES) {
          networkRetries++;
          const delayMs = 1e3 * 2 ** (networkRetries - 1);
          logger.warn(
            {
              error: errorMessage,
              retry: networkRetries,
              maxRetries: MAX_NETWORK_RETRIES,
              delayMs
            },
            "\u7F51\u7EDC\u9519\u8BEF\uFF0C\u51C6\u5907\u91CD\u8BD5"
          );
          this.rateLimiter.releaseForRetry();
          await sleep(delayMs);
        } else {
          const sessionError = this.failSession(session, err);
          this.rateLimiter.releaseFailure();
          if (networkError) {
            logger.error({ error: errorMessage, retries: networkRetries }, "\u7F51\u7EDC\u9519\u8BEF\u91CD\u8BD5\u6B21\u6570\u8017\u5C3D");
          }
          throw sessionError;
        }
      }
    }
  }
  async processBatch(texts, startIndex, batchSize, progress, session) {
    const { results, totalTokens } = await processEmbeddingBatch({
      config: this.config,
      texts,
      startIndex,
      batchSize,
      session
    });
    if (session.fatalError) {
      throw session.fatalError;
    }
    progress.recordBatch(totalTokens);
    return results;
  }
  failSession(session, err) {
    if (session.fatalError) {
      return session.fatalError;
    }
    const fatalError = err instanceof EmbeddingFatalError ? err : new EmbeddingFatalError(formatEmbeddingErrorMessage(err), {
      cause: err,
      diagnostics: createFallbackDiagnostics({
        category: classifyEmbeddingFailure(null, null, null, getUpstreamMessage(err), err),
        upstreamMessage: getUpstreamMessage(err)
      })
    });
    session.fatalError = fatalError;
    for (const controller of session.controllers) {
      controller.abort();
    }
    return fatalError;
  }
};
var defaultClient = null;
function getEmbeddingClient() {
  if (!defaultClient) {
    defaultClient = new EmbeddingClient();
  }
  return defaultClient;
}

// src/vectorStore/index.ts
import fs from "fs";
import os from "os";
import path from "path";
import * as lancedb from "@lancedb/lancedb";
var BASE_DIR = path.join(os.homedir(), ".contextweaver");
var VectorStore = class {
  db = null;
  table = null;
  projectId;
  dbPath;
  vectorDim;
  constructor(projectId, vectorDim = 1024) {
    this.projectId = projectId;
    this.dbPath = path.join(BASE_DIR, projectId, "vectors.lance");
    this.vectorDim = vectorDim;
  }
  /**
   * 初始化连接
   */
  async init() {
    if (this.db) return;
    const projectDir = path.join(BASE_DIR, this.projectId);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    this.db = await lancedb.connect(this.dbPath);
    const tableNames = await this.db.tableNames();
    if (tableNames.includes("chunks")) {
      this.table = await this.db.openTable("chunks");
    }
  }
  /**
   * 确保表存在（首次插入时调用）
   */
  async ensureTable(records) {
    if (this.table) return;
    if (!this.db) throw new Error("VectorStore not initialized");
    if (records.length === 0) return;
    this.table = await this.db.createTable(
      "chunks",
      records
    );
  }
  /**
   * 单调版本更新：先插入新版本，再删除旧版本
   *
   * 这保证了：
   * - 最坏情况（崩溃）是新旧版本共存（不缺失）
   * - 正常情况下旧版本被清理
   */
  async upsertFile(filePath, newHash, records) {
    if (!this.db) throw new Error("VectorStore not initialized");
    if (records.length === 0) {
      await this.deleteFile(filePath);
      return;
    }
    if (!this.table) {
      await this.ensureTable(records);
    } else {
      await this.table.add(records);
    }
    if (this.table) {
      await this.table.delete(
        `file_path = '${this.escapeString(filePath)}' AND file_hash != '${this.escapeString(newHash)}'`
      );
    }
  }
  /**
   * 批量 upsert 多个文件（性能优化版，带分批机制）
   *
   * 流程：
   * 1. 将文件分成小批次（每批最多 BATCH_FILES 个文件或 BATCH_RECORDS 条记录）
   * 2. 每批执行：插入新 records → 删除旧版本
   *
   * 分批是必要的，因为 LanceDB native 模块在处理超大数据时可能崩溃
   *
   * @param files 文件列表，每个包含 path、hash 和 records
   */
  async batchUpsertFiles(files) {
    if (!this.db) throw new Error("VectorStore not initialized");
    if (files.length === 0) return;
    const BATCH_FILES = 50;
    const BATCH_RECORDS = 5e3;
    const batches = [];
    let currentBatch = [];
    let currentRecordCount = 0;
    for (const file of files) {
      if (currentBatch.length >= BATCH_FILES || currentRecordCount + file.records.length > BATCH_RECORDS) {
        if (currentBatch.length > 0) {
          batches.push(currentBatch);
        }
        currentBatch = [];
        currentRecordCount = 0;
      }
      currentBatch.push(file);
      currentRecordCount += file.records.length;
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }
    for (const batch of batches) {
      const batchRecords = [];
      for (const file of batch) {
        batchRecords.push(...file.records);
      }
      if (batchRecords.length === 0) {
        const pathsToDelete = batch.map((f) => f.path);
        await this.deleteFiles(pathsToDelete);
        continue;
      }
      if (!this.table) {
        await this.ensureTable(batchRecords);
      } else {
        await this.table.add(batchRecords);
      }
      if (this.table && batch.length > 0) {
        const deleteConditions = batch.map(
          (f) => `(file_path = '${this.escapeString(f.path)}' AND file_hash != '${this.escapeString(f.hash)}')`
        ).join(" OR ");
        await this.table.delete(deleteConditions);
      }
    }
  }
  /**
   * 删除文件的所有 chunks
   */
  async deleteFile(filePath) {
    if (!this.table) return;
    await this.table.delete(`file_path = '${this.escapeString(filePath)}'`);
  }
  /**
   * 批量删除文件（性能优化：单次 DELETE 替代 N 次循环）
   */
  async deleteFiles(filePaths) {
    if (!this.table || filePaths.length === 0) return;
    const conditions = filePaths.map((p) => `file_path = '${this.escapeString(p)}'`).join(" OR ");
    await this.table.delete(conditions);
  }
  /**
   * 向量搜索
   */
  async search(queryVector, limit = 10, filter) {
    if (!this.table) return [];
    let query = this.table.vectorSearch(queryVector).limit(limit);
    if (filter) {
      query = query.where(filter);
    }
    const results = await query.toArray();
    return results;
  }
  /**
   * 获取文件的所有 chunks（按 chunk_index 排序）
   */
  async getFileChunks(filePath) {
    if (!this.table) return [];
    const results = await this.table.query().where(`file_path = '${this.escapeString(filePath)}'`).toArray();
    const chunks = results;
    return chunks.sort((a, b) => a.chunk_index - b.chunk_index);
  }
  /**
   * 批量获取多个文件的 chunks（性能优化：单次查询替代 N 次循环）
   *
   * 适用于 GraphExpander 扩展、词法召回等需要批量获取的场景
   * @returns Map<filePath, ChunkRecord[]>，每个文件的 chunks 已按 chunk_index 排序
   */
  async getFilesChunks(filePaths) {
    const result = /* @__PURE__ */ new Map();
    if (!this.table || filePaths.length === 0) return result;
    const conditions = filePaths.map((p) => `file_path = '${this.escapeString(p)}'`).join(" OR ");
    const rows = await this.table.query().where(conditions).toArray();
    for (const row of rows) {
      let arr = result.get(row.file_path);
      if (!arr) {
        arr = [];
        result.set(row.file_path, arr);
      }
      arr.push(row);
    }
    for (const arr of result.values()) {
      arr.sort((a, b) => a.chunk_index - b.chunk_index);
    }
    return result;
  }
  /**
   * 获取表的总记录数
   */
  async count() {
    if (!this.table) return 0;
    return await this.table.countRows();
  }
  /**
   * 清空所有数据
   */
  async clear() {
    if (!this.db) return;
    try {
      await this.db.dropTable("chunks");
      this.table = null;
    } catch {
    }
  }
  /**
   * 获取向量维度
   */
  getVectorDim() {
    return this.vectorDim;
  }
  /**
   * 转义字符串（防止 SQL 注入）
   */
  escapeString(str) {
    return str.replace(/'/g, "''");
  }
  /**
   * 关闭连接
   */
  async close() {
    this.db = null;
    this.table = null;
  }
};
var vectorStores = /* @__PURE__ */ new Map();
async function getVectorStore(projectId, vectorDim = 1024) {
  let store = vectorStores.get(projectId);
  if (!store) {
    store = new VectorStore(projectId, vectorDim);
    await store.init();
    vectorStores.set(projectId, store);
  }
  return store;
}
async function closeAllVectorStores() {
  for (const store of vectorStores.values()) {
    await store.close();
  }
  vectorStores.clear();
}

// src/indexer/index.ts
var Indexer = class {
  projectId;
  vectorStore = null;
  embeddingClient;
  vectorDim;
  constructor(projectId, vectorDim = 1024) {
    this.projectId = projectId;
    this.vectorDim = vectorDim;
    this.embeddingClient = getEmbeddingClient();
  }
  /**
   * 初始化
   */
  async init() {
    this.vectorStore = await getVectorStore(this.projectId, this.vectorDim);
  }
  /**
   * 处理扫描结果，更新向量索引
   *
   * @param db SQLite 数据库实例
   * @param results 文件处理结果
   * @param onProgress 可选的进度回调 (indexed, total) => void
   */
  async indexFiles(db, results, onProgress) {
    if (!this.vectorStore) {
      await this.init();
    }
    const stats = {
      indexed: 0,
      deleted: 0,
      errors: 0,
      skipped: 0
    };
    const toIndex = [];
    const toDelete = [];
    const noChunkSettled = [];
    for (const result of results) {
      switch (result.status) {
        case "added":
        case "modified":
          if (result.chunks.length > 0) {
            toIndex.push({
              path: result.relPath,
              hash: result.hash,
              chunks: result.chunks
            });
          } else {
            if (result.status === "modified") {
              toDelete.push(result.relPath);
            }
            noChunkSettled.push({
              path: result.relPath,
              hash: result.hash
            });
            stats.skipped++;
          }
          break;
        case "deleted":
          toDelete.push(result.relPath);
          break;
        case "unchanged":
          stats.skipped++;
          break;
        case "skipped":
        case "error":
          stats.skipped++;
          break;
      }
    }
    if (toDelete.length > 0) {
      await this.deleteFiles(db, toDelete);
      stats.deleted = toDelete.length;
    }
    if (noChunkSettled.length > 0) {
      batchUpdateVectorIndexHash(db, noChunkSettled);
      logger.debug({ count: noChunkSettled.length }, "\u65E0\u53EF\u7D22\u5F15 chunk\uFF0C\u6807\u8BB0\u5411\u91CF\u7D22\u5F15\u72B6\u6001\u4E3A\u5DF2\u6536\u655B");
    }
    if (toIndex.length > 0) {
      const indexResult = await this.batchIndex(db, toIndex, onProgress);
      stats.indexed = indexResult.success;
      stats.errors = indexResult.errors;
    }
    logger.info(
      {
        indexed: stats.indexed,
        vectorRecordsDeleted: stats.deleted,
        errors: stats.errors,
        skipped: stats.skipped
      },
      "\u5411\u91CF\u7D22\u5F15\u5B8C\u6210"
    );
    return stats;
  }
  /**
   * 批量索引文件（性能优化版）
   *
   * 优化策略：
   * 1. Embedding 已批量化（原有）
   * 2. LanceDB 写入批量化：N 次 upsertFile → 1 次 batchUpsertFiles
   * 3. FTS 写入批量化：N 次删除+插入 → 1 次批量删除 + 1 次批量插入
   * 4. 日志汇总化：逐文件日志 → 汇总日志
   */
  async batchIndex(db, files, onProgress) {
    if (files.length === 0) {
      return { success: 0, errors: 0 };
    }
    const allTexts = [];
    const globalIndexByFileChunk = [];
    for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
      const file = files[fileIdx];
      globalIndexByFileChunk[fileIdx] = [];
      for (let chunkIdx = 0; chunkIdx < file.chunks.length; chunkIdx++) {
        const globalIdx = allTexts.length;
        allTexts.push(file.chunks[chunkIdx].vectorText);
        globalIndexByFileChunk[fileIdx][chunkIdx] = globalIdx;
      }
    }
    if (allTexts.length === 0) {
      return { success: 0, errors: 0 };
    }
    const { batchSize } = this.embeddingClient.getConfig();
    logger.info({ count: allTexts.length, files: files.length, batchSize }, "\u5F00\u59CB\u6279\u91CF Embedding");
    let embeddings;
    try {
      const results = await this.embeddingClient.embedBatch(allTexts, batchSize, onProgress);
      embeddings = results.map((r) => r.embedding);
    } catch (err) {
      const error = err;
      logger.error({ error: error.message, stack: error.stack }, "Embedding \u5931\u8D25");
      clearVectorIndexHash(
        db,
        files.map((f) => f.path)
      );
      const diagnostics = err instanceof EmbeddingFatalError ? err.diagnostics : void 0;
      const upstreamMessage = diagnostics?.upstreamMessage || error.message || "\u672A\u77E5\u9519\u8BEF";
      throw new EmbeddingFatalError(`\u5411\u91CF\u5D4C\u5165\u9636\u6BB5\u5931\u8D25: ${upstreamMessage}`, {
        cause: err,
        diagnostics
      });
    }
    const filesToUpsert = [];
    const allFtsChunks = [];
    const successFiles = [];
    const errorFiles = [];
    for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
      const file = files[fileIdx];
      try {
        const records = [];
        for (let chunkIdx = 0; chunkIdx < file.chunks.length; chunkIdx++) {
          const chunk = file.chunks[chunkIdx];
          const globalIdx = globalIndexByFileChunk[fileIdx][chunkIdx];
          if (globalIdx === void 0) {
            throw new Error(`\u627E\u4E0D\u5230 chunk \u7684 embedding: ${file.path}#${chunkIdx}`);
          }
          const record = {
            chunk_id: `${file.path}#${file.hash}#${chunkIdx}`,
            file_path: file.path,
            file_hash: file.hash,
            chunk_index: chunkIdx,
            vector: embeddings[globalIdx],
            display_code: chunk.displayCode,
            vector_text: chunk.vectorText,
            language: chunk.metadata.language,
            breadcrumb: chunk.metadata.contextPath.join(" > "),
            start_index: chunk.metadata.startIndex,
            end_index: chunk.metadata.endIndex,
            raw_start: chunk.metadata.rawSpan.start,
            raw_end: chunk.metadata.rawSpan.end,
            vec_start: chunk.metadata.vectorSpan.start,
            vec_end: chunk.metadata.vectorSpan.end
          };
          records.push(record);
          allFtsChunks.push({
            chunkId: record.chunk_id,
            filePath: record.file_path,
            chunkIndex: record.chunk_index,
            breadcrumb: record.breadcrumb,
            content: `${record.breadcrumb}
${record.display_code}`
          });
        }
        filesToUpsert.push({ path: file.path, hash: file.hash, records });
        successFiles.push({ path: file.path, hash: file.hash });
      } catch (err) {
        const error = err;
        logger.error(
          { path: file.path, error: error.message, stack: error.stack },
          "\u7EC4\u88C5 ChunkRecord \u5931\u8D25"
        );
        errorFiles.push(file.path);
      }
    }
    if (filesToUpsert.length > 0) {
      try {
        await this.vectorStore?.batchUpsertFiles(filesToUpsert);
        logger.info(
          { files: filesToUpsert.length, chunks: allFtsChunks.length },
          "LanceDB \u6279\u91CF\u5199\u5165\u5B8C\u6210"
        );
      } catch (err) {
        const error = err;
        logger.error({ error: error.message, stack: error.stack }, "LanceDB \u6279\u91CF\u5199\u5165\u5931\u8D25");
        clearVectorIndexHash(
          db,
          files.map((f) => f.path)
        );
        return { success: 0, errors: files.length };
      }
    }
    if (isChunksFtsInitialized(db) && allFtsChunks.length > 0) {
      try {
        const pathsToDelete = filesToUpsert.map((f) => f.path);
        batchDeleteFileChunksFts(db, pathsToDelete);
        batchUpsertChunkFts(db, allFtsChunks);
        logger.info(
          { files: pathsToDelete.length, chunks: allFtsChunks.length },
          "FTS \u6279\u91CF\u66F4\u65B0\u5B8C\u6210"
        );
      } catch (err) {
        const error = err;
        logger.warn({ error: error.message }, "FTS \u6279\u91CF\u66F4\u65B0\u5931\u8D25\uFF08\u5411\u91CF\u7D22\u5F15\u5DF2\u6210\u529F\uFF09");
      }
    }
    if (successFiles.length > 0) {
      batchUpdateVectorIndexHash(db, successFiles);
    }
    logger.info({ success: successFiles.length, errors: errorFiles.length }, "\u6279\u91CF\u7D22\u5F15\u5B8C\u6210");
    return { success: successFiles.length, errors: errorFiles.length };
  }
  /**
   * 删除文件的向量和 FTS 索引
   */
  async deleteFiles(db, paths) {
    if (!this.vectorStore) return;
    await this.vectorStore.deleteFiles(paths);
    if (isChunksFtsInitialized(db)) {
      batchDeleteFileChunksFts(db, paths);
    }
    logger.debug({ count: paths.length }, "\u5220\u9664\u6587\u4EF6\u7D22\u5F15");
  }
  /**
   * 向量搜索
   */
  async search(queryVector, limit = 10, filter) {
    if (!this.vectorStore) {
      await this.init();
    }
    return this.vectorStore?.search(queryVector, limit, filter);
  }
  /**
   * 文本搜索（先 embedding 再向量搜索）
   */
  async textSearch(query, limit = 10, filter) {
    const queryVector = await this.embeddingClient.embed(query);
    return this.search(queryVector, limit, filter);
  }
  /**
   * 清空索引
   */
  async clear() {
    if (!this.vectorStore) {
      await this.init();
    }
    await this.vectorStore?.clear();
  }
  /**
   * 获取索引统计
   */
  async getStats() {
    if (!this.vectorStore) {
      await this.init();
    }
    const count = await this.vectorStore?.count() ?? 0;
    return { totalChunks: count };
  }
};
var indexers = /* @__PURE__ */ new Map();
async function getIndexer(projectId, vectorDim = 1024) {
  let indexer = indexers.get(projectId);
  if (!indexer) {
    indexer = new Indexer(projectId, vectorDim);
    await indexer.init();
    indexers.set(projectId, indexer);
  }
  return indexer;
}
function closeAllIndexers() {
  indexers.clear();
}

export {
  sleep,
  EmbeddingFatalError,
  getVectorStore,
  closeAllVectorStores,
  getIndexer,
  closeAllIndexers
};
//# sourceMappingURL=chunk-WQHSYTJN.js.map