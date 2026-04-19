import { IncomingMessage, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFileSync } from "node:fs";

function fileReadable(path: string): boolean {
  try {
    const content = readFileSync(path, "utf8");
    return content.length >= 0;
  } catch {
    return false;
  }
}

function removeTrailingSlashes(value: string): string {
  if (/^[\\/]+$/.test(value)) {
    return value.startsWith("\\") ? "\\" : "/";
  }
  return value.replace(/[\\/]+$/, "");
}

function stripInlineComment(line: string): string {
  let inQuote = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inQuote = !inQuote;
      continue;
    }
    if (char === "#" && !inQuote) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseTomlString(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("\"")) {
    const match = trimmed.match(/^"([^"]*)"/);
    if (match && typeof match[1] === "string") {
      return match[1].trim();
    }
  }
  return trimmed;
}

function parseTomlNumber(value: string): number | undefined {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function parseTomlBoolean(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
}

function parseTomlStringArray(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }
  const content = trimmed.slice(1, -1).trim();
  if (!content) {
    return [];
  }
  const items: string[] = [];
  for (const token of content.split(",")) {
    const parsed = parseTomlString(token);
    if (!parsed) {
      continue;
    }
    const normalized = parsed.trim();
    if (!normalized) {
      continue;
    }
    items.push(normalized);
  }
  return items;
}

function toAbsolutePath(rawPath: string, homeDir: string, baseDir: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return removeTrailingSlashes(baseDir);
  }
  let expanded = trimmed;
  if (expanded === "~") {
    expanded = homeDir;
  } else if (expanded.startsWith("~/")) {
    expanded = `${homeDir}/${expanded.slice(2)}`;
  }
  if (expanded.startsWith("/") || expanded.startsWith("\\")) {
    return removeTrailingSlashes(expanded);
  }
  return removeTrailingSlashes(`${removeTrailingSlashes(baseDir)}/${expanded}`);
}

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

interface MutableProvider {
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
}

