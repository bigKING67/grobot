export function normalizeProbeBaseUrl(rawBaseUrl: string): URL {
  const trimmed = rawBaseUrl.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/models`;
  url.search = "";
  url.hash = "";
  return url;
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return undefined;
}

function readModelContextWindowTokens(rawModel: Record<string, unknown>): number | undefined {
  const directCandidates: unknown[] = [
    rawModel.context_window_tokens,
    rawModel.contextWindowTokens,
    rawModel.context_window,
    rawModel.contextWindow,
    rawModel.max_context_length,
    rawModel.maxContextLength,
    rawModel.max_input_tokens,
    rawModel.maxInputTokens,
    rawModel.input_token_limit,
    rawModel.inputTokenLimit,
  ];
  for (const candidate of directCandidates) {
    const parsed = parsePositiveInteger(candidate);
    if (typeof parsed === "number") {
      return parsed;
    }
  }
  const capabilities = rawModel.capabilities;
  if (typeof capabilities === "object" && capabilities !== null) {
    const capabilitiesRecord = capabilities as Record<string, unknown>;
    const capabilityCandidates: unknown[] = [
      capabilitiesRecord.context_window_tokens,
      capabilitiesRecord.contextWindowTokens,
      capabilitiesRecord.context_window,
      capabilitiesRecord.contextWindow,
      capabilitiesRecord.max_context_length,
      capabilitiesRecord.maxContextLength,
      capabilitiesRecord.max_input_tokens,
      capabilitiesRecord.maxInputTokens,
      capabilitiesRecord.input_token_limit,
      capabilitiesRecord.inputTokenLimit,
    ];
    for (const candidate of capabilityCandidates) {
      const parsed = parsePositiveInteger(candidate);
      if (typeof parsed === "number") {
        return parsed;
      }
    }
  }
  return undefined;
}

export function parseModelCatalogFromProbePayload(payload: unknown): {
  modelIds: string[];
  modelContextWindowTokensById: Record<string, number>;
} {
  const modelIds: string[] = [];
  const modelContextWindowTokensById: Record<string, number> = {};
  if (typeof payload !== "object" || payload === null) {
    return {
      modelIds,
      modelContextWindowTokensById,
    };
  }
  const parsed = payload as Record<string, unknown>;
  const rawData = parsed.data;
  if (Array.isArray(rawData)) {
    for (const item of rawData) {
      appendModelCatalogItem(item, modelIds, modelContextWindowTokensById);
    }
    return {
      modelIds,
      modelContextWindowTokensById,
    };
  }
  const rawModels = parsed.models;
  if (Array.isArray(rawModels)) {
    for (const item of rawModels) {
      if (typeof item === "string") {
        const id = item.trim();
        if (id.length > 0) {
          modelIds.push(id);
        }
        continue;
      }
      appendModelCatalogItem(item, modelIds, modelContextWindowTokensById);
    }
  }
  return {
    modelIds,
    modelContextWindowTokensById,
  };
}

function appendModelCatalogItem(
  item: unknown,
  modelIds: string[],
  modelContextWindowTokensById: Record<string, number>,
): void {
  if (typeof item !== "object" || item === null) {
    return;
  }
  const modelRecord = item as Record<string, unknown>;
  const id = typeof modelRecord.id === "string" ? modelRecord.id.trim() : "";
  if (!id) {
    return;
  }
  modelIds.push(id);
  const contextWindowTokens = readModelContextWindowTokens(modelRecord);
  if (typeof contextWindowTokens === "number") {
    modelContextWindowTokensById[id] = contextWindowTokens;
  }
}

export function pickAutoModel(modelIds: readonly string[]): string | undefined {
  if (modelIds.length === 0) {
    return undefined;
  }
  const priorityPrefixes = [
    "kimi-k2.5",
    "kimi_k2.5",
    "kimi-k2",
    "kimi_k2",
    "kimi",
    "moonshot",
  ];
  for (const prefix of priorityPrefixes) {
    const preferred = modelIds.find((item) => item.trim().toLowerCase().startsWith(prefix));
    if (preferred) {
      return preferred;
    }
  }
  const nonEmpty = modelIds.find((item) => item.trim().length > 0);
  return nonEmpty;
}

export function resolveProbeModelHint(
  modelHint: string | undefined,
  modelIds: readonly string[],
): {
  selectedModel?: string;
  selectedFound?: boolean;
  resolvedModel?: string;
  autoSelected?: boolean;
} {
  const normalizedHint = modelHint?.trim();
  if (!normalizedHint) {
    return {
      selectedModel: undefined,
      selectedFound: undefined,
      resolvedModel: undefined,
      autoSelected: false,
    };
  }
  if (normalizedHint.toLowerCase() === "auto") {
    const resolvedModel = pickAutoModel(modelIds);
    return {
      selectedModel: normalizedHint,
      selectedFound: typeof resolvedModel === "string" && resolvedModel.length > 0,
      resolvedModel,
      autoSelected: true,
    };
  }
  const selectedFound = modelIds.some((item) => item === normalizedHint);
  return {
    selectedModel: normalizedHint,
    selectedFound,
    resolvedModel: normalizedHint,
    autoSelected: false,
  };
}
