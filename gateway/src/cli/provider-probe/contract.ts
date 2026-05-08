export interface ProviderProbeResult {
  state: "ok" | "warn" | "error";
  detail: string;
  httpStatus?: number;
  modelCount?: number;
  selectedModel?: string;
  selectedFound?: boolean;
  resolvedModel?: string;
  autoSelected?: boolean;
}

export interface ProviderModelListResult {
  state: "ok" | "warn" | "error";
  detail: string;
  httpStatus?: number;
  modelIds: string[];
  modelContextWindowTokensById?: Record<string, number>;
}

export interface MutableProvider {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  providerKind?: string;
  kimiWebSearchMode?: string;
  kimiDisableThinkingOnBuiltinWebSearch?: boolean;
  kimiOfficialToolsAllowlist?: string[];
  kimiMaxTokens?: number;
  kimiStream?: boolean;
  kimiTemperature?: number;
  kimiTopP?: number;
  kimiFilesEnabled?: boolean;
  kimiAllowFileAdmin?: boolean;
  promptCacheEnabled?: boolean;
  promptCacheStrategy?: string;
  promptCacheUserLastN?: number;
  promptCacheCapability?: string;
  priority?: number;
  weight?: number;
  unitCost?: number;
  maxInFlight?: number;
  requestsPerMinute?: number;
  burst?: number;
  configErrors?: ProviderConfigFieldError[];
}

export interface MutableProject {
  name?: string;
  workDir?: string;
  selectedProvider?: string;
  providers: MutableProvider[];
}

export interface ProviderSnapshot {
  name: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  providerKind?: string;
  kimiWebSearchMode?: string;
  kimiDisableThinkingOnBuiltinWebSearch?: boolean;
  kimiOfficialToolsAllowlist?: string[];
  kimiMaxTokens?: number;
  kimiStream?: boolean;
  kimiTemperature?: number;
  kimiTopP?: number;
  kimiFilesEnabled?: boolean;
  kimiAllowFileAdmin?: boolean;
  promptCacheEnabled?: boolean;
  promptCacheStrategy?: string;
  promptCacheUserLastN?: number;
  promptCacheCapability?: string;
  priority?: number;
  weight?: number;
  unitCost?: number;
  maxInFlight?: number;
  requestsPerMinute?: number;
  burst?: number;
  configErrors?: ProviderConfigFieldError[];
}

export interface ProviderConfigFieldError {
  field: string;
  detail: string;
}

export interface ProjectProviderSnapshot {
  projectName: string;
  providerName?: string;
  provider?: ProviderSnapshot;
  source: string;
}

export interface ProjectProviderPoolSnapshot {
  projectName: string;
  providerName?: string;
  providers: ProviderSnapshot[];
  source: string;
}