interface MutableProject {
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

function normalizeConfigPathForMatch(path: string): string {
  return removeTrailingSlashes(path).replace(/\\/g, "/");
}

function parseProjectsFromToml(configTomlPath: string): MutableProject[] | undefined {
  const projects: MutableProject[] = [];
  let currentProject: MutableProject | undefined;
  let currentProvider: MutableProvider | undefined;
  let section = "";
  try {
    const raw = readFileSync(configTomlPath, "utf8");
    const lines = raw.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = stripInlineComment(rawLine).trim();
      if (!line) {
        continue;
      }
      const arraySectionMatch = line.match(/^\[\[([A-Za-z0-9_.-]+)\]\]$/);
      if (arraySectionMatch) {
        section = arraySectionMatch[1];
        if (section === "projects") {
          currentProject = {
            providers: [],
          };
          projects.push(currentProject);
          currentProvider = undefined;
        } else if (section === "projects.agent.providers") {
          if (currentProject) {
            currentProvider = {};
            currentProject.providers.push(currentProvider);
          }
        } else {
          currentProvider = undefined;
        }
        continue;
      }
      const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
      if (sectionMatch) {
        section = sectionMatch[1];
        if (section !== "projects.agent.providers") {
          currentProvider = undefined;
        }
        continue;
      }
      const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
      if (!kvMatch) {
        continue;
      }
      const key = kvMatch[1];
      const value = parseTomlString(kvMatch[2]);
      if (!value || !currentProject) {
        continue;
      }
      if (section === "projects") {
        if (key === "name") {
          currentProject.name = value;
        } else if (key === "work_dir") {
          currentProject.workDir = value;
        }
        continue;
      }
      if (section === "projects.agent") {
        if (key === "provider") {
          currentProject.selectedProvider = value;
        }
        continue;
      }
        if (section === "projects.agent.providers" && currentProvider) {
          if (key === "name") {
            currentProvider.name = value;
          } else if (key === "base_url") {
            currentProvider.baseUrl = value;
          } else if (key === "api_key") {
            currentProvider.apiKey = value;
          } else if (key === "model") {
            currentProvider.model = value;
          } else if (key === "provider_kind") {
            currentProvider.providerKind = value;
          } else if (key === "kimi_web_search_mode") {
            currentProvider.kimiWebSearchMode = value;
          } else if (key === "kimi_disable_thinking_on_builtin_web_search") {
            currentProvider.kimiDisableThinkingOnBuiltinWebSearch = parseTomlBoolean(kvMatch[2]);
          } else if (key === "kimi_official_tools_allowlist") {
            currentProvider.kimiOfficialToolsAllowlist = parseTomlStringArray(kvMatch[2]);
          } else if (key === "kimi_max_tokens") {
            currentProvider.kimiMaxTokens = parseTomlNumber(kvMatch[2]);
          } else if (key === "kimi_stream") {
            currentProvider.kimiStream = parseTomlBoolean(kvMatch[2]);
          } else if (key === "kimi_temperature") {
            currentProvider.kimiTemperature = parseTomlNumber(kvMatch[2]);
          } else if (key === "kimi_top_p") {
            currentProvider.kimiTopP = parseTomlNumber(kvMatch[2]);
          } else if (key === "kimi_files_enabled") {
            currentProvider.kimiFilesEnabled = parseTomlBoolean(kvMatch[2]);
          } else if (key === "kimi_allow_file_admin") {
            currentProvider.kimiAllowFileAdmin = parseTomlBoolean(kvMatch[2]);
          } else if (key === "prompt_cache_enabled" || key === "kimi_prompt_cache_enabled") {
            currentProvider.promptCacheEnabled = parseTomlBoolean(kvMatch[2]);
          } else if (key === "prompt_cache_strategy" || key === "kimi_prompt_cache_strategy") {
            currentProvider.promptCacheStrategy = value;
          } else if (key === "prompt_cache_user_last_n" || key === "kimi_prompt_cache_user_last_n") {
            currentProvider.promptCacheUserLastN = parseTomlNumber(kvMatch[2]);
          } else if (key === "prompt_cache_capability" || key === "kimi_prompt_cache_capability") {
            currentProvider.promptCacheCapability = value;
          } else if (key === "priority") {
            currentProvider.priority = parseTomlNumber(kvMatch[2]);
          } else if (key === "weight") {
            currentProvider.weight = parseTomlNumber(kvMatch[2]);
          } else if (key === "unit_cost" || key === "cost_per_1k_tokens") {
            currentProvider.unitCost = parseTomlNumber(kvMatch[2]);
          } else if (key === "max_inflight" || key === "max_in_flight") {
            currentProvider.maxInFlight = parseTomlNumber(kvMatch[2]);
          } else if (key === "requests_per_minute" || key === "rpm") {
            currentProvider.requestsPerMinute = parseTomlNumber(kvMatch[2]);
          } else if (key === "burst" || key === "bucket_burst") {
            currentProvider.burst = parseTomlNumber(kvMatch[2]);
          }
        }
      }
  } catch {
    return undefined;
  }
  return projects;
}

function selectProject(
  projects: readonly MutableProject[],
  projectName: string,
  workDir: string,
  homeDir: string,
): MutableProject {
  const normalizedWorkDir = normalizeConfigPathForMatch(workDir);
  const byName = projects.find((item) => {
    if (typeof item.name !== "string") {
      return false;
    }
    return item.name.trim() === projectName;
  });
  if (byName) {
    return byName;
  }
  const byWorkDir = projects.find((item) => {
    if (typeof item.workDir !== "string" || !item.workDir.trim()) {
      return false;
    }
    const expanded = toAbsolutePath(item.workDir, homeDir, process.cwd());
    return normalizeConfigPathForMatch(expanded) === normalizedWorkDir;
  });
  if (byWorkDir) {
    return byWorkDir;
  }
  return projects[0];
}

