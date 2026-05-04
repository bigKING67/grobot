import type { RuntimeModelConfig } from "../../models/types";

export interface GraphCacheCounter {
  hit: number;
  miss: number;
  write: number;
  evict: number;
}

export function readGraphCacheCounter(
  stats: Record<string, { hit?: number; miss?: number; write?: number; evict?: number }>,
  bucket: string,
): GraphCacheCounter {
  const row = stats[bucket];
  return {
    hit: Number.isFinite(row?.hit) ? Number(row?.hit) : 0,
    miss: Number.isFinite(row?.miss) ? Number(row?.miss) : 0,
    write: Number.isFinite(row?.write) ? Number(row?.write) : 0,
    evict: Number.isFinite(row?.evict) ? Number(row?.evict) : 0,
  };
}

export function resolveContextEngineRuntimeModelConfig(input: {
  providerSnapshot?: {
    provider?: {
      providerKind?: string;
      baseUrl?: string;
      model?: string;
    };
  };
  baseUrlFromCli?: string;
  baseUrlFromEnv?: string;
  modelFromCli?: string;
  modelFromEnv?: string;
}): RuntimeModelConfig | undefined {
  const providerKind = input.providerSnapshot?.provider?.providerKind?.trim();
  const baseUrl = (input.baseUrlFromCli ?? input.baseUrlFromEnv ?? input.providerSnapshot?.provider?.baseUrl)?.trim();
  const model = (input.modelFromCli ?? input.modelFromEnv ?? input.providerSnapshot?.provider?.model)?.trim();
  if (!providerKind && !baseUrl && !model) {
    return undefined;
  }
  const runtimeModelConfig: RuntimeModelConfig = {};
  if (providerKind && providerKind.length > 0) {
    runtimeModelConfig.providerKind = providerKind as RuntimeModelConfig["providerKind"];
  }
  if (baseUrl && baseUrl.length > 0) {
    runtimeModelConfig.baseUrl = baseUrl;
  }
  if (model && model.length > 0) {
    runtimeModelConfig.model = model;
  }
  return runtimeModelConfig;
}
