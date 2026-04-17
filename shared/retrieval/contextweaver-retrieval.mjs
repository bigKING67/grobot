function normalizeCandidateRows(candidates) {
  if (!Array.isArray(candidates)) {
    return [];
  }
  const rows = [];
  for (const item of candidates) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      rows.push({
        value: String(item.value ?? "").trim(),
        source: String(item.source ?? "").trim() || "unknown",
      });
      continue;
    }
    if (typeof item === "string") {
      rows.push({
        value: item.trim(),
        source: "unknown",
      });
      continue;
    }
    if (typeof item === "number" && Number.isFinite(item)) {
      rows.push({
        value: String(item),
        source: "unknown",
      });
    }
  }
  return rows;
}

function toPositiveInt(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const value = Math.floor(raw);
    return value > 0 ? value : 0;
  }
  const normalized = String(raw ?? "").trim();
  if (!/^\d+$/.test(normalized)) {
    return 0;
  }
  const value = Number.parseInt(normalized, 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function toPositiveIntString(raw) {
  const value = toPositiveInt(raw);
  return value > 0 ? String(value) : "";
}

function isPlaceholderValue(raw) {
  const normalized = String(raw ?? "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized.includes("replace-with")) {
    return true;
  }
  if (normalized.startsWith("your-")) {
    return true;
  }
  if (
    normalized.includes("<redacted>")
    || normalized.includes("<secret>")
    || normalized.includes("<token>")
  ) {
    return true;
  }
  return false;
}

function resolveStringCandidate(candidates, options = {}) {
  const defaultValue = String(options.defaultValue ?? "").trim();
  const defaultSource = options.defaultSource ?? "default";
  const offSource = options.offSource ?? "off";
  const skipPlaceholders = options.skipPlaceholders === true;
  const rows = normalizeCandidateRows(candidates);
  for (const row of rows) {
    if (!row.value) {
      continue;
    }
    if (skipPlaceholders && isPlaceholderValue(row.value)) {
      continue;
    }
    return {
      value: row.value,
      source: row.source,
    };
  }
  if (defaultValue) {
    return {
      value: defaultValue,
      source: defaultSource,
    };
  }
  return {
    value: "",
    source: offSource,
  };
}

function resolvePositiveIntCandidate(candidates, options = {}) {
  const defaultValue = toPositiveInt(options.defaultValue);
  const defaultSource = options.defaultSource ?? "default";
  const offSource = options.offSource ?? "off";
  const rows = normalizeCandidateRows(candidates);
  for (const row of rows) {
    const value = toPositiveInt(row.value);
    if (value <= 0) {
      continue;
    }
    return {
      value,
      source: row.source,
    };
  }
  if (defaultValue > 0) {
    return {
      value: defaultValue,
      source: defaultSource,
    };
  }
  return {
    value: 0,
    source: offSource,
  };
}

function hasEffectiveCandidate(candidates, options = {}) {
  const skipPlaceholders = options.skipPlaceholders === true;
  const rows = normalizeCandidateRows(candidates);
  for (const row of rows) {
    if (!row.value) {
      continue;
    }
    if (skipPlaceholders && isPlaceholderValue(row.value)) {
      continue;
    }
    return true;
  }
  return false;
}

function normalizeContextWeaverEndpointBaseUrl(rawBaseUrl, endpointName) {
  const endpoint = String(endpointName ?? "").trim().replace(/^\/+/, "");
  const baseUrl = String(rawBaseUrl ?? "").trim();
  if (!baseUrl || !endpoint) {
    return baseUrl;
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    return baseUrl;
  }
  try {
    const parsed = new URL(baseUrl);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    const endpointPath = `/${endpoint.toLowerCase()}`;
    const lowerPath = pathname.toLowerCase();
    if (lowerPath.endsWith(endpointPath)) {
      return parsed.toString();
    }
    if (!pathname || pathname === "/") {
      parsed.pathname = `/${endpoint}`;
      return parsed.toString();
    }
    if (lowerPath === "/v1" || lowerPath.endsWith("/v1")) {
      parsed.pathname = `${pathname}/${endpoint}`;
      return parsed.toString();
    }
    return parsed.toString();
  } catch {
    return baseUrl;
  }
}

function resolveContextWeaverRetrieval(options = {}) {
  const sharedBaseUrlResolved = resolveStringCandidate(options.sharedBaseUrlCandidates, {
    offSource: "default",
    skipPlaceholders: true,
  });
  const sharedApiKeyResolved = resolveStringCandidate(options.sharedApiKeyCandidates, {
    offSource: "default",
    skipPlaceholders: true,
  });

  const embeddingModelResolved = resolveStringCandidate(options.embeddingModelCandidates, {
    offSource: "off",
    skipPlaceholders: true,
  });
  const rerankModelResolved = resolveStringCandidate(options.rerankModelCandidates, {
    offSource: "off",
    skipPlaceholders: true,
  });

  const embeddingDimensionsResolved = resolvePositiveIntCandidate(options.embeddingDimensionsCandidates, {
    offSource: "off",
  });

  const embeddingBaseUrlResolved = resolveStringCandidate([
    ...normalizeCandidateRows(options.embeddingBaseUrlCandidates),
    {
      value: sharedBaseUrlResolved.value,
      source: sharedBaseUrlResolved.source,
    },
  ], {
    offSource: "off",
    skipPlaceholders: true,
  });
  const rerankBaseUrlResolved = resolveStringCandidate([
    ...normalizeCandidateRows(options.rerankBaseUrlCandidates),
    {
      value: sharedBaseUrlResolved.value,
      source: sharedBaseUrlResolved.source,
    },
  ], {
    offSource: "off",
    skipPlaceholders: true,
  });

  const embeddingApiKeyResolved = resolveStringCandidate([
    ...normalizeCandidateRows(options.embeddingApiKeyCandidates),
    {
      value: sharedApiKeyResolved.value,
      source: sharedApiKeyResolved.source,
    },
  ], {
    offSource: "off",
    skipPlaceholders: true,
  });
  const rerankApiKeyResolved = resolveStringCandidate([
    ...normalizeCandidateRows(options.rerankApiKeyCandidates),
    {
      value: sharedApiKeyResolved.value,
      source: sharedApiKeyResolved.source,
    },
  ], {
    offSource: "off",
    skipPlaceholders: true,
  });

  const embeddingEndpointBaseUrl = normalizeContextWeaverEndpointBaseUrl(
    embeddingBaseUrlResolved.value,
    "embeddings",
  );
  const rerankEndpointBaseUrl = normalizeContextWeaverEndpointBaseUrl(
    rerankBaseUrlResolved.value,
    "rerank",
  );

  const embedding = embeddingEndpointBaseUrl
    && embeddingApiKeyResolved.value
    && embeddingModelResolved.value
    ? {
        base_url: embeddingEndpointBaseUrl,
        api_key: embeddingApiKeyResolved.value,
        model: embeddingModelResolved.value,
        ...(embeddingDimensionsResolved.value > 0
          ? { dimensions: embeddingDimensionsResolved.value }
          : {}),
      }
    : null;

  const rerank = rerankEndpointBaseUrl
    && rerankApiKeyResolved.value
    && rerankModelResolved.value
    ? {
        base_url: rerankEndpointBaseUrl,
        api_key: rerankApiKeyResolved.value,
        model: rerankModelResolved.value,
      }
    : null;

  return {
    sharedBaseUrl: sharedBaseUrlResolved.value,
    sharedBaseUrlSource: sharedBaseUrlResolved.source,
    sharedApiKey: sharedApiKeyResolved.value,
    sharedApiKeySource: sharedApiKeyResolved.source,
    embeddingBaseUrl: embeddingEndpointBaseUrl,
    embeddingBaseUrlSource: embeddingBaseUrlResolved.source,
    embeddingApiKey: embeddingApiKeyResolved.value,
    embeddingApiKeySource: embeddingApiKeyResolved.source,
    embeddingModel: embeddingModelResolved.value,
    embeddingModelSource: embeddingModelResolved.source,
    embeddingDimensions: embeddingDimensionsResolved.value,
    embeddingDimensionsSource: embeddingDimensionsResolved.source,
    rerankBaseUrl: rerankEndpointBaseUrl,
    rerankBaseUrlSource: rerankBaseUrlResolved.source,
    rerankApiKey: rerankApiKeyResolved.value,
    rerankApiKeySource: rerankApiKeyResolved.source,
    rerankModel: rerankModelResolved.value,
    rerankModelSource: rerankModelResolved.source,
    embedding,
    rerank,
  };
}

export {
  hasEffectiveCandidate,
  isPlaceholderValue,
  normalizeContextWeaverEndpointBaseUrl,
  resolveContextWeaverRetrieval,
  resolvePositiveIntCandidate,
  resolveStringCandidate,
  toPositiveInt,
  toPositiveIntString,
};