function normalizeProviderSnapshot(raw: MutableProvider, fallbackName: string): ProviderSnapshot {
  const resolvedName = raw.name?.trim();
  const providerKind = raw.providerKind?.trim();
  const kimiWebSearchMode = raw.kimiWebSearchMode?.trim();
  const promptCacheStrategy = raw.promptCacheStrategy?.trim();
  const promptCacheCapability = raw.promptCacheCapability?.trim();
  const kimiOfficialToolsAllowlist = Array.isArray(raw.kimiOfficialToolsAllowlist)
    ? raw.kimiOfficialToolsAllowlist
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
    : undefined;
  return {
    name: resolvedName && resolvedName.length > 0 ? resolvedName : fallbackName,
    baseUrl: raw.baseUrl?.trim(),
    apiKey: raw.apiKey?.trim(),
    model: raw.model?.trim(),
    providerKind: providerKind && providerKind.length > 0 ? providerKind : undefined,
    kimiWebSearchMode: kimiWebSearchMode && kimiWebSearchMode.length > 0 ? kimiWebSearchMode : undefined,
    kimiDisableThinkingOnBuiltinWebSearch: raw.kimiDisableThinkingOnBuiltinWebSearch,
    kimiOfficialToolsAllowlist,
    kimiMaxTokens: typeof raw.kimiMaxTokens === "number" ? raw.kimiMaxTokens : undefined,
    kimiStream: raw.kimiStream,
    kimiTemperature: typeof raw.kimiTemperature === "number" ? raw.kimiTemperature : undefined,
    kimiTopP: typeof raw.kimiTopP === "number" ? raw.kimiTopP : undefined,
    kimiFilesEnabled: raw.kimiFilesEnabled,
    kimiAllowFileAdmin: raw.kimiAllowFileAdmin,
    promptCacheEnabled: raw.promptCacheEnabled,
    promptCacheStrategy: promptCacheStrategy && promptCacheStrategy.length > 0 ? promptCacheStrategy : undefined,
    promptCacheUserLastN:
      typeof raw.promptCacheUserLastN === "number"
        ? raw.promptCacheUserLastN
        : undefined,
    promptCacheCapability:
      promptCacheCapability && promptCacheCapability.length > 0
        ? promptCacheCapability
        : undefined,
    priority: typeof raw.priority === "number" ? raw.priority : undefined,
    weight: typeof raw.weight === "number" ? raw.weight : undefined,
    unitCost: typeof raw.unitCost === "number" ? raw.unitCost : undefined,
    maxInFlight: typeof raw.maxInFlight === "number" ? raw.maxInFlight : undefined,
    requestsPerMinute: typeof raw.requestsPerMinute === "number" ? raw.requestsPerMinute : undefined,
    burst: typeof raw.burst === "number" ? raw.burst : undefined,
  };
}

function buildOrderedProviders(
  selectedProject: MutableProject,
  providerOverride?: string,
): { requestedName?: string; providers: ProviderSnapshot[] } {
  const selectedName = selectedProject.selectedProvider?.trim();
  const overrideName = providerOverride?.trim();
  const requestedName = overrideName && overrideName.length > 0 ? overrideName : selectedName;
  if (!Array.isArray(selectedProject.providers) || selectedProject.providers.length === 0) {
    return {
      requestedName,
      providers: [],
    };
  }
  const ordered: MutableProvider[] = [];
  if (requestedName && requestedName.length > 0) {
    const matched = selectedProject.providers.find((item) => item.name?.trim() === requestedName);
    if (matched) {
      ordered.push(matched);
    }
  }
  for (const item of selectedProject.providers) {
    if (ordered.includes(item)) {
      continue;
    }
    ordered.push(item);
  }
  return {
    requestedName,
    providers: ordered.map((item, index) =>
      normalizeProviderSnapshot(item, requestedName && requestedName.length > 0 ? requestedName : `provider-${String(index + 1)}`),
    ),
  };
}

export function readProviderPoolFromToml(
  configTomlPath: string | undefined,
  projectName: string,
  workDir: string,
  homeDir: string,
  providerOverride?: string,
): ProjectProviderPoolSnapshot | undefined {
  if (!configTomlPath || !fileReadable(configTomlPath)) {
    return undefined;
  }
  const projects = parseProjectsFromToml(configTomlPath);
  if (!projects || !projects.length) {
    return undefined;
  }
  const selectedProject = selectProject(projects, projectName, workDir, homeDir);
  const ordered = buildOrderedProviders(selectedProject, providerOverride);
  return {
    projectName: selectedProject.name?.trim() || projectName,
    providerName: ordered.requestedName || ordered.providers[0]?.name,
    providers: ordered.providers,
    source: `config_toml:${configTomlPath}`,
  };
}

export function readProviderSnapshotFromToml(
  configTomlPath: string | undefined,
  projectName: string,
  workDir: string,
  homeDir: string,
  providerOverride?: string,
): ProjectProviderSnapshot | undefined {
  const pool = readProviderPoolFromToml(
    configTomlPath,
    projectName,
    workDir,
    homeDir,
    providerOverride,
  );
  if (!pool) {
    return undefined;
  }
  const provider = pool.providers[0];
  return {
    projectName: pool.projectName,
    providerName: pool.providerName,
    provider,
    source: pool.source,
  };
}

function normalizeProbeBaseUrl(rawBaseUrl: string): URL {
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

function parseModelCatalogFromProbePayload(payload: unknown): {
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
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const modelRecord = item as Record<string, unknown>;
      const id = typeof modelRecord.id === "string" ? modelRecord.id.trim() : "";
      if (!id) {
        continue;
      }
      modelIds.push(id);
      const contextWindowTokens = readModelContextWindowTokens(modelRecord);
      if (typeof contextWindowTokens === "number") {
        modelContextWindowTokensById[id] = contextWindowTokens;
      }
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
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const modelRecord = item as Record<string, unknown>;
      const id = typeof modelRecord.id === "string" ? modelRecord.id.trim() : "";
      if (!id) {
        continue;
      }
      modelIds.push(id);
      const contextWindowTokens = readModelContextWindowTokens(modelRecord);
      if (typeof contextWindowTokens === "number") {
        modelContextWindowTokensById[id] = contextWindowTokens;
      }
    }
  }
  return {
    modelIds,
    modelContextWindowTokensById,
  };
}

function pickAutoModel(modelIds: readonly string[]): string | undefined {
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

function resolveProbeModelHint(
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

export async function probeProviderModels(
  baseUrl: string,
  apiKey: string,
  modelHint: string | undefined,
): Promise<ProviderProbeResult> {
  const listed = await listProviderModels(baseUrl, apiKey);
  if (listed.state !== "ok") {
    return {
      state: listed.state,
      detail: listed.detail,
      httpStatus: listed.httpStatus,
      modelCount: listed.modelIds.length,
    };
  }
  const selected = resolveProbeModelHint(modelHint, listed.modelIds);
  const resolvedPart = selected.resolvedModel
    ? ` resolved=${selected.resolvedModel}`
    : "";
  return {
    state: "ok",
    detail: selected.selectedModel
      ? `models=${String(listed.modelIds.length)} selected=${selected.selectedFound ? "matched" : "missing"}${resolvedPart}`
      : `models=${String(listed.modelIds.length)}`,
    httpStatus: listed.httpStatus,
    modelCount: listed.modelIds.length,
    selectedModel: selected.selectedModel,
    selectedFound: selected.selectedFound,
    resolvedModel: selected.resolvedModel,
    autoSelected: selected.autoSelected,
  };
}

export async function listProviderModels(
  baseUrl: string,
  apiKey: string,
): Promise<ProviderModelListResult> {
  let url: URL;
  try {
    url = normalizeProbeBaseUrl(baseUrl);
  } catch (error) {
    return {
      state: "error",
      detail: `invalid base_url: ${String(error)}`,
      modelIds: [],
    };
  }
  const requestFactory = url.protocol === "https:" ? httpsRequest : httpRequest;
  const requestOptions = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port ? Number.parseInt(url.port, 10) : undefined,
    path: `${url.pathname}${url.search}`,
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      "user-agent": "grobot-ts-dev-cli/0.1",
    },
    timeout: 5_000,
  };

  return await new Promise((resolve: (value: ProviderModelListResult) => void) => {
    const req = requestFactory(requestOptions, (res: IncomingMessage) => {
      let body = "";
      res.on("data", (chunk: unknown) => {
        if (typeof chunk === "string") {
          body += chunk;
          return;
        }
        body += Buffer.from(chunk as Uint8Array).toString("utf8");
      });
      res.on("end", () => {
        const statusCode = res.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          const snippet = body.trim().slice(0, 240);
          resolve({
            state: "warn",
            detail: `http_${String(statusCode)} ${snippet || "<empty-body>"}`,
            httpStatus: statusCode,
            modelIds: [],
          });
          return;
        }
        try {
          const payload = JSON.parse(body) as unknown;
          const parsedCatalog = parseModelCatalogFromProbePayload(payload);
          const modelIds = parsedCatalog.modelIds;
          resolve({
            state: "ok",
            detail: `models=${String(modelIds.length)}`,
            httpStatus: statusCode,
            modelIds,
            modelContextWindowTokensById: parsedCatalog.modelContextWindowTokensById,
          });
        } catch (error) {
          resolve({
            state: "warn",
            detail: `invalid_json_response: ${String(error)}`,
            httpStatus: statusCode,
            modelIds: [],
          });
        }
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (error: Error) => {
      resolve({
        state: "error",
        detail: String(error),
        modelIds: [],
      });
    });
    req.end();
  });
}
